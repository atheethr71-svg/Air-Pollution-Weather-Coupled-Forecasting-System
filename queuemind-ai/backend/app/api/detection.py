import os
import base64
import time
from typing import Optional, List
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.models import Facility, CrowdDetection, Queue
from app.schemas.schemas import CrowdDetectionOut, DetectionFrameRequest
from app.ai_engine.detection.detector import crowd_detector
from app.services.aws_service import aws_service
from app.services.websocket_manager import ws_manager
from app.core.config import settings

router = APIRouter(prefix="/detection", tags=["Crowd Detection"])

def resolve_facility(db: Session, facility_id: Optional[str]) -> Facility:
    if facility_id:
        fac = db.query(Facility).filter(Facility.id == facility_id).first()
        if fac:
            return fac
    fac = db.query(Facility).first()
    if not fac:
        raise HTTPException(status_code=404, detail="No facility available.")
    return fac

@router.post("/image")
async def detect_from_image(
    file: UploadFile = File(...),
    facility_id: str = Form(...),
    zone_name: str = Form("Main Waiting Area"),
    db: Session = Depends(get_db)
):
    facility = resolve_facility(db, facility_id)
    image_bytes = await file.read()

    # Process computer vision detection
    result = crowd_detector.process_image(
        image_bytes=image_bytes,
        detection_mode="image_upload",
        zone_name=zone_name,
        render_annotated=True
    )

    # Save media to AWS S3 or Local storage
    file_name = f"queue_{facility.id}_{int(time.time())}.jpg"
    storage_res = aws_service.upload_file_to_s3(image_bytes, file_name, file.content_type or "image/jpeg")

    # Persist detection record
    detection = CrowdDetection(
        facility_id=facility.id,
        detected_count=result["detected_count"],
        density_level=result["density_level"],
        confidence_score=result["confidence_score"],
        bounding_boxes=result["bounding_boxes"],
        detection_mode="image_upload",
        image_url=storage_res["url"],
        zone_name=zone_name,
        processing_time_ms=result["processing_time_ms"]
    )
    db.add(detection)

    # Update primary queue length based on verified visual detection
    primary_queue = db.query(Queue).filter(Queue.facility_id == facility.id).first()
    if primary_queue:
        primary_queue.current_length = result["detected_count"]

    db.commit()
    db.refresh(detection)

    # Broadcast detection event via WebSocket
    await ws_manager.broadcast_to_facility(facility.id, "DETECTION_UPDATE", {
        "id": detection.id,
        "detected_count": detection.detected_count,
        "density_level": detection.density_level,
        "confidence_score": detection.confidence_score,
        "detection_mode": detection.detection_mode,
        "timestamp": detection.timestamp.isoformat()
    })

    return {
        "id": detection.id,
        "facility_id": facility.id,
        "detected_count": detection.detected_count,
        "density_level": detection.density_level,
        "confidence_score": detection.confidence_score,
        "bounding_boxes": detection.bounding_boxes,
        "detection_mode": detection.detection_mode,
        "image_url": detection.image_url,
        "annotated_image_base64": result.get("annotated_image_base64"),
        "zone_name": detection.zone_name,
        "processing_time_ms": detection.processing_time_ms,
        "storage_provider": storage_res["storage"],
        "is_cloud_storage": storage_res["is_cloud"]
    }

@router.post("/frame")
async def detect_from_webcam_frame(
    req: DetectionFrameRequest,
    db: Session = Depends(get_db)
):
    facility = resolve_facility(db, req.facility_id)

    # Decode base64 payload from browser MediaDevices canvas
    try:
        raw_b64 = req.frame_base64
        if "base64," in raw_b64:
            raw_b64 = raw_b64.split("base64,")[1]
        image_bytes = base64.b64decode(raw_b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64 frame: {str(e)}")

    result = crowd_detector.process_image(
        image_bytes=image_bytes,
        detection_mode=req.detection_mode or "live_camera",
        zone_name=req.zone_name or "Main Waiting Area",
        render_annotated=True
    )

    detection = CrowdDetection(
        facility_id=facility.id,
        detected_count=result["detected_count"],
        density_level=result["density_level"],
        confidence_score=result["confidence_score"],
        bounding_boxes=result["bounding_boxes"],
        detection_mode="live_camera",
        zone_name=req.zone_name or "Main Waiting Area",
        processing_time_ms=result["processing_time_ms"]
    )
    db.add(detection)
    db.commit()

    return {
        "detected_count": result["detected_count"],
        "density_level": result["density_level"],
        "confidence_score": result["confidence_score"],
        "bounding_boxes": result["bounding_boxes"],
        "detection_mode": "live_camera",
        "annotated_image_base64": result.get("annotated_image_base64"),
        "processing_time_ms": result["processing_time_ms"]
    }

@router.post("/simulate")
async def trigger_simulated_detection(
    facility_id: str = Query(...),
    db: Session = Depends(get_db)
):
    facility = resolve_facility(db, facility_id)
    sim_result = crowd_detector.generate_simulated_frame(facility.name)

    detection = CrowdDetection(
        facility_id=facility.id,
        detected_count=sim_result["detected_count"],
        density_level=sim_result["density_level"],
        confidence_score=sim_result["confidence_score"],
        bounding_boxes=sim_result["bounding_boxes"],
        detection_mode="simulation",
        zone_name="Main Waiting Area",
        processing_time_ms=sim_result["processing_time_ms"]
    )
    db.add(detection)

    primary_queue = db.query(Queue).filter(Queue.facility_id == facility.id).first()
    if primary_queue:
        primary_queue.current_length = sim_result["detected_count"]

    db.commit()
    db.refresh(detection)

    await ws_manager.broadcast_to_facility(facility.id, "DETECTION_UPDATE", {
        "id": detection.id,
        "detected_count": detection.detected_count,
        "density_level": detection.density_level,
        "detection_mode": "simulation",
        "timestamp": detection.timestamp.isoformat()
    })

    return {
        "id": detection.id,
        "facility_id": facility.id,
        "detected_count": detection.detected_count,
        "density_level": detection.density_level,
        "confidence_score": detection.confidence_score,
        "bounding_boxes": detection.bounding_boxes,
        "detection_mode": "simulation",
        "annotated_image_base64": sim_result.get("annotated_image_base64"),
        "processing_time_ms": detection.processing_time_ms,
        "is_simulation": True
    }

@router.get("/latest", response_model=Optional[CrowdDetectionOut])
def get_latest_detection(
    facility_id: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    facility = resolve_facility(db, facility_id)
    return db.query(CrowdDetection).filter(
        CrowdDetection.facility_id == facility.id
    ).order_by(CrowdDetection.timestamp.desc()).first()

@router.get("/history", response_model=List[CrowdDetectionOut])
def get_detection_history(
    facility_id: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    facility = resolve_facility(db, facility_id)
    return db.query(CrowdDetection).filter(
        CrowdDetection.facility_id == facility.id
    ).order_by(CrowdDetection.timestamp.desc()).limit(limit).all()

@router.get("/media/{filename}")
def serve_uploaded_media(filename: str):
    file_path = os.path.join(settings.UPLOAD_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Media file not found")
    return FileResponse(file_path)
