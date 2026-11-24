export interface FlightTelemetry {
  id: string;
  flightNumber: string;
  airline: string;
  aircraft: string;
  origin: { code: string; city: string; lat: number; lng: number };
  destination: { code: string; city: string; lat: number; lng: number };
  currentFL: number;       // e.g. 370
  optimalFL: number;       // e.g. 350
  groundSpeedKnots: number;
  headingDeg: number;
  ambientTempC: number;    // e.g. -56.4
  rhIcePercent: number;    // e.g. 118.5%
  issrDepthFt: number;     // e.g. 1,800 ft
  issrBaseFL: number;      // e.g. 360
  issrCeilingFL: number;   // e.g. 385
  fuelPenaltyKg: number;   // e.g. 18.5 kg
  warmingAvoidedKgCO2e: number; // e.g. 84,200 kg CO2e
  coolingRatio: number;    // e.g. 1,440:1
  riskLevel: 'Severe Persistent' | 'Moderate Persistent' | 'Short-Lived' | 'None';
  clearanceStatus: 'Advisory Pending' | 'Clearance Requested' | 'Approved by ATC' | 'En Route';
  currentPosition: { lat: number; lng: number };
  plumeLengthMiles: number;
  trappedHeatMWh: number;
}

export const MONITORED_FLIGHTS: FlightTelemetry[] = [
  {
    id: 'ua84',
    flightNumber: 'UA84',
    airline: 'United Airlines',
    aircraft: 'Boeing 787-9 Dreamliner',
    origin: { code: 'EWR', city: 'New York', lat: 40.6895, lng: -74.1745 },
    destination: { code: 'LHR', city: 'London', lat: 51.4700, lng: -0.4543 },
    currentFL: 370,
    optimalFL: 350,
    groundSpeedKnots: 510,
    headingDeg: 72,
    ambientTempC: -56.4,
    rhIcePercent: 118.5,
    issrDepthFt: 1800,
    issrBaseFL: 360,
    issrCeilingFL: 385,
    fuelPenaltyKg: 18.5,
    warmingAvoidedKgCO2e: 84200,
    coolingRatio: 1440,
    riskLevel: 'Severe Persistent',
    clearanceStatus: 'Advisory Pending',
    currentPosition: { lat: 52.41, lng: -35.20 },
    plumeLengthMiles: 184,
    trappedHeatMWh: 320,
  },
  {
    id: 'ai101',
    flightNumber: 'AI101',
    airline: 'Air India',
    aircraft: 'Boeing 777-300ER',
    origin: { code: 'DEL', city: 'New Delhi', lat: 28.5562, lng: 77.1000 },
    destination: { code: 'JFK', city: 'New York', lat: 40.6413, lng: -73.7781 },
    currentFL: 340,
    optimalFL: 320,
    groundSpeedKnots: 495,
    headingDeg: 295,
    ambientTempC: -58.1,
    rhIcePercent: 122.5,
    issrDepthFt: 2100,
    issrBaseFL: 330,
    issrCeilingFL: 355,
    fuelPenaltyKg: 28.0,
    warmingAvoidedKgCO2e: 112000,
    coolingRatio: 1280,
    riskLevel: 'Severe Persistent',
    clearanceStatus: 'Clearance Requested',
    currentPosition: { lat: 41.25, lng: 50.12 },
    plumeLengthMiles: 210,
    trappedHeatMWh: 440,
  },
  {
    id: 'ek201',
    flightNumber: 'EK201',
    airline: 'Emirates',
    aircraft: 'Airbus A380-800 Superjumbo',
    origin: { code: 'DXB', city: 'Dubai', lat: 25.2532, lng: 55.3657 },
    destination: { code: 'JFK', city: 'New York', lat: 40.6413, lng: -73.7781 },
    currentFL: 380,
    optimalFL: 360,
    groundSpeedKnots: 520,
    headingDeg: 310,
    ambientTempC: -57.2,
    rhIcePercent: 126.0,
    issrDepthFt: 2400,
    issrBaseFL: 370,
    issrCeilingFL: 395,
    fuelPenaltyKg: 42.0,
    warmingAvoidedKgCO2e: 148000,
    coolingRatio: 1130,
    riskLevel: 'Severe Persistent',
    clearanceStatus: 'Clearance Requested',
    currentPosition: { lat: 64.10, lng: -18.40 },
    plumeLengthMiles: 245,
    trappedHeatMWh: 580,
  },
  {
    id: 'lh402',
    flightNumber: 'LH402',
    airline: 'Lufthansa',
    aircraft: 'Airbus A350-900',
    origin: { code: 'FRA', city: 'Frankfurt', lat: 50.0379, lng: 8.5622 },
    destination: { code: 'EWR', city: 'New York', lat: 40.6895, lng: -74.1745 },
    currentFL: 390,
    optimalFL: 410,
    groundSpeedKnots: 485,
    headingDeg: 280,
    ambientTempC: -54.8,
    rhIcePercent: 106.4,
    issrDepthFt: 1200,
    issrBaseFL: 385,
    issrCeilingFL: 398,
    fuelPenaltyKg: 14.2,
    warmingAvoidedKgCO2e: 46500,
    coolingRatio: 1050,
    riskLevel: 'Moderate Persistent',
    clearanceStatus: 'Approved by ATC',
    currentPosition: { lat: 54.30, lng: -24.80 },
    plumeLengthMiles: 92,
    trappedHeatMWh: 175,
  },
  {
    id: 'dl126',
    flightNumber: 'DL126',
    airline: 'Delta Air Lines',
    aircraft: 'Airbus A350-900',
    origin: { code: 'ATL', city: 'Atlanta', lat: 33.6407, lng: -84.4277 },
    destination: { code: 'CDG', city: 'Paris', lat: 49.0097, lng: 2.5479 },
    currentFL: 360,
    optimalFL: 360,
    groundSpeedKnots: 535,
    headingDeg: 65,
    ambientTempC: -48.2,
    rhIcePercent: 68.0,
    issrDepthFt: 0,
    issrBaseFL: 0,
    issrCeilingFL: 0,
    fuelPenaltyKg: 0,
    warmingAvoidedKgCO2e: 0,
    coolingRatio: 0,
    riskLevel: 'None',
    clearanceStatus: 'En Route',
    currentPosition: { lat: 46.80, lng: -42.10 },
    plumeLengthMiles: 0,
    trappedHeatMWh: 0,
  },
  {
    id: 'ba178',
    flightNumber: 'BA178',
    airline: 'British Airways',
    aircraft: 'Boeing 777-300ER',
    origin: { code: 'JFK', city: 'New York', lat: 40.6413, lng: -73.7781 },
    destination: { code: 'LHR', city: 'London', lat: 51.4700, lng: -0.4543 },
    currentFL: 350,
    optimalFL: 370,
    groundSpeedKnots: 540,
    headingDeg: 70,
    ambientTempC: -53.4,
    rhIcePercent: 104.8,
    issrDepthFt: 1400,
    issrBaseFL: 345,
    issrCeilingFL: 360,
    fuelPenaltyKg: 16.8,
    warmingAvoidedKgCO2e: 52000,
    coolingRatio: 990,
    riskLevel: 'Moderate Persistent',
    clearanceStatus: 'Approved by ATC',
    currentPosition: { lat: 50.90, lng: -31.40 },
    plumeLengthMiles: 110,
    trappedHeatMWh: 195,
  },
  {
    id: '6e24',
    flightNumber: '6E24',
    airline: 'IndiGo',
    aircraft: 'Airbus A321neo',
    origin: { code: 'BOM', city: 'Mumbai', lat: 19.0896, lng: 72.8656 },
    destination: { code: 'DOH', city: 'Doha', lat: 25.2731, lng: 51.6081 },
    currentFL: 360,
    optimalFL: 340,
    groundSpeedKnots: 460,
    headingDeg: 285,
    ambientTempC: -55.9,
    rhIcePercent: 114.6,
    issrDepthFt: 1600,
    issrBaseFL: 355,
    issrCeilingFL: 375,
    fuelPenaltyKg: 11.4,
    warmingAvoidedKgCO2e: 64000,
    coolingRatio: 1800,
    riskLevel: 'Severe Persistent',
    clearanceStatus: 'Advisory Pending',
    currentPosition: { lat: 23.40, lng: 61.20 },
    plumeLengthMiles: 140,
    trappedHeatMWh: 240,
  },
];

export interface ClimateLedger {
  grossContrailAvoidedKg: number;
  grossContrailAvoidedMT: number;
  fuelPenaltyKg: number;
  additionalCO2PenaltyKg: number;
  additionalCO2PenaltyMT: number;
  netBenefitKg: number;
  netBenefitMT: number;
  coolingRatio: number;
  estimatedReductionPercent: number;
  confidenceIntervalPercent: number;
}

export const ICAO_CO2_EMISSION_INDEX = 3.16; // kg CO2 per kg Jet-A1 fuel

/**
 * Calculates transparent climate ledger from an individual flight's inputs
 */
export function calculateFlightLedger(flight: FlightTelemetry): ClimateLedger {
  const grossContrailAvoidedKg = flight.warmingAvoidedKgCO2e;
  const fuelPenaltyKg = flight.fuelPenaltyKg;
  const additionalCO2PenaltyKg = fuelPenaltyKg * ICAO_CO2_EMISSION_INDEX;
  const netBenefitKg = Math.max(0, grossContrailAvoidedKg - additionalCO2PenaltyKg);
  const coolingRatio = additionalCO2PenaltyKg > 0 
    ? Math.round(grossContrailAvoidedKg / additionalCO2PenaltyKg) 
    : 0;

  return {
    grossContrailAvoidedKg,
    grossContrailAvoidedMT: parseFloat((grossContrailAvoidedKg / 1000).toFixed(1)),
    fuelPenaltyKg,
    additionalCO2PenaltyKg: parseFloat(additionalCO2PenaltyKg.toFixed(1)),
    additionalCO2PenaltyMT: parseFloat((additionalCO2PenaltyKg / 1000).toFixed(3)),
    netBenefitKg: parseFloat(netBenefitKg.toFixed(1)),
    netBenefitMT: parseFloat((netBenefitKg / 1000).toFixed(1)),
    coolingRatio,
    estimatedReductionPercent: 61,
    confidenceIntervalPercent: 12,
  };
}

/**
 * Dynamically computes aggregate fleet ledger by summing all simulated flight inputs
 */
export function calculateFleetLedger(flights: FlightTelemetry[]): ClimateLedger {
  const grossContrailAvoidedKg = flights.reduce((sum, f) => sum + f.warmingAvoidedKgCO2e, 0);
  const fuelPenaltyKg = flights.reduce((sum, f) => sum + f.fuelPenaltyKg, 0);
  const additionalCO2PenaltyKg = fuelPenaltyKg * ICAO_CO2_EMISSION_INDEX;
  const netBenefitKg = Math.max(0, grossContrailAvoidedKg - additionalCO2PenaltyKg);
  const coolingRatio = additionalCO2PenaltyKg > 0 
    ? Math.round(grossContrailAvoidedKg / additionalCO2PenaltyKg) 
    : 0;

  return {
    grossContrailAvoidedKg,
    grossContrailAvoidedMT: parseFloat((grossContrailAvoidedKg / 1000).toFixed(1)),
    fuelPenaltyKg: parseFloat(fuelPenaltyKg.toFixed(1)),
    additionalCO2PenaltyKg: parseFloat(additionalCO2PenaltyKg.toFixed(1)),
    additionalCO2PenaltyMT: parseFloat((additionalCO2PenaltyKg / 1000).toFixed(3)),
    netBenefitKg: parseFloat(netBenefitKg.toFixed(1)),
    netBenefitMT: parseFloat((netBenefitKg / 1000).toFixed(1)),
    coolingRatio,
    estimatedReductionPercent: 60,
    confidenceIntervalPercent: 14,
  };
}
