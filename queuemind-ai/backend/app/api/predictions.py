from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.models import Facility, Queue, Counter, WaitingTimePrediction
from app.schemas.schemas import PredictionRequest, PredictionOut
from app.ai_engine.prediction.wait_time_model import wait_time_engine

router = APIRouter(prefix="/predictions", tags=["Predictions"])

@router.post("/waiting-time", response_model=PredictionOut)
def calculate_waiting_time(
    req: PredictionRequest,
    db: Session = Depends(get_db)
):
    facility = db.query(Facility).filter(Facility.id == req.facility_id).first()
    if not facility:
        facility = db.query(Facility).first()

    queues = db.query(Queue).filter(Queue.facility_id == facility.id).all()
    counters = db.query(Counter).filter(Counter.facility_id == facility.id).all()

    q_len = req.queue_length if req.queue_length is not None else sum(q.current_length for q in queues)
    active_c = req.active_counters if req.active_counters is not None else len([c for c in counters if c.status == "active"])
    active_c = max(1, active_c)

    avg_svc = req.avg_service_time_seconds or (sum(c.avg_service_time_seconds for c in counters) / max(1, len(counters)))
    arrival_rate = req.arrival_rate_per_hour or max(15.0, q_len * 2.2)

    pred = wait_time_engine.calculate_wait_time(
        queue_length=q_len,
        active_counters=active_c,
        avg_service_time_seconds=avg_svc,
        arrival_rate_per_hour=arrival_rate,
        facility_category=facility.category
    )

    # Persist prediction
    record = WaitingTimePrediction(
        facility_id=facility.id,
        predicted_wait_seconds=pred["predicted_wait_seconds"],
        confidence_low_seconds=pred["confidence_low_minutes"] * 60.0,
        confidence_high_seconds=pred["confidence_high_minutes"] * 60.0,
        model_used=pred["model_used"],
        queue_length_input=q_len,
        active_counters_input=active_c,
        arrival_rate_per_hour=pred["arrival_rate_per_hour"],
        service_rate_per_hour=pred["service_rate_per_hour"],
        traffic_intensity=pred["traffic_intensity"],
        growth_rate_per_min=pred["growth_rate_per_min"]
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return {
        "id": record.id,
        "facility_id": facility.id,
        "timestamp": record.timestamp,
        "predicted_wait_seconds": pred["predicted_wait_seconds"],
        "predicted_wait_minutes": pred["predicted_wait_minutes"],
        "confidence_low_minutes": pred["confidence_low_minutes"],
        "confidence_high_minutes": pred["confidence_high_minutes"],
        "model_used": pred["model_used"],
        "queue_length_input": q_len,
        "active_counters_input": active_c,
        "arrival_rate_per_hour": pred["arrival_rate_per_hour"],
        "service_rate_per_hour": pred["service_rate_per_hour"],
        "traffic_intensity": pred["traffic_intensity"],
        "growth_rate_per_min": pred["growth_rate_per_min"],
        "congestion_risk": pred["congestion_risk"]
    }

@router.get("/history", response_model=List[PredictionOut])
def get_prediction_history(
    facility_id: Optional[str] = Query(None),
    limit: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db)
):
    query = db.query(WaitingTimePrediction)
    if facility_id:
        query = query.filter(WaitingTimePrediction.facility_id == facility_id)
    records = query.order_by(WaitingTimePrediction.timestamp.desc()).limit(limit).all()

    res = []
    for r in records:
        pred_min = round(r.predicted_wait_seconds / 60.0, 1)
        res.append({
            "id": r.id,
            "facility_id": r.facility_id,
            "timestamp": r.timestamp,
            "predicted_wait_seconds": r.predicted_wait_seconds,
            "predicted_wait_minutes": pred_min,
            "confidence_low_minutes": round(r.confidence_low_seconds / 60.0, 1),
            "confidence_high_minutes": round(r.confidence_high_seconds / 60.0, 1),
            "model_used": r.model_used,
            "queue_length_input": r.queue_length_input,
            "active_counters_input": r.active_counters_input,
            "arrival_rate_per_hour": r.arrival_rate_per_hour,
            "service_rate_per_hour": r.service_rate_per_hour,
            "traffic_intensity": r.traffic_intensity,
            "growth_rate_per_min": r.growth_rate_per_min,
            "congestion_risk": "Critical" if pred_min > 25 else ("High" if pred_min > 15 else ("Moderate" if pred_min > 8 else "Low"))
        })
    return res
