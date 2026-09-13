# Air-Pollution-Weather-Coupled-Forecasting-System
### Delhi NCR · 72-hour PM2.5 forecast & GRAP what-if simulator

Traditional Air Quality Index (AQI) forecasting models typically treat meteorology and pollution dispersion as separate entities. However, in highly polluted urban landscapes like Delhi NCR, there is a critical, dynamic feedback loop between the weather and pollutants.

A coupled aerosol–meteorology forecast for the Delhi National Capital Region, a
dashboard to explore it, and a what-if simulator that grades intervention
scenarios against India's Graded Response Action Plan.

The point of the project is not just to predict a number. It is to answer the
question a regulator actually asks — *"if we cut stubble burning by 80% and ban
BS-IV goods vehicles, how much of the peak do we avert, and does it change the
GRAP stage?"* — quickly enough to be worth asking, and with the model's own
error reported alongside every answer.

## How it fits together

```
engine/coupled_model.py   NumPy/SciPy forecast model (the physics)
engine/surrogate.py       Reduced-order model: milliseconds instead of seconds
services/ingest.py        Open-Meteo + NASA FIRMS clients (with offline fallback)
services/grap.py          GRAP schedule, lever attribution, scenario evaluation
routers/forecast.py       FastAPI routes + Pydantic response models
components/               MapLibre GL + Deck.gl dashboard (Next.js 15)
```

**The model** advances a 50 × 50 grid over 28.2–28.9 °N, 76.8–77.5 °E for 72 hours:
upwind finite-difference advection with the CFL condition checked and sub-stepped,
turbulent diffusion, crop-residue plume injection from detected fires scaled by Fire
Radiative Power, and a two-way aerosol feedback in which the accumulating PM2.5
suppresses the planetary boundary layer (up to 40% of the synoptic value above
250 µg/m³) which in turn compresses ground-level concentrations. It returns hourly
grids of PM2.5, PBL height, an inversion strength index and an AQI category.

**The surrogate** is a tangent-linear reduction of that model, identified from a full
run, used by the what-if simulator so a lever can be re-evaluated in milliseconds.
Its accuracy against the run it came from is measured and reported in the response,
not assumed.

## Quickstart

Two processes. The dashboard proxies `/api/*` to the API, so both must run.

```bash
npm install
pip install -r requirements.txt

# terminal 1 — forecast API on :8000
python main.py

# terminal 2 — dashboard on :3000
npm run dev -- -p 3000
```

Then open <http://localhost:3000>. Interactive API docs are at
<http://localhost:8000/docs>.

The API binds `0.0.0.0:8000` by default. Pass the port explicitly: both `uvicorn` and
`next dev` honour a `PORT` environment variable, so an inherited `PORT=0` will send
them to a random port.

No configuration is required. With no API key present the service runs on synthetic
meteorology and a synthetic fire inventory, and says so in every response's
`provenance.notes`.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/forecast/72h` | Map layers (fires, grid field, wind vectors), a 72-point timeline and dashboard metrics |
| `POST /api/forecast/interventions` | Grade a what-if scenario against GRAP; returns baseline vs. mitigated curves |
| `GET /api/forecast/status` | Upstream configuration and cache state, without running a model |
| `GET /health` | Liveness probe |

`/72h` accepts `hours`, `hour` (which forecast hour to render as a field layer),
`stride` and `min_pm25` (payload controls), plus the model inputs `inflow_pm25`,
`frp_scale`, `initial_background`, `initial_urban_increment` and `urban_emission`.
`offline=true` skips the network; `refresh=true` evicts both caches.

The baseline curve returned by `/interventions` shares its fingerprint-keyed model
inputs with `/72h`, so the two endpoints describe the same forecast rather than
offering two opinions. Scenarios are the JSON body:

```json
{ "stubble_reduction": 0.8, "truck_restriction": "bs4_banned", "odd_even": true }
```

`truck_restriction` is one of `off`, `bs4_banned`, `all_halted`.

## The GRAP what-if simulator

The dashboard panel evaluates the three levers CAQM's schedule actually reaches for —
crop-residue burning, goods-vehicle entry, and an odd-even scheme — and reports the
**averted pollution peak** (the two curves over the next 48 hours), the expected drop
in maximum AQI, and the resulting GRAP stage, with the actions that stage puts in
force. It also advises *pre-emptive* escalation when the forecast comes within a
defined margin of the next threshold while the meteorology stays stagnant, which is
the Commission's stated practice.

Stages follow CAQM's revised schedule (November 2025): Stage I *Poor* (AQI ≥ 201),
Stage II *Very Poor* (≥ 301), Stage III *Severe* (≥ 401) and Stage IV *Severe+*
(≥ 451).

## What this does **not** claim

Honest limits, all of which the API discloses in its responses:

- **Fire detections outside the domain are not resolved fire-by-fire.** The model grid
  covers 28.2–28.9 °N, while the Punjab/Haryana burning belt sits at 29.5–31.5 °N, so
  regional smoke enters as a scalar lateral inflow rather than as individually
  advected plumes. This is the single largest structural simplification.
- **"Delhi's AQI" here is the urban-core mean of the CPCB 24-hour-mean sub-index** —
  the closest analogue a gridded model can give, not the official station index.
- **The first forecast day averages a partial window.** There is no assimilated
  pre-forecast history, so early hours of the 24-hour mean are noisier than later ones.
- **Intervention attribution shares are effective contributions** (primary plus the
  secondary aerosol formed from the same precursors), not primary-only source
  apportionment. They, not the model physics, dominate the uncertainty on any
  vehicle-measure estimate.
- **Odd-even is not part of the GRAP schedule.** It is a Delhi-government emergency
  measure invoked at its discretion, and the panel labels it as such.
- **Scenario numbers are model estimates, not measurements.**

## Configuration

| Variable | Effect |
| --- | --- |
| `FIRMS_MAP_KEY` | NASA FIRMS key. Without it, fires are synthesised over the burning belt. |
| `FORECAST_API_URL` | Where the Next server proxies `/api/*` (default `http://127.0.0.1:8000`) |
| `HOST`, `PORT`, `RELOAD`, `CORS_ORIGINS` | API bind address and behaviour |

## Docker

```bash
docker build -t delhi-aqi .
docker run --rm -p 8000:8000 delhi-aqi
```

## Tests

Four suites, no test framework required — each runs standalone:

```bash
python tests/test_router_contract.py      # API contract, over real ASGI
node tests/test_component_helpers.cjs     # map geometry and colour helpers
node tests/test_grap_panel_helpers.cjs    # GRAP panel formatting helpers
npx --no-install tsc --noEmit             # types
```

The router contract test runs in two modes: over real ASGI when FastAPI is installed,
and against a stub when it is not, so the response-building logic stays verifiable
offline.

> Do not run `next build` while `next dev` is running — they share `.next`, and the
> build clobbers the dev server's chunks. The symptoms (a blank map canvas, spurious
> `pickingUniforms` shader errors) look like code bugs but are not.

## Licence

No licence has been chosen yet. Without one, the default is all rights reserved —
pick one before you rely on this being reusable.
>>>>>>> feacd28 (Add README covering architecture, quickstart, API and model limits)
