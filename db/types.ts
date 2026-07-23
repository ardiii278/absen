export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      projects: {
        Row: {
          id: string
          code: string
          name: string
          lat: number | null
          lng: number | null
          radius_m: number | null
          created_at: string
        }
        Insert: {
          id?: string
          code: string
          name: string
          lat?: number | null
          lng?: number | null
          radius_m?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          code?: string
          name?: string
          lat?: number | null
          lng?: number | null
          radius_m?: number | null
          created_at?: string
        }
      }
      profiles: {
        Row: {
          id: string
          role: 'super_admin' | 'admin' | 'kiosk'
          full_name: string | null
          created_at: string
        }
        Insert: {
          id: string
          role: 'super_admin' | 'admin' | 'kiosk'
          full_name?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          role?: 'super_admin' | 'admin' | 'kiosk'
          full_name?: string | null
          created_at?: string
        }
      }
      admin_projects: {
        Row: {
          user_id: string
          project_id: string
        }
        Insert: {
          user_id: string
          project_id: string
        }
        Update: {
          user_id?: string
          project_id?: string
        }
      }
      kiosk_accounts: {
        Row: {
          id: string
          auth_user_id: string
          username: string
          project_id: string
          is_active: boolean
          last_seen_at: string | null
        }
        Insert: {
          id?: string
          auth_user_id: string
          username: string
          project_id: string
          is_active?: boolean
          last_seen_at?: string | null
        }
        Update: {
          id?: string
          auth_user_id?: string
          username?: string
          project_id?: string
          is_active?: boolean
          last_seen_at?: string | null
        }
      }
      workers: {
        Row: {
          id: string
          nik: string
          name: string
          position: 'TK' | 'KN' | null
          job_scope: string
          project_id: string
          status: 'pending_approval' | 'approved' | 'rejected'
          is_active: boolean
          profile_path: string
          ktp_private_path: string | null
          face_descriptor: Json | null
          daily_wage: number
          created_at: string
        }
        Insert: {
          id?: string
          nik: string
          name: string
          position?: 'TK' | 'KN' | null
          job_scope: string
          project_id: string
          status?: 'pending_approval' | 'approved' | 'rejected'
          is_active?: boolean
          profile_path: string
          ktp_private_path?: string | null
          face_descriptor?: Json | null
          daily_wage?: number
          created_at?: string
        }
        Update: {
          id?: string
          nik?: string
          name?: string
          position?: 'TK' | 'KN' | null
          job_scope?: string
          project_id?: string
          status?: 'pending_approval' | 'approved' | 'rejected'
          is_active?: boolean
          profile_path?: string
          ktp_private_path?: string | null
          face_descriptor?: Json | null
          daily_wage?: number
          created_at?: string
        }
      }
      attendance: {
        Row: {
          id: string
          client_event_id: string
          worker_id: string | null
          project_id: string | null
          type: 'in' | 'out' | null
          occurred_at: string
          evidence_path: string | null
          gps: Json | null
          source: string | null
          status: 'pending_approval' | 'approved' | 'rejected'
          conflict_of: string | null
          late_deduction: number
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          client_event_id: string
          worker_id?: string | null
          project_id?: string | null
          type?: 'in' | 'out' | null
          occurred_at: string
          evidence_path?: string | null
          gps?: Json | null
          source?: string | null
          status?: 'pending_approval' | 'approved' | 'rejected'
          conflict_of?: string | null
          late_deduction?: number
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          client_event_id?: string
          worker_id?: string | null
          project_id?: string | null
          type?: 'in' | 'out' | null
          occurred_at?: string
          evidence_path?: string | null
          gps?: Json | null
          source?: string | null
          status?: 'pending_approval' | 'approved' | 'rejected'
          conflict_of?: string | null
          late_deduction?: number
          created_by?: string | null
          created_at?: string
        }
      }
      overtime: {
        Row: {
          id: string
          project_id: string | null
          work_date: string
          hours: number | null
          evidence_path: string | null
          status: 'pending_approval' | 'approved' | 'rejected'
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id?: string | null
          work_date: string
          hours?: number | null
          evidence_path?: string | null
          status?: 'pending_approval' | 'approved' | 'rejected'
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string | null
          work_date?: string
          hours?: number | null
          evidence_path?: string | null
          status?: 'pending_approval' | 'approved' | 'rejected'
          created_by?: string | null
          created_at?: string
        }
      }
      overtime_workers: {
        Row: {
          overtime_id: string
          worker_id: string
          hours: number
        }
        Insert: {
          overtime_id: string
          worker_id: string
          hours: number
        }
        Update: {
          overtime_id?: string
          worker_id?: string
          hours?: number
        }
      }
      audit_logs: {
        Row: {
          id: number
          actor_id: string | null
          entity_type: string
          entity_id: string
          action: string
          reason: string | null
          old_data: Json | null
          new_data: Json | null
          created_at: string
        }
        Insert: {
          id?: number
          actor_id?: string | null
          entity_type: string
          entity_id: string
          action: string
          reason?: string | null
          old_data?: Json | null
          new_data?: Json | null
          created_at?: string
        }
        Update: {
          id?: number
          actor_id?: string | null
          entity_type?: string
          entity_id?: string
          action?: string
          reason?: string | null
          old_data?: Json | null
          new_data?: Json | null
          created_at?: string
        }
      }
      kiosk_login_history: {
        Row: {
          id: string
          kiosk_account_id: string
          username: string
          project_id: string
          ip_address: string | null
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          kiosk_account_id: string
          username: string
          project_id: string
          ip_address?: string | null
          status: string
          created_at?: string
        }
        Update: {
          id?: string
          kiosk_account_id?: string
          username?: string
          project_id?: string
          ip_address?: string | null
          status?: string
          created_at?: string
        }
      }
      error_logs: {
        Row: {
          id: string
          pathname: string
          method: string
          error_message: string
          stack_trace: string | null
          user_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          pathname: string
          method: string
          error_message: string
          stack_trace?: string | null
          user_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          pathname?: string
          method?: string
          error_message?: string
          stack_trace?: string | null
          user_id?: string | null
          created_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      app_role: 'super_admin' | 'admin' | 'kiosk'
      approval_status: 'pending_approval' | 'approved' | 'rejected'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
