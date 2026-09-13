'use client';

/**
 * AqiForecastMap — animated Delhi NCR air-quality forecast map.
 *
 * A MapLibre GL dark base map with Deck.gl layers stacked on top through
 * `MapboxOverlay` (interleaved, so Deck.gl geometry and the base map share one
 * WebGL context and depth buffer). The base map is CARTO's CartoDB Dark Matter
 * when `NEXT_PUBLIC_CARTO_API_KEY` is set and OpenFreeMap's dark style
 * otherwise — see the basemap note below for why CARTO needs a key.
 *
 *   1. PM2.5 field        - extruded GridLayer (3D) or smooth HeatmapLayer (2D),
 *                           coloured and sized by the CPCB AQI sub-index.
 *   2. Wind flow          - animated particle streaks advected by the model wind,
 *                           or discrete wind arrows, depending on the mode.
 *   3. Stubble fires      - FIRMS / synthetic detections over the burning belt.
 *   4. High-risk zones    - Anand Vihar, Jahangirpuri, Punjabi Bagh, Bawana, Okhla.
 *
 * A time slider scrubs the +0h..+72h horizon; clicking the map opens an
 * inspector with PM2.5, inversion index, PBL depth and a data-derived
 * "primary driver" explanation.
 *
 * Install
 * -------
 *   npm install maplibre-gl @deck.gl/core @deck.gl/layers \
 *               @deck.gl/aggregation-layers @deck.gl/mapbox
 *
 * Mount it from a Server Component page (SSR-safe) with:
 *
 *   import dynamic from 'next/dynamic';
 *   const AqiForecastMap = dynamic(() => import('@/components/AqiForecastMap'), {
 *     ssr: false, loading: () => <div style={{ height: 720 }} />,
 *   });
 *
 * Same-origin requests need a rewrite so the browser can reach FastAPI; add to
 * next.config.ts (or point `apiBaseUrl` at the absolute service URL):
 *
 *   async rewrites() {
 *     return [{ source: '/api/:path*', destination: `${process.env.FORECAST_API_URL}/api/:path*` }];
 *   }
 *
 * The CSS for maplibre-gl is imported below; if your bundler complains, import
 * 'maplibre-gl/dist/maplibre-gl.css' in app/layout.tsx instead.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { IControl, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { PickingInfo } from '@deck.gl/core';
import { GridLayer, HeatmapLayer } from '@deck.gl/aggregation-layers';
import { LineLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
import 'maplibre-gl/dist/maplibre-gl.css';

// ---------------------------------------------------------------------------
// API contract (mirrors routers/forecast.py)
// ---------------------------------------------------------------------------
export interface ApiBoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface ApiPointGeometry {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
}

export interface ApiFeature<P> {
  type: 'Feature';
  id?: string;
  geometry: ApiPointGeometry;
  properties: P;
}

export interface ApiFeatureCollection<P> {
  type: 'FeatureCollection';
  features: Array<ApiFeature<P>>;
}

export interface Pm25CellProperties {
  pm25: number;
  aqi_value: number;
  aqi_category: AqiCategory;
  aqi_category_instant: AqiCategory;
  pbl_height_m: number;
  inversion_strength_index: number;
  stubble_emission_ug_m2_s: number;
  pbl_suppression_fraction: number;
  aloft_column_mass_ug_m2: number;
  row: number;
  col: number;
}

/** A PM2.5 cell flattened with its coordinates, as handed to the Deck.gl layers. */
export type Pm25Point = Pm25CellProperties & { longitude: number; latitude: number };

export interface FireProperties {
  frp: number;
  frp_scaled: number;
  acquired: string | null;
  confidence: string | null;
  satellite: string | null;
  source: string;
}

export interface WindProperties {
  u_ms: number;
  v_ms: number;
  speed_ms: number;
  direction_deg: number; // blows FROM
  bearing_deg: number; // blows TOWARD
  row: number;
  col: number;
}

export interface ApiTimelinePoint {
  hour_index: number;
  time_local: string;
  mean_pm25: number;
  max_pm25: number;
  mean_pbl_m: number;
  mean_aqi_value: number;
  dominant_aqi_category: AqiCategory;
  wind_speed_ms: number;
  wind_direction_deg: number;
}

export interface ApiSummary {
  generated_at: string;
  horizon_hours: number;
  selected_hour_index: number;
  selected_hour_time_local: string;
  mean_pm25_selected_hour: number;
  peak_pm25_episode: number;
  mean_pm25_episode: number;
  pbl_min_m: number;
  pbl_max_m: number;
  max_pbl_suppression_fraction: number;
  suppression_saturated_hours: number;
  dominant_aqi_category: AqiCategory;
  aqi_category_share_percent: Partial<Record<AqiCategory, number>>;
  fire_detections: number;
  fires_used_in_model: number;
  fires_out_of_domain: number;
  total_frp_mw: number;
  mean_wind_speed_ms: number;
  dominant_wind_direction_deg: number;
  cfl_stable: boolean;
  mean_substeps_per_hour: number;
  max_courant: number;
  mass_budget_tonnes: Record<string, number>;
  model_warnings: string[];
}

export interface ApiGrid {
  shape: [number, number];
  dx_m: number;
  dy_m: number;
  cell_area_m2: number;
  domain_km: [number, number];
  bbox: ApiBoundingBox;
  crs: string;
}

export interface ApiProvenance {
  meteorology_source: string;
  meteorology_detail: string;
  fire_source: string;
  fire_detail: string;
  forecast_start_local: string | null;
  forecast_hours: number;
  fetched_at: string;
  simulation_cached: boolean;
  simulation_fingerprint: string;
  notes: string[];
}

export interface ForecastResponse {
  center: [number, number];
  bbox: ApiBoundingBox;
  grid: ApiGrid;
  summary: ApiSummary;
  timeline: ApiTimelinePoint[];
  fires: ApiFeatureCollection<FireProperties>;
  pm25_field: ApiFeatureCollection<Pm25CellProperties>;
  wind_field: ApiFeatureCollection<WindProperties>;
  provenance: ApiProvenance;
}

// ---------------------------------------------------------------------------
// Domain constants
// ---------------------------------------------------------------------------
export type AqiCategory =
  | 'Good'
  | 'Satisfactory'
  | 'Moderate'
  | 'Poor'
  | 'Very Poor'
  | 'Severe';

export interface AqiBand {
  category: AqiCategory;
  min: number;
  max: number;
  colour: string;
}

/** CPCB PM2.5 sub-index bands, used for every colour decision in the UI. */
export const CPCB_BANDS: readonly AqiBand[] = [
  { category: 'Good', min: 0, max: 50, colour: '#22c55e' },
  { category: 'Satisfactory', min: 51, max: 100, colour: '#a3e635' },
  { category: 'Moderate', min: 101, max: 200, colour: '#facc15' },
  { category: 'Poor', min: 201, max: 300, colour: '#fb923c' },
  { category: 'Very Poor', min: 301, max: 400, colour: '#ef4444' },
  { category: 'Severe', min: 401, max: 500, colour: '#a21caf' },
];

/** Monitoring neighbourhoods that routinely top the Delhi NCR ranking. */
export interface RiskZone {
  id: string;
  name: string;
  longitude: number;
  latitude: number;
  note: string;
}

export const HIGH_RISK_ZONES: readonly RiskZone[] = [
  { id: 'anand-vihar', name: 'Anand Vihar', longitude: 77.3161, latitude: 28.6469, note: 'Traffic + industrial corridor' },
  { id: 'jahangirpuri', name: 'Jahangirpuri', longitude: 77.1628, latitude: 28.7256, note: 'North-west inflow gateway' },
  { id: 'punjabi-bagh', name: 'Punjabi Bagh', longitude: 77.131, latitude: 28.6686, note: 'Dense residential bowl' },
  { id: 'bawana', name: 'Bawana', longitude: 77.0364, latitude: 28.7768, note: 'Industrial estate, low PBL' },
  { id: 'okhla', name: 'Okhla', longitude: 77.2711, latitude: 28.5355, note: 'Waste-to-energy + industry' },
];

export const DELHI_NCR_CENTER: [number, number] = [77.209, 28.6139];

/**
 * CARTO now requires an API key on basemap tiles and serves an
 * "API KEY REQUIRED — carto.com/basemaps/apikey" watermark without one, so the
 * key is used when configured. Keys are free (5M tile requests/month,
 * non-commercial) and are passed as a `?key=` query parameter.
 *
 * When no key is present we fall back to OpenFreeMap's dark vector style: free,
 * unlimited, no registration, and MapLibre-native. That fallback is also the
 * better long-term default, since CARTO is retiring the raster service these
 * Dark Matter URLs belong to.
 */
const CARTO_API_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY;
const OPENFREEMAP_DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark';

/** Dark basemap style for a given CARTO key (or the key-free fallback). */
export function basemapStyleFor(apiKey?: string): string | StyleSpecification {
  const key = apiKey?.trim();
  return key ? cartoDarkMatterStyle(key) : OPENFREEMAP_DARK_STYLE;
}

function cartoDarkMatterStyle(apiKey: string): StyleSpecification {
  const tile = (subdomain: string) =>
    `https://${subdomain}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png?key=${encodeURIComponent(apiKey)}`;
  return {
    version: 8,
    name: 'CartoDB Dark Matter',
    sources: {
      'carto-dark': {
        type: 'raster',
        tiles: [tile('a'), tile('b'), tile('c')],
        tileSize: 256,
        maxzoom: 20,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>',
      },
    },
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#05070d' } },
      {
        id: 'carto-dark',
        type: 'raster',
        source: 'carto-dark',
        paint: { 'raster-opacity': 0.92, 'raster-saturation': -0.3, 'raster-contrast': 0.1 },
      },
    ],
  };
}

/** A remote style URL or an inline style description. */
const BASEMAP_STYLE: string | StyleSpecification = basemapStyleFor(CARTO_API_KEY);

/** Which basemap is live, for display alongside the data provenance. */
export const BASEMAP_SOURCE = typeof BASEMAP_STYLE === 'string' ? 'OpenFreeMap dark' : 'CartoDB Dark Matter';

const MAX_PARTICLES = 1400;
const PARTICLE_FRAME_MS = 33; // ~30 fps is enough for flow and keeps the CPU cool
// Model seconds elided per animation frame. At ~200 s/frame a 2 m/s wind moves a
// particle ~400 m per frame, so a cross-domain crossing takes a few seconds of
// wall time instead of the ~10 h it takes in the model.
const PARTICLE_SECONDS_PER_FRAME = 200;
// Frames a streak lives before it fades out and respawns (~5.5 s at 30 fps).
const PARTICLE_AGE_STEP = 1 / 170;
// Streak length in frames of travel; encodes wind speed as length.
const PARTICLE_TAIL_FRAMES = 1.6;

// ---------------------------------------------------------------------------
// Pure helpers (exported so they can be unit tested without a WebGL context)
// ---------------------------------------------------------------------------
export function hexToRgb(hex: string, alpha = 255): [number, number, number, number] {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return [r, g, b, alpha];
}

/** CPCB category for a 0-500 AQI sub-index. */
export function categoryForAqi(aqiValue: number): AqiCategory {
  const band = CPCB_BANDS.find((entry) => aqiValue <= entry.max);
  return (band ?? CPCB_BANDS[CPCB_BANDS.length - 1]).category;
}

export function colourForCategory(category: AqiCategory): string {
  return CPCB_BANDS.find((band) => band.category === category)?.colour ?? '#94a3b8';
}

export function colourForAqi(aqiValue: number, alpha = 255): [number, number, number, number] {
  return hexToRgb(colourForCategory(categoryForAqi(aqiValue)), alpha);
}

/** 16-point compass label for a bearing in degrees. */
export function compassLabel(degrees: number): string {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round(((degrees % 360) + 360) % 360 / 22.5) % 16];
}

/** The categorical colour ramp Deck.gl uses for grid cells and the legend. */
export const AQI_COLOUR_RANGE: Array<[number, number, number, number]> = [
  hexToRgb('#14532d', 230),
  hexToRgb('#22c55e', 230),
  hexToRgb('#a3e635', 230),
  hexToRgb('#facc15', 235),
  hexToRgb('#fb923c', 240),
  hexToRgb('#ef4444', 245),
  hexToRgb('#a21caf', 250),
];

export interface DriverExplanation {
  headline: string;
  factors: string[];
  tone: 'clean' | 'moderate' | 'severe';
}

export interface DriverInputs {
  pm25: number;
  aqi_value: number;
  pbl_height_m: number;
  inversion_strength_index: number;
  stubble_emission_ug_m2_s: number;
  pbl_suppression_fraction: number;
  aloft_column_mass_ug_m2: number;
}

/**
 * Explain *why* a cell reads what it reads, from the model's own diagnostics.
 *
 * The ordering matters: local emission beats transport, a shallow PBL beats
 * everything except fresh emission, and strong ventilation is called out as
 * such rather than always blaming stubble.
 */
export function describeDriver(
  cell: DriverInputs,
  wind: { speed_ms: number; direction_deg: number } | null,
  horizon?: { fires_used_in_model?: number; total_frp_mw?: number },
): DriverExplanation {
  const factors: string[] = [];
  const calm = wind ? wind.speed_ms < 2.5 : false;
  const ventilated = wind ? wind.speed_ms >= 4 : false;
  const shallow = cell.pbl_height_m < 400;
  const inverted = cell.inversion_strength_index > 0 && cell.inversion_strength_index < 1.0;
  const local_burning = cell.stubble_emission_ug_m2_s >= 0.01;
  const aloft_feeding = cell.aloft_column_mass_ug_m2 >= 500;
  const self_limiting = cell.pbl_suppression_fraction >= 0.15;

  factors.push(`${Math.round(cell.pbl_height_m)} m PBL`);
  if (wind) {
    factors.push(`${wind.speed_ms.toFixed(1)} m/s ${compassLabel(wind.direction_deg)} wind`);
  }
  if (inverted && cell.inversion_strength_index > 0) {
    factors.push(`Inversion T2m/T850 = ${cell.inversion_strength_index.toFixed(3)}`);
  }
  if (self_limiting) {
    factors.push(`Aerosol PBL suppression ${(cell.pbl_suppression_fraction * 100).toFixed(0)}%`);
  }
  if (local_burning) {
    factors.push(`Local residue burning ${cell.stubble_emission_ug_m2_s.toFixed(2)} µg m⁻² s⁻¹`);
  }
  if (aloft_feeding) {
    factors.push(`Lofted smoke reservoir ${Math.round(cell.aloft_column_mass_ug_m2)} µg/m²`);
  }

  const severe = cell.aqi_value > 300;
  const clean = cell.aqi_value <= 100;
  const tone: DriverExplanation['tone'] = clean ? 'clean' : severe ? 'severe' : 'moderate';

  let headline: string;
  if (clean && !shallow) {
    headline = ventilated
      ? `Well ventilated — ${Math.round(cell.pbl_height_m)} m mixed layer flushing the dome`
      : 'Background air — no strong accumulation signal';
  } else if (local_burning && shallow) {
    headline = `Trapped stubble smoke — fresh burning under a ${Math.round(cell.pbl_height_m)} m inversion`;
  } else if (local_burning) {
    headline = 'Fresh stubble smoke injected into the mixed layer';
  } else if (shallow && calm) {
    headline = `Trapped pollution — ${Math.round(cell.pbl_height_m)} m inversion with near-calm ${wind ? wind.speed_ms.toFixed(1) : '0.0'} m/s winds`;
  } else if (shallow && inverted) {
    headline = `Inversion trapping under a ${Math.round(cell.pbl_height_m)} m surface layer`;
  } else if (aloft_feeding) {
    headline = 'Lofted stubble smoke entraining down into the mixed layer';
  } else if (severe && ventilated) {
    headline = `Regional smoke advected in on ${wind ? compassLabel(wind.direction_deg) : 'prevailing'} winds at ${wind ? wind.speed_ms.toFixed(1) : '0.0'} m/s`;
  } else if (severe) {
    headline = `Severe accumulation — ${Math.round(cell.pbl_height_m)} m mixed layer cannot disperse the load`;
  } else if (ventilated) {
    headline = `Regionally transported smoke diluted by a ${Math.round(cell.pbl_height_m)} m mixed layer`;
  } else {
    headline = `Urban accumulation under a ${Math.round(cell.pbl_height_m)} m mixed layer`;
  }

  if (horizon?.fires_used_in_model) {
    factors.push(
      `${horizon.fires_used_in_model} fire pixels in model (${Math.round(horizon.total_frp_mw ?? 0)} MW FRP)`,
    );
  }

  return { headline, factors, tone };
}

export function nearestCell<P extends { row: number; col: number }>(
  cells: Array<ApiFeature<P>>,
  longitude: number,
  latitude: number,
): ApiFeature<P> | null {
  let best: ApiFeature<P> | null = null;
  let bestDistance = Infinity;
  for (const cell of cells) {
    const dx = cell.geometry.coordinates[0] - longitude;
    const dy = cell.geometry.coordinates[1] - latitude;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = cell;
    }
  }
  return best;
}

/** Triangular arrow polygon pointing along `bearingDeg`, sized in degrees. */
export function arrowPolygon(
  longitude: number,
  latitude: number,
  bearingDeg: number,
  sizeDeg: number,
): Array<[number, number]> {
  const radians = ((90 - bearingDeg) * Math.PI) / 180; // compass -> math angle
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // A degree of longitude is `aspect` times shorter on screen than a degree of
  // latitude at this latitude. Build the arrowhead in the isotropic local frame
  // (X = longitude * aspect, Y = latitude) and divide the X offsets back out, so
  // the shaft really points along the bearing and all arrows come out the same
  // length. Scaling the longitude offsets directly would instead make east-west
  // arrows `aspect^2` (roughly 0.77x) shorter than north-south ones.
  const aspect = Math.max(Math.cos((latitude * Math.PI) / 180), 0.35);
  const local = (x: number, y: number): [number, number] => [longitude + x / aspect, latitude + y];
  const back = sizeDeg * 0.35; // how far the barbs sit behind the tip
  const side = sizeDeg * 0.42; // how far they splay to each side of the shaft
  const tip = local(cos * sizeDeg, sin * sizeDeg);
  const left = local(-cos * back - sin * side, -sin * back + cos * side);
  const right = local(-cos * back + sin * side, -sin * back - cos * side);
  return [tip, left, right];
}

/** Deterministic pseudo-random generator so SSR/client and re-mounts agree. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export interface Particle {
  longitude: number;
  latitude: number;
  age: number;
}

export const METRES_PER_DEGREE_LAT = 110574;
export function metresPerDegreeLon(latitude: number): number {
  return 111320 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.2);
}

/** Random spawn position; age is staggered so streaks do not pulse in unison. */
export function spawnParticle(bbox: ApiBoundingBox, random: () => number): Particle {
  return {
    longitude: bbox.west + random() * (bbox.east - bbox.west),
    latitude: bbox.south + random() * (bbox.north - bbox.south),
    age: random(),
  };
}

/** Advance one particle by the local wind and age it by one frame. */
export function advanceParticle(
  particle: Particle,
  u: number,
  v: number,
  dtSeconds: number,
  ageStep: number = PARTICLE_AGE_STEP,
): Particle {
  return {
    longitude: particle.longitude + (u * dtSeconds) / metresPerDegreeLon(particle.latitude),
    latitude: particle.latitude + (v * dtSeconds) / METRES_PER_DEGREE_LAT,
    age: particle.age + ageStep,
  };
}

export type WindSampler = (longitude: number, latitude: number) => { u: number; v: number };

/**
 * Nearest-sample wind lookup over the API's coarse lattice.
 *
 * The sample axes are taken from the features' own coordinates rather than
 * assumed to span the bounding box, so a partial lattice (or one that does not
 * include the outermost row/column) still maps to the physically nearest
 * sample.  Today the model wind is horizontally uniform, so this returns the
 * same vector everywhere; it becomes genuinely spatial the moment the ingestion
 * layer feeds gridded winds in, with no change needed here.
 */
export function buildWindSampler(
  features: Array<ApiFeature<WindProperties>>,
  fallback: { u: number; v: number } = { u: 0, v: 0 },
): WindSampler {
  if (!features.length) return () => fallback;

  const latitudes = Array.from(new Set(features.map((f) => f.geometry.coordinates[1]))).sort(
    (a, b) => a - b,
  );
  const longitudes = Array.from(new Set(features.map((f) => f.geometry.coordinates[0]))).sort(
    (a, b) => a - b,
  );
  const table = new Map<string, WindProperties>();
  for (const feature of features) {
    table.set(
      `${feature.geometry.coordinates[1]}|${feature.geometry.coordinates[0]}`,
      feature.properties,
    );
  }

  const nearestIndex = (axis: number[], value: number): number => {
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < axis.length; index += 1) {
      const distance = Math.abs(axis[index] - value);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    return bestIndex;
  };

  return (longitude: number, latitude: number) => {
    const lat = latitudes[nearestIndex(latitudes, latitude)];
    const lon = longitudes[nearestIndex(longitudes, longitude)];
    const sample = table.get(`${lat}|${lon}`) ?? features[0].properties;
    return { u: sample.u_ms, v: sample.v_ms };
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export interface AqiForecastMapProps {
  /** Base URL of the forecast API. Empty string means same origin (use a rewrite). */
  apiBaseUrl?: string;
  /** Horizon to request, in hours. The API caps this at 72. */
  horizonHours?: number;
  /** Grid sub-sampling sent to the API: 1 = full 50x50 model grid, 2 = 625 cells. */
  gridStride?: number;
  /** Hour rendered on first paint. */
  initialHour?: number;
  /** Height of the map container. */
  height?: number | string;
  className?: string;
}

interface InspectTarget {
  longitude: number;
  latitude: number;
  cell: ApiFeature<Pm25CellProperties>;
  zone?: RiskZone;
}

export default function AqiForecastMap({
  apiBaseUrl = '',
  horizonHours = 72,
  gridStride = 2,
  initialHour = 0,
  height = '100%',
  className,
}: AqiForecastMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const staticLayersRef = useRef<unknown[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const randomRef = useRef<() => number>(makeRandom(20260913));
  const hoverHandlerRef = useRef<(info: PickingInfo) => void>(() => {});
  const frameRef = useRef<number | null>(null);
  const cacheRef = useRef<Map<number, ForecastResponse>>(new Map());
  const inFlightRef = useRef<Map<number, AbortController>>(new Map());

  const [hour, setHour] = useState(initialHour);
  const [reloadToken, setReloadToken] = useState(0);
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [playing, setPlaying] = useState(false);
  const [view3d, setView3d] = useState(true);
  const [windMode, setWindMode] = useState<'particles' | 'arrows' | 'off'>('particles');
  const [showZones, setShowZones] = useState(true);
  const [showFires, setShowFires] = useState(true);
  const [inspect, setInspect] = useState<InspectTarget | null>(null);
  const [screenPosition, setScreenPosition] = useState<{ x: number; y: number } | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // ---- data loading -------------------------------------------------------
  const loadHour = useCallback(
    async (target: number, signal?: AbortSignal): Promise<ForecastResponse | null> => {
      const cached = cacheRef.current.get(target);
      if (cached) return cached;
      const url = `${apiBaseUrl}/api/forecast/72h?hour=${target}&hours=${horizonHours}&stride=${gridStride}`;
      const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
      if (!response.ok) {
        throw new Error(`Forecast API returned ${response.status} ${response.statusText}`);
      }
      const payload = (await response.json()) as ForecastResponse;
      cacheRef.current.set(target, payload);
      return payload;
    },
    [apiBaseUrl, gridStride, horizonHours],
  );

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setStatus((current) => (current === 'ready' ? current : 'loading'));

    loadHour(hour, controller.signal)
      .then((payload) => {
        if (cancelled || !payload) return;
        setData(payload);
        setStatus('ready');
        setErrorMessage('');
        // Prefetch the next few frames so scrubbing feels continuous; the API
        // memoises the simulation, so each extra hour is a cheap re-render.
        for (const offset of [1, 2, -1]) {
          const neighbour = hour + offset;
          if (neighbour < 0 || neighbour > horizonHours - 1) continue;
          if (cacheRef.current.has(neighbour) || inFlightRef.current.has(neighbour)) continue;
          const preController = new AbortController();
          inFlightRef.current.set(neighbour, preController);
          loadHour(neighbour, preController.signal)
            .catch(() => undefined)
            .finally(() => inFlightRef.current.delete(neighbour));
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('abort')) return;
        setErrorMessage(message);
        setStatus('error');
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [hour, horizonHours, loadHour, reloadToken]);

  // ---- playback -----------------------------------------------------------
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setHour((current) => (current + 1) % horizonHours);
    }, 600);
    return () => window.clearInterval(timer);
  }, [playing, horizonHours]);

  // ---- map lifecycle ------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // MapLibre throws when it cannot create a WebGL context -- on a machine with
    // no GPU, inside a sandboxed browser, or after a context loss. Letting that
    // propagate out of an effect blanks the whole dashboard: the map is one panel
    // among several, so the failure is reported in place instead.
    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: BASEMAP_STYLE,
        center: DELHI_NCR_CENTER,
        zoom: 9.2,
        pitch: 48,
        bearing: -14,
        maxPitch: 70,
        antialias: true,
        attributionControl: { compact: true },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setErrorMessage(
        `WebGL is unavailable, so the map cannot render: ${detail}. ` +
          'The rest of the dashboard is unaffected.',
      );
      setStatus('error');
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.addControl(
      new maplibregl.GeolocateControl({ trackUserLocation: false }),
      'top-right',
    );

    const overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
      onClick: (info: PickingInfo) => hoverHandlerRef.current(info),
    });
    // Deck.gl's overlay is a MapLibre control; the cast bridges the mapbox-gl
    // peer types that @deck.gl/mapbox declares.
    map.addControl(overlay as unknown as IControl);

    mapRef.current = map;
    overlayRef.current = overlay;

    const handleProjection = () => {
      setScreenPosition((current) => (current ? { ...current } : current));
    };
    map.on('move', handleProjection);
    map.on('zoom', handleProjection);
    map.on('load', () => setMapReady(true));

    return () => {
      map.off('move', handleProjection);
      map.off('zoom', handleProjection);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      overlay.finalize?.();
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
      staticLayersRef.current = [];
      setMapReady(false);
    };
  }, []);

  // ---- click / hover handling --------------------------------------------
  hoverHandlerRef.current = (info: PickingInfo) => {
    if (!data) return;
    const coordinate =
      (info.coordinate as [number, number] | undefined) ??
      (typeof info.x === 'number' && typeof info.y === 'number' && mapRef.current
        ? (mapRef.current.unproject([info.x, info.y]).toArray() as [number, number])
        : undefined);
    if (!coordinate) return;
    const [longitude, latitude] = coordinate;
    const cell = nearestCell(data.pm25_field.features, longitude, latitude);
    if (!cell) return;
    const zone = HIGH_RISK_ZONES.find((entry) => {
      const dx = (entry.longitude - longitude) * Math.cos((latitude * Math.PI) / 180);
      const dy = entry.latitude - latitude;
      return Math.sqrt(dx * dx + dy * dy) < 0.03;
    });
    setInspect({ longitude: cell.geometry.coordinates[0], latitude: cell.geometry.coordinates[1], cell, zone });
  };

  // ---- deck.gl layers -----------------------------------------------------
  const cellSize = Math.max(1600 * gridStride, 1200);

  const buildLayers = useCallback(() => {
    if (!data) return [];
    const layers: unknown[] = [];
    const cells = data.pm25_field.features;
    const points: Pm25Point[] = cells.map((cell) => ({
      ...cell.properties,
      longitude: cell.geometry.coordinates[0],
      latitude: cell.geometry.coordinates[1],
    }));

    // The layer data type is pinned explicitly: Deck.gl's accessor generics
    // would otherwise be inferred from both `data` and each accessor, which
    // collapses DataT to never.
    if (view3d) {
      layers.push(
        new GridLayer<Pm25Point>({
          id: 'pm25-grid-3d',
          data: points,
          pickable: true,
          extruded: true,
          cellSize,
          coverage: 0.92,
          gpuAggregation: false,
          colorAggregation: 'MAX',
          elevationAggregation: 'MAX',
          getPosition: (point: Pm25Point) => [point.longitude, point.latitude],
          getColorWeight: (point: Pm25Point) => point.aqi_value,
          getElevationWeight: (point: Pm25Point) => point.aqi_value,
          colorRange: AQI_COLOUR_RANGE,
          elevationScale: 2.6,
          material: {
            ambient: 0.42,
            diffuse: 0.6,
            shininess: 28,
            specularColor: [58, 64, 76],
          },
          // Deck.gl v9 replaces transitionDuration with per-accessor timings.
          transitions: { getColorWeight: 220, getElevationWeight: 220 },
        }),
      );
    } else {
      layers.push(
        new HeatmapLayer<Pm25Point>({
          id: 'pm25-heat-2d',
          data: points,
          pickable: true,
          getPosition: (point: Pm25Point) => [point.longitude, point.latitude],
          getWeight: (point: Pm25Point) => point.aqi_value,
          radiusPixels: 46,
          intensity: 1.15,
          threshold: 0.04,
          // HeatmapLayer supports SUM/MEAN only; MEAN keeps the smooth field on
          // the same scale as individual cell values. Use the 3D GridLayer view
          // when peak-preserving MAX aggregation matters.
          aggregation: 'MEAN',
          colorRange: AQI_COLOUR_RANGE,
        }),
      );
    }

    if (showFires && data.fires.features.length) {
      layers.push(
        new ScatterplotLayer<ApiFeature<FireProperties>>({
          id: 'stubble-fires',
          data: data.fires.features,
          pickable: false,
          stroked: true,
          filled: true,
          radiusUnits: 'pixels',
          getPosition: (feature) => feature.geometry.coordinates,
          getRadius: (feature) => 2.2 + Math.sqrt(Math.max(feature.properties.frp_scaled, 0)) * 0.9,
          getFillColor: [255, 176, 32, 120],
          getLineColor: [255, 214, 102, 200],
          lineWidthMinPixels: 1,
        }),
      );
    }

    if (showZones) {
      const zoneData = HIGH_RISK_ZONES.map((zone) => {
        const cell = nearestCell(cells, zone.longitude, zone.latitude);
        const properties = cell?.properties;
        return {
          zone,
          aqi: properties?.aqi_value ?? 0,
          pm25: properties?.pm25 ?? 0,
          category: properties?.aqi_category ?? ('Good' as AqiCategory),
          longitude: zone.longitude,
          latitude: zone.latitude,
        };
      });
      layers.push(
        new ScatterplotLayer<(typeof zoneData)[number]>({
          id: 'risk-zones-halo',
          data: zoneData,
          pickable: false,
          stroked: false,
          radiusUnits: 'pixels',
          getPosition: (d) => [d.longitude, d.latitude],
          getRadius: (d) => (d.aqi > 300 ? 26 : d.aqi > 200 ? 21 : 17),
          getFillColor: (d) => colourForAqi(d.aqi, 38),
          updateTriggers: { getRadius: [hour], getFillColor: [hour] },
        }),
        new ScatterplotLayer<(typeof zoneData)[number]>({
          id: 'risk-zones-ring',
          data: zoneData,
          pickable: true,
          stroked: true,
          filled: false,
          radiusUnits: 'pixels',
          getPosition: (d) => [d.longitude, d.latitude],
          getRadius: (d) => (d.aqi > 300 ? 13 : 10),
          getLineColor: (d) => colourForAqi(d.aqi, 255),
          getLineWidth: (d) => (d.aqi > 300 ? 3 : 2),
          lineWidthUnits: 'pixels',
          updateTriggers: { getLineColor: [hour], getRadius: [hour] },
        }),
      );
    }

    if (windMode === 'arrows' && data.wind_field.features.length) {
      const arrows = data.wind_field.features.map((feature) => ({
        ...feature.properties,
        polygon: arrowPolygon(
          feature.geometry.coordinates[0],
          feature.geometry.coordinates[1],
          feature.properties.bearing_deg,
          0.028 + Math.min(feature.properties.speed_ms, 12) * 0.004,
        ),
      }));
      layers.push(
        new PolygonLayer<(typeof arrows)[number]>({
          id: 'wind-arrows',
          data: arrows,
          pickable: false,
          filled: true,
          stroked: false,
          getPolygon: (d) => d.polygon,
          getFillColor: (d) => {
            const strength = Math.min(Math.max(d.speed_ms, 0), 10) / 10;
            return [148, 197, 255, Math.round(90 + strength * 150)] as [number, number, number, number];
          },
        }),
      );
    }

    staticLayersRef.current = layers;
    return layers;
  }, [data, view3d, showZones, showFires, windMode, cellSize, hour]);

  useEffect(() => {
    if (!overlayRef.current) return;
    const layers = buildLayers();
    overlayRef.current.setProps({ layers: layers as never });
  }, [buildLayers, mapReady]);

  // ---- animated particle flow --------------------------------------------
  useEffect(() => {
    const bbox = data?.bbox;
    if (!bbox) return;
    const random = randomRef.current;
    if (particlesRef.current.length !== MAX_PARTICLES) {
      particlesRef.current = Array.from({ length: MAX_PARTICLES }, () =>
        spawnParticle(bbox, random),
      );
    }
  }, [data?.bbox]);

  useEffect(() => {
    if (!mapReady || windMode !== 'particles' || !data) return;
    const bbox = data.bbox;
    const overlay = overlayRef.current;
    if (!overlay) return;

    const sampler = buildWindSampler(data.wind_field.features, {
      u: data.summary.mean_wind_speed_ms * Math.sin(((data.summary.dominant_wind_direction_deg + 180) * Math.PI) / 180),
      v: data.summary.mean_wind_speed_ms * Math.cos(((data.summary.dominant_wind_direction_deg + 180) * Math.PI) / 180),
    });
    const dtSeconds = PARTICLE_SECONDS_PER_FRAME;

    let last = performance.now();
    const sourcePositions = new Float32Array(MAX_PARTICLES * 3);
    const targetPositions = new Float32Array(MAX_PARTICLES * 3);
    // Deck.gl declares the line colour accessor as normalized `unorm8`, whose
    // external-buffer type is Uint8ClampedArray. Supplying anything else (even
    // Uint8Array) makes Deck log `Attribute instanceColors is normalized` and
    // hold the buffer twice as wide.
    const colours = new Uint8ClampedArray(MAX_PARTICLES * 4);

    const step = (now: number) => {
      frameRef.current = window.requestAnimationFrame(step);
      if (now - last < PARTICLE_FRAME_MS) return;
      last = now;

      const particles = particlesRef.current;
      for (let index = 0; index < particles.length; index += 1) {
        let particle = particles[index];
        const wind = sampler(particle.longitude, particle.latitude);
        particle = advanceParticle(particle, wind.u, wind.v, dtSeconds);
        const outside =
          particle.longitude < bbox.west ||
          particle.longitude > bbox.east ||
          particle.latitude < bbox.south ||
          particle.latitude > bbox.north ||
          particle.age > 1;
        if (outside) {
          particle = spawnParticle(bbox, randomRef.current);
          particle.age = 0;
        }
        particles[index] = particle;

        // Streak length encodes wind speed: the tail trails the head.
        const tailScale = PARTICLE_TAIL_FRAMES * dtSeconds;
        sourcePositions[index * 3] =
          particle.longitude - (wind.u * tailScale) / metresPerDegreeLon(particle.latitude);
        sourcePositions[index * 3 + 1] =
          particle.latitude - (wind.v * tailScale) / METRES_PER_DEGREE_LAT;
        sourcePositions[index * 3 + 2] = 0;
        targetPositions[index * 3] = particle.longitude;
        targetPositions[index * 3 + 1] = particle.latitude;
        targetPositions[index * 3 + 2] = 0;

        // Fade in on spawn and out on death so respawns do not pop.
        const fade = Math.min(Math.max(Math.min(particle.age, 1 - particle.age) * 6, 0), 1);
        colours[index * 4] = 196;
        colours[index * 4 + 1] = 224;
        colours[index * 4 + 2] = 255;
        colours[index * 4 + 3] = Math.round(52 + fade * 168);
      }

      const particleLayer = new LineLayer({
        id: 'wind-particles',
        data: {
          length: particles.length,
          attributes: {
            getSourcePosition: { value: sourcePositions.subarray(0), size: 3 },
            getTargetPosition: { value: targetPositions.subarray(0), size: 3 },
            getColor: { value: colours.subarray(0), size: 4 },
          },
        },
        pickable: false,
        widthUnits: 'pixels',
        getWidth: 1.35,
        widthMinPixels: 1,
        opacity: 0.9,
      });

      overlay.setProps({ layers: [...staticLayersRef.current, particleLayer] as never });
    };

    frameRef.current = window.requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [mapReady, windMode, data]);

  // ---- popover anchoring --------------------------------------------------
  useEffect(() => {
    if (!inspect || !mapRef.current) {
      setScreenPosition(null);
      return;
    }
    const map = mapRef.current;
    const update = () => {
      const point = map.project([inspect.longitude, inspect.latitude]);
      setScreenPosition({ x: point.x, y: point.y });
    };
    update();
    map.on('move', update);
    map.on('zoom', update);
    map.on('pitch', update);
    return () => {
      map.off('move', update);
      map.off('zoom', update);
      map.off('pitch', update);
    };
  }, [inspect, mapReady]);

  // ---- derived UI data ----------------------------------------------------
  const timeline = data?.timeline ?? [];
  const currentPoint = timeline[Math.min(hour, Math.max(timeline.length - 1, 0))];
  const inspected = inspect?.cell.properties ?? null;
  const inspectedWind = useMemo(() => {
    if (!data?.wind_field.features.length) return null;
    const sample = nearestCell(
      data.wind_field.features,
      inspect?.longitude ?? data.center[0],
      inspect?.latitude ?? data.center[1],
    );
    return sample
      ? { speed_ms: sample.properties.speed_ms, direction_deg: sample.properties.direction_deg }
      : null;
  }, [data, inspect]);

  const zoneRanking = useMemo(() => {
    if (!data) return [];
    return HIGH_RISK_ZONES.map((zone) => {
      const cell = nearestCell(data.pm25_field.features, zone.longitude, zone.latitude);
      return {
        zone,
        pm25: cell?.properties.pm25 ?? 0,
        aqi: cell?.properties.aqi_value ?? 0,
        category: cell?.properties.aqi_category ?? ('Good' as AqiCategory),
      };
    }).sort((a, b) => b.aqi - a.aqi);
  }, [data]);

  const inspectedDriver = useMemo(() => {
    if (!inspected) return null;
    return describeDriver(inspected, inspectedWind, {
      fires_used_in_model: data?.summary.fires_used_in_model,
      total_frp_mw: data?.summary.total_frp_mw,
    });
  }, [inspected, inspectedWind, data]);

  const sparkline = useMemo(() => {
    if (timeline.length < 2) return '';
    const width = 100;
    const height = 100;
    const peak = Math.max(...timeline.map((point) => point.max_pm25), 1);
    return timeline
      .map((point, index) => {
        const x = (index / (timeline.length - 1)) * width;
        const y = height - (point.mean_pm25 / peak) * height;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }, [timeline]);

  const sparkPeak = useMemo(
    () => Math.max(...timeline.map((point) => point.max_pm25), 1),
    [timeline],
  );

  const zoomToZone = useCallback((zone: RiskZone) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [zone.longitude, zone.latitude], zoom: 12.2, pitch: 55, duration: 900 });
    setInspect((current) => (current ? { ...current, zone } : current));
  }, []);

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height, ...SHELL_STYLE }}>
      <style>{MAP_CSS}</style>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* ---- header ---- */}
      <div className="aqi-panel aqi-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 15, letterSpacing: 0.2 }}>Delhi NCR · PM2.5 forecast</strong>
          <span style={{ opacity: 0.75, fontSize: 12 }}>
            {data ? `${data.provenance.forecast_hours} h horizon · ${data.provenance.meteorology_source} winds · ${BASEMAP_SOURCE} basemap` : 'connecting…'}
          </span>
        </div>
        {data ? (
          <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 12, flexWrap: 'wrap' }}>
            <Metric label="Mean" value={`${data.summary.mean_pm25_selected_hour.toFixed(0)} µg/m³`} />
            <Metric label="Peak" value={`${data.summary.peak_pm25_episode.toFixed(0)} µg/m³`} />
            <Metric label="PBL" value={`${Math.round(data.summary.pbl_min_m)}–${Math.round(data.summary.pbl_max_m)} m`} />
            <Metric label="Wind" value={`${data.summary.mean_wind_speed_ms.toFixed(1)} m/s ${compassLabel(data.summary.dominant_wind_direction_deg)}`} />
            <Metric
              label="Fires"
              value={`${data.summary.fires_used_in_model}/${data.summary.fire_detections}`}
              title={`${Math.round(data.summary.total_frp_mw)} MW FRP; ${data.summary.fires_out_of_domain} detections beyond model range`}
            />
          </div>
        ) : null}
        {data && !data.summary.cfl_stable ? (
          <div style={{ marginTop: 6, fontSize: 11, color: '#fca5a5' }}>
            CFL/Fourier limits exceeded — treat this frame with caution.
          </div>
        ) : null}
      </div>

      {/* ---- layer switches ---- */}
      <div className="aqi-panel aqi-controls">
        <Toggle active={view3d} onClick={() => setView3d(true)} label="3D grid" />
        <Toggle active={!view3d} onClick={() => setView3d(false)} label="2D heat" />
        <span style={DIVIDER_STYLE} />
        <Toggle active={windMode === 'particles'} onClick={() => setWindMode('particles')} label="Flow" />
        <Toggle active={windMode === 'arrows'} onClick={() => setWindMode('arrows')} label="Arrows" />
        <Toggle active={windMode === 'off'} onClick={() => setWindMode('off')} label="Off" />
        <span style={DIVIDER_STYLE} />
        <Toggle active={showZones} onClick={() => setShowZones((value) => !value)} label="Zones" />
        <Toggle active={showFires} onClick={() => setShowFires((value) => !value)} label="Fires" />
      </div>

      {/* ---- zone ranking ---- */}
      <div className="aqi-panel aqi-zones">
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.1, opacity: 0.6, marginBottom: 6 }}>
          High-risk zones
        </div>
        {zoneRanking.map(({ zone, pm25, aqi, category }) => (
          <button
            key={zone.id}
            type="button"
            className="aqi-zone-row"
            onClick={() => zoomToZone(zone)}
            title={zone.note}
          >
            <span style={{ width: 8, height: 8, borderRadius: 999, background: colourForCategory(category), boxShadow: `0 0 10px ${colourForCategory(category)}` }} />
            <span style={{ flex: 1, textAlign: 'left' }}>{zone.name}</span>
            <span style={{ opacity: 0.9 }}>{pm25.toFixed(0)}</span>
            <span style={{ opacity: 0.55, fontSize: 10, minWidth: 58, textAlign: 'right' }}>{category}</span>
            <span style={{ display: 'none' }}>{aqi}</span>
          </button>
        ))}
      </div>

      {/* ---- legend ---- */}
      <div className="aqi-panel aqi-legend">
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.1, opacity: 0.6, marginBottom: 6 }}>
          CPCB AQI
        </div>
        {CPCB_BANDS.map((band) => (
          <div key={band.category} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, lineHeight: '16px' }}>
            <span style={{ width: 12, height: 8, borderRadius: 2, background: band.colour }} />
            <span style={{ opacity: 0.85 }}>{band.category}</span>
            <span style={{ opacity: 0.45, marginLeft: 'auto' }}>
              {band.max >= 500 ? `${band.min}+` : `${band.min}–${band.max}`}
            </span>
          </div>
        ))}
      </div>

      {/* ---- zone labels ---- */}
      {showZones && data && mapReady
        ? HIGH_RISK_ZONES.map((zone) => {
            const point = mapRef.current?.project([zone.longitude, zone.latitude]);
            if (!point) return null;
            const zoneState = zoneRanking.find((entry) => entry.zone.id === zone.id);
            const colour = colourForCategory(zoneState?.category ?? 'Good');
            return (
              <div
                key={zone.id}
                className="aqi-zone-label"
                style={{ left: point.x, top: point.y, borderColor: colour, color: colour }}
              >
                {zone.name}
              </div>
            );
          })
        : null}

      {/* ---- inspector popover ---- */}
      {inspected && inspectedDriver && screenPosition ? (
        <div
          className="aqi-panel aqi-popover"
          style={{
            left: Math.min(Math.max(screenPosition.x, 150), (containerRef.current?.clientWidth ?? 800) - 150),
            top: screenPosition.y,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: 999, background: colourForCategory(inspected.aqi_category) }} />
            <strong style={{ fontSize: 12.5 }}>
              {inspect?.zone ? inspect.zone.name : `Grid cell ${inspected.row}·${inspected.col}`}
            </strong>
            <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.7 }}>{inspected.aqi_category}</span>
            <button type="button" className="aqi-close" onClick={() => setInspect(null)} aria-label="Close inspector">
              ×
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px' }}>
            <Readout label="PM2.5" value={`${inspected.pm25.toFixed(1)} µg/m³`} accent={colourForCategory(inspected.aqi_category)} />
            <Readout label="AQI sub-index" value={inspected.aqi_value.toFixed(0)} />
            <Readout label="Inversion index" value={inspected.inversion_strength_index.toFixed(3)} hint="T2m / T850 (<1 = surface inversion)" />
            <Readout label="PBL height" value={`${Math.round(inspected.pbl_height_m)} m`} />
            <Readout label="Wind" value={inspectedWind ? `${inspectedWind.speed_ms.toFixed(1)} m/s ${compassLabel(inspectedWind.direction_deg)}` : '—'} />
            <Readout label="Instant class" value={inspected.aqi_category_instant} />
          </div>

          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(148,163,184,0.18)' }}>
            <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 1, opacity: 0.55, marginBottom: 3 }}>
              Primary driver
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.35, color: DRIVER_COLOUR[inspectedDriver.tone] }}>
              {inspectedDriver.headline}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
              {inspectedDriver.factors.map((factor) => (
                <span key={factor} className="aqi-chip">
                  {factor}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* ---- time slider ---- */}
      <div className="aqi-panel aqi-timeline">
        <button
          type="button"
          className="aqi-play"
          onClick={() => setPlaying((value) => !value)}
          aria-label={playing ? 'Pause forecast animation' : 'Play forecast animation'}
        >
          {playing ? '❚❚' : '▶'}
        </button>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 11.5, marginBottom: 4 }}>
            <strong>
              {hour === 0 ? 'Now' : `+${hour} h`}
              {currentPoint ? ` · ${formatLocalTime(currentPoint.time_local)}` : ''}
            </strong>
            <span style={{ opacity: 0.7 }}>
              {currentPoint
                ? `mean ${currentPoint.mean_pm25.toFixed(0)} µg/m³ · peak ${currentPoint.max_pm25.toFixed(0)} · PBL ${Math.round(currentPoint.mean_pbl_m)} m`
                : ''}
            </span>
            <span style={{ marginLeft: 'auto', opacity: 0.7 }}>
              {currentPoint?.dominant_aqi_category ?? ''}
            </span>
          </div>

          <div style={{ position: 'relative', height: 34 }}>
            <svg
              viewBox={`0 0 100 100`}
              preserveAspectRatio="none"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5 }}
              aria-hidden
            >
              <path d={sparkline} fill="none" stroke="#93c5fd" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
              <line
                x1={(hour / Math.max(horizonHours - 1, 1)) * 100}
                x2={(hour / Math.max(horizonHours - 1, 1)) * 100}
                y1={0}
                y2={100}
                stroke="rgba(226,232,240,0.65)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <input
              type="range"
              min={0}
              max={horizonHours - 1}
              step={1}
              value={hour}
              onChange={(event) => setHour(Number(event.target.value))}
              className="aqi-range"
              aria-label="Forecast hour"
              aria-valuetext={currentPoint ? `plus ${hour} hours, ${formatLocalTime(currentPoint.time_local)}` : `plus ${hour} hours`}
            />
          </div>
        </div>

        <div className="aqi-scale">
          <span>0 h</span>
          <span>peak {sparkPeak.toFixed(0)} µg/m³</span>
          <span>+{horizonHours} h</span>
        </div>
      </div>

      {/* ---- status overlay ---- */}
      {status === 'loading' ? <div className="aqi-banner">Loading forecast…</div> : null}
      {status === 'error' ? (
        <div className="aqi-banner aqi-banner-error">
          <strong>Forecast unavailable.</strong>
          <span style={{ opacity: 0.85 }}>{errorMessage}</span>
          <button
            type="button"
            className="aqi-chip"
            onClick={() => {
              cacheRef.current.delete(hour);
              setReloadToken((token) => token + 1);
            }}
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------
function Metric({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span title={title} style={{ display: 'inline-flex', gap: 5, alignItems: 'baseline' }}>
      <span style={{ opacity: 0.55 }}>{label}</span>
      <strong style={{ fontWeight: 600 }}>{value}</strong>
    </span>
  );
}

function Toggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`aqi-toggle${active ? ' is-active' : ''}`}
    >
      {label}
    </button>
  );
}

function Readout({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string;
  accent?: string;
  hint?: string;
}) {
  return (
    <div title={hint}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.9, opacity: 0.5 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: accent ?? '#e2e8f0' }}>{value}</div>
    </div>
  );
}

function formatLocalTime(iso: string): string {
  const match = iso.match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]} IST` : iso;
}

const DRIVER_COLOUR: Record<DriverExplanation['tone'], string> = {
  clean: '#86efac',
  moderate: '#fde68a',
  severe: '#fca5a5',
};

const SHELL_STYLE = {
  minHeight: 520,
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  color: '#e2e8f0',
  borderRadius: 14,
  overflow: 'hidden',
  background: '#05070d',
  border: '1px solid rgba(148,163,184,0.16)',
} as const;

const DIVIDER_STYLE = { width: 1, height: 16, background: 'rgba(148,163,184,0.22)' } as const;

const MAP_CSS = `
.aqi-panel {
  position: absolute;
  z-index: 5;
  background: rgba(8, 12, 22, 0.82);
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 10px;
  padding: 10px 12px;
  backdrop-filter: blur(9px);
  box-shadow: 0 10px 30px rgba(2, 6, 16, 0.55);
  pointer-events: auto;
}
.aqi-header { top: 12px; left: 12px; max-width: min(560px, calc(100% - 120px)); }
.aqi-controls { top: 12px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 4px; padding: 6px 8px; }
.aqi-zones { top: 132px; left: 12px; width: 250px; }
.aqi-legend { top: 132px; right: 12px; width: 168px; }
.aqi-timeline { bottom: 12px; left: 12px; right: 12px; display: flex; align-items: center; gap: 12px; }
.aqi-popover {
  transform: translate(-50%, calc(-100% - 16px));
  width: 290px;
  transition: left 90ms linear, top 90ms linear;
}
.aqi-zone-row {
  display: flex; align-items: center; gap: 7px; width: 100%;
  background: none; border: 0; color: inherit; font: inherit; font-size: 11.5px;
  padding: 4px 4px; border-radius: 6px; cursor: pointer;
}
.aqi-zone-row:hover { background: rgba(148, 163, 184, 0.12); }
.aqi-zone-label {
  position: absolute; z-index: 4; transform: translate(-50%, -50%);
  font-size: 10px; letter-spacing: 0.3px; padding: 1px 5px; border-radius: 6px;
  background: rgba(5, 7, 13, 0.72); border: 1px solid; white-space: nowrap;
  pointer-events: none; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
}
.aqi-toggle {
  background: transparent; border: 1px solid transparent; color: #cbd5f5;
  font: inherit; font-size: 11.5px; padding: 4px 9px; border-radius: 7px; cursor: pointer;
}
.aqi-toggle:hover { background: rgba(148, 163, 184, 0.14); }
.aqi-toggle.is-active { background: rgba(96, 165, 250, 0.22); border-color: rgba(96, 165, 250, 0.5); color: #eff6ff; }
.aqi-chip {
  font-size: 10px; padding: 2px 7px; border-radius: 999px; cursor: default;
  background: rgba(148, 163, 184, 0.14); border: 1px solid rgba(148, 163, 184, 0.2);
  color: #dbeafe;
}
button.aqi-chip { cursor: pointer; }
.aqi-close {
  background: none; border: 0; color: #cbd5f5; font-size: 15px; line-height: 1;
  cursor: pointer; padding: 0 2px; opacity: 0.75;
}
.aqi-play {
  width: 34px; height: 34px; border-radius: 999px; cursor: pointer;
  background: rgba(96, 165, 250, 0.2); border: 1px solid rgba(96, 165, 250, 0.45);
  color: #eff6ff; font-size: 12px; flex: 0 0 auto;
}
.aqi-play:hover { background: rgba(96, 165, 250, 0.32); }
.aqi-scale { display: flex; flex-direction: column; gap: 3px; font-size: 10px; opacity: 0.6; text-align: right; min-width: 84px; }
.aqi-banner {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 8;
  display: flex; gap: 8px; align-items: center; padding: 11px 16px; font-size: 12.5px;
  background: rgba(8, 12, 22, 0.92); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 10px;
}
.aqi-banner-error { border-color: rgba(248, 113, 113, 0.45); color: #fecaca; }
input.aqi-range {
  position: absolute; inset: 0; width: 100%; height: 100%; margin: 0;
  background: transparent; -webkit-appearance: none; appearance: none; cursor: pointer;
}
input.aqi-range::-webkit-slider-runnable-track { height: 34px; background: transparent; }
input.aqi-range::-moz-range-track { height: 34px; background: transparent; }
input.aqi-range::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 3px; height: 34px;
  background: #e2e8f0; border-radius: 2px; box-shadow: 0 0 10px rgba(226, 232, 240, 0.65);
}
input.aqi-range::-moz-range-thumb {
  width: 3px; height: 34px; background: #e2e8f0; border: 0; border-radius: 2px;
}
input.aqi-range:focus-visible { outline: 2px solid rgba(96, 165, 250, 0.8); outline-offset: 3px; border-radius: 6px; }
@media (max-width: 860px) {
  .aqi-zones, .aqi-legend { display: none; }
  .aqi-header { max-width: calc(100% - 24px); }
  .aqi-controls { top: auto; bottom: 92px; left: 12px; right: 12px; transform: none; justify-content: center; flex-wrap: wrap; }
  .aqi-timeline { flex-wrap: wrap; }
  .aqi-popover { width: min(290px, calc(100% - 24px)); }
}
`;

export const AqiForecastMapCss = MAP_CSS;
