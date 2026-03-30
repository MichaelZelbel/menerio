export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      action_items: {
        Row: {
          completed_at: string | null
          contact_id: string | null
          content: string
          created_at: string | null
          due_date: string | null
          id: string
          priority: string
          source_note_id: string | null
          status: string
          tags: string[] | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          contact_id?: string | null
          content: string
          created_at?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          source_note_id?: string | null
          status?: string
          tags?: string[] | null
          updated_at?: string | null
          user_id?: string
        }
        Update: {
          completed_at?: string | null
          contact_id?: string | null
          content?: string
          created_at?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          source_note_id?: string | null
          status?: string
          tags?: string[] | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_items_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_items_source_note_id_fkey"
            columns: ["source_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_events: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          id: string
          item_id: string | null
          item_type: string
          metadata: Json | null
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          id?: string
          item_id?: string | null
          item_type: string
          metadata?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          id?: string
          item_id?: string | null
          item_type?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_allowance_periods: {
        Row: {
          created_at: string
          id: string
          metadata: Json | null
          period_end: string
          period_start: string
          source: string
          tokens_granted: number
          tokens_used: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json | null
          period_end?: string
          period_start?: string
          source?: string
          tokens_granted?: number
          tokens_used?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json | null
          period_end?: string
          period_start?: string
          source?: string
          tokens_granted?: number
          tokens_used?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_credit_settings: {
        Row: {
          description: string | null
          key: string
          value_int: number
        }
        Insert: {
          description?: string | null
          key: string
          value_int: number
        }
        Update: {
          description?: string | null
          key?: string
          value_int?: number
        }
        Relationships: []
      }
      connected_apps: {
        Row: {
          api_key: string
          app_name: string
          created_at: string | null
          display_name: string
          id: string
          is_active: boolean | null
          permissions: Json | null
          updated_at: string | null
          user_id: string
          webhook_url: string | null
        }
        Insert: {
          api_key: string
          app_name: string
          created_at?: string | null
          display_name: string
          id?: string
          is_active?: boolean | null
          permissions?: Json | null
          updated_at?: string | null
          user_id?: string
          webhook_url?: string | null
        }
        Update: {
          api_key?: string
          app_name?: string
          created_at?: string | null
          display_name?: string
          id?: string
          is_active?: boolean | null
          permissions?: Json | null
          updated_at?: string | null
          user_id?: string
          webhook_url?: string | null
        }
        Relationships: []
      }
      contact_interactions: {
        Row: {
          action_items: string[] | null
          contact_id: string
          created_at: string | null
          id: string
          interaction_date: string
          note_id: string | null
          summary: string | null
          type: string
          user_id: string
        }
        Insert: {
          action_items?: string[] | null
          contact_id: string
          created_at?: string | null
          id?: string
          interaction_date?: string
          note_id?: string | null
          summary?: string | null
          type: string
          user_id?: string
        }
        Update: {
          action_items?: string[] | null
          contact_id?: string
          created_at?: string | null
          id?: string
          interaction_date?: string
          note_id?: string | null
          summary?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_interactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_interactions_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          company: string | null
          contact_frequency_days: number | null
          created_at: string | null
          email: string | null
          id: string
          last_contact_date: string | null
          metadata: Json | null
          name: string
          notes: string | null
          phone: string | null
          relationship: string | null
          role: string | null
          tags: string[] | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          company?: string | null
          contact_frequency_days?: number | null
          created_at?: string | null
          email?: string | null
          id?: string
          last_contact_date?: string | null
          metadata?: Json | null
          name: string
          notes?: string | null
          phone?: string | null
          relationship?: string | null
          role?: string | null
          tags?: string[] | null
          updated_at?: string | null
          user_id?: string
        }
        Update: {
          company?: string | null
          contact_frequency_days?: number | null
          created_at?: string | null
          email?: string | null
          id?: string
          last_contact_date?: string | null
          metadata?: Json | null
          name?: string
          notes?: string | null
          phone?: string | null
          relationship?: string | null
          role?: string | null
          tags?: string[] | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      discord_connections: {
        Row: {
          application_id: string
          bot_token: string
          created_at: string | null
          discord_channel_id: string | null
          discord_guild_id: string
          id: string
          is_active: boolean | null
          public_key: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          application_id: string
          bot_token: string
          created_at?: string | null
          discord_channel_id?: string | null
          discord_guild_id: string
          id?: string
          is_active?: boolean | null
          public_key: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          application_id?: string
          bot_token?: string
          created_at?: string | null
          discord_channel_id?: string | null
          discord_guild_id?: string
          id?: string
          is_active?: boolean | null
          public_key?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      github_connections: {
        Row: {
          branch: string | null
          created_at: string | null
          github_token: string
          github_username: string | null
          id: string
          last_sync_at: string | null
          repo_name: string | null
          repo_owner: string | null
          sync_direction: string | null
          sync_enabled: boolean | null
          updated_at: string | null
          user_id: string
          vault_path: string | null
        }
        Insert: {
          branch?: string | null
          created_at?: string | null
          github_token: string
          github_username?: string | null
          id?: string
          last_sync_at?: string | null
          repo_name?: string | null
          repo_owner?: string | null
          sync_direction?: string | null
          sync_enabled?: boolean | null
          updated_at?: string | null
          user_id: string
          vault_path?: string | null
        }
        Update: {
          branch?: string | null
          created_at?: string | null
          github_token?: string
          github_username?: string | null
          id?: string
          last_sync_at?: string | null
          repo_name?: string | null
          repo_owner?: string | null
          sync_direction?: string | null
          sync_enabled?: boolean | null
          updated_at?: string | null
          user_id?: string
          vault_path?: string | null
        }
        Relationships: []
      }
      github_sync_log: {
        Row: {
          error_message: string | null
          github_path: string
          github_sha: string | null
          id: string
          last_commit_sha: string | null
          note_id: string
          sync_direction: string | null
          sync_status: string | null
          synced_at: string | null
          user_id: string
        }
        Insert: {
          error_message?: string | null
          github_path: string
          github_sha?: string | null
          id?: string
          last_commit_sha?: string | null
          note_id: string
          sync_direction?: string | null
          sync_status?: string | null
          synced_at?: string | null
          user_id: string
        }
        Update: {
          error_message?: string | null
          github_path?: string
          github_sha?: string | null
          id?: string
          last_commit_sha?: string | null
          note_id?: string
          sync_direction?: string | null
          sync_status?: string | null
          synced_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "github_sync_log_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_usage_events: {
        Row: {
          completion_tokens: number
          created_at: string
          credits_charged: number
          feature: string
          id: string
          idempotency_key: string | null
          metadata: Json | null
          model: string | null
          prompt_tokens: number
          provider: string | null
          total_tokens: number
          user_id: string
        }
        Insert: {
          completion_tokens?: number
          created_at?: string
          credits_charged?: number
          feature: string
          id?: string
          idempotency_key?: string | null
          metadata?: Json | null
          model?: string | null
          prompt_tokens?: number
          provider?: string | null
          total_tokens?: number
          user_id: string
        }
        Update: {
          completion_tokens?: number
          created_at?: string
          credits_charged?: number
          feature?: string
          id?: string
          idempotency_key?: string | null
          metadata?: Json | null
          model?: string | null
          prompt_tokens?: number
          provider?: string | null
          total_tokens?: number
          user_id?: string
        }
        Relationships: []
      }
      note_connections: {
        Row: {
          connection_type: string
          created_at: string | null
          id: string
          metadata: Json | null
          source_note_id: string
          strength: number | null
          target_note_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          connection_type: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          source_note_id: string
          strength?: number | null
          target_note_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          connection_type?: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          source_note_id?: string
          strength?: number | null
          target_note_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_connections_source_note_id_fkey"
            columns: ["source_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_connections_target_note_id_fkey"
            columns: ["target_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          content: string
          created_at: string | null
          embedding: string | null
          entity_type: string | null
          id: string
          is_external: boolean | null
          is_favorite: boolean | null
          is_pinned: boolean | null
          is_trashed: boolean | null
          metadata: Json | null
          related: Json | null
          source_app: string | null
          source_id: string | null
          source_url: string | null
          structured_fields: Json | null
          sync_status: string | null
          tags: string[] | null
          title: string
          trashed_at: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string | null
          embedding?: string | null
          entity_type?: string | null
          id?: string
          is_external?: boolean | null
          is_favorite?: boolean | null
          is_pinned?: boolean | null
          is_trashed?: boolean | null
          metadata?: Json | null
          related?: Json | null
          source_app?: string | null
          source_id?: string | null
          source_url?: string | null
          structured_fields?: Json | null
          sync_status?: string | null
          tags?: string[] | null
          title?: string
          trashed_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Update: {
          content?: string
          created_at?: string | null
          embedding?: string | null
          entity_type?: string | null
          id?: string
          is_external?: boolean | null
          is_favorite?: boolean | null
          is_pinned?: boolean | null
          is_trashed?: boolean | null
          metadata?: Json | null
          related?: Json | null
          source_app?: string | null
          source_id?: string | null
          source_url?: string | null
          structured_fields?: Json | null
          sync_status?: string | null
          tags?: string[] | null
          title?: string
          trashed_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          created_at: string
          daily_digest_enabled: boolean
          digest_email: string | null
          digest_time: string
          id: string
          notify_contact_followup: boolean
          notify_patterns: boolean
          notify_stale_actions: boolean
          notify_weekly_review: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_digest_enabled?: boolean
          digest_email?: string | null
          digest_time?: string
          id?: string
          notify_contact_followup?: boolean
          notify_patterns?: boolean
          notify_stale_actions?: boolean
          notify_weekly_review?: boolean
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          daily_digest_enabled?: boolean
          digest_email?: string | null
          digest_time?: string
          id?: string
          notify_contact_followup?: boolean
          notify_patterns?: boolean
          notify_stale_actions?: boolean
          notify_weekly_review?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          metadata: Json | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          metadata?: Json | null
          title: string
          type: string
          user_id?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          metadata?: Json | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          website: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      sync_log: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          id: string
          note_id: string | null
          source_app: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          id?: string
          note_id?: string | null
          source_app?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          id?: string
          note_id?: string | null
          source_app?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_log_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_connections: {
        Row: {
          bot_token: string
          created_at: string | null
          id: string
          is_active: boolean | null
          is_paired: boolean | null
          pairing_code: string | null
          telegram_chat_id: number | null
          updated_at: string | null
          user_id: string
          webhook_secret: string
        }
        Insert: {
          bot_token: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_paired?: boolean | null
          pairing_code?: string | null
          telegram_chat_id?: number | null
          updated_at?: string | null
          user_id: string
          webhook_secret?: string
        }
        Update: {
          bot_token?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_paired?: boolean | null
          pairing_code?: string | null
          telegram_chat_id?: number | null
          updated_at?: string | null
          user_id?: string
          webhook_secret?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      weekly_reviews: {
        Row: {
          created_at: string | null
          id: string
          review_data: Json
          user_id: string
          week_end: string
          week_start: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          review_data?: Json
          user_id: string
          week_end: string
          week_start: string
        }
        Update: {
          created_at?: string | null
          id?: string
          review_data?: Json
          user_id?: string
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_ai_allowance_current: {
        Row: {
          credits_granted: number | null
          credits_used: number | null
          id: string | null
          metadata: Json | null
          period_end: string | null
          period_start: string | null
          remaining_credits: number | null
          remaining_tokens: number | null
          source: string | null
          tokens_granted: number | null
          tokens_used: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_premium_user: { Args: { _user_id: string }; Returns: boolean }
      match_notes: {
        Args: {
          match_count?: number
          match_threshold?: number
          p_user_id?: string
          query_embedding: string
        }
        Returns: {
          content: string
          created_at: string
          id: string
          metadata: Json
          similarity: number
          tags: string[]
          title: string
        }[]
      }
    }
    Enums: {
      app_role: "free" | "premium" | "premium_gift" | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["free", "premium", "premium_gift", "admin"],
    },
  },
} as const
