from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.models import Facility, Queue, Counter
from app.schemas.schemas import FacilityOut, FacilityCreate
from app.core.security import require_roles

router = APIRouter(prefix="/facilities", tags=["Facilities"])

@router.get("", response_model=List[FacilityOut])
def list_facilities(db: Session = Depends(get_db)):
    return db.query(Facility).filter(Facility.is_active == True).all()

@router.get("/{id}", response_model=FacilityOut)
def get_facility(id: str, db: Session = Depends(get_db)):
    fac = db.query(Facility).filter(Facility.id == id).first()
    if not fac:
        fac = db.query(Facility).filter(Facility.slug == id).first()
    if not fac:
        raise HTTPException(status_code=404, detail="Facility not found")
    return fac

@router.post("", response_model=FacilityOut)
def create_facility(
    req: FacilityCreate,
    db: Session = Depends(get_db),
    user_payload: dict = Depends(require_roles(["super_admin"]))
):
    existing = db.query(Facility).filter(Facility.slug == req.slug).first()
    if existing:
        raise HTTPException(status_code=400, detail="A facility with this slug already exists.")

    new_fac = Facility(
        name=req.name,
        slug=req.slug,
        category=req.category,
        description=req.description,
        address=req.address,
        max_capacity=req.max_capacity,
        target_sla_minutes=req.target_sla_minutes,
        is_active=True
    )
    db.add(new_fac)
    db.commit()
    db.refresh(new_fac)

    # Automatically create default queue and counters
    default_q = Queue(
        facility_id=new_fac.id,
        name=f"{new_fac.name} General Queue",
        code="Q-01",
        current_length=10,
        avg_service_time_seconds=180.0,
        target_sla_seconds=req.target_sla_minutes * 60.0
    )
    db.add(default_q)
    db.commit()

    for i in range(1, 4):
        c = Counter(
            facility_id=new_fac.id,
            queue_id=default_q.id,
            counter_number=i,
            name=f"Counter {i} - Main",
            operator_name=f"Operator {i}",
            status="active" if i <= 2 else "inactive",
            current_serving_token=f"T-00{i}" if i <= 2 else None,
            total_served_today=25 * i
        )
        db.add(c)
    db.commit()

    return new_fac
