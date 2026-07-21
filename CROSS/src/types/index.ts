export type POIStatus = 'must_go' | 'optional' | 'avoid'

export type TransportMode = 'walk' | 'metro' | 'taxi' | 'drive'

export type PlanningStatus = 'scheduled' | 'unscheduled' | 'candidate' | 'rejected'

export interface Destination {
  id: string
  name: string
  description?: string
  coordinates: [number, number]
  highlight?: string
  order: number
  day?: number
  withinDayOrder?: number
  date?: Date | string
  image?: string
  poiStatus?: POIStatus
  openingHours?: string
  visitDurationMinutes?: number
  transportMode?: TransportMode
  travelTimeMinutes?: number
  agentNote?: string
  planningStatus?: PlanningStatus
  locked?: boolean
  source?: 'user' | 'text_import' | 'ai'
}

export interface Route {
  id: string
  name: string
  destinations: Destination[]
  totalDistance: number
  estimatedDays: number
}

export interface DaySchedule {
  day: number
  date: Date
  city: string
  activities: string[]
  accommodation: string
  notes?: string
  detectedPace?: '轻松' | '适中' | '紧凑'
}

export interface BudgetItem {
  id: string
  day: number
  type: '交通' | '住宿' | '餐饮' | '景点' | '门票' | '购物' | '其他'
  description: string
  amount: number
  currency?: string
}

export interface AgentPlanInput {
  city: string
  days: number
  interests?: string
  constraints?: string
  startDate?: string
}

export interface AgentPlanResult {
  route: Route
  schedule: DaySchedule[]
  warnings: string[]
  sourceMode?: 'import' | 'generate'
  diagnostics?: {
    overall: '轻松' | '适中' | '紧凑'
    byDay: Array<{ day: number; activityCount: number; detectedPace: '轻松' | '适中' | '紧凑' }>
  }
  unresolvedActivities?: Array<{ name: string; day: number; reason?: string }>
}

export interface TripConstraints {
  city: string
  days: number
  pacePreference: string
  pace?: string
  startDate?: string
  endDate?: string
  datesFlexible?: boolean
}

export type AgentMessageRole = 'user' | 'assistant' | 'system'
export type AgentMessageStatus = 'sending' | 'complete' | 'failed' | 'superseded'

export interface PlanChange {
  type: string
  message: string
}

export type AgentActivityStatus = 'running' | 'complete' | 'failed' | 'superseded'

export interface AgentActivity {
  id: string
  label: string
  detail?: string
  toolName?: string
  status: AgentActivityStatus
}

export interface AgentMessage {
  id: string
  role: AgentMessageRole
  content: string
  createdAt: string
  status: AgentMessageStatus
  changes?: PlanChange[]
  activities?: AgentActivity[]
  suggestions?: AgentSuggestion[]
  proposal?: AgentProposalSummary
  draftPlan?: AgentPlanResult
  draftTrip?: Trip
  draftExplanation?: DraftExplanation
}

export type AgentSuggestionAction = 'send_message' | 'focus_draft_map' | 'confirm_proposal'

export interface AgentSuggestion {
  id: string
  label: string
  action: AgentSuggestionAction
  message?: string
  proposalId?: string
}

export interface DraftExplanation {
  basis: string[]
  days: Array<{ day: number; places: string[]; reason: string }>
  evidence: Array<{ type: 'amap_poi' | 'user_input' | 'planning_judgement'; label: string }>
}

export interface AgentProposalSummary {
  id: string
  summary: string
  operations: PlanOperation[]
  baseRevision: number
  status: 'pending' | 'confirmed' | 'rejected' | 'applied' | 'stale'
  kind?: 'create' | 'change'
  segments?: Array<{ city: string; days: number; reason?: string }>
}

export interface TripSegment {
  id: string
  city: string
  order: number
  startDate?: string
  endDate?: string
  days: number
  status: 'outline' | 'confirmed' | 'detailed'
  reason?: string
  destinations: Destination[]
  schedule: DaySchedule[]
}

export interface Trip {
  id: string
  title: string
  startDate?: string
  endDate?: string
  totalDays?: number
  status: 'draft' | 'planning' | 'ready'
  revision: number
  constraints: TripConstraints
  segments: TripSegment[]
}

export interface AgentSession {
  id: string
  tripId: string
  messages: AgentMessage[]
  constraints: TripConstraints
  pendingTask?: PendingAgentTask | null
  planRevision: number
  updatedAt: string
  draftPlan?: AgentPlanResult | null
  draftTrip?: Trip | null
}

export type AgentTaskStatus = 'running' | 'waiting_for_input' | 'completed' | 'failed' | 'cancelled'
export type AgentTaskIntent = 'import_plan' | 'create_plan' | 'modify_plan' | 'answer'
export type AgentMissingField = 'city' | 'days' | 'clarification'

export interface PendingAgentTask {
  taskId: string
  originalMessage: string
  intent: AgentTaskIntent
  missingFields: AgentMissingField[]
  basePlanRevision: number
  createdAt: string
}

export interface AgentTaskState {
  taskId: string
  requestId: string
  status: AgentTaskStatus
  basePlanRevision: number
}

export interface TripSnapshot {
  route: Route | null
  destinations: Destination[]
  schedule: DaySchedule[]
}

export interface PlanOperation {
  type: string
  poiId?: string
  segmentId?: string
  city?: string
  days?: number
  targetPoiId?: string
  targetDay?: number
  targetIndex?: number
  pace?: string
  query?: string
}

export interface AgentChatResponse {
  decision?: 'answer_only' | 'ask_clarification' | 'create_plan' | 'outline_trip' | 'modify_plan'
  reply: string
  operations: PlanOperation[]
  plan?: AgentPlanResult
  trip?: Trip
  changes: PlanChange[]
  warnings: string[]
  suggestions?: AgentSuggestion[]
  constraints?: Partial<TripConstraints>
  task?: AgentTaskState
  pendingTask?: PendingAgentTask | null
  promptVersion?: string
  error?: string
  proposal?: AgentProposalSummary
  draftPlan?: AgentPlanResult
  draftTrip?: Trip
  draftExplanation?: DraftExplanation
}
