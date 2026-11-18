export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type WorkspaceRole = 'owner' | 'admin' | 'member'
export type ReviewStatus = 'unanswered' | 'answered' | 'flagged'
export type ReviewSentiment = 'positive' | 'neutral' | 'negative'
export type ReviewSource = 'google' | 'manual' | 'internal'
export type ReplyStatus = 'draft' | 'published' | 'failed'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string | null
          full_name: string | null
          avatar_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email?: string | null
          full_name?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string | null
          full_name?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      workspaces: {
        Row: {
          id: string
          name: string
          slug: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      workspace_members: {
        Row: {
          id: string
          workspace_id: string
          user_id: string
          role: WorkspaceRole
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          user_id: string
          role?: WorkspaceRole
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          user_id?: string
          role?: WorkspaceRole
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      locations: {
        Row: {
          id: string
          workspace_id: string
          name: string
          address: string | null
          phone: string | null
          google_place_id: string | null
          google_account_id: string | null
          google_location_id: string | null
          is_connected: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          name: string
          address?: string | null
          phone?: string | null
          google_place_id?: string | null
          google_account_id?: string | null
          google_location_id?: string | null
          is_connected?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          name?: string
          address?: string | null
          phone?: string | null
          google_place_id?: string | null
          google_account_id?: string | null
          google_location_id?: string | null
          is_connected?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          id: string
          workspace_id: string
          location_id: string | null
          author_name: string
          author_photo_url: string | null
          rating: number
          content: string | null
          review_date: string
          source: ReviewSource
          status: ReviewStatus
          sentiment: ReviewSentiment
          external_review_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          location_id?: string | null
          author_name: string
          author_photo_url?: string | null
          rating: number
          content?: string | null
          review_date?: string
          source?: ReviewSource
          status?: ReviewStatus
          sentiment?: ReviewSentiment
          external_review_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          location_id?: string | null
          author_name?: string
          author_photo_url?: string | null
          rating?: number
          content?: string | null
          review_date?: string
          source?: ReviewSource
          status?: ReviewStatus
          sentiment?: ReviewSentiment
          external_review_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      review_replies: {
        Row: {
          id: string
          review_id: string
          workspace_id: string
          user_id: string | null
          content: string
          tone: string | null
          is_ai_generated: boolean
          status: ReplyStatus
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          review_id: string
          workspace_id: string
          user_id?: string | null
          content: string
          tone?: string | null
          is_ai_generated?: boolean
          status?: ReplyStatus
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          review_id?: string
          workspace_id?: string
          user_id?: string | null
          content?: string
          tone?: string | null
          is_ai_generated?: boolean
          status?: ReplyStatus
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      google_integrations: {
        Row: {
          id: string
          workspace_id: string
          connected_by: string
          account_id: string | null
          account_name: string | null
          scope: string
          access_token_encrypted: string
          refresh_token_encrypted: string | null
          expires_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          connected_by: string
          account_id?: string | null
          account_name?: string | null
          scope: string
          access_token_encrypted: string
          refresh_token_encrypted?: string | null
          expires_at: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          connected_by?: string
          account_id?: string | null
          account_name?: string | null
          scope?: string
          access_token_encrypted?: string
          refresh_token_encrypted?: string | null
          expires_at?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      workspace_settings: {
        Row: {
          workspace_id: string
          auto_reply_mode: 'manual_approval' | 'auto_publish_positive' | 'auto_publish_all'
          require_approval_for_critical: boolean
          default_reply_tone: 'professional' | 'friendly' | 'concise' | 'empathetic'
          business_context: string
          auto_reply_min_rating: number
          auto_reply_delay_minutes: number
          created_at: string
          updated_at: string
        }
        Insert: {
          workspace_id: string
          auto_reply_mode?: 'manual_approval' | 'auto_publish_positive' | 'auto_publish_all'
          require_approval_for_critical?: boolean
          default_reply_tone?: 'professional' | 'friendly' | 'concise' | 'empathetic'
          business_context?: string
          auto_reply_min_rating?: number
          auto_reply_delay_minutes?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          workspace_id?: string
          auto_reply_mode?: 'manual_approval' | 'auto_publish_positive' | 'auto_publish_all'
          require_approval_for_critical?: boolean
          default_reply_tone?: 'professional' | 'friendly' | 'concise' | 'empathetic'
          business_context?: string
          auto_reply_min_rating?: number
          auto_reply_delay_minutes?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      review_reply_logs: {
        Row: {
          id: string
          workspace_id: string
          review_id: string
          reply_id: string | null
          user_id: string | null
          action: 'generated' | 'edited' | 'published' | 'failed'
          content: string | null
          tone: string | null
          error_message: string | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          review_id: string
          reply_id?: string | null
          user_id?: string | null
          action: 'generated' | 'edited' | 'published' | 'failed'
          content?: string | null
          tone?: string | null
          error_message?: string | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          review_id?: string
          reply_id?: string | null
          user_id?: string | null
          action?: 'generated' | 'edited' | 'published' | 'failed'
          content?: string | null
          tone?: string | null
          error_message?: string | null
          metadata?: Json
          created_at?: string
        }
        Relationships: []
      }
      workspace_invitations: {
        Row: {
          id: string
          workspace_id: string
          email: string
          role: 'admin' | 'member'
          invited_by: string
          token: string
          expires_at: string
          created_at: string
          status?: 'pending' | 'accepted' | 'expired' | 'revoked'
          updated_at?: string
        }
        Insert: {
          id?: string
          workspace_id: string
          email: string
          role?: 'admin' | 'member'
          invited_by: string
          token?: string
          expires_at?: string
          created_at?: string
          status?: 'pending' | 'accepted' | 'expired' | 'revoked'
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          email?: string
          role?: 'admin' | 'member'
          invited_by?: string
          token?: string
          expires_at?: string
          created_at?: string
          status?: 'pending' | 'accepted' | 'expired' | 'revoked'
          updated_at?: string
        }
        Relationships: []
      }
      qr_codes: {
        Row: {
          id: string
          workspace_id: string
          location_id: string
          public_slug: string
          title: string
          call_to_action: string
          custom_google_review_url: string | null
          is_active: boolean
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          location_id: string
          public_slug: string
          title?: string
          call_to_action?: string
          custom_google_review_url?: string | null
          is_active?: boolean
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          location_id?: string
          public_slug?: string
          title?: string
          call_to_action?: string
          custom_google_review_url?: string | null
          is_active?: boolean
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      qr_code_events: {
        Row: {
          id: string
          qr_code_id: string
          workspace_id: string
          event_type: 'scan' | 'google_click' | 'suggestion_generated'
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          qr_code_id: string
          workspace_id: string
          event_type: 'scan' | 'google_click' | 'suggestion_generated'
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          qr_code_id?: string
          workspace_id?: string
          event_type?: 'scan' | 'google_click' | 'suggestion_generated'
          metadata?: Json
          created_at?: string
        }
        Relationships: []
      }
      review_automation_events: {
        Row: {
          id: string
          event_id: string
          review_resource_id: string | null
          workspace_id: string
          location_id: string | null
          review_id: string | null
          event_type: 'NEW_REVIEW' | 'UPDATED_REVIEW' | 'SYNC_RECONCILIATION'
          processing_status: 'received' | 'scheduled' | 'ai_generating' | 'publishing' | 'published' | 'failed' | 'skipped' | 'draft_saved'
          ai_generated_reply: string | null
          publishing_status: 'pending' | 'published' | 'failed' | 'skipped' | 'draft_saved'
          retry_count: number
          error_message: string | null
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          event_id: string
          review_resource_id?: string | null
          workspace_id: string
          location_id?: string | null
          review_id?: string | null
          event_type?: 'NEW_REVIEW' | 'UPDATED_REVIEW' | 'SYNC_RECONCILIATION'
          processing_status?: 'received' | 'scheduled' | 'ai_generating' | 'publishing' | 'published' | 'failed' | 'skipped' | 'draft_saved'
          ai_generated_reply?: string | null
          publishing_status?: 'pending' | 'published' | 'failed' | 'skipped' | 'draft_saved'
          retry_count?: number
          error_message?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          review_resource_id?: string | null
          workspace_id?: string
          location_id?: string | null
          review_id?: string | null
          event_type?: 'NEW_REVIEW' | 'UPDATED_REVIEW' | 'SYNC_RECONCILIATION'
          processing_status?: 'received' | 'scheduled' | 'ai_generating' | 'publishing' | 'published' | 'failed' | 'skipped' | 'draft_saved'
          ai_generated_reply?: string | null
          publishing_status?: 'pending' | 'published' | 'failed' | 'skipped' | 'draft_saved'
          retry_count?: number
          error_message?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      review_reply_jobs: {
        Row: {
          id: string
          workspace_id: string
          location_id: string
          review_id: string
          external_review_id: string
          source_event_id: string | null
          source_event_type: 'NEW_REVIEW' | 'UPDATED_REVIEW' | 'SYNC_RECONCILIATION'
          status: 'scheduled' | 'processing' | 'published' | 'draft_saved' | 'skipped' | 'failed' | 'dead_letter'
          scheduled_for: string
          locked_at: string | null
          locked_by: string | null
          attempts: number
          max_attempts: number
          next_retry_at: string | null
          last_error: string | null
          processed_at: string | null
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          location_id: string
          review_id: string
          external_review_id: string
          source_event_id?: string | null
          source_event_type?: 'NEW_REVIEW' | 'UPDATED_REVIEW' | 'SYNC_RECONCILIATION'
          status?: 'scheduled' | 'processing' | 'published' | 'draft_saved' | 'skipped' | 'failed' | 'dead_letter'
          scheduled_for: string
          locked_at?: string | null
          locked_by?: string | null
          attempts?: number
          max_attempts?: number
          next_retry_at?: string | null
          last_error?: string | null
          processed_at?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          location_id?: string
          review_id?: string
          external_review_id?: string
          source_event_id?: string | null
          source_event_type?: 'NEW_REVIEW' | 'UPDATED_REVIEW' | 'SYNC_RECONCILIATION'
          status?: 'scheduled' | 'processing' | 'published' | 'draft_saved' | 'skipped' | 'failed' | 'dead_letter'
          scheduled_for?: string
          locked_at?: string | null
          locked_by?: string | null
          attempts?: number
          max_attempts?: number
          next_retry_at?: string | null
          last_error?: string | null
          processed_at?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      google_connection_health: {
        Row: {
          workspace_id: string
          status: 'unknown' | 'connected_verified' | 'token_stored_unverified' | 'refresh_failed' | 'revoked' | 'api_error' | 'disconnected'
          token_stored: boolean
          has_required_scope: boolean
          last_refresh_succeeded_at: string | null
          last_gbp_api_verified_at: string | null
          last_checked_at: string | null
          last_error_code: string | null
          last_error_message: string | null
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          workspace_id: string
          status?: 'unknown' | 'connected_verified' | 'token_stored_unverified' | 'refresh_failed' | 'revoked' | 'api_error' | 'disconnected'
          token_stored?: boolean
          has_required_scope?: boolean
          last_refresh_succeeded_at?: string | null
          last_gbp_api_verified_at?: string | null
          last_checked_at?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          workspace_id?: string
          status?: 'unknown' | 'connected_verified' | 'token_stored_unverified' | 'refresh_failed' | 'revoked' | 'api_error' | 'disconnected'
          token_stored?: boolean
          has_required_scope?: boolean
          last_refresh_succeeded_at?: string | null
          last_gbp_api_verified_at?: string | null
          last_checked_at?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      automation_worker_runs: {
        Row: {
          id: string
          worker_id: string
          trigger_source: string
          started_at: string
          completed_at: string | null
          status: 'running' | 'succeeded' | 'failed'
          claimed_count: number
          published_count: number
          draft_count: number
          skipped_count: number
          failed_count: number
          error_message: string | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          worker_id: string
          trigger_source?: string
          started_at?: string
          completed_at?: string | null
          status?: 'running' | 'succeeded' | 'failed'
          claimed_count?: number
          published_count?: number
          draft_count?: number
          skipped_count?: number
          failed_count?: number
          error_message?: string | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          worker_id?: string
          trigger_source?: string
          started_at?: string
          completed_at?: string | null
          status?: 'running' | 'succeeded' | 'failed'
          claimed_count?: number
          published_count?: number
          draft_count?: number
          skipped_count?: number
          failed_count?: number
          error_message?: string | null
          metadata?: Json
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_public_qr_landing_data: {
        Args: {
          target_slug: string
        }
        Returns: {
          id: string
          title: string
          call_to_action: string
          custom_google_review_url: string | null
          business_name: string
          address: string | null
          google_place_id: string | null
        }[]
      }
      record_public_qr_event: {
        Args: {
          p_qr_code_id: string
          p_event_type: string
        }
        Returns: boolean
      }
      enqueue_review_reply_job: {
        Args: {
          p_workspace_id: string
          p_location_id: string
          p_review_id: string
          p_external_review_id: string
          p_source_event_id: string
          p_source_event_type: string
          p_scheduled_for: string
          p_max_attempts?: number
          p_metadata?: Json
        }
        Returns: Json
      }
      claim_due_review_reply_jobs: {
        Args: {
          p_worker_id: string
          p_limit?: number
          p_stale_lock_minutes?: number
        }
        Returns: Database['public']['Tables']['review_reply_jobs']['Row'][]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
