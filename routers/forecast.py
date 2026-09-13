"""FastAPI router for the Delhi NCR 72-hour coupled PM2.5 forecast.

Mount it on an application with::

    from fastapi import FastAPI
    from routers.forecast import router as forecast_router

    app = FastAPI(title="Delhi NCR AQI forecast")
    app.include_router(forecast_router)          # serves /api/forecast/...
    # app.add_middleware(CORSMiddleware, allow_origins=[...])  # for the dashboard

Endpoints
---------
``GET /api/forecast/72h``
    Fetches Open-Meteo meteorology and NASA FIRMS fire detections, runs
    ``engine.coupled_model.simulate_72h`` and returns GeoJSON feature
    collections (active fires, and one PM2.5 field layer for a chosen hour)
    together with dashboard summary metrics and an hourly timeline.
``POST /api/forecast/interventions``
    What-if grading against the CAQM Graded Response Action Plan.  Takes the
    three levers the panel exposes (crop-residue burning, goods-vehicle
    restrictions, odd-even) and returns the baseline and mitigated trajectories
    side by side, with the averted peak and the expected drop in the maximum AQI
    over the next 48 h.  The scenarios are evaluated with the reduced-order
    surrogate identified from the full model's own run, so the endpoint answers
    in milliseconds instead of re-running 50 x 50 transport per lever move.
``GET /api/forecast/status``
    Cheap provenance/health probe: which upstreams are configured, whether the
    fire inventory is live or synthetic, and what is currently cached.

The simulation costs ~1.4 s of CPU, so it is dispatched to a worker thread
(never blocking the event loop) and memoised in-process against a fingerprint
of its inputs.  Only the metorology and fire fetches touch the network.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import sys
import warnings
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Literal

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in sys.path:  # allows `uvicorn routers.forecast:app` from anywhere
    sys.path.insert(0, str(_PROJECT_ROOT))

from engine.coupled_model import (  # noqa: E402  (import after sys.path setup)
    AQI_CATEGORIES,
    ModelParams,
    aqi_category_from_pm25,
    aqi_value_from_pm25,
    delhi_ncr_grid,
    describe_urban_source,
    simulate_72h,
    urban_core_mask,
)
from engine.surrogate import ReducedModel  # noqa: E402
from services.grap import (  # noqa: E402
    DEFAULT_ATTRIBUTION,
    GRAP_STAGES,
    Intervention,
    TRUCK_MODE_LABELS,
    scenario_bundle,
)
from services.ingest import (  # noqa: E402
    DELHI_NCR_CENTER,
    FIRMS_SOURCE,
    FORECAST_HOURS,
    IngestBundle,
    IngestError,
    OPEN_METEO_FORECAST_URL,
    TTLCache,
    build_forecast_inputs,
    clear_ingest_cache,
)

router = APIRouter(prefix="/api/forecast", tags=["forecast"])

SIMULATION_CACHE_TTL_SECONDS = 1800.0
KNOWN_SOURCES = ("VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "MODIS_NRT")

#: Resolution of the coarse wind-vector lattice returned for the client's
#: wind-arrow / particle-flow layer.  7x7 = 49 samples keeps the payload tiny
#: while still carrying any real spatial structure once gridded winds are fed in.
WIND_SAMPLE_ROWS = 7
WIND_SAMPLE_COLS = 7

#: City-centre intensity of the continuous urban primary PM2.5 source
#: [ug m-2 s-1].  Delhi's inventory-equivalent built-up-area flux is about
#: 0.6 ug m-2 s-1; expressed as a city-centre peak over the footprint that is
#: roughly 1.0.  Shared by ``/72h`` and ``/interventions`` so the map's forecast
#: and the GRAP panel's "original curve" are the same baseline -- if the two
#: endpoints defaulted differently, the dashboard would show two answers.
URBAN_EMISSION_PEAK_UG_M2_S = 1.0


# --------------------------------------------------------------------------
# Pydantic response models
# --------------------------------------------------------------------------
class PointGeometry(BaseModel):
    """GeoJSON point geometry.  Coordinates are (longitude, latitude)."""

    type: Literal["Point"] = "Point"
    coordinates: tuple[float, float]


class GeoJSONFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    id: str | None = None
    geometry: PointGeometry
    properties: dict[str, Any] = Field(default_factory=dict)


class FeatureCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[GeoJSONFeature] = Field(default_factory=list)


class BoundingBox(BaseModel):
    west: float
    south: float
    east: float
    north: float


class GridMetadata(BaseModel):
    shape: tuple[int, int]
    dx_m: float
    dy_m: float
    cell_area_m2: float
    domain_km: tuple[float, float]
    bbox: BoundingBox
    crs: str = "EPSG:4326"


class TimelinePoint(BaseModel):
    """Per-hour domain aggregate, suitable for a dashboard chart."""

    hour_index: int
    time_local: str
    mean_pm25: float
    max_pm25: float
    mean_pbl_m: float
    mean_aqi_value: float
    dominant_aqi_category: str
    wind_speed_ms: float = 0.0
    wind_direction_deg: float = 0.0


class WindVectorProperties(BaseModel):
    """One wind sample handed to the client's animated wind layer."""

    u_ms: float
    v_ms: float
    speed_ms: float
    direction_deg: float  # meteorological: the bearing the wind blows FROM
    bearing_deg: float  # the bearing it blows TOWARD, for arrow/particle rotation
    row: int
    col: int


class SummaryMetrics(BaseModel):
    generated_at: str
    horizon_hours: int
    selected_hour_index: int
    selected_hour_time_local: str
    mean_pm25_selected_hour: float
    peak_pm25_episode: float
    mean_pm25_episode: float
    mean_pm25_final_hour: float
    pbl_min_m: float
    pbl_max_m: float
    max_pbl_suppression_fraction: float
    suppression_saturated_hours: int
    dominant_aqi_category: str
    aqi_category_share_percent: dict[str, float]
    fire_detections: int
    fires_used_in_model: int
    fires_out_of_domain: int
    total_frp_mw: float
    mean_wind_speed_ms: float
    dominant_wind_direction_deg: float
    cfl_stable: bool
    mean_substeps_per_hour: float
    max_courant: float
    mass_budget_tonnes: dict[str, float]
    model_warnings: list[str] = Field(default_factory=list)


class Provenance(BaseModel):
    meteorology_source: str
    meteorology_detail: str
    fire_source: str
    fire_detail: str
    forecast_start_local: str | None
    forecast_hours: int
    fetched_at: str
    simulation_cached: bool
    simulation_fingerprint: str
    notes: list[str] = Field(default_factory=list)


class Forecast72hResponse(BaseModel):
    center: tuple[float, float]
    bbox: BoundingBox
    grid: GridMetadata
    summary: SummaryMetrics
    timeline: list[TimelinePoint]
    fires: FeatureCollection
    pm25_field: FeatureCollection
    wind_field: FeatureCollection
    provenance: Provenance


# --------------------------------------------------------------------------
# GRAP what-if models
# --------------------------------------------------------------------------
class InterventionRequest(BaseModel):
    """The three levers, mirroring the panel's controls."""

    stubble_reduction: float = Field(
        0.0,
        ge=0.0,
        le=1.0,
        description="Fraction of crop-residue burning removed (0, 0.5 or 0.8 in the UI)",
    )
    truck_restriction: Literal["off", "bs4_banned", "all_halted"] = Field(
        "off", description="Goods-vehicle restriction in force"
    )
    odd_even: bool = Field(False, description="Whether an odd-even scheme is active")


class InterventionDescription(BaseModel):
    """What a scenario's levers actually do to the model's emission terms."""

    stubble_reduction_percent: float
    stubble_scale: float
    truck_restriction: str
    truck_restriction_label: str
    truck_share_of_urban_source_removed: float
    odd_even_active: bool
    odd_even_share_of_urban_source_removed: float
    urban_scale: float
    urban_source_removed_percent: float
    inflow_stubble_fraction: float
    attribution: dict[str, float]
    note: str


class PreemptionSummary(BaseModel):
    recommended_stage: int
    current_stage: int
    escalated: bool
    stagnant_hours: int
    mean_wind_speed_ms: float
    mean_mixing_height_m: float
    rationale: str


class InterventionSummary(BaseModel):
    """The headline comparison the panel leads with."""

    window_hours: int
    baseline_peak_pm25_core: float
    mitigated_peak_pm25_core: float
    averted_peak_pm25: float
    baseline_max_aqi: float
    mitigated_max_aqi: float
    max_aqi_drop: float
    max_aqi_drop_percent: float
    mean_pm25_core_change: float
    mean_pm25_core_change_percent: float
    baseline_grap_stage: int
    baseline_grap_label: str
    mitigated_grap_stage: int
    mitigated_grap_label: str
    stage_change: int
    avoids_stage: str | None = None
    preemption: PreemptionSummary | None = None


class GrapStatusResponse(BaseModel):
    measured_on: str
    invoked_stage: int
    invoked_label: str
    peak_aqi: float
    peak_category: str
    hours_by_stage: dict[str, int]
    stage_sequence: list[int]
    actions_in_force: list[str]
    next_stage: dict[str, Any] | None = None


class GrapComparison(BaseModel):
    """The two curves the panel plots, plus what they are measured on."""

    times_local: list[str]
    baseline_pm25_core: list[float]
    mitigated_pm25_core: list[float]
    baseline_aqi_core: list[float]
    mitigated_aqi_core: list[float]
    baseline_pm25_mean: list[float]
    mitigated_pm25_mean: list[float]


class SurrogateReport(BaseModel):
    """The reduced model's measured accuracy, so the numbers can be trusted."""

    baseline_relative_error: float
    baseline_absolute_error_ug_m3: float
    urban_channel_gain: float
    urban_channel_response_bias: float | None = None
    operators: dict[str, float]
    speed: str


class InterventionsResponse(BaseModel):
    center: tuple[float, float]
    hours: int
    window_hours: int
    intervention: InterventionDescription
    summary: InterventionSummary
    grap: GrapStatusResponse
    comparison: GrapComparison
    surrogate: SurrogateReport
    urban_source: dict[str, float]
    provenance: Provenance
    notes: list[str] = Field(default_factory=list)


class StatusResponse(BaseModel):
    status: Literal["ok"] = "ok"
    meteorology_endpoint: str
    meteorology_configured: bool
    firms_source: str
    firms_map_key_configured: bool
    known_firms_sources: list[str]
    default_center: tuple[float, float]
    grid_shape: tuple[int, int]
    cached_simulations: int
    cached_fingerprints: list[str]
    last_provenance: Provenance | None = None


# --------------------------------------------------------------------------
# Simulation caching
# --------------------------------------------------------------------------
@dataclass
class _SimulationResult:
    output: dict[str, Any]
    model_warnings: list[str]
    fingerprint: str
    from_cache: bool = False


_simulation_cache = TTLCache(SIMULATION_CACHE_TTL_SECONDS)
_simulation_lock = asyncio.Lock()
_last_provenance: Provenance | None = None


def _fingerprint(
    bundle: IngestBundle, params: ModelParams, fire_points: np.ndarray
) -> str:
    """Stable hash of everything that changes the simulation result."""
    digest = hashlib.sha1()
    for key in sorted(bundle.windows.weather):
        digest.update(
            np.ascontiguousarray(bundle.windows.weather[key], dtype=np.float64).tobytes()
        )
    digest.update(np.ascontiguousarray(fire_points, dtype=np.float64).tobytes())
    digest.update(
        np.ascontiguousarray(bundle.initial_pm25, dtype=np.float64).tobytes()
    )
    digest.update(repr(sorted(vars(params).items())).encode("utf-8"))
    return digest.hexdigest()[:16]


def _run_model(bundle: IngestBundle, params: ModelParams, fire_points: np.ndarray) -> _SimulationResult:
    """Worker-thread entry point: run the coupled model and capture warnings."""
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        output = simulate_72h(
            bundle.initial_pm25,
            bundle.windows.weather,
            fire_points,
            params=params,
        )
    messages = [f"{item.category.__name__}: {item.message}" for item in caught]
    return _SimulationResult(output=output, model_warnings=messages, fingerprint="")


async def _simulate(
    bundle: IngestBundle, params: ModelParams, fire_points: np.ndarray
) -> _SimulationResult:
    """Memoised, off-event-loop simulation run.

    The mutex makes concurrent first requests share one run instead of each
    paying the ~1.4 s CPU cost.
    """
    fingerprint = _fingerprint(bundle, params, fire_points)
    cached = _simulation_cache.get(fingerprint)
    if cached is not None:
        return replace(cached, from_cache=True)
    async with _simulation_lock:
        cached = _simulation_cache.get(fingerprint)
        if cached is not None:
            return replace(cached, from_cache=True)
        result = await run_in_threadpool(_run_model, bundle, params, fire_points)
        result.fingerprint = fingerprint
        _simulation_cache.set(fingerprint, result)
        return result


# --------------------------------------------------------------------------
# GeoJSON builders
# --------------------------------------------------------------------------
def _point_feature(
    longitude: float, latitude: float, properties: dict[str, Any], feature_id: str | None = None
) -> GeoJSONFeature:
    return GeoJSONFeature(
        id=feature_id,
        geometry=PointGeometry(coordinates=(round(float(longitude), 5), round(float(latitude), 5))),
        properties=properties,
    )


def _broadcast_grid(value: Any, shape: tuple[int, int]) -> np.ndarray:
    """Broadcast a model weather series entry (scalar, 1-D profile or field) to a grid.

    The ingestion layer emits one value per hour per variable, but the coupled
    model accepts gridded meteorology too; this keeps both shapes renderable.
    """
    array = np.asarray(value, dtype=np.float64)
    if array.ndim == 0:
        return np.full(shape, float(array))
    if array.shape == shape:
        return array
    if array.ndim == 1 and array.size == shape[0]:
        return np.repeat(array[:, None], shape[1], axis=1)
    if array.ndim == 1 and array.size == shape[1]:
        return np.repeat(array[None, :], shape[0], axis=0)
    raise ValueError(f"cannot broadcast weather entry of shape {array.shape} to {shape}")


def wind_direction_deg(u: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Meteorological wind direction (the bearing the wind blows *from*).

    A westerly (u > 0, v = 0) gives 270 deg and a northerly (v < 0) gives 0 deg.
    """
    return (np.degrees(np.arctan2(-u, -v)) + 360.0) % 360.0


def _wind_collection(
    u_field: np.ndarray, v_field: np.ndarray
) -> FeatureCollection:
    """Coarse sample of the wind field for the client's animated flow layer."""
    grid = delhi_ncr_grid()
    speed = np.hypot(u_field, v_field)
    direction = wind_direction_deg(u_field, v_field)
    rows = np.unique(np.linspace(0, grid.shape[0] - 1, WIND_SAMPLE_ROWS).round().astype(int))
    columns = np.unique(
        np.linspace(0, grid.shape[1] - 1, WIND_SAMPLE_COLS).round().astype(int)
    )
    features: list[GeoJSONFeature] = []
    for row in rows:
        for column in columns:
            direction_value = round(float(direction[row, column]), 1)
            features.append(
                _point_feature(
                    grid.lon[column],
                    grid.lat[row],
                    {
                        "u_ms": round(float(u_field[row, column]), 3),
                        "v_ms": round(float(v_field[row, column]), 3),
                        "speed_ms": round(float(speed[row, column]), 3),
                        "direction_deg": direction_value,
                        "bearing_deg": round((direction_value + 180.0) % 360.0, 1),
                        "row": int(row),
                        "col": int(column),
                    },
                    feature_id=f"wind-{row}-{column}",
                )
            )
    return FeatureCollection(features=features)


def _fires_collection(
    bundle: IngestBundle, frp_scale: float
) -> FeatureCollection:
    """One point per active-fire detection over the Punjab/Haryana belt."""
    features: list[GeoJSONFeature] = []
    for index, detection in enumerate(bundle.fires.detections):
        properties = detection.as_feature_properties()
        properties["frp_scaled"] = round(float(detection.frp) * frp_scale, 3)
        properties["source"] = bundle.fires.source
        features.append(
            _point_feature(
                detection.longitude,
                detection.latitude,
                properties,
                feature_id=f"fire-{index}",
            )
        )
    return FeatureCollection(features=features)


def _pm25_collection(
    output: dict[str, Any],
    hour_index: int,
    *,
    min_pm25: float,
    stride: int,
) -> tuple[FeatureCollection, int]:
    """PM2.5 field layer for one hour: one point per (strided) grid cell."""
    grid = delhi_ncr_grid()
    pm25 = output["pm25"][hour_index]
    pbl = output["pbl_height"][hour_index]
    isi = output["inversion_strength_index"][hour_index]
    official = output["aqi_category"][hour_index]  # CPCB class of the 24-h mean
    instant = output["aqi_category_instant"][hour_index]
    aqi_value = output["aqi_value"][hour_index]
    # Exposed so the client can explain *why* a cell is dirty rather than guess:
    # local stubble emission, the PBL suppression the aerosol itself caused, and
    # the lofted smoke reservoir feeding back down.
    emission = output["stubble_emission"][hour_index]
    suppression = output["pbl_suppression_fraction"][hour_index]
    aloft = output["aloft_column_mass"][hour_index]

    lat = grid.lat
    lon = grid.lon
    features: list[GeoJSONFeature] = []
    skipped = 0
    for row in range(0, grid.shape[0], stride):
        for column in range(0, grid.shape[1], stride):
            value = float(pm25[row, column])
            if value < min_pm25:
                skipped += 1
                continue
            features.append(
                _point_feature(
                    lon[column],
                    lat[row],
                    {
                        "pm25": round(value, 2),
                        "aqi_value": round(float(aqi_value[row, column]), 1),
                        "aqi_category": str(official[row, column]),
                        "aqi_category_instant": str(instant[row, column]),
                        "pbl_height_m": round(float(pbl[row, column]), 1),
                        "inversion_strength_index": round(float(isi[row, column]), 4),
                        "stubble_emission_ug_m2_s": round(float(emission[row, column]), 4),
                        "pbl_suppression_fraction": round(float(suppression[row, column]), 4),
                        "aloft_column_mass_ug_m2": round(float(aloft[row, column]), 1),
                        "row": row,
                        "col": column,
                    },
                    # No feature id: (row, col) already identifies a cell and the
                    # ids cost ~20 bytes each on the largest layer in the payload.
                )
            )
    return FeatureCollection(features=features), skipped


def _hourly_wind_speed(bundle: IngestBundle) -> np.ndarray:
    """Domain-mean wind speed per hour, for the pre-emptive GRAP check."""
    hours = bundle.windows.hours
    speeds = np.empty(hours, dtype=np.float64)
    for hour in range(hours):
        mean_u = _mean_of(bundle.windows.weather["u"][hour])
        mean_v = _mean_of(bundle.windows.weather["v"][hour])
        speeds[hour] = float(np.hypot(mean_u, mean_v))
    return speeds


def _mean_of(value: Any) -> float:
    """Domain mean of a model weather entry (scalar or grid) without broadcasting."""
    return float(np.mean(np.asarray(value, dtype=np.float64)))


def _timeline(
    output: dict[str, Any], times_local: list[str], weather: dict[str, Any]
) -> list[TimelinePoint]:
    pm25 = output["pm25"]
    pbl = output["pbl_height"]
    aqi_value = output["aqi_value"]
    categories = output["aqi_category"]
    points: list[TimelinePoint] = []
    for hour in range(pm25.shape[0]):
        labels, counts = np.unique(categories[hour], return_counts=True)
        dominant = str(labels[int(np.argmax(counts))])
        label = times_local[hour] if hour < len(times_local) else f"+{hour}h"
        mean_u = _mean_of(weather["u"][hour])
        mean_v = _mean_of(weather["v"][hour])
        points.append(
            TimelinePoint(
                hour_index=hour,
                time_local=label,
                mean_pm25=round(float(pm25[hour].mean()), 2),
                max_pm25=round(float(pm25[hour].max()), 2),
                mean_pbl_m=round(float(pbl[hour].mean()), 1),
                mean_aqi_value=round(float(aqi_value[hour].mean()), 1),
                dominant_aqi_category=dominant,
                wind_speed_ms=round(float(np.hypot(mean_u, mean_v)), 3),
                wind_direction_deg=round(float(wind_direction_deg(mean_u, mean_v)), 1),
            )
        )
    return points


def _grid_metadata() -> GridMetadata:
    grid = delhi_ncr_grid()
    described = grid.describe()
    return GridMetadata(
        shape=(int(described["shape"][0]), int(described["shape"][1])),
        dx_m=round(float(described["dx_m"]), 1),
        dy_m=round(float(described["dy_m"]), 1),
        cell_area_m2=round(float(described["cell_area_m2"]), 1),
        domain_km=(
            round(float(described["domain_km"][0]), 1),
            round(float(described["domain_km"][1]), 1),
        ),
        bbox=BoundingBox(
            west=float(described["lon_range"][0]),
            south=float(described["lat_range"][0]),
            east=float(described["lon_range"][1]),
            north=float(described["lat_range"][1]),
        ),
    )


# --------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------
@router.get(
    "/72h",
    response_model=Forecast72hResponse,
    summary="72-hour coupled PM2.5 forecast for Delhi NCR",
)
async def forecast_72h(
    latitude: float = Query(DELHI_NCR_CENTER[0], ge=-90.0, le=90.0, description="Forecast point latitude"),
    longitude: float = Query(DELHI_NCR_CENTER[1], ge=-180.0, le=180.0, description="Forecast point longitude"),
    hours: int = Query(FORECAST_HOURS, ge=1, le=FORECAST_HOURS, description="Forecast horizon"),
    hour: int = Query(-1, ge=-1, description="Hour index to render; -1 selects the final hour"),
    min_pm25: float = Query(0.0, ge=0.0, description="Drop field cells below this PM2.5 to shrink the payload"),
    stride: int = Query(2, ge=1, le=10, description="Grid sub-sampling factor for the field layer"),
    inflow_pm25: float = Query(
        45.0, ge=0.0, le=1000.0,
        description="Regional lateral inflow PM2.5 [ug/m3]; the main lever for smoke advected in from outside the domain",
    ),
    frp_scale: float = Query(1.0, gt=0.0, le=100.0, description="Multiplier on detected Fire Radiative Power"),
    initial_background: float = Query(40.0, ge=0.0, description="Rural starting PM2.5 [ug/m3]"),
    initial_urban_increment: float = Query(110.0, ge=0.0, description="Urban dome increment over background [ug/m3]"),
    urban_emission: float = Query(
        URBAN_EMISSION_PEAK_UG_M2_S,
        ge=0.0,
        le=20.0,
        description=(
            "City-centre primary PM2.5 emission intensity [ug/m2/s] from the NCR's own "
            "sources; drives the continuous urban source the GRAP levers act on"
        ),
    ),
    offline: bool = Query(False, description="Skip the network and use synthetic inputs (demo mode)"),
    refresh: bool = Query(False, description="Ignore cached inputs and refetch upstream"),
) -> Forecast72hResponse:
    """Run the coupled forecast and return map layers plus dashboard metrics."""
    if hour >= hours:
        raise HTTPException(status_code=422, detail=f"hour must be < hours ({hours})")
    hour_index = hours - 1 if hour < 0 else hour

    if refresh:
        clear_ingest_cache()
        _simulation_cache.clear()
    try:
        bundle = await build_forecast_inputs(
            latitude,
            longitude,
            hours=hours,
            offline=offline,
            initial_background=initial_background,
            initial_urban_increment=initial_urban_increment,
            refresh=refresh,
        )
    except IngestError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    # The model's fire diurnal cycle is anchored to the real local clock, and
    # FRP is rescaled so the detected inventory can be calibrated against
    # observed concentrations without touching the physics parameters.
    params = ModelParams(
        hours=hours,
        start_hour_local=bundle.windows.start_hour_local,
        inflow_pm25=inflow_pm25,
        urban_emission_ug_m2_s=urban_emission,
    )
    fire_points = bundle.fires.points.copy()
    if fire_points.size:
        fire_points[:, 2] = fire_points[:, 2] * frp_scale

    result = await _simulate(bundle, params, fire_points)
    output = result.output
    diagnostics = output["diagnostics"]

    pm25 = output["pm25"]
    grid = delhi_ncr_grid()
    grid_metadata = _grid_metadata()
    # Wind for the animated flow layer comes from the *model input* meteorology.
    wind_u = _broadcast_grid(bundle.windows.weather["u"][hour_index], grid.shape)
    wind_v = _broadcast_grid(bundle.windows.weather["v"][hour_index], grid.shape)
    field_collection, skipped_cells = _pm25_collection(
        output, hour_index, min_pm25=min_pm25, stride=stride
    )

    labels, counts = np.unique(output["aqi_category"][hour_index], return_counts=True)
    dominant_category = str(labels[int(np.argmax(counts))])
    episode_labels, episode_counts = np.unique(
        output["aqi_category"].ravel(), return_counts=True
    )
    total_cells = float(output["aqi_category"].size)
    share = {
        str(label): round(100.0 * float(count) / total_cells, 2)
        for label, count in zip(episode_labels, episode_counts)
    }

    summary = SummaryMetrics(
        generated_at=bundle.generated_at,
        horizon_hours=hours,
        selected_hour_index=hour_index,
        selected_hour_time_local=bundle.windows.times_local[hour_index],
        mean_pm25_selected_hour=round(float(pm25[hour_index].mean()), 2),
        peak_pm25_episode=round(float(pm25.max()), 2),
        mean_pm25_episode=round(float(pm25.mean()), 2),
        mean_pm25_final_hour=round(float(pm25[-1].mean()), 2),
        pbl_min_m=round(float(output["pbl_height"].min()), 1),
        pbl_max_m=round(float(output["pbl_height"].max()), 1),
        max_pbl_suppression_fraction=round(
            float(output["pbl_suppression_fraction"].max()), 4
        ),
        suppression_saturated_hours=int(
            diagnostics["pbl_suppression_saturated_hours"]
        ),
        dominant_aqi_category=dominant_category,
        aqi_category_share_percent={key: share[key] for key in AQI_CATEGORIES if key in share},
        fire_detections=bundle.fires.count,
        fires_used_in_model=int(diagnostics["fires"]["n_used"]),
        fires_out_of_domain=int(diagnostics["fires"]["n_dropped_out_of_domain"]),
        total_frp_mw=round(float(bundle.fires.total_frp_mw), 2),
        mean_wind_speed_ms=round(
            float(np.mean([_mean_of(bundle.windows.weather["u"][t]) ** 2 + _mean_of(bundle.windows.weather["v"][t]) ** 2 for t in range(hours)]) ** 0.5),
            3,
        ),
        dominant_wind_direction_deg=round(
            float(
                wind_direction_deg(
                    np.mean([_mean_of(bundle.windows.weather["u"][t]) for t in range(hours)]),
                    np.mean([_mean_of(bundle.windows.weather["v"][t]) for t in range(hours)]),
                )
            ),
            1,
        ),
        cfl_stable=bool(diagnostics["cfl"]["stable"]),
        mean_substeps_per_hour=round(float(diagnostics["cfl"]["substeps_mean"]), 2),
        max_courant=round(float(diagnostics["cfl"]["max_courant"]), 4),
        mass_budget_tonnes={
            name: round(float(value), 3)
            for name, value in diagnostics["mass_budget_tonnes"].items()
        },
        model_warnings=result.model_warnings,
    )

    notes = list(bundle.warnings)
    out_of_domain = int(diagnostics["fires"]["n_dropped_out_of_domain"])
    if out_of_domain:
        notes.append(
            f"{out_of_domain} of {bundle.fires.count} detected fires lie beyond "
            f"{params.max_fire_distance_km:.0f} km from the {grid.shape[0]}x{grid.shape[1]} "
            "model grid and are excluded; regional smoke entering the domain is "
            "controlled by the inflow_pm25 parameter."
        )
    if skipped_cells:
        notes.append(
            f"{skipped_cells} of {grid.shape[0] * grid.shape[1]} grid cells were "
            f"below min_pm25={min_pm25} and omitted from the field layer."
        )
    if not summary.cfl_stable:
        notes.append("CFL/Fourier limits were violated; results may be numerically unreliable.")

    provenance = Provenance(
        meteorology_source=bundle.windows.source,
        meteorology_detail=bundle.windows.detail,
        fire_source=bundle.fires.source,
        fire_detail=bundle.fires.detail,
        forecast_start_local=bundle.windows.times_local[0] if bundle.windows.times_local else None,
        forecast_hours=bundle.windows.hours,
        fetched_at=bundle.generated_at,
        simulation_cached=result.from_cache,
        simulation_fingerprint=result.fingerprint,
        notes=notes,
    )
    global _last_provenance
    _last_provenance = provenance

    return Forecast72hResponse(
        center=(float(latitude), float(longitude)),
        bbox=grid_metadata.bbox,
        grid=grid_metadata,
        summary=summary,
        timeline=_timeline(output, bundle.windows.times_local, bundle.windows.weather),
        fires=_fires_collection(bundle, frp_scale),
        pm25_field=field_collection,
        wind_field=_wind_collection(wind_u, wind_v),
        provenance=provenance,
    )


@router.post(
    "/interventions",
    response_model=InterventionsResponse,
    summary="What-if GRAP intervention scenarios for Delhi NCR",
)
async def forecast_interventions(
    request: InterventionRequest,
    latitude: float = Query(DELHI_NCR_CENTER[0], ge=-90.0, le=90.0),
    longitude: float = Query(DELHI_NCR_CENTER[1], ge=-180.0, le=180.0),
    hours: int = Query(FORECAST_HOURS, ge=1, le=FORECAST_HOURS),
    window_hours: int = Query(
        48, ge=1, le=FORECAST_HOURS, description="Horizon the averted peak is measured over"
    ),
    inflow_pm25: float = Query(45.0, ge=0.0, le=1000.0),
    frp_scale: float = Query(1.0, gt=0.0, le=100.0),
    initial_background: float = Query(40.0, ge=0.0),
    initial_urban_increment: float = Query(110.0, ge=0.0),
    urban_emission: float = Query(URBAN_EMISSION_PEAK_UG_M2_S, ge=0.0, le=20.0),
    offline: bool = Query(False, description="Skip the network and use synthetic inputs (demo mode)"),
    refresh: bool = Query(False, description="Ignore cached inputs and refetch upstream"),
) -> InterventionsResponse:
    """Grade a what-if scenario against GRAP and report the averted peak.

    The model inputs mirror ``/72h`` exactly (same defaults), so the baseline
    curve here *is* the forecast the map is showing rather than a second opinion.
    """
    if window_hours > hours:
        raise HTTPException(
            status_code=422, detail=f"window_hours must be <= hours ({hours})"
        )
    if refresh:
        clear_ingest_cache()
        _simulation_cache.clear()

    intervention = Intervention(
        stubble_reduction=request.stubble_reduction,
        truck_restriction=request.truck_restriction,
        odd_even=request.odd_even,
    )
    try:
        bundle = await build_forecast_inputs(
            latitude,
            longitude,
            hours=hours,
            offline=offline,
            initial_background=initial_background,
            initial_urban_increment=initial_urban_increment,
            refresh=refresh,
        )
    except IngestError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    params = ModelParams(
        hours=hours,
        start_hour_local=bundle.windows.start_hour_local,
        inflow_pm25=inflow_pm25,
        urban_emission_ug_m2_s=urban_emission,
    )
    fire_points = bundle.fires.points.copy()
    if fire_points.size:
        fire_points[:, 2] = fire_points[:, 2] * frp_scale

    result = await _simulate(bundle, params, fire_points)

    # The urban lever is the one channel a domain-mean reduction gets structurally
    # wrong: the source is concentrated over the built-up area, so switching it
    # off also changes the ventilation the reduction cannot see.  One extra full
    # run measures that error and lets it be fitted away -- but only when a
    # vehicle lever is actually engaged, since it is pure cost otherwise.
    probe_result: _SimulationResult | None = None
    if request.truck_restriction != "off" or request.odd_even:
        probe_result = await _simulate(
            bundle, replace(params, urban_emission_ug_m2_s=0.0), fire_points
        )

    def _build_model() -> ReducedModel:
        return ReducedModel.from_output(
            result.output,
            params=params,
            grid=delhi_ncr_grid(),
            core_mask=urban_core_mask(delhi_ncr_grid(), params),
            probe_output=None if probe_result is None else probe_result.output,
        )

    model = await run_in_threadpool(_build_model)
    output = result.output
    wind_speed = _hourly_wind_speed(bundle)
    mixing_height = np.asarray(output["pbl_height"], dtype=np.float64).mean(axis=(1, 2))

    def _evaluate() -> dict[str, Any]:
        return scenario_bundle(
            model,
            intervention,
            times_local=bundle.windows.times_local,
            window_hours=window_hours,
            wind_speed_ms=wind_speed,
            mixing_height_m=mixing_height,
        )

    payload = await run_in_threadpool(_evaluate)

    notes = list(bundle.warnings)
    notes.append(
        "Scenarios are evaluated with a reduced-order (domain-mean) model identified "
        "from the full coupled run; its measured accuracy against that run is in "
        f"'surrogate'. Baseline reproduction error {payload['surrogate']['baseline_relative_error']:.2%}."
    )
    notes.append(
        "GRAP grading uses the urban-core mean of the CPCB 24-h mean sub-index, "
        "which is the closest analogue to 'Delhi's AQI' that a gridded model can "
        f"give over {int(np.count_nonzero(urban_core_mask(delhi_ncr_grid(), params)))} "
        f"of {delhi_ncr_grid().shape[0] * delhi_ncr_grid().shape[1]} cells."
    )
    if probe_result is None:
        notes.append(
            "No goods-vehicle or odd-even lever was engaged, so the urban channel "
            "was left on the raw reduction rather than calibrated against a probe run."
        )
    if request.truck_restriction != "off" or request.odd_even:
        notes.append(
            "Odd-even is a Delhi-government emergency measure invoked at its "
            "discretion under the top GRAP stage, not a fixed item of the schedule."
        )

    provenance = Provenance(
        meteorology_source=bundle.windows.source,
        meteorology_detail=bundle.windows.detail,
        fire_source=bundle.fires.source,
        fire_detail=bundle.fires.detail,
        forecast_start_local=bundle.windows.times_local[0] if bundle.windows.times_local else None,
        forecast_hours=bundle.windows.hours,
        fetched_at=bundle.generated_at,
        simulation_cached=result.from_cache,
        simulation_fingerprint=result.fingerprint,
        notes=notes,
    )
    global _last_provenance
    _last_provenance = provenance

    return InterventionsResponse(
        center=(float(latitude), float(longitude)),
        hours=hours,
        window_hours=window_hours,
        intervention=InterventionDescription(**payload["intervention"]),
        summary=InterventionSummary(**payload["summary"]),
        grap=GrapStatusResponse(**payload["grap"]),
        comparison=GrapComparison(**payload["comparison"]),
        surrogate=SurrogateReport(**payload["surrogate"]),
        urban_source=describe_urban_source(delhi_ncr_grid(), params),
        provenance=provenance,
        notes=notes,
    )


@router.get("/status", response_model=StatusResponse, summary="Forecast source and cache status")
async def forecast_status() -> StatusResponse:
    """Report upstream configuration and cache state without running a simulation."""
    described = delhi_ncr_grid().describe()
    return StatusResponse(
        meteorology_endpoint=OPEN_METEO_FORECAST_URL,
        meteorology_configured=True,
        firms_source=FIRMS_SOURCE,
        firms_map_key_configured=bool(os.getenv("FIRMS_MAP_KEY", "").strip()),
        known_firms_sources=list(KNOWN_SOURCES),
        default_center=(float(DELHI_NCR_CENTER[0]), float(DELHI_NCR_CENTER[1])),
        grid_shape=(int(described["shape"][0]), int(described["shape"][1])),
        cached_simulations=len(_simulation_cache),
        cached_fingerprints=_simulation_cache.keys(),
        last_provenance=_last_provenance,
    )
