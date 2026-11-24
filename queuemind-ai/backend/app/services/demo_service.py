import asyncio
import logging
import random
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from app.models.models import (
    Facility, User, Queue, Counter, CrowdDetection,
    WaitingTimePrediction, QueueHistory, Alert, SimulationResult
)
from app.core.security import get_password_hash
from app.ai_engine.prediction.wait_time_model import wait_time_engine
from app.services.websocket_manager import ws_manager
from app.services.alert_service import alert_service
from app.services.aws_service import aws_service

logger = logging.getLogger("queuemind.demo")

FACILITIES_SEED = [
    {
        "id": "fac_canteen_01",
        "name": "University Tech Canteen",
        "slug": "university-canteen",
        "category": "College Canteen",
        "description": "Central Campus Student Dining Hall & Food Courts",
        "address": "Block 4, Central Campus, Science City",
        "max_capacity": 350,
        "target_sla_minutes": 10.0,
        "queues": [
            {"name": "Express Meal Checkout", "code": "EM-01", "length": 22, "service_sec": 90.0, "warn": 20, "crit": 40},
            {"name": "Hot Food & Thali Counter", "code": "HF-02", "length": 34, "service_sec": 160.0, "warn": 25, "crit": 45},
            {"name": "Beverages & Desserts", "code": "BV-03", "length": 14, "service_sec": 75.0, "warn": 15, "crit": 30}
        ],
        "counters": [
            {"num": 1, "name": "Counter 1 - Fast Track Card/UPI", "op": "Alex Rivera", "status": "active", "token": "A-104", "served": 142, "sec": 85.0},
            {"num": 2, "name": "Counter 2 - Meal Combos", "op": "Sarah Chen", "status": "active", "token": "B-088", "served": 118, "sec": 130.0},
            {"num": 3, "name": "Counter 3 - General Orders", "op": "Michael Scott", "status": "active", "token": "C-052", "served": 95, "sec": 145.0},
            {"num": 4, "name": "Counter 4 - Online Pickup", "op": "Elena Rostova", "status": "inactive", "token": "D-010", "served": 40, "sec": 60.0},
            {"num": 5, "name": "Counter 5 - Surge Overflow", "op": "Reserve Staff", "status": "inactive", "token": None, "served": 0, "sec": 110.0}
        ]
    },
    {
        "id": "fac_hospital_01",
        "name": "Metro General Hospital",
        "slug": "metro-general-hospital",
        "category": "Hospital",
        "description": "Central Outpatient Registration, Triage & Diagnostics",
        "address": "742 Healthcare Boulevard, Medical District",
        "max_capacity": 500,
        "target_sla_minutes": 15.0,
        "queues": [
            {"name": "Outpatient General Registration", "code": "OPD-01", "length": 42, "service_sec": 240.0, "warn": 30, "crit": 50},
            {"name": "Diagnostic Lab Sample Intake", "code": "LAB-02", "length": 19, "service_sec": 180.0, "warn": 20, "crit": 35}
        ],
        "counters": [
            {"num": 1, "name": "Counter 1 - Emergency Triage", "op": "Dr. Aris Thorne", "status": "active", "token": "TRI-014", "served": 88, "sec": 180.0},
            {"num": 2, "name": "Counter 2 - Senior & Priority Patients", "op": "Nurse Priya Patel", "status": "active", "token": "SEN-041", "served": 72, "sec": 220.0},
            {"num": 3, "name": "Counter 3 - General Registration A", "op": "David Miller", "status": "active", "token": "GEN-109", "served": 134, "sec": 210.0},
            {"num": 4, "name": "Counter 4 - General Registration B", "op": "Chloe Bennett", "status": "active", "token": "GEN-110", "served": 128, "sec": 215.0},
            {"num": 5, "name": "Counter 5 - Billing & Insurance Desk", "op": "James Wilson", "status": "paused", "token": "BIL-065", "served": 64, "sec": 300.0},
            {"num": 6, "name": "Counter 6 - Evening Overflow Desk", "op": "Reserve Desk", "status": "inactive", "token": None, "served": 0, "sec": 200.0}
        ]
    },
    {
        "id": "fac_clinic_01",
        "name": "City Health Clinic",
        "slug": "city-health-clinic",
        "category": "Clinic",
        "description": "Ambulatory Care, Pharmacy & Pediatric Consultation",
        "address": "12 Green Valley Crossroad, Sector 9",
        "max_capacity": 150,
        "target_sla_minutes": 12.0,
        "queues": [
            {"name": "Prescription Medication Dispense", "code": "RX-01", "length": 18, "service_sec": 120.0, "warn": 15, "crit": 28}
        ],
        "counters": [
            {"num": 1, "name": "Window 1 - Quick Refills", "op": "Pharmacist Sam", "status": "active", "token": "RX-078", "served": 95, "sec": 95.0},
            {"num": 2, "name": "Window 2 - Consultation & Controlled Meds", "op": "Pharmacist Maya", "status": "active", "token": "RX-079", "served": 68, "sec": 160.0},
            {"num": 3, "name": "Window 3 - Insurance Verification", "op": "Staff Jordan", "status": "inactive", "token": None, "served": 22, "sec": 140.0}
        ]
    },
    {
        "id": "fac_bank_01",
        "name": "Apex National Bank",
        "slug": "apex-national-bank",
        "category": "Bank",
        "description": "Downtown Flagship Branch – Retail & Business Tellers",
        "address": "100 Financial Plaza, Commercial Corridor",
        "max_capacity": 200,
        "target_sla_minutes": 8.0,
        "queues": [
            {"name": "Cash Deposits & Withdrawals", "code": "CSH-01", "length": 16, "service_sec": 150.0, "warn": 15, "crit": 25},
            {"name": "Forex & Business Accounts", "code": "BZ-02", "length": 7, "service_sec": 320.0, "warn": 10, "crit": 18}
        ],
        "counters": [
            {"num": 1, "name": "Teller 1 - Fast Cash", "op": "Robert Fox", "status": "active", "token": "T-045", "served": 112, "sec": 110.0},
            {"num": 2, "name": "Teller 2 - Commercial Accounts", "op": "Lisa Ray", "status": "active", "token": "T-046", "served": 84, "sec": 160.0},
            {"num": 3, "name": "Teller 3 - Foreign Exchange", "op": "Anita Roy", "status": "active", "token": "FX-012", "served": 38, "sec": 280.0},
            {"num": 4, "name": "Teller 4 - Account Services", "op": "Daniel Craig", "status": "inactive", "token": None, "served": 15, "sec": 240.0}
        ]
    },
    {
        "id": "fac_civic_01",
        "name": "Civic Service Centre",
        "slug": "civic-service-centre",
        "category": "Service Centre",
        "description": "Citizen Licensing, Municipal Documents & Permits",
        "address": "Government Complex, Tower B",
        "max_capacity": 300,
        "target_sla_minutes": 20.0,
        "queues": [
            {"name": "License Renewal & Vehicle Registration", "code": "LIC-01", "length": 29, "service_sec": 280.0, "warn": 25, "crit": 45}
        ],
        "counters": [
            {"num": 1, "name": "Desk 1 - Document Verification", "op": "Officer Vance", "status": "active", "token": "DOC-088", "served": 76, "sec": 260.0},
            {"num": 2, "name": "Desk 2 - Biometrics & Photography", "op": "Officer Tina", "status": "active", "token": "BIO-054", "served": 82, "sec": 210.0},
            {"num": 3, "name": "Desk 3 - Fee Collection", "op": "Officer Luke", "status": "active", "token": "FEE-090", "served": 91, "sec": 150.0},
            {"num": 4, "name": "Desk 4 - Senior Citizen Exemption", "op": "Officer Rose", "status": "inactive", "token": None, "served": 0, "sec": 220.0}
        ]
    }
]

def seed_database_if_empty(db: Session):
    """Checks and seeds comprehensive initial demo dataset if database is fresh."""
    existing_facilities = db.query(Facility).count()
    if existing_facilities > 0:
        logger.info(f"Database already populated ({existing_facilities} facilities found). Skipping initial seed.")
        return

    logger.info("Initializing fresh QueueMind AI database seed with enterprise multi-facility data...")

    # 1. Seed Users (Roles: Super Admin, Facility Admin, Counter Operator)
    users_to_create = [
        User(
            email="admin@queuemind.ai",
            full_name="Alexander Hayes (Chief Operations Officer)",
            hashed_password=get_password_hash("Admin@123"),
            role="super_admin",
            facility_id=None
        ),
        User(
            email="manager@queuemind.ai",
            full_name="Victoria Sterling (Facility Operations Director)",
            hashed_password=get_password_hash("Manager@123"),
            role="facility_admin",
            facility_id="fac_canteen_01"
        ),
        User(
            email="operator@queuemind.ai",
            full_name="Marcus Reed (Senior Counter Operator)",
            hashed_password=get_password_hash("Operator@123"),
            role="counter_operator",
            facility_id="fac_canteen_01"
        )
    ]
    for u in users_to_create:
        db.add(u)
    db.commit()

    # 2. Seed Facilities, Queues, and Counters
    now = datetime.now(timezone.utc)
    for fac_data in FACILITIES_SEED:
        fac = Facility(
            id=fac_data["id"],
            name=fac_data["name"],
            slug=fac_data["slug"],
            category=fac_data["category"],
            description=fac_data["description"],
            address=fac_data["address"],
            max_capacity=fac_data["max_capacity"],
            target_sla_minutes=fac_data["target_sla_minutes"],
            is_active=True
        )
        db.add(fac)
        db.commit()

        # Queues
        created_queues = []
        for q_data in fac_data["queues"]:
            q = Queue(
                facility_id=fac.id,
                name=q_data["name"],
                code=q_data["code"],
                current_length=q_data["length"],
                avg_service_time_seconds=q_data["service_sec"],
                target_sla_seconds=fac_data["target_sla_minutes"] * 60.0,
                warning_threshold_people=q_data["warn"],
                critical_threshold_people=q_data["crit"],
                status="warning" if q_data["length"] >= q_data["warn"] else "normal"
            )
            db.add(q)
            created_queues.append(q)
        db.commit()

        primary_queue_id = created_queues[0].id if created_queues else None

        # Counters
        for c_data in fac_data["counters"]:
            c = Counter(
                facility_id=fac.id,
                queue_id=primary_queue_id,
                counter_number=c_data["num"],
                name=c_data["name"],
                operator_name=c_data["op"],
                status=c_data["status"],
                current_serving_token=c_data["token"],
                total_served_today=c_data["served"],
                avg_service_time_seconds=c_data["sec"],
                efficiency_score=round(random.uniform(91.0, 98.5), 1),
                last_status_change=now - timedelta(hours=random.randint(1, 4))
            )
            db.add(c)
        db.commit()

        # Seed realistic 24-hour hourly history for trend charts
        for h in range(24, 0, -1):
            hist_time = now - timedelta(hours=h)
            hour_num = hist_time.hour
            # Curve peak around lunch (12-14) or morning (9-11)
            is_peak = (12 <= hour_num <= 14) or (9 <= hour_num <= 11)
            base_q = random.randint(30, 65) if is_peak else random.randint(8, 24)
            active_c = 4 if is_peak else 2
            
            history_record = QueueHistory(
                facility_id=fac.id,
                timestamp=hist_time,
                queue_length=base_q,
                active_counters=active_c,
                avg_wait_seconds=round((base_q * 160.0) / active_c, 1),
                people_served_interval=random.randint(25, 60),
                density_level="High" if base_q > 35 else ("Moderate" if base_q > 18 else "Low")
            )
            db.add(history_record)

        # Seed sample crowd detection
        detection = CrowdDetection(
            facility_id=fac.id,
            timestamp=now - timedelta(minutes=2),
            detected_count=sum(q.current_length for q in created_queues),
            density_level="Moderate",
            confidence_score=0.94,
            detection_mode="simulation",
            zone_name="Main Waiting Area",
            processing_time_ms=42.5,
            bounding_boxes=[
                {"id": f"p_{i}", "x": random.randint(40, 600), "y": random.randint(80, 400), "w": 45, "h": 110, "confidence": 0.95}
                for i in range(12)
            ]
        )
        db.add(detection)

        # Seed sample initial alerts
        alert1 = Alert(
            facility_id=fac.id,
            level="warning",
            title=f"Elevated Lunch Rush Congestion at {fac.name}",
            message=f"Traffic volume increased by 35% over the last 20 minutes. Current waiting count is {sum(q.current_length for q in created_queues)}.",
            metric_triggered="queue_length",
            threshold_value=25.0,
            actual_value=float(sum(q.current_length for q in created_queues)),
            is_acknowledged=False,
            created_at=now - timedelta(minutes=15)
        )
        alert2 = Alert(
            facility_id=fac.id,
            level="info",
            title="Automated Counter Recommendation Available",
            message=f"QueueMind AI recommends activating Counter 4 to maintain waiting time under {fac.target_sla_minutes}m.",
            metric_triggered="waiting_time",
            threshold_value=fac.target_sla_minutes,
            actual_value=fac.target_sla_minutes + 3.5,
            is_acknowledged=True,
            acknowledged_by="Victoria Sterling",
            acknowledged_at=now - timedelta(minutes=30),
            created_at=now - timedelta(minutes=45)
        )
        db.add(alert1)
        db.add(alert2)

        # Seed sample simulation result
        sim = SimulationResult(
            facility_id=fac.id,
            timestamp=now - timedelta(minutes=10),
            current_counters=3,
            proposed_counters=4,
            queue_size=sum(q.current_length for q in created_queues),
            incoming_rate_per_hour=75.0,
            avg_service_time_seconds=150.0,
            current_wait_seconds=950.0,
            predicted_wait_seconds=580.0,
            time_saved_percent=38.9,
            counter_utilization_percent=78.1,
            congestion_reduction_percent=32.4,
            recommended_active_counters=4,
            is_applied=False
        )
        db.add(sim)

    db.commit()
    logger.info("QueueMind AI database successfully seeded with all initial data.")

class DemoSimulationBackgroundTicker:
    """
    Background worker that simulates realistic queue dynamics (people joining,
    service counters finishing tickets, waiting time fluctuations) and emits
    real-time WebSocket broadcasts.
    """
    def __init__(self):
        self.is_running = False

    async def start(self, get_db_fn):
        self.is_running = True
        logger.info("DemoSimulationBackgroundTicker started.")
        while self.is_running:
            try:
                await asyncio.sleep(4)  # 4 seconds tick
                db = next(get_db_fn())
                try:
                    # Pick a facility to modulate
                    facility = db.query(Facility).first()
                    if not facility:
                        continue

                    queues = db.query(Queue).filter(Queue.facility_id == facility.id).all()
                    if not queues:
                        continue

                    # Select target queue
                    q = random.choice(queues)
                    # Stochastic variation: arrivals vs served
                    delta = random.choice([-1, 0, 1, 1, -1, 2, -2])
                    new_len = max(5, min(75, q.current_length + delta))
                    q.current_length = new_len
                    q.updated_at = datetime.now(timezone.utc)

                    # Update an active counter
                    active_counters = db.query(Counter).filter(
                        Counter.facility_id == facility.id,
                        Counter.status == "active"
                    ).all()

                    if active_counters and random.random() < 0.45:
                        c_mod = random.choice(active_counters)
                        c_mod.total_served_today += 1
                        # Advance token
                        prefix = c_mod.name[:3].strip("- ")
                        num = random.randint(100, 299)
                        c_mod.current_serving_token = f"{prefix}-{num}"

                    db.commit()

                    # Recompute wait time prediction
                    pred = wait_time_engine.calculate_wait_time(
                        queue_length=new_len,
                        active_counters=len(active_counters),
                        avg_service_time_seconds=q.avg_service_time_seconds,
                        arrival_rate_per_hour=max(20.0, new_len * 2.1),
                        facility_category=facility.category
                    )

                    # Check alerts
                    await alert_service.evaluate_queue_alerts(db, q, pred["predicted_wait_minutes"])

                    # Broadcast real-time update
                    await ws_manager.broadcast_to_facility(facility.id, "QUEUE_TICK", {
                        "queue_id": q.id,
                        "queue_name": q.name,
                        "current_length": q.current_length,
                        "total_waiting": sum(cq.current_length for cq in queues),
                        "predicted_wait_minutes": pred["predicted_wait_minutes"],
                        "traffic_intensity": pred["traffic_intensity"],
                        "congestion_risk": pred["congestion_risk"],
                        "active_counters": len(active_counters),
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    })

                finally:
                    db.close()
            except Exception as e:
                logger.debug(f"Simulation ticker tick error: {e}")
                await asyncio.sleep(4)

    def stop(self):
        self.is_running = False

demo_ticker = DemoSimulationBackgroundTicker()
