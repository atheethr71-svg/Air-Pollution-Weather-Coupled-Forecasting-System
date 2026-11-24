from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.models import User, Facility
from app.schemas.schemas import LoginRequest, RegisterRequest, TokenResponse, UserOut
from app.core.security import verify_password, get_password_hash, create_access_token, get_current_user_payload

router = APIRouter(prefix="/auth", tags=["Authentication"])

@router.post("/register", response_model=TokenResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == req.email.lower()).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email address already exists."
        )

    # Validate facility if provided
    facility_id = req.facility_id
    if facility_id:
        fac = db.query(Facility).filter(Facility.id == facility_id).first()
        if not fac:
            facility_id = None

    new_user = User(
        email=req.email.lower(),
        full_name=req.full_name,
        hashed_password=get_password_hash(req.password),
        role=req.role or "facility_admin",
        facility_id=facility_id,
        is_active=True
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    token = create_access_token({
        "sub": new_user.id,
        "email": new_user.email,
        "role": new_user.role,
        "facility_id": new_user.facility_id
    })

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": new_user.id,
            "email": new_user.email,
            "full_name": new_user.full_name,
            "role": new_user.role,
            "facility_id": new_user.facility_id
        }
    }

@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email.lower()).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password. Please verify your credentials."
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been deactivated. Please contact an administrator."
        )

    user.last_login = datetime.now(timezone.utc)
    db.commit()

    token = create_access_token({
        "sub": user.id,
        "email": user.email,
        "role": user.role,
        "facility_id": user.facility_id
    })

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "role": user.role,
            "facility_id": user.facility_id
        }
    }

@router.post("/logout")
def logout():
    return {"message": "Logged out successfully."}

@router.get("/me", response_model=UserOut)
def get_current_user(payload: dict = Depends(get_current_user_payload), db: Session = Depends(get_db)):
    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user
