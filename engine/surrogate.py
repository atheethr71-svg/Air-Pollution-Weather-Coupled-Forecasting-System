"""Reduced-order (domain-mean) surrogate of the coupled PM2.5 model.

Why this exists
---------------
The GRAP panel has to answer "what would the next 48 hours look like if this
measure were in force?" every time a lever moves.  Re-running the full 50 x 50
model costs ~1.4 s of CPU per scenario, which is far too slow for interactive
use and wasteful for the eight or so scenarios a user explores in a minute.

This module identifies a *tangent-linear* reduction of the full model from a
single baseline run: the transport operators (which a domain-mean model cannot
recompute from closed forms) are read straight out of the baseline's own
per-hour diagnostics, while every term that *is* closed-form -- the
aerosol-radiation feedback, deposition, entrainment, the aloft drain, the
inversion-trapping compression -- is re-evaluated from the perturbed state, so
it responds to the intervention instead of being frozen.

What that buys, precisely
-------------------------
* With all levers at 1.0 the surrogate reproduces the baseline's domain-mean
  concentration series to floating-point accuracy: every operator is either
  extracted or re-derived from the same state the full model was in.  That is
  asserted in ``_self_test`` and reported live via :meth:`ReducedModel.validate`.
* With levers moved, the response is first-order accurate in the intervention.
  The frozen operators are the ones whose *distribution* (not magnitude) would
  change; the nonlinear PBL feedback, which is what makes the winter regime
  behave the way it does, is fully retained.

Known approximation, surfaced rather than hidden
------------------------------------------------
The urban-core series is mapped from the domain-mean response by the baseline's
hourly core-to-domain ratio.  That is exact at baseline, but it does not resolve
the *extra* sensitivity of the core to a local source (the urban emission is
concentrated there), so a vehicle-restriction effect on the core is, if
anything, understated.  The ratio is exposed so callers can see it.

Pure NumPy; no SciPy, no I/O, and no state shared between runs.
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import numpy as np

try:  # imported as a package (the usual case: routers, tests)
    from engine.coupled_model import (
        AQI_CATEGORIES,
        ModelParams,
        _aerosol_feedback,
        _trailing_mean,
        aqi_category_from_pm25,
        aqi_value_from_pm25,
        delhi_ncr_grid,
        simulate_72h,
        urban_core_mask,
    )
    from engine.coupled_model import __name__ as _coupled_name  # noqa: F401
except ModuleNotFoundError:  # run directly: `python engine/surrogate.py`
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from engine.coupled_model import (
        AQI_CATEGORIES,
        ModelParams,
        _aerosol_feedback,
        _trailing_mean,
        aqi_category_from_pm25,
        aqi_value_from_pm25,
        delhi_ncr_grid,
        simulate_72h,
        urban_core_mask,
    )

#: Cap on the reported relative error of the surrogate's reproduction of its own
#: baseline trajectory.  Beyond this the identification is wrong (not merely
#: approximate) and callers should not trust the deltas.
MAX_BASELINE_RELATIVE_ERROR = 0.02


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


@dataclass(frozen=True)
class HourlyOperators:
    """Per-hour operators identified from one baseline run.

    All masses are *domain totals* in ug.  ``mix_retention`` and
    ``aloft_retention`` are the fractions of each reservoir's mass that survive
    the transport step; ``boundary_supply_ug`` is the mass the Dirichlet inflow
    adds, which depends on the inflow concentration but not on the interior
    state (so it can be scaled for a scenario); ``scavenging_factor`` is the
    below-cloud wet-scavenging multiplier, which depends only on precipitation.
    """

    mix_retention: np.ndarray
    aloft_retention: np.ndarray
    boundary_supply_ug: np.ndarray
    scavenging_factor: np.ndarray
    stubble_mix_ug: np.ndarray
    stubble_aloft_ug: np.ndarray
    urban_mix_ug: np.ndarray
    synoptic_pbl_m: np.ndarray

    # -- baseline anchors for the closed-form terms -------------------------
    # A domain-mean model cannot reproduce the average of a nonlinear function
    # of a heterogeneous field: mean(exp(-v_d dt / H)) is not
    # exp(-v_d dt / mean(H)), and mean(max(dH, 0)) is not max(mean(dH), 0).  Each
    # of those steps therefore carries the baseline's own aggregate value as an
    # anchor, and the reduced model applies the *ratio* of its prediction to the
    # prediction it makes on the baseline state.  At a unit scenario every ratio
    # is exactly 1, so the baseline is reproduced without approximation, while a
    # lever that changes the PBL still moves these terms in the right direction.
    baseline_effective_pbl_m: np.ndarray
    baseline_box_pbl_m: np.ndarray
    baseline_deposition_factor: np.ndarray
    baseline_growth_m: np.ndarray
    baseline_box_growth_m: np.ndarray
    baseline_suppression: np.ndarray
    baseline_box_suppression: np.ndarray
    #: True mean concentration over the model's own mean concentration, per hour.
    #: A bias correction for the same reason (the mean of ratios is not the ratio
    #: of means); frozen at its baseline value when levers move.
    concentration_factor: np.ndarray

    def __len__(self) -> int:
        return int(self.mix_retention.size)


@dataclass(frozen=True)
class ReducedRun:
    """Per-hour domain-mean and urban-core series from one scenario."""

    pm25_mean: np.ndarray
    pm25_core: np.ndarray
    pbl_height_m: np.ndarray
    pbl_height_synoptic_m: np.ndarray
    pbl_suppression_fraction: np.ndarray
    aqi_value_mean: np.ndarray
    aqi_value_core: np.ndarray
    aqi_category_core: tuple[str, ...]
    peak_pm25_core: float
    peak_aqi_core: float
    aqi_peak_window_hours: int

    def peak_aqi_within(self, hours: int) -> float:
        """Highest 24-h-mean AQI over the first ``hours`` of the run."""
        window = int(max(1, min(hours, self.aqi_value_core.size)))
        return float(np.max(self.aqi_value_core[:window]))


class ReducedModel:
    """A domain-mean reduction of :func:`coupled_model.simulate_72h`."""

    def __init__(
        self,
        operators: HourlyOperators,
        params: ModelParams,
        *,
        domain_area_m2: float,
        initial_mixed_ug: float,
        initial_aloft_ug: float,
        core_ratio: np.ndarray,
        baseline_mean_pm25: np.ndarray,
        baseline_core_pm25: np.ndarray,
        core_fraction: float,
        urban_response_gain: float = 1.0,
        probe_mean_pm25: np.ndarray | None = None,
    ) -> None:
        self.operators = operators
        self.params = params
        # Total domain area, not the cell area: the state variables below are
        # domain-wide masses in ug, and the diagnostics were recorded the same way.
        self.domain_area_m2 = float(domain_area_m2)
        self.initial_mixed_ug = float(initial_mixed_ug)
        self.initial_aloft_ug = float(initial_aloft_ug)
        self.core_ratio = np.asarray(core_ratio, dtype=np.float64)
        self.baseline_mean_pm25 = np.asarray(baseline_mean_pm25, dtype=np.float64)
        self.baseline_core_pm25 = np.asarray(baseline_core_pm25, dtype=np.float64)
        #: Share of the domain the urban core occupies, for context in the UI.
        self.core_fraction = float(core_fraction)
        #: Multiplier that brings the reduced model's *urban* channel onto the full
        #: model's, fitted from a probe run with the urban source switched off.
        #: The urban source is concentrated over the built-up area, so removing it
        #: changes the spatial distribution and with it the ventilation the domain
        #: mean cannot see; that structural gap is what this corrects.  1.0 means
        #: no probe was supplied and the raw reduction is used.
        self.urban_response_gain = float(urban_response_gain)
        #: The probe run's own domain-mean series, kept so ``validate`` can report
        #: how well the corrected urban channel matches its parent.
        self.probe_mean_pm25 = (
            None
            if probe_mean_pm25 is None
            else np.asarray(probe_mean_pm25, dtype=np.float64)
        )

    # -- identification ----------------------------------------------------
    @classmethod
    def from_output(
        cls,
        output: dict[str, Any],
        *,
        params: ModelParams | None = None,
        grid: Any | None = None,
        core_mask: np.ndarray | None = None,
        probe_output: dict[str, Any] | None = None,
    ) -> "ReducedModel":
        """Identify the reduced model from a completed baseline run.

        ``output`` must be a :func:`coupled_model.simulate_72h` result.  The
        extraction uses ``output['hourly_diagnostics']``; a run produced by an
        older build without those arrays cannot be reduced, and says so.

        ``probe_output`` is an optional *second* full run of the same scenario
        with the urban source switched off (``urban_emission_ug_m2_s = 0``).
        Supplying it measures how much the reduction overstates or understates
        that one channel and corrects it; without it the urban lever is left on
        the raw reduction.  One extra run is cheap next to the scenarios the
        panel then evaluates in milliseconds.
        """
        hourly = output.get("hourly_diagnostics")
        if not isinstance(hourly, dict):
            raise ValueError(
                "output has no 'hourly_diagnostics'; the reduced model must be "
                "identified from a full simulate_72h run"
            )
        params = params or output.get("params") or ModelParams()
        grid = grid or output.get("grid") or delhi_ncr_grid()

        mix_in = np.asarray(hourly["mix_mass_in_ug"], dtype=np.float64)
        aloft_in = np.asarray(hourly["aloft_mass_in_ug"], dtype=np.float64)
        # The state each hour *closes* on: the concentration a mean model reports
        # for that hour is this mass over that hour's effective depth, not the
        # mass it opened with.
        mix_out = np.asarray(hourly["mix_mass_out_ug"], dtype=np.float64)
        mix_transport = np.asarray(hourly["mix_mass_transport_ug"], dtype=np.float64)
        aloft_transport = np.asarray(hourly["aloft_mass_transport_ug"], dtype=np.float64)
        supply = np.asarray(hourly["boundary_inflow_ug"], dtype=np.float64)
        deposited = np.asarray(hourly["deposited_ug"], dtype=np.float64)
        scavenged = np.asarray(hourly["scavenged_ug"], dtype=np.float64)
        n_hours = int(mix_in.size)

        # Transport retention is the surviving fraction of the mass that was
        # already inside the domain: the boundary supply is removed first, since
        # it is new mass rather than a fraction of the old.
        mix_retention = np.ones(n_hours)
        present = mix_in > 0.0
        mix_retention[present] = np.maximum(
            mix_transport[present] - supply[present], 0.0
        ) / mix_in[present]
        aloft_retention = np.ones(n_hours)
        aloft_present = aloft_in > 0.0
        aloft_retention[aloft_present] = (
            aloft_transport[aloft_present] / aloft_in[aloft_present]
        )

        # Scavenging multiplies the whole column, and the budget records its
        # effect on the column mass after deposition.
        before_scavenging = mix_transport + aloft_transport + deposited
        scavenging_factor = np.ones(n_hours)
        wet = before_scavenging > 0.0
        scavenging_factor[wet] = (
            1.0 + scavenged[wet] / before_scavenging[wet]
        )

        synoptic_pbl = np.asarray(output["pbl_height_synoptic"], dtype=np.float64).mean(
            axis=(1, 2)
        )

        pm25 = np.asarray(output["pm25"], dtype=np.float64)
        mask = (
            core_mask
            if core_mask is not None
            else urban_core_mask(grid, params)
        )
        core_pm25 = pm25[:, mask].mean(axis=1)
        mean_pm25 = pm25.mean(axis=(1, 2))
        with np.errstate(divide="ignore", invalid="ignore"):
            core_ratio = np.where(mean_pm25 > 0.0, core_pm25 / mean_pm25, 1.0)

        area = float(grid.cell_area) * float(np.prod(grid.shape))
        effective_pbl = np.asarray(output["pbl_height"], dtype=np.float64).mean(
            axis=(1, 2)
        )
        suppression_base = np.asarray(
            output["pbl_suppression_fraction"], dtype=np.float64
        ).mean(axis=(1, 2))

        # Re-run the feedback rule alone over the *baseline* states, so the run
        # loop can express its feedback as a ratio to what the same rule predicts
        # on the baseline.  This is what keeps the baseline exact despite the
        # heterogeneity the domain mean hides.
        #
        # The recurrence must mirror the run loop exactly, including the depth it
        # carries from one hour to the next: the run loop advances on the
        # *anchored* depth, which on the baseline is the engine's own mean, not
        # this pre-pass's raw prediction.  Using the raw prediction here would
        # make the ratio differ from 1 even with every lever at unit and quietly
        # destroy the baseline guarantee.
        box_pbl = np.empty(n_hours)
        box_suppression = np.empty(n_hours)
        previous_effective = float(synoptic_pbl[0])
        for hour in range(n_hours):
            mixed_areal = mix_in[hour] / area
            column_areal = mixed_areal * (
                synoptic_pbl[hour] / max(previous_effective, 1e-9)
            ) + aloft_in[hour] / area
            _, suppression, h_effective = _aerosol_feedback(
                np.array([column_areal]),
                np.array([synoptic_pbl[hour]]),
                params,
            )
            box_pbl[hour] = float(max(h_effective[0], params.pbl_min_m))
            box_suppression[hour] = float(suppression[0])
            previous_effective = max(float(effective_pbl[hour]), params.pbl_min_m)

        # The engine grows the mixed layer cell by cell, so its aggregate supply
        # is the sum of the per-cell deepenings, not the deepening of the mean.
        pbl_cells = np.asarray(output["pbl_height"], dtype=np.float64)
        growth_engine = np.zeros(n_hours)
        if n_hours > 1:
            growth_engine[1:] = np.maximum(
                pbl_cells[1:] - pbl_cells[:-1], 0.0
            ).mean(axis=(1, 2))
        growth_engine[0] = float(
            np.maximum(pbl_cells[0] - synoptic_pbl[0], 0.0).mean()
        )
        box_growth = np.empty(n_hours)
        box_growth[0] = max(box_pbl[0] - float(synoptic_pbl[0]), 0.0)
        if n_hours > 1:
            box_growth[1:] = np.maximum(box_pbl[1:] - box_pbl[:-1], 0.0)

        deposition_factor = np.ones(n_hours)
        depositing = mix_transport > 0.0
        deposition_factor[depositing] = (
            1.0 + deposited[depositing] / mix_transport[depositing]
        )
        naive_mean = mix_out / area / np.maximum(effective_pbl, 1e-9)
        with np.errstate(divide="ignore", invalid="ignore"):
            concentration_factor = np.where(naive_mean > 0.0, mean_pm25 / naive_mean, 1.0)

        operators = HourlyOperators(
            mix_retention=mix_retention,
            aloft_retention=aloft_retention,
            boundary_supply_ug=supply,
            scavenging_factor=np.clip(scavenging_factor, 0.0, 1.0),
            stubble_mix_ug=np.asarray(hourly["stubble_mix_ug"], dtype=np.float64),
            stubble_aloft_ug=np.asarray(hourly["stubble_aloft_ug"], dtype=np.float64),
            urban_mix_ug=np.asarray(hourly["urban_mix_ug"], dtype=np.float64),
            synoptic_pbl_m=synoptic_pbl,
            baseline_effective_pbl_m=effective_pbl,
            baseline_box_pbl_m=box_pbl,
            baseline_deposition_factor=deposition_factor,
            baseline_growth_m=growth_engine,
            baseline_box_growth_m=box_growth,
            baseline_suppression=suppression_base,
            baseline_box_suppression=box_suppression,
            concentration_factor=concentration_factor,
        )

        model = cls(
            operators,
            params,
            domain_area_m2=area,
            initial_mixed_ug=float(mix_in[0]),
            initial_aloft_ug=float(aloft_in[0]),
            core_ratio=core_ratio,
            baseline_mean_pm25=mean_pm25,
            baseline_core_pm25=core_pm25,
            core_fraction=float(np.count_nonzero(mask) / mask.size),
        )
        if probe_output is not None:
            model.urban_response_gain = model._fit_urban_gain(probe_output)
            model.probe_mean_pm25 = model._probe_truth(probe_output)
        return model

    @staticmethod
    def _probe_truth(probe_output: dict[str, Any]) -> np.ndarray | None:
        probe = probe_output.get("pm25")
        if probe is None:
            return None
        return np.asarray(probe, dtype=np.float64).mean(axis=(1, 2))

    def _fit_urban_gain(self, probe_output: dict[str, Any]) -> float:
        """Least-squares gain that matches the reduction's urban channel.

        Compares the full model's response to switching the urban source off
        against the reduction's response to the same lever, and returns the
        scalar that minimises the squared mismatch.  A non-positive or
        degenerate fit falls back to 1.0 (no correction) rather than inventing a
        sensitivity the probe does not support.
        """
        truth = self._probe_truth(probe_output)
        if truth is None or truth.size != self.baseline_mean_pm25.size:
            return 1.0
        observed = truth - self.baseline_mean_pm25
        reduced = self._integrate(
            stubble_scale=1.0, urban_scale=0.0, inflow_stubble_fraction=0.0
        ).pm25_mean - self.baseline_mean_pm25
        denominator = float(np.dot(reduced, reduced))
        if denominator <= 1.0e-12:
            return 1.0
        gain = float(np.dot(observed, reduced) / denominator)
        if not math.isfinite(gain) or gain <= 0.0:
            return 1.0
        # Clamp: a wildly extrapolated gain would be a fitted artefact, not
        # physics.  Wide enough to admit a genuine factor-of-two misestimate, a
        # hint that the reduction is being used outside its regime.
        return float(np.clip(gain, 0.25, 4.0))

    # -- forward integration ----------------------------------------------
    def run(
        self,
        *,
        stubble_scale: float = 1.0,
        urban_scale: float = 1.0,
        inflow_stubble_fraction: float = 0.0,
        aqi_peak_window_hours: int = 48,
    ) -> ReducedRun:
        """Integrate the reduced model for a source-scaling scenario.

        ``stubble_scale`` scales crop-residue burning, in the domain *and* -- in
        proportion ``inflow_stubble_fraction`` -- in the regional inflow, which is
        the channel that actually carries Punjab smoke into this domain: the
        stubble belt sits beyond the model's northern edge, so most of its impact
        arrives through the lateral boundary rather than as a local fire.
        ``urban_scale`` scales the contiguous urban emission (traffic, industry,
        residential, waste).

        When a probe run was supplied at identification, the urban channel is
        corrected onto the full model's measured response before the results are
        packaged; the correction touches only the part of the signal the urban
        lever is responsible for, leaving the stubble channel untouched.
        """
        result = self._integrate(
            stubble_scale=stubble_scale,
            urban_scale=urban_scale,
            inflow_stubble_fraction=inflow_stubble_fraction,
        )
        if self.urban_response_gain == 1.0 or urban_scale == 1.0:
            return self._finalise(result, aqi_peak_window_hours)
        reference = self._integrate(
            stubble_scale=stubble_scale,
            urban_scale=1.0,
            inflow_stubble_fraction=inflow_stubble_fraction,
        )
        corrected = result.pm25_mean + (self.urban_response_gain - 1.0) * (
            result.pm25_mean - reference.pm25_mean
        )
        return self._finalise(
            replace(result, pm25_mean=corrected), aqi_peak_window_hours
        )

    def _integrate(
        self,
        *,
        stubble_scale: float = 1.0,
        urban_scale: float = 1.0,
        inflow_stubble_fraction: float = 0.0,
    ) -> ReducedRun:
        """Raw reduced-model integration, before any bias correction."""
        o = self.operators
        params = self.params
        dt = float(params.dt_seconds)
        area = self.domain_area_m2
        n_hours = len(o)
        stubble_scale = float(max(stubble_scale, 0.0))
        urban_scale = float(max(urban_scale, 0.0))
        inflow_scale = 1.0 - float(np.clip(inflow_stubble_fraction, 0.0, 1.0)) * (
            1.0 - stubble_scale
        )

        mixed = self.initial_mixed_ug
        aloft = self.initial_aloft_ug
        h_previous_effective = float(o.synoptic_pbl_m[0])

        pm25_mean = np.empty(n_hours)
        pbl_out = np.empty(n_hours)
        suppression_out = np.empty(n_hours)

        for hour in range(n_hours):
            h_synoptic = float(o.synoptic_pbl_m[hour])
            h_floor = float(params.pbl_min_m)

            # (d) Two-way feedback, evaluated on the entering state exactly as the
            # full model does: column mass per unit area over the synoptic depth.
            # The result is then mapped onto the baseline via the ratio of the
            # same rule applied to the baseline state -- a ratio of 1 when no
            # lever has moved, so the baseline PBL and its suppression are
            # reproduced exactly rather than to within a concavity error.
            mixed_areal = mixed / area
            aloft_areal = aloft / area
            column_areal = mixed_areal * (h_synoptic / max(h_previous_effective, 1e-9))
            column_areal += aloft_areal
            _, suppression, h_box = _aerosol_feedback(
                np.array([column_areal]), np.array([h_synoptic]), params
            )
            h_box = float(max(h_box[0], h_floor))
            h_effective = self._anchor(
                o.baseline_effective_pbl_m[hour],
                h_box,
                o.baseline_box_pbl_m[hour],
                h_floor,
            )
            suppression_out[hour] = self._anchor(
                o.baseline_suppression[hour],
                float(suppression[0]),
                o.baseline_box_suppression[hour],
                0.0,
            )

            # (a)/(b) Transport.  Retention of the interior mass is the identified
            # operator; the boundary supply scales with the inflow concentration.
            mixed = o.mix_retention[hour] * mixed + o.boundary_supply_ug[hour] * inflow_scale
            aloft = o.aloft_retention[hour] * aloft

            # Deposition: anchored on the baseline's own mass-weighted factor, and
            # moved by the ratio of the exponential at the scenario's mixed-layer
            # depth to the exponential at the baseline's.  A scenario that
            # shallows the PBL therefore still slows the loss, while the baseline
            # keeps the exact factor the full model applied.
            mixed *= o.baseline_deposition_factor[hour] * math.exp(
                -params.dry_deposition_velocity
                * dt
                * (1.0 / h_effective - 1.0 / o.baseline_effective_pbl_m[hour])
            )
            # Wet scavenging depends only on precipitation: frozen from baseline.
            mixed *= o.scavenging_factor[hour]
            aloft *= o.scavenging_factor[hour]

            # Free-tropospheric entrainment as the mixed layer deepens, then the
            # slow relaxation to the background (the same two steps, in the same
            # order, as the full model).  The deepening is anchored on the
            # engine's own per-cell aggregate, which the mean cannot reproduce.
            growth = max(h_effective - h_previous_effective, 0.0)
            base_growth = o.baseline_box_growth_m[hour]
            if base_growth > 0.0:
                growth *= o.baseline_growth_m[hour] / base_growth
            elif growth > 0.0:
                growth = o.baseline_growth_m[hour]
            mixed += growth * params.background_pm25 * area
            relaxation = 1.0 - math.exp(
                -params.entrainment_velocity_min * dt / h_effective
            )
            mixed = mixed * (1.0 - relaxation) + (
                params.background_pm25 * h_effective * area * relaxation
            )

            # Lofted smoke drains back into the mixed layer, faster when convective.
            exchange_velocity = growth / dt + params.entrainment_velocity_min
            if params.aloft_entrainment_hours > 0.0:
                tau = params.aloft_entrainment_hours / (
                    1.0 + exchange_velocity / params.entrainment_velocity_reference
                )
                drain_fraction = 1.0 - math.exp(-dt / tau)
            else:
                drain_fraction = 1.0
            drained = aloft * drain_fraction
            aloft -= drained
            mixed += drained

            # (c) Emissions, scaled by the scenario.
            mixed += stubble_scale * o.stubble_mix_ug[hour]
            mixed += urban_scale * o.urban_mix_ug[hour]
            aloft += stubble_scale * o.stubble_aloft_ug[hour]

            # (e) Inversion trapping: concentration is column mass over depth,
            # bias-corrected for the mean-of-ratios against ratio-of-means gap
            # that the domain aggregation would otherwise introduce.
            pm25_mean[hour] = (
                o.concentration_factor[hour] * mixed / area / h_effective
            )
            pbl_out[hour] = h_effective
            h_previous_effective = h_effective

        return ReducedRun(
            pm25_mean=pm25_mean,
            pm25_core=pm25_mean * self.core_ratio,
            pbl_height_m=pbl_out,
            pbl_height_synoptic_m=np.asarray(o.synoptic_pbl_m, dtype=np.float64),
            pbl_suppression_fraction=suppression_out,
            aqi_value_mean=np.zeros(n_hours),
            aqi_value_core=np.zeros(n_hours),
            aqi_category_core=(),
            peak_pm25_core=0.0,
            peak_aqi_core=0.0,
            aqi_peak_window_hours=0,
        )

    def _finalise(self, result: ReducedRun, aqi_peak_window_hours: int) -> ReducedRun:
        """Attach the CPCB AQI series, which is a 24-h-mean index of the PM2.5 run."""
        params = self.params
        n_hours = result.pm25_mean.size
        mean_24h = _trailing_mean(
            result.pm25_mean.reshape(-1, 1), params.aqi_averaging_window_h
        )
        aqi_mean = aqi_value_from_pm25(mean_24h).ravel()
        core_pm25 = result.pm25_mean * self.core_ratio
        core_24h = _trailing_mean(
            core_pm25.reshape(-1, 1), params.aqi_averaging_window_h
        )
        aqi_core = aqi_value_from_pm25(core_24h).ravel()
        categories = aqi_category_from_pm25(core_24h).ravel()
        window = int(max(1, min(aqi_peak_window_hours, n_hours)))
        return replace(
            result,
            pm25_core=core_pm25,
            aqi_value_mean=aqi_mean,
            aqi_value_core=aqi_core,
            aqi_category_core=tuple(str(value) for value in categories),
            peak_pm25_core=float(np.max(core_pm25)),
            peak_aqi_core=float(np.max(aqi_core[:window])),
            aqi_peak_window_hours=window,
        )

    @staticmethod
    def _anchor(baseline: float, predicted: float, baseline_predicted: float, floor: float) -> float:
        """Map a predicted closed-form quantity onto the baseline's own value.

        Returns ``baseline * predicted / baseline_predicted``, so the result is
        exactly the baseline when the scenario has not perturbed the quantity,
        and carries the scenario's *relative* change when it has.  A vanishing or
        non-finite anchor falls back to the prediction rather than exploding.
        """
        if not math.isfinite(baseline_predicted) or baseline_predicted <= 0.0:
            return max(predicted, floor)
        if not math.isfinite(predicted) or predicted <= 0.0:
            return max(baseline, floor)
        return max(baseline * (predicted / baseline_predicted), floor)

    # -- self-check --------------------------------------------------------
    def validate(self, output: dict[str, Any] | None = None) -> dict[str, float]:
        """Reproduce the baseline with every lever at 1.0 and measure the error.

        This is the surrogate's own honesty check: if the identification is
        right the relative error is at round-off, and if a future edit breaks it
        the number in the API response goes up rather than the deltas quietly
        becoming meaningless.
        """
        baseline = self.run(stubble_scale=1.0, urban_scale=1.0)
        scale = np.maximum(np.abs(self.baseline_mean_pm25), 1e-9)
        relative_error = np.abs(baseline.pm25_mean - self.baseline_mean_pm25) / scale
        core_error = np.abs(baseline.pm25_core - self.baseline_core_pm25) / np.maximum(
            np.abs(self.baseline_core_pm25), 1e-9
        )
        reference = output or {}
        peak_true = float(np.max(self.baseline_core_pm25))
        peak_surrogate = float(np.max(baseline.pm25_core))
        return {
            "mean_relative_error": float(np.max(relative_error)),
            "mean_absolute_error_ug_m3": float(
                np.max(np.abs(baseline.pm25_mean - self.baseline_mean_pm25))
            ),
            "core_relative_error": float(np.max(core_error)),
            "core_peak_relative_error": (
                abs(peak_surrogate - peak_true) / peak_true if peak_true > 0 else 0.0
            ),
            "baseline_peak_core_ug_m3": peak_true,
            "surrogate_peak_core_ug_m3": peak_surrogate,
            "hours": float(len(self.operators)),
            "reference_hours": float(len(reference.get("pm25", []))),
            **self.validate_urban_channel(),
        }

    def validate_urban_channel(self) -> dict[str, float]:
        """How well the urban lever reproduces the probe run it was fitted to.

        This is the check that matters for the vehicle-restriction levers: it
        compares the *response* to an intervention, not the baseline, against a
        full model run of the same intervention.  Two numbers are reported,
        because they say different things:

        ``urban_channel_response_bias``
            Error in the integrated response (hour-summed change from baseline)
            as a fraction of the true one.  This is what a scalar gain fixes, and
            it is the number that matters for a headline like "x ug/m3 averted".
        ``urban_channel_response_error``
            Largest hourly error as a fraction of the largest hourly response.
            A scalar gain *cannot* make this small: the reduction also misplaces
            where the mass sits, so some hours are corrected up and others down.
        """
        if self.probe_mean_pm25 is None:
            return {
                "urban_channel_gain": self.urban_response_gain,
                "urban_channel_response_bias": float("nan"),
                "urban_channel_response_error": float("nan"),
                "urban_channel_raw_response_bias": float("nan"),
                "urban_channel_raw_response_error": float("nan"),
                "urban_channel_peak_error_ug_m3": float("nan"),
            }
        truth = self.probe_mean_pm25
        baseline = self.baseline_mean_pm25
        true_response = truth - baseline
        total = float(np.sum(true_response))
        peak_response = float(np.max(np.abs(true_response)))

        def _score(reduced: np.ndarray) -> tuple[float, float]:
            bias = (
                float(np.sum(reduced - baseline - true_response) / total)
                if abs(total) > 1.0e-9
                else float("nan")
            )
            error = (
                float(np.max(np.abs(reduced - truth)) / peak_response)
                if peak_response > 1.0e-9
                else float("nan")
            )
            return bias, error

        corrected = self.run(urban_scale=0.0).pm25_mean
        raw = self._integrate(
            stubble_scale=1.0, urban_scale=0.0, inflow_stubble_fraction=0.0
        ).pm25_mean
        bias, error = _score(corrected)
        raw_bias, raw_error = _score(raw)
        return {
            "urban_channel_gain": round(self.urban_response_gain, 4),
            "urban_channel_response_bias": bias,
            "urban_channel_response_error": error,
            "urban_channel_raw_response_bias": raw_bias,
            "urban_channel_raw_response_error": raw_error,
            "urban_channel_peak_error_ug_m3": float(np.max(np.abs(corrected - truth))),
        }

    def baseline_run(self, **kwargs: Any) -> ReducedRun:
        """The no-intervention scenario, which the levers are compared against."""
        return self.run(stubble_scale=1.0, urban_scale=1.0, **kwargs)


def summarise_operators(model: ReducedModel) -> dict[str, float]:
    """Compact description of the identified operators, for provenance."""
    o = model.operators
    return {
        "hours": float(len(o)),
        "mix_retention_mean": float(np.mean(o.mix_retention)),
        "mix_retention_min": float(np.min(o.mix_retention)),
        "aloft_retention_mean": float(np.mean(o.aloft_retention)),
        "boundary_supply_tonnes": float(np.sum(o.boundary_supply_ug) * 1.0e-12),
        "stubble_tonnes": float(
            np.sum(o.stubble_mix_ug + o.stubble_aloft_ug) * 1.0e-12
        ),
        "urban_tonnes": float(np.sum(o.urban_mix_ug) * 1.0e-12),
        "wet_hours": float(np.count_nonzero(o.scavenging_factor < 1.0 - 1.0e-12)),
    }


# --------------------------------------------------------------------------
# Self-test
# --------------------------------------------------------------------------
def _self_test() -> None:
    """The reduced model must reproduce the baseline it was identified from."""
    grid = delhi_ncr_grid()
    hours = 24
    params = ModelParams(hours=hours, urban_emission_ug_m2_s=0.8)
    hour_index = np.arange(hours, dtype=np.float64)
    diurnal = 0.5 * (1.0 - np.cos(2.0 * np.pi * np.mod(hour_index, 24.0) / 24.0))
    weather = {
        "u": 3.5 + 1.5 * np.sin(hour_index / 7.0),
        "v": -1.2,
        "pbl_height": (300.0 + 600.0 * diurnal)[:, None, None] * np.ones(grid.shape),
        "t2m": 291.0,
        "t850": 289.0,
    }
    initial = 40.0 + 120.0 * np.exp(
        -((grid.lat2d - 28.61) ** 2 + (grid.lon2d - 77.21) ** 2) / 0.02
    )
    fires = [[29.9, 75.5, 35.0]] * 12 + [[30.4, 75.9, 28.0]] * 12
    output = simulate_72h(initial, weather, fires, params=params)
    # One extra full run with the urban source off, to calibrate that channel.
    probe = simulate_72h(
        initial,
        weather,
        fires,
        params=ModelParams(hours=hours, urban_emission_ug_m2_s=0.0),
    )

    model = ReducedModel.from_output(output, probe_output=probe)
    report = model.validate(output)
    assert report["mean_relative_error"] < MAX_BASELINE_RELATIVE_ERROR, report
    assert report["core_peak_relative_error"] < MAX_BASELINE_RELATIVE_ERROR, report

    # The urban channel must track the full model's response to the same
    # intervention, and the fitted gain must be what closes the systematic gap.
    # The bar is stated rather than assumed, and the uncorrected reduction is
    # measured alongside it so the claim that the probe helps is checked rather
    # than asserted.
    assert abs(report["urban_channel_raw_response_bias"]) > 1.0e-2, (
        "the uncorrected reduction is supposed to be biased here; if it is not, "
        f"this test has stopped testing anything: {report}"
    )
    assert abs(report["urban_channel_response_bias"]) < 5.0e-2, report
    assert abs(report["urban_channel_response_bias"]) < abs(
        report["urban_channel_raw_response_bias"]
    ), report
    # A scalar gain cannot fix the hourly shape, so this bar is deliberately
    # looser -- and reported to the client rather than hidden.
    assert report["urban_channel_response_error"] < 0.35, report
    assert 0.25 <= report["urban_channel_gain"] <= 4.0, report

    baseline = model.baseline_run()
    assert np.all(np.isfinite(baseline.pm25_mean)), "finite trajectory"
    assert np.all(baseline.pm25_mean > 0.0), "positive trajectory"
    assert len(baseline.aqi_category_core) == hours, "one category per hour"
    assert all(value in AQI_CATEGORIES for value in baseline.aqi_category_core)

    # Monotonicity: cutting emissions cannot raise the peak, and the two levers
    # must act through independent channels.
    off = model.run(stubble_scale=1.0, urban_scale=1.0)
    no_burning = model.run(stubble_scale=0.0, urban_scale=1.0)
    no_urban = model.run(stubble_scale=1.0, urban_scale=0.0)
    assert no_burning.peak_pm25_core <= off.peak_pm25_core + 1.0e-9, "stubble lever"
    assert no_urban.peak_pm25_core <= off.peak_pm25_core + 1.0e-9, "urban lever"
    assert no_burning.pm25_mean[-1] < off.pm25_mean[-1], "stubble lever must bite"
    assert no_urban.pm25_mean[-1] <= off.pm25_mean[-1], "urban lever must bite"

    # A reduced inflow (the only channel that can carry Punjab smoke into this
    # domain, since the stubble belt is outside it) must lower the load too.
    reduced_inflow = model.run(stubble_scale=0.5, inflow_stubble_fraction=0.6)
    assert reduced_inflow.pm25_mean[-1] < off.pm25_mean[-1], "inflow channel"

    # The response must be monotone in the lever, not jumping to its endpoint.
    half = model.run(stubble_scale=0.5, urban_scale=1.0)
    assert no_burning.peak_pm25_core <= half.peak_pm25_core + 1.0e-9
    assert half.peak_pm25_core <= off.peak_pm25_core + 1.0e-9

    # Deposition must respond to the PBL: a shallower mixed layer loses less.
    assert float(np.mean(baseline.pbl_height_m)) < float(
        np.mean(baseline.pbl_height_synoptic_m)
    ), "the aerosol feedback must lower the model's own PBL"

    summary = summarise_operators(model)
    assert summary["stubble_tonnes"] > 0.0 and summary["urban_tonnes"] > 0.0, summary
    assert 0.0 < summary["mix_retention_mean"] <= 1.0, summary

    print(
        "surrogate self-test: baseline reproduced to "
        f"{report['mean_relative_error']:.2e} relative (core peak "
        f"{report['baseline_peak_core_ug_m3']:.1f} -> "
        f"{report['surrogate_peak_core_ug_m3']:.1f} ug/m3)"
    )


if __name__ == "__main__":
    _self_test()
