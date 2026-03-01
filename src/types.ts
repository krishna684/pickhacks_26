export interface Segment {
  id: string;
  name: string;
  geometry: [number, number][];
  base_safety_score: number;
  lighting: number;
  crosswalk: number;
  complaint_count: number;
}

export interface Complaint {
  id: string;
  lat: number;
  lng: number;
  type: string;
  description: string;
  ai_urgency: string;
  ai_summary: string;
  status: 'open' | 'in_progress' | 'resolved';
  assigned_department?: string | null;
  response_note?: string | null;
  updated_at?: string;
  created_at: string;
}

export type ViewMode = 'citizen' | 'operator' | 'planner';

export interface PlannerScenarioChange {
  segmentId: string;
  name: string;
  lighting: boolean;
  crosswalk: boolean;
  baseSafetyScore: number;
}

export interface PlannerScenario {
  id: string;
  name: string;
  description?: string;
  created_by?: string;
  infrastructure_changes: PlannerScenarioChange[];
  estimated_safety_change: number;
  estimated_cost: number;
  created_at: string;
}
