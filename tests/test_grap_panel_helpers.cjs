/**
 * Header-only ("no browser") test of components/GrapSimulator.tsx.
 *
 * The panel's DOM and its fetch need a browser, but every decision it makes
 * about what to draw -- GRAP banding, chart scaling, path construction, the
 * averted-area polygon, lever keys, exposure strips -- is a pure exported
 * function. This harness compiles the real source with tsc, stubs only React in
 * the module cache, and asserts those functions.
 *
 * The stage thresholds asserted here must stay identical to services/grap.py;
 * tests/test_router_contract.py parses this file's table and compares it against
 * the Python schedule, so the two cannot drift apart silently.
 *
 *   node tests/test_grap_panel_helpers.cjs
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(PROJECT_ROOT, '.tmp-verify-grap');

function compile() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  // Run TypeScript's Node entry point directly: spawning npx/npx.cmd throws
  // EINVAL on Node >= 20.12 without a shell.
  const tscMain = path.join(PROJECT_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!fs.existsSync(tscMain)) {
    throw new Error('typescript is not installed; run `npm install` first');
  }
  execFileSync(
    process.execPath,
    [
      tscMain,
      path.join('components', 'GrapSimulator.tsx'),
      '--outDir',
      OUT_DIR,
      '--module',
      'commonjs',
      '--target',
      'ES2022',
      '--moduleResolution',
      'node',
      '--jsx',
      'react-jsx',
      '--esModuleInterop',
      '--skipLibCheck',
    ],
    { cwd: PROJECT_ROOT, stdio: 'inherit' },
  );
  const emitted = path.join(OUT_DIR, 'GrapSimulator.js');
  if (!fs.existsSync(emitted)) {
    throw new Error(`tsc did not emit ${emitted}`);
  }
  return emitted;
}

/** Replace React with inert hooks so the module can be require()d. */
function stubRenderingDeps() {
  require.extensions['.css'] = () => {};
  const stubs = {
    react: {
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect: () => {},
      useCallback: (fn) => fn,
      useMemo: (fn) => fn(),
      useRef: (value) => ({ current: value }),
    },
    'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: {} },
  };
  for (const [specifier, exports] of Object.entries(stubs)) {
    let resolved;
    try {
      resolved = require.resolve(specifier, { paths: [PROJECT_ROOT] });
    } catch {
      continue;
    }
    require.cache[resolved] = {
      id: resolved,
      filename: resolved,
      loaded: true,
      exports,
      children: [],
      paths: [],
    };
  }
}

const failures = [];
let checks = 0;

function check(label, condition, detail = '') {
  checks += 1;
  if (!condition) {
    failures.push(label);
    console.log(`[FAIL] ${label}${detail ? ' -> ' + detail : ''}`);
  } else {
    console.log(`[PASS] ${label}${detail ? ' -> ' + detail : ''}`);
  }
}

function close(a, b, tolerance = 1e-9) {
  return Math.abs(a - b) <= tolerance;
}

function run() {
  const emitted = compile();
  stubRenderingDeps();
  const helpers = require(emitted.replace(/\\/g, path.sep));
  const {
    avertedAreaPath,
    chartScale,
    formatSigned,
    grapStageForAqi,
    gridValues,
    interventionKey,
    linePath,
    peakIndexWithin,
    peakWithin,
    stageChangedLabel,
    stageExposure,
    stageMeta,
    stageShort,
    GRAP_STAGE_META,
    GRAP_THRESHOLD_LINES,
    STUBBLE_OPTIONS,
    TRUCK_OPTIONS,
  } = helpers;

  // ---- GRAP banding -------------------------------------------------------
  // These boundaries are duplicated in services/grap.py; the router contract
  // test reconciles the two tables, and this asserts the behaviour.
  const bands = [
    [-5, 0],
    [0, 0],
    [120, 0],
    [200, 0],
    [200.4, 0],
    [200.5, 1], // rounds up to the published 201
    [201, 1],
    [250, 1],
    [300, 1],
    [300.4, 1],
    [300.5, 2],
    [301, 2],
    [400, 2],
    [400.4, 2],
    [400.5, 3],
    [401, 3],
    [450, 3],
    [450.4, 3],
    [450.5, 4], // rounds up to the published 451
    [451, 4],
    [500, 4],
    [5000, 4], // above the scale must cap, not wrap
  ];
  for (const [aqi, expected] of bands) {
    check(`AQI ${aqi} -> stage ${expected}`, grapStageForAqi(aqi) === expected, String(grapStageForAqi(aqi)));
  }
  check('NaN maps to no stage', grapStageForAqi(Number.NaN) === 0);
  check('Infinity maps to no stage', grapStageForAqi(Infinity) === 0);

  // The schedule must be contiguous and ordered: no gap between one stage's top
  // and the next stage's floor, and the floors must increase.
  check('five stage rows', GRAP_STAGE_META.length === 5, String(GRAP_STAGE_META.length));
  for (let index = 1; index < GRAP_STAGE_META.length; index += 1) {
    check(
      `stage ${index} floor above stage ${index - 1}`,
      GRAP_STAGE_META[index].aqiMin > GRAP_STAGE_META[index - 1].aqiMin,
      `${GRAP_STAGE_META[index - 1].aqiMin} -> ${GRAP_STAGE_META[index].aqiMin}`,
    );
    // One AQI either side of the floor must land in different stages, which is
    // what "contiguous" actually means.
    const floor = GRAP_STAGE_META[index].aqiMin;
    check(
      `stage ${index} boundary is a hard edge`,
      grapStageForAqi(floor) === index && grapStageForAqi(floor - 1) === index - 1,
      `${floor - 1}=>${grapStageForAqi(floor - 1)} ${floor}=>${grapStageForAqi(floor)}`,
    );
  }
  check('every stage has its own colour', new Set(GRAP_STAGE_META.map((s) => s.colour)).size === 5);
  check('stageShort of none', stageShort(0) === 'none', stageShort(0));
  check('stageShort of III', stageShort(3) === 'III', stageShort(3));
  check('stageMeta clamps out-of-range input', stageMeta(9).stage === 4 && stageMeta(-3).stage === 0);
  check('threshold guides cover stages I-IV', GRAP_THRESHOLD_LINES.length === 4);
  check(
    'threshold guides sit on the stage floors',
    GRAP_THRESHOLD_LINES.every((line, index) => line.aqi === GRAP_STAGE_META[index + 1].aqiMin),
    JSON.stringify(GRAP_THRESHOLD_LINES.map((l) => l.aqi)),
  );

  // ---- lever options ------------------------------------------------------
  check('three stubble options', STUBBLE_OPTIONS.length === 3);
  check('three truck options', TRUCK_OPTIONS.length === 3);
  check(
    'stubble options are 0/50/80 percent',
    STUBBLE_OPTIONS.map((o) => o.value * 100).join(',') === '0,50,80',
    STUBBLE_OPTIONS.map((o) => o.label).join(' '),
  );
  check(
    'truck options are the three documented modes',
    TRUCK_OPTIONS.map((o) => o.value).join(',') === 'off,bs4_banned,all_halted',
  );

  // ---- peaks --------------------------------------------------------------
  const series = [10, 90, 40, 70, 20];
  check('peak over a partial window', peakWithin(series, 2) === 90, String(peakWithin(series, 2)));
  check('peak over the whole series', peakWithin(series, 99) === 90, String(peakWithin(series, 99)));
  check('peak window clamps to at least one hour', peakWithin(series, 0) === 10, String(peakWithin(series, 0)));
  check('peak of an empty series is zero', peakWithin([], 12) === 0);
  check('peak ignores non-finite values', peakWithin([NaN, 5, Infinity], 3) === 5);
  check('argmax within the window', peakIndexWithin(series, 2) === 1, String(peakIndexWithin(series, 2)));
  check('argmax beyond the window stays outside it', peakIndexWithin(series, 3) === 1);
  check('argmax of a late peak', peakIndexWithin([1, 2, 3, 99, 4], 5) === 3);

  // ---- chart scaling ------------------------------------------------------
  const geometry = { width: 400, height: 200, padding: { top: 10, right: 10, bottom: 20, left: 30 } };
  const scale = chartScale([series, [12, 80, 50, 60, 30]]);
  check('scale covers the data', scale.min <= 10 && scale.max >= 90, JSON.stringify(scale));
  check('scale ceiling is above the maximum', scale.ceiling >= scale.max);

  // A flat series -- a scenario that changes nothing -- must not collapse the axis.
  const flat = chartScale([[42, 42, 42]], 40);
  check('flat series keeps a usable range', flat.max - flat.min >= 40, JSON.stringify(flat));
  check('flat series stays non-negative', flat.min >= 0, String(flat.min));
  const empty = chartScale([[], []]);
  check('empty input yields a valid scale', empty.max > empty.min, JSON.stringify(empty));

  // ---- line paths ---------------------------------------------------------
  const seriesPath = linePath(series, scale, geometry);
  check('path starts with a move', seriesPath.startsWith('M'), seriesPath.slice(0, 12));
  check(
    'path has one segment per subsequent point',
    (seriesPath.match(/L/g) || []).length === series.length - 1,
    seriesPath,
  );
  const coords = seriesPath.split(/[ML]/).filter(Boolean).map((pair) => pair.split(',').map(Number));
  check('every path coordinate is finite', coords.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
  check('path x increases monotonically', coords.every((point, index) => index === 0 || point[0] > coords[index - 1][0]));
  check('path stays inside the viewport', coords.every(([x, y]) => x >= 0 && x <= geometry.width && y >= 0 && y <= geometry.height));
  const maxY = coords[1][1];
  const minY = coords[0][1];
  check('a larger value draws higher on the chart', maxY < minY, `${maxY} vs ${minY}`);
  check('an empty series yields no path', linePath([], scale, geometry) === '');

  // Values outside the axis range must clamp rather than escape the viewport.
  const clamped = linePath([-1000, 100000], scale, geometry);
  const clampedCoords = clamped.split(/[ML]/).filter(Boolean).map((pair) => pair.split(',').map(Number));
  check(
    'out-of-range values clamp into the viewport',
    clampedCoords.every(([x, y]) => y >= 0 && y <= geometry.height),
    JSON.stringify(clampedCoords),
  );

  // ---- averted area -------------------------------------------------------
  const upper = [100, 100, 100];
  const lower = [50, 30, 60];
  const area = avertedAreaPath(upper, lower, scale, geometry);
  check('averted area is a closed polygon', area.trim().endsWith('Z'), area.slice(-6));
  const areaCoords = area.replace(/Z$/, '').split(/[ML]/).filter(Boolean).map((p) => p.split(',').map(Number));
  check('averted area visits both curves', areaCoords.length === 6, String(areaCoords.length));
  check(
    'averted area traces the upper curve first',
    areaCoords.slice(0, 3).every(([, y]) => close(y, areaCoords[0][1])),
  );
  check(
    'the filled band sits between the curves',
    areaCoords.slice(0, 3).every((point, index) => point[1] < areaCoords[areaCoords.length - 1 - index][1]),
    JSON.stringify(areaCoords),
  );
  check('averted area with no overlap is empty', avertedAreaPath([], [], scale, geometry) === '');
  // Mismatched lengths must be truncated, not produce NaN.
  const ragged = avertedAreaPath([10, 20, 30], [5], scale, geometry);
  check(
    'averted area truncates to the shorter curve',
    (ragged.match(/L/g) || []).length === 1 && !ragged.includes('NaN'),
    ragged,
  );

  // ---- grid ---------------------------------------------------------------
  const grid = gridValues(scale, 4);
  check('five gridlines for four intervals', grid.length === 5, String(grid.length));
  check('gridlines span the axis', close(grid[0], scale.min) && close(grid[4], scale.max));
  check('gridlines are evenly spaced', close(grid[1] - grid[0], grid[2] - grid[1], 1e-9));

  // ---- intervention keys --------------------------------------------------
  const base = { stubbleReduction: 0, truckRestriction: 'off', oddEven: false };
  const keys = new Set();
  for (const stubbleReduction of [0, 0.5, 0.8]) {
    for (const truckRestriction of ['off', 'bs4_banned', 'all_halted']) {
      for (const oddEven of [false, true]) {
        keys.add(interventionKey({ stubbleReduction, truckRestriction, oddEven }));
      }
    }
  }
  check('all 18 lever combinations have distinct keys', keys.size === 18, String(keys.size));
  check('key is stable for the same selection', interventionKey(base) === interventionKey({ ...base }));
  check(
    'key changes when each lever moves',
    interventionKey(base) !== interventionKey({ ...base, stubbleReduction: 0.5 }) &&
      interventionKey(base) !== interventionKey({ ...base, truckRestriction: 'bs4_banned' }) &&
      interventionKey(base) !== interventionKey({ ...base, oddEven: true }),
  );

  // ---- presentation -------------------------------------------------------
  check('formatSigned marks a fall', formatSigned(-9.3) === '−9.3', formatSigned(-9.3));
  check('formatSigned marks a rise', formatSigned(4) === '+4.0', formatSigned(4));
  check('formatSigned collapses a zero', formatSigned(0.01) === '0.0', formatSigned(0.01));
  check('formatSigned survives a non-finite value', formatSigned(Number.NaN) === '—');

  check('no stage change reported', stageChangedLabel({ stage_change: 0, avoids_stage: null }) === 'No stage change');
  check(
    'a stage change names the stage avoided',
    stageChangedLabel({ stage_change: 2, avoids_stage: 'GRAP Stage IV (Severe+)' }) === 'Avoids GRAP Stage IV (Severe+)',
  );
  check('a missing summary is safe', stageChangedLabel(undefined) === '');
  check(
    'a stage change without a named stage still reads',
    stageChangedLabel({ stage_change: 1, avoids_stage: null }) === 'Avoids a higher stage',
  );

  // First eight hours in window: stages 0,1,2,3 once each and 4 four times.
  const exposure = stageExposure([0, 1, 2, 3, 4, 4, 4, 4, 0, 0], 8);
  check('exposure sums to the window', exposure.reduce((total, e) => total + e.hours, 0) === 8, JSON.stringify(exposure));
  check('exposure is ordered worst stage first', exposure[0].stage === 4, JSON.stringify(exposure));
  check('exposure counts each stage', exposure.find((e) => e.stage === 4).hours === 4, JSON.stringify(exposure));
  check(
    'exposure ignores hours past the window',
    exposure.find((e) => e.stage === 0).hours === 1,
    JSON.stringify(exposure),
  );
  check('exposure of an empty sequence is empty', stageExposure([], 48).length === 0);
  check('exposure clamps the window to the sequence', stageExposure([1, 1], 48).reduce((t, e) => t + e.hours, 0) === 2);

  console.log(`\n${checks - failures.length}/${checks} GRAP panel helper checks passed`);
  if (failures.length) {
    console.log(`failed: ${failures.join(', ')}`);
    process.exitCode = 1;
  }
}

try {
  run();
} finally {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
}
