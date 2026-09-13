/**
 * Header-only ("no WebGL") test of components/AqiForecastMap.tsx.
 *
 * The component's DOM/WebGL paths need a browser, but everything that decides
 * what the user sees — CPCB banding, colour ramps, the primary-driver logic, the
 * wind sampler and the particle/arrow maths — is pure and is exported. This
 * harness compiles the real source with tsc, stubs only the rendering
 * dependencies (react, maplibre-gl, deck.gl) in the module cache, and asserts
 * the behaviour.
 *
 *   node tests/test_component_helpers.cjs
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(PROJECT_ROOT, '.tmp-verify');

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
      path.join('components', 'AqiForecastMap.tsx'),
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
  const emitted = path.join(OUT_DIR, 'AqiForecastMap.js');
  if (!fs.existsSync(emitted)) {
    throw new Error(`tsc did not emit ${emitted}`);
  }
  return emitted;
}

/** Replace rendering-only dependencies with inert stubs in require.cache. */
function stubRenderingDeps() {
  // Side-effect CSS imports (`import 'maplibre-gl/dist/maplibre-gl.css'`) survive
  // into the CommonJS output as require() calls. Node has no handler for `.css`,
  // so it falls back to the JS one and dies on the first selector. Teach it to
  // swallow stylesheets instead.
  require.extensions['.css'] = () => {};
  const stubs = {
    'maplibre-gl': {
      default: {
        Map: class {},
        NavigationControl: class {},
        ScaleControl: class {},
        GeolocateControl: class {},
      },
    },
    'maplibre-gl/dist/maplibre-gl.css': {},
    '@deck.gl/core': {},
    '@deck.gl/layers': { LineLayer: class {}, PolygonLayer: class {}, ScatterplotLayer: class {} },
    '@deck.gl/aggregation-layers': { GridLayer: class {}, HeatmapLayer: class {} },
    '@deck.gl/mapbox': { MapboxOverlay: class {} },
    react: {
      useState: () => [null, () => {}],
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
      continue; // optional peer dependency: nothing to stub
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
    advanceParticle,
    arrowPolygon,
    buildWindSampler,
    categoryForAqi,
    colourForAqi,
    basemapStyleFor,
    colourForCategory,
    compassLabel,
    describeDriver,
    hexToRgb,
    nearestCell,
    spawnParticle,
    AQI_COLOUR_RANGE,
    CPCB_BANDS,
  } = helpers;

  // ---- basemap selection -------------------------------------------------
  // Regression guard: CARTO serves an "API KEY REQUIRED" watermark on tiles
  // without a key, so the CARTO tile URLs must never be reached key-free.
  const keyFree = basemapStyleFor(undefined);
  check('key-free basemap is a style URL', typeof keyFree === 'string', String(keyFree));
  check('key-free basemap avoids CARTO', !String(keyFree).includes('cartocdn'), String(keyFree));
  check('key-free basemap is the OpenFreeMap dark style', String(keyFree) === 'https://tiles.openfreemap.org/styles/dark', String(keyFree));
  check('blank key is treated as no key', basemapStyleFor('   ') === keyFree);

  const keyed = basemapStyleFor('abc123');
  check('keyed basemap is an inline style', typeof keyed === 'object' && keyed !== null);
  const keyedSource = keyed.sources['carto-dark'];
  check('keyed basemap uses CARTO Dark Matter', Array.isArray(keyedSource.tiles) && keyedSource.tiles.length === 3, JSON.stringify(keyedSource.tiles));
  check('every CARTO tile carries the key', keyedSource.tiles.every((url) => /\?key=abc123$/.test(url)), JSON.stringify(keyedSource.tiles));
  check('CARTO key is URL-encoded', String(basemapStyleFor('a b&c').sources['carto-dark'].tiles[0]).includes('key=a%20b%26c'), String(basemapStyleFor('a b&c').sources['carto-dark'].tiles[0]));
  check('CARTO style keeps OSM and CARTO attribution', /openstreetmap\.org/.test(keyedSource.attribution) && /carto\.com/.test(keyedSource.attribution), keyedSource.attribution);
  check('CARTO style has an opaque dark background', keyed.layers[0].paint['background-color'] === '#05070d', JSON.stringify(keyed.layers[0].paint));

  // ---- CPCB banding at every boundary ------------------------------------
  const bands = [
    [0, 'Good'],
    [50, 'Good'],
    [51, 'Satisfactory'],
    [100, 'Satisfactory'],
    [101, 'Moderate'],
    [200, 'Moderate'],
    [201, 'Poor'],
    [300, 'Poor'],
    [301, 'Very Poor'],
    [400, 'Very Poor'],
    [401, 'Severe'],
    [500, 'Severe'],
    [1200, 'Severe'],
  ];
  for (const [value, expected] of bands) {
    check(`band ${value} -> ${expected}`, categoryForAqi(value) === expected, categoryForAqi(value));
  }
  check('six CPCB bands defined', CPCB_BANDS.length === 6, String(CPCB_BANDS.length));
  check('band bounds are contiguous', CPCB_BANDS.every((band, index) => index === 0 || band.min === CPCB_BANDS[index - 1].max + 1));
  check('colour ramp has one entry per band plus one', AQI_COLOUR_RANGE.length === 7, String(AQI_COLOUR_RANGE.length));
  check('ramp alphas are opaque enough', AQI_COLOUR_RANGE.every((entry) => entry[3] >= 230));

  // ---- colours -----------------------------------------------------------
  check('hex parse', JSON.stringify(hexToRgb('#22c55e')) === JSON.stringify([34, 197, 94, 255]), JSON.stringify(hexToRgb('#22c55e')));
  check('band colour lookup', colourForCategory('Very Poor') === '#ef4444', colourForCategory('Very Poor'));
  check('aqi colour follows the band', JSON.stringify(colourForAqi(305)) === JSON.stringify([239, 68, 68, 255]), JSON.stringify(colourForAqi(305)));
  check('unknown category falls back', colourForCategory('Nope') === '#94a3b8', colourForCategory('Nope'));

  // ---- compass -----------------------------------------------------------
  const compass = [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'], [314, 'NW'], [360, 'N'], [350, 'N']];
  for (const [degrees, expected] of compass) {
    check(`compass ${degrees} -> ${expected}`, compassLabel(degrees) === expected, compassLabel(degrees));
  }

  // ---- primary driver ----------------------------------------------------
  const trapped = describeDriver(
    { pm25: 420, aqi_value: 430, pbl_height_m: 180, inversion_strength_index: 0.977, stubble_emission_ug_m2_s: 0.12, pbl_suppression_fraction: 0.22, aloft_column_mass_ug_m2: 820 },
    { speed_ms: 1.4, direction_deg: 314 },
  );
  check('trapped case names stubble smoke', /trapped stubble smoke/i.test(trapped.headline), trapped.headline);
  check('trapped case mentions the PBL depth', /180 m/.test(trapped.headline), trapped.headline);
  check('trapped case is flagged severe', trapped.tone === 'severe', trapped.tone);
  check('factors list the inversion', trapped.factors.some((f) => /inversion T2m\/T850 = 0\.977/i.test(f)), JSON.stringify(trapped.factors));
  check('factors list suppression', trapped.factors.some((f) => /suppression 22%/i.test(f)));
  check('factors list the lofted reservoir', trapped.factors.some((f) => /820/.test(f)));
  check('factors list local burning', trapped.factors.some((f) => /Local residue burning 0\.12/.test(f)));

  const clean = describeDriver(
    { pm25: 12, aqi_value: 24, pbl_height_m: 1600, inversion_strength_index: 1.004, stubble_emission_ug_m2_s: 0, pbl_suppression_fraction: 0, aloft_column_mass_ug_m2: 0 },
    { speed_ms: 6.5, direction_deg: 120 },
  );
  check('clean case is ventilated', /ventilated/i.test(clean.headline), clean.headline);
  check('clean case tone', clean.tone === 'clean', clean.tone);
  check('clean case has no burning chip', !clean.factors.some((f) => /burning/i.test(f)), JSON.stringify(clean.factors));

  const advected = describeDriver(
    { pm25: 310, aqi_value: 330, pbl_height_m: 900, inversion_strength_index: 1.002, stubble_emission_ug_m2_s: 0, pbl_suppression_fraction: 0.1, aloft_column_mass_ug_m2: 120 },
    { speed_ms: 5.1, direction_deg: 314 },
  );
  check('severe + windy points at regional transport', /advected in on NW/i.test(advected.headline), advected.headline);

  const calmShallow = describeDriver(
    { pm25: 260, aqi_value: 275, pbl_height_m: 260, inversion_strength_index: 0.98, stubble_emission_ug_m2_s: 0, pbl_suppression_fraction: 0.05, aloft_column_mass_ug_m2: 0 },
    { speed_ms: 1.1, direction_deg: 40 },
  );
  check('shallow + calm is trapped pollution', /trapped pollution/i.test(calmShallow.headline), calmShallow.headline);
  check('no-wind call is handled', describeDriver({ pm25: 90, aqi_value: 150, pbl_height_m: 700, inversion_strength_index: 1, stubble_emission_ug_m2_s: 0, pbl_suppression_fraction: 0, aloft_column_mass_ug_m2: 0 }, null).headline.length > 0);

  // ---- nearest cell ------------------------------------------------------
  const cells = [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [77.0, 28.5] }, properties: { row: 0, col: 0, pm25: 10 } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [77.4, 28.8] }, properties: { row: 1, col: 1, pm25: 90 } },
  ];
  check('nearest cell picks the close one', nearestCell(cells, 77.02, 28.51).properties.pm25 === 10);
  check('nearest cell picks the far one', nearestCell(cells, 77.45, 28.79).properties.pm25 === 90);
  check('empty input yields null', nearestCell([], 77, 28) === null);

  // ---- wind sampler ------------------------------------------------------
  const uniform = buildWindSampler([
    { type: 'Feature', geometry: { type: 'Point', coordinates: [76.8, 28.2] }, properties: { row: 0, col: 0, u_ms: 3, v_ms: -2, speed_ms: 3.6, direction_deg: 304, bearing_deg: 124 } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [77.5, 28.9] }, properties: { row: 49, col: 49, u_ms: 3, v_ms: -2, speed_ms: 3.6, direction_deg: 304, bearing_deg: 124 } },
  ]);
  check('uniform wind is uniform', JSON.stringify(uniform(77.1, 28.4)) === JSON.stringify({ u: 3, v: -2 }), JSON.stringify(uniform(77.1, 28.4)));

  const corners = buildWindSampler([
    { type: 'Feature', geometry: { type: 'Point', coordinates: [76.8, 28.2] }, properties: { row: 0, col: 0, u_ms: 1, v_ms: 0, speed_ms: 1, direction_deg: 270, bearing_deg: 90 } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [77.5, 28.2] }, properties: { row: 0, col: 49, u_ms: 2, v_ms: 0, speed_ms: 2, direction_deg: 270, bearing_deg: 90 } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [76.8, 28.9] }, properties: { row: 49, col: 0, u_ms: 4, v_ms: 0, speed_ms: 4, direction_deg: 270, bearing_deg: 90 } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [77.5, 28.9] }, properties: { row: 49, col: 49, u_ms: 8, v_ms: 0, speed_ms: 8, direction_deg: 270, bearing_deg: 90 } },
  ]);
  check('sampler SW corner', corners(76.85, 28.25).u === 1, String(corners(76.85, 28.25).u));
  check('sampler SE corner', corners(77.45, 28.25).u === 2, String(corners(77.45, 28.25).u));
  check('sampler NW corner', corners(76.85, 28.85).u === 4, String(corners(76.85, 28.85).u));
  check('sampler NE corner', corners(77.45, 28.85).u === 8, String(corners(77.45, 28.85).u));
  check('sampler honours a partial lattice', buildWindSampler([
    { type: 'Feature', geometry: { type: 'Point', coordinates: [76.8, 28.2] }, properties: { row: 0, col: 0, u_ms: 1, v_ms: 0, speed_ms: 1, direction_deg: 270, bearing_deg: 90 } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [76.8, 28.54] }, properties: { row: 24, col: 0, u_ms: 7, v_ms: 0, speed_ms: 7, direction_deg: 270, bearing_deg: 90 } },
  ])(76.85, 28.88).u === 7, 'a query beyond the lattice snaps to the last sample');
  check('empty wind falls back', JSON.stringify(buildWindSampler([], { u: 9, v: 9 })(77, 28)) === JSON.stringify({ u: 9, v: 9 }));

  // ---- particle maths ----------------------------------------------------
  const bbox = { west: 76.8, south: 28.2, east: 77.5, north: 28.9 };
  const seeded = spawnParticle(bbox, () => 0.5);
  check('spawn lands inside the bbox', seeded.longitude > bbox.west && seeded.longitude < bbox.east && seeded.latitude > bbox.south && seeded.latitude < bbox.north, JSON.stringify(seeded));
  check('spawn age is staggered', spawnParticle(bbox, () => 0.25).age === 0.25);

  const started = { longitude: 77.0, latitude: 28.6, age: 0 };
  const moved = advanceParticle(started, 10, 0, 200, 0.01);
  const metresPerDegreeLon = 111320 * Math.cos((28.6 * Math.PI) / 180);
  check('eastward wind moves the particle east', moved.longitude > started.longitude);
  check('advection step matches the wind', close(moved.longitude - started.longitude, (10 * 200) / metresPerDegreeLon, 1e-9), String(moved.longitude - started.longitude));
  check('no meridional drift', close(moved.latitude, started.latitude, 1e-12));
  check('age advances by the frame step', close(moved.age, 0.01, 1e-12));
  const northward = advanceParticle(started, 0, 5, 200, 0.01);
  check('northward wind moves the particle north', northward.latitude > started.latitude);
  check('north step uses the meridional scale', close(northward.latitude - started.latitude, (5 * 200) / 110574, 1e-9), String(northward.latitude - started.latitude));

  // ---- arrow geometry ----------------------------------------------------
  // Assert in the isotropic frame the renderer actually shows, x = longitude *
  // cos(latitude) and y = latitude. Which barb is "left" is an arbitrary sign
  // convention, so the straddle checks are polarity-agnostic and the real
  // invariants (bearing fidelity, perpendicular splay, constant apparent length)
  // are asserted explicitly.
  const ASPECT = Math.cos((28.6 * Math.PI) / 180);
  const screen = ([lon, lat]) => [(lon - 77.2) * ASPECT, lat - 28.6];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const len = (v) => Math.hypot(v[0], v[1]);

  const east = arrowPolygon(77.2, 28.6, 90, 0.02);
  check('arrow has a tip and two barbs', east.length === 3);
  check('east arrow points east', east[0][0] > 77.2 && close(east[0][1], 28.6, 1e-9), JSON.stringify(east[0]));
  check('east arrow barbs trail behind', east[1][0] < 77.2 && east[2][0] < 77.2);
  check('east arrow barbs straddle the axis', (east[1][1] - 28.6) * (east[2][1] - 28.6) < 0, JSON.stringify([east[1], east[2]]));
  check('east arrow is symmetric', close(east[1][0], east[2][0], 1e-12));

  const north = arrowPolygon(77.2, 28.6, 0, 0.02);
  check('north arrow points north', north[0][1] > 28.6 && close(north[0][0], 77.2, 1e-9), JSON.stringify(north[0]));
  check('north arrow barbs straddle the axis', (north[1][0] - 77.2) * (north[2][0] - 77.2) < 0, JSON.stringify([north[1], north[2]]));
  const longer = arrowPolygon(77.2, 28.6, 90, 0.05);
  check('arrow size scales', longer[0][0] > east[0][0]);

  for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
    const [tip, left, right] = arrowPolygon(77.2, 28.6, bearing, 0.02);
    const shaft = screen(tip);
    const barbAxis = sub(screen(left), screen(right));
    const barbMid = [(screen(left)[0] + screen(right)[0]) / 2, (screen(left)[1] + screen(right)[1]) / 2];
    const actual = (((Math.atan2(shaft[1], shaft[0]) * 180) / Math.PI) + 360) % 360;
    const expected = ((90 - bearing) + 360) % 360;
    const angularError = Math.abs(((actual - expected + 540) % 360) - 180);
    check(`bearing ${bearing} points where it should`, angularError < 1e-9, `off by ${angularError.toExponential(2)} deg`);
    check(`bearing ${bearing} keeps its apparent length`, close(len(shaft), 0.02, 1e-12), String(len(shaft)));
    check(`bearing ${bearing} is symmetric about the shaft`, close(len(screen(left)), len(screen(right)), 1e-12));
    check(`bearing ${bearing} splays perpendicular to the shaft`, close(dot(barbAxis, shaft), 0, 1e-15), String(dot(barbAxis, shaft)));
    check(`bearing ${bearing} splays behind the tip`, dot(barbMid, shaft) < 0);
  }

  console.log(`\n${checks - failures.length}/${checks} component helper checks passed`);
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
