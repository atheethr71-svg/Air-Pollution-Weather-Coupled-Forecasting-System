import io
import csv
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, Query, HTTPException, Response
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.models import Facility, Queue, Counter, QueueHistory, SimulationResult
from app.schemas.schemas import AnalyticsOverviewOut

router = APIRouter(prefix="/analytics", tags=["Analytics"])

def resolve_facility(db: Session, facility_id: Optional[str]) -> Facility:
    if facility_id:
        fac = db.query(Facility).filter(Facility.id == facility_id).first()
        if fac:
            return fac
    fac = db.query(Facility).first()
    if not fac:
        raise HTTPException(status_code=404, detail="Facility not found")
    return fac

@router.get("/overview", response_model=AnalyticsOverviewOut)
def get_analytics_overview(
    facility_id: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    facility = resolve_facility(db, facility_id)
    counters = db.query(Counter).filter(Counter.facility_id == facility.id).all()
    history = db.query(QueueHistory).filter(QueueHistory.facility_id == facility.id).all()

    total_served = sum(c.total_served_today for c in counters)
    avg_wait = round((sum(h.avg_wait_seconds for h in history) / max(1, len(history))) / 60.0, 1) if history else 8.5

    # Group peak hours by hour
    peak_hours_map: Dict[str, List[int]] = {}
    for h in history:
        hour_label = h.timestamp.strftime("%I %p")
        if hour_label not in peak_hours_map:
            peak_hours_map[hour_label] = []
        peak_hours_map[hour_label].append(h.queue_length)

    peak_hours = []
    for hr, lens in peak_hours_map.items():
        avg_len = sum(lens) / len(lens)
        peak_hours.append({
            "hour": hr,
            "avg_queue_size": round(avg_len, 1),
            "congestion_score": min(100, int(avg_len * 2.2))
        })
    peak_hours = sorted(peak_hours, key=lambda x: x["avg_queue_size"], reverse=True)[:8]

    # Counter performance
    counter_perf = []
    for c in counters:
        counter_perf.append({
            "counter_id": c.id,
            "name": c.name,
            "operator_name": c.operator_name,
            "total_served": c.total_served_today,
            "avg_service_time_seconds": c.avg_service_time_seconds,
            "efficiency_score": c.efficiency_score,
            "status": c.status
        })

    # Efficiency trend
    eff_trend = []
    for idx, h in enumerate(history[-12:]):
        eff_trend.append({
            "time": h.timestamp.strftime("%H:%M"),
            "efficiency": round(min(100.0, max(65.0, 100.0 - (h.queue_length * 0.7))), 1),
            "queue_size": h.queue_length
        })

    # Sample before-after simulation
    before_after = {
        "scenario": "Peak Lunch / Morning Surge Optimization",
        "baseline_wait_mins": 24.5,
        "optimized_wait_mins": 11.2,
        "time_saved_percent": 54.3,
        "staffing_adjustment": "+1 Counter Allocated",
        "throughput_gain_per_hr": "+35 clients/hour"
    }

    return {
        "facility_id": facility.id,
        "date_range": "Today (Last 24 Hours)",
        "total_served": total_served,
        "avg_wait_minutes": avg_wait,
        "peak_hours": peak_hours,
        "counter_performance": counter_perf,
        "efficiency_trend": eff_trend,
        "before_after_simulation_sample": before_after
    }

@router.get("/export")
def export_analytics_csv(
    facility_id: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    facility = resolve_facility(db, facility_id)
    history = db.query(QueueHistory).filter(
        QueueHistory.facility_id == facility.id
    ).order_by(QueueHistory.timestamp.desc()).all()
    counters = db.query(Counter).filter(Counter.facility_id == facility.id).all()

    output = io.StringIO()
    writer = csv.writer(output)

    # Header section
    writer.writerow(["QueueMind AI - Operational Analytics Export"])
    writer.writerow(["Facility", facility.name])
    writer.writerow(["Category", facility.category])
    writer.writerow(["Export Timestamp (UTC)", datetime.now(timezone.utc).isoformat()])
    writer.writerow([])

    # Table 1: Counters Performance
    writer.writerow(["--- COUNTER PERFORMANCE ---"])
    writer.writerow(["Counter Number", "Name", "Operator", "Status", "Total Served", "Avg Service Time (s)", "Efficiency (%)"])
    for c in counters:
        writer.writerow([c.counter_number, c.name, c.operator_name, c.status, c.total_served_today, c.avg_service_time_seconds, c.efficiency_score])
    writer.writerow([])

    # Table 2: Hourly Queue History
    writer.writerow(["--- QUEUE HOURLY LOGS ---"])
    writer.writerow(["Timestamp (UTC)", "Queue Length", "Active Counters", "Average Wait (seconds)", "Served in Interval", "Crowd Density Level"])
    for h in history:
        writer.writerow([h.timestamp.isoformat(), h.queue_length, h.active_counters, h.avg_wait_seconds, h.people_served_interval, h.density_level])

    csv_content = output.getvalue()
    filename = f"queuemind_analytics_{facility.slug}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"

    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
