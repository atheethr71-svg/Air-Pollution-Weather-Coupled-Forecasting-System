import { NextRequest, NextResponse } from 'next/server';
import fallbackData from '@/lib/fallback_data.json';

const BACKEND_URL =
  process.env.FORECAST_API_URL ??
  (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:8000' : null);

export async function POST(request: NextRequest) {
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
        return NextResponse.json(data);
      }
    } catch {
      // Fall through to fallback data if local or external backend is unreachable
    }
  }

  const stubble = body.stubble_reduction ?? 0;
  const truck = body.truck_restriction ?? 'off';
  const oddEven = Boolean(body.odd_even);

  const key = `${stubble}_${truck}_${oddEven}`;
  const scenarios = fallbackData.scenarios as Record<string, any>;
  const scenario = scenarios[key] ?? scenarios['0_off_false'];

  return NextResponse.json(scenario);
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const stubble = parseFloat(searchParams.get('stubble_reduction') ?? '0');
  const truck = searchParams.get('truck_restriction') ?? 'off';
  const oddEven = searchParams.get('odd_even') === 'true';

  const key = `${stubble}_${truck}_${oddEven}`;
  const scenarios = fallbackData.scenarios as Record<string, any>;
  const scenario = scenarios[key] ?? scenarios['0_off_false'];

  return NextResponse.json(scenario);
}
