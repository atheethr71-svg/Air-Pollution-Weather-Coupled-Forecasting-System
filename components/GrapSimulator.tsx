'use client';

/**
 * GRAP what-if simulator.
 *
 * Grades the live forecast against Delhi-NCR's Graded Response Action Plan and
 * lets a planner ask "what would this measure have bought?" -- re-running a
 * reduced-order surrogate of the coupled model on every lever change, so the
 * answer arrives in milliseconds instead of minutes.
 *
 * The component owns no physics. Three things come from the API and are treated
 * as authoritative:
 *
 *   * the GRAP schedule itself (thresholds, actions in force, what the next
 *     stage would require), because that is policy text that changes by order;
 *   * the two trajectories, because they are model output;
 *   * the surrogate's own measured error, which is displayed rather than hidden.
 *
 * The local logic is limited to presentation: banding an AQI for colour,
 * building SVG paths, and locating peaks. Those are exported so they can be
 * unit-tested without a browser.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// API contract (mirrors routers/forecast.py)
// ---------------------------------------------------------------------------
export interface InterventionDescription {
  stubble_reduction_percent: number;
  stubble_scale: number;
  truck_restriction: TruckRestriction;
  truck_restriction_label: string;
  truck_share_of_urban_source_removed: number;
  odd_even_active: boolean;
  odd_even_share_of_urban_source_removed: number;
  urban_scale: number;
  urban_source_removed_percent: number;
  inflow_stubble_fraction: number;
  attribution: Record<string, number>;
  note: string;
}

export interface PreemptionSummary {
  recommended_stage: number;
  current_stage: number;
  escalated: boolean;
  stagnant_hours: number;
  mean_wind_speed_ms: number;
  mean_mixing_height_m: number;
  rationale: string;
}

export interface InterventionSummary {
  window_hours: number;
  baseline_peak_pm25_core: number;
  mitigated_peak_pm25_core: number;
  averted_peak_pm25: number;
  baseline_max_aqi: number;
  mitigated_max_aqi: number;
  max_aqi_drop: number;
  max_aqi_drop_percent: number;
  mean_pm25_core_change: number;
  mean_pm25_core_change_percent: number;
  baseline_grap_stage: number;
  baseline_grap_label: string;
  mitigated_grap_stage: number;
  mitigated_grap_label: string;
  stage_change: number;
  avoids_stage: string | null;
  preemption: PreemptionSummary | null;
}

export interface NextStageRequirement {
  stage: number;
  label: string;
  threshold: number;
  headroom: number;
  actions: string[];
}

export interface GrapStatus {
  measured_on: string;
  invoked_stage: number;
  invoked_label: string;
  peak_aqi: number;
  peak_category: string;
  hours_by_stage: Record<string, number>;
  stage_sequence: number[];
  actions_in_force: string[];
  next_stage: NextStageRequirement | null;
}

export interface GrapComparison {
  times_local: string[];
  baseline_pm25_core: number[];
  mitigated_pm25_core: number[];
  baseline_aqi_core: number[];
  mitigated_aqi_core: number[];
  baseline_pm25_mean: number[];
  mitigated_pm25_mean: number[];
}

export interface SurrogateReport {
  baseline_relative_error: number;
  baseline_absolute_error_ug_m3: number;
  urban_channel_gain: number;
  urban_channel_response_bias: number | null;
  operators: Record<string, number>;
  speed: string;
}

export interface InterventionsResponse {
  center: [number, number];
  hours: number;
  window_hours: number;
  intervention: InterventionDescription;
  summary: InterventionSummary;
  grap: GrapStatus;
  comparison: GrapComparison;
  surrogate: SurrogateReport;
  urban_source: Record<string, number>;
  notes: string[];
}

export type TruckRestriction = 'off' | 'bs4_banned' | 'all_halted';
export type StubbleReduction = 0 | 0.5 | 0.8;

export interface InterventionSelection {
  stubbleReduction: StubbleReduction;
  truckRestriction: TruckRestriction;
  oddEven: boolean;
}

// ---------------------------------------------------------------------------
// GRAP presentation
// ---------------------------------------------------------------------------
export interface StageMeta {
  stage: number;
  roman: string;
  name: string;
  short: string;
  colour: string;
  /** Lower AQI bound on the *published integer* scale. */
  aqiMin: number;
}

/** Compact label for a stage: "III" for a real stage, "none" for AQI <= 200. */
export function stageShort(stage: number): string {
  return stage <= 0 ? 'none' : stageMeta(stage).roman;
}

/**
 * Stage bands and colours. Thresholds are on CPCB's published integer scale, so
 * a continuous sub-index is rounded half-up before banding -- the same rule the
 * service applies, and the reason a value of 450.5 reads as Stage IV.
 */
export const GRAP_STAGE_META: readonly StageMeta[] = [
  { stage: 0, roman: '—', name: 'No stage', short: 'None', colour: '#38bdf8', aqiMin: 0 },
  { stage: 1, roman: 'I', name: 'Poor', short: 'I', colour: '#facc15', aqiMin: 201 },
  { stage: 2, roman: 'II', name: 'Very Poor', short: 'II', colour: '#fb923c', aqiMin: 301 },
  { stage: 3, roman: 'III', name: 'Severe', short: 'III', colour: '#ef4444', aqiMin: 401 },
  { stage: 4, roman: 'IV', name: 'Severe+', short: 'IV', colour: '#a21caf', aqiMin: 451 },
];

export function stageMeta(stage: number): StageMeta {
  const clamped = Math.max(0, Math.min(4, Math.round(stage)));
  return GRAP_STAGE_META[clamped];
}

/** GRAP stage for a CPCB AQI sub-index, rounding to the published integer. */
export function grapStageForAqi(aqiValue: number): number {
  if (!Number.isFinite(aqiValue)) return 0;
  const published = Math.floor(aqiValue + 0.5);
  let stage = 0;
  for (const meta of GRAP_STAGE_META) {
    if (published >= meta.aqiMin) stage = meta.stage;
  }
  return stage;
}

/** The AQI thresholds drawn as guides behind the chart. */
export const GRAP_THRESHOLD_LINES: readonly { aqi: number; label: string; colour: string }[] = [
  { aqi: 201, label: 'Stage I', colour: 'rgba(250,204,21,0.42)' },
  { aqi: 301, label: 'Stage II', colour: 'rgba(251,146,60,0.45)' },
  { aqi: 401, label: 'Stage III', colour: 'rgba(239,68,68,0.5)' },
  { aqi: 451, label: 'Stage IV', colour: 'rgba(162,28,175,0.55)' },
];

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------
export function peakWithin(values: readonly number[], hours: number): number {
  if (values.length === 0) return 0;
  const window = Math.max(1, Math.min(Math.floor(hours), values.length));
  let peak = -Infinity;
  for (let index = 0; index < window; index += 1) {
    const value = values[index];
    if (Number.isFinite(value) && value > peak) peak = value;
  }
  return peak === -Infinity ? 0 : peak;
}

export function peakIndexWithin(values: readonly number[], hours: number): number {
  const window = Math.max(1, Math.min(Math.floor(hours), values.length));
  let best = 0;
  let bestValue = -Infinity;
  for (let index = 0; index < window; index += 1) {
    if (Number.isFinite(values[index]) && values[index] > bestValue) {
      bestValue = values[index];
      best = index;
    }
  }
  return best;
}

export interface ChartGeometry {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

export interface ChartScale {
  min: number;
  max: number;
  /** Axis ceiling actually used, after padding the data range. */
  ceiling: number;
}

/**
 * Scale for the chart. A flat series (every value identical, which happens for a
 * scenario that changes nothing) would otherwise collapse to a zero-height axis,
 * so the range is padded and floored.
 */
export function chartScale(
  seriesList: readonly (readonly number[])[],
  minimumSpan = 40,
): ChartScale {
  let min = Infinity;
  let max = -Infinity;
  for (const series of seriesList) {
    for (const value of series) {
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ceiling: 1 };
  if (max - min < minimumSpan) {
    const centre = (max + min) / 2;
    min = Math.max(0, centre - minimumSpan / 2);
    max = min + minimumSpan;
  }
  // Round the ceiling up to a tidy step so the gridlines read cleanly.
  const step = max - min > 300 ? 100 : max - min > 120 ? 50 : 20;
  const ceiling = Math.max(Math.ceil(max / step) * step, step);
  const floor = Math.max(0, Math.floor(min / step) * step);
  return { min: floor, max: ceiling, ceiling };
}

function xFor(index: number, count: number, geometry: ChartGeometry): number {
  const innerWidth = geometry.width - geometry.padding.left - geometry.padding.right;
  if (count <= 1) return geometry.padding.left;
  return geometry.padding.left + (innerWidth * index) / (count - 1);
}

function yFor(value: number, scale: ChartScale, geometry: ChartGeometry): number {
  const innerHeight = geometry.height - geometry.padding.top - geometry.padding.bottom;
  const span = Math.max(scale.max - scale.min, 1e-6);
  const clamped = Math.max(scale.min, Math.min(scale.max, value));
  return geometry.padding.top + innerHeight * (1 - (clamped - scale.min) / span);
}

/** SVG path through a series, in chart coordinates. */
export function linePath(
  values: readonly number[],
  scale: ChartScale,
  geometry: ChartGeometry,
): string {
  if (values.length === 0) return '';
  const points = values.map((value, index) => {
    const x = xFor(index, values.length, geometry);
    const y = yFor(Number.isFinite(value) ? value : scale.min, scale, geometry);
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return points.join(' ');
}

/**
 * Closed path over the region between two curves -- the "averted pollution"
 * area. Built as the forward run along `upper` and the reverse run along
 * `lower`, so it is a single fillable polygon rather than a difference of two.
 */
export function avertedAreaPath(
  upper: readonly number[],
  lower: readonly number[],
  scale: ChartScale,
  geometry: ChartGeometry,
): string {
  const count = Math.min(upper.length, lower.length);
  if (count === 0) return '';
  const forward: string[] = [];
  const backward: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const x = xFor(index, count, geometry);
    const upperY = yFor(Number.isFinite(upper[index]) ? upper[index] : scale.min, scale, geometry);
    const lowerY = yFor(Number.isFinite(lower[index]) ? lower[index] : scale.min, scale, geometry);
    forward.push(`${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${upperY.toFixed(2)}`);
    backward.push(`L${x.toFixed(2)},${lowerY.toFixed(2)}`);
  }
  return `${forward.join(' ')} ${backward.reverse().join(' ')} Z`;
}

/** Horizontal gridlines at tidy values, always including the ceiling. */
export function gridValues(scale: ChartScale, count = 4): number[] {
  const span = scale.max - scale.min;
  const values: number[] = [];
  for (let step = 0; step <= count; step += 1) {
    values.push(scale.min + (span * step) / count);
  }
  return values;
}

/** Stable key for a lever combination, so repeated toggling can be memoisd. */
export function interventionKey(selection: InterventionSelection): string {
  return [
    selection.stubbleReduction.toFixed(2),
    selection.truckRestriction,
    selection.oddEven ? 'odd-even' : 'normal',
  ].join('|');
}

export function formatSigned(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded).toFixed(digits)}`;
}

export function stageChangedLabel(summary: InterventionSummary | undefined): string {
  if (!summary) return '';
  if (summary.stage_change <= 0) return 'No stage change';
  return `Avoids ${summary.avoids_stage ?? 'a higher stage'}`;
}

/** Share of the window spent in each stage, for the exposure strip. */
export function stageExposure(sequence: readonly number[], hours: number): { stage: number; hours: number }[] {
  // An empty sequence has no hours to report. Clamping the window to a minimum
  // of one would otherwise invent an hour of "no stage" out of nothing.
  if (sequence.length === 0) return [];
  const window = Math.max(1, Math.min(Math.floor(hours), sequence.length));
  const counts = new Map<number, number>();
  for (let index = 0; index < window; index += 1) {
    const stage = sequence[index] ?? 0;
    counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([stage, count]) => ({ stage, hours: count }))
    .sort((a, b) => b.stage - a.stage);
}

// ---------------------------------------------------------------------------
// Lever descriptors
// ---------------------------------------------------------------------------
export const STUBBLE_OPTIONS: readonly { value: StubbleReduction; label: string; hint: string }[] = [
  { value: 0, label: 'No cut', hint: 'Burning continues as detected' },
  { value: 0.5, label: '−50 %', hint: 'Half of residue burning stopped' },
  { value: 0.8, label: '−80 %', hint: 'Near-complete enforcement' },
];

export const TRUCK_OPTIONS: readonly { value: TruckRestriction; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'No goods-vehicle restriction' },
  { value: 'bs4_banned', label: 'BS-IV banned', hint: 'BS-IV and older goods vehicles barred' },
  { value: 'all_halted', label: 'All goods halted', hint: 'Every goods vehicle barred' },
];

const DEFAULT_SELECTION: InterventionSelection = {
  stubbleReduction: 0,
  truckRestriction: 'off',
  oddEven: false,
};

export interface GrapSimulatorProps {
  /** Base URL of the forecast API. Empty string means same origin (use a rewrite). */
  apiBaseUrl?: string;
  /** Forecast horizon requested from the API. */
  horizonHours?: number;
  /** Horizon the averted peak is measured over -- "the next 48 hours" by default. */
  windowHours?: number;
  initialSelection?: Partial<InterventionSelection>;
  className?: string;
}

export default function GrapSimulator({
  apiBaseUrl = '',
  horizonHours = 72,
  windowHours = 48,
  initialSelection,
  className,
}: GrapSimulatorProps) {
  const [selection, setSelection] = useState<InterventionSelection>({
    ...DEFAULT_SELECTION,
    ...initialSelection,
  });
  const [data, setData] = useState<InterventionsResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [chartMetric, setChartMetric] = useState<'aqi' | 'pm25'>('aqi');
  const cacheRef = useRef<Map<string, InterventionsResponse>>(new Map());
  const controllerRef = useRef<AbortController | null>(null);

  const key = interventionKey(selection);

  useEffect(() => {
    const cached = cacheRef.current.get(key);
    if (cached) {
      setData(cached);
      setStatus('ready');
      setErrorMessage('');
      return;
    }
    // Debounced so dragging a control does not fire a request per pixel, and
    // aborted so a slow response cannot land after a newer selection.
    const timer = window.setTimeout(() => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const url = `${apiBaseUrl}/api/forecast/interventions?hours=${horizonHours}&window_hours=${windowHours}`;
      fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          stubble_reduction: selection.stubbleReduction,
          truck_restriction: selection.truckRestriction,
          odd_even: selection.oddEven,
        }),
      })
        .then(async (response) => {
          if (!response.ok) {
            if (response.status === 404) {
              throw new Error(
                'Intervention API returned 404. Please verify the Python API is running on port 8000 (python main.py).'
              );
            }
            throw new Error(`Intervention API returned ${response.status} ${response.statusText}`.trim());
          }
          return (await response.json()) as InterventionsResponse;
        })
        .then((payload) => {
          cacheRef.current.set(key, payload);
          setData(payload);
          setStatus('ready');
          setErrorMessage('');
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes('abort')) return;
          setErrorMessage(message);
          setStatus('error');
        });
    }, 120);

    return () => window.clearTimeout(timer);
  }, [apiBaseUrl, horizonHours, key, selection, windowHours]);

  const update = useCallback((patch: Partial<InterventionSelection>) => {
    setSelection((current) => ({ ...current, ...patch }));
  }, []);

  const reset = useCallback(() => setSelection({ ...DEFAULT_SELECTION }), []);

  const comparison = data?.comparison;
  const summary = data?.summary;
  const grap = data?.grap;

  const chart = useMemo(() => {
    if (!comparison) return null;
    const baseline = chartMetric === 'aqi' ? comparison.baseline_aqi_core : comparison.baseline_pm25_core;
    const mitigated =
      chartMetric === 'aqi' ? comparison.mitigated_aqi_core : comparison.mitigated_pm25_core;
    const geometry: ChartGeometry = {
      width: 720,
      height: 230,
      padding: { top: 14, right: 16, bottom: 26, left: 42 },
    };
    const scale = chartScale([baseline, mitigated], chartMetric === 'aqi' ? 120 : 60);
    return {
      baseline,
      mitigated,
      geometry,
      scale,
      baselinePath: linePath(baseline, scale, geometry),
      mitigatedPath: linePath(mitigated, scale, geometry),
      averted: avertedAreaPath(baseline, mitigated, scale, geometry),
      peakIndex: peakIndexWithin(baseline, windowHours),
      peakValue: peakWithin(baseline, windowHours),
      mitigatedPeakIndex: peakIndexWithin(mitigated, windowHours),
      mitigatedPeakValue: peakWithin(mitigated, windowHours),
      grid: gridValues(scale),
    };
  }, [comparison, chartMetric, windowHours]);

  const exposure = useMemo(
    () => (grap ? stageExposure(grap.stage_sequence, windowHours) : []),
    [grap, windowHours],
  );

  const stage = stageMeta(grap?.invoked_stage ?? 0);
  const nextStage = grap?.next_stage ?? null;
  const preemption = summary?.preemption ?? null;
  const isDirty = key !== interventionKey(DEFAULT_SELECTION);

  return (
    <section className={className} style={SHELL_STYLE} aria-label="GRAP what-if simulator">
      <style>{GRAP_CSS}</style>

      <header className="grap-head">
        <div>
          <h2 className="grap-title">GRAP what-if simulator</h2>
          <p className="grap-sub">
            Graded Response Action Plan, revised schedule · graded on the urban-core 24-h mean AQI
            {data ? ` · ${windowHours} h window` : ''}
          </p>
        </div>
        <div className="grap-badges">
          {status === 'loading' && <span className="grap-chip grap-chip-muted">computing…</span>}
          {status === 'error' && <span className="grap-chip grap-chip-error">model error</span>}
          {grap && (
            <>
              <span
                className="grap-stage-badge"
                style={{ borderColor: stage.colour, color: stage.colour }}
                title={grap.invoked_label}
              >
                <strong>{stage.roman}</strong>
                <span>{stage.name}</span>
              </span>
              {preemption?.escalated && (
                <span
                  className="grap-chip grap-chip-warn"
                  title={preemption.rationale}
                >
                  Pre-emptive {stageMeta(preemption.recommended_stage).roman} advised
                </span>
              )}
            </>
          )}
          <button type="button" className="grap-toggle" onClick={reset} disabled={!isDirty}>
            Reset levers
          </button>
        </div>
      </header>

      {status === 'error' && (
        <p className="grap-error">
          {errorMessage}
          <button
            type="button"
            className="grap-toggle"
            onClick={() => {
              cacheRef.current.delete(key);
              setSelection((current) => ({ ...current }));
              setStatus('loading');
            }}
          >
            Retry
          </button>
        </p>
      )}

      <div className="grap-body">
        <div className="grap-levers">
          <LeverGroup
            title="Stubble burning reduced"
            subtitle="Domain fires and the regional inflow they feed"
            options={STUBBLE_OPTIONS}
            selected={selection.stubbleReduction}
            onSelect={(value) => update({ stubbleReduction: value as StubbleReduction })}
          />
          <LeverGroup
            title="Truck entry restrictions"
            subtitle="Goods vehicles in the urban emission source"
            options={TRUCK_OPTIONS}
            selected={selection.truckRestriction}
            onSelect={(value) => update({ truckRestriction: value as TruckRestriction })}
          />
          <div className="grap-lever">
            <div className="grap-lever-head">
              <span className="grap-lever-title">Odd-even private vehicle rule</span>
              <span className="grap-lever-sub">Private cars, after exemptions and compliance</span>
            </div>
            <div className="grap-segment" role="group" aria-label="Odd-even private vehicle rule">
              <button
                type="button"
                className={`grap-seg ${selection.oddEven ? 'is-active' : ''}`}
                aria-pressed={selection.oddEven}
                onClick={() => update({ oddEven: true })}
              >
                Active
              </button>
              <button
                type="button"
                className={`grap-seg ${!selection.oddEven ? 'is-active' : ''}`}
                aria-pressed={!selection.oddEven}
                onClick={() => update({ oddEven: false })}
              >
                Inactive
              </button>
            </div>
          </div>

          {data && (
            <dl className="grap-attribution">
              <div>
                <dt>Urban source removed</dt>
                <dd>{data.intervention.urban_source_removed_percent.toFixed(1)} %</dd>
              </div>
              <div>
                <dt>Burning remaining</dt>
                <dd>{(data.intervention.stubble_scale * 100).toFixed(0)} %</dd>
              </div>
              <div>
                <dt>Regional smoke</dt>
                <dd title="Share of the lateral inflow the stubble lever can move">
                  {(data.intervention.inflow_stubble_fraction * 100).toFixed(0)} % of inflow
                </dd>
              </div>
            </dl>
          )}
        </div>

        <div className="grap-results">
          <div className="grap-metrics">
            <Metric
              label={`Max AQI · next ${windowHours} h`}
              value={summary ? summary.baseline_max_aqi.toFixed(0) : '—'}
              after={summary ? `→ ${summary.mitigated_max_aqi.toFixed(0)}` : undefined}
              tone={summary ? stageMeta(grapStageForAqi(summary.mitigated_max_aqi)).colour : '#94a3b8'}
              emphasis
            />
            <Metric
              label="Expected drop in max AQI"
              value={summary ? `${formatSigned(-summary.max_aqi_drop)}` : '—'}
              after={summary ? `${formatSigned(-summary.max_aqi_drop_percent)} %` : undefined}
              tone="#60a5fa"
              emphasis
            />
            <Metric
              label="Averted PM2.5 peak"
              value={summary ? `${formatSigned(-summary.averted_peak_pm25)}` : '—'}
              after="µg/m³ at the core"
              tone="#a3e635"
            />
            <Metric
              label="Mean core change"
              value={summary ? `${formatSigned(summary.mean_pm25_core_change)}` : '—'}
              after={summary ? `${formatSigned(summary.mean_pm25_core_change_percent)} %` : undefined}
              tone="#94a3b8"
            />
            <Metric
              label="GRAP stage"
              value={stageShort(stage.stage)}
              after={stageChangedLabel(summary)}
              tone={stage.colour}
            />
          </div>

          <section className="grap-card">
            <header className="grap-card-head">
              <h3>Averted pollution peak</h3>
              <div className="grap-chart-toggles">
                <button
                  type="button"
                  className={`grap-toggle ${chartMetric === 'aqi' ? 'is-active' : ''}`}
                  onClick={() => setChartMetric('aqi')}
                >
                  AQI
                </button>
                <button
                  type="button"
                  className={`grap-toggle ${chartMetric === 'pm25' ? 'is-active' : ''}`}
                  onClick={() => setChartMetric('pm25')}
                >
                  PM2.5
                </button>
              </div>
            </header>

            {chart ? (
              <svg
                className="grap-chart"
                viewBox={`0 0 ${chart.geometry.width} ${chart.geometry.height}`}
                role="img"
                aria-label="Forecast under the current measures against the same forecast with the selected interventions"
              >
                {chart.grid.map((value) => (
                  <g key={value}>
                    <line
                      x1={chart.geometry.padding.left}
                      x2={chart.geometry.width - chart.geometry.padding.right}
                      y1={yFor(value, chart.scale, chart.geometry)}
                      y2={yFor(value, chart.scale, chart.geometry)}
                      stroke="rgba(148,163,184,0.14)"
                      strokeWidth={1}
                    />
                    <text
                      x={chart.geometry.padding.left - 6}
                      y={yFor(value, chart.scale, chart.geometry) + 3}
                      textAnchor="end"
                      className="grap-axis"
                    >
                      {Math.round(value)}
                    </text>
                  </g>
                ))}

                {chartMetric === 'aqi' &&
                  GRAP_THRESHOLD_LINES.filter(
                    (line) => line.aqi >= chart.scale.min && line.aqi <= chart.scale.max,
                  ).map((line) => (
                    <g key={line.aqi}>
                      <line
                        x1={chart.geometry.padding.left}
                        x2={chart.geometry.width - chart.geometry.padding.right}
                        y1={yFor(line.aqi, chart.scale, chart.geometry)}
                        y2={yFor(line.aqi, chart.scale, chart.geometry)}
                        stroke={line.colour}
                        strokeWidth={1}
                        strokeDasharray="5 4"
                      />
                      <text
                        x={chart.geometry.width - chart.geometry.padding.right - 2}
                        y={yFor(line.aqi, chart.scale, chart.geometry) - 4}
                        textAnchor="end"
                        className="grap-threshold"
                        fill={line.colour}
                      >
                        {line.label}
                      </text>
                    </g>
                  ))}

                <path d={chart.averted} fill="rgba(96,165,250,0.16)" />
                <path
                  d={chart.baselinePath}
                  fill="none"
                  stroke="#f87171"
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
                <path
                  d={chart.mitigatedPath}
                  fill="none"
                  stroke="#4ade80"
                  strokeWidth={2}
                  strokeDasharray={isDirty ? undefined : '6 4'}
                  strokeLinejoin="round"
                />
                <circle
                  cx={xFor(chart.peakIndex, chart.baseline.length, chart.geometry)}
                  cy={yFor(chart.peakValue, chart.scale, chart.geometry)}
                  r={3.5}
                  fill="#f87171"
                />
                <circle
                  cx={xFor(chart.mitigatedPeakIndex, chart.mitigated.length, chart.geometry)}
                  cy={yFor(chart.mitigatedPeakValue, chart.scale, chart.geometry)}
                  r={3.5}
                  fill="#4ade80"
                />
                {[0, 12, 24, 36, 48, 60, 72]
                  .filter((hour) => hour < chart.baseline.length)
                  .map((hour) => (
                    <text
                      key={hour}
                      x={xFor(hour, chart.baseline.length, chart.geometry)}
                      y={chart.geometry.height - 8}
                      textAnchor="middle"
                      className="grap-axis"
                    >
                      {hour === 0 ? 'now' : `+${hour}h`}
                    </text>
                  ))}
                {comparison && chart.baseline.length > 1 && (
                  <line
                    x1={xFor(
                      Math.min(windowHours, chart.baseline.length - 1),
                      chart.baseline.length,
                      chart.geometry,
                    )}
                    x2={xFor(
                      Math.min(windowHours, chart.baseline.length - 1),
                      chart.baseline.length,
                      chart.geometry,
                    )}
                    y1={chart.geometry.padding.top}
                    y2={chart.geometry.height - chart.geometry.padding.bottom}
                    stroke="rgba(226,232,240,0.35)"
                    strokeWidth={1}
                  />
                )}
              </svg>
            ) : (
              <div className="grap-chart-placeholder">Waiting for the forecast…</div>
            )}

            <footer className="grap-legend">
              <span>
                <i style={{ background: '#f87171' }} /> Current measures
              </span>
              <span>
                <i style={{ background: '#4ade80' }} /> With these interventions
              </span>
              <span>
                <i style={{ background: 'rgba(96,165,250,0.5)' }} /> Averted load
              </span>
              {comparison && chart && (
                <span className="grap-legend-note">
                  urban core · {chartMetric === 'aqi' ? 'CPCB 24-h mean sub-index' : 'µg/m³'} · vertical
                  line at +{windowHours} h
                </span>
              )}
            </footer>
          </section>

          <section className="grap-card">
            <header className="grap-card-head">
              <h3>
                {grap ? grap.invoked_label : 'GRAP status'}
              {nextStage && (
                <span className="grap-headroom">
                  {nextStage.headroom > 0
                    ? `· ${nextStage.headroom.toFixed(0)} AQI below ${nextStage.label}`
                    : `· ${Math.abs(nextStage.headroom).toFixed(0)} AQI past the ${nextStage.label} threshold`}
                </span>
              )}
              </h3>
            </header>

            {exposure.length > 0 && (
              <div
                className="grap-exposure"
                title="Hours of the window spent in each stage, on the current-measures forecast"
              >
                {exposure.map((entry) => (
                  <span
                    key={entry.stage}
                    className="grap-exposure-seg"
                    style={{
                      flexGrow: entry.hours,
                      background: stageMeta(entry.stage).colour,
                    }}
                  >
                    {stageShort(entry.stage)} · {entry.hours}h
                  </span>
                ))}
              </div>
            )}

            <div className="grap-actions">
              <div>
                <h4>In force at {grap ? grap.invoked_label : 'this stage'}</h4>
                <ul>
                  {(grap?.actions_in_force ?? []).map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                  {grap && grap.actions_in_force.length === 0 && (
                    <li className="grap-muted">
                      No scheduled actions: the forecast stays at or below AQI 200.
                    </li>
                  )}
                </ul>
              </div>
              {nextStage && (
                <div>
                  <h4>To trigger {nextStage.label} (AQI ≥ {nextStage.threshold.toFixed(0)})</h4>
                  <ul>
                    {nextStage.actions.map((action) => (
                      <li key={action}>{action}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {preemption && (
              <p className={`grap-preemption ${preemption.escalated ? 'is-escalated' : ''}`}>
                <strong>{preemption.escalated ? 'Pre-emptive escalation advised' : 'Pre-emption check'}</strong>{' '}
                {preemption.rationale}
              </p>
            )}
          </section>

          {data && (
            <footer className="grap-foot">
              <p>
                Scenario evaluated with a reduced-order model of the coupled forecast: it reproduces
                its own baseline to{' '}
                <strong>{(data.surrogate.baseline_relative_error * 100).toFixed(2)} %</strong> (
                {data.surrogate.baseline_absolute_error_ug_m3.toFixed(2)} µg/m³) and is re-evaluated in
                milliseconds.
                {data.surrogate.urban_channel_response_bias !== null && (
                  <>
                    {' '}The vehicle channels are calibrated against a full model run with the urban
                    source removed, leaving a residual bias of{' '}
                    <strong>
                      {formatSigned(data.surrogate.urban_channel_response_bias * 100, 1)} %
                    </strong>{' '}
                    on their integrated effect.
                  </>
                )}
              </p>
              <p className="grap-muted">{data.intervention.note}</p>
              {data.notes.map((note) => (
                <p key={note} className="grap-muted">
                  {note}
                </p>
              ))}
            </footer>
          )}
        </div>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  after,
  tone,
  emphasis,
}: {
  label: string;
  value: string;
  after?: string;
  tone: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`grap-metric ${emphasis ? 'is-emphasis' : ''}`}>
      <span className="grap-metric-label">{label}</span>
      <span className="grap-metric-value" style={{ color: tone }}>
        {value}
        {after && <em>{after}</em>}
      </span>
    </div>
  );
}

function LeverGroup<T extends string | number>({
  title,
  subtitle,
  options,
  selected,
  onSelect,
}: {
  title: string;
  subtitle: string;
  options: readonly { value: T; label: string; hint: string }[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="grap-lever">
      <div className="grap-lever-head">
        <span className="grap-lever-title">{title}</span>
        <span className="grap-lever-sub">{subtitle}</span>
      </div>
      <div className="grap-segment" role="group" aria-label={title}>
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            className={`grap-seg ${option.value === selected ? 'is-active' : ''}`}
            aria-pressed={option.value === selected}
            title={option.hint}
            onClick={() => onSelect(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const SHELL_STYLE = {
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  color: '#e2e8f0',
  borderRadius: 14,
  background: '#05070d',
  border: '1px solid rgba(148,163,184,0.16)',
  padding: '14px 16px 16px',
} as const;

const GRAP_CSS = `
.grap-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.grap-title { margin: 0; font-size: 15px; font-weight: 650; letter-spacing: 0.2px; }
.grap-sub { margin: 3px 0 0; font-size: 11.5px; color: #94a3b8; }
.grap-badges { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.grap-stage-badge {
  display: inline-flex; align-items: baseline; gap: 6px; padding: 3px 10px;
  border: 1px solid; border-radius: 999px; font-size: 11.5px; letter-spacing: 0.3px;
  background: rgba(15, 23, 42, 0.6);
}
.grap-stage-badge strong { font-size: 13px; }
.grap-chip {
  font-size: 10.5px; padding: 3px 9px; border-radius: 999px;
  background: rgba(148,163,184,0.14); border: 1px solid rgba(148,163,184,0.22); color: #dbeafe;
}
.grap-chip-muted { color: #94a3b8; }
.grap-chip-error { color: #fecaca; border-color: rgba(248,113,113,0.45); }
.grap-chip-warn { color: #fde68a; border-color: rgba(250,204,21,0.45); background: rgba(250,204,21,0.12); }
.grap-toggle {
  background: transparent; border: 1px solid rgba(148,163,184,0.24); color: #cbd5f5;
  font: inherit; font-size: 11px; padding: 4px 10px; border-radius: 7px; cursor: pointer;
}
.grap-toggle:hover:not(:disabled) { background: rgba(148,163,184,0.16); }
.grap-toggle:disabled { opacity: 0.4; cursor: default; }
.grap-toggle.is-active { background: rgba(96,165,250,0.22); border-color: rgba(96,165,250,0.5); color: #eff6ff; }
.grap-error {
  margin: 10px 0 0; padding: 8px 10px; font-size: 11.5px; border-radius: 8px;
  background: rgba(248,113,113,0.1); border: 1px solid rgba(248,113,113,0.35); color: #fecaca;
  display: flex; align-items: center; gap: 10px; justify-content: space-between;
}
.grap-body { display: grid; grid-template-columns: minmax(240px, 300px) 1fr; gap: 16px; margin-top: 14px; }
.grap-levers { display: flex; flex-direction: column; gap: 12px; }
.grap-lever-head { display: flex; flex-direction: column; gap: 2px; margin-bottom: 6px; }
.grap-lever-title { font-size: 12px; font-weight: 600; }
.grap-lever-sub { font-size: 10.5px; color: #8fa0b8; }
.grap-segment { display: flex; gap: 4px; padding: 3px; border-radius: 9px; background: rgba(15,23,42,0.7); border: 1px solid rgba(148,163,184,0.14); }
.grap-seg {
  flex: 1; background: transparent; border: 1px solid transparent; color: #cbd5f5;
  font: inherit; font-size: 11px; padding: 6px 4px; border-radius: 7px; cursor: pointer;
  white-space: nowrap;
}
.grap-seg:hover { background: rgba(148,163,184,0.14); }
.grap-seg.is-active { background: rgba(96,165,250,0.22); border-color: rgba(96,165,250,0.5); color: #eff6ff; }
.grap-attribution { display: flex; flex-direction: column; gap: 4px; margin: 6px 0 0; padding: 8px 10px; border-radius: 9px; background: rgba(15,23,42,0.5); border: 1px solid rgba(148,163,184,0.12); }
.grap-attribution > div { display: flex; justify-content: space-between; gap: 10px; font-size: 11px; }
.grap-attribution dt { color: #8fa0b8; }
.grap-attribution dd { margin: 0; color: #e2e8f0; font-variant-numeric: tabular-nums; }
.grap-results { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.grap-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 8px; }
.grap-metric {
  display: flex; flex-direction: column; gap: 4px; padding: 9px 11px; border-radius: 10px;
  background: rgba(15,23,42,0.55); border: 1px solid rgba(148,163,184,0.14);
}
.grap-metric.is-emphasis { border-color: rgba(96,165,250,0.34); background: rgba(30,58,138,0.22); }
.grap-metric-label { font-size: 10px; letter-spacing: 0.35px; text-transform: uppercase; color: #93a4bd; }
.grap-metric-value { font-size: 19px; font-weight: 600; font-variant-numeric: tabular-nums; display: flex; align-items: baseline; gap: 6px; }
.grap-metric-value em { font-size: 10.5px; font-style: normal; font-weight: 500; color: #94a3b8; }
.grap-card { padding: 12px 13px; border-radius: 11px; background: rgba(15,23,42,0.45); border: 1px solid rgba(148,163,184,0.13); }
.grap-card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
.grap-card-head h3 { margin: 0; font-size: 12.5px; font-weight: 600; display: flex; align-items: baseline; gap: 8px; }
.grap-headroom { font-size: 10.5px; font-weight: 400; color: #93a4bd; }
.grap-chart-toggles { display: flex; gap: 4px; }
.grap-chart { width: 100%; height: auto; display: block; overflow: visible; }
.grap-axis { font-size: 9px; fill: #7c8ba1; }
.grap-threshold { font-size: 9px; letter-spacing: 0.3px; }
.grap-chart-placeholder { padding: 40px 0; text-align: center; font-size: 11.5px; color: #8fa0b8; }
.grap-legend { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 6px; font-size: 10.5px; color: #a7b4c7; }
.grap-legend span { display: inline-flex; align-items: center; gap: 6px; }
.grap-legend i { width: 12px; height: 3px; border-radius: 2px; display: inline-block; }
.grap-legend-note { color: #7c8ba1; }
.grap-exposure { display: flex; gap: 2px; margin-bottom: 10px; border-radius: 6px; overflow: hidden; }
.grap-exposure-seg {
  font-size: 9.5px; padding: 3px 6px; color: #0b1120; font-weight: 600;
  letter-spacing: 0.2px; white-space: nowrap; overflow: hidden; min-width: 34px; text-align: center;
  opacity: 0.85;
}
.grap-actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
.grap-actions h4 { margin: 0 0 5px; font-size: 11px; font-weight: 600; color: #cbd5f5; }
.grap-actions ul { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 3px; }
.grap-actions li { font-size: 11px; line-height: 1.45; color: #a7b4c7; }
.grap-preemption {
  margin: 11px 0 0; padding: 8px 10px; font-size: 11px; line-height: 1.5; border-radius: 8px;
  background: rgba(148,163,184,0.08); border: 1px solid rgba(148,163,184,0.14); color: #a7b4c7;
}
.grap-preemption.is-escalated { background: rgba(250,204,21,0.1); border-color: rgba(250,204,21,0.34); color: #fde68a; }
.grap-preemption strong { color: #e2e8f0; }
.grap-foot { display: flex; flex-direction: column; gap: 4px; font-size: 10.5px; line-height: 1.5; color: #93a4bd; }
.grap-foot p { margin: 0; }
.grap-foot strong { color: #cbd5f5; }
.grap-muted { color: #7c8ba1; }
@media (max-width: 900px) {
  .grap-body { grid-template-columns: 1fr; }
  .grap-levers { order: 2; }
  .grap-results { order: 1; }
}
`;

export const GrapSimulatorCss = GRAP_CSS;
