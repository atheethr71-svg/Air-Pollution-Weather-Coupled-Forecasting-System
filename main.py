"""ASGI entrypoint for the Delhi NCR 72-hour PM2.5 forecast API.

Run it with either::

    python main.py                                  # or: make run
    uvicorn main:app --host 0.0.0.0 --port 8000     # production style
    docker build -t delhi-aqi . && docker run -p 8000:8000 delhi-aqi

Configuration (environment variables)
-------------------------------------
``HOST`` / ``PORT``      bind address for ``python main.py`` (default 0.0.0.0:8000)
``RELOAD``               set to 1 for uvicorn's autoreload during development
``CORS_ORIGINS``         comma-separated browser origins allowed to call the API;
                         defaults to the common local dashboard ports
``FIRMS_MAP_KEY``        NASA FIRMS area-API key; without it the fire layer falls
                         back to a synthetic Punjab/Haryana inventory

Interactive API docs are served at ``/docs`` (Swagger UI) and ``/redoc``;
the OpenAPI JSON is at ``/openapi.json``.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

_PROJECT_ROOT = Path(__file__).resolve().parent
if str(_PROJECT_ROOT) not in sys.path:  # keep `uvicorn main:app` cwd-independent
    sys.path.insert(0, str(_PROJECT_ROOT))

from routers.forecast import router as forecast_router  # noqa: E402

__version__ = "1.0.0"

DEFAULT_CORS_ORIGINS = (
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8501",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8501",
)

DESCRIPTION = """
Coupled aerosol-meteorology forecast for the Delhi NCR haze regime.

Live hourly meteorology (Open-Meteo) and near-real-time stubble-burning
detections (NASA FIRMS) are fed into a 50x50 mesoscale model that resolves
upwind advection, turbulent diffusion, plume injection, dry deposition and the
two-way aerosol-radiation feedback, and returns 72 hours of ground-level PM2.5.

* `GET /api/forecast/72h` — GeoJSON map layers plus dashboard metrics
* `GET /api/forecast/status` — upstream configuration and cache state
"""


def cors_origins() -> list[str]:
    """Browser origins allowed to call the API."""
    configured = os.getenv("CORS_ORIGINS", "").strip()
    if not configured:
        return list(DEFAULT_CORS_ORIGINS)
    if configured == "*":
        return ["*"]
    return [origin.strip() for origin in configured.split(",") if origin.strip()]


def create_app() -> FastAPI:
    """Build the ASGI application (also used directly by the test suite)."""
    application = FastAPI(
        title="Delhi NCR 72-hour PM2.5 forecast",
        description=DESCRIPTION,
        version=__version__,
        contact={"name": "Delhi NCR AQI forecast", "url": "https://open-meteo.com/"},
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins(),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(forecast_router)

    @application.api_route(
        "/api/interventions",
        methods=["GET", "POST"],
        include_in_schema=False,
    )
    @application.api_route(
        "/api/intervention",
        methods=["GET", "POST"],
        include_in_schema=False,
    )
    async def redirect_interventions(req: Request) -> RedirectResponse:
        url = req.url.replace(path="/api/forecast/interventions")
        return RedirectResponse(url=str(url), status_code=307)

    @application.get("/health", tags=["ops"], summary="Liveness probe")
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    return application


app = create_app()


def main() -> None:
    """Run the API with uvicorn (``python main.py``)."""
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("RELOAD", "").strip() in {"1", "true", "True", "yes"},
        log_level=os.getenv("LOG_LEVEL", "info"),
    )


if __name__ == "__main__":
    main()
