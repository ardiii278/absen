export type AppRole = 'super_admin' | 'admin' | 'kiosk'

export type ApprovalStatus = 'pending_approval' | 'approved' | 'rejected'

export type AttendanceType = 'in' | 'out'

export type AttendanceSource = 'face' | 'manual'

export type Position = 'TK' | 'KN'

export interface Project {
  id: string
  code: string
  name: string
  lat: number | null
  lng: number | null
  radius_m: number | null
  created_at: string
}

export interface Worker {
  id: string
  nik: string
  name: string
  position: Position | null
  job_scope: string
  status: ApprovalStatus
  profile_path: string
  ktp_private_path: string | null
  project_id: string
  is_active: boolean
  daily_wage: number
  face_descriptor: number[] | null
  created_at: string
}

export interface WorkerWithProject extends Worker {
  projects?: { name: string } | null
}

export interface AttendanceRecord {
  id: string
  client_event_id: string
  worker_id: string | null
  project_id: string | null
  type: AttendanceType | null
  occurred_at: string
  evidence_path: string | null
  gps: { latitude: number; longitude: number } | null
  source: AttendanceSource | null
  status: ApprovalStatus
  conflict_of: string | null
  late_deduction: number
  created_by: string | null
  workers: {
    name: string
    nik: string
  } | null
}

export interface DuplicateGroup {
  worker_id: string
  worker_name: string
  worker_nik: string
  date: string
  records: AttendanceRecord[]
}

export interface AuditLog {
  id: number
  actor_id: string | null
  entity_type: string
  entity_id: string
  action: string
  reason: string | null
  old_data: unknown
  new_data: unknown
  created_at: string
}

export interface OvertimeRecord {
  id: string
  project_id: string
  work_date: string
  hours: number | null
  evidence_path: string | null
  status: ApprovalStatus
  created_by: string | null
  created_at: string
  projects?: { name: string } | null
}

export interface OvertimeWorkerMapping {
  overtime_id: string
  worker_id: string
  hours: number
}

export interface KioskAccount {
  id: string
  auth_user_id: string
  username: string
  project_id: string
  is_active: boolean
  last_seen_at: string | null
  projects?: { name: string } | null
}

export interface PayrollRow {
  worker_id: string
  name: string
  nik: string
  position: Position | null
  daily_wage: number
  job_scope: string
  credit_days: number
  overtime_hours: number
  late_deductions: number
  total_wage: number
}

export interface DashboardStats {
  totalWorkersActive: number
  presentToday: number
  notYetAbsent: number
  overtimeToday: number
  estimatedWageToday: number
  pendingWorkers: number
  unresolvedConflicts: number
}

export interface ExportFilters {
  projectId: string
  startDate: string
  endDate: string
  jobScope?: string | null
}
