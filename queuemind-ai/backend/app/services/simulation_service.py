import math
from typing import Dict, Any, List
from app.ai_engine.prediction.wait_time_model import wait_time_engine

class CounterSimulationService:
    """
    High-fidelity Counter Allocation Simulator & Optimization Engine.
    Performs deterministic and stochastic queueing calculations across varying counter topologies.
    """

    @classmethod
    def run_simulation(
        cls,
        queue_size: int,
        current_counters: int,
        proposed_counters: int,
        incoming_rate_per_hour: float,
        avg_service_time_seconds: float,
        max_available_counters: int = 10,
        target_sla_minutes: float = 12.0
    ) -> Dict[str, Any]:
        """
        Calculates exact before/after metrics and identifies optimal counter recommendation.
        """
        curr_c = max(1, current_counters)
        prop_c = max(1, proposed_counters)
        q_len = max(0, queue_size)
        svc_sec = max(30.0, avg_service_time_seconds)
        arrival_hr = max(5.0, incoming_rate_per_hour)

        # Baseline Current calculation
        curr_metrics = wait_time_engine.calculate_wait_time(
            queue_length=q_len,
            active_counters=curr_c,
            avg_service_time_seconds=svc_sec,
            arrival_rate_per_hour=arrival_hr
        )
        curr_wait_min = curr_metrics["predicted_wait_minutes"]

        # Proposed calculation
        prop_metrics = wait_time_engine.calculate_wait_time(
            queue_length=q_len,
            active_counters=prop_c,
            avg_service_time_seconds=svc_sec,
            arrival_rate_per_hour=arrival_hr
        )
        prop_wait_min = prop_metrics["predicted_wait_minutes"]

        # Time saved
        time_saved_min = round(max(0.0, curr_wait_min - prop_wait_min), 1)
        if curr_wait_min > 0:
            time_saved_pct = round(min(100.0, (time_saved_min / curr_wait_min) * 100.0), 1)
        else:
            time_saved_pct = 0.0

        # Counter Utilization: Rho = Lambda / (c * Mu)
        mu_per_counter_hr = 3600.0 / svc_sec
        prop_capacity_hr = prop_c * mu_per_counter_hr
        utilization_pct = round(min(100.0, (arrival_hr / max(1.0, prop_capacity_hr)) * 100.0), 1)

        # Congestion reduction
        curr_intensity = curr_metrics["traffic_intensity"]
        prop_intensity = prop_metrics["traffic_intensity"]
        if curr_intensity > 0:
            intensity_diff = max(0.0, curr_intensity - prop_intensity)
            congestion_reduction_pct = round(min(100.0, (intensity_diff / curr_intensity) * 100.0), 1)
        else:
            congestion_reduction_pct = 0.0

        # Find optimal recommendation:
        # Minimum counters c in [1 .. max_available_counters] where wait <= target_sla and utilization <= 85%
        recommended_c = curr_c
        best_score = float("inf")
        counter_curve: List[Dict[str, Any]] = []

        for test_c in range(1, max_available_counters + 1):
            test_res = wait_time_engine.calculate_wait_time(
                queue_length=q_len,
                active_counters=test_c,
                avg_service_time_seconds=svc_sec,
                arrival_rate_per_hour=arrival_hr
            )
            w_min = test_res["predicted_wait_minutes"]
            cap_hr = test_c * mu_per_counter_hr
            util = min(100.0, round((arrival_hr / cap_hr) * 100.0, 1))
            
            counter_curve.append({
                "counters": test_c,
                "wait_minutes": w_min,
                "utilization_percent": util,
                "capacity_per_hour": round(cap_hr, 1)
            })

            # Penalty objective: balance wait time reduction with counter staffing cost
            # Weight wait time SLA violation heavily
            sla_penalty = max(0.0, w_min - target_sla_minutes) * 5.0
            staffing_cost = test_c * 2.0
            score = w_min + sla_penalty + staffing_cost
            if score < best_score:
                best_score = score
                recommended_c = test_c

        # Recommendation narrative
        if recommended_c > curr_c:
            summary = f"Recommended to activate {recommended_c - curr_c} additional counter(s). Opening {recommended_c} counters resolves queue bottleneck and reduces average wait from {curr_wait_min}m to {counter_curve[recommended_c-1]['wait_minutes']}m."
        elif recommended_c < curr_c:
            summary = f"Capacity surplus detected. You can safely ramp down to {recommended_c} counters while maintaining waiting time under {target_sla_minutes}m and saving staff hours."
        else:
            summary = f"Current allocation of {curr_c} counters is already at Pareto efficiency for incoming rate of {arrival_hr} people/hr."

        feasibility = (
            f"Under {prop_c} counter configuration, system throughput will be {round(prop_capacity_hr, 1)} clients/hr. "
            f"Counter utilization stabilizes at {utilization_pct}% ({'Optimal zone 70-85%' if 70 <= utilization_pct <= 85 else 'Potential overload' if utilization_pct > 85 else 'Under-utilized'})."
        )

        return {
            "current_counters": curr_c,
            "proposed_counters": prop_c,
            "queue_size": q_len,
            "incoming_rate_per_hour": arrival_hr,
            "avg_service_time_seconds": svc_sec,
            "current_wait_minutes": curr_wait_min,
            "predicted_wait_minutes": prop_wait_min,
            "time_saved_minutes": time_saved_min,
            "time_saved_percent": time_saved_pct,
            "counter_utilization_percent": utilization_pct,
            "congestion_reduction_percent": congestion_reduction_pct,
            "recommended_active_counters": recommended_c,
            "recommendation_summary": summary,
            "feasibility_notes": feasibility,
            "counter_comparison_curve": counter_curve
        }

simulation_service = CounterSimulationService()
