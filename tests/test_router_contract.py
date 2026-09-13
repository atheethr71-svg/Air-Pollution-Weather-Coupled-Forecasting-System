"""Contract test for the /api/forecast router.

Runs in two modes:

* **FastAPI installed** - builds a throwaway ASGI app, mounts the router and
  drives it over HTTP with ``httpx.ASGITransport``, so routing, query
  dependency resolution and response-model validation are all exercised.
* **FastAPI missing** - injects a minimal stub into ``sys.modules`` so the
  response-building logic can still be verified offline (the stub is never
  injected when the real package is importable).

Run with ``python tests/test_router_contract.py``.
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import types
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

HAVE_FASTAPI = importlib.util.find_spec("fastapi") is not None


def _install_fastapi_stub() -> None:
    """Provide just enough of FastAPI to import and call the router directly."""

    def Query(default=None, **kwargs):  # noqa: N802 - mirrors fastapi.Query
        return default

    class HTTPException(Exception):
        def __init__(self, status_code: int, detail: str = "") -> None:
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail

    class APIRouter:
        def __init__(self, prefix: str = "", tags=None, **kwargs) -> None:
            self.prefix = prefix
            self.tags = tags
            self.routes: list[tuple[str, object]] = []

        def _register(self, path: str):
            def decorator(fn):
                self.routes.append((self.prefix + path, fn))
                return fn

            return decorator

        def get(self, path: str, **kwargs):
            return self._register(path)

        def post(self, path: str, **kwargs):
            return self._register(path)

    async def run_in_threadpool(fn, *args, **kwargs):
        return await asyncio.to_thread(fn, *args, **kwargs)

    fastapi_stub = types.ModuleType("fastapi")
    fastapi_stub.Query = Query
    fastapi_stub.HTTPException = HTTPException
    fastapi_stub.APIRouter = APIRouter
    concurrency_stub = types.ModuleType("fastapi.concurrency")
    concurrency_stub.run_in_threadpool = run_in_threadpool
    sys.modules["fastapi"] = fastapi_stub
    sys.modules["fastapi.concurrency"] = concurrency_stub


if not HAVE_FASTAPI:
    _install_fastapi_stub()

from routers.forecast import (  # noqa: E402
    InterventionRequest,
    forecast_72h,
    forecast_interventions,
    forecast_status,
    router,
)
from engine.coupled_model import (  # noqa: E402
    ModelParams,
    _trailing_mean,
    aqi_value_from_pm25,
)
from services.grap import stage_for_aqi as grap_stage_for_aqi  # noqa: E402

if HAVE_FASTAPI:
    import httpx

FAILURES: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    marker = "PASS" if condition else "FAIL"
    print(f"[{marker}] {label}{(' -> ' + detail) if detail else ''}")
    if not condition:
        FAILURES.append(label)


def validate_payload(payload: dict, *, hours: int, stride: int, expected_fires: int) -> None:
    """Assertions that hold for both the stubbed and the real ASGI response."""
    check("grid shape", tuple(payload["grid"]["shape"]) == (50, 50), str(payload["grid"]["shape"]))
    check(
        "bbox is the Delhi NCR domain",
        abs(payload["bbox"]["west"] - 76.8) < 1e-9 and abs(payload["bbox"]["north"] - 28.9) < 1e-9,
        f'{payload["bbox"]["west"]}..{payload["bbox"]["east"]}',
    )
    check("timeline covers horizon", len(payload["timeline"]) == hours, str(len(payload["timeline"])))
    check("fires layer populated", len(payload["fires"]["features"]) == expected_fires, str(len(payload["fires"]["features"])))

    side = len(range(0, 50, stride))
    check("field layer strided", len(payload["pm25_field"]["features"]) == side * side, str(len(payload["pm25_field"]["features"])))
    check("fires are GeoJSON points", payload["fires"]["type"] == "FeatureCollection" and payload["fires"]["features"][0]["geometry"]["type"] == "Point")
    check("field is GeoJSON points", payload["pm25_field"]["features"][0]["geometry"]["type"] == "Point")

    fire_lon, fire_lat = payload["fires"]["features"][0]["geometry"]["coordinates"]
    check("fire coords are (lon, lat) in the burning belt", 74.5 <= fire_lon <= 76.5 and 29.5 <= fire_lat <= 31.5, f"{fire_lon}, {fire_lat}")
    cell_lon, cell_lat = payload["pm25_field"]["features"][0]["geometry"]["coordinates"]
    check("cell coords inside the model domain", 76.8 <= cell_lon <= 77.5 and 28.2 <= cell_lat <= 28.9, f"{cell_lon}, {cell_lat}")

    summary = payload["summary"]
    check("peak exceeds mean", summary["peak_pm25_episode"] > summary["mean_pm25_episode"], f'{summary["peak_pm25_episode"]} > {summary["mean_pm25_episode"]}')
    check("pbl ordering", 0 < summary["pbl_min_m"] < summary["pbl_max_m"], f'{summary["pbl_min_m"]}..{summary["pbl_max_m"]} m')
    check("suppression capped at 40 percent", 0.0 <= summary["max_pbl_suppression_fraction"] <= 0.4 + 1e-9, str(summary["max_pbl_suppression_fraction"]))
    check("mass budget closes", abs(summary["mass_budget_tonnes"]["residual"]) < 1e-3, str(summary["mass_budget_tonnes"]["residual"]))
    check("cfl reported stable", summary["cfl_stable"] is True and summary["max_courant"] <= 0.5 + 1e-9, f'courant {summary["max_courant"]}')
    check("aqi categories are CPCB classes", set(summary["aqi_category_share_percent"]) <= {"Good", "Satisfactory", "Moderate", "Poor", "Very Poor", "Severe"}, str(list(summary["aqi_category_share_percent"])))
    check("provenance discloses synthetic fires", payload["provenance"]["fire_source"] == "synthetic" and any("synthetic" in n.lower() for n in payload["provenance"]["notes"]), payload["provenance"]["notes"][0][:60])


def validate_interventions_payload(
    payload: dict,
    *,
    hours: int,
    window_hours: int,
    forecast_payload: dict | None = None,
) -> None:
    """Assertions that hold for both the stubbed and the real ASGI response."""
    summary = payload["summary"]
    comparison = payload["comparison"]
    grap = payload["grap"]
    intervention = payload["intervention"]

    check("curves cover the horizon", len(comparison["baseline_pm25_core"]) == hours, str(len(comparison["baseline_pm25_core"])))
    check("both curves present", len(comparison["mitigated_pm25_core"]) == len(comparison["baseline_pm25_core"]))
    check("AQI and PM2.5 series agree in length", len(comparison["baseline_aqi_core"]) == len(comparison["baseline_pm25_core"]))
    check("labels match the horizon", len(comparison["times_local"]) == hours, str(len(comparison["times_local"])))

    # The index must be exactly what it is documented to be: the CPCB PM2.5
    # sub-index of the causal 24-h mean of the concentration series it is drawn
    # beside.  This pins the averaging window and its causality, which is the
    # thing GRAP grading actually depends on.  (A stricter "the AQI peak must
    # *follow* the PM2.5 peak" is deliberately NOT asserted: it is not an
    # invariant -- it depends on the episode's shape, and the first hours of a
    # forecast average a partial window because there is no assimilated history
    # before hour 0.)
    aqi_series = np.asarray(comparison["baseline_aqi_core"], dtype=np.float64)
    pm_series = np.asarray(comparison["baseline_pm25_core"], dtype=np.float64)
    window_h = ModelParams().aqi_averaging_window_h
    expected_aqi = aqi_value_from_pm25(
        _trailing_mean(pm_series.reshape(-1, 1), window_h)
    ).ravel()
    deviation = float(np.max(np.abs(expected_aqi - aqi_series)))
    # Not exact: the plotted curves are rounded for presentation (AQI to 1 dp,
    # PM2.5 to 2 dp), which bounds a re-derivation at ~0.07 AQI.  A wrong or
    # acausal averaging window would deviate by tens of AQI points, so the check
    # keeps its teeth.
    check(
        f"AQI is the CPCB sub-index of the causal {window_h}-h mean it sits beside",
        deviation <= 0.1,
        f"max deviation {deviation:.4f} (rounding bound 0.1)",
    )
    check(
        "AQI is the low-pass series",
        float(np.std(aqi_series)) < float(np.std(pm_series)),
        f'std {float(np.std(aqi_series)):.1f} vs {float(np.std(pm_series)):.1f}',
    )
    check(
        "the reported maximum is the same series the chart plots",
        abs(summary["baseline_max_aqi"] - round(max(aqi_series[:window_hours]), 1)) < 1e-9,
        f'{summary["baseline_max_aqi"]} vs {max(aqi_series[:window_hours])}',
    )
    # Exact by construction: the drop is derived from the rounded maxima above, so
    # the panel can never show a headline that contradicts its own two numbers.
    check(
        "the AQI drop equals the two maxima's difference",
        abs(
            summary["max_aqi_drop"]
            - (summary["baseline_max_aqi"] - summary["mitigated_max_aqi"])
        )
        < 1e-9,
        str(summary["max_aqi_drop"]),
    )
    check(
        "the averted peak equals the two peaks' difference",
        abs(
            summary["averted_peak_pm25"]
            - (summary["baseline_peak_pm25_core"] - summary["mitigated_peak_pm25_core"])
        )
        < 0.02,
        str(summary["averted_peak_pm25"]),
    )
    check(
        "mitigation never raises the peak",
        summary["mitigated_max_aqi"] <= summary["baseline_max_aqi"] + 1e-9,
        f'{summary["baseline_max_aqi"]} -> {summary["mitigated_max_aqi"]}',
    )
    check("window is honoured", summary["window_hours"] == window_hours, str(summary["window_hours"]))

    # GRAP grading must follow from the curve it was given, not from a second
    # computation that could disagree with it.
    sequence = grap["stage_sequence"]
    check("stage sequence covers the window", len(sequence) == window_hours, str(len(sequence)))
    check("invoked stage is the worst in the window", grap["invoked_stage"] == max(sequence), f'{grap["invoked_stage"]} vs {max(sequence)}')
    check("hours by stage sum to the window", sum(grap["hours_by_stage"].values()) == len(sequence), str(grap["hours_by_stage"]))
    check(
        "invoked stage matches the reported peak",
        grap["invoked_stage"] == grap_stage_for_aqi(grap["peak_aqi"]).stage,
        f'{grap["peak_aqi"]} -> {grap["invoked_stage"]}',
    )
    check(
        "baseline stage matches the baseline AQI",
        summary["baseline_grap_stage"] == grap_stage_for_aqi(summary["baseline_max_aqi"]).stage,
    )
    check(
        "mitigated stage matches the mitigated AQI",
        summary["mitigated_grap_stage"]
        == grap_stage_for_aqi(summary["mitigated_max_aqi"]).stage,
    )
    check(
        "mitigation never worsens the stage",
        summary["mitigated_grap_stage"] <= summary["baseline_grap_stage"],
        f'{summary["baseline_grap_stage"]} -> {summary["mitigated_grap_stage"]}',
    )
    check("a stage change names the stage avoided", (summary["stage_change"] > 0) == (summary["avoids_stage"] is not None), str(summary["avoids_stage"]))
    check("actions are quoted for the invoked stage", (len(grap["actions_in_force"]) > 0) == (grap["invoked_stage"] > 0), str(len(grap["actions_in_force"])))
    if grap["next_stage"] is not None:
        check(
            "headroom is measured against the next threshold",
            abs(grap["next_stage"]["headroom"] - (grap["next_stage"]["threshold"] - grap["peak_aqi"])) < 0.11,
            str(grap["next_stage"]["headroom"]),
        )

    # Attribution arithmetic, as reported to the client.
    removed = intervention["truck_share_of_urban_source_removed"] + intervention["odd_even_share_of_urban_source_removed"]
    check(
        "urban scaling follows the attribution shares",
        abs(intervention["urban_scale"] - (1.0 - min(removed, intervention["attribution"]["traffic_share_of_urban_source"]))) < 1e-3,
        str(intervention["urban_scale"]),
    )
    check("burning scale matches the reduction", abs(intervention["stubble_scale"] - (1.0 - intervention["stubble_reduction_percent"] / 100.0)) < 1e-6)
    check("attribution shares are disclosed", len(intervention["attribution"]) == 6, str(sorted(intervention["attribution"])))

    # The surrogate's own accuracy, and the honest provenance around it.
    surrogate = payload["surrogate"]
    check("surrogate reproduces its baseline", surrogate["baseline_relative_error"] < 0.02, str(surrogate["baseline_relative_error"]))
    check("surrogate reports operator summary", "mix_retention_mean" in surrogate["operators"], str(sorted(surrogate["operators"])))
    check("pre-emption advice accompanies the grading", isinstance(summary["preemption"], dict), str(summary["preemption"])[:60])
    check("pre-emption margin is quoted", "threshold" in summary["preemption"]["rationale"], summary["preemption"]["rationale"][:80])

    # The whole point of sharing the model inputs: the baseline curve must *be*
    # the forecast the map is showing, not a second opinion about it.  It is
    # reconstructed by the reduced model rather than copied, so the tolerance is
    # the surrogate's own disclosed accuracy rather than equality.
    if forecast_payload is not None:
        timeline = forecast_payload["timeline"]
        baseline_mean = comparison["baseline_pm25_mean"]
        deltas = [
            abs(point["mean_pm25"] - value)
            for point, value in zip(timeline, baseline_mean)
        ]
        tolerance = 1.5 * surrogate["baseline_relative_error"] * max(baseline_mean) + 0.1
        check(
            "the interventions baseline is the forecast baseline within the stated error",
            max(deltas) <= tolerance,
            f"max delta {max(deltas):.3f} over {len(deltas)} h "
            f"(<= {tolerance:.3f}; disclosed {surrogate['baseline_relative_error']:.2%})",
        )

    check("provenance carried through", payload["provenance"]["forecast_hours"] == hours, str(payload["provenance"]["forecast_hours"]))
    check("urban source is described", payload["urban_source"]["peak_intensity_ug_m2_s"] > 0, str(payload["urban_source"]))


async def direct_checks() -> None:
    """FastAPI-missing mode: call the endpoint coroutines directly."""
    check("router registered all routes", len(router.routes) == 3, str([path for path, _ in router.routes]))
    check(
        "interventions route is mounted",
        any(path.endswith("/interventions") for path, _ in router.routes),
        str([path for path, _ in router.routes]),
    )

    response = await forecast_72h(offline=True, hours=24, stride=4)
    payload = json.loads(response.model_dump_json())
    validate_payload(payload, hours=24, stride=4, expected_fires=len(payload["fires"]["features"]))
    check("offline provenance", payload["provenance"]["meteorology_source"] == "synthetic")
    print(f"       payload: {len(response.model_dump_json()) / 1024:.0f} KB")

    again = await forecast_72h(offline=True, hours=24, stride=4)
    check("repeat call served from cache", again.provenance.simulation_cached, again.provenance.simulation_fingerprint)

    smoky = await forecast_72h(offline=True, hours=24, stride=10, inflow_pm25=200.0)
    check("inflow changes the fingerprint", smoky.provenance.simulation_fingerprint != response.provenance.simulation_fingerprint)
    check("more inflow raises PM2.5", smoky.summary.mean_pm25_episode > response.summary.mean_pm25_episode, f"{smoky.summary.mean_pm25_episode:.1f} vs {response.summary.mean_pm25_episode:.1f}")

    from fastapi import HTTPException

    try:
        await forecast_72h(offline=True, hours=3, hour=5)
    except HTTPException as error:
        check("hour >= horizon is rejected", error.status_code == 422, str(error.detail))
    else:
        check("hour >= horizon is rejected", False, "no exception raised")

    import routers.forecast as forecast_module
    from services.ingest import IngestError

    original = forecast_module.build_forecast_inputs

    async def failing(*args, **kwargs):
        raise IngestError("Open-Meteo forecast unavailable: simulated outage")

    forecast_module.build_forecast_inputs = failing
    try:
        await forecast_72h(hours=3)
    except HTTPException as error:
        check("upstream outage maps to 503", error.status_code == 503, str(error.detail))
    else:
        check("upstream outage maps to 503", False, "no exception raised")
    finally:
        forecast_module.build_forecast_inputs = original

    try:
        live = await forecast_72h(hours=6, stride=10, refresh=True)
    except HTTPException as error:
        print(f"[SKIP] live upstream unavailable -> {error.status_code} {error.detail}")
    else:
        check("live meteorology from Open-Meteo", live.provenance.meteorology_source == "open-meteo", live.provenance.meteorology_detail[:56])
        check("live horizon honoured", len(live.timeline) == 6, str(len(live.timeline)))
        check("timeline anchored to local clock", live.timeline[0].time_local[11:13].isdigit(), live.timeline[0].time_local)
        check("FIRMS fallback disclosed", any("FIRMS_MAP_KEY" in n for n in live.provenance.notes), str(live.provenance.notes)[:60])
        check("live summary finite", live.summary.peak_pm25_episode > 0, f'peak {live.summary.peak_pm25_episode}')

    # Asserted before the scenario runs below, which would otherwise add their
    # own (correct) entries and make the count meaningless.
    status = await forecast_status()
    check("status endpoint", status.status == "ok" and status.grid_shape == (50, 50))
    check("refresh evicted stale simulations", status.cached_simulations == 1, f"{status.cached_simulations} cached")
    check("firms config reported", status.firms_source == "VIIRS_SNPP_NRT" and status.firms_map_key_configured is False)

    # Offline, so the baseline shares its meteorology with the `payload` above:
    # comparing a live scenario against a synthetic forecast would be measuring
    # the weather, not the surrogate.
    scenario = await forecast_interventions(
        InterventionRequest(stubble_reduction=0.8, truck_restriction="bs4_banned", odd_even=True),
        hours=24,
        window_hours=24,
        offline=True,
    )
    validate_interventions_payload(
        json.loads(scenario.model_dump_json()),
        hours=24,
        window_hours=24,
        forecast_payload=payload,
    )
    check(
        "levers reach the emission terms",
        scenario.intervention.stubble_scale < 1.0 and scenario.intervention.urban_scale < 1.0,
        f'stubble {scenario.intervention.stubble_scale}, urban {scenario.intervention.urban_scale}',
    )

    calm = await forecast_interventions(
        InterventionRequest(), hours=24, window_hours=24, offline=True
    )
    check(
        "a no-op scenario is the baseline",
        abs(calm.summary.averted_peak_pm25) < 1e-6 and calm.summary.stage_change == 0,
        f'averted {calm.summary.averted_peak_pm25}',
    )
    check(
        "an idle scenario is not graded as an escalation",
        calm.grap.invoked_stage == calm.summary.baseline_grap_stage,
        f'{calm.grap.invoked_stage} vs {calm.summary.baseline_grap_stage}',
    )


async def asgi_checks() -> None:
    """FastAPI-installed mode: drive the real application over HTTP."""
    from main import app, create_app

    check("app factory builds", create_app().title.startswith("Delhi NCR"), app.title)
    # NB: FastAPI >= 0.141 keeps included routers as _IncludedRouter entries in
    # app.routes, so the mounted paths are asserted through the OpenAPI schema.
    mounted = sorted(app.openapi()["paths"])
    check("router mounted on the app", "/api/forecast/72h" in mounted and "/api/forecast/status" in mounted, str(mounted))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get(
            "/api/forecast/72h", params={"offline": True, "hours": 24, "stride": 4}
        )
        check("GET /api/forecast/72h -> 200", response.status_code == 200, f"{response.status_code} {response.text[:120]}")
        payload = response.json()
        validate_payload(payload, hours=24, stride=4, expected_fires=len(payload["fires"]["features"]))
        print(f"       HTTP payload: {len(response.content) / 1024:.0f} KB")

        cached = await client.get(
            "/api/forecast/72h", params={"offline": True, "hours": 24, "stride": 4}
        )
        check("second HTTP call served from cache", cached.json()["provenance"]["simulation_cached"] is True)

        bad = await client.get("/api/forecast/72h", params={"offline": True, "hours": 3, "hour": 9})
        check("invalid hour -> 422", bad.status_code == 422, str(bad.json())[:80])

        filtered = await client.get(
            "/api/forecast/72h",
            params={"offline": True, "hours": 24, "stride": 4, "min_pm25": 120.0},
        )
        check("min_pm25 filters the field layer", len(filtered.json()["pm25_field"]["features"]) < len(payload["pm25_field"]["features"]))

        status = await client.get("/api/forecast/status")
        check("GET /api/forecast/status -> 200", status.status_code == 200)
        check("status payload", status.json()["grid_shape"] == [50, 50])

        probe = await client.get("/health")
        check("GET /health -> 200", probe.status_code == 200 and probe.json()["status"] == "ok", str(probe.json()))

        cors = await client.get("/health", headers={"Origin": "http://localhost:5173"})
        check("CORS header for the dashboard origin", cors.headers.get("access-control-allow-origin") == "http://localhost:5173", str(cors.headers.get("access-control-allow-origin")))

        scenario_response = await client.post(
            "/api/forecast/interventions",
            params={"offline": True, "hours": 24, "window_hours": 24},
            json={"stubble_reduction": 0.8, "truck_restriction": "bs4_banned", "odd_even": True},
        )
        check(
            "POST /api/forecast/interventions -> 200",
            scenario_response.status_code == 200,
            f"{scenario_response.status_code} {scenario_response.text[:140]}",
        )
        validate_interventions_payload(
            scenario_response.json(), hours=24, window_hours=24, forecast_payload=payload
        )
        scenario_payload = scenario_response.json()
        check(
            "the levers reach the emission terms",
            scenario_payload["intervention"]["stubble_scale"] < 1.0
            and scenario_payload["intervention"]["urban_scale"] < 1.0
            and scenario_payload["summary"]["max_aqi_drop"] > 0.0,
            f'stubble {scenario_payload["intervention"]["stubble_scale"]}, '
            f'urban {scenario_payload["intervention"]["urban_scale"]}, '
            f'drop {scenario_payload["summary"]["max_aqi_drop"]}',
        )

        # A scenario with no lever engaged is not a scenario at all: it must
        # reproduce the baseline bit-for-bit, or the panel's "averted" figure
        # would be measuring the surrogate rather than the intervention.
        noop = await client.post(
            "/api/forecast/interventions",
            params={"offline": True, "hours": 24, "window_hours": 24},
            json={},
        )
        check("an empty scenario body -> 200", noop.status_code == 200, str(noop.json())[:90])
        noop_payload = noop.json()
        check(
            "a no-op scenario averts nothing",
            noop_payload["summary"]["averted_peak_pm25"] == 0.0
            and noop_payload["summary"]["max_aqi_drop"] == 0.0
            and noop_payload["summary"]["stage_change"] == 0,
            f'averted {noop_payload["summary"]["averted_peak_pm25"]}, '
            f'drop {noop_payload["summary"]["max_aqi_drop"]}',
        )
        check(
            "a no-op scenario reproduces the baseline curve exactly",
            noop_payload["comparison"]["mitigated_pm25_core"]
            == noop_payload["comparison"]["baseline_pm25_core"],
            f'{noop_payload["comparison"]["mitigated_pm25_core"][:2]}',
        )
        check(
            "a no-op scenario is not graded as an escalation",
            noop_payload["grap"]["invoked_stage"]
            == noop_payload["summary"]["baseline_grap_stage"],
            f'{noop_payload["grap"]["invoked_stage"]}',
        )
        check(
            "a no-op scenario engages no probe run",
            any("raw reduction" in note for note in noop_payload["notes"]),
            str(noop_payload["notes"])[-120:],
        )

        bad_lever = await client.post(
            "/api/forecast/interventions",
            params={"offline": True, "hours": 24},
            json={"stubble_reduction": 0.8, "truck_restriction": "total_ban"},
        )
        check("an unknown lever value -> 422", bad_lever.status_code == 422, str(bad_lever.json())[:90])

        bad_window = await client.post(
            "/api/forecast/interventions",
            params={"offline": True, "hours": 12, "window_hours": 48},
            json={},
        )
        check("window longer than the horizon -> 422", bad_window.status_code == 422, str(bad_window.json())[:90])

        schema = (await client.get("/openapi.json")).json()
        check("response model in the OpenAPI schema", "Forecast72hResponse" in json.dumps(schema), "Forecast72hResponse")
        check("interventions model in the OpenAPI schema", "InterventionsResponse" in json.dumps(schema))
        fields = schema["components"]["schemas"]["SummaryMetrics"]["properties"]
        check("schema exposes summary metrics", {"peak_pm25_episode", "mass_budget_tonnes", "cfl_stable"} <= set(fields), str(sorted(fields))[:70])


async def main() -> None:
    mode = "real FastAPI over ASGI" if HAVE_FASTAPI else "stubbed fastapi"
    print(f"running router contract test ({mode})\n")
    if HAVE_FASTAPI:
        await asgi_checks()
    else:
        await direct_checks()
    print()
    if FAILURES:
        print(f"{len(FAILURES)} check(s) failed: {FAILURES}")
        raise SystemExit(1)
    print("all router contract checks passed")


if __name__ == "__main__":
    asyncio.run(main())
