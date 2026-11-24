from pydantic import BaseModel, EmailStr, Field, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime

# --- Auth Schemas ---
class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: Optional[str] = "facility_admin"
    facility_id: Optional[str] = None

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: Dict[str, Any]

class UserOut(BaseModel):
    id: str
    email: EmailStr
    full_name: str
    role: str
    facility_id: Optional[str] = None
    is_active: bool
    created_at: datetime
    last_login: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

# --- Facility Schemas ---
class FacilityOut(BaseModel):
    id: str
    name: str
    slug: str
    category: str
    description: Optional[str] = None
    address: Optional[str] = None
    max_capacity: int
    target_sla_minutes: float
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class FacilityCreate(BaseModel):
    name: str
    slug: str
    category: str
    description: Optional[str] = None
    address: Optional[str] = None
    max_capacity: int = 200
    target_sla_minutes: float = 15.0

# --- Queue Schemas ---
class QueueOut(BaseModel):
    id: str
    facility_id: str
    name: str
    code: Optional[str] = None
    current_length: int
    avg_service_time_seconds: float
    target_sla_seconds: float
    warning_threshold_people: int
    critical_threshold_people: int
    status: str
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class QueueUpdate(BaseModel):
    current_length: Optional[int] = None
    avg_service_time_seconds: Optional[float] = None
    warning_threshold_people: Optional[int] = None
    critical_threshold_people: Optional[int] = None
    status: Optional[str] = None

# --- Counter Schemas ---
class CounterOut(BaseModel):
    id: str
    facility_id: str
    queue_id: Optional[str] = None
    counter_number: int
    name: str
    operator_name: str
    status: str  # active, inactive, paused, closed
    current_serving_token: Optional[str] = None
    total_served_today: int
    avg_service_time_seconds: float
    efficiency_score: float
    last_status_change: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class CounterCreate(BaseModel):
    facility_id: str
    queue_id: Optional[str] = None
    counter_number: int
    name: str
    operator_name: Optional[str] = "Staff Operator"
    status: Optional[str] = "active"
    avg_service_time_seconds: Optional[float] = 180.0

class CounterUpdate(BaseModel):
    name: Optional[str] = None
    operator_name: Optional[str] = None
    status: Optional[str] = None
    current_serving_token: Optional[str] = None
    avg_service_time_seconds: Optional[float] = None

class CounterActionRequest(BaseModel):
    action: str  # 'open', 'close', 'pause', 'call_next', 'finish_serving'
    token: Optional[str] = None

# --- Crowd Detection Schemas ---
class BoundingBox(BaseModel):
    x: float
    y: float
    w: float
    h: float
    confidence: float
    label: str = "person"

class CrowdDetectionOut(BaseModel):
    id: str
    facility_id: str
    timestamp: datetime
    detected_count: int
    density_level: str  # Low, Moderate, High, Critical
    confidence_score: float
    bounding_boxes: List[Dict[str, Any]]
    detection_mode: str
    image_url: Optional[str] = None
    zone_name: str
    processing_time_ms: float

    model_config = ConfigDict(from_attributes=True)

class DetectionFrameRequest(BaseModel):
    facility_id: str
    frame_base64: str
    detection_mode: Optional[str] = "live_camera"
    zone_name: Optional[str] = "Main Waiting Area"

# --- Prediction Schemas ---
class PredictionRequest(BaseModel):
    facility_id: str
    queue_length: Optional[int] = None
    active_counters: Optional[int] = None
    avg_service_time_seconds: Optional[float] = None
    arrival_rate_per_hour: Optional[float] = None
    minutes_ahead: Optional[int] = 30

class PredictionOut(BaseModel):
    id: str
    facility_id: str
    timestamp: datetime
    predicted_wait_seconds: float
    predicted_wait_minutes: float
    confidence_low_minutes: float
    confidence_high_minutes: float
    model_used: str
    queue_length_input: int
    active_counters_input: int
    arrival_rate_per_hour: float
    service_rate_per_hour: float
    traffic_intensity: float
    growth_rate_per_min: float
    congestion_risk: str  # Low, Moderate, High, Critical

# --- Simulator Schemas ---
class SimulationRequest(BaseModel):
    facility_id: str
    queue_size: Optional[int] = None
    proposed_counters: int
    incoming_rate_per_hour: Optional[float] = None
    avg_service_time_seconds: Optional[float] = None

class SimulationOut(BaseModel):
    facility_id: str
    current_counters: int
    proposed_counters: int
    queue_size: int
    incoming_rate_per_hour: float
    avg_service_time_seconds: float
    current_wait_minutes: float
    predicted_wait_minutes: float
    time_saved_minutes: float
    time_saved_percent: float
    counter_utilization_percent: float
    congestion_reduction_percent: float
    recommended_active_counters: int
    recommendation_summary: str
    feasibility_notes: str

class ApplyRecommendationRequest(BaseModel):
    facility_id: str
    proposed_counters: int
    reason: Optional[str] = "Applied from QueueMind Simulator"

# --- Alert Schemas ---
class AlertOut(BaseModel):
    id: str
    facility_id: str
    level: str  # info, warning, critical
    title: str
    message: str
    metric_triggered: str
    threshold_value: float
    actual_value: float
    is_acknowledged: bool
    acknowledged_by: Optional[str] = None
    acknowledged_at: Optional[datetime] = None
    sns_message_id: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class AlertAcknowledgeRequest(BaseModel):
    acknowledged_by: Optional[str] = None

# --- AI Agent Schemas ---
class AgentChatRequest(BaseModel):
    facility_id: str
    message: str
    conversation_id: Optional[str] = None

class AgentMessageOut(BaseModel):
    id: str
    sender: str
    content: str
    tool_calls: Optional[List[Dict[str, Any]]] = None
    suggested_action: Optional[Dict[str, Any]] = None
    is_action_executed: bool
    created_at: datetime

class AgentChatResponse(BaseModel):
    conversation_id: str
    reply: str
    tool_calls: Optional[List[Dict[str, Any]]] = None
    suggested_action: Optional[Dict[str, Any]] = None
    context_data: Optional[Dict[str, Any]] = None

class AgentActionExecuteRequest(BaseModel):
    conversation_id: str
    message_id: str
    action_type: str
    payload: Dict[str, Any]

# --- Dashboard & Analytics Schemas ---
class DashboardOverviewOut(BaseModel):
    facility_id: str
    facility_name: str
    facility_category: str
    total_waiting: int
    avg_waiting_minutes: float
    longest_waiting_minutes: float
    active_counters: int
    inactive_counters: int
    total_counters: int
    crowd_density: str
    estimated_completion_time: str
    total_served_today: int
    queue_efficiency_score: float
    is_demo_mode: bool
    aws_services_status: Dict[str, bool]
    last_updated: datetime

class TrendPointOut(BaseModel):
    time: str
    queue_length: int
    waiting_minutes: float
    served_count: int
    density: str

class AnalyticsOverviewOut(BaseModel):
    facility_id: str
    date_range: str
    total_served: int
    avg_wait_minutes: float
    peak_hours: List[Dict[str, Any]]
    counter_performance: List[Dict[str, Any]]
    efficiency_trend: List[Dict[str, Any]]
    before_after_simulation_sample: Dict[str, Any]
