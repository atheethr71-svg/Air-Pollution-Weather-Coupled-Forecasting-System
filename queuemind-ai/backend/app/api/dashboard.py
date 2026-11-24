from datetime import datetime, timezone, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.models import Facility, Queue, Counter, QueueHistory, CrowdDetection
from app.schemas.schemas import DashboardOverviewOut, TrendPointOut
from app.ai_engine.prediction.wait_time_model import wait_time_engine
from app.services.aws_service import aws_service
from app.core.config import settings

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

def resolve_facility(db: Session, facility_id: Optional[str]) -> Facility:
    if facility_id:
        fac = db.query(Facility).filter(Facility.id == facility_id).first()
        if not fac:
            fac = db.query(Facility).filter(Facility.slug == facility_id).first()
        if fac:
            return fac
    fac = db.query(Facility).first()
    if not fac:
        raise HTTPException(status_code=404, detail="No facility found in system")
    return fac

@router.get("/overview", response_model=DashboardOverviewOut)
def get_dashboard_overview(
    facility_id: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    facility = resolve_facility(db, facility_id)
    queues = db.query(Queue).filter(Queue.facility_id == facility.id).all()
    counters = db.query(Counter).filter(Counter.facility_id == facility.id).all()

    total_waiting = sum(q.current_length for q in queues)
    active_counters = [c for c in counters if c.status == "active"]
    inactive_counters = [c for c in counters if c.status in ("inactive", "paused", "closed")]
    total_served = sum(c.total_served_today for c in counters)

    avg_svc_sec = sum(c.avg_service_time_seconds for c in counters) / max(1, len(counters))
    pred = wait_time_engine.calculate_wait_time(
        queue_length=total_waiting,
        active_counters=len(active_counters),
        avg_service_time_seconds=avg_svc_sec,
        arrival_rate_per_hour=max(15.0, total_waiting * 2.2),
        facility_category=facility.category
    )

    avg_wait = pred["predicted_wait_minutes"]
    longest_wait = round(avg_wait * 1.6, 1)

    # Completion time
    completion_dt = datetime.now(timezone.utc) + timedelta(minutes=avg_wait)
    completion_str = completion_dt.strftime("%I:%M %p")

    # Crowd density
    if total_waiting < 15:
        density = "Low"
    elif total_waiting < 35:
        density = "Moderate"
    elif total_waiting < 60:
        density = "High"
    else:
        density = "Critical"

    # Queue efficiency score (0-100)
    # SLA adherence + utilization factor
    sla_adherence = max(0.0, 100.0 - max(0.0, (avg_wait - facility.target_sla_minutes) * 4.0))
    counter_active_ratio = (len(active_counters) / max(1, len(counters))) * 100.0
    efficiency = round((0.7 * sla_adherence) + (0.3 * counter_active_ratio), 1)

    aws_status = aws_service.get_aws_status()

    return {
        "facility_id": facility.id,
        "facility_name": facility.name,
        "facility_category": facility.category,
        "total_waiting": total_waiting,
        "avg_waiting_minutes": avg_wait,
        "longest_waiting_minutes": longest_wait,
        "active_counters": len(active_counters),
        "inactive_counters": len(inactive_counters),
        "total_counters": len(counters),
        "crowd_density": density,
        "estimated_completion_time": completion_str,
        "total_served_today": total_served,
        "queue_efficiency_score": efficiency,
        "is_demo_mode": settings.DEMO_MODE,
        "aws_services_status": {
            "s3": aws_status["s3_connected"],
            "sns": aws_status["sns_connected"],
            "cloudwatch": aws_status["cloudwatch_connected"],
            "rds": aws_status["rds_connected"]
        },
        "last_updated": datetime.now(timezone.utc)
    }

@router.get("/trends", response_model=List[TrendPointOut])
def get_dashboard_trends(
    facility_id: Optional[str] = Query(None),
    hours: int = Query(12, ge=4, le=48),
    db: Session = Depends(get_db)
):
    facility = resolve_facility(db, facility_id)
    history = db.query(QueueHistory).filter(
        QueueHistory.facility_id == facility.id
    ).order_by(QueueHistory.timestamp.asc()).all()

    # Limit to requested hours
    if len(history) > hours:
        history = history[-hours:]

    points: List[TrendPointOut] = []
    for h in history:
        points.append(TrendPointOut(
            time=h.timestamp.strftime("%I:%M %p"),
            queue_length=h.queue_length,
            waiting_minutes=round(h.avg_wait_seconds / 60.0, 1),
            served_count=h.people_served_interval,
            density=h.density_level
        ))

    return points
