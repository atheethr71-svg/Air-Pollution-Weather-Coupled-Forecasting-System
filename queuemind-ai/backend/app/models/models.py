import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Integer, Float, Boolean, DateTime, ForeignKey, Text, JSON, Index
)
from sqlalchemy.orm import relationship
from app.database.session import Base

def generate_uuid() -> str:
    return str(uuid.uuid4())

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

class Facility(Base):
    __tablename__ = "facilities"

    id = Column(String(50), primary_key=True, default=generate_uuid)
    name = Column(String(150), nullable=False, index=True)
    slug = Column(String(100), unique=True, nullable=False, index=True)
    category = Column(String(50), nullable=False)  # 'Hospital', 'College Canteen', 'Clinic', 'Bank', 'Service Centre'
    description = Column(Text, nullable=True)
    address = Column(String(255), nullable=True)
    max_capacity = Column(Integer, default=200)
    target_sla_minutes = Column(Float, default=15.0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    # Relationships
    queues = relationship("Queue", back_populates="facility", cascade="all, delete-orphan")
    counters = relationship("Counter", back_populates="facility", cascade="all, delete-orphan")
    detections = relationship("CrowdDetection", back_populates="facility", cascade="all, delete-orphan")
    predictions = relationship("WaitingTimePrediction", back_populates="facility", cascade="all, delete-orphan")
    history = relationship("QueueHistory", back_populates="facility", cascade="all, delete-orphan")
    alerts = relationship("Alert", back_populates="facility", cascade="all, delete-orphan")
    simulations = relationship("SimulationResult", back_populates="facility", cascade="all, delete-orphan")

class User(Base):
    __tablename__ = "users"

    id = Column(String(50), primary_key=True, default=generate_uuid)
    email = Column(String(150), unique=True, nullable=False, index=True)
    full_name = Column(String(150), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(50), nullable=False, default="facility_admin")  # 'super_admin', 'facility_admin', 'counter_operator'
    facility_id = Column(String(50), ForeignKey("facilities.id", ondelete="SET NULL"), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utc_now)
    last_login = Column(DateTime, nullable=True)

class Queue(Base):
    __tablename__ = "queues"

    id = Column(String(50), primary_key=True, default=generate_uuid)
    facility_id = Column(String(50), ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    code = Column(String(20), nullable=True)
    current_length = Column(Integer, default=0)
    avg_service_time_seconds = Column(Float, default=180.0)  # 3 minutes default
    target_sla_seconds = Column(Float, default=900.0)  # 15 mins
    warning_threshold_people = Column(Integer, default=25)
    critical_threshold_people = Column(Integer, default=45)
    status = Column(String(30), default="normal")  # 'normal', 'warning', 'critical'
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    facility = relationship("Facility", back_populates="queues")
    counters = relationship("Counter", back_populates="queue", cascade="all, delete-orphan")
    predictions = relationship("WaitingTimePrediction", back_populates="queue", cascade="all, delete-orphan")

class Counter(Base):
    __tablename__ = "counters"

    id = Column(String(50), primary_key=True, default=generate_uuid)
    facility_id = Column(String(50), ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False, index=True)
    queue_id = Column(String(50), ForeignKey("queues.id", ondelete="CASCADE"), nullable=True, index=True)
    counter_number = Column(Integer, nullable=False)
    name = Column(String(100), nullable=False)  # 'Counter 1 - General', 'Counter 2 - Express'
    operator_name = Column(String(100), default="Operator")
    status = Column(String(30), default="active")  # 'active', 'inactive', 'paused', 'closed'
    current_serving_token = Column(String(30), nullable=True)
    total_served_today = Column(Integer, default=0)
    avg_service_time_seconds = Column(Float, default=180.0)
    efficiency_score = Column(Float, default=92.5)  # percentage
    last_status_change = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    facility = relationship("Facility", back_populates="counters")
    queue = relationship("Queue", back_populates="counters")

class CrowdDetection(Base):
    __tablename__ = "crowd_detections"

    id = Column(String(50), primary_key=True, default=generate_uuid)
    facility_id = Column(String(50), ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False, index=True)
    timestamp = Column(DateTime, default=utc_now, index=True)
    detected_count = Column(Integer, nullable=False, default=0)
    density_level = Column(String(30), nullable=False)  # 'Low', 'Moderate', 'High', 'Critical'
    confidence_score = Column(Float, default=0.92)
    bounding_boxes = Column(JSON, default=list)  # list of {x, y, w, h, confidence, class}
    detection_mode = Column(String(50), default="simulation")  # 'live_camera', 'image_upload', 'video_stream', 'simulation'
    image_url = Column(String(255), nullable=True)
    zone_name = Column(String(100), default="Main Waiting Area")
    processing_time_ms = Column(Float, default=45.0)

    facility = relationship("Facility", back_populates="detections")

class WaitingTimePrediction(Base):
    __tablename__ = "waiting_time_predictions"

    id = Column(String(50), primary_key=True, default=generate_uuid)
    facility_id = Column(String(50), ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False, index=True)
    queue_id = Column(String(50), ForeignKey("queues.id", ondelete="CASCADE"), nullable=True)
    timestamp = Column(DateTime, default=utc_now, index=True)
    predicted_wait_seconds = Column(Float, nullable=False)
    confidence_low_seconds = Column(Float, nullable=False)
    confidence_high_seconds = Column(Float, nullable=False)
    model_used = Column(String(50), default="queueing_theory_mmc")
    queue_length_input = Column(Integer, nullable=False)
    active_counters_input = Column(Integer, nullable=False)
    arrival_rate_per_hour = Column(Float, default=60.0)
    service_rate_per_hour = Column(Float, default=20.0)
    traffic_intensity = Column(Float, default=0.75)
    growth_rate_per_min = Column(Float, default=0.2)
    actual_wait_seconds = Column(Float, nullable=True)

    facility = relationship("Facility", back_populates="predictions")
    queue = relationship("Queue", back_populates="predictions")

class QueueHistory(Base):
    __tablename__ = "queue_history"

    id = Column(String(50), primary_key=True, default=generate_uuid)
    facility_id = Column(String(50), ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False, index=True)
    timestamp = Column(DateTime, default=utc_now, index=True)
    queue_length = Column(Integer, default=0)
    active_counters = Column(Integer, default=1)
    avg_wait_seconds = Column(Float, default=0.0)
    people_served_interval = Column(Integer, default=0)
    density_level = Column(String(30), default="Low")

    facility = relationship("Facility", back_populates="history")

class Alert(Base):
    __tablename__ = "alerts"

    id = Column(String(50), primary_key=True, default=generate_uuid)
    facility_id = Column(String(50), ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False, index=True)
    level = Column(String(20), nullable=False)  # 'info', 'warning', 'critical'
    title = Column(String(150), nullable=False)
    message = Column(Text, nullable=False)
    metric_triggered = Column(String(50), nullable=False)  # 'queue_length', 'waiting_time', 'counter_down', 'crowd_surge'
    threshold_value = Column(Float, nullable=False)
    actual_value = Column(Float, nullable=False)
    is_acknowledged = Column(Boolean, default=False, index=True)
    acknowledged_by = Column(String(150), nullable=True)
    acknowledged_at = Column(DateTime, nullable=True)
    sns_message_id = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=utc_now, index=True)

    facility = relationship("Facility", back_populates="alerts")

class SimulationResult(Base):
    __tablename__ = "simulation_results"

    id = Column(String(50), primary_key=True, default=generate_uuid)
    facility_id = Column(String(50), ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False, index=True)
    timestamp = Column(DateTime, default=utc_now)
    current_counters = Column(Integer, nullable=False)
    proposed_counters = Column(Integer, nullable=False)
    queue_size = Column(Integer, nullable=False)
    incoming_rate_per_hour = Column(Float, nullable=False)
    avg_service_time_seconds = Column(Float, nullable=False)
    current_wait_seconds = Column(Float, nullable=False)
    predicted_wait_seconds = Column(Float, nullable=False)
    time_saved_percent = Column(Float, default=0.0)
    counter_utilization_percent = Column(Float, default=0.0)
    congestion_reduction_percent = Column(Float, default=0.0)
    recommended_active_counters = Column(Integer, default=3)
    is_applied = Column(Boolean, default=False)

    facility = relationship("Facility", back_populates="simulations")

class AgentConversation(Base):
    __tablename__ = "agent_conversations"

    id = Column(String(50), primary_key=True, default=generate_uuid)
    user_id = Column(String(50), nullable=True)
    facility_id = Column(String(50), nullable=True)
    title = Column(String(200), default="Operations Assistant Session")
    created_at = Column(DateTime, default=utc_now)

    messages = relationship("AgentMessage", back_populates="conversation", cascade="all, delete-orphan")

class AgentMessage(Base):
    __tablename__ = "agent_messages"

    id = Column(String(50), primary_key=True, default=generate_uuid)
    conversation_id = Column(String(50), ForeignKey("agent_conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    sender = Column(String(20), nullable=False)  # 'user', 'agent'
    content = Column(Text, nullable=False)
    tool_calls = Column(JSON, nullable=True)  # tool invocation details
    suggested_action = Column(JSON, nullable=True)  # action props (e.g. {action: "open_counter", counter_id: "...", new_status: "active"})
    is_action_executed = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utc_now)

    conversation = relationship("AgentConversation", back_populates="messages")

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(String(50), primary_key=True, default=generate_uuid)
    user_email = Column(String(150), default="system")
    action = Column(String(100), nullable=False)
    target_type = Column(String(50), nullable=False)  # 'counter', 'queue', 'alert', 'facility', 'agent'
    target_id = Column(String(50), nullable=True)
    details = Column(Text, nullable=True)
    ip_address = Column(String(50), default="127.0.0.1")
    timestamp = Column(DateTime, default=utc_now, index=True)
