import { NextRequest, NextResponse } from 'next/server';
import fallbackData from '@/lib/fallback_data.json';

const BACKEND_URL =
  process.env.FORECAST_API_URL ??
  (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:8000' : null);

function resolveScenario(stubbleInput: any, truckInput: any, oddEvenInput: any) {
  const scenarios = fallbackData.scenarios as Record<string, any>;
  const stubbleNum = Number(stubbleInput) || 0;
  let stubbleStr = '0.0';
  let stubbleInt = '0';
  if (stubbleNum >= 0.7) {
    stubbleStr = '0.8';
    stubbleInt = '0.8';
  } else if (stubbleNum >= 0.3) {
    stubbleStr = '0.5';
    stubbleInt = '0.5';
  }

  const truckStr = String(truckInput ?? 'off').toLowerCase().trim();
  const validTruck = ['bs4_banned', 'all_halted'].includes(truckStr) ? truckStr : 'off';
  const oeBool = Boolean(
    oddEvenInput === true || oddEvenInput === 'true' || oddEvenInput === 1 || oddEvenInput === '1'
  );

  const candidates = [
    `${stubbleInt}_${validTruck}_${oeBool ? 'true' : 'false'}`,
    `${stubbleStr}_${validTruck}_${oeBool ? 'true' : 'false'}`,
    `${stubbleStr}_${validTruck}_${oeBool ? 'True' : 'False'}`,
    `${stubbleInt}_${validTruck}_${oeBool ? 'True' : 'False'}`,
    '0_off_false',
    '0.0_off_False',
    '0.0_off_false',
  ];

  for (const k of candidates) {
    if (scenarios[k]) return scenarios[k];
  }

  return Object.values(scenarios)[0];
}

export async function POST(request: NextRequest) {
  try {
    const search = request.nextUrl.search;
    let body: Record<string, any> = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    if (BACKEND_URL) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`${BACKEND_URL}/api/forecast/interventions${search}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          const data = await res.json();
          if (data && typeof data === 'object') {
            return NextResponse.json(data);
          }
        }
      } catch {
        // Fall through to fallback data if local or external backend is unreachable
      }
    }

    const scenario = resolveScenario(
      body.stubble_reduction,
      body.truck_restriction,
      body.odd_even
    );
    return NextResponse.json(scenario);
  } catch {
    const scenarios = fallbackData.scenarios as Record<string, any>;
    return NextResponse.json(Object.values(scenarios)[0]);
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const scenario = resolveScenario(
      searchParams.get('stubble_reduction'),
      searchParams.get('truck_restriction'),
      searchParams.get('odd_even')
    );
    return NextResponse.json(scenario);
  } catch {
    const scenarios = fallbackData.scenarios as Record<string, any>;
    return NextResponse.json(Object.values(scenarios)[0]);
  }
}
