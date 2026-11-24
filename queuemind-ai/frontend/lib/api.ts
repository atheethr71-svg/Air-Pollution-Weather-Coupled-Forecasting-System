import {
  Facility, User, Queue, Counter, DashboardOverview, TrendPoint,
  CrowdDetection, SimulationResult, Alert, AgentMessage, AnalyticsOverview
} from './types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000/api';
const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://127.0.0.1:8000';

function getAuthHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('queuemind_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchJson<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeader(),
    ...(options.headers || {}),
  };

  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    let errorDetail = 'Request failed';
    try {
      const errJson = await res.json();
      errorDetail = errJson.detail || errJson.message || errorDetail;
    } catch (_) {
      errorDetail = await res.text();
    }
    throw new Error(errorDetail);
  }
  return res.json();
}

export const api = {
  auth: {
    login: async (email: string, password: string) => {
      const data = await fetchJson<{ access_token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (typeof window !== 'undefined') {
        localStorage.setItem('queuemind_token', data.access_token);
        localStorage.setItem('queuemind_user', JSON.stringify(data.user));
      }
      return data;
    },
    register: async (payload: { email: string; password: string; full_name: string; role?: string; facility_id?: string }) => {
      const data = await fetchJson<{ access_token: string; user: User }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (typeof window !== 'undefined') {
        localStorage.setItem('queuemind_token', data.access_token);
        localStorage.setItem('queuemind_user', JSON.stringify(data.user));
      }
      return data;
    },
    logout: () => {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('queuemind_token');
        localStorage.removeItem('queuemind_user');
      }
    },
    getMe: () => fetchJson<User>('/auth/me'),
  },

  facilities: {
    list: () => fetchJson<Facility[]>('/facilities'),
    get: (id: string) => fetchJson<Facility>(`/facilities/${id}`),
  },

  dashboard: {
    getOverview: (facilityId?: string) =>
      fetchJson<DashboardOverview>(`/dashboard/overview${facilityId ? `?facility_id=${facilityId}` : ''}`),
    getTrends: (facilityId?: string, hours: number = 12) =>
      fetchJson<TrendPoint[]>(`/dashboard/trends?hours=${hours}${facilityId ? `&facility_id=${facilityId}` : ''}`),
  },

  detection: {
    uploadImage: async (file: File, facilityId: string, zoneName: string = 'Main Waiting Area') => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('facility_id', facilityId);
      formData.append('zone_name', zoneName);

      const url = `${API_BASE_URL}/detection/image`;
      const res = await fetch(url, {
        method: 'POST',
        headers: getAuthHeader(),
        body: formData,
      });
      if (!res.ok) throw new Error('Failed to process image detection');
      return res.json() as Promise<CrowdDetection>;
    },
    sendFrame: (facilityId: string, frameBase64: string, detectionMode = 'live_camera') =>
      fetchJson<CrowdDetection>('/detection/frame', {
        method: 'POST',
        body: JSON.stringify({ facility_id: facilityId, frame_base64: frameBase64, detection_mode: detectionMode }),
      }),
    triggerSimulation: (facilityId: string) =>
      fetchJson<CrowdDetection>(`/detection/simulate?facility_id=${facilityId}`, {
        method: 'POST',
      }),
    getLatest: (facilityId?: string) =>
      fetchJson<CrowdDetection | null>(`/detection/latest${facilityId ? `?facility_id=${facilityId}` : ''}`),
    getHistory: (facilityId?: string, limit: number = 20) =>
      fetchJson<CrowdDetection[]>(`/detection/history?limit=${limit}${facilityId ? `&facility_id=${facilityId}` : ''}`),
  },

  queues: {
    list: (facilityId?: string) =>
      fetchJson<Queue[]>(`/queues${facilityId ? `?facility_id=${facilityId}` : ''}`),
    update: (id: string, payload: Partial<Queue>) =>
      fetchJson<Queue>(`/queues/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
  },

  counters: {
    list: (facilityId?: string) =>
      fetchJson<Counter[]>(`/counters${facilityId ? `?facility_id=${facilityId}` : ''}`),
    update: (id: string, payload: Partial<Counter>) =>
      fetchJson<Counter>(`/counters/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    action: (id: string, action: string, token?: string) =>
      fetchJson<Counter>(`/counters/${id}/action`, {
        method: 'POST',
        body: JSON.stringify({ action, token }),
      }),
    simulate: (payload: { facility_id: string; proposed_counters: number; queue_size?: number; incoming_rate_per_hour?: number; avg_service_time_seconds?: number }) =>
      fetchJson<SimulationResult>('/counters/simulate', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    applyRecommendation: (facilityId: string, proposedCounters: number, reason?: string) =>
      fetchJson<{ success: boolean; message: string; active_counters: number }>('/counters/apply-recommendation', {
        method: 'POST',
        body: JSON.stringify({ facility_id: facilityId, proposed_counters: proposedCounters, reason }),
      }),
  },

  predictions: {
    calculate: (payload: { facility_id: string; queue_length?: number; active_counters?: number; arrival_rate_per_hour?: number; avg_service_time_seconds?: number }) =>
      fetchJson<any>('/predictions/waiting-time', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    history: (facilityId?: string) =>
      fetchJson<any[]>(`/predictions/history${facilityId ? `?facility_id=${facilityId}` : ''}`),
  },

  agent: {
    chat: (facilityId: string, message: string, conversationId?: string) =>
      fetchJson<{ reply: string; conversation_id: string; tool_calls?: any[]; suggested_action?: any; context_data?: any }>('/agent/chat', {
        method: 'POST',
        body: JSON.stringify({ facility_id: facilityId, message, conversation_id: conversationId }),
      }),
    getHistory: (facilityId?: string, conversationId?: string) =>
      fetchJson<AgentMessage[]>(`/agent/history?${conversationId ? `conversation_id=${conversationId}` : `facility_id=${facilityId}`}`),
    executeAction: (conversationId: string, messageId: string, actionType: string, payload: any) =>
      fetchJson<{ success: boolean; message: string }>('/agent/execute-action', {
        method: 'POST',
        body: JSON.stringify({ conversation_id: conversationId, message_id: messageId, action_type: actionType, payload }),
      }),
  },

  alerts: {
    list: (facilityId?: string, acknowledged?: boolean) =>
      fetchJson<Alert[]>(`/alerts?${facilityId ? `facility_id=${facilityId}&` : ''}${acknowledged !== undefined ? `acknowledged=${acknowledged}` : ''}`),
    acknowledge: (alertId: string, acknowledgedBy?: string) =>
      fetchJson<Alert>(`/alerts/${alertId}/acknowledge`, {
        method: 'PATCH',
        body: JSON.stringify({ acknowledged_by: acknowledgedBy || 'Administrator' }),
      }),
    testSns: (facilityId: string, subject: string, message: string, level: string = 'warning') =>
      fetchJson<any>(`/alerts/test-sns?facility_id=${facilityId}&subject=${encodeURIComponent(subject)}&message=${encodeURIComponent(message)}&level=${level}`, {
        method: 'POST',
      }),
  },

  analytics: {
    getOverview: (facilityId?: string) =>
      fetchJson<AnalyticsOverview>(`/analytics/overview${facilityId ? `?facility_id=${facilityId}` : ''}`),
    getExportUrl: (facilityId?: string) =>
      `${API_BASE_URL}/analytics/export${facilityId ? `?facility_id=${facilityId}` : ''}`,
  },
};

export function createQueueWebSocket(
  facilityId: string,
  onMessage: (event: { event: string; facility_id?: string; data: any }) => void,
  onError?: (err: any) => void
) {
  if (typeof window === 'undefined') return null;
  const wsUrl = `${WS_BASE_URL}/ws/queues/${facilityId}`;
  const socket = new WebSocket(wsUrl);

  socket.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data);
      onMessage(parsed);
    } catch (_) {}
  };

  if (onError) {
    socket.onerror = onError;
  }

  return socket;
}
