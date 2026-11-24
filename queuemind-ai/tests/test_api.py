import pytest
import os
import sys

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from fastapi.testclient import TestClient
from app.main import app
from app.database.session import Base, engine, SessionLocal
from app.services.demo_service import seed_database_if_empty
from app.ai_engine.prediction.wait_time_model import wait_time_engine
from app.services.simulation_service import simulation_service
from app.ai_engine.detection.detector import crowd_detector

def setup_module(module):
    """Ensure database schema and initial seed data exist before running tests."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_database_if_empty(db)
    finally:
        db.close()

client = TestClient(app)

def test_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "aws" in data

def test_auth_login_known_demo_user():
    response = client.post("/api/auth/login", json={
        "email": "admin@queuemind.ai",
        "password": "Admin@123"
    })
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["user"]["email"] == "admin@queuemind.ai"
    assert data["user"]["role"] == "super_admin"

def test_auth_invalid_credentials():
    response = client.post("/api/auth/login", json={
        "email": "admin@queuemind.ai",
        "password": "WrongPassword!"
    })
    assert response.status_code == 401

def test_list_facilities():
    response = client.get("/api/facilities")
    assert response.status_code == 200
    facilities = response.json()
    assert len(facilities) >= 5
    categories = [f["category"] for f in facilities]
    assert "College Canteen" in categories
    assert "Hospital" in categories

def test_erlang_c_prediction_math():
    res = wait_time_engine.calculate_wait_time(
        queue_length=30,
        active_counters=3,
        avg_service_time_seconds=120.0,
        arrival_rate_per_hour=60.0
    )
    assert res["predicted_wait_minutes"] > 0
    assert res["confidence_low_minutes"] <= res["predicted_wait_minutes"]
    assert res["confidence_high_minutes"] >= res["predicted_wait_minutes"]
    assert res["congestion_risk"] in ("Low", "Moderate", "High", "Critical")

def test_counter_simulation_engine():
    res = simulation_service.run_simulation(
        queue_size=40,
        current_counters=2,
        proposed_counters=4,
        incoming_rate_per_hour=75.0,
        avg_service_time_seconds=150.0,
        target_sla_minutes=12.0
    )
    assert res["current_counters"] == 2
    assert res["proposed_counters"] == 4
    assert res["predicted_wait_minutes"] <= res["current_wait_minutes"]
    assert res["time_saved_percent"] >= 0.0
    assert res["recommended_active_counters"] >= 1
    assert "recommendation_summary" in res

def test_computer_vision_detector():
    synthetic_res = crowd_detector.generate_simulated_frame("Metro Hospital")
    assert synthetic_res["detected_count"] > 0
    assert len(synthetic_res["bounding_boxes"]) > 0
    assert synthetic_res["density_level"] in ("Low", "Moderate", "High", "Critical")
    assert synthetic_res["annotated_image_base64"] is not None
    assert synthetic_res["confidence_score"] > 0.80

def test_operations_agent_chat():
    fac_res = client.get("/api/facilities")
    fac_id = fac_res.json()[0]["id"]

    chat_res = client.post("/api/agent/chat", json={
        "facility_id": fac_id,
        "message": "Should I open another counter right now?"
    })
    assert chat_res.status_code == 200
    data = chat_res.json()
    assert len(data["reply"]) > 20
    assert "conversation_id" in data
    assert len(data["tool_calls"]) > 0

def test_alerts_list_and_acknowledge():
    fac_res = client.get("/api/facilities")
    fac_id = fac_res.json()[0]["id"]

    alerts_res = client.get(f"/api/alerts?facility_id={fac_id}")
    assert alerts_res.status_code == 200
    alerts = alerts_res.json()
    if len(alerts) > 0:
        first_alert = alerts[0]
        ack_res = client.patch(f"/api/alerts/{first_alert['id']}/acknowledge", json={
            "acknowledged_by": "Test Suite Runner"
        })
        assert ack_res.status_code == 200
        assert ack_res.json()["is_acknowledged"] is True

def test_analytics_csv_export():
    fac_res = client.get("/api/facilities")
    fac_id = fac_res.json()[0]["id"]

    csv_res = client.get(f"/api/analytics/export?facility_id={fac_id}")
    assert csv_res.status_code == 200
    assert "text/csv" in csv_res.headers.get("content-type", "")
    assert "QueueMind" in csv_res.text
    assert "COUNTER PERFORMANCE" in csv_res.text
