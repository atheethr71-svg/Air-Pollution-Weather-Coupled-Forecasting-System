import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    meteorology_endpoint: 'https://api.open-meteo.com/v1/forecast',
    meteorology_configured: true,
    firms_source: 'VIIRS_SNPP_NRT',
    firms_map_key_configured: false,
    known_firms_sources: ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'MODIS_NRT'],
    default_center: [28.6139, 77.209],
    grid_shape: [50, 50],
    cached_simulations: 1,
    cached_fingerprints: ['vercel-standalone'],
    last_provenance: {
      generated_at: new Date().toISOString(),
      grid_cells: 2500,
      forecast_hours: 72,
      meteorology_source: 'Open-Meteo',
      meteorology_detail: 'live meteorology',
      fire_source: 'synthetic',
      fire_detail: 'synthetic fire inventory',
      forecast_start_local: null,
      fetched_at: new Date().toISOString(),
      simulation_cached: true,
      simulation_fingerprint: 'standalone-vercel',
      notes: ['Running in standalone mode on Vercel'],
    },
  });
}
