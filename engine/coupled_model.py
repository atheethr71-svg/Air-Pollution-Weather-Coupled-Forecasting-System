"""Coupled aerosol / meteorology model for the Delhi NCR winter haze regime.

This module implements a 50 x 50 mesoscale box model (lat 28.2-28.9 N,
lon 76.8-77.5 E, ~1.4 x 1.6 km cells) that evolves ground-level PM2.5 for
72 hours with an explicit two-way coupling between aerosol loading and
boundary-layer dynamics.

Physics
-------
Transport   First-order upwind finite-difference advection in conservative
            flux form, plus horizontal turbulent diffusion.  The default
            diffusion operator is the explicit 5-point Laplacian, sub-stepped
            until the Fourier number is below 0.25; it reproduces the analytic
            variance growth 2 K dt.  Alternatively the Green's function of the
            2-D diffusion equation can be applied (an anisotropic Gaussian
            kernel of width sigma = sqrt(2 K dt), unconditionally stable),
            which is accurate once sigma exceeds about half a grid cell.
Diffusivity A Smagorinsky-type closure K = (Cs * delta)^2 |S| with a strain
            rate |S| computed from the horizontal wind, floored at K_MIN and
            capped at K_MAX.
Emissions   Stubble-burning plumes: Fire Radiative Power (MW) -> fuel
            consumption (17 MJ/kg) -> PM2.5 emission (6 g/kg).  Briggs plume
            rise (Dh = 1.6 F^(1/3) x^(2/3) / u) splits the mass between the
            mixed layer and an aloft reservoir that later entrains down.
            A separate *continuous* urban area source (traffic, industry,
            residential, waste) keeps the built-up area emitting all episode
            rather than only decaying from its initial inventory; it is
            switched off by default (urban_emission_ug_m2_s = 0) and supplied
            either as a parameter or as an hourly 'urban_emission' field.
Feedback    Aerosol optical depth is diagnosed from the column mass
            (AOD = sigma_ext * m_col).  The resulting extinction factor
            suppresses the *synoptic* PBL height, saturating at 40 % at
            PM2.5 = 250 ug/m3 (see ModelParams.pbl_suppression_pm25).
Trapping    The mixed-layer areal mass M [ug m-2] is the prognostic
            variable, so ground concentration is C = M / H.  When the
            feedback lowers H, C rises in exact proportion (inversion
            trapping) while column mass is conserved.
Losses      Dry deposition (v_d C / H) and below-cloud wet scavenging
            (lambda = k P^0.7).  A deepening mixed layer incorporates
            dH * C_ft of column mass, which then dilutes as it mixes.
Boundaries  Dirichlet inflow at the upwind edges (params.inflow_pm25, the
            hook for regional smoke advected in from outside the domain) and
            zero-gradient outflow.  A zero-gradient *inflow* would pin the
            edge at the polluted interior value and act as an unbounded
            source, so it is not used.

Diagnostics returned hourly: PM2.5 and its 24-h mean, effective and synoptic
PBL height, aerosol extinction, PBL suppression fraction, inversion strength
index (T_2m / T_850hPa, Kelvin), CPCB AQI sub-index and category, plus the
stubble emission field and the aloft reservoir mass.

Numerical stability
-------------------
Advection is sub-stepped so the Courant number stays at or below
CFL_TARGET (0.5) and, for the Laplacian scheme, the Fourier number stays at
or below FOURIER_TARGET (0.25).  ``check_cfl`` reports the required
sub-stepping, including the Gaussian kernel width in cells, so that the
resolution of the diffusion operator is auditable; the integrator records
whether the sub-step cap was ever hit (``diagnostics["cfl_capped"]``).

Only NumPy and SciPy are used.  Run ``python engine/coupled_model.py`` for
built-in self-tests plus a synthetic 72-h Delhi NCR scenario.
"""

from __future__ import annotations

import math
import warnings
from dataclasses import dataclass
from typing import Any, Mapping

import numpy as np
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree

__all__ = [
    "AQI_CATEGORIES",
    "CFLDiagnostics",
    "Grid",
    "ModelParams",
    "aqi_category_from_pm25",
    "aqi_value_from_pm25",
    "check_cfl",
    "delhi_ncr_grid",
    "simulate_72h",
]

# --------------------------------------------------------------------------
# Domain definition
# --------------------------------------------------------------------------
LAT_MIN, LAT_MAX = 28.2, 28.9
LON_MIN, LON_MAX = 76.8, 77.5
N_LAT, N_LON = 50, 50
EARTH_RADIUS_M = 6_371_000.0
DEG2RAD = math.pi / 180.0

#: CPCB (India) AQI classes for the PM2.5 sub-index, in ascending severity.
AQI_CATEGORIES = np.array(
    ["Good", "Satisfactory", "Moderate", "Poor", "Very Poor", "Severe"], dtype="<U12"
)
#: Upper concentration bound (ug/m3) of each class except the last, which is open.
AQI_PM25_BOUNDS = np.array([30.0, 60.0, 90.0, 120.0, 250.0], dtype=np.float64)
#: (concentration, sub-index) knot pairs used for the piecewise-linear AQI map.
AQI_PM25_KNOTS = np.array([0.0, 30.0, 60.0, 90.0, 120.0, 250.0, 500.0])
AQI_INDEX_KNOTS = np.array([0.0, 50.0, 100.0, 200.0, 300.0, 400.0, 500.0])

#: Gaussian-kernel width (in grid cells) below which the kernel under-diffuses.
GAUSSIAN_MIN_SIGMA_CELLS = 0.5


# --------------------------------------------------------------------------
# Grid
# --------------------------------------------------------------------------
@dataclass(frozen=True, eq=False)
class Grid:
    """Regular lat/lon grid; arrays are indexed ``[iy, ix]`` (south -> north)."""

    lat: np.ndarray  # (ny,)
    lon: np.ndarray  # (nx,)
    lat2d: np.ndarray  # (ny, nx)
    lon2d: np.ndarray  # (ny, nx)
    dx: float  # zonal spacing [m]
    dy: float  # meridional spacing [m]

    @property
    def shape(self) -> tuple[int, int]:
        return (int(self.lat.size), int(self.lon.size))

    @property
    def cell_area(self) -> float:
        """Cell area [m2]."""
        return self.dx * self.dy

    def cell_centers_km(self) -> np.ndarray:
        """Cell centres as (ny*nx, 2) local tangent-plane coordinates [km]."""
        lat0 = float(self.lat.mean())
        lon0 = float(self.lon.mean())
        y = (self.lat2d.ravel() - lat0) * 110.574
        x = (self.lon2d.ravel() - lon0) * 111.320 * math.cos(lat0 * DEG2RAD)
        return np.column_stack((x, y))

    def describe(self) -> dict[str, Any]:
        return {
            "shape": self.shape,
            "lat_range": (float(self.lat[0]), float(self.lat[-1])),
            "lon_range": (float(self.lon[0]), float(self.lon[-1])),
            "dx_m": self.dx,
            "dy_m": self.dy,
            "cell_area_m2": self.cell_area,
            "domain_km": (self.dx * self.shape[1] / 1000.0, self.dy * self.shape[0] / 1000.0),
        }


def delhi_ncr_grid(n_lat: int = N_LAT, n_lon: int = N_LON) -> Grid:
    """Build the 50 x 50 Delhi NCR grid (lat 28.2-28.9 N, lon 76.8-77.5 E)."""
    lat = np.linspace(LAT_MIN, LAT_MAX, int(n_lat))
    lon = np.linspace(LON_MIN, LON_MAX, int(n_lon))
    lat2d, lon2d = np.meshgrid(lat, lon, indexing="ij")
    dlat = (LAT_MAX - LAT_MIN) / (int(n_lat) - 1)
    dlon = (LON_MAX - LON_MIN) / (int(n_lon) - 1)
    dy = dlat * DEG2RAD * EARTH_RADIUS_M
    dx = dlon * DEG2RAD * EARTH_RADIUS_M * math.cos(float(lat.mean()) * DEG2RAD)
    return Grid(lat=lat, lon=lon, lat2d=lat2d, lon2d=lon2d, dx=dx, dy=dy)


# --------------------------------------------------------------------------
# Model parameters
# --------------------------------------------------------------------------
@dataclass
class ModelParams:
    """Tunable physical and numerical parameters (all SI-ish, documented)."""

    # --- integration ------------------------------------------------------
    hours: int = 72
    dt_seconds: float = 3600.0
    start_hour_local: float = 0.0  # local (IST) hour of index 0

    # --- turbulence -------------------------------------------------------
    # "laplacian": explicit 5-point stencil, sub-stepped to satisfy the Fourier
    #              limit; accurate at all resolutions and the default.
    # "gaussian" : Green's-function kernel, unconditionally stable, but only
    #              accurate while sigma_kt >= ~0.5 cells (see CFLDiagnostics).
    diffusion_scheme: str = "laplacian"  # "laplacian" | "gaussian"
    smagorinsky_coeff: float = 0.2
    k_min: float = 20.0  # m2/s
    k_max: float = 2000.0  # m2/s

    # --- removal ----------------------------------------------------------
    dry_deposition_velocity: float = 0.005  # m/s (PM2.5)
    wet_scavenging_coeff: float = 1.0e-4  # 1/s per (mm/h)^0.7
    background_pm25: float = 20.0  # free-tropospheric PM2.5 [ug/m3]
    # Lateral inflow concentration [ug/m3].  Regional smoke advected in from
    # outside the domain is represented here (or hour-by-hour via a weather
    # 'inflow' field); the boundary is Dirichlet on inflow and zero-gradient
    # on outflow, the standard open condition for limited-area transport.
    inflow_pm25: float = 20.0

    # --- aerosol-radiation feedback --------------------------------------
    mass_extinction_m2_per_g: float = 4.0  # dry mass extinction efficiency
    pbl_suppression_pm25: float = 250.0  # ug/m3 at which suppression saturates
    max_pbl_suppression: float = 0.40  # fractional PBL reduction cap
    pbl_min_m: float = 60.0  # floor on the effective PBL depth

    # --- entrainment ------------------------------------------------------
    entrainment_velocity_min: float = 1.0e-3  # m/s background exchange
    entrainment_velocity_reference: float = 5.0e-3  # m/s, scales aloft drain
    aloft_entrainment_hours: float = 6.0  # e-folding drain time of lofted smoke
    aloft_wind_factor: float = 1.3  # lofted smoke advects faster than surface

    # --- stubble burning --------------------------------------------------
    fire_heat_yield_mj_per_kg: float = 17.0  # dry crop residue
    pm25_emission_factor_g_per_kg: float = 6.0  # PM2.5 per kg burned
    buoyancy_coefficient: float = 8.63e-6  # m4 s-3 W-1  (g / pi rho cp T)
    plume_rise_reference_distance_m: float = 10_000.0
    plume_rise_max_m: float = 3000.0
    plume_min_wind_speed: float = 1.0  # m/s, prevents a singular rise
    plume_sigma_along_m: float = 6000.0  # initial Gaussian plume spread
    plume_sigma_cross_m: float = 2500.0
    max_fire_distance_km: float = 250.0  # ignore fires far outside the domain
    frp_peak_hour_local: float = 15.5  # afternoon burning maximum
    frp_peak_width_h: float = 3.5
    frp_night_fraction: float = 0.05  # residual overnight smouldering

    # --- urban (local) emissions -----------------------------------------
    # Depth-integrated primary PM2.5 emission from the NCR's own sources,
    # applied every hour.  The value is the *city-centre intensity* [ug m-2 s-1]
    # -- the convention an emission inventory uses -- which urban_footprint()
    # distributes over the built-up area and tapers to a rural floor.  Delhi's
    # inventory-equivalent built-up-area flux is roughly 0.6 ug m-2 s-1, and the
    # resulting domain mean is reported by diagnostics['urban'].  Default 0.0
    # leaves the stubble-only configuration -- and therefore every previously
    # verified result -- untouched.
    urban_emission_ug_m2_s: float = 0.0
    urban_footprint_sigma_km: float = 10.0
    urban_rural_fraction: float = 0.05  # floor as a fraction of the peak
    # Secondary NCR urban centres blended into the footprint, as
    # (lat, lon, weight): Gurugram, Noida, Ghaziabad, Faridabad, Rohtak and
    # Sonipat.  Weights are relative to the 1.0 of the Delhi core.
    urban_secondary_centres: tuple[tuple[float, float, float], ...] = (
        (28.4595, 77.0266, 0.75),  # Gurugram
        (28.5355, 77.3910, 0.70),  # Noida
        (28.6692, 77.4538, 0.65),  # Ghaziabad
        (28.4089, 77.3178, 0.60),  # Faridabad
        (28.6139, 77.2090, 1.00),  # Delhi core
    )

    # --- numerics ---------------------------------------------------------
    cfl_target: float = 0.5
    fourier_target: float = 0.25
    max_substeps: int = 240

    # --- reporting --------------------------------------------------------
    aqi_averaging_window_h: int = 24

    def __post_init__(self) -> None:
        if self.hours < 1:
            raise ValueError("hours must be >= 1")
        if self.dt_seconds <= 0.0:
            raise ValueError("dt_seconds must be > 0")
        if self.diffusion_scheme not in ("gaussian", "laplacian"):
            raise ValueError("diffusion_scheme must be 'gaussian' or 'laplacian'")
        if not 0.0 <= self.max_pbl_suppression <= 1.0:
            raise ValueError("max_pbl_suppression must lie in [0, 1]")
        if self.pbl_suppression_pm25 <= 0.0:
            raise ValueError("pbl_suppression_pm25 must be > 0")
        if self.k_min <= 0.0 or self.k_max < self.k_min:
            raise ValueError("require 0 < k_min <= k_max")
        if self.max_substeps < 1:
            raise ValueError("max_substeps must be >= 1")


# --------------------------------------------------------------------------
# Input coercion helpers
# --------------------------------------------------------------------------
def _as_field(value: Any, shape: tuple[int, int], name: str) -> np.ndarray:
    """Broadcast scalars / 1-D profiles / 2-D fields to a ``shape`` field."""
    arr = np.asarray(value, dtype=np.float64)
    if arr.ndim == 0:
        out = np.full(shape, float(arr))
    elif arr.shape == shape:
        out = arr
    elif arr.ndim == 1:
        if arr.size == shape[0]:
            out = np.repeat(arr[:, None], shape[1], axis=1)
        elif arr.size == shape[1]:
            out = np.repeat(arr[None, :], shape[0], axis=0)
        else:
            raise ValueError(
                f"{name}: 1-D input of length {arr.size} cannot be broadcast to {shape}"
            )
    else:
        raise ValueError(f"{name}: expected scalar, 1-D or 2-D input, got shape {arr.shape}")
    if not np.all(np.isfinite(out)):
        raise ValueError(f"{name}: input contains non-finite values")
    return out


def _coerce_initial(init_pm25_grid: Any, grid: Grid) -> np.ndarray:
    """Accept a 2-D grid, a 1-D profile, or a scalar initial PM2.5 field."""
    field = _as_field(init_pm25_grid, grid.shape, "init_pm25_grid")
    if np.any(field < 0.0):
        raise ValueError("init_pm25_grid must be non-negative")
    return field


_WEATHER_ALIASES: dict[str, tuple[str, ...]] = {
    "u": ("u", "u10", "u_10", "wind_u", "uwind", "u_ms", "u_component"),
    "v": ("v", "v10", "v_10", "wind_v", "vwind", "v_ms", "v_component"),
    "pbl_height": (
        "pbl_height",
        "pbl",
        "pblh",
        "hpbl",
        "zi",
        "boundary_layer_height",
        "mixing_height",
        "h_pbl",
    ),
    "t2m": ("t2m", "t_2m", "t2", "temp_2m", "t_ground", "temp_ground", "t_surface", "tsurf"),
    "t850": ("t850", "t_850", "temp_850", "t_850hpa", "t_at_850", "temp850"),
    "precip": ("precip", "precip_mm", "rain", "rain_mm", "rainfall", "precipitation"),
    "inflow": ("inflow", "inflow_pm25", "boundary_pm25", "pm25_inflow", "upwind_pm25"),
    "urban_emission": (
        "urban_emission",
        "urban_emission_ug_m2_s",
        "urban_flux",
        "city_emission",
        "local_emission",
    ),
}
_ALIAS_LOOKUP = {alias: key for key, aliases in _WEATHER_ALIASES.items() for alias in aliases}

#: Fallback sounding used only when t2m / t850 are absent (a winter morning
#: profile with a shallow surface inversion: T2m = 8 C, T850 = 12 C).
_DEFAULT_T2M_K = 281.15
_DEFAULT_T850_K = 285.15


def _weather_mapping(weather: Any) -> Mapping[str, Any]:
    """Normalise the many accepted weather containers into a name -> series map."""
    if isinstance(weather, Mapping):
        return weather
    if hasattr(weather, "dtype") and getattr(weather.dtype, "names", None):
        return {name: weather[name] for name in weather.dtype.names}  # structured array
    if isinstance(weather, (list, tuple)):
        if len(weather) == 0:
            raise ValueError("weather_hourly_timeseries is empty")
        if isinstance(weather[0], Mapping):
            keys = {k for row in weather for k in row}
            return {k: [row[k] for row in weather] for k in keys}
    raise TypeError(
        "weather_hourly_timeseries must be a mapping of series, a list of hourly "
        "records, or a structured array"
    )


def _coerce_weather(
    weather_hourly_timeseries: Any, n_hours: int, grid: Grid
) -> dict[str, list[np.ndarray]]:
    """Return hourly 2-D fields for u, v, pbl_height, t2m, t850 and precip."""
    mapping = _weather_mapping(weather_hourly_timeseries)

    resolved: dict[str, Any] = {}
    for key in _WEATHER_ALIASES:
        for alias in _WEATHER_ALIASES[key]:
            if alias in mapping:
                resolved[key] = mapping[alias]
                break

    for required in ("u", "v", "pbl_height"):
        if required not in resolved:
            known = sorted(resolved)
            raise KeyError(
                f"weather_hourly_timeseries is missing '{required}' "
                f"(found: {known or 'nothing recognised'})"
            )

    if "t2m" not in resolved or "t850" not in resolved:
        warnings.warn(
            "t2m / t850 not supplied; falling back to T2m=281.15 K, T850=285.15 K so the "
            "inversion strength index is still populated.",
            UserWarning,
            stacklevel=3,
        )
        resolved.setdefault("t2m", _DEFAULT_T2M_K)
        resolved.setdefault("t850", _DEFAULT_T850_K)
    if "precip" not in resolved:
        resolved["precip"] = 0.0

    fields: dict[str, list[np.ndarray]] = {}
    for key, series in resolved.items():
        # A time-invariant scalar is held constant for the whole episode.
        seq = [series] * n_hours if np.ndim(series) == 0 else list(series)
        if len(seq) < n_hours:
            raise ValueError(
                f"weather field '{key}' has {len(seq)} hours, need at least {n_hours}"
            )
        fields[key] = [
            _as_field(seq[t], grid.shape, f"weather['{key}'][{t}]") for t in range(n_hours)
        ]

    for key in ("t2m", "t850"):
        for t, field in enumerate(fields[key]):
            if np.any(field < 200.0) or np.any(field > 350.0):
                raise ValueError(
                    f"weather['{key}'][{t}] is outside 200-350 K; temperatures must be in "
                    "Kelvin so that the inversion strength index is a valid ratio"
                )
    if np.any(np.asarray(fields["pbl_height"][0]) <= 0.0):
        raise ValueError("pbl_height must be strictly positive")
    if "urban_emission" in fields:
        for t, field in enumerate(fields["urban_emission"]):
            if np.any(field < 0.0):
                raise ValueError(f"weather['urban_emission'][{t}] must be non-negative")
    return fields


def urban_footprint(grid: Grid, params: ModelParams, *, per_km2: float = 1.0) -> np.ndarray:
    """Relative distribution of the continuous urban emission source [1].

    A weighted sum of Gaussians over the NCR's urban centres, normalised so the
    peak is exactly 1.0 with the rural background at
    ``params.urban_rural_fraction``.  Multiplying by ``per_km2`` (the peak
    intensity in ug m-2 s-1) therefore yields an emission field whose
    *city-centre* intensity is that number -- the built-up-area flux an
    inventory reports -- rather than a domain average.  The domain mean and the
    peak-to-mean ratio are reported by ``describe_urban_source``.
    """
    sigma = params.urban_footprint_sigma_km * 1000.0
    shape = np.zeros(grid.shape, dtype=np.float64)
    lat = grid.lat2d
    lon = grid.lon2d
    for centre_lat, centre_lon, weight in params.urban_secondary_centres:
        dy = (lat - centre_lat) * DEG2RAD * EARTH_RADIUS_M
        dx = (lon - centre_lon) * DEG2RAD * EARTH_RADIUS_M * np.cos(centre_lat * DEG2RAD)
        shape += weight * np.exp(-0.5 * (dx**2 + dy**2) / sigma**2)
    peak = float(shape.max())
    if peak <= 0.0:
        return np.full(grid.shape, per_km2, dtype=np.float64)
    floor = float(np.clip(params.urban_rural_fraction, 0.0, 1.0))
    shape = floor + (1.0 - floor) * (shape / peak)
    return shape * per_km2


def urban_core_mask(grid: Grid, params: ModelParams, *, threshold: float = 0.5) -> np.ndarray:
    """Boolean mask of the built-up area, from the urban emission footprint.

    Cells at or above ``threshold`` of the peak footprint intensity.  This is the
    region the urban source acts on, and it is also the natural analogue of
    "Delhi's AQI" for grading GRAP, which is invoked on the city's own average
    rather than on the wider NCR.  It is defined by the footprint *shape*, so it
    does not depend on the emission flux being switched on.
    """
    shape = urban_footprint(grid, params)
    peak = float(shape.max())
    return shape >= threshold * peak


def describe_urban_source(grid: Grid, params: ModelParams) -> dict[str, float]:
    """Auditable summary of the urban source: peak, mean and footprint size."""
    shape = urban_footprint(grid, params)
    peak = float(shape.max())
    mean = float(shape.mean())
    built_up_km2 = float(
        np.count_nonzero(urban_core_mask(grid, params)) * grid.cell_area / 1.0e6
    )
    return {
        "peak_ug_m2_s": round(peak, 6),
        "domain_mean_ug_m2_s": round(mean, 6),
        "peak_to_mean": round(peak / mean, 4) if mean > 0.0 else 0.0,
        "built_up_area_km2": round(built_up_km2, 1),
        "peak_intensity_ug_m2_s": round(peak * params.urban_emission_ug_m2_s, 6),
        "domain_mean_intensity_ug_m2_s": round(
            mean * params.urban_emission_ug_m2_s, 6
        ),
    }


def _coerce_fires(fires: Any) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (lat, lon, frp) arrays from the accepted stubble-fire containers."""
    if fires is None:
        empty = np.zeros(0, dtype=np.float64)
        return empty, empty.copy(), empty.copy()

    if isinstance(fires, Mapping):
        lat_key = next((k for k in ("lat", "latitude", "lats") if k in fires), None)
        lon_key = next((k for k in ("lon", "lng", "longitude", "lons") if k in fires), None)
        frp_key = next(
            (k for k in ("frp", "fire_radiative_power", "power", "frp_mw") if k in fires), None
        )
        if lat_key and lon_key and frp_key:
            return (
                np.asarray(fires[lat_key], dtype=np.float64).ravel(),
                np.asarray(fires[lon_key], dtype=np.float64).ravel(),
                np.asarray(fires[frp_key], dtype=np.float64).ravel(),
            )
        raise KeyError("stubble_fire_points mapping needs lat/lon/frp entries")

    if isinstance(fires, (list, tuple)) and len(fires) and isinstance(fires[0], Mapping):
        lat = np.array([row.get("lat", row.get("latitude", np.nan)) for row in fires], float)
        lon = np.array(
            [row.get("lon", row.get("lng", row.get("longitude", np.nan))) for row in fires],
            float,
        )
        frp = np.array(
            [
                row.get("frp", row.get("fire_radiative_power", row.get("power", np.nan)))
                for row in fires
            ],
            dtype=np.float64,
        )
        return lat, lon, frp

    arr = np.asarray(fires, dtype=np.float64)
    if arr.ndim == 2 and arr.shape[1] >= 3:
        return arr[:, 0], arr[:, 1], arr[:, 2]
    if arr.size == 0:
        empty = np.zeros(0, dtype=np.float64)
        return empty, empty.copy(), empty.copy()
    raise ValueError(
        "stubble_fire_points must be an (N, 3) array of (lat, lon, frp), a list of "
        "records with lat/lon/frp, or a mapping of those arrays"
    )


# --------------------------------------------------------------------------
# Transport kernels
# --------------------------------------------------------------------------
def _upwind_flux(
    field: np.ndarray,
    velocity: np.ndarray,
    axis: int,
    inflow: np.ndarray | None = None,
) -> np.ndarray:
    """Upwind mass flux through the faces normal to ``axis`` (shape n -> n+1).

    Face ``j`` separates cell ``j-1`` and cell ``j``.  Face-normal velocities
    are arithmetic means of the adjacent cell values.  The domain-edge ghost
    cells hold the prescribed ``inflow`` profile, which the ``where`` below
    therefore selects only on faces where the flow points into the domain; on
    outflow faces the zero-order extrapolated interior value is used instead.
    """
    n = field.shape[axis]
    idx_left = np.clip(np.arange(n + 1) - 1, 0, n - 1)
    idx_right = np.clip(np.arange(n + 1), 0, n - 1)
    left = np.take(field, idx_left, axis=axis)
    right = np.take(field, idx_right, axis=axis)
    if inflow is not None:
        low_faces = [slice(None)] * field.ndim
        low_faces[axis] = 0
        high_faces = [slice(None)] * field.ndim
        high_faces[axis] = n
        left[tuple(low_faces)] = inflow
        right[tuple(high_faces)] = inflow
    face_vel = 0.5 * (np.take(velocity, idx_left, axis=axis) + np.take(velocity, idx_right, axis=axis))
    return np.where(face_vel >= 0.0, face_vel * left, face_vel * right)


def _boundary_flux_mass(
    fx: np.ndarray,
    fy: np.ndarray,
    dt: float,
    dx: float,
    dy: float,
    depth: np.ndarray | None = None,
) -> float:
    """Mass entering the domain through its edges over ``dt`` [ug].

    ``fx`` / ``fy`` are face fluxes from :func:`_upwind_flux`, positive along
    +x / +y.  Face index 0 is the *west* (or south) edge, where a positive flux
    points into the domain; the last face is the east (or north) edge, where a
    positive flux points out of it.  A face carrying mass inward contributes
    ``|flux| * face_length`` per second, so zonal faces are weighted by ``dy``
    and meridional ones by ``dx``.

    The mixed layer is carried as a *concentration*, whose face flux therefore
    has units of ug m-2 s-1: converting it to mass requires multiplying by the
    local mixed-layer depth [m], supplied as ``depth``.  Pass ``None`` only for
    a field that is already an areal mass.
    """
    entering_x = np.maximum(fx[:, 0], 0.0) + np.maximum(-fx[:, -1], 0.0)
    entering_y = np.maximum(fy[0, :], 0.0) + np.maximum(-fy[-1, :], 0.0)
    if depth is not None:
        entering_x = np.maximum(fx[:, 0], 0.0) * depth[:, 0] + np.maximum(
            -fx[:, -1], 0.0
        ) * depth[:, -1]
        entering_y = np.maximum(fy[0, :], 0.0) * depth[0, :] + np.maximum(
            -fy[-1, :], 0.0
        ) * depth[-1, :]
    return dt * (
        float(np.sum(entering_x)) * dy + float(np.sum(entering_y)) * dx
    )


def _advect_upwind(
    field: np.ndarray,
    u: np.ndarray,
    v: np.ndarray,
    dt: float,
    dx: float,
    dy: float,
    inflow: np.ndarray | None = None,
    depth: np.ndarray | None = None,
) -> tuple[np.ndarray, float]:
    """Conservative first-order upwind advection of ``field`` by (u, v).

    ``inflow`` is a 2-D field whose upstream edges supply the Dirichlet inflow
    values (west column for the zonal faces, south row for the meridional).
    Passing ``None`` falls back to zero-gradient inflow.

    Returns ``(advanced_field, boundary_inflow_mass)`` where the second element
    is the total mass [ug] that entered through the Dirichlet edges.  Splitting
    the net boundary exchange into its inward and outward parts is what lets a
    reduced model separate the *supply* side (which does not depend on the
    interior state) from the *retention* side (which does).
    """
    inflow_x = None if inflow is None else inflow[:, 0]
    inflow_y = None if inflow is None else inflow[0, :]
    fx = _upwind_flux(field, u, axis=1, inflow=inflow_x)
    fy = _upwind_flux(field, v, axis=0, inflow=inflow_y)
    divergence = (fx[:, 1:] - fx[:, :-1]) / dx + (fy[1:, :] - fy[:-1, :]) / dy
    return field - dt * divergence, _boundary_flux_mass(fx, fy, dt, dx, dy, depth)


def _diffuse_gaussian(field: np.ndarray, k_diff: float, dt: float, grid: Grid) -> np.ndarray:
    """Green's-function diffusion: anisotropic Gaussian, sigma = sqrt(2 K dt)."""
    sigma_x = math.sqrt(2.0 * k_diff * dt) / grid.dx
    sigma_y = math.sqrt(2.0 * k_diff * dt) / grid.dy
    if sigma_x < 1.0e-9 and sigma_y < 1.0e-9:
        return field
    return gaussian_filter(field, sigma=(sigma_y, sigma_x), mode="nearest")


def _diffuse_laplacian(
    field: np.ndarray, k_diff: np.ndarray | float, dt: float, grid: Grid
) -> np.ndarray:
    """Explicit 5-point Laplacian diffusion (Fourier-limited, zero-flux walls)."""
    padded = np.pad(field, 1, mode="edge")
    laplacian = (padded[1:-1, 2:] - 2.0 * padded[1:-1, 1:-1] + padded[1:-1, :-2]) / grid.dx**2
    laplacian += (padded[2:, 1:-1] - 2.0 * padded[1:-1, 1:-1] + padded[:-2, 1:-1]) / grid.dy**2
    return field + dt * k_diff * laplacian


def _horizontal_diffusivity(
    u: np.ndarray, v: np.ndarray, grid: Grid, params: ModelParams
) -> np.ndarray:
    """Smagorinsky-type horizontal eddy diffusivity K = (Cs delta)^2 |S| [m2/s]."""
    dudx = np.gradient(u, grid.dx, axis=1)
    dudy = np.gradient(u, grid.dy, axis=0)
    dvdx = np.gradient(v, grid.dx, axis=1)
    dvdy = np.gradient(v, grid.dy, axis=0)
    strain = np.sqrt(2.0 * (dudx**2 + dvdy**2) + (dudy + dvdx) ** 2)
    delta = math.sqrt(grid.dx * grid.dy)
    k_field = (params.smagorinsky_coeff * delta) ** 2 * strain
    return np.clip(k_field, params.k_min, params.k_max)


# --------------------------------------------------------------------------
# CFL diagnostics
# --------------------------------------------------------------------------
@dataclass
class CFLDiagnostics:
    """Stability report for one integration step."""

    substeps: int
    dt_substep: float
    courant: float
    fourier: float
    advection_stable: bool
    diffusion_stable: bool
    capped: bool
    scheme: str
    sigma_cells: float = float("nan")

    @property
    def diffusion_resolved(self) -> bool:
        """True when the chosen diffusion operator resolves its own width.

        The explicit Laplacian is always resolvable; the Gaussian kernel needs
        sigma >> dx to represent sqrt(2 K dt) on the grid.
        """
        if self.scheme == "laplacian":
            return True
        return bool(np.isfinite(self.sigma_cells) and self.sigma_cells >= GAUSSIAN_MIN_SIGMA_CELLS)

    def summary(self) -> str:
        flag = "capped" if self.capped else "ok"
        extra = ""
        if self.scheme == "gaussian":
            extra = f", sigma={self.sigma_cells:.2f} cells"
        return (
            f"{self.substeps} substeps (dt={self.dt_substep:.1f} s), "
            f"Courant={self.courant:.3f}, Fourier={self.fourier:.3f}{extra}, "
            f"advection_stable={self.advection_stable}, "
            f"diffusion_stable={self.diffusion_stable}, {flag}"
        )


def _required_substeps(
    u: np.ndarray,
    v: np.ndarray,
    k_field: np.ndarray,
    dt: float,
    grid: Grid,
    params: ModelParams,
    diffusion_scheme: str,
) -> CFLDiagnostics:
    """Choose the number of sub-steps that satisfies the CFL / Fourier limits."""
    speed = max(float(np.max(np.abs(u))), float(np.max(np.abs(v))), 0.0)
    dt_adv = math.inf
    if speed > 0.0:
        dt_adv = params.cfl_target * min(grid.dx, grid.dy) / speed

    k_max = float(np.max(k_field))
    if diffusion_scheme == "laplacian" and k_max > 0.0:
        inverse_scale = 1.0 / grid.dx**2 + 1.0 / grid.dy**2
        dt_diff = params.fourier_target / (k_max * inverse_scale)
    else:
        dt_diff = math.inf

    limiting = min(dt_adv, dt_diff)
    substeps = 1 if not math.isfinite(limiting) else int(math.ceil(dt / limiting))
    capped = substeps > params.max_substeps
    substeps = int(min(max(substeps, 1), params.max_substeps))

    dt_sub = dt / substeps
    courant = speed * dt_sub / min(grid.dx, grid.dy)
    fourier = k_max * dt_sub * (1.0 / grid.dx**2 + 1.0 / grid.dy**2)
    sigma_cells = math.sqrt(2.0 * k_max * dt_sub) / min(grid.dx, grid.dy)
    return CFLDiagnostics(
        substeps=substeps,
        dt_substep=dt_sub,
        courant=courant,
        fourier=fourier,
        advection_stable=courant <= params.cfl_target + 1.0e-9,
        diffusion_stable=(
            True if diffusion_scheme == "gaussian" else fourier <= params.fourier_target + 1.0e-9
        ),
        capped=capped,
        scheme=diffusion_scheme,
        sigma_cells=sigma_cells,
    )


def check_cfl(
    u: Any,
    v: Any,
    dt_seconds: float,
    *,
    grid: Grid | None = None,
    diffusivity: Any = None,
    params: ModelParams | None = None,
) -> CFLDiagnostics:
    """Public stability check: required sub-steps and Courant/Fourier numbers.

    ``u`` and ``v`` may be scalars, 1-D profiles or 2-D fields; ``diffusivity``
    may be a scalar or field and defaults to ``params.k_min``.
    """
    grid = grid or delhi_ncr_grid()
    params = params or ModelParams()
    u_field = _as_field(u, grid.shape, "u")
    v_field = _as_field(v, grid.shape, "v")
    if diffusivity is None:
        k_field = np.full(grid.shape, params.k_min)
    else:
        k_field = _as_field(diffusivity, grid.shape, "diffusivity")
    return _required_substeps(
        u_field, v_field, k_field, float(dt_seconds), grid, params, params.diffusion_scheme
    )


# --------------------------------------------------------------------------
# Aerosol-radiation feedback
# --------------------------------------------------------------------------
def _aerosol_feedback(
    column_mass: np.ndarray, pbl_synoptic: np.ndarray, params: ModelParams
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Two-way feedback: column AOD -> extinction -> reduced synoptic PBL height.

    Returns ``(extinction, suppression_fraction, effective_pbl)``.  The
    extinction is normalised by its value at ``params.pbl_suppression_pm25`` so
    that the suppression saturates exactly at ``params.max_pbl_suppression``
    (40 % by default) at that concentration, and stays there above it.
    """
    aod = params.mass_extinction_m2_per_g * 1.0e-6 * np.maximum(column_mass, 0.0)
    extinction = 1.0 - np.exp(-aod)

    aod_reference = (
        params.mass_extinction_m2_per_g
        * 1.0e-6
        * params.pbl_suppression_pm25
        * np.maximum(pbl_synoptic, params.pbl_min_m)
    )
    reference = 1.0 - np.exp(-aod_reference)
    shape = np.clip(extinction / np.maximum(reference, 1.0e-12), 0.0, 1.0)
    suppression = params.max_pbl_suppression * shape
    effective_pbl = np.maximum(
        pbl_synoptic * (1.0 - suppression), params.pbl_min_m
    )
    return extinction, suppression, effective_pbl


# --------------------------------------------------------------------------
# Stubble-burning emissions
# --------------------------------------------------------------------------
def _diurnal_frp_shape(hours_local: np.ndarray, params: ModelParams) -> np.ndarray:
    """Relative fire activity (0-1) with an afternoon peak, wrapped cyclically."""
    phase = np.mod(hours_local - params.frp_peak_hour_local + 12.0, 24.0) - 12.0
    peak = np.exp(-0.5 * (phase / params.frp_peak_width_h) ** 2)
    return params.frp_night_fraction + (1.0 - params.frp_night_fraction) * peak


def _plume_rise_m(frp_mw: float, wind_speed: float, params: ModelParams) -> float:
    """Briggs buoyant plume rise [m] evaluated at a fixed downwind distance."""
    if frp_mw <= 0.0:
        return 0.0
    buoyancy_flux = params.buoyancy_coefficient * frp_mw * 1.0e6  # m4/s3
    u_eff = max(wind_speed, params.plume_min_wind_speed)
    rise = (
        1.6
        * buoyancy_flux ** (1.0 / 3.0)
        * params.plume_rise_reference_distance_m ** (2.0 / 3.0)
        / u_eff
    )
    return float(np.clip(rise, 0.0, params.plume_rise_max_m))


class _FireField:
    """Maps stubble-fire coordinates onto the grid and injects their plumes.

    Each fire is deposited as an anisotropic Gaussian footprint elongated along
    the local wind (sigma_along x sigma_cross), which keeps the injection
    resolvable by the upwind advection scheme.  The mass is split between the
    mixed layer and an aloft reservoir using the plume rise relative to the
    synoptic PBL depth.
    """

    def __init__(self, fires: Any, grid: Grid, params: ModelParams) -> None:
        self.grid = grid
        self.params = params
        lat, lon, frp = _coerce_fires(fires)
        valid = np.isfinite(lat) & np.isfinite(lon) & np.isfinite(frp) & (frp > 0.0)
        lat, lon, frp = lat[valid], lon[valid], frp[valid]

        centers = grid.cell_centers_km()
        lat0 = float(grid.lat.mean())
        lon0 = float(grid.lon.mean())
        x_km = (lon - lon0) * 111.320 * math.cos(lat0 * DEG2RAD)
        y_km = (lat - lat0) * 110.574

        if x_km.size:
            tree = cKDTree(centers)
            distance, index = tree.query(np.column_stack((x_km, y_km)))
            keep = distance <= params.max_fire_distance_km
            self.iy = (index[keep] // grid.shape[1]).astype(np.intp)
            self.ix = (index[keep] % grid.shape[1]).astype(np.intp)
            self.frp = frp[keep]
            self.n_dropped = int(np.count_nonzero(~keep))
        else:
            self.iy = np.zeros(0, dtype=np.intp)
            self.ix = np.zeros(0, dtype=np.intp)
            self.frp = np.zeros(0)
            self.n_dropped = 0

        self.n_fires = int(self.frp.size)
        self._build_kernel()
        self._emission_rate_ug_per_s = self.frp * 1.0e6 / (
            params.fire_heat_yield_mj_per_kg * 1.0e6
        ) * params.pm25_emission_factor_g_per_kg * 1.0e6

    def _build_kernel(self) -> None:
        """Pre-compute the rotated Gaussian footprint offsets [m]."""
        params, grid = self.params, self.grid
        radius_x = int(math.ceil(3.0 * params.plume_sigma_along_m / grid.dx))
        radius_y = int(math.ceil(3.0 * params.plume_sigma_cross_m / grid.dy))
        offset_y, offset_x = np.meshgrid(
            np.arange(-radius_y, radius_y + 1), np.arange(-radius_x, radius_x + 1), indexing="ij"
        )
        self._off_y = offset_y.ravel()
        self._off_x = offset_x.ravel()
        self._x_m = offset_x.ravel() * grid.dx
        self._y_m = offset_y.ravel() * grid.dy

    def _kernel_weights(self, fire_slice: slice, u_local: np.ndarray, v_local: np.ndarray) -> np.ndarray:
        """Normalised footprint weights, shape (n_selected, n_kernel_points)."""
        params = self.params
        speed = np.hypot(u_local, v_local)
        east = np.where(speed > 1.0e-6, u_local / np.maximum(speed, 1.0e-12), 1.0)
        north = np.where(speed > 1.0e-6, v_local / np.maximum(speed, 1.0e-12), 0.0)
        along = self._x_m[None, :] * east[:, None] + self._y_m[None, :] * north[:, None]
        cross = -self._x_m[None, :] * north[:, None] + self._y_m[None, :] * east[:, None]
        weights = np.exp(
            -0.5
            * (
                (along / params.plume_sigma_along_m) ** 2
                + (cross / params.plume_sigma_cross_m) ** 2
            )
        )
        normaliser = np.maximum(weights.sum(axis=1, keepdims=True), 1.0e-12)
        return weights / normaliser

    def injection(
        self,
        hour_local: float,
        u_field: np.ndarray,
        v_field: np.ndarray,
        pbl_synoptic: np.ndarray,
        params: ModelParams,
    ) -> tuple[np.ndarray, np.ndarray]:
        """Areal injection rates [ug m-2 s-1] into (mixed layer, aloft reservoir)."""
        shape = self.grid.shape
        e_mix = np.zeros(shape)
        e_aloft = np.zeros(shape)
        if self.n_fires == 0:
            return e_mix, e_aloft

        activity = float(_diurnal_frp_shape(np.array([hour_local]), params)[0])
        u_local = u_field[self.iy, self.ix]
        v_local = v_field[self.iy, self.ix]
        weights = self._kernel_weights(slice(None), u_local, v_local)

        speed = np.hypot(u_local, v_local)
        pbl_local = pbl_synoptic[self.iy, self.ix]
        rise = np.array(
            [_plume_rise_m(f, s, params) for f, s in zip(self.frp, speed)], dtype=np.float64
        )
        trapped = np.clip(pbl_local / np.maximum(pbl_local + rise, 1.0e-9), 0.0, 1.0)

        rate = self._emission_rate_ug_per_s * activity  # ug/s per fire
        mass_mix = (rate * trapped)[:, None] * weights  # (n_fires, n_kernel)
        mass_aloft = (rate * (1.0 - trapped))[:, None] * weights

        idx_y = self.iy[:, None] + self._off_y[None, :]
        idx_x = self.ix[:, None] + self._off_x[None, :]
        inside = (
            (idx_y >= 0) & (idx_y < shape[0]) & (idx_x >= 0) & (idx_x < shape[1])
        )
        cell_area = self.grid.cell_area
        np.add.at(e_mix, (idx_y[inside], idx_x[inside]), mass_mix[inside] / cell_area)
        np.add.at(e_aloft, (idx_y[inside], idx_x[inside]), mass_aloft[inside] / cell_area)
        return e_mix, e_aloft


# --------------------------------------------------------------------------
# Air quality index (CPCB PM2.5 sub-index)
# --------------------------------------------------------------------------
def aqi_value_from_pm25(pm25: Any) -> np.ndarray:
    """Piecewise-linear CPCB PM2.5 sub-index (0-500) from concentration [ug/m3]."""
    values = np.asarray(pm25, dtype=np.float64)
    return np.clip(np.interp(values, AQI_PM25_KNOTS, AQI_INDEX_KNOTS), 0.0, 500.0)


def aqi_category_from_pm25(pm25: Any) -> np.ndarray:
    """CPCB AQI class labels: Good / Satisfactory / Moderate / Poor / Very Poor / Severe."""
    values = np.asarray(pm25, dtype=np.float64)
    classes = np.digitize(values, AQI_PM25_BOUNDS, right=True)
    return AQI_CATEGORIES[np.clip(classes, 0, AQI_CATEGORIES.size - 1)]


def _trailing_mean(values: np.ndarray, window: int) -> np.ndarray:
    """Causal moving average along axis 0 (partial windows at the start)."""
    n = values.shape[0]
    window = int(max(1, min(window, n)))
    cumulative = np.cumsum(values, axis=0)
    padded = np.concatenate([np.zeros_like(cumulative[:1]), cumulative], axis=0)
    upper = np.arange(n) + 1
    lower = np.maximum(upper - window, 0)
    counts = (upper - lower).reshape((n,) + (1,) * (values.ndim - 1))
    return (padded[upper] - padded[lower]) / counts


# --------------------------------------------------------------------------
# Transport step
# --------------------------------------------------------------------------
def _transport_step(
    concentration: np.ndarray,
    aloft_mass: np.ndarray,
    u: np.ndarray,
    v: np.ndarray,
    k_field: np.ndarray,
    dt: float,
    substeps: int,
    grid: Grid,
    params: ModelParams,
    inflow: np.ndarray | None = None,
    depth: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray, float]:
    """Advance ground concentration and aloft areal mass by ``dt``.

    The lofted reservoir is carried as an *excess* above the mixed layer, so its
    lateral inflow is clean (zero excess) while its outflow is zero-gradient.

    Returns ``(concentration, aloft_mass, boundary_inflow_ug)``, the last being
    the mass supplied through the Dirichlet edges over the whole hour.
    """
    dt_sub = dt / substeps
    u_aloft = u * params.aloft_wind_factor
    v_aloft = v * params.aloft_wind_factor
    k_mean = float(np.mean(k_field))
    aloft_inflow = np.zeros_like(aloft_mass)
    boundary_inflow_ug = 0.0
    # The depth that converts a concentration boundary flux into mass is the one
    # the concentration was defined on, i.e. the mixed-layer depth entering the
    # step; the aloft reservoir is already an areal mass.
    mixed_depth = depth

    for _ in range(substeps):
        concentration, supplied = _advect_upwind(
            concentration,
            u,
            v,
            dt_sub,
            grid.dx,
            grid.dy,
            inflow=inflow,
            depth=mixed_depth,
        )
        boundary_inflow_ug += supplied
        aloft_mass, _ = _advect_upwind(
            aloft_mass, u_aloft, v_aloft, dt_sub, grid.dx, grid.dy, inflow=aloft_inflow
        )
        if params.diffusion_scheme == "gaussian":
            concentration = _diffuse_gaussian(concentration, k_mean, dt_sub, grid)
            aloft_mass = _diffuse_gaussian(aloft_mass, k_mean, dt_sub, grid)
        else:
            concentration = _diffuse_laplacian(concentration, k_field, dt_sub, grid)
            aloft_mass = _diffuse_laplacian(aloft_mass, k_field, dt_sub, grid)
        np.maximum(concentration, 0.0, out=concentration)
        np.maximum(aloft_mass, 0.0, out=aloft_mass)
    return concentration, aloft_mass, boundary_inflow_ug


def _column_content(mixed_mass: np.ndarray, aloft_mass: np.ndarray, grid: Grid) -> float:
    """Total PM2.5 column mass held by the domain [ug].

    Both reservoirs are expressed as areal mass [ug/m2], which makes the
    budget independent of the PBL depth and therefore auditable across the
    diurnal compression cycle.
    """
    return float(np.sum(mixed_mass) + np.sum(aloft_mass)) * grid.cell_area


# --------------------------------------------------------------------------
# Driver
# --------------------------------------------------------------------------
def simulate_72h(
    init_pm25_grid: Any,
    weather_hourly_timeseries: Any,
    stubble_fire_points: Any,
    *,
    hours: int | None = None,
    params: ModelParams | None = None,
    grid: Grid | None = None,
) -> dict[str, Any]:
    """Run the coupled 72-h PM2.5 simulation over Delhi NCR.

    Parameters
    ----------
    init_pm25_grid
        Initial ground-level PM2.5 [ug/m3]: a 50 x 50 array (or a scalar / 1-D
        profile, which is broadcast).
    weather_hourly_timeseries
        Hourly meteorology.  Keys (with common aliases): ``u``, ``v`` [m/s],
        ``pbl_height`` [m], optionally ``t2m`` / ``t850`` [K], ``precip``
        [mm/h] and ``inflow`` [ug/m3] for the lateral inflow concentration
        (defaulting to ``params.inflow_pm25``).  Accepts a mapping of series
        (each a scalar held constant, or a 1-D / 2-D field per hour, length
        >= hours), a list of per-hour records, or a structured array.
    stubble_fire_points
        Active fire detections: ``(N, 3)`` array of (lat, lon, FRP[MW]), a list
        of records with lat/lon/frp keys, or a mapping of such arrays.

    Returns
    -------
    dict
        Hourly grids with leading time axis of length ``hours``:
        ``pm25`` (ug/m3), ``pbl_height`` (m, effective/feedback),
        ``pbl_height_synoptic``, ``inversion_strength_index`` (T2m/T850 in K),
        ``aqi_category`` (CPCB class of the 24-h mean, per grid cell), plus
        ``pm25_24h_mean``, ``aqi_value``, ``aqi_value_instant``,
        ``aqi_category_instant``, ``aerosol_extinction``,
        ``pbl_suppression_fraction``, ``aloft_column_mass`` (ug/m2),
        ``stubble_emission`` (ug/m2/s), ``time_hours``, ``grid``, ``params``
        and ``diagnostics`` (CFL report, fire inventory and a closed
        ``mass_budget_tonnes`` covering every source and sink).
    """
    params = params or ModelParams()
    grid = grid or delhi_ncr_grid()
    n_hours = int(params.hours if hours is None else hours)
    dt = float(params.dt_seconds)

    initial = _coerce_initial(init_pm25_grid, grid)
    weather = _coerce_weather(weather_hourly_timeseries, n_hours, grid)
    fires = _FireField(stubble_fire_points, grid, params)

    shape = grid.shape
    concentration = np.maximum(initial, 0.0)
    pbl_previous = np.maximum(weather["pbl_height"][0], params.pbl_min_m)
    mixed_mass = concentration * pbl_previous  # ug/m2 in the mixed layer
    aloft_mass = np.zeros(shape)  # ug/m2 above the mixed layer
    non_finite_events = 0

    pm25_out = np.empty((n_hours,) + shape)
    pbl_out = np.empty((n_hours,) + shape)
    pbl_syn_out = np.empty((n_hours,) + shape)
    isi_out = np.empty((n_hours,) + shape)
    extinction_out = np.empty((n_hours,) + shape)
    suppression_out = np.empty((n_hours,) + shape)
    aloft_out = np.empty((n_hours,) + shape)
    emission_out = np.empty((n_hours,) + shape)

    # Per-hour diagnostics.  ``budget`` below stays cumulative; these arrays
    # record the same terms hour by hour, plus the masses entering and leaving
    # the transport step and the mass supplied through the Dirichlet edges.  A
    # reduced-order (domain-mean) model can be identified from a single run with
    # them, because transport retention and boundary supply are the only
    # operators it cannot recompute from closed forms.
    # Zero-initialised rather than empty: several entries stay at zero when the
    # corresponding process is switched off (e.g. the urban source), and a
    # diagnostic that silently reports uninitialised memory is worse than none.
    hourly = {
        name: np.zeros(n_hours)
        for name in (
            "mix_mass_in_ug",
            "aloft_mass_in_ug",
            "mix_mass_out_ug",
            "aloft_mass_out_ug",
            "mix_mass_transport_ug",
            "aloft_mass_transport_ug",
            "boundary_inflow_ug",
            "stubble_mix_ug",
            "stubble_aloft_ug",
            "urban_mix_ug",
            "deposited_ug",
            "scavenged_ug",
            "entrained_ug",
            "aloft_drain_ug",
            "compression_ug",
        )
    }

    substeps_total = 0
    min_substeps = params.max_substeps
    max_courant = 0.0
    max_fourier = 0.0
    cfl_capped = False
    diffusion_underresolved = False
    budget = {
        "emitted": 0.0,
        "urban_emitted": 0.0,
        "deposited": 0.0,
        "scavenged": 0.0,
        "entrained": 0.0,
        "advected": 0.0,
        "aloft_drain": 0.0,
        "compression": 0.0,
    }
    content_initial = _column_content(mixed_mass, aloft_mass, grid)

    urban_from_weather = "urban_emission" in weather
    if urban_from_weather:
        urban_fields: list[np.ndarray] | None = weather["urban_emission"]
        urban_peak_intensity = float(np.max(urban_fields[0])) if urban_fields else 0.0
    elif params.urban_emission_ug_m2_s > 0.0:
        urban_fields = [
            urban_footprint(grid, params, per_km2=params.urban_emission_ug_m2_s)
        ] * n_hours
        urban_peak_intensity = float(params.urban_emission_ug_m2_s)
    else:
        urban_fields = None
        urban_peak_intensity = 0.0

    for t in range(n_hours):
        u = weather["u"][t]
        v = weather["v"][t]
        pbl_synoptic = np.maximum(weather["pbl_height"][t], params.pbl_min_m)
        t2m = weather["t2m"][t]
        t850 = weather["t850"][t]
        precip = np.maximum(weather["precip"][t], 0.0)
        hour_local = (params.start_hour_local + t) % 24.0
        inflow = (
            weather["inflow"][t]
            if "inflow" in weather
            else np.full(shape, params.inflow_pm25)
        )
        urban_field = None if urban_fields is None else urban_fields[t]

        concentration = np.maximum(concentration, 0.0)

        # (d) two-way feedback, evaluated explicitly on the entering state.
        column_mass = concentration * pbl_synoptic + aloft_mass
        extinction, suppression, pbl_effective = _aerosol_feedback(
            column_mass, pbl_synoptic, params
        )

        # (a)/(b) advection + turbulent diffusion with CFL-limited sub-stepping.
        k_field = _horizontal_diffusivity(u, v, grid, params)
        cfl = _required_substeps(u, v, k_field, dt, grid, params, params.diffusion_scheme)
        cfl_capped = cfl_capped or cfl.capped
        substeps_total += cfl.substeps
        min_substeps = min(min_substeps, cfl.substeps)
        max_courant = max(max_courant, cfl.courant)
        max_fourier = max(max_fourier, cfl.fourier)
        if cfl.capped:
            warnings.warn(
                f"hour {t}: required sub-steps exceed max_substeps="
                f"{params.max_substeps}; the CFL/Fourier limits are violated "
                f"({cfl.summary()})",
                RuntimeWarning,
                stacklevel=2,
            )
        if not cfl.diffusion_resolved and not diffusion_underresolved:
            diffusion_underresolved = True
            warnings.warn(
                f"hour {t}: the Gaussian diffusion kernel is under-resolved "
                f"(sigma={cfl.sigma_cells:.2f} cells < {GAUSSIAN_MIN_SIGMA_CELLS}); it "
                "will under-diffuse. Use params.diffusion_scheme='laplacian'.",
                RuntimeWarning,
                stacklevel=2,
            )

        snapshot = _column_content(mixed_mass, aloft_mass, grid)
        hourly["mix_mass_in_ug"][t] = snapshot - float(np.sum(aloft_mass)) * grid.cell_area
        hourly["aloft_mass_in_ug"][t] = float(np.sum(aloft_mass)) * grid.cell_area
        budget_hour_start = dict(budget)
        concentration, aloft_mass, boundary_inflow_ug = _transport_step(
            concentration,
            aloft_mass,
            u,
            v,
            k_field,
            dt,
            cfl.substeps,
            grid,
            params,
            inflow=inflow,
            depth=pbl_previous,
        )
        mixed_mass = concentration * pbl_previous
        budget["advected"] += _column_content(mixed_mass, aloft_mass, grid) - snapshot
        hourly["mix_mass_transport_ug"][t] = float(np.sum(mixed_mass)) * grid.cell_area
        hourly["aloft_mass_transport_ug"][t] = float(np.sum(aloft_mass)) * grid.cell_area
        hourly["boundary_inflow_ug"][t] = boundary_inflow_ug

        # Losses: dry deposition (flux v_d C is PBL-depth independent) and
        # below-cloud wet scavenging of the whole column.
        snapshot = _column_content(mixed_mass, aloft_mass, grid)
        deposition = np.exp(-params.dry_deposition_velocity * dt / pbl_effective)
        mixed_mass = mixed_mass * deposition
        budget["deposited"] += _column_content(mixed_mass, aloft_mass, grid) - snapshot

        snapshot = _column_content(mixed_mass, aloft_mass, grid)
        scavenging = np.exp(-params.wet_scavenging_coeff * np.power(precip, 0.7) * dt)
        mixed_mass = mixed_mass * scavenging
        aloft_mass = aloft_mass * scavenging
        budget["scavenged"] += _column_content(mixed_mass, aloft_mass, grid) - snapshot

        # Entrainment of free-tropospheric air as the mixed layer deepens: the
        # newly incorporated dH of air adds exactly dH * C_ft of column mass.
        # The associated dilution follows from the mass-conserving compression
        # at the end of the hour and is deliberately not double counted here.
        # A slow exponential relaxation to the background keeps a floor on the
        # free-troposphere exchange; unlike a w_e (C_ft - C) flux it can never
        # overshoot into negative mass during rapid morning growth.
        snapshot = _column_content(mixed_mass, aloft_mass, grid)
        growth = np.maximum(pbl_effective - pbl_previous, 0.0)
        mixed_mass = mixed_mass + growth * params.background_pm25
        exchange_velocity = growth / dt + params.entrainment_velocity_min
        relaxation = 1.0 - np.exp(-params.entrainment_velocity_min * dt / pbl_effective)
        mixed_mass = mixed_mass * (1.0 - relaxation) + (
            params.background_pm25 * pbl_effective * relaxation
        )
        budget["entrained"] += _column_content(mixed_mass, aloft_mass, grid) - snapshot

        # Lofted smoke drains back into the mixed layer (faster when convective).
        snapshot = _column_content(mixed_mass, aloft_mass, grid)
        if params.aloft_entrainment_hours > 0.0:
            tau = params.aloft_entrainment_hours / (
                1.0 + exchange_velocity / params.entrainment_velocity_reference
            )
            drain_fraction = 1.0 - np.exp(-dt / tau)
        else:
            drain_fraction = 1.0
        drained = aloft_mass * drain_fraction
        aloft_mass = aloft_mass - drained
        mixed_mass = mixed_mass + drained
        budget["aloft_drain"] += _column_content(mixed_mass, aloft_mass, grid) - snapshot

        # (c) stubble plume injection.
        snapshot = _column_content(mixed_mass, aloft_mass, grid)
        emission_mix, emission_aloft = fires.injection(
            hour_local, u, v, pbl_synoptic, params
        )
        mixed_mass = mixed_mass + emission_mix * dt
        aloft_mass = aloft_mass + emission_aloft * dt
        budget["emitted"] += _column_content(mixed_mass, aloft_mass, grid) - snapshot
        hourly["stubble_mix_ug"][t] = float(np.sum(emission_mix)) * grid.cell_area * dt
        hourly["stubble_aloft_ug"][t] = float(np.sum(emission_aloft)) * grid.cell_area * dt

        # (c') continuous urban area source: traffic, industry, residential and
        # waste emissions from the NCR's own built-up area.  Off unless a flux
        # is configured, so the default run is the stubble-only model.
        if urban_field is not None:
            snapshot = _column_content(mixed_mass, aloft_mass, grid)
            mixed_mass = mixed_mass + urban_field * dt
            budget["urban_emitted"] += (
                _column_content(mixed_mass, aloft_mass, grid) - snapshot
            )
            hourly["urban_mix_ug"][t] = float(np.sum(urban_field)) * grid.cell_area * dt

        # (e) inversion trapping: ground concentration is column mass over the
        # feedback-reduced PBL depth, so column mass is conserved exactly.
        snapshot = _column_content(mixed_mass, aloft_mass, grid)
        concentration = mixed_mass / pbl_effective
        if not np.all(np.isfinite(concentration)):
            non_finite_events += 1
            warnings.warn(
                f"hour {t}: non-finite concentration encountered; sanitised to zero",
                RuntimeWarning,
                stacklevel=2,
            )
            concentration = np.nan_to_num(concentration, nan=0.0, posinf=0.0, neginf=0.0)
        concentration = np.maximum(concentration, 0.0)
        mixed_mass = concentration * pbl_effective
        budget["compression"] += _column_content(mixed_mass, aloft_mass, grid) - snapshot

        hourly["mix_mass_out_ug"][t] = float(np.sum(mixed_mass)) * grid.cell_area
        hourly["aloft_mass_out_ug"][t] = float(np.sum(aloft_mass)) * grid.cell_area
        pm25_out[t] = concentration
        pbl_out[t] = pbl_effective
        pbl_syn_out[t] = pbl_synoptic
        isi_out[t] = t2m / t850
        extinction_out[t] = extinction
        suppression_out[t] = suppression
        aloft_out[t] = aloft_mass
        emission_out[t] = emission_mix + emission_aloft

        hourly["deposited_ug"][t] = budget["deposited"] - budget_hour_start["deposited"]
        hourly["scavenged_ug"][t] = budget["scavenged"] - budget_hour_start["scavenged"]
        hourly["entrained_ug"][t] = budget["entrained"] - budget_hour_start["entrained"]
        hourly["aloft_drain_ug"][t] = (
            budget["aloft_drain"] - budget_hour_start["aloft_drain"]
        )
        hourly["compression_ug"][t] = (
            budget["compression"] - budget_hour_start["compression"]
        )

        pbl_previous = pbl_effective

    # CPCB AQI is defined on 24-h mean PM2.5; also report the instantaneous class.
    mean_pm25 = _trailing_mean(pm25_out, params.aqi_averaging_window_h)
    aqi_value = aqi_value_from_pm25(mean_pm25)

    content_final = _column_content(mixed_mass, aloft_mass, grid)
    budget_residual = content_final - content_initial - sum(budget.values())

    diagnostics = {
        "grid": grid.describe(),
        "params": params,
        "cfl": {
            "substeps_total": substeps_total,
            "substeps_mean": substeps_total / n_hours,
            "substeps_min": min_substeps,
            "max_courant": max_courant,
            "max_fourier": max_fourier,
            "cfl_capped": cfl_capped,
            "cfl_target": params.cfl_target,
            "fourier_target": params.fourier_target,
            "diffusion_scheme": params.diffusion_scheme,
            "diffusion_underresolved": diffusion_underresolved,
            "stable": bool(
                max_courant <= params.cfl_target + 1.0e-9
                and (
                    params.diffusion_scheme == "gaussian"
                    or max_fourier <= params.fourier_target + 1.0e-9
                )
            ),
        },
        "fires": {
            "n_used": fires.n_fires,
            "n_dropped_out_of_domain": fires.n_dropped,
            "total_frp_mw": float(np.sum(fires.frp)),
        },
        "urban": {
            "source": (
                "weather['urban_emission']"
                if urban_from_weather
                else ("params.urban_emission_ug_m2_s" if urban_fields is not None else "disabled")
            ),
            "peak_intensity_ug_m2_s": round(urban_peak_intensity, 6),
            "tonnes": float(np.sum(hourly["urban_mix_ug"])) * 1.0e-12,
            **describe_urban_source(grid, params),
        },
        "hourly": hourly,
        "pm25_final_mean": float(np.mean(pm25_out[-1])),
        "pm25_final_max": float(np.max(pm25_out[-1])),
        "pm25_peak": float(np.max(pm25_out)),
        "pbl_suppression_saturated_hours": int(
            np.count_nonzero(np.any(suppression_out >= params.max_pbl_suppression - 1e-9, axis=(1, 2)))
        ),
        "non_finite_events": non_finite_events,
        # 1 tonne = 1e6 g = 1e12 ug.
        "mass_budget_tonnes": {
            **{name: value * 1.0e-12 for name, value in budget.items()},
            "initial_content": content_initial * 1.0e-12,
            "final_content": content_final * 1.0e-12,
            "residual": budget_residual * 1.0e-12,
        },
        "mass_conservation": (
            "ground concentration is column mass divided by the effective PBL "
            "depth, so the compression step conserves column mass exactly; "
            "mass_budget_tonnes reports every source and sink and its residual "
            "(which should be numerically zero)"
        ),
    }

    return {
        "pm25": pm25_out,
        "pm25_24h_mean": mean_pm25,
        "pbl_height": pbl_out,
        "pbl_height_synoptic": pbl_syn_out,
        "inversion_strength_index": isi_out,
        "aqi_category": aqi_category_from_pm25(mean_pm25),
        "aqi_category_instant": aqi_category_from_pm25(pm25_out),
        "aqi_value": aqi_value,
        "aqi_value_instant": aqi_value_from_pm25(pm25_out),
        "aerosol_extinction": extinction_out,
        "pbl_suppression_fraction": suppression_out,
        "aloft_column_mass": aloft_out,
        "stubble_emission": emission_out,
        "urban_emission": (
            None if urban_fields is None else np.stack(urban_fields)
        ),
        "hourly_diagnostics": hourly,
        "time_hours": np.arange(n_hours, dtype=np.float64),
        "grid": grid,
        "params": params,
        "diagnostics": diagnostics,
    }


# --------------------------------------------------------------------------
# Self-tests and synthetic scenario
# --------------------------------------------------------------------------
def _self_test() -> None:
    """Assert the core kernels behave as their physics requires."""
    grid = delhi_ncr_grid()
    params = ModelParams()

    # Upwind advection is exact for a linear profile at constant velocity.
    linear = 1.0 + 0.01 * np.arange(grid.shape[1])[None, :] * np.ones(grid.shape[0])[:, None]
    u_const = np.full(grid.shape, 4.0)
    v_zero = np.zeros(grid.shape)
    dt = 0.5 * grid.dx / 4.0  # Courant = 0.5
    advected, supplied = _advect_upwind(linear, u_const, v_zero, dt, grid.dx, grid.dy)
    expected = linear - 0.01 * (4.0 * dt / grid.dx)
    interior = (slice(None), slice(1, -1))
    assert np.allclose(advected[interior], expected[interior], atol=1e-10), "upwind linear test"
    # Eastward flow enters through the west edge only.
    assert supplied > 0.0, "eastward flow must supply mass through the west edge"
    _, supplied_west = _advect_upwind(
        linear, -u_const, v_zero, dt, grid.dx, grid.dy
    )
    assert supplied_west > 0.0, "westward flow must supply mass through the east edge"

    # Conservative flux form: with zero wind the field cannot change.
    random_field = np.random.default_rng(0).random(grid.shape) * 100.0
    stable, no_supply = _advect_upwind(
        random_field, v_zero, v_zero, dt, grid.dx, grid.dy
    )
    assert np.array_equal(stable, random_field), "no-wind advection must be a no-op"
    assert no_supply == 0.0, "no-wind advection must not supply mass"

    # Both diffusion kernels must conserve mass and grow the variance by 2 K dt.
    # (The wake of a point release spreads as sigma_x^2 = 2 K t.)
    blob = np.zeros(grid.shape)
    blob[grid.shape[0] // 2, grid.shape[1] // 2] = 1.0e6
    _, cols = np.mgrid[0 : grid.shape[0], 0 : grid.shape[1]]
    x_metres = cols * grid.dx

    def variance_x(field: np.ndarray) -> float:
        weights = field / field.sum()
        centroid = float(np.sum(weights * x_metres))
        return float(np.sum(weights * (x_metres - centroid) ** 2))

    # Laplacian: exact variance growth, valid at any sub-critical Fourier number.
    k_lap, dt_lap = 50.0, 3600.0
    assert k_lap * dt_lap / grid.dx**2 < params.fourier_target, "test set-up"
    laplacian_field = _diffuse_laplacian(blob, k_lap, dt_lap, grid)
    assert abs(laplacian_field.sum() - blob.sum()) / blob.sum() < 1e-12, "Laplacian mass"
    expected_variance = 2.0 * k_lap * dt_lap
    assert (
        abs(variance_x(laplacian_field) - expected_variance) / expected_variance < 0.01
    ), "Laplacian variance"

    # Gaussian: accurate once sigma exceeds ~half a cell, hence the guard.
    k_gauss, dt_gauss = 2000.0, 3600.0
    sigma = math.sqrt(2.0 * k_gauss * dt_gauss)
    assert sigma > grid.dx, "test set-up"
    gaussian_field = _diffuse_gaussian(blob, k_gauss, dt_gauss, grid)
    assert abs(gaussian_field.sum() - blob.sum()) / blob.sum() < 1e-12, "Gaussian mass"
    expected_variance = 2.0 * k_gauss * dt_gauss
    assert (
        abs(variance_x(gaussian_field) - expected_variance) / expected_variance < 0.03
    ), "Gaussian variance"
    assert (
        math.sqrt(2.0 * 50.0 * 3600.0) / grid.dx < GAUSSIAN_MIN_SIGMA_CELLS
    ), "the guard threshold must flag the K=50 m2/s regime as under-resolved"

    # Flat fields are left untouched (no spurious sources).
    flat = np.full(grid.shape, 50.0)
    assert np.allclose(_diffuse_laplacian(flat, 100.0, 60.0, grid), flat), "flat Laplacian"
    assert np.allclose(_diffuse_gaussian(flat, 100.0, 60.0, grid), flat), "flat Gaussian"

    # Feedback: suppression is 0 clean, exactly 40 % at the threshold, capped above.
    pbl = np.full(grid.shape, 700.0)
    _, clean_suppression, _ = _aerosol_feedback(np.zeros(grid.shape), pbl, params)
    threshold_mass = 250.0 * pbl
    _, threshold_suppression, threshold_pbl = _aerosol_feedback(threshold_mass, pbl, params)
    _, severe_suppression, severe_pbl = _aerosol_feedback(threshold_mass * 10.0, pbl, params)
    assert np.allclose(clean_suppression, 0.0), "no suppression in clean air"
    assert np.allclose(threshold_suppression, params.max_pbl_suppression, atol=1e-9), "threshold"
    assert np.allclose(threshold_pbl, 0.6 * pbl, atol=1e-6), "PBL reduced by 40 % at 250 ug/m3"
    assert severe_suppression.max() <= params.max_pbl_suppression + 1e-12, "suppression cap"

    # Inversion trapping: ground concentration is the column mass divided by the
    # feedback-reduced PBL depth, so column mass is conserved while C rises.
    pbl_synoptic = np.full(grid.shape, 300.0)
    well_mixed_mass = 100.0 * pbl_synoptic  # 100 ug/m3 mixed through 300 m
    _, trapped_suppression, trapped_pbl = _aerosol_feedback(
        well_mixed_mass, pbl_synoptic, params
    )
    trapped_concentration = well_mixed_mass / trapped_pbl
    assert np.all(trapped_suppression > 0.0), "loaded air must suppress the PBL"
    assert np.all(trapped_pbl < pbl_synoptic), "the effective PBL must be lower"
    assert np.all(trapped_concentration > 100.0), "trapping must raise PM2.5"
    assert np.allclose(
        trapped_concentration * trapped_pbl, well_mixed_mass, atol=1e-9
    ), "compression must conserve column mass"
    assert np.allclose(
        trapped_concentration / 100.0, pbl_synoptic / trapped_pbl, rtol=1e-12
    ), "compression is inversely proportional to the PBL depth"

    # CFL: sub-step count grows with wind speed and diffusion is resolved.
    calm = check_cfl(0.0, 0.0, 3600.0, grid=grid, params=params)
    windy = check_cfl(12.0, -6.0, 3600.0, grid=grid, params=params)
    assert windy.substeps > calm.substeps, "sub-steps must grow with wind speed"
    assert windy.advection_stable and windy.courant <= params.cfl_target + 1e-9, "Courant"
    laplacian_params = ModelParams(diffusion_scheme="laplacian")
    diffusive = check_cfl(2.0, 0.0, 3600.0, diffusivity=2000.0, grid=grid, params=laplacian_params)
    assert diffusive.diffusion_stable and diffusive.fourier <= params.fourier_target + 1e-9
    assert diffusive.diffusion_resolved, "the Laplacian is always resolvable"

    # The Gaussian kernel advertises its own resolution so misuse is visible.
    gaussian_params = ModelParams(diffusion_scheme="gaussian")
    coarse = check_cfl(0.5, 0.0, 3600.0, diffusivity=50.0, grid=grid, params=gaussian_params)
    fine = check_cfl(0.5, 0.0, 3600.0, diffusivity=2000.0, grid=grid, params=gaussian_params)
    assert not coarse.diffusion_resolved, "K=50 m2/s Gaussian kernel is under-resolved"
    assert fine.diffusion_resolved, "K=2000 m2/s Gaussian kernel is resolved"
    assert fine.diffusion_stable and coarse.diffusion_stable, "Gaussian is unconditional"

    # AQI mapping.
    concentrations = np.array([0.0, 30.0, 45.0, 60.0, 90.0, 120.0, 250.0, 251.0, 900.0])
    classes = aqi_category_from_pm25(concentrations)
    assert list(classes) == [
        "Good",
        "Good",
        "Satisfactory",
        "Satisfactory",
        "Moderate",
        "Poor",
        "Very Poor",
        "Severe",
        "Severe",
    ], f"AQI classes wrong: {list(classes)}"
    indices = aqi_value_from_pm25(concentrations)
    assert np.all(np.diff(indices) >= 0.0), "AQI sub-index must be monotone"
    assert abs(indices[1] - 50.0) < 1e-9 and abs(indices[6] - 400.0) < 1e-9, "AQI knots"

    # End-to-end smoke test on a tiny problem.
    output = simulate_72h(
        np.full(grid.shape, 40.0),
        {
            "u": 3.0,
            "v": -2.0,
            "pbl_height": 400.0,
            "t2m": 283.0,
            "t850": 287.0,
        },
        [(28.8, 76.9, 40.0), (28.75, 77.0, 25.0)],
        hours=4,
    )
    assert set(("pm25", "pbl_height", "inversion_strength_index", "aqi_category")) <= set(output)
    assert output["pm25"].shape == (4,) + grid.shape
    assert np.all(np.isfinite(output["pm25"])) and np.all(output["pm25"] >= 0.0)
    assert output["aqi_category"].dtype.kind == "U"

    # Every documented input container must be accepted.
    records = [
        {
            "u": 1.0 + 0.1 * t,
            "v": -1.0,
            "pbl_height": 300.0 + 25.0 * t,
            "t2m": 280.0,
            "t850": 285.0,
        }
        for t in range(3)
    ]
    from_records = simulate_72h(50.0, records, {"lat": [28.5, 28.7], "lon": [77.0, 77.2], "frp": [30.0, 12.0]}, hours=3)
    assert from_records["pm25"].shape == (3,) + grid.shape, "list-of-records weather"

    structured = np.zeros(3, dtype=[("u", float), ("v", float), ("pbl_height", float), ("t2m", float), ("t850", float)])
    structured["u"] = [1.0, 2.0, 3.0]
    structured["v"] = -1.5
    structured["pbl_height"] = 450.0
    structured["t2m"] = 281.0
    structured["t850"] = 285.0
    from_structured = simulate_72h(50.0, structured, np.array([[28.5, 77.0, 30.0]]), hours=3)
    assert from_structured["pm25"].shape == (3,) + grid.shape, "structured-array weather"

    # 1-D profiles broadcast; an absent sounding warns and falls back.
    profile_weather = {"u": np.full(grid.shape[0], 2.0), "v": -1.0, "pbl_height": 350.0}
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        profile_run = simulate_72h(np.full(grid.shape, 30.0), profile_weather, [], hours=2)
    assert any("t850" in str(w.message) for w in caught), "a missing sounding must warn"
    assert profile_run["pm25"].shape == (2,) + grid.shape
    assert np.all(np.isfinite(profile_run["inversion_strength_index"]))

    # Invalid input fails loudly rather than silently degrading.
    bad_calls = [
        (lambda: simulate_72h(-1.0, profile_weather, [], hours=1), "non-negative"),
        (lambda: simulate_72h(50.0, {"v": -1.0, "pbl_height": 300.0}, [], hours=1), "missing 'u'"),
        (
            lambda: simulate_72h(
                50.0,
                {"u": 1.0, "v": -1.0, "pbl_height": 300.0, "t2m": 8.0, "t850": 285.0},
                [],
                hours=1,
            ),
            "Kelvin",
        ),
        # Scalars are held constant, but a short time series is a real error.
        (
            lambda: simulate_72h(
                50.0, {"u": [1.0, 2.0, 3.0], "v": -1.0, "pbl_height": 300.0}, [], hours=5
            ),
            "at least 5",
        ),
    ]
    for call, expected in bad_calls:
        try:
            call()
        except (ValueError, KeyError) as error:
            assert expected in str(error), f"unexpected error message: {error}"
        else:
            raise AssertionError(f"expected an error mentioning {expected!r}")

    # --- continuous urban source -------------------------------------------
    footprint = urban_footprint(grid, params)
    assert footprint.shape == grid.shape and np.all(footprint > 0.0), "footprint support"
    assert abs(float(footprint.max()) - 1.0) < 1.0e-12, "footprint peak must be 1"
    # The rural floor is asymptotic: the Gaussian tails still add a little to the
    # remotest corner, so the minimum sits just above the configured floor.
    assert params.urban_rural_fraction <= float(footprint.min()) <= (
        params.urban_rural_fraction + 0.02
    ), "footprint floor must be urban_rural_fraction"
    described = describe_urban_source(grid, params)
    assert 200.0 < described["built_up_area_km2"] < 4000.0, described
    assert 1.5 < described["peak_to_mean"] < 8.0, described

    diag_weather = {
        "u": 4.0,
        "v": -1.0,
        "pbl_height": 450.0,
        "t2m": 290.0,
        "t850": 288.0,
    }
    diag_fires = [[29.9, 75.5, 25.0], [30.3, 75.8, 18.0]]
    flat = np.full(grid.shape, 60.0)
    quiet = simulate_72h(
        flat, diag_weather, diag_fires, hours=6, params=ModelParams(hours=6)
    )
    emitting = simulate_72h(
        flat,
        diag_weather,
        diag_fires,
        hours=6,
        params=ModelParams(hours=6, urban_emission_ug_m2_s=0.8),
    )
    assert float(quiet["hourly_diagnostics"]["urban_mix_ug"].sum()) == 0.0, (
        "the urban source must be off by default"
    )
    assert quiet["diagnostics"]["urban"]["source"] == "disabled", "urban source flag"
    assert emitting["diagnostics"]["urban"]["tonnes"] > 0.0, "urban tonnes"
    assert float(emitting["pm25"].mean()) > float(quiet["pm25"].mean()), (
        "a continuous source must raise the mean load"
    )

    # A per-hour urban flux series is accepted and overrides the parameter.
    gridded = simulate_72h(
        flat,
        {**diag_weather, "urban_emission": np.full(grid.shape, 0.8)},
        diag_fires,
        hours=6,
        params=ModelParams(hours=6),
    )
    assert gridded["diagnostics"]["urban"]["source"] == "weather['urban_emission']"
    assert gridded["diagnostics"]["urban"]["tonnes"] > 0.0, "gridded urban tonnes"
    try:
        simulate_72h(
            flat,
            {"u": 1.0, "v": 0.0, "pbl_height": 300.0, "urban_emission": -1.0},
            [],
            hours=2,
        )
    except ValueError as error:
        assert "non-negative" in str(error), error
    else:
        raise AssertionError("a negative urban emission must be rejected")

    # --- hourly diagnostics -------------------------------------------------
    # The GRAP panel's reduced-order model is identified from these series, so
    # they must reconcile exactly rather than approximately: every source and
    # sink recorded per hour has to account for the change between two
    # consecutive hours, and the two pass-through steps (inter-reservoir drain
    # and the compression that conserves column mass) must net to zero.
    per_hour = emitting["hourly_diagnostics"]
    for hour in range(5):
        entered_next = (
            per_hour["mix_mass_in_ug"][hour + 1] + per_hour["aloft_mass_in_ug"][hour + 1]
        )
        transported = (
            per_hour["mix_mass_transport_ug"][hour]
            + per_hour["aloft_mass_transport_ug"][hour]
        )
        accounted = (
            per_hour["deposited_ug"][hour]
            + per_hour["scavenged_ug"][hour]
            + per_hour["entrained_ug"][hour]
            + per_hour["aloft_drain_ug"][hour]
            + per_hour["compression_ug"][hour]
            + per_hour["stubble_mix_ug"][hour]
            + per_hour["stubble_aloft_ug"][hour]
            + per_hour["urban_mix_ug"][hour]
        )
        assert abs(accounted - (entered_next - transported)) <= 1.0e-9 * max(
            entered_next, 1.0
        ), f"hourly budget does not close at hour {hour}"
    mass_scale = float(emitting["diagnostics"]["mass_budget_tonnes"]["final_content"]) * 1.0e12
    for pass_through in ("aloft_drain_ug", "compression_ug"):
        assert abs(float(np.sum(per_hour[pass_through]))) <= 1.0e-6 * max(mass_scale, 1.0), (
            f"{pass_through} must conserve total column mass"
        )
    # The boundary supply is the inward half of the boundary exchange, so it can
    # never be negative, and the mass entering an hour is the previous state.
    assert np.all(np.asarray(per_hour["boundary_inflow_ug"]) >= 0.0), "supply sign"
    for hour in range(1, 5):
        expected_in = (
            float(np.sum(emitting["pm25"][hour - 1] * emitting["pbl_height"][hour - 1]))
            * grid.cell_area
        )
        assert abs(per_hour["mix_mass_in_ug"][hour] - expected_in) <= 1.0e-6 * max(
            expected_in, 1.0
        ), "the entering mixed mass must be the previous hour's state"
        # The compression step divides the column mass by the depth and
        # multiplies it back, so the carry-over matches to round-off rather than
        # bit for bit.
        assert abs(
            per_hour["mix_mass_out_ug"][hour - 1] - per_hour["mix_mass_in_ug"][hour]
        ) <= 1.0e-12 * max(per_hour["mix_mass_in_ug"][hour], 1.0), (
            "an hour's closing state must be the next hour's opening state"
        )
        assert abs(
            per_hour["aloft_mass_out_ug"][hour - 1] - per_hour["aloft_mass_in_ug"][hour]
        ) <= 1.0e-12 * max(per_hour["aloft_mass_in_ug"][hour], 1.0), (
            "the aloft reservoir must carry across hours unchanged"
        )

    print("self-test: kernel, feedback, CFL, AQI and input-handling checks passed")


def _synthetic_scenario(
    n_fires: int = 240, seed: int = 7
) -> tuple[np.ndarray, dict[str, np.ndarray], np.ndarray]:
    """Build a plausible post-monsoon Delhi NCR episode (nocturnal inversions).

    In-domain burning of ~4 GW total FRP corresponds to roughly
    0.03 t km-2 day-1 of PM2.5, in the range of published residue-burning
    emission densities for the north-west Indian hotspot, and the rising
    inflow represents the regional haze already aloft upstream.
    """
    grid = delhi_ncr_grid()
    rng = np.random.default_rng(seed)
    params = ModelParams(hours=72)

    lat0, lon0 = float(grid.lat.mean()), float(grid.lon.mean())
    core = np.exp(
        -0.5
        * (
            ((grid.lat2d - 28.61) / 0.11) ** 2
            + ((grid.lon2d - 77.21) / 0.13) ** 2
        )
    )
    municipal = np.exp(
        -0.5 * (((grid.lat2d - 28.70) / 0.20) ** 2 + ((grid.lon2d - 77.15) / 0.25) ** 2)
    )
    initial = 45.0 + 110.0 * core + 20.0 * municipal

    hours = np.arange(params.hours, dtype=np.float64)
    hour_local = (params.start_hour_local + hours) % 24.0
    phase = np.mod(hour_local - 15.0 + 12.0, 24.0) - 12.0
    daytime = np.exp(-0.5 * (phase / 3.2) ** 2)
    pbl_height = 180.0 + 1650.0 * daytime  # shallow nocturnal layer, deep afternoon

    # North-westerly flow (Punjab -> Delhi) veering slightly over the episode.
    u = 2.2 + 1.1 * np.sin(2.0 * np.pi * hours / 48.0)
    v = -1.6 - 0.6 * np.cos(2.0 * np.pi * hours / 36.0)
    t850 = 285.0 + 1.5 * np.sin(2.0 * np.pi * hours / 24.0)
    t2m = 279.5 + 8.0 * daytime  # cold pool below the 850 hPa level at night
    precip = np.zeros_like(hours)
    inflow = 25.0 + 70.0 * hours / (params.hours - 1.0)  # regional haze builds up

    fire_lat = lat0 + 0.22 + 0.12 * rng.standard_normal(n_fires)
    fire_lon = lon0 - 0.26 + 0.14 * rng.standard_normal(n_fires)
    frp = np.clip(rng.gamma(2.0, 9.0, size=n_fires), 1.0, 150.0)
    fire_points = np.column_stack((fire_lat, fire_lon, frp))

    weather = {
        "u": u,
        "v": v,
        "pbl_height": pbl_height,
        "t2m": t2m,
        "t850": t850,
        "precip": precip,
        "inflow": inflow,
    }
    return initial, weather, fire_points


def main() -> None:
    """Run the self-tests then the synthetic 72-h Delhi NCR scenario."""
    _self_test()
    initial, weather, fires = _synthetic_scenario()
    output = simulate_72h(initial, weather, fires)

    pm25 = output["pm25"]
    diagnostics = output["diagnostics"]
    categories = output["aqi_category"].ravel()
    labels, counts = np.unique(categories, return_counts=True)
    share = {label: 100.0 * count / categories.size for label, count in zip(labels, counts)}

    print("\n--- synthetic Delhi NCR stubble-burning episode (72 h) ---")
    print(f"domain            : {diagnostics['grid']['domain_km'][0]:.0f} x "
          f"{diagnostics['grid']['domain_km'][1]:.0f} km, "
          f"{diagnostics['grid']['shape'][0]} x {diagnostics['grid']['shape'][1]} cells")
    print(f"fires used        : {diagnostics['fires']['n_used']} "
          f"({diagnostics['fires']['n_dropped_out_of_domain']} outside domain), "
          f"total FRP {diagnostics['fires']['total_frp_mw']:.0f} MW")
    print(f"PM2.5 peak        : {diagnostics['pm25_peak']:.1f} ug/m3")
    print(f"PM2.5 final mean  : {diagnostics['pm25_final_mean']:.1f} ug/m3")
    print(f"max PBL suppression saturated hours: "
          f"{diagnostics['pbl_suppression_saturated_hours']} / {pm25.shape[0]}")
    print(f"CFL               : {diagnostics['cfl']['substeps_mean']:.1f} mean substeps/hour, "
          f"max Courant {diagnostics['cfl']['max_courant']:.3f}, "
          f"max Fourier {diagnostics['cfl']['max_fourier']:.3f}, "
          f"stable={diagnostics['cfl']['stable']}")
    print("AQI classes (24-h mean, share of grid-hours):")
    for label in AQI_CATEGORIES:
        if label in share:
            print(f"  {label:<14s} {share[label]:5.1f} %")
    print("mass budget [t]: " + ", ".join(
        f"{name} {value:+.1f}" for name, value in diagnostics["mass_budget_tonnes"].items()
    ))


if __name__ == "__main__":
    main()
