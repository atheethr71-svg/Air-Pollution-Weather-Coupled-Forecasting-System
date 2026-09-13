import { NextRequest, NextResponse } from 'next/server';
import fallbackData from '@/lib/fallback_data.json';

const BACKEND_URL =
  process.env.FORECAST_API_URL ??
  (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:8000' : null);

export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.search;
    const hour = parseInt(request.nextUrl.searchParams.get('hour') ?? '0', 10);

    if (BACKEND_URL) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`${BACKEND_URL}/api/forecast/72h${search}`, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
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

    // Clone fallback forecast data
    const base = fallbackData.forecast_72h;
    const clampedHour = Math.max(0, Math.min(isNaN(hour) ? 0 : hour, (base.timeline?.length ?? 72) - 1));
    const timelineItem = base.timeline?.[clampedHour];

    const response = {
      ...base,
      summary: {
        ...base.summary,
        selected_hour_index: clampedHour,
        selected_hour_time_local: timelineItem?.time_local ?? base.summary.selected_hour_time_local,
        mean_pm25_selected_hour: timelineItem?.mean_pm25 ?? base.summary.mean_pm25_selected_hour,
      },
    };

    return NextResponse.json(response);
  } catch {
    return NextResponse.json(fallbackData.forecast_72h);
  }
}
