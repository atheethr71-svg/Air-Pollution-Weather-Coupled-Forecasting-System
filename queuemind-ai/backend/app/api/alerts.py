from typing import List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.models import Alert, Facility
from app.schemas.schemas import AlertOut, AlertAcknowledgeRequest
from app.services.alert_service import alert_service
from app.services.aws_service import aws_service
from app.services.websocket_manager import ws_manager

router = APIRouter(prefix="/alerts", tags=["Alerts"])

@router.get("", response_model=List[AlertOut])
def list_alerts(
    facility_id: Optional[str] = Query(None),
    acknowledged: Optional[bool] = Query(None),
    limit: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db)
):
    query = db.query(Alert)
    if facility_id:
        query = query.filter(Alert.facility_id == facility_id)
    if acknowledged is not None:
        query = query.filter(Alert.is_acknowledged == acknowledged)
    return query.order_by(Alert.created_at.desc()).limit(limit).all()

@router.patch("/{id}/acknowledge", response_model=AlertOut)
async def acknowledge_alert(
    id: str,
    req: AlertAcknowledgeRequest,
    db: Session = Depends(get_db)
):
    alert = alert_service.acknowledge_alert(db, id, req.acknowledged_by or "Administrator")
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    await ws_manager.broadcast_to_facility(alert.facility_id, "ALERT_ACKNOWLEDGED", {
        "id": alert.id,
        "is_acknowledged": True,
        "acknowledged_by": alert.acknowledged_by
    })

    return alert

@router.post("/test-sns")
async def trigger_test_sns_alert(
    facility_id: str = Query(...),
    subject: str = Query("Test Congestion Alert"),
    message: str = Query("Manual alert broadcast initiated from QueueMind AI administrator console."),
    level: str = Query("warning"),
    db: Session = Depends(get_db)
):
    facility = db.query(Facility).filter(Facility.id == facility_id).first()
    if not facility:
        raise HTTPException(status_code=404, detail="Facility not found")

    sns_res = aws_service.publish_sns_alert(
        subject=subject,
        message=f"{message} (Facility: {facility.name})",
        level=level
    )

    alert = Alert(
        facility_id=facility.id,
        level=level,
        title=subject,
        message=message,
        metric_triggered="manual_test",
        threshold_value=1.0,
        actual_value=1.0,
        sns_message_id=sns_res.get("sns_message_id")
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)

    await ws_manager.broadcast_to_facility(facility.id, "ALERT_TRIGGERED", {
        "id": alert.id,
        "level": alert.level,
        "title": alert.title,
        "message": alert.message,
        "sns_status": sns_res["status"],
        "is_cloud": sns_res["is_cloud"]
    })

    return {
        "success": True,
        "alert_id": alert.id,
        "sns_delivery": sns_res
    }
