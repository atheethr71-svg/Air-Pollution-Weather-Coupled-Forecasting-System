from typing import List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.models import Queue, Facility
from app.schemas.schemas import QueueOut, QueueUpdate
from app.services.websocket_manager import ws_manager
from app.services.alert_service import alert_service
from app.ai_engine.prediction.wait_time_model import wait_time_engine

router = APIRouter(prefix="/queues", tags=["Queues"])

@router.get("", response_model=List[QueueOut])
def list_queues(
    facility_id: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(Queue)
    if facility_id:
        query = query.filter(Queue.facility_id == facility_id)
    return query.all()

@router.get("/{id}", response_model=QueueOut)
def get_queue(id: str, db: Session = Depends(get_db)):
    q = db.query(Queue).filter(Queue.id == id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Queue not found")
    return q

@router.patch("/{id}", response_model=QueueOut)
async def update_queue(
    id: str,
    req: QueueUpdate,
    db: Session = Depends(get_db)
):
    q = db.query(Queue).filter(Queue.id == id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Queue not found")

    if req.current_length is not None:
        q.current_length = req.current_length
    if req.avg_service_time_seconds is not None:
        q.avg_service_time_seconds = req.avg_service_time_seconds
    if req.warning_threshold_people is not None:
        q.warning_threshold_people = req.warning_threshold_people
    if req.critical_threshold_people is not None:
        q.critical_threshold_people = req.critical_threshold_people
    if req.status is not None:
        q.status = req.status

    q.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(q)

    # Evaluate alerts
    facility = db.query(Facility).filter(Facility.id == q.facility_id).first()
    pred = wait_time_engine.calculate_wait_time(
        queue_length=q.current_length,
        active_counters=2,
        avg_service_time_seconds=q.avg_service_time_seconds,
        arrival_rate_per_hour=max(15.0, q.current_length * 2.0),
        facility_category=facility.category if facility else "General"
    )
    await alert_service.evaluate_queue_alerts(db, q, pred["predicted_wait_minutes"])

    await ws_manager.broadcast_to_facility(q.facility_id, "QUEUE_UPDATE", {
        "id": q.id,
        "name": q.name,
        "current_length": q.current_length,
        "status": q.status,
        "predicted_wait_minutes": pred["predicted_wait_minutes"]
    })

    return q
