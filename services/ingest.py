"""Ingestion layer for the Delhi NCR 72-hour coupled PM2.5 forecast.

Two upstreams feed the coupled model:

* **Open-Meteo** (``api.open-meteo.com``) supplies hourly forecast meteorology at
  the Delhi NCR centre: 2 m temperature, surface pressure, 10 m wind speed and
  direction, boundary-layer height and 2 m relative humidity.  Wind speed is
  requested in m/s and temperatures are converted to Kelvin, because the
  coupled model works in SI and validates the sounding range.  The 850 hPa
  temperature is fetched as well so that the model's inversion strength index
  (T2m / T850) is computed from a real sounding rather than a fallback.
* **NASA FIRMS** (``firms.modaps.eosdis.nasa.gov``) supplies near-real-time
  active-fire detections over the Punjab / Haryana residue-burning belt
  (29.5-31.5 N, 74.5-76.5 E).  Without ``FIRMS_MAP_KEY`` the client falls back
  to a synthetic inventory clustered on the real burning districts, so the API
  is fully usable without credentials.

Everything here is deliberately dependency-light (``httpx`` + NumPy) and
degrades gracefully: a failed upstream yields a warning and a documented
fallback rather than an exception, except for the meteorology that the router
explicitly asks to be live.
"""

from __future__ import annotations

import asyncio
import csv
import io
import logging
import math
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Mapping, Sequence

import httpx
import numpy as np

log = logging.getLogger(__name__)

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------
DELHI_NCR_CENTER = (28.6139, 77.2090)

#: India Standard Time is a fixed UTC+05:30 offset (no daylight saving), so the
#: offset is applied explicitly and no system tz database is required.
IST = timezone(timedelta(hours=5, minutes=30))

OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
FIRMS_AREA_URL = (
    "https://firms.modaps.eosdis.nasa.gov/api/area/csv/"
    "{map_key}/{source}/{area}/{day_range}/{date}"
)

#: (west, south, east, north) of the Punjab / Haryana residue-burning belt.
STUBBLE_BBOX = (74.5, 29.5, 76.5, 31.5)

#: Open-Meteo hourly variables.  The first six are the requested fields; the
#: 850 hPa temperature and precipitation are included because the coupled model
#: uses them for the inversion index and for wet scavenging.
HOURLY_VARIABLES: tuple[str, ...] = (
    "temperature_2m",
    "surface_pressure",
    "wind_speed_10m",
    "wind_direction_10m",
    "boundary_layer_height",
    "relative_humidity_2m",
    "temperature_850hPa",
    "precipitation",
)

#: Model input names, mapped from the Open-Meteo hourly keys.
FIRMS_DEFAULT_SOURCE = "VIIRS_SNPP_NRT"
FIRMS_SOURCE = os.getenv("FIRMS_SOURCE", FIRMS_DEFAULT_SOURCE)
FORECAST_HOURS = 72
HTTP_TIMEOUT_SECONDS = 15.0
HTTP_ATTEMPTS = 3
HTTP_BACKOFF_SECONDS = 0.5
INGEST_CACHE_TTL_SECONDS = 900.0

#: District centroids inside the bbox, weighted by typical residue-burning
#: intensity, used only to place the synthetic fallback inventory realistically.
_BURNING_DISTRICTS: tuple[tuple[float, float, float], ...] = (
    (30.24, 75.84, 1.00),  # Sangrur, Punjab
    (30.21, 74.95, 0.90),  # Bathinda, Punjab
    (30.82, 75.17, 0.80),  # Moga, Punjab
    (30.93, 74.62, 0.75),  # Firozpur, Punjab
    (30.34, 76.39, 0.70),  # Patiala, Punjab
    (30.90, 75.85, 0.65),  # Ludhiana, Punjab
    (29.53, 75.03, 0.60),  # Sirsa, Haryana
    (29.51, 75.45, 0.55),  # Fatehabad, Haryana
    (29.80, 76.40, 0.50),  # Kaithal, Haryana
    (29.32, 76.31, 0.45),  # Jind, Haryana
)


class IngestError(RuntimeError):
    """Raised when an upstream call fails and no fallback is permitted."""


# --------------------------------------------------------------------------
# Data containers
# --------------------------------------------------------------------------
@dataclass
class ForecasterWindows:
    """Hourly meteorology reshaped into the coupled model's input contract."""

    weather: dict[str, np.ndarray]  # u, v, pbl_height, t2m, t850, precip
    times_local: list[str]
    start_hour_local: float
    hours: int
    source: str  # "open-meteo" | "synthetic"
    detail: str = ""
    units: dict[str, str] = field(default_factory=dict)

    @property
    def total_hours(self) -> int:
        return int(len(self.times_local))


@dataclass
class FireDetection:
    """One active-fire pixel."""

    latitude: float
    longitude: float
    frp: float
    acquired: str | None = None
    confidence: str | None = None
    satellite: str | None = None

    def as_feature_properties(self) -> dict[str, Any]:
        return {
            "frp": round(float(self.frp), 3),
            "acquired": self.acquired,
            "confidence": self.confidence,
            "satellite": self.satellite,
        }


@dataclass
class FireInventory:
    """Active-fire inventory plus provenance."""

    detections: list[FireDetection]
    source: str  # "firms" | "synthetic"
    detail: str = ""
    total_frp_mw: float = 0.0

    @property
    def count(self) -> int:
        return len(self.detections)

    @property
    def points(self) -> np.ndarray:
        """(N, 3) array of (latitude, longitude, FRP) as the model expects."""
        if not self.detections:
            return np.zeros((0, 3), dtype=np.float64)
        return np.array(
            [(d.latitude, d.longitude, d.frp) for d in self.detections],
            dtype=np.float64,
        )


@dataclass
class IngestBundle:
    """Everything the simulation needs, with provenance for the dashboard."""

    windows: ForecasterWindows
    fires: FireInventory
    initial_pm25: np.ndarray
    warnings: list[str] = field(default_factory=list)
    generated_at: str = ""

    def provenance(self) -> dict[str, Any]:
        return {
            "meteorology_source": self.windows.source,
            "meteorology_detail": self.windows.detail,
            "fire_source": self.fires.source,
            "fire_detail": self.fires.detail,
            "fire_detections": self.fires.count,
            "total_frp_mw": round(float(self.fires.total_frp_mw), 2),
            "forecast_start_local": self.windows.times_local[0]
            if self.windows.times_local
            else None,
            "forecast_hours": self.windows.hours,
            "generated_at": self.generated_at,
            "warnings": list(self.warnings),
        }


# --------------------------------------------------------------------------
# Small async helpers
# --------------------------------------------------------------------------
class TTLCache:
    """Minimal in-process TTL cache (single worker, best effort)."""

    def __init__(self, ttl_seconds: float) -> None:
        self._ttl = float(ttl_seconds)
        self._entries: dict[Any, tuple[float, Any]] = {}

    def get(self, key: Any) -> Any | None:
        entry = self._entries.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if time.monotonic() >= expires_at:
            self._entries.pop(key, None)
            return None
        return value

    def set(self, key: Any, value: Any) -> None:
        self._entries[key] = (time.monotonic() + self._ttl, value)

    def keys(self) -> list[Any]:
        return list(self._entries.keys())

    def __len__(self) -> int:
        return len(self._entries)

    def clear(self) -> None:
        self._entries.clear()


async def _get_with_retries(
    client: httpx.AsyncClient,
    url: str,
    *,
    params: Mapping[str, Any] | None = None,
    attempts: int = HTTP_ATTEMPTS,
) -> httpx.Response:
    """GET with bounded exponential backoff on transport/5xx failures."""
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            response = await client.get(url, params=params)
            if response.status_code >= 500:
                raise httpx.HTTPStatusError(
                    f"upstream {response.status_code}",
                    request=response.request,
                    response=response,
                )
            return response
        except (httpx.TransportError, httpx.HTTPStatusError) as error:
            last_error = error
            if attempt < attempts - 1:
                await asyncio.sleep(HTTP_BACKOFF_SECONDS * 2**attempt)
    raise IngestError(f"GET {url} failed after {attempts} attempts: {last_error}")


def _open_meteo_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(HTTP_TIMEOUT_SECONDS),
        headers={"User-Agent": "freebuff-delhi-aqi-forecast/1.0"},
        follow_redirects=True,
    )


# --------------------------------------------------------------------------
# Meteorology
# --------------------------------------------------------------------------
def wind_components(
    speed: Sequence[float] | np.ndarray, direction_deg: Sequence[float] | np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Convert meteorological speed/direction into eastward (u) and northward (v).

    Meteorological direction is the bearing the wind blows *from*, so a 270 deg
    wind is westerly and yields ``u > 0``.
    """
    speed_array = np.asarray(speed, dtype=np.float64)
    theta = np.deg2rad(np.asarray(direction_deg, dtype=np.float64))
    return -speed_array * np.sin(theta), -speed_array * np.cos(theta)


def _now_ist() -> datetime:
    return datetime.now(timezone.utc).astimezone(IST)


def _select_forward_window(
    times: Sequence[str], now_ist: datetime, hours: int
) -> tuple[int, list[str]]:
    """Index of the first forecast hour at or after *now* and its time labels.

    Open-Meteo returns whole local days, so the leading hours can already be in
    the past; starting the horizon at the current hour keeps the endpoint an
    honest forward forecast.
    """
    parsed: list[datetime] = []
    for stamp in times:
        try:
            parsed.append(datetime.fromisoformat(stamp))
        except ValueError:
            parsed.append(now_ist)
    start = 0
    for index, moment in enumerate(parsed):
        if moment.replace(tzinfo=IST) >= now_ist.replace(minute=0, second=0, microsecond=0):
            start = index
            break
    if len(parsed) - start < hours:
        # Pad by repeating the final hour so the model always receives `hours`.
        labels = list(times[start:])
        while len(labels) < hours:
            labels.append(labels[-1])
        return start, labels
    return start, list(times[start : start + hours])


async def fetch_forecast_meteorology(
    latitude: float = DELHI_NCR_CENTER[0],
    longitude: float = DELHI_NCR_CENTER[1],
    *,
    hours: int = FORECAST_HOURS,
    client: httpx.AsyncClient | None = None,
) -> ForecasterWindows:
    """Fetch an hourly 72 h forecast from Open-Meteo for the given point."""
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "hourly": ",".join(HOURLY_VARIABLES),
        "wind_speed_unit": "ms",
        "timezone": "Asia/Kolkata",
        "forecast_days": 4,  # 96 h, so a full 72 h window remains after "now"
        "past_days": 0,
    }
    owns_client = client is None
    client = client or _open_meteo_client()
    try:
        response = await _get_with_retries(client, OPEN_METEO_FORECAST_URL, params=params)
    finally:
        if owns_client:
            await client.aclose()

    if response.status_code != 200:
        raise IngestError(
            f"Open-Meteo returned HTTP {response.status_code}: {response.text[:200]}"
        )
    payload = response.json()
    hourly = payload.get("hourly") or {}
    times = hourly.get("time") or []
    if len(times) < hours:
        raise IngestError(f"Open-Meteo returned {len(times)} hours, need {hours}")

    start, labels = _select_forward_window(times, _now_ist(), hours)

    def series(name: str, default: float | None = None) -> np.ndarray:
        raw = hourly.get(name)
        if raw is None:
            if default is None:
                raise IngestError(f"Open-Meteo response is missing hourly '{name}'")
            return np.full(hours, float(default))
        window = list(raw[start : start + hours])
        while len(window) < hours:
            window.append(window[-1] if window else 0.0)
        values = np.array(
            [np.nan if value is None else float(value) for value in window], dtype=np.float64
        )
        return np.nan_to_num(values, nan=float(default if default is not None else 0.0))

    speed = series("wind_speed_10m")
    direction = series("wind_direction_10m")
    u, v = wind_components(speed, direction)

    notes: list[str] = []
    t2m_c = series("temperature_2m")
    if hourly.get("temperature_850hPa"):
        t850_c = series("temperature_850hPa")
    else:
        t850_c = t2m_c
        notes.append(
            "temperature_850hPa absent upstream; the inversion index falls back "
            "to the 2 m temperature and will read as near-isothermal"
        )

    pbl = np.clip(series("boundary_layer_height", 400.0), 50.0, 4000.0)
    precip = np.clip(series("precipitation", 0.0), 0.0, None)

    start_hour_local = _hour_from_label(labels[0])
    weather = {
        "u": u,
        "v": v,
        "pbl_height": pbl,
        "t2m": t2m_c + 273.15,  # the model validates kelvin
        "t850": t850_c + 273.15,
        "precip": precip,
    }
    units = {
        "u": "m/s",
        "v": "m/s",
        "pbl_height": "m",
        "t2m": "K",
        "t850": "K",
        "precip": "mm/h",
    }
    detail = f"{latitude:.4f}, {longitude:.4f} via Open-Meteo hourly forecast"
    if notes:
        detail = f"{detail}; {'; '.join(notes)}"
    return ForecasterWindows(
        weather=weather,
        times_local=labels,
        start_hour_local=start_hour_local,
        hours=len(labels),
        source="open-meteo",
        detail=detail,
        units=units,
    )


def _hour_from_label(label: str) -> float:
    """Local (IST) hour of an ISO timestamp label, for the fire diurnal cycle."""
    try:
        moment = datetime.fromisoformat(label)
    except ValueError:
        return 0.0
    return float(moment.hour) + moment.minute / 60.0


def synthetic_forecast_windows(
    hours: int = FORECAST_HOURS, *, start_hour_local: float | None = None, seed: int = 11
) -> ForecasterWindows:
    """Offline stand-in for the Open-Meteo forecast (used only on request).

    Reproduces the defining feature of the winter Delhi regime: a shallow
    nocturnal boundary layer with a surface inversion decoupling from a deep
    well-mixed afternoon layer, under north-westerly transport from the burning
    belt.  The window starts at the current local hour so the offline timeline
    is as plausible as the live one.
    """
    rng = np.random.default_rng(seed)
    start_moment = _now_ist().replace(minute=0, second=0, microsecond=0)
    if start_hour_local is None:
        start_hour_local = float(start_moment.hour)
    hour_index = np.arange(hours, dtype=np.float64)
    local_hour = np.mod(start_hour_local + hour_index, 24.0)
    phase = np.mod(local_hour - 15.0 + 12.0, 24.0) - 12.0
    daytime = np.exp(-0.5 * (phase / 3.2) ** 2)

    speed = 1.4 + 1.6 * daytime + 0.3 * rng.standard_normal(hours)
    direction = 300.0 + 20.0 * np.sin(2.0 * np.pi * hour_index / 48.0)
    u, v = wind_components(np.clip(speed, 0.2, None), direction)

    times = [
        (start_moment + timedelta(hours=float(t))).isoformat() for t in range(hours)
    ]
    weather = {
        "u": u,
        "v": v,
        "pbl_height": 150.0 + 1700.0 * daytime,
        "t2m": 273.15 + 6.0 + 9.0 * daytime,
        "t850": 273.15 + 14.0 + 1.5 * np.sin(2.0 * np.pi * hour_index / 24.0),
        "precip": np.zeros(hours),
    }
    return ForecasterWindows(
        weather=weather,
        times_local=times,
        start_hour_local=float(start_hour_local),
        hours=hours,
        source="synthetic",
        detail="offline synthetic winter Delhi regime (no network call)",
        units={
            "u": "m/s",
            "v": "m/s",
            "pbl_height": "m",
            "t2m": "K",
            "t850": "K",
            "precip": "mm/h",
        },
    )


# --------------------------------------------------------------------------
# Stubble-burning fires
# --------------------------------------------------------------------------
def _synthetic_fire_inventory(
    *, count: int = 260, seed: int = 7
) -> FireInventory:
    """Generate a realistic Punjab/Haryana burning inventory.

    Detections are clustered on the districts that dominate residue burning,
    with a log-normal FRP distribution (median ~9 MW) matching VIIRS
    crop-residue fire detections.
    """
    rng = np.random.default_rng(seed)
    weights = np.array([district[2] for district in _BURNING_DISTRICTS], dtype=np.float64)
    weights = weights / weights.sum()
    picks = rng.choice(len(_BURNING_DISTRICTS), size=count, p=weights)

    detections: list[FireDetection] = []
    for district_index in picks:
        centre_lat, centre_lon, _ = _BURNING_DISTRICTS[int(district_index)]
        latitude = centre_lat + 0.13 * rng.standard_normal()
        longitude = centre_lon + 0.13 * rng.standard_normal()
        if not (
            STUBBLE_BBOX[1] <= latitude <= STUBBLE_BBOX[3]
            and STUBBLE_BBOX[0] <= longitude <= STUBBLE_BBOX[2]
        ):
            continue
        frp = float(np.clip(rng.lognormal(mean=2.2, sigma=0.8), 0.5, 300.0))
        hour = int(np.clip(rng.normal(14.5, 2.5), 0, 23))
        detections.append(
            FireDetection(
                latitude=float(latitude),
                longitude=float(longitude),
                frp=frp,
                acquired=f"{(datetime.now(IST) - timedelta(days=1)).date()} {hour:02d}:00 IST",
                confidence="nominal",
                satellite="synthetic",
            )
        )
    total = float(sum(d.frp for d in detections))
    return FireInventory(
        detections=detections,
        source="synthetic",
        detail=(
            "FIRMS_MAP_KEY not set: generated clustered detections over the "
            f"Punjab/Haryana burning belt {STUBBLE_BBOX} "
            f"({len(detections)} of {count} candidates inside bounds)"
        ),
        total_frp_mw=total,
    )


def _parse_firms_csv(text: str) -> list[FireDetection]:
    """Parse the FIRMS area CSV into detections, tolerating column variants."""
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        return []
    fields = {name.strip().lower(): name for name in reader.fieldnames}

    def pick(row: Mapping[str, str], *candidates: str) -> str | None:
        for candidate in candidates:
            column = fields.get(candidate)
            if column is not None:
                value = (row.get(column) or "").strip()
                if value:
                    return value
        return None

    detections: list[FireDetection] = []
    for row in reader:
        latitude = pick(row, "latitude", "lat")
        longitude = pick(row, "longitude", "lon", "lng", "long")
        if latitude is None or longitude is None:
            continue
        try:
            lat_value = float(latitude)
            lon_value = float(longitude)
        except ValueError:
            continue
        frp_text = pick(row, "frp", "fire_radiative_power", "power")
        try:
            frp = float(frp_text) if frp_text is not None else 0.0
        except ValueError:
            frp = 0.0
        if not math.isfinite(frp) or frp <= 0.0:
            frp = 0.0
        date = pick(row, "acq_date") or ""
        time_text = pick(row, "acq_time") or ""
        acquired = f"{date} {time_text}".strip() or None
        detections.append(
            FireDetection(
                latitude=lat_value,
                longitude=lon_value,
                frp=frp,
                acquired=acquired,
                confidence=pick(row, "confidence", "conf"),
                satellite=pick(row, "satellite", "instrument"),
            )
        )
    return detections


async def fetch_active_fires(
    *,
    map_key: str | None = None,
    source: str = FIRMS_SOURCE,
    day_range: int = 2,
    client: httpx.AsyncClient | None = None,
    allow_synthetic_fallback: bool = True,
    synthetic_count: int = 260,
    seed: int = 7,
) -> FireInventory:
    """Fetch active-fire detections over the stubble-burning belt.

    Falls back to a synthetic (but geographically realistic) inventory when no
    ``FIRMS_MAP_KEY`` is configured or when FIRMS is unreachable and
    ``allow_synthetic_fallback`` is set.
    """
    key = map_key if map_key is not None else os.getenv("FIRMS_MAP_KEY", "").strip()
    if not key:
        return _synthetic_fire_inventory(count=synthetic_count, seed=seed)

    # Sampling backwards from yesterday guarantees a full day of coverage
    # regardless of the local time of the request.
    start_date = (_now_ist() - timedelta(days=1)).date().isoformat()
    area = ",".join(f"{value:.4f}" for value in STUBBLE_BBOX)
    url = FIRMS_AREA_URL.format(
        map_key=key, source=source, area=area, day_range=int(day_range), date=start_date
    )
    owns_client = client is None
    client = client or httpx.AsyncClient(
        timeout=httpx.Timeout(HTTP_TIMEOUT_SECONDS),
        headers={"User-Agent": "freebuff-delhi-aqi-forecast/1.0"},
        follow_redirects=True,
    )
    try:
        try:
            response = await _get_with_retries(client, url)
            if response.status_code != 200:
                raise IngestError(f"FIRMS returned HTTP {response.status_code}")
            detections = _parse_firms_csv(response.text)
            if not detections:
                raise IngestError("FIRMS returned no parsable detections")
        except (IngestError, httpx.HTTPError) as error:
            log.warning("FIRMS ingestion failed: %s", error)
            if not allow_synthetic_fallback:
                raise IngestError(f"FIRMS ingestion failed: {error}") from error
            inventory = _synthetic_fire_inventory(count=synthetic_count, seed=seed)
            inventory.detail = f"FIRMS unavailable ({error}); used synthetic inventory"
            return inventory
    finally:
        if owns_client:
            await client.aclose()

    total = float(sum(d.frp for d in detections))
    return FireInventory(
        detections=detections,
        source="firms",
        detail=f"{source} area {area}, {day_range} day(s) from {start_date}",
        total_frp_mw=total,
    )


# --------------------------------------------------------------------------
# Initial state and orchestration
# --------------------------------------------------------------------------
def bootstrap_pm25_field(
    grid_shape: tuple[int, int],
    *,
    background: float = 40.0,
    urban_increment: float = 110.0,
    centre: tuple[float, float] = DELHI_NCR_CENTER,
    extent: tuple[float, float, float, float] = (28.2, 76.8, 28.9, 77.5),
) -> np.ndarray:
    """Build a starting PM2.5 field: rural background plus an urban dome.

    There is no observed initial condition in the request path, so the episode
    starts from a documented climatological field centered on the Delhi core.
    """
    lat_min, lon_min, lat_max, lon_max = extent
    latitude = np.linspace(lat_min, lat_max, grid_shape[0])[:, None]
    longitude = np.linspace(lon_min, lon_max, grid_shape[1])[None, :]
    dome = np.exp(
        -0.5
        * (
            ((latitude - centre[0]) / 0.11) ** 2
            + ((longitude - centre[1]) / 0.13) ** 2
        )
    )
    return background + urban_increment * dome


#: Upstream payloads change hourly (Open-Meteo) or a few times a day (FIRMS),
#: so a short TTL keeps the dashboard responsive without serving stale smoke.
_INGEST_CACHE = TTLCache(INGEST_CACHE_TTL_SECONDS)


def clear_ingest_cache() -> None:
    """Drop cached upstream payloads (used by ``?refresh=true``)."""
    _INGEST_CACHE.clear()


async def build_forecast_inputs(
    latitude: float = DELHI_NCR_CENTER[0],
    longitude: float = DELHI_NCR_CENTER[1],
    *,
    hours: int = FORECAST_HOURS,
    grid_shape: tuple[int, int] = (50, 50),
    firms_map_key: str | None = None,
    offline: bool = False,
    initial_background: float = 40.0,
    initial_urban_increment: float = 110.0,
    allow_synthetic_fires: bool = True,
    synthetic_fire_count: int = 260,
    refresh: bool = False,
) -> IngestBundle:
    """Fetch meteorology and fires concurrently and assemble the model inputs.

    Results are memoised for ``INGEST_CACHE_TTL_SECONDS``; pass ``refresh=True``
    to bypass and repopulate the cache.
    """
    cache_key = (
        round(float(latitude), 4),
        round(float(longitude), 4),
        int(hours),
        bool(offline),
        round(float(initial_background), 3),
        round(float(initial_urban_increment), 3),
        int(synthetic_fire_count),
    )
    if not refresh:
        cached = _INGEST_CACHE.get(cache_key)
        if cached is not None:
            return cached

    bundle_warnings: list[str] = []
    if offline:
        # Demo mode must not touch the network at all: both inputs are local.
        windows = synthetic_forecast_windows(hours=hours)
        fires = _synthetic_fire_inventory(count=synthetic_fire_count)
        fires.detail = (
            "offline mode: synthetic inventory clustered over the Punjab/Haryana "
            f"burning belt {STUBBLE_BBOX}"
        )
        bundle_warnings.append("offline mode: synthetic meteorology and fire inventory")
    else:
        fire_task = asyncio.create_task(
            fetch_active_fires(
                map_key=firms_map_key,
                allow_synthetic_fallback=allow_synthetic_fires,
                synthetic_count=synthetic_fire_count,
            )
        )
        try:
            windows = await fetch_forecast_meteorology(latitude, longitude, hours=hours)
        except (IngestError, httpx.HTTPError, ValueError) as error:
            fire_task.cancel()
            raise IngestError(f"Open-Meteo forecast unavailable: {error}") from error
        fires = await fire_task
        if fires.source == "synthetic":
            # Never let a fabricated inventory masquerade as observations.
            bundle_warnings.append(fires.detail)

    if not fires.detections:
        bundle_warnings.append("no active-fire detections were available")

    initial = bootstrap_pm25_field(
        grid_shape,
        background=initial_background,
        urban_increment=initial_urban_increment,
    )
    bundle = IngestBundle(
        windows=windows,
        fires=fires,
        initial_pm25=initial,
        warnings=bundle_warnings,
        generated_at=_now_ist().isoformat(),
    )
    _INGEST_CACHE.set(cache_key, bundle)
    return bundle
