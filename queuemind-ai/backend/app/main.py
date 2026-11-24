import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.database.session import engine, Base, get_db, SessionLocal
from app.services.demo_service import seed_database_if_empty, demo_ticker
from app.services.aws_service import aws_service

# Routers
from app.api.auth import router as auth_router
from app.api.facilities import router as facilities_router
from app.api.dashboard import router as dashboard_router
from app.api.detection import router as detection_router
from app.api.queues import router as queues_router
from app.api.counters import router as counters_router
from app.api.predictions import router as predictions_router
from app.api.agent import router as agent_router
from app.api.alerts import router as alerts_router
from app.api.analytics import router as analytics_router
from app.api.websockets import router as websockets_router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("queuemind.main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Create tables and seed data
    logger.info("Initializing QueueMind AI tables and schemas...")
    Base.metadata.create_all(bind=engine)

    # Seed data
    db = SessionLocal()
    try:
        seed_database_if_empty(db)
    finally:
        db.close()

    # Launch background simulation ticker for dynamic demo updates
    ticker_task = None
    if settings.DEMO_MODE:
        logger.info("Demo mode active: Starting background queue dynamics simulation ticker.")
        ticker_task = asyncio.create_task(demo_ticker.start(get_db))

    yield

    # Shutdown
    if ticker_task:
        demo_ticker.stop()
        ticker_task.cancel()
    logger.info("QueueMind AI backend shutdown complete.")

app = FastAPI(
    title="QueueMind AI – Smart Queue Monitoring & Predictive Management System",
    description="Enterprise Browser-based AI Operations Agent & Queue Intelligence API",
    version=settings.VERSION,
    lifespan=lifespan
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Routers
app.include_router(auth_router, prefix=settings.API_V1_STR)
app.include_router(facilities_router, prefix=settings.API_V1_STR)
app.include_router(dashboard_router, prefix=settings.API_V1_STR)
app.include_router(detection_router, prefix=settings.API_V1_STR)
app.include_router(queues_router, prefix=settings.API_V1_STR)
app.include_router(counters_router, prefix=settings.API_V1_STR)
app.include_router(predictions_router, prefix=settings.API_V1_STR)
app.include_router(agent_router, prefix=settings.API_V1_STR)
app.include_router(alerts_router, prefix=settings.API_V1_STR)
app.include_router(analytics_router, prefix=settings.API_V1_STR)
app.include_router(websockets_router)

@app.get("/")
def root():
    return {
        "app": "QueueMind AI",
        "tagline": "Smarter Queues. Shorter Waits. Better Experiences.",
        "status": "operational",
        "version": settings.VERSION,
        "docs_url": "/docs",
        "demo_mode": settings.DEMO_MODE,
        "aws_status": aws_service.get_aws_status()
    }

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": "QueueMind-AI-Core",
        "demo_mode": settings.DEMO_MODE,
        "aws": aws_service.get_aws_status()
    }
