from datetime import datetime, timezone
from typing import List, Optional
from sqlalchemy.orm import Session
from app.models.models import Alert, Queue, Facility
from app.services.aws_service import aws_service
from app.services.websocket_manager import ws_manager

class AlertService:
    @classmethod
    async def evaluate_queue_alerts(cls, db: Session, queue: Queue, current_wait_minutes: float):
        """
        Evaluates queue length and waiting time against configured thresholds and fires alerts.
        """
        facility = db.query(Facility).filter(Facility.id == queue.facility_id).first()
        facility_name = facility.name if facility else "Facility"

        # 1. Critical queue length threshold
        if queue.current_length >= queue.critical_threshold_people:
            # Check if active unacknowledged alert already exists
            existing = db.query(Alert).filter(
                Alert.facility_id == queue.facility_id,
                Alert.metric_triggered == "queue_length",
                Alert.is_acknowledged == False,
                Alert.level == "critical"
            ).first()
            if not existing:
                alert = Alert(
                    facility_id=queue.facility_id,
                    level="critical",
                    title=f"Critical Queue Congestion at {queue.name}",
                    message=f"Queue length reached {queue.current_length} people (Threshold: {queue.critical_threshold_people}). Service capacity severely strained.",
                    metric_triggered="queue_length",
                    threshold_value=float(queue.critical_threshold_people),
                    actual_value=float(queue.current_length)
                )
                db.add(alert)
                db.commit()
                db.refresh(alert)

                # Send AWS SNS dispatch
                sns_res = aws_service.publish_sns_alert(
                    subject=f"CRITICAL QUEUE SURGE: {facility_name}",
                    message=alert.message,
                    level="critical"
                )
                alert.sns_message_id = sns_res.get("sns_message_id")
                db.commit()

                # Broadcast via WebSocket
                await ws_manager.broadcast_to_facility(queue.facility_id, "ALERT_TRIGGERED", {
                    "id": alert.id,
                    "level": alert.level,
                    "title": alert.title,
                    "message": alert.message,
                    "created_at": alert.created_at.isoformat()
                })

        # 2. Warning queue length threshold
        elif queue.current_length >= queue.warning_threshold_people:
            existing = db.query(Alert).filter(
                Alert.facility_id == queue.facility_id,
                Alert.metric_triggered == "queue_length",
                Alert.is_acknowledged == False
            ).first()
            if not existing:
                alert = Alert(
                    facility_id=queue.facility_id,
                    level="warning",
                    title=f"Elevated Queue Traffic at {queue.name}",
                    message=f"Queue has reached {queue.current_length} individuals, crossing the warning threshold ({queue.warning_threshold_people}).",
                    metric_triggered="queue_length",
                    threshold_value=float(queue.warning_threshold_people),
                    actual_value=float(queue.current_length)
                )
                db.add(alert)
                db.commit()
                await ws_manager.broadcast_to_facility(queue.facility_id, "ALERT_TRIGGERED", {
                    "id": alert.id,
                    "level": alert.level,
                    "title": alert.title,
                    "message": alert.message,
                    "created_at": alert.created_at.isoformat()
                })

        # 3. SLA Waiting Time breach alert
        if facility and current_wait_minutes > (facility.target_sla_minutes * 1.25):
            existing = db.query(Alert).filter(
                Alert.facility_id == queue.facility_id,
                Alert.metric_triggered == "waiting_time",
                Alert.is_acknowledged == False
            ).first()
            if not existing:
                alert = Alert(
                    facility_id=queue.facility_id,
                    level="warning",
                    title=f"SLA Waiting Time Exceeded at {facility_name}",
                    message=f"Estimated wait time is now {current_wait_minutes} minutes, exceeding target SLA of {facility.target_sla_minutes} minutes.",
                    metric_triggered="waiting_time",
                    threshold_value=facility.target_sla_minutes,
                    actual_value=current_wait_minutes
                )
                db.add(alert)
                db.commit()
                await ws_manager.broadcast_to_facility(queue.facility_id, "ALERT_TRIGGERED", {
                    "id": alert.id,
                    "level": alert.level,
                    "title": alert.title,
                    "message": alert.message,
                    "created_at": alert.created_at.isoformat()
                })

    @classmethod
    def acknowledge_alert(cls, db: Session, alert_id: str, acknowledged_by: str = "Admin") -> Optional[Alert]:
        alert = db.query(Alert).filter(Alert.id == alert_id).first()
        if alert:
            alert.is_acknowledged = True
            alert.acknowledged_by = acknowledged_by
            alert.acknowledged_at = datetime.now(timezone.utc)
            db.commit()
            db.refresh(alert)
        return alert

alert_service = AlertService()
