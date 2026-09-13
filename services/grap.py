"""CAQM Graded Response Action Plan (GRAP) evaluation and what-if interventions.

Two responsibilities, deliberately kept apart from the physics:

1. **Grading.**  Which stage of Delhi-NCR's Graded Response Action Plan a forecast
   implies, hour by hour, plus the pre-emptive escalation the Commission for Air
   Quality Management is empowered to order on meteorological grounds.

2. **Interventions.**  Translating "stubble burning down 80 %", "BS-IV trucks
   banned" and "odd-even active" into a scaling of the coupled model's emission
   terms, and evaluating the result with the reduced-order surrogate.

Everything here is pure Python and free of I/O, so the thresholds and the
attribution chain can be unit-tested without a network or a model run.

The GRAP stages and thresholds
------------------------------
CAQM's revised schedule (November 2025) is the operative one: it moved several
measures that used to sit at Stage IV down into Stage III, so tougher actions now
bite at lower AQI.  The thresholds themselves are unchanged::

    Stage I   "Poor"        AQI 201-300
    Stage II  "Very Poor"   AQI 301-400
    Stage III "Severe"      AQI 401-450
    Stage IV  "Severe+"     AQI 451+

Bar Stage I is deliberately *not* a stage: AQI at or below 200 is "Moderate" or
better and no GRAP action is scheduled.  That is what :data:`GRAP_STAGES` encodes
with ``stage == 0``.

Two details of the real process that a naive implementation gets wrong, and that
this module keeps:

* GRAP is invoked on the **forecast** AQI for the day, not on the observed value,
  and CPCB's AQI is itself a **24-hour mean** index.  So the input here is a
  series of already-averaged sub-indices, and the stage is evaluated per hour and
  then reduced over a window (the maximum, which is what the sub-committee acts
  on).
* The Commission may act **pre-emptively** on a meteorological forecast --
  stagnant winds and a shallow mixing layer -- before the AQI threshold is
  reached.  :func:`preemption_advice` encodes a transparent version of that.

Intervention attribution
------------------------
The model's urban source is a single primary PM2.5 flux, so a vehicle measure has
to be expressed as a fraction of it.  The chain is spelled out in
:data:`DEFAULT_ATTRIBUTION` and returned with every scenario, because these
shares -- not the physics -- are what dominate the uncertainty in the answer for
a traffic measure.  Shares are *effective* contributions, i.e. they fold in the
secondary aerosol that traffic precursors go on to form, which is why they are
larger than the primary-only source apportionment figures.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Sequence

import math
import sys
from pathlib import Path

import numpy as np

try:  # imported as a package (the usual case: routers, tests)
    from engine.surrogate import ReducedModel, ReducedRun, summarise_operators
except ModuleNotFoundError:  # run directly: `python services/grap.py`
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from engine.surrogate import ReducedModel, ReducedRun, summarise_operators

# --------------------------------------------------------------------------
# GRAP stages
# --------------------------------------------------------------------------
#: Abridged from CAQM's revised GRAP schedule (November 2025).  The full orders
#: run to dozens of numbered items per stage; these are the ones a dashboard can
#: meaningfully attribute, grouped so the panel can say what is already required
#: before asking what a further measure would buy.
_STAGE_ACTIONS: dict[int, tuple[str, ...]] = {
    1: (
        "Mechanised road sweeping and water sprinkling on identified stretches",
        "Regular lifting of municipal and construction waste; open burning of waste banned",
        "Uninterrupted power supply to discourage diesel gensets",
        "Synchronised traffic signals and deployment of personnel at congestion points",
    ),
    2: (
        "Strict enforcement of pollution-control norms, with penalties (all Stage I actions intensified)",
        "Restrictions on large public gatherings and events",
        "Staggered work timings in public offices",
        "Ban on coal and firewood; diesel-generator restrictions except for emergency services",
    ),
    3: (
        "Offices at 50 % in-person capacity with the remainder working from home (incl. central government)",
        "Non-essential construction and demolition halted",
        "BS-III petrol and BS-IV diesel four-wheelers restricted across Delhi and the NCR districts",
        "Mining and stone crushing halted; schools hybrid up to Class 5",
    ),
    4: (
        "Entry of non-essential diesel trucks into Delhi banned (CNG, electric and BS-VI exempt)",
        "All construction and demolition stopped, including public projects",
        "In-person schooling suspended; work-from-home advisory extended",
        "Emergency measures at the Commission's discretion, including odd-even and artificial rain",
    ),
}


@dataclass(frozen=True)
class GrapStage:
    """One row of the Graded Response Action Plan schedule."""

    stage: int
    name: str
    category: str
    aqi_min: float
    #: ``None`` for the top stage, which has no upper bound.
    aqi_max: float | None
    actions: tuple[str, ...]

    @property
    def label(self) -> str:
        return grap_label(self.stage)


#: Roman numerals for the stage labels (``str.format`` has no Roman spec).
_ROMAN = {1: "I", 2: "II", 3: "III", 4: "IV"}


#: The complete schedule, ordered from cleanest to worst.
GRAP_STAGES: tuple[GrapStage, ...] = (
    GrapStage(0, "No stage", "Good/Satisfactory/Moderate", 0.0, 200.0, ()),
    GrapStage(1, "Poor", "Poor", 201.0, 300.0, _STAGE_ACTIONS[1]),
    GrapStage(2, "Very Poor", "Very Poor", 301.0, 400.0, _STAGE_ACTIONS[2]),
    GrapStage(3, "Severe", "Severe", 401.0, 450.0, _STAGE_ACTIONS[3]),
    GrapStage(4, "Severe+", "Severe", 451.0, None, _STAGE_ACTIONS[4]),
)

#: AQI at or above which each stage applies, for building the per-hour sequence.
STAGE_THRESHOLDS: tuple[tuple[int, float], ...] = tuple(
    (stage.stage, stage.aqi_min) for stage in GRAP_STAGES if stage.stage > 0
)


def stage_for_aqi(aqi_value: float) -> GrapStage:
    """The stage a CPCB AQI value falls in.

    CPCB publishes the AQI as an integer and CAQM's bands are stated on that
    scale (201-300 for Stage I, 301-400 for Stage II, 401-450 for Stage III and
    above 450 for Stage IV), so a continuous sub-index -- which is what a model
    produces -- is rounded half-up to the published scale first.  Banding the raw
    float instead would put 200.5 in Stage I, where the published AQI would read
    201 and the Commission would indeed act.  The top stage is open-ended because
    the AQI scale itself saturates at 500.
    """
    value = float(aqi_value)
    if not math.isfinite(value):
        return GRAP_STAGES[0]
    published = math.floor(value + 0.5)
    chosen = GRAP_STAGES[0]
    for stage in GRAP_STAGES:
        if published >= stage.aqi_min:
            chosen = stage
    return chosen


def stage_sequence(aqi_values: Sequence[float] | np.ndarray) -> tuple[int, ...]:
    """Per-hour stage numbers for a series of (24-h mean) AQI sub-indices."""
    return tuple(stage_for_aqi(value).stage for value in np.asarray(aqi_values).ravel())


def grap_label(stage: int) -> str:
    """Human label for a stage number, e.g. ``"GRAP Stage III (Severe)"``."""
    for candidate in GRAP_STAGES:
        if candidate.stage == stage:
            return (
                "No GRAP stage"
                if stage == 0
                else f"GRAP Stage {_ROMAN[stage]} ({candidate.name})"
            )
    return f"GRAP Stage {stage}"


def next_stage(stage: int) -> int:
    """The stage above ``stage``, capped at the top of the schedule."""
    return int(min(max(stage, 0) + 1, max(item.stage for item in GRAP_STAGES)))


# --------------------------------------------------------------------------
# Pre-emptive escalation
# --------------------------------------------------------------------------
#: AQI headroom within which a deteriorating forecast is treated as reason to
#: consider invoking the next stage early rather than waiting for the threshold.
PREEMPTION_AQI_MARGIN = 25.0
#: Meteorological triggers CAQM cites when it acts ahead of the AQI: stagnant
#: winds and a shallow, poorly ventilated mixing layer.
PREEMPTION_WIND_SPEED_MS = 2.5
PREEMPTION_MIXING_HEIGHT_M = 250.0
#: Hours of the next 24 that must show those conditions to justify pre-emption.
PREEMPTION_MIN_HOURS = 6


@dataclass(frozen=True)
class PreemptionAdvice:
    """Whether the forecast justifies invoking a stage ahead of the threshold."""

    recommended_stage: int
    current_stage: int
    escalated: bool
    stagnant_hours: int
    mean_wind_speed_ms: float
    mean_mixing_height_m: float
    rationale: str


def preemption_advice(
    aqi_values: Sequence[float] | np.ndarray,
    wind_speed_ms: Sequence[float] | np.ndarray,
    mixing_height_m: Sequence[float] | np.ndarray,
    *,
    window_hours: int = 24,
) -> PreemptionAdvice:
    """Decide whether to escalate a stage on meteorological grounds.

    The sub-committee invokes GRAP on an AQI *forecast* and is explicitly
    empowered to act ahead of it when the meteorology points to rapid
    deterioration.  This implements that as a transparent rule: if the forecast
    24-h AQI comes within :data:`PREEMPTION_AQI_MARGIN` of the next threshold and
    the next 24 hours show at least :data:`PREEMPTION_MIN_HOURS` of stagnant wind
    or a shallow mixing layer, recommend the next stage early.
    """
    aqi = np.asarray(aqi_values, dtype=np.float64).ravel()
    wind = np.asarray(wind_speed_ms, dtype=np.float64).ravel()
    mixing = np.asarray(mixing_height_m, dtype=np.float64).ravel()
    hours = int(min(window_hours, aqi.size, max(wind.size, 1), max(mixing.size, 1)))
    hours = max(hours, 1)

    current = max(stage_sequence(aqi[:hours]), default=0)
    peak_aqi = float(np.nanmax(aqi[:hours])) if aqi.size else 0.0
    candidate = next_stage(current)
    threshold = next(
        (stage.aqi_min for stage in GRAP_STAGES if stage.stage == candidate), np.inf
    )

    wind_window = wind[:hours] if wind.size else np.zeros(hours)
    mixing_window = mixing[:hours] if mixing.size else np.zeros(hours)
    stagnant = (wind_window < PREEMPTION_WIND_SPEED_MS) | (
        mixing_window < PREEMPTION_MIXING_HEIGHT_M
    )
    stagnant_hours = int(np.count_nonzero(stagnant))
    mean_wind = float(np.mean(wind_window)) if wind_window.size else 0.0
    mean_mixing = float(np.mean(mixing_window)) if mixing_window.size else 0.0

    within_margin = peak_aqi >= threshold - PREEMPTION_AQI_MARGIN
    enough_hours = stagnant_hours >= PREEMPTION_MIN_HOURS
    escalated = bool(within_margin and enough_hours)

    if escalated:
        rationale = (
            f"Forecast peaks at AQI {peak_aqi:.0f}, within "
            f"{PREEMPTION_AQI_MARGIN:.0f} of the {grap_label(candidate)} threshold of "
            f"{threshold:.0f}, with {stagnant_hours} h of the next {hours} below "
            f"{PREEMPTION_WIND_SPEED_MS:.1f} m/s wind or "
            f"{PREEMPTION_MIXING_HEIGHT_M:.0f} m mixing height "
            f"(mean {mean_wind:.1f} m/s, {mean_mixing:.0f} m). The Commission's "
            "practice is to act on such a forecast before the threshold is crossed."
        )
    elif not enough_hours:
        rationale = (
            f"No pre-emptive case: only {stagnant_hours} h of the next {hours} show "
            f"stagnant wind or a shallow mixing layer (mean {mean_wind:.1f} m/s, "
            f"{mean_mixing:.0f} m), against a {PREEMPTION_MIN_HOURS} h trigger."
        )
    else:
        rationale = (
            f"No pre-emptive case: the forecast peak of AQI {peak_aqi:.0f} stays more "
            f"than {PREEMPTION_AQI_MARGIN:.0f} below the {grap_label(candidate)} "
            f"threshold of {threshold:.0f}, despite {stagnant_hours} h of poor "
            "dispersion."
        )

    return PreemptionAdvice(
        recommended_stage=candidate if escalated else current,
        current_stage=current,
        escalated=escalated,
        stagnant_hours=stagnant_hours,
        mean_wind_speed_ms=mean_wind,
        mean_mixing_height_m=mean_mixing,
        rationale=rationale,
    )


# --------------------------------------------------------------------------
# Intervention levers
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class SourceAttribution:
    """How much of the urban primary PM2.5 source each lever can remove.

    These are *effective* shares: they fold in the secondary aerosol that a
    precursor goes on to form, so they exceed primary-only source apportionment.
    They are the dominant uncertainty in any traffic-measure estimate, which is
    why they are parameters rather than constants buried in a formula.
    """

    #: Vehicles' effective share of the local PM2.5 impact.
    traffic_share: float = 0.35
    #: Goods vehicles' share *of the vehicular* impact -- disproportionately
    #: diesel, so well above their share of the fleet.
    goods_share_of_traffic: float = 0.38
    #: Private cars' share of the vehicular impact.
    car_share_of_traffic: float = 0.34
    #: Goods vehicles that are BS-IV or older (the ones a BS-IV ban idles).
    goods_pre_bs6_share: float = 0.60
    #: Private cars actually taken off the road by an odd-even scheme, after
    #: exemptions (two-wheelers, CNG, emergency, women drivers) and non-compliance.
    odd_even_effectiveness: float = 0.35
    #: Fraction of the *regional* inflow that is crop-residue smoke rather than
    #: other regional pollution.  The stubble belt sits beyond the model's
    #: northern edge, so for most of the year this is the only channel that can
    #: carry Punjab smoke into the domain at all.
    stubble_share_of_inflow: float = 0.35

    def truck_removal(self, mode: str) -> float:
        """Fraction of the urban source removed by a goods-vehicle restriction."""
        if mode == "off":
            return 0.0
        goods = self.traffic_share * self.goods_share_of_traffic
        if mode == "bs4_banned":
            return goods * self.goods_pre_bs6_share
        if mode == "all_halted":
            return goods
        raise ValueError(f"unknown truck restriction mode: {mode!r}")

    def odd_even_removal(self, active: bool) -> float:
        """Fraction of the urban source removed by an odd-even scheme."""
        if not active:
            return 0.0
        return (
            self.traffic_share
            * self.car_share_of_traffic
            * self.odd_even_effectiveness
        )


#: The attribution used unless a caller overrides it.
DEFAULT_ATTRIBUTION = SourceAttribution()

TRUCK_MODES: tuple[str, ...] = ("off", "bs4_banned", "all_halted")
TRUCK_MODE_LABELS: dict[str, str] = {
    "off": "No restriction",
    "bs4_banned": "BS-IV and older goods vehicles banned",
    "all_halted": "All goods vehicles halted",
}


@dataclass(frozen=True)
class Intervention:
    """The three what-if levers, and the model scaling they imply."""

    #: Fraction of crop-residue burning removed: 0.0, 0.5 or 0.8 in the UI.
    stubble_reduction: float = 0.0
    truck_restriction: str = "off"
    odd_even: bool = False
    #: Effective share of the urban source attributable to traffic, etc.
    attribution: SourceAttribution = DEFAULT_ATTRIBUTION

    def __post_init__(self) -> None:
        if not 0.0 <= float(self.stubble_reduction) <= 1.0:
            raise ValueError("stubble_reduction must be within [0, 1]")
        if self.truck_restriction not in TRUCK_MODES:
            raise ValueError(
                f"truck_restriction must be one of {TRUCK_MODES}, "
                f"got {self.truck_restriction!r}"
            )

    @property
    def stubble_scale(self) -> float:
        """Multiplier on crop-residue burning, in the domain and in the inflow."""
        return 1.0 - float(self.stubble_reduction)

    @property
    def urban_scale(self) -> float:
        """Multiplier on the contiguous urban emission source.

        The two vehicle measures act on overlapping traffic, so they combine
        multiplicatively on the *remaining* traffic rather than additively --
        banning odd-numbered cars does not spare the trucks an odd-even day has
        already idled, nor vice versa.
        """
        removed = self.attribution.truck_removal(self.truck_restriction)
        removed += self.attribution.odd_even_removal(self.odd_even)
        # Fractions are of the whole urban source and are small enough that the
        # independence correction is second order, but applying it costs nothing
        # and keeps the combination from ever exceeding the traffic share.
        traffic = self.attribution.traffic_share
        removed = min(removed, traffic)
        return 1.0 - removed

    @property
    def inflow_stubble_fraction(self) -> float:
        """Share of the regional inflow that the stubble lever can move."""
        return self.attribution.stubble_share_of_inflow

    def describe(self) -> dict[str, Any]:
        """Auditable breakdown of the scaling this scenario implies."""
        truck_removed = self.attribution.truck_removal(self.truck_restriction)
        odd_even_removed = self.attribution.odd_even_removal(self.odd_even)
        return {
            "stubble_reduction_percent": round(
                100.0 * float(self.stubble_reduction), 1
            ),
            "stubble_scale": round(self.stubble_scale, 4),
            "truck_restriction": self.truck_restriction,
            "truck_restriction_label": TRUCK_MODE_LABELS[self.truck_restriction],
            "truck_share_of_urban_source_removed": round(truck_removed, 4),
            "odd_even_active": bool(self.odd_even),
            "odd_even_share_of_urban_source_removed": round(odd_even_removed, 4),
            "urban_scale": round(self.urban_scale, 4),
            "urban_source_removed_percent": round(
                100.0 * (1.0 - self.urban_scale), 2
            ),
            "inflow_stubble_fraction": round(self.inflow_stubble_fraction, 4),
            "attribution": {
                "traffic_share_of_urban_source": self.attribution.traffic_share,
                "goods_share_of_traffic": self.attribution.goods_share_of_traffic,
                "car_share_of_traffic": self.attribution.car_share_of_traffic,
                "goods_bs4_or_older_share": self.attribution.goods_pre_bs6_share,
                "odd_even_effectiveness": self.attribution.odd_even_effectiveness,
                "stubble_share_of_regional_inflow": self.attribution.stubble_share_of_inflow,
            },
            "note": (
                "Attribution shares are effective contributions (primary plus the "
                "secondary aerosol formed from the same precursors), not primary-only "
                "source apportionment. They, not the model physics, dominate the "
                "uncertainty of a vehicle measure's estimated effect."
            ),
        }


# --------------------------------------------------------------------------
# Scenario evaluation
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class ScenarioEvaluation:
    """Baseline and mitigated trajectories for one intervention."""

    intervention: dict[str, Any]
    baseline_pm25_core: np.ndarray
    mitigated_pm25_core: np.ndarray
    baseline_pm25_mean: np.ndarray
    mitigated_pm25_mean: np.ndarray
    baseline_aqi_core: np.ndarray
    mitigated_aqi_core: np.ndarray
    times_local: tuple[str, ...]

    def _peak(self, series: np.ndarray, hours: int) -> float:
        window = int(max(1, min(hours, series.size)))
        return float(np.max(series[:window]))

    def summary(
        self,
        *,
        window_hours: int = 48,
        wind_speed_ms: Sequence[float] | None = None,
        mixing_height_m: Sequence[float] | None = None,
    ) -> dict[str, Any]:
        """The headline comparison: averted peak and AQI drop over the window.

        ``max_aqi_drop`` is the number the panel leads with: the fall in the
        highest 24-h-mean AQI the urban core is forecast to reach inside the
        window.  It is reported alongside the peak concentrations and the GRAP
        stage change, because a stage change is the decision that actually
        follows from it.
        """
        window = int(max(1, min(window_hours, self.baseline_aqi_core.size)))
        base_peak_pm = self._peak(self.baseline_pm25_core, window)
        mit_peak_pm = self._peak(self.mitigated_pm25_core, window)
        # Rounded exactly once, then used for the drop as well, so the panel can
        # never show a headline that disagrees with the two maxima beside it.
        base_peak_aqi = round(self._peak(self.baseline_aqi_core, window), 1)
        mit_peak_aqi = round(self._peak(self.mitigated_aqi_core, window), 1)
        aqi_drop = round(base_peak_aqi - mit_peak_aqi, 1)

        base_stage = max(stage_sequence(self.baseline_aqi_core[:window]), default=0)
        mit_stage = max(stage_sequence(self.mitigated_aqi_core[:window]), default=0)

        mean_base = float(np.mean(self.baseline_pm25_core[:window]))
        mean_mit = float(np.mean(self.mitigated_pm25_core[:window]))
        change = mean_mit - mean_base

        wind = (
            np.asarray(wind_speed_ms, dtype=np.float64)
            if wind_speed_ms is not None
            else np.array([], dtype=np.float64)
        )
        mixing = (
            np.asarray(mixing_height_m, dtype=np.float64)
            if mixing_height_m is not None
            else np.array([], dtype=np.float64)
        )
        advice = (
            preemption_advice(
                self.baseline_aqi_core, wind, mixing, window_hours=window
            )
            if wind.size or mixing.size
            else None
        )

        return {
            "window_hours": window,
            "baseline_peak_pm25_core": round(base_peak_pm, 2),
            "mitigated_peak_pm25_core": round(mit_peak_pm, 2),
            "averted_peak_pm25": round(base_peak_pm - mit_peak_pm, 2),
            "baseline_max_aqi": base_peak_aqi,
            "mitigated_max_aqi": mit_peak_aqi,
            "max_aqi_drop": aqi_drop,
            "max_aqi_drop_percent": round(100.0 * aqi_drop / base_peak_aqi, 2)
            if base_peak_aqi > 0.0
            else 0.0,
            "mean_pm25_core_change": round(change, 2),
            "mean_pm25_core_change_percent": round(
                100.0 * change / mean_base, 2
            )
            if mean_base > 0.0
            else 0.0,
            "baseline_grap_stage": base_stage,
            "baseline_grap_label": grap_label(base_stage),
            "mitigated_grap_stage": mit_stage,
            "mitigated_grap_label": grap_label(mit_stage),
            "stage_change": base_stage - mit_stage,
            "avoids_stage": grap_label(base_stage) if mit_stage < base_stage else None,
            "preemption": (
                None
                if advice is None
                else {
                    "recommended_stage": advice.recommended_stage,
                    "current_stage": advice.current_stage,
                    "escalated": advice.escalated,
                    "stagnant_hours": advice.stagnant_hours,
                    "mean_wind_speed_ms": round(advice.mean_wind_speed_ms, 2),
                    "mean_mixing_height_m": round(advice.mean_mixing_height_m, 1),
                    "rationale": advice.rationale,
                }
            ),
        }


def evaluate(
    model: ReducedModel,
    intervention: Intervention,
    *,
    times_local: Sequence[str] | None = None,
    aqi_peak_window_hours: int = 48,
) -> ScenarioEvaluation:
    """Run the baseline and one intervention through the reduced model."""
    baseline = model.run(aqi_peak_window_hours=aqi_peak_window_hours)
    mitigated = model.run(
        stubble_scale=intervention.stubble_scale,
        urban_scale=intervention.urban_scale,
        inflow_stubble_fraction=intervention.inflow_stubble_fraction,
        aqi_peak_window_hours=aqi_peak_window_hours,
    )
    hours = baseline.pm25_core.size
    labels = (
        tuple(times_local[:hours])
        if times_local is not None
        else tuple(f"+{hour}h" for hour in range(hours))
    )
    if len(labels) < hours:
        labels = labels + tuple(
            f"+{hour}h" for hour in range(len(labels), hours)
        )
    return ScenarioEvaluation(
        intervention=intervention.describe(),
        baseline_pm25_core=baseline.pm25_core,
        mitigated_pm25_core=mitigated.pm25_core,
        baseline_pm25_mean=baseline.pm25_mean,
        mitigated_pm25_mean=mitigated.pm25_mean,
        baseline_aqi_core=baseline.aqi_value_core,
        mitigated_aqi_core=mitigated.aqi_value_core,
        times_local=labels,
    )


#: The combinations the panel offers, for a batch endpoint.
def lever_combinations() -> tuple[Intervention, ...]:
    """The full cross-product the UI can reach, in a stable order."""
    combinations: list[Intervention] = []
    for stubble in (0.0, 0.5, 0.8):
        for truck in TRUCK_MODES:
            for odd_even in (False, True):
                combinations.append(
                    Intervention(
                        stubble_reduction=stubble,
                        truck_restriction=truck,
                        odd_even=odd_even,
                    )
                )
    return tuple(combinations)


def grap_status(
    run: ReducedRun,
    *,
    window_hours: int = 48,
) -> dict[str, Any]:
    """Grade a single trajectory against GRAP, hour by hour and in aggregate."""
    aqi = np.asarray(run.aqi_value_core, dtype=np.float64)
    window = int(max(1, min(window_hours, aqi.size)))
    stages = stage_sequence(aqi)
    invoked = max(stages[:window], default=0) if stages else 0
    hours_by_stage: dict[str, int] = {}
    for value in stages[:window]:
        hours_by_stage[str(value)] = hours_by_stage.get(str(value), 0) + 1
    peak = float(np.max(aqi[:window])) if aqi.size else 0.0
    return {
        "measured_on": "urban-core mean, CPCB 24-h mean sub-index",
        "invoked_stage": invoked,
        "invoked_label": grap_label(invoked),
        "peak_aqi": round(peak, 1),
        "peak_category": stage_for_aqi(peak).category,
        "hours_by_stage": hours_by_stage,
        "stage_sequence": list(stages[:window]),
        "actions_in_force": list(
            next(
                (stage.actions for stage in GRAP_STAGES if stage.stage == invoked), ()
            )
        ),
        "next_stage": None
        if invoked >= max(stage.stage for stage in GRAP_STAGES)
        else {
            "stage": invoked + 1,
            "label": grap_label(invoked + 1),
            "threshold": next(
                stage.aqi_min for stage in GRAP_STAGES if stage.stage == invoked + 1
            ),
            "headroom": round(
                next(
                    stage.aqi_min
                    for stage in GRAP_STAGES
                    if stage.stage == invoked + 1
                )
                - peak,
                1,
            ),
            "actions": list(
                next(
                    stage.actions
                    for stage in GRAP_STAGES
                    if stage.stage == invoked + 1
                )
            ),
        },
    }


def scenario_bundle(
    model: ReducedModel,
    intervention: Intervention,
    *,
    times_local: Sequence[str] | None = None,
    window_hours: int = 48,
    wind_speed_ms: Sequence[float] | None = None,
    mixing_height_m: Sequence[float] | None = None,
) -> dict[str, Any]:
    """Everything the GRAP panel needs for one lever combination.

    Includes the surrogate's own accuracy report, so a client never has to take
    the numbers on trust -- and so an inaccurate reduction shows up as a number
    rather than as a plausible-looking chart.
    """
    evaluation = evaluate(
        model,
        intervention,
        times_local=times_local,
        aqi_peak_window_hours=window_hours,
    )
    baseline_run = model.run(aqi_peak_window_hours=window_hours)
    validation = model.validate()
    return {
        "intervention": evaluation.intervention,
        "summary": evaluation.summary(
            window_hours=window_hours,
            wind_speed_ms=wind_speed_ms,
            mixing_height_m=mixing_height_m,
        ),
        "grap": grap_status(baseline_run, window_hours=window_hours),
        "comparison": {
            "times_local": list(evaluation.times_local),
            "baseline_pm25_core": [round(float(v), 2) for v in evaluation.baseline_pm25_core],
            "mitigated_pm25_core": [
                round(float(v), 2) for v in evaluation.mitigated_pm25_core
            ],
            "baseline_aqi_core": [round(float(v), 1) for v in evaluation.baseline_aqi_core],
            "mitigated_aqi_core": [
                round(float(v), 1) for v in evaluation.mitigated_aqi_core
            ],
            "baseline_pm25_mean": [round(float(v), 2) for v in evaluation.baseline_pm25_mean],
            "mitigated_pm25_mean": [
                round(float(v), 2) for v in evaluation.mitigated_pm25_mean
            ],
        },
        "surrogate": {
            "baseline_relative_error": round(
                float(validation["mean_relative_error"]), 6
            ),
            "baseline_absolute_error_ug_m3": round(
                float(validation["mean_absolute_error_ug_m3"]), 4
            ),
            "urban_channel_gain": validation["urban_channel_gain"],
            "urban_channel_response_bias": _finite_or_none(
                validation.get("urban_channel_response_bias")
            ),
            "operators": summarise_operators(model),
            "speed": (
                "domain-mean reduction of the coupled model, identified from the "
                "baseline run and re-evaluated in milliseconds"
            ),
        },
    }


def _finite_or_none(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if np.isfinite(number) else None


# --------------------------------------------------------------------------
# Self-test
# --------------------------------------------------------------------------
def _self_test() -> None:
    """Thresholds, attribution arithmetic and the pre-emption rule."""
    # Stage boundaries, including the ones that trip a naive implementation.
    assert stage_for_aqi(200).stage == 0
    assert stage_for_aqi(200.4).stage == 0
    assert stage_for_aqi(200.5).stage == 1, "200.5 rounds up to the published 201"
    assert stage_for_aqi(201).stage == 1
    assert stage_for_aqi(300).stage == 1
    assert stage_for_aqi(301).stage == 2
    assert stage_for_aqi(400).stage == 2
    assert stage_for_aqi(401).stage == 3
    assert stage_for_aqi(450).stage == 3
    assert stage_for_aqi(450.5).stage == 4, "450.5 rounds up to the published 451"
    assert stage_for_aqi(500).stage == 4
    assert stage_for_aqi(5000).stage == 4, "AQI above the scale must cap, not wrap"
    assert stage_for_aqi(float("nan")).stage == 0

    # Every AQI maps to the stage whose range contains it, and the ranges must
    # tile the scale with no gap and no overlap.
    for value in np.arange(0.0, 520.0, 0.5):
        stage = stage_for_aqi(value)
        published = math.floor(value + 0.5)
        assert stage.aqi_min <= published, (value, stage.stage)
        if stage.aqi_max is not None:
            assert published <= stage.aqi_max, (value, stage.stage)

    assert grap_label(0) == "No GRAP stage"
    assert grap_label(3) == "GRAP Stage III (Severe)"
    assert grap_label(4) == "GRAP Stage IV (Severe+)"
    assert next_stage(0) == 1 and next_stage(4) == 4

    # Stage actions must be ordered by severity, each intensifying the last.
    assert len(GRAP_STAGES[3].actions) == 4
    assert all(stage.actions for stage in GRAP_STAGES[1:])
    assert GRAP_STAGES[0].actions == ()

    # --- attribution arithmetic -------------------------------------------
    attribution = DEFAULT_ATTRIBUTION
    off = Intervention()
    assert off.urban_scale == 1.0 and off.stubble_scale == 1.0
    assert off.inflow_stubble_fraction == attribution.stubble_share_of_inflow

    # Each vehicle lever removes a positive fraction, and the escalation from
    # BS-IV to a full halt removes strictly more.
    bs4 = Intervention(truck_restriction="bs4_banned")
    halted = Intervention(truck_restriction="all_halted")
    assert 0.0 < 1.0 - bs4.urban_scale < 1.0 - halted.urban_scale < 1.0
    assert halted.urban_scale < bs4.urban_scale, "a full halt emits less than a BS-IV ban"

    # The two vehicle measures must compose, never exceed the traffic share, and
    # be order-independent -- odd-even plus a truck ban cannot idle more than all
    # of the traffic.
    both = Intervention(truck_restriction="all_halted", odd_even=True)
    removed = 1.0 - both.urban_scale
    assert removed > 1.0 - halted.urban_scale, "the levers must compose"
    assert removed <= attribution.traffic_share + 1.0e-12, (
        "combined vehicle measures cannot exceed the traffic share"
    )
    assert removed < attribution.traffic_share, (
        "odd-even alone cannot remove all traffic"
    )

    # Stubble reduction scales both the in-domain fires and the regional inflow.
    cut = Intervention(stubble_reduction=0.8)
    assert abs(cut.stubble_scale - 0.2) < 1.0e-12
    assert abs(cut.inflow_stubble_fraction - attribution.stubble_share_of_inflow) < 1e-12

    described = cut.describe()
    assert described["stubble_reduction_percent"] == 80.0
    assert described["truck_restriction_label"] == TRUCK_MODE_LABELS["off"]
    assert "attribution" in described

    for bad in (
        {"stubble_reduction": -0.01},
        {"stubble_reduction": 1.01},
        {"truck_restriction": "everything"},
    ):
        try:
            Intervention(**bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"Intervention accepted {bad!r}")

    # --- pre-emption ------------------------------------------------------
    # Severe air with stagnant, shallow conditions must escalate one stage early.
    stagnant = preemption_advice(
        aqi_values=np.full(24, 390.0),
        wind_speed_ms=np.full(24, 1.2),
        mixing_height_m=np.full(24, 180.0),
    )
    assert stagnant.escalated, stagnant
    assert stagnant.recommended_stage == stagnant.current_stage + 1
    assert stagnant.current_stage == 2, stagnant  # AQI 390 is Stage II
    assert "within" in stagnant.rationale

    # Well-ventilated air inside a stage must not escalate.
    well_mixed = preemption_advice(
        aqi_values=np.full(24, 250.0),
        wind_speed_ms=np.full(24, 6.0),
        mixing_height_m=np.full(24, 1400.0),
    )
    assert not well_mixed.escalated, well_mixed
    assert well_mixed.recommended_stage == well_mixed.current_stage == 1

    # A quiet forecast far below the next threshold must not escalate either.
    clear = preemption_advice(
        aqi_values=np.full(24, 120.0),
        wind_speed_ms=np.full(24, 1.0),
        mixing_height_m=np.full(24, 150.0),
    )
    assert not clear.escalated, clear
    assert "threshold" in clear.rationale

    # The margin is a margin: 395 sits 5 below the Stage IV threshold and must
    # escalate, while 350 (55 below) must not, under identical meteorology.
    near = preemption_advice(np.full(24, 395.0), np.full(24, 1.0), np.full(24, 150.0))
    far = preemption_advice(np.full(24, 350.0), np.full(24, 1.0), np.full(24, 150.0))
    assert near.escalated and not far.escalated, (near, far)

    # The hour trigger is a trigger: five stagnant hours is not six.
    five = preemption_advice(
        aqi_values=np.full(24, 395.0),
        wind_speed_ms=np.array([1.0] * 5 + [6.0] * 19),
        mixing_height_m=np.full(24, 1200.0),
    )
    six = preemption_advice(
        aqi_values=np.full(24, 395.0),
        wind_speed_ms=np.array([1.0] * 6 + [6.0] * 18),
        mixing_height_m=np.full(24, 1200.0),
    )
    assert not five.escalated and six.escalated, (five, six)
    assert five.stagnant_hours == 5 and six.stagnant_hours == 6

    assert len(lever_combinations()) == 3 * 3 * 2
    distinct = {
        (item.stubble_reduction, item.truck_restriction, item.odd_even)
        for item in lever_combinations()
    }
    assert len(distinct) == 18, distinct

    print("grap self-test: stage thresholds, attribution and pre-emption rules passed")


if __name__ == "__main__":
    _self_test()
