import random
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.models import Counter, Queue, Facility, SimulationResult, AuditLog
from app.schemas.schemas import (
    CounterOut, CounterCreate, CounterUpdate, CounterActionRequest,
    SimulationRequest, SimulationOut, ApplyRecommendationRequest
)
from app.services.simulation_service import simulation_service
from app.services.websocket_manager import ws_manager

router = APIRouter(prefix="/counters", tags=["Counters"])

@router.get("", response_model=List[CounterOut])
def list_counters(
    facility_id: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(Counter)
    if facility_id:
        query = query.filter(Counter.facility_id == facility_id)
    return query.order_by(Counter.counter_number.asc()).all()

@router.post("", response_model=CounterOut)
def create_counter(
    req: CounterCreate,
    db: Session = Depends(get_db)
):
    c = Counter(
        facility_id=req.facility_id,
        queue_id=req.queue_id,
        counter_number=req.counter_number,
        name=req.name,
        operator_name=req.operator_name or "Staff Operator",
        status=req.status or "active",
        avg_service_time_seconds=req.avg_service_time_seconds or 180.0,
        total_served_today=0,
        efficiency_score=95.0
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c

@router.patch("/{id}", response_model=CounterOut)
async def update_counter(
    id: str,
    req: CounterUpdate,
    db: Session = Depends(get_db)
):
    c = db.query(Counter).filter(Counter.id == id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Counter not found")

    if req.name is not None:
        c.name = req.name
    if req.operator_name is not None:
        c.operator_name = req.operator_name
    if req.status is not None:
        c.status = req.status
        c.last_status_change = datetime.now(timezone.utc)
    if req.current_serving_token is not None:
        c.current_serving_token = req.current_serving_token
    if req.avg_service_time_seconds is not None:
        c.avg_service_time_seconds = req.avg_service_time_seconds

    c.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(c)

    await ws_manager.broadcast_to_facility(c.facility_id, "COUNTER_UPDATE", {
        "id": c.id,
        "name": c.name,
        "status": c.status,
        "current_serving_token": c.current_serving_token,
        "total_served_today": c.total_served_today
    })

    return c

@router.post("/{id}/action", response_model=CounterOut)
async def perform_counter_action(
    id: str,
    req: CounterActionRequest,
    db: Session = Depends(get_db)
):
    c = db.query(Counter).filter(Counter.id == id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Counter not found")

    action = req.action.lower()
    if action == "open":
        c.status = "active"
        c.last_status_change = datetime.now(timezone.utc)
    elif action in ("pause", "break"):
        c.status = "paused"
        c.last_status_change = datetime.now(timezone.utc)
    elif action == "close":
        c.status = "closed"
        c.current_serving_token = None
        c.last_status_change = datetime.now(timezone.utc)
    elif action == "call_next":
        c.status = "active"
        c.total_served_today += 1
        # Generate token
        prefix = c.name[:3].upper().replace(" ", "")
        token_num = random.randint(101, 299)
        c.current_serving_token = req.token or f"{prefix}-{token_num}"
        c.last_status_change = datetime.now(timezone.utc)
        
        # Decrement queue length if possible
        if c.queue_id:
            q = db.query(Queue).filter(Queue.id == c.queue_id).first()
            if q and q.current_length > 0:
                q.current_length = max(0, q.current_length - 1)
    elif action == "finish_serving":
        c.current_serving_token = None
        c.total_served_today += 1

    c.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(c)

    await ws_manager.broadcast_to_facility(c.facility_id, "COUNTER_UPDATE", {
        "id": c.id,
        "name": c.name,
        "status": c.status,
        "current_serving_token": c.current_serving_token,
        "total_served_today": c.total_served_today
    })

    return c

@router.post("/simulate", response_model=SimulationOut)
def simulate_counter_allocation(
    req: SimulationRequest,
    db: Session = Depends(get_db)
):
    facility = db.query(Facility).filter(Facility.id == req.facility_id).first()
    if not facility:
        facility = db.query(Facility).first()

    queues = db.query(Queue).filter(Queue.facility_id == facility.id).all()
    counters = db.query(Counter).filter(Counter.facility_id == facility.id).all()

    q_size = req.queue_size if req.queue_size is not None else sum(q.current_length for q in queues)
    active_count = len([c for c in counters if c.status == "active"])
    avg_svc = req.avg_service_time_seconds or (sum(c.avg_service_time_seconds for c in counters) / max(1, len(counters)))
    arrival_rate = req.incoming_rate_per_hour or max(20.0, q_size * 2.2)

    sim_result = simulation_service.run_simulation(
        queue_size=q_size,
        current_counters=active_count,
        proposed_counters=req.proposed_counters,
        incoming_rate_per_hour=arrival_rate,
        avg_service_time_seconds=avg_svc,
        max_available_counters=len(counters),
        target_sla_minutes=facility.target_sla_minutes
    )

    # Save simulation history
    rec = SimulationResult(
        facility_id=facility.id,
        current_counters=sim_result["current_counters"],
        proposed_counters=sim_result["proposed_counters"],
        queue_size=sim_result["queue_size"],
        incoming_rate_per_hour=sim_result["incoming_rate_per_hour"],
        avg_service_time_seconds=sim_result["avg_service_time_seconds"],
        current_wait_seconds=sim_result["current_wait_minutes"] * 60.0,
        predicted_wait_seconds=sim_result["predicted_wait_minutes"] * 60.0,
        time_saved_percent=sim_result["time_saved_percent"],
        counter_utilization_percent=sim_result["counter_utilization_percent"],
        congestion_reduction_percent=sim_result["congestion_reduction_percent"],
        recommended_active_counters=sim_result["recommended_active_counters"],
        is_applied=False
    )
    db.add(rec)
    db.commit()

    return {
        "facility_id": facility.id,
        **sim_result
    }

@router.post("/apply-recommendation")
async def apply_recommendation(
    req: ApplyRecommendationRequest,
    db: Session = Depends(get_db)
):
    facility = db.query(Facility).filter(Facility.id == req.facility_id).first()
    if not facility:
        raise HTTPException(status_code=404, detail="Facility not found")

    counters = db.query(Counter).filter(Counter.facility_id == facility.id).order_by(Counter.counter_number.asc()).all()
    target_count = min(len(counters), max(1, req.proposed_counters))

    # Activate first `target_count` counters, set rest to inactive/paused
    for idx, c in enumerate(counters):
        if idx < target_count:
            c.status = "active"
            if not c.current_serving_token:
                c.current_serving_token = f"C{c.counter_number}-{random.randint(100, 199)}"
        else:
            c.status = "inactive"
            c.current_serving_token = None
        c.last_status_change = datetime.now(timezone.utc)

    # Record Audit Log
    audit = AuditLog(
        user_email="operations-admin",
        action="APPLY_SIMULATED_COUNTER_ALLOCATION",
        target_type="facility",
        target_id=facility.id,
        details=f"Reallocated counters to {target_count} active counters based on QueueMind AI Simulator. Reason: {req.reason}"
    )
    db.add(audit)
    db.commit()

    await ws_manager.broadcast_to_facility(facility.id, "COUNTERS_REALLOCATED", {
        "active_counters": target_count,
        "total_counters": len(counters),
        "reason": req.reason
    })

    return {
        "success": True,
        "message": f"Successfully updated facility to {target_count} active counters.",
        "active_counters": target_count,
        "total_counters": len(counters)
    }
