export interface Facility {
  id: string;
  name: string;
  slug: string;
  category: string;
  description?: string;
  address?: string;
  max_capacity: number;
  target_sla_minutes: number;
  is_active: boolean;
  created_at: string;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: 'super_admin' | 'facility_admin' | 'counter_operator';
  facility_id?: string;
  is_active: boolean;
}

export interface Queue {
  id: string;
  facility_id: string;
  name: string;
  code?: string;
  current_length: number;
  avg_service_time_seconds: number;
  target_sla_seconds: number;
  warning_threshold_people: number;
  critical_threshold_people: number;
  status: 'normal' | 'warning' | 'critical';
  updated_at: string;
}

export interface Counter {
  id: string;
  facility_id: string;
  queue_id?: string;
  counter_number: number;
  name: string;
  operator_name: string;
  status: 'active' | 'inactive' | 'paused' | 'closed';
  current_serving_token?: string;
  total_served_today: number;
  avg_service_time_seconds: number;
  efficiency_score: number;
  last_status_change: string;
  updated_at: string;
}

export interface DashboardOverview {
  facility_id: string;
  facility_name: string;
  facility_category: string;
  total_waiting: number;
  avg_waiting_minutes: number;
  longest_waiting_minutes: number;
  active_counters: number;
  inactive_counters: number;
  total_counters: number;
  crowd_density: 'Low' | 'Moderate' | 'High' | 'Critical';
  estimated_completion_time: string;
  total_served_today: number;
  queue_efficiency_score: number;
  is_demo_mode: boolean;
  aws_services_status: {
    s3: boolean;
    sns: boolean;
    cloudwatch: boolean;
    rds: boolean;
  };
  last_updated: string;
}

export interface TrendPoint {
  time: string;
  queue_length: number;
  waiting_minutes: number;
  served_count: number;
  density: string;
}

export interface CrowdDetection {
  id: string;
  facility_id: string;
  timestamp: string;
  detected_count: number;
  density_level: 'Low' | 'Moderate' | 'High' | 'Critical';
  confidence_score: number;
  bounding_boxes: Array<{
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    confidence: number;
    label: string;
    in_queue_zone?: boolean;
  }>;
  detection_mode: 'live_camera' | 'image_upload' | 'video_stream' | 'simulation';
  image_url?: string;
  annotated_image_base64?: string;
  zone_name: string;
  processing_time_ms: number;
  is_simulation?: boolean;
}

export interface SimulationResult {
  facility_id: string;
  current_counters: number;
  proposed_counters: number;
  queue_size: number;
  incoming_rate_per_hour: number;
  avg_service_time_seconds: number;
  current_wait_minutes: number;
  predicted_wait_minutes: number;
  time_saved_minutes: number;
  time_saved_percent: number;
  counter_utilization_percent: number;
  congestion_reduction_percent: number;
  recommended_active_counters: number;
  recommendation_summary: string;
  feasibility_notes: string;
  counter_comparison_curve?: Array<{
    counters: number;
    wait_minutes: number;
    utilization_percent: number;
    capacity_per_hour: number;
  }>;
}

export interface Alert {
  id: string;
  facility_id: string;
  level: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  metric_triggered: string;
  threshold_value: number;
  actual_value: number;
  is_acknowledged: boolean;
  acknowledged_by?: string;
  acknowledged_at?: string;
  sns_message_id?: string;
  created_at: string;
}

export interface AgentMessage {
  id: string;
  sender: 'user' | 'agent';
  content: string;
  tool_calls?: Array<{
    tool: string;
    parameters?: any;
    result?: any;
  }>;
  suggested_action?: {
    action_type: string;
    counter_id?: string;
    counter_name?: string;
    label: string;
    reason: string;
    payload?: any;
  };
  is_action_executed?: boolean;
  created_at?: string;
}

export interface AnalyticsOverview {
  facility_id: string;
  date_range: string;
  total_served: number;
  avg_wait_minutes: number;
  peak_hours: Array<{
    hour: string;
    avg_queue_size: number;
    congestion_score: number;
  }>;
  counter_performance: Array<{
    counter_id: string;
    name: string;
    operator_name: string;
    total_served: number;
    avg_service_time_seconds: number;
    efficiency_score: number;
    status: string;
  }>;
  efficiency_trend: Array<{
    time: string;
    efficiency: number;
    queue_size: number;
  }>;
  before_after_simulation_sample: {
    scenario: string;
    baseline_wait_mins: number;
    optimized_wait_mins: number;
    time_saved_percent: number;
    staffing_adjustment: string;
    throughput_gain_per_hr: string;
  };
}
