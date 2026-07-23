export interface KioskWorker {
  id: string
  name: string
  nik: string
  position: 'TK' | 'KN' | null
  job_scope: string
  face_descriptor: number[]
}

export interface KioskLogEntry {
  id: string
  worker_id: string
  name: string
  nik: string
  position: 'TK' | 'KN' | null
  type: 'in' | 'out'
  occurred_at: string
  source: 'face' | 'manual'
  synced: boolean
}

export interface KioskAttendancePair {
  worker_id: string
  name: string
  nik: string
  position: 'TK' | 'KN' | null
  clock_in: string | null
  clock_out: string | null
  status_day: number
  method: 'face' | 'manual' | 'mixed'
  synced: boolean
}

export interface ScanResult {
  success: boolean
  worker?: KioskWorker
  message: string
}

export interface ManualAttendancePayload {
  worker_id: string
  type: 'in' | 'out'
  note: string
}

export const MANUAL_NOTES = [
  'Normal',
  'Wajah Gelap',
  'Pakai Masker',
  'Kendala Kamera',
  'Wajah Cedera',
  'Lainnya'
] as const

export type ManualNote = typeof MANUAL_NOTES[number]
