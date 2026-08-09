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
          ai_visibility: string
          completed_at: string | null
          contact_id: string | null
          content: string
          created_at: string | null
          due_date: string | null
          id: string
          metadata: Json | null
          priority: string
          source_note_id: string | null
          status: string
          tags: string[] | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          ai_visibility?: string
          completed_at?: string | null
          contact_id?: string | null
          content: string
          created_at?: string | null
          due_date?: string | null
          id?: string
          metadata?: Json | null
          priority?: string
          source_note_id?: string | null
          status?: string
          tags?: string[] | null
          updated_at?: string | null
          user_id?: string
        }
        Update: {
          ai_visibility?: string
          completed_at?: string | null
          contact_id?: string | null
          content?: string
          created_at?: string | null
          due_date?: string | null
          id?: string
          metadata?: Json | null
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
      agent_instructions: {
        Row: {
          applies_to: string | null
          created_at: string | null
          id: string
          instruction: string
          is_active: boolean | null
          sort_order: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          applies_to?: string | null
          created_at?: string | null
          id?: string
          instruction: string
          is_active?: boolean | null
          sort_order?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          applies_to?: string | null
          created_at?: string | null
          id?: string
          instruction?: string
          is_active?: boolean | null
          sort_order?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
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
      ai_suggestion_preferences: {
        Row: {
          auto_add_sensitive: boolean
          created_at: string
          id: string
          person_blocklist: string[]
          profile_language: string
          suggestion_mode: string
          suggestion_sensitivity: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_add_sensitive?: boolean
          created_at?: string
          id?: string
          person_blocklist?: string[]
          profile_language?: string
          suggestion_mode?: string
          suggestion_sensitivity?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          auto_add_sensitive?: boolean
          created_at?: string
          id?: string
          person_blocklist?: string[]
          profile_language?: string
          suggestion_mode?: string
          suggestion_sensitivity?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_suggestion_suppressions: {
        Row: {
          created_at: string
          id: string
          normalized_value: string
          source_category: string | null
          suggestion_type: string
          suppression_key: string
          target_entity_id: string | null
          target_entity_type: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          normalized_value: string
          source_category?: string | null
          suggestion_type: string
          suppression_key: string
          target_entity_id?: string | null
          target_entity_type?: string | null
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          normalized_value?: string
          source_category?: string | null
          suggestion_type?: string
          suppression_key?: string
          target_entity_id?: string | null
          target_entity_type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      collection_item_folders: {
        Row: {
          collection_id: string
          created_at: string
          id: string
          name: string
          parent_folder_id: string | null
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          collection_id: string
          created_at?: string
          id?: string
          name: string
          parent_folder_id?: string | null
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          collection_id?: string
          created_at?: string
          id?: string
          name?: string
          parent_folder_id?: string | null
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_item_folders_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_item_folders_parent_folder_id_fkey"
            columns: ["parent_folder_id"]
            isOneToOne: false
            referencedRelation: "collection_item_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_items: {
        Row: {
          ai_visibility: string
          collection_id: string
          created_at: string
          data: Json
          folder_id: string | null
          id: string
          indexable_date_1: string | null
          indexable_date_2: string | null
          indexable_number_1: number | null
          indexable_number_2: number | null
          indexable_text_1: string | null
          is_favorite: boolean
          last_viewed_at: string | null
          search_vector: unknown
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_visibility?: string
          collection_id: string
          created_at?: string
          data?: Json
          folder_id?: string | null
          id?: string
          indexable_date_1?: string | null
          indexable_date_2?: string | null
          indexable_number_1?: number | null
          indexable_number_2?: number | null
          indexable_text_1?: string | null
          is_favorite?: boolean
          last_viewed_at?: string | null
          search_vector?: unknown
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_visibility?: string
          collection_id?: string
          created_at?: string
          data?: Json
          folder_id?: string | null
          id?: string
          indexable_date_1?: string | null
          indexable_date_2?: string | null
          indexable_number_1?: number | null
          indexable_number_2?: number | null
          indexable_text_1?: string | null
          is_favorite?: boolean
          last_viewed_at?: string | null
          search_vector?: unknown
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_items_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_items_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "collection_item_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_templates: {
        Row: {
          agent_instructions: string | null
          category: string | null
          created_at: string
          description: string | null
          field_schema: Json
          icon: string | null
          id: string
          name: string
          official: boolean
          slug: string
          usage_count: number
        }
        Insert: {
          agent_instructions?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          field_schema: Json
          icon?: string | null
          id?: string
          name: string
          official?: boolean
          slug: string
          usage_count?: number
        }
        Update: {
          agent_instructions?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          field_schema?: Json
          icon?: string | null
          id?: string
          name?: string
          official?: boolean
          slug?: string
          usage_count?: number
        }
        Relationships: []
      }
      collections: {
        Row: {
          agent_instructions: string | null
          created_at: string
          description: string | null
          field_schema: Json
          icon: string | null
          id: string
          name: string
          slug: string
          updated_at: string
          user_id: string
          visibility: string
        }
        Insert: {
          agent_instructions?: string | null
          created_at?: string
          description?: string | null
          field_schema?: Json
          icon?: string | null
          id?: string
          name: string
          slug: string
          updated_at?: string
          user_id: string
          visibility?: string
        }
        Update: {
          agent_instructions?: string | null
          created_at?: string
          description?: string | null
          field_schema?: Json
          icon?: string | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string
          user_id?: string
          visibility?: string
        }
        Relationships: []
      }
      connected_apps: {
        Row: {
          app_name: string
          connection_status: string
          created_at: string | null
          display_name: string
          id: string
          is_active: boolean | null
          key_hash: string | null
          key_prefix: string | null
          permissions: Json | null
          updated_at: string | null
          user_id: string
          webhook_url: string | null
        }
        Insert: {
          app_name: string
          connection_status?: string
          created_at?: string | null
          display_name: string
          id?: string
          is_active?: boolean | null
          key_hash?: string | null
          key_prefix?: string | null
          permissions?: Json | null
          updated_at?: string | null
          user_id?: string
          webhook_url?: string | null
        }
        Update: {
          app_name?: string
          connection_status?: string
          created_at?: string | null
          display_name?: string
          id?: string
          is_active?: boolean | null
          key_hash?: string | null
          key_prefix?: string | null
          permissions?: Json | null
          updated_at?: string | null
          user_id?: string
          webhook_url?: string | null
        }
        Relationships: []
      }
      contact_group_memberships: {
        Row: {
          archived_at: string | null
          attributes: Json
          contact_id: string
          created_at: string
          group_id: string
          id: string
          joined_at: string
          last_movement_at: string
          notes: string | null
          position: number
          priority: string
          reason: string | null
          source_note_ids: string[]
          status: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          attributes?: Json
          contact_id: string
          created_at?: string
          group_id: string
          id?: string
          joined_at?: string
          last_movement_at?: string
          notes?: string | null
          position?: number
          priority?: string
          reason?: string | null
          source_note_ids?: string[]
          status?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          attributes?: Json
          contact_id?: string
          created_at?: string
          group_id?: string
          id?: string
          joined_at?: string
          last_movement_at?: string
          notes?: string | null
          position?: number
          priority?: string
          reason?: string | null
          source_note_ids?: string[]
          status?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_group_memberships_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_group_memberships_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "contact_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_group_memberships_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_groups: {
        Row: {
          archived_at: string | null
          attributes_schema: Json
          color: string | null
          created_at: string
          description: string | null
          icon: string | null
          id: string
          is_trashed: boolean
          name: string
          parent_group_id: string | null
          purpose: string | null
          sensitivity: string
          slug: string
          stages: Json
          success_criteria: Json
          template: string | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          attributes_schema?: Json
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_trashed?: boolean
          name: string
          parent_group_id?: string | null
          purpose?: string | null
          sensitivity?: string
          slug: string
          stages?: Json
          success_criteria?: Json
          template?: string | null
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          attributes_schema?: Json
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_trashed?: boolean
          name?: string
          parent_group_id?: string | null
          purpose?: string | null
          sensitivity?: string
          slug?: string
          stages?: Json
          success_criteria?: Json
          template?: string | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_groups_parent_group_id_fkey"
            columns: ["parent_group_id"]
            isOneToOne: false
            referencedRelation: "contact_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_groups_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_interactions: {
        Row: {
          action_items: string[] | null
          contact_id: string
          created_at: string | null
          group_id: string | null
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
          group_id?: string | null
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
          group_id?: string | null
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
            foreignKeyName: "contact_interactions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "contact_groups"
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
      contact_relationships: {
        Row: {
          created_at: string
          custom_label: string | null
          evidence_note_id: string | null
          evidence_quote: string | null
          id: string
          inverse_id: string | null
          label: string
          origin: string
          pair_key: string | null
          source_id: string | null
          source_type: string
          target_id: string | null
          target_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          custom_label?: string | null
          evidence_note_id?: string | null
          evidence_quote?: string | null
          id?: string
          inverse_id?: string | null
          label: string
          origin?: string
          pair_key?: string | null
          source_id?: string | null
          source_type: string
          target_id?: string | null
          target_type: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          custom_label?: string | null
          evidence_note_id?: string | null
          evidence_quote?: string | null
          id?: string
          inverse_id?: string | null
          label?: string
          origin?: string
          pair_key?: string | null
          source_id?: string | null
          source_type?: string
          target_id?: string | null
          target_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_relationships_evidence_note_id_fkey"
            columns: ["evidence_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_relationships_inverse_id_fkey"
            columns: ["inverse_id"]
            isOneToOne: false
            referencedRelation: "contact_relationships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_relationships_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_relationships_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          ai_visibility: string
          aliases: string[] | null
          app_mappings: Json | null
          company: string | null
          contact_frequency_days: number | null
          conversation_context: string | null
          conversation_custom_tone: string | null
          conversation_intent: string | null
          conversation_preset_tone: string | null
          conversation_updated_at: string | null
          created_at: string | null
          email: string | null
          entity_classified_at: string | null
          entity_confidence: number | null
          entity_kind: string | null
          entity_reason: string | null
          id: string
          is_favorite: boolean
          is_sensitive: boolean
          last_contact_date: string | null
          last_viewed_at: string | null
          merged_at: string | null
          merged_into: string | null
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
          ai_visibility?: string
          aliases?: string[] | null
          app_mappings?: Json | null
          company?: string | null
          contact_frequency_days?: number | null
          conversation_context?: string | null
          conversation_custom_tone?: string | null
          conversation_intent?: string | null
          conversation_preset_tone?: string | null
          conversation_updated_at?: string | null
          created_at?: string | null
          email?: string | null
          entity_classified_at?: string | null
          entity_confidence?: number | null
          entity_kind?: string | null
          entity_reason?: string | null
          id?: string
          is_favorite?: boolean
          is_sensitive?: boolean
          last_contact_date?: string | null
          last_viewed_at?: string | null
          merged_at?: string | null
          merged_into?: string | null
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
          ai_visibility?: string
          aliases?: string[] | null
          app_mappings?: Json | null
          company?: string | null
          contact_frequency_days?: number | null
          conversation_context?: string | null
          conversation_custom_tone?: string | null
          conversation_intent?: string | null
          conversation_preset_tone?: string | null
          conversation_updated_at?: string | null
          created_at?: string | null
          email?: string | null
          entity_classified_at?: string | null
          entity_confidence?: number | null
          entity_kind?: string | null
          entity_reason?: string | null
          id?: string
          is_favorite?: boolean
          is_sensitive?: boolean
          last_contact_date?: string | null
          last_viewed_at?: string | null
          merged_at?: string | null
          merged_into?: string | null
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
        Relationships: [
          {
            foreignKeyName: "contacts_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          person_id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          person_id: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          person_id?: string
          role?: string
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
      dismissed_suggestions: {
        Row: {
          dismissed_at: string | null
          id: string
          source_note_id: string
          target_note_id: string
          user_id: string
        }
        Insert: {
          dismissed_at?: string | null
          id?: string
          source_note_id: string
          target_note_id: string
          user_id: string
        }
        Update: {
          dismissed_at?: string | null
          id?: string
          source_note_id?: string
          target_note_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dismissed_suggestions_source_note_id_fkey"
            columns: ["source_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dismissed_suggestions_target_note_id_fkey"
            columns: ["target_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      gdrive_connections: {
        Row: {
          channel_expires_at: string | null
          channel_id: string | null
          channel_token: string | null
          connection_key: string | null
          created_at: string
          google_email: string | null
          id: string
          last_error: string | null
          last_sync_at: string | null
          last_webhook_at: string | null
          start_page_token: string | null
          sync_enabled: boolean
          target_note_folder: string
          updated_at: string
          user_id: string
          watch_folder_id: string | null
          watch_folder_name: string | null
        }
        Insert: {
          channel_expires_at?: string | null
          channel_id?: string | null
          channel_token?: string | null
          connection_key?: string | null
          created_at?: string
          google_email?: string | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          last_webhook_at?: string | null
          start_page_token?: string | null
          sync_enabled?: boolean
          target_note_folder?: string
          updated_at?: string
          user_id: string
          watch_folder_id?: string | null
          watch_folder_name?: string | null
        }
        Update: {
          channel_expires_at?: string | null
          channel_id?: string | null
          channel_token?: string | null
          connection_key?: string | null
          created_at?: string
          google_email?: string | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          last_webhook_at?: string | null
          start_page_token?: string | null
          sync_enabled?: boolean
          target_note_folder?: string
          updated_at?: string
          user_id?: string
          watch_folder_id?: string | null
          watch_folder_name?: string | null
        }
        Relationships: []
      }
      gdrive_imports: {
        Row: {
          created_at: string
          error: string | null
          file_id: string
          file_name: string | null
          id: string
          imported_at: string
          mime_type: string | null
          note_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          file_id: string
          file_name?: string | null
          id?: string
          imported_at?: string
          mime_type?: string | null
          note_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          file_id?: string
          file_name?: string | null
          id?: string
          imported_at?: string
          mime_type?: string | null
          note_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gdrive_imports_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_logs: {
        Row: {
          created_at: string
          description: string
          id: string
          response: Json | null
          user_id: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          response?: Json | null
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          response?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      github_connections: {
        Row: {
          attachment_folder: string
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
          sync_people: boolean
          updated_at: string | null
          user_id: string
          vault_path: string | null
        }
        Insert: {
          attachment_folder?: string
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
          sync_people?: boolean
          updated_at?: string | null
          user_id: string
          vault_path?: string | null
        }
        Update: {
          attachment_folder?: string
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
          sync_people?: boolean
          updated_at?: string | null
          user_id?: string
          vault_path?: string | null
        }
        Relationships: []
      }
      github_sync_log: {
        Row: {
          entity_id: string
          entity_type: string
          error_message: string | null
          github_path: string
          github_sha: string | null
          id: string
          last_commit_sha: string | null
          note_id: string | null
          sync_direction: string | null
          sync_status: string | null
          synced_at: string | null
          user_id: string
        }
        Insert: {
          entity_id: string
          entity_type?: string
          error_message?: string | null
          github_path: string
          github_sha?: string | null
          id?: string
          last_commit_sha?: string | null
          note_id?: string | null
          sync_direction?: string | null
          sync_status?: string | null
          synced_at?: string | null
          user_id: string
        }
        Update: {
          entity_id?: string
          entity_type?: string
          error_message?: string | null
          github_path?: string
          github_sha?: string | null
          id?: string
          last_commit_sha?: string | null
          note_id?: string | null
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
      group_briefings: {
        Row: {
          briefing_markdown: string
          created_at: string
          generated_at: string
          group_id: string
          id: string
          period_days: number
          user_id: string
        }
        Insert: {
          briefing_markdown: string
          created_at?: string
          generated_at?: string
          group_id: string
          id?: string
          period_days?: number
          user_id?: string
        }
        Update: {
          briefing_markdown?: string
          created_at?: string
          generated_at?: string
          group_id?: string
          id?: string
          period_days?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_briefings_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "contact_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_api_keys: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          scopes: string[]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          scopes?: string[]
          user_id?: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          scopes?: string[]
          user_id?: string
        }
        Relationships: []
      }
      hub_api_usage: {
        Row: {
          created_at: string | null
          id: string
          key_id: string
          request_count: number
          window_start: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          key_id: string
          request_count?: number
          window_start: string
        }
        Update: {
          created_at?: string | null
          id?: string
          key_id?: string
          request_count?: number
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "hub_api_usage_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "hub_api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_call_configs: {
        Row: {
          call_site: string
          created_at: string
          description: string | null
          enabled: boolean
          extra_options: Json
          max_tokens: number | null
          model: string
          provider: string
          system_prompt: string | null
          temperature: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          call_site: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          extra_options?: Json
          max_tokens?: number | null
          model: string
          provider?: string
          system_prompt?: string | null
          temperature?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          call_site?: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          extra_options?: Json
          max_tokens?: number | null
          model?: string
          provider?: string
          system_prompt?: string | null
          temperature?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      llm_usage_events: {
        Row: {
          call_site: string | null
          completion_tokens: number
          config_source: string | null
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
          call_site?: string | null
          completion_tokens?: number
          config_source?: string | null
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
          call_site?: string | null
          completion_tokens?: number
          config_source?: string | null
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
      mcp_api_tokens: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          token_hash: string
          token_prefix: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          token_hash: string
          token_prefix: string
          user_id?: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          token_hash?: string
          token_prefix?: string
          user_id?: string
        }
        Relationships: []
      }
      mcp_call_logs: {
        Row: {
          created_at: string
          id: string
          input: Json
          output_summary: string | null
          success: boolean
          tool_name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          input?: Json
          output_summary?: string | null
          success?: boolean
          tool_name: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          input?: Json
          output_summary?: string | null
          success?: boolean
          tool_name?: string
          user_id?: string
        }
        Relationships: []
      }
      mcp_preferences: {
        Row: {
          created_at: string
          default_notes_visible: boolean
          default_people_visible: boolean
          hide_sensitive_from_ai: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_notes_visible?: boolean
          default_people_visible?: boolean
          hide_sensitive_from_ai?: boolean
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          default_notes_visible?: boolean
          default_people_visible?: boolean
          hide_sensitive_from_ai?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      media_analysis: {
        Row: {
          analysis_status: string
          created_at: string | null
          description: string | null
          embedding: string | null
          error_message: string | null
          extracted_text: string | null
          id: string
          media_type: string
          note_id: string
          original_filename: string | null
          page_number: number | null
          raw_analysis: Json | null
          storage_path: string
          topics: string[] | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          analysis_status?: string
          created_at?: string | null
          description?: string | null
          embedding?: string | null
          error_message?: string | null
          extracted_text?: string | null
          id?: string
          media_type: string
          note_id: string
          original_filename?: string | null
          page_number?: number | null
          raw_analysis?: Json | null
          storage_path: string
          topics?: string[] | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          analysis_status?: string
          created_at?: string | null
          description?: string | null
          embedding?: string | null
          error_message?: string | null
          extracted_text?: string | null
          id?: string
          media_type?: string
          note_id?: string
          original_filename?: string | null
          page_number?: number | null
          raw_analysis?: Json | null
          storage_path?: string
          topics?: string[] | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_analysis_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_events: {
        Row: {
          action: string
          category: string | null
          created_at: string
          flagged_content: string | null
          id: string
          item_id: string | null
          item_type: string
          matched_words: string[] | null
          result: string
          tier: string
          user_id: string
        }
        Insert: {
          action: string
          category?: string | null
          created_at?: string
          flagged_content?: string | null
          id?: string
          item_id?: string | null
          item_type: string
          matched_words?: string[] | null
          result?: string
          tier?: string
          user_id: string
        }
        Update: {
          action?: string
          category?: string | null
          created_at?: string
          flagged_content?: string | null
          id?: string
          item_id?: string | null
          item_type?: string
          matched_words?: string[] | null
          result?: string
          tier?: string
          user_id?: string
        }
        Relationships: []
      }
      moderation_review_queue: {
        Row: {
          ai_category: string | null
          ai_confidence: number | null
          ai_reason: string | null
          content_snapshot: string
          created_at: string
          id: string
          item_id: string
          item_type: string
          retry_count: number
          reviewed_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          ai_category?: string | null
          ai_confidence?: number | null
          ai_reason?: string | null
          content_snapshot: string
          created_at?: string
          id?: string
          item_id: string
          item_type: string
          retry_count?: number
          reviewed_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          ai_category?: string | null
          ai_confidence?: number | null
          ai_reason?: string | null
          content_snapshot?: string
          created_at?: string
          id?: string
          item_id?: string
          item_type?: string
          retry_count?: number
          reviewed_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      moderation_stopwords: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          id: string
          severity: string
          word: string
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          severity?: string
          word: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          severity?: string
          word?: string
        }
        Relationships: []
      }
      moment_participants: {
        Row: {
          moment_id: string
          person_id: string
        }
        Insert: {
          moment_id: string
          person_id: string
        }
        Update: {
          moment_id?: string
          person_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "moment_participants_moment_id_fkey"
            columns: ["moment_id"]
            isOneToOne: false
            referencedRelation: "moments"
            referencedColumns: ["id"]
          },
        ]
      }
      moment_provenance: {
        Row: {
          created_at: string
          document_id: string
          id: string
          language: string | null
          moment_id: string
          page_number: number | null
          snippet_en: string | null
          snippet_original: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          id?: string
          language?: string | null
          moment_id: string
          page_number?: number | null
          snippet_en?: string | null
          snippet_original?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          id?: string
          language?: string | null
          moment_id?: string
          page_number?: number | null
          snippet_en?: string | null
          snippet_original?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "moment_provenance_moment_id_fkey"
            columns: ["moment_id"]
            isOneToOne: false
            referencedRelation: "moments"
            referencedColumns: ["id"]
          },
        ]
      }
      moments: {
        Row: {
          ai_visibility: string
          attachments: Json | null
          category: string | null
          confidence_date: number
          confidence_truth: number
          created_at: string
          deleted_at: string | null
          description: string | null
          happened_at: string
          happened_end: string | null
          id: string
          impact_level: number
          is_potential_major: boolean
          merge_auto: boolean
          moment_uid: string
          person_id: string | null
          source: string
          status: string
          title: string
          updated_at: string
          user_id: string
          verified: boolean
        }
        Insert: {
          ai_visibility?: string
          attachments?: Json | null
          category?: string | null
          confidence_date?: number
          confidence_truth?: number
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          happened_at: string
          happened_end?: string | null
          id?: string
          impact_level?: number
          is_potential_major?: boolean
          merge_auto?: boolean
          moment_uid?: string
          person_id?: string | null
          source?: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
          verified?: boolean
        }
        Update: {
          ai_visibility?: string
          attachments?: Json | null
          category?: string | null
          confidence_date?: number
          confidence_truth?: number
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          happened_at?: string
          happened_end?: string | null
          id?: string
          impact_level?: number
          is_potential_major?: boolean
          merge_auto?: boolean
          moment_uid?: string
          person_id?: string | null
          source?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
          verified?: boolean
        }
        Relationships: []
      }
      name_disambiguation_decisions: {
        Row: {
          alias_lower: string
          confidence: number
          context_kind: string
          created_at: string
          decision_count: number
          id: string
          last_seen_at: string
          target: string
          target_contact_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          alias_lower: string
          confidence?: number
          context_kind?: string
          created_at?: string
          decision_count?: number
          id?: string
          last_seen_at?: string
          target: string
          target_contact_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          alias_lower?: string
          confidence?: number
          context_kind?: string
          created_at?: string
          decision_count?: number
          id?: string
          last_seen_at?: string
          target?: string
          target_contact_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      note_attachments: {
        Row: {
          created_at: string
          filename: string
          github_path: string | null
          github_sha: string | null
          github_synced_at: string | null
          id: string
          mime_type: string | null
          sha256: string | null
          size_bytes: number | null
          source: string
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filename: string
          github_path?: string | null
          github_sha?: string | null
          github_synced_at?: string | null
          id?: string
          mime_type?: string | null
          sha256?: string | null
          size_bytes?: number | null
          source?: string
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          filename?: string
          github_path?: string | null
          github_sha?: string | null
          github_synced_at?: string | null
          id?: string
          mime_type?: string | null
          sha256?: string | null
          size_bytes?: number | null
          source?: string
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      note_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          embedding: string | null
          heading_path: string | null
          id: string
          note_id: string
          token_count: number
          user_id: string
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          embedding?: string | null
          heading_path?: string | null
          id?: string
          note_id: string
          token_count?: number
          user_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          embedding?: string | null
          heading_path?: string | null
          id?: string
          note_id?: string
          token_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_chunks_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
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
      note_folders: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_path: string
          path: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_path?: string
          path: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_path?: string
          path?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notes: {
        Row: {
          ai_visibility: string
          content: string
          created_at: string | null
          embedding: string | null
          entity_type: string | null
          folder_path: string
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
          ai_visibility?: string
          content?: string
          created_at?: string | null
          embedding?: string | null
          entity_type?: string | null
          folder_path?: string
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
          ai_visibility?: string
          content?: string
          created_at?: string | null
          embedding?: string | null
          entity_type?: string | null
          folder_path?: string
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
      person_documents: {
        Row: {
          content: string
          created_at: string
          doc_type: string
          embedding: string | null
          embedding_updated_at: string | null
          id: string
          memory_type: string
          person_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          doc_type?: string
          embedding?: string | null
          embedding_updated_at?: string | null
          id?: string
          memory_type?: string
          person_id: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          doc_type?: string
          embedding?: string | null
          embedding_updated_at?: string | null
          id?: string
          memory_type?: string
          person_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profile_categories: {
        Row: {
          contact_id: string | null
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          is_default: boolean | null
          name: string
          slug: string
          sort_order: number | null
          updated_at: string | null
          user_id: string
          visibility_scope: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          slug: string
          sort_order?: number | null
          updated_at?: string | null
          user_id: string
          visibility_scope?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          slug?: string
          sort_order?: number | null
          updated_at?: string | null
          user_id?: string
          visibility_scope?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profile_categories_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_entries: {
        Row: {
          category_id: string
          contact_id: string | null
          created_at: string | null
          id: string
          is_pinned: boolean
          label: string
          linked_note_id: string | null
          sort_order: number | null
          updated_at: string | null
          user_id: string
          value: string
        }
        Insert: {
          category_id: string
          contact_id?: string | null
          created_at?: string | null
          id?: string
          is_pinned?: boolean
          label: string
          linked_note_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
          user_id: string
          value: string
        }
        Update: {
          category_id?: string
          contact_id?: string | null
          created_at?: string | null
          id?: string
          is_pinned?: boolean
          label?: string
          linked_note_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
          user_id?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_entries_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "profile_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_entries_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_entries_linked_note_id_fkey"
            columns: ["linked_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_normalization_jobs: {
        Row: {
          attempts: number
          claimed_at: string | null
          contact_id: string | null
          created_at: string
          id: string
          last_error: string | null
          processed_at: string | null
          reason: string | null
          requested_at: string
          status: string
          subject_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          processed_at?: string | null
          reason?: string | null
          requested_at?: string
          status?: string
          subject_type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          processed_at?: string | null
          reason?: string | null
          requested_at?: string
          status?: string
          subject_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profile_normalization_runs: {
        Row: {
          applied_count: number
          completed_at: string | null
          contact_id: string | null
          created_at: string
          error_message: string | null
          id: string
          input_hash: string
          planned_count: number
          review_count: number
          skipped_count: number
          started_at: string
          status: string
          subject_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          applied_count?: number
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          input_hash: string
          planned_count?: number
          review_count?: number
          skipped_count?: number
          started_at?: string
          status?: string
          subject_type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          applied_count?: number
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          input_hash?: string
          planned_count?: number
          review_count?: number
          skipped_count?: number
          started_at?: string
          status?: string
          subject_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profile_views: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          included_scopes: string[]
          name: string
          slug: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          included_scopes?: string[]
          name: string
          slug: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          included_scopes?: string[]
          name?: string
          slug?: string
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
          self_matching_enabled: boolean
          updated_at: string
          website: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          self_matching_enabled?: boolean
          updated_at?: string
          website?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          self_matching_enabled?: boolean
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      relationship_evidence: {
        Row: {
          adjudicated_label: string | null
          adjudication_version: string
          confidence: number
          created_at: string
          fictional_or_roleplay: boolean | null
          id: string
          incidental_or_transactional: boolean | null
          note_content_hash: string
          outcome: string
          personally_relevant: boolean | null
          proposed_label: string
          real_person_a: boolean | null
          real_person_b: boolean | null
          reason: string
          relationship_id: string | null
          relationship_supported: boolean | null
          same_as_relationship_id: string | null
          source_context: string | null
          source_note_id: string | null
          source_quote: string
          updated_at: string
          user_id: string
        }
        Insert: {
          adjudicated_label?: string | null
          adjudication_version: string
          confidence?: number
          created_at?: string
          fictional_or_roleplay?: boolean | null
          id?: string
          incidental_or_transactional?: boolean | null
          note_content_hash: string
          outcome: string
          personally_relevant?: boolean | null
          proposed_label: string
          real_person_a?: boolean | null
          real_person_b?: boolean | null
          reason: string
          relationship_id?: string | null
          relationship_supported?: boolean | null
          same_as_relationship_id?: string | null
          source_context?: string | null
          source_note_id?: string | null
          source_quote: string
          updated_at?: string
          user_id: string
        }
        Update: {
          adjudicated_label?: string | null
          adjudication_version?: string
          confidence?: number
          created_at?: string
          fictional_or_roleplay?: boolean | null
          id?: string
          incidental_or_transactional?: boolean | null
          note_content_hash?: string
          outcome?: string
          personally_relevant?: boolean | null
          proposed_label?: string
          real_person_a?: boolean | null
          real_person_b?: boolean | null
          reason?: string
          relationship_id?: string | null
          relationship_supported?: boolean | null
          same_as_relationship_id?: string | null
          source_context?: string | null
          source_note_id?: string | null
          source_quote?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "relationship_evidence_relationship_id_fkey"
            columns: ["relationship_id"]
            isOneToOne: false
            referencedRelation: "contact_relationships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "relationship_evidence_same_as_relationship_id_fkey"
            columns: ["same_as_relationship_id"]
            isOneToOne: false
            referencedRelation: "contact_relationships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "relationship_evidence_source_note_id_fkey"
            columns: ["source_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      relationship_repair_items: {
        Row: {
          confidence: number | null
          created_at: string
          error: string | null
          evidence_quote: string | null
          id: string
          new_label: string | null
          old_label: string
          outcome: string
          person_a: string
          person_b: string
          reason: string
          relationship_id: string | null
          run_id: string
          snapshot: Json
          source_note_id: string | null
          user_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          error?: string | null
          evidence_quote?: string | null
          id?: string
          new_label?: string | null
          old_label: string
          outcome: string
          person_a: string
          person_b: string
          reason: string
          relationship_id?: string | null
          run_id: string
          snapshot?: Json
          source_note_id?: string | null
          user_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          error?: string | null
          evidence_quote?: string | null
          id?: string
          new_label?: string | null
          old_label?: string
          outcome?: string
          person_a?: string
          person_b?: string
          reason?: string
          relationship_id?: string | null
          run_id?: string
          snapshot?: Json
          source_note_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "relationship_repair_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "relationship_repair_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "relationship_repair_items_source_note_id_fkey"
            columns: ["source_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      relationship_repair_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          cursor_created_at: string | null
          cursor_id: string | null
          failed_count: number
          id: string
          kept_count: number
          merged_count: number
          processed_relationships: number
          queued_count: number
          relabeled_count: number
          removed_count: number
          started_at: string | null
          status: string
          summary: Json
          total_relationships: number
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          cursor_created_at?: string | null
          cursor_id?: string | null
          failed_count?: number
          id?: string
          kept_count?: number
          merged_count?: number
          processed_relationships?: number
          queued_count?: number
          relabeled_count?: number
          removed_count?: number
          started_at?: string | null
          status?: string
          summary?: Json
          total_relationships?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          cursor_created_at?: string | null
          cursor_id?: string | null
          failed_count?: number
          id?: string
          kept_count?: number
          merged_count?: number
          processed_relationships?: number
          queued_count?: number
          relabeled_count?: number
          removed_count?: number
          started_at?: string | null
          status?: string
          summary?: Json
          total_relationships?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      review_queue: {
        Row: {
          applied_at: string | null
          blocked_at: string | null
          confidence_score: number | null
          created_at: string
          description: string | null
          extracted_value: string | null
          id: string
          is_sensitive: boolean
          payload: Json
          reviewed_at: string | null
          snoozed_until: string | null
          source_note_id: string | null
          source_title: string | null
          status: string
          suggestion_type: string
          suppression_key: string | null
          target_entity_id: string | null
          target_entity_type: string | null
          title: string
          user_id: string
        }
        Insert: {
          applied_at?: string | null
          blocked_at?: string | null
          confidence_score?: number | null
          created_at?: string
          description?: string | null
          extracted_value?: string | null
          id?: string
          is_sensitive?: boolean
          payload?: Json
          reviewed_at?: string | null
          snoozed_until?: string | null
          source_note_id?: string | null
          source_title?: string | null
          status?: string
          suggestion_type: string
          suppression_key?: string | null
          target_entity_id?: string | null
          target_entity_type?: string | null
          title: string
          user_id?: string
        }
        Update: {
          applied_at?: string | null
          blocked_at?: string | null
          confidence_score?: number | null
          created_at?: string
          description?: string | null
          extracted_value?: string | null
          id?: string
          is_sensitive?: boolean
          payload?: Json
          reviewed_at?: string | null
          snoozed_until?: string | null
          source_note_id?: string | null
          source_title?: string | null
          status?: string
          suggestion_type?: string
          suppression_key?: string | null
          target_entity_id?: string | null
          target_entity_type?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_queue_source_note_id_fkey"
            columns: ["source_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      review_queue_bulk_jobs: {
        Row: {
          action: string
          created_at: string
          done: number
          failed: number
          finished_at: string | null
          id: string
          last_error: string | null
          scope: string
          started_at: string
          status: string
          total: number
          updated_at: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          done?: number
          failed?: number
          finished_at?: string | null
          id?: string
          last_error?: string | null
          scope?: string
          started_at?: string
          status?: string
          total?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          done?: number
          failed?: number
          finished_at?: string | null
          id?: string
          last_error?: string | null
          scope?: string
          started_at?: string
          status?: string
          total?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      shared_notes: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          note_id: string
          share_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          note_id: string
          share_token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          note_id?: string
          share_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_notes_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: true
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
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
      user_mcp_servers: {
        Row: {
          auth: Json
          created_at: string
          enabled: boolean
          id: string
          name: string
          updated_at: string
          url: string
          user_id: string
        }
        Insert: {
          auth?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          updated_at?: string
          url: string
          user_id?: string
        }
        Update: {
          auth?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          updated_at?: string
          url?: string
          user_id?: string
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
      user_self_aliases: {
        Row: {
          alias: string
          created_at: string
          id: string
          is_active: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          alias: string
          created_at?: string
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          alias?: string
          created_at?: string
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_suspensions: {
        Row: {
          created_at: string
          id: string
          strike_count: number
          suspended: boolean
          suspended_at: string | null
          suspended_until: string | null
          suspension_reason: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          strike_count?: number
          suspended?: boolean
          suspended_at?: string | null
          suspended_until?: string | null
          suspension_reason?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          strike_count?: number
          suspended?: boolean
          suspended_at?: string | null
          suspended_until?: string | null
          suspension_reason?: string | null
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
      wiki_links: {
        Row: {
          created_at: string
          id: string
          source_page_id: string
          target_page_id: string | null
          target_slug: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          source_page_id: string
          target_page_id?: string | null
          target_slug: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          source_page_id?: string
          target_page_id?: string | null
          target_slug?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wiki_links_source_page_id_fkey"
            columns: ["source_page_id"]
            isOneToOne: false
            referencedRelation: "wiki_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wiki_links_target_page_id_fkey"
            columns: ["target_page_id"]
            isOneToOne: false
            referencedRelation: "wiki_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      wiki_log: {
        Row: {
          created_at: string
          details: Json
          id: string
          operation: string
          user_id: string
        }
        Insert: {
          created_at?: string
          details?: Json
          id?: string
          operation: string
          user_id: string
        }
        Update: {
          created_at?: string
          details?: Json
          id?: string
          operation?: string
          user_id?: string
        }
        Relationships: []
      }
      wiki_page_sources: {
        Row: {
          created_at: string
          id: string
          note_id: string
          user_id: string
          wiki_page_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note_id: string
          user_id: string
          wiki_page_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note_id?: string
          user_id?: string
          wiki_page_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wiki_page_sources_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wiki_page_sources_wiki_page_id_fkey"
            columns: ["wiki_page_id"]
            isOneToOne: false
            referencedRelation: "wiki_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      wiki_pages: {
        Row: {
          content: string
          created_at: string
          id: string
          last_members_synced_at: string | null
          last_synthesized_at: string | null
          metadata: Json
          page_type: string
          protected_sections: string[]
          restructure_attempts: number
          restructure_blocked_until: string | null
          restructure_content_hash: string | null
          restructure_last_error: string | null
          slug: string
          source_count: number
          summary: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          last_members_synced_at?: string | null
          last_synthesized_at?: string | null
          metadata?: Json
          page_type?: string
          protected_sections?: string[]
          restructure_attempts?: number
          restructure_blocked_until?: string | null
          restructure_content_hash?: string | null
          restructure_last_error?: string | null
          slug: string
          source_count?: number
          summary?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          last_members_synced_at?: string | null
          last_synthesized_at?: string | null
          metadata?: Json
          page_type?: string
          protected_sections?: string[]
          restructure_attempts?: number
          restructure_blocked_until?: string | null
          restructure_content_hash?: string | null
          restructure_last_error?: string | null
          slug?: string
          source_count?: number
          summary?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wiki_revisions: {
        Row: {
          change_summary: string | null
          change_type: string
          created_at: string
          id: string
          new_content: string
          page_slug: string
          page_title: string
          previous_content: string | null
          reviewed_at: string | null
          rolled_back_at: string | null
          source_note_id: string | null
          source_revision_id: string | null
          status: string
          user_id: string
          wiki_page_id: string | null
        }
        Insert: {
          change_summary?: string | null
          change_type: string
          created_at?: string
          id?: string
          new_content: string
          page_slug: string
          page_title: string
          previous_content?: string | null
          reviewed_at?: string | null
          rolled_back_at?: string | null
          source_note_id?: string | null
          source_revision_id?: string | null
          status?: string
          user_id: string
          wiki_page_id?: string | null
        }
        Update: {
          change_summary?: string | null
          change_type?: string
          created_at?: string
          id?: string
          new_content?: string
          page_slug?: string
          page_title?: string
          previous_content?: string | null
          reviewed_at?: string | null
          rolled_back_at?: string | null
          source_note_id?: string | null
          source_revision_id?: string | null
          status?: string
          user_id?: string
          wiki_page_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wiki_revisions_source_note_id_fkey"
            columns: ["source_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wiki_revisions_source_revision_id_fkey"
            columns: ["source_revision_id"]
            isOneToOne: false
            referencedRelation: "wiki_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wiki_revisions_wiki_page_id_fkey"
            columns: ["wiki_page_id"]
            isOneToOne: false
            referencedRelation: "wiki_pages"
            referencedColumns: ["id"]
          },
        ]
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
      ai_can_see: {
        Args: { _id: string; _kind: string; _user_id: string }
        Returns: boolean
      }
      ai_hidden_counts: {
        Args: { _user_id: string }
        Returns: {
          action_items_hidden: number
          collection_items_hidden: number
          contacts_hidden: number
          contacts_sensitive: number
          moments_hidden: number
          notes_hidden: number
        }[]
      }
      backfill_accumulator_profile_entries: { Args: never; Returns: Json }
      cleanup_profile_duplicates: {
        Args: { _contact_id: string; _user_id: string }
        Returns: Json
      }
      cleanup_profile_token_duplicates: { Args: never; Returns: Json }
      deduct_ai_tokens:
        | {
            Args: {
              p_completion_tokens?: number
              p_feature: string
              p_idempotency_key?: string
              p_model?: string
              p_prompt_tokens?: number
              p_provider?: string
              p_tokens: number
              p_user_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_completion_tokens?: number
              p_feature: string
              p_idempotency_key?: string
              p_model?: string
              p_prompt_tokens?: number
              p_provider?: string
              p_tokens: number
              p_usage_source?: string
              p_user_id: string
            }
            Returns: Json
          }
      enqueue_profile_normalization_job: {
        Args: { p_contact_id: string; p_reason?: string; p_user_id: string }
        Returns: undefined
      }
      get_shared_note_by_token: { Args: { p_token: string }; Returns: Json }
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
      increment_collection_template_usage: {
        Args: { p_slug: string }
        Returns: undefined
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_premium_user: { Args: { _user_id: string }; Returns: boolean }
      lookup_mcp_token: {
        Args: { _token_hash: string }
        Returns: {
          expires_at: string
          id: string
          revoked_at: string
          user_id: string
        }[]
      }
      match_media: {
        Args: {
          match_count?: number
          match_threshold?: number
          p_user_id?: string
          query_embedding: string
        }
        Returns: {
          created_at: string
          description: string
          extracted_text: string
          id: string
          media_type: string
          note_id: string
          note_title: string
          original_filename: string
          page_number: number
          raw_analysis: Json
          similarity: number
          storage_path: string
          topics: string[]
        }[]
      }
      match_note_chunks: {
        Args: {
          match_count?: number
          match_threshold?: number
          p_user_id?: string
          query_embedding: string
        }
        Returns: {
          chunk_id: string
          chunk_index: number
          content: string
          heading_path: string
          note_created_at: string
          note_id: string
          note_title: string
          similarity: number
        }[]
      }
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
      match_person_documents: {
        Args: {
          match_count?: number
          match_person_id: string
          match_threshold?: number
          match_user_id: string
          query_embedding: string
        }
        Returns: {
          content: string
          id: string
          similarity: number
          title: string
        }[]
      }
      mcp_can_see: {
        Args: { _id: string; _kind: string; _user_id: string }
        Returns: boolean
      }
      mcp_hidden_counts: {
        Args: { _user_id: string }
        Returns: {
          action_items_hidden: number
          collection_items_hidden: number
          contacts_hidden: number
          contacts_sensitive: number
          moments_hidden: number
          notes_hidden: number
        }[]
      }
      mcp_sensitive_person_ids: {
        Args: { _user_id: string }
        Returns: string[]
      }
      profile_canonical_label: { Args: { t: string }; Returns: string }
      profile_dedup_value_against_keys: {
        Args: { _seen_keys: string[]; _value: string }
        Returns: string
      }
      profile_dedup_value_tokens: {
        Args: { _label: string; _value: string }
        Returns: string
      }
      profile_duplicate_scope_key: { Args: { _label: string }; Returns: string }
      profile_entry_norm_text: { Args: { p_value: string }; Returns: string }
      profile_existing_token_keys: {
        Args: {
          _contact_id: string
          _exclude_id?: string
          _label: string
          _user_id: string
        }
        Returns: string[]
      }
      profile_fact_label_key: { Args: { t: string }; Returns: string }
      profile_fact_text_key: { Args: { t: string }; Returns: string }
      profile_fact_token_key: { Args: { t: string }; Returns: string }
      profile_integrity_blocked_relationship_label: {
        Args: { p_label: string }
        Returns: boolean
      }
      profile_integrity_relationship_pair: {
        Args: {
          p_source_id: string
          p_source_type: string
          p_target_id: string
          p_target_type: string
          p_user_id: string
        }
        Returns: boolean
      }
      profile_is_accumulator_label: {
        Args: { p_canonical: string }
        Returns: boolean
      }
      profile_label_token_priority: {
        Args: { _label: string }
        Returns: number
      }
      profile_norm_label: { Args: { t: string }; Returns: string }
      profile_norm_value: { Args: { t: string }; Returns: string }
      profile_token_key_contains: {
        Args: { subset_key: string; superset_key: string }
        Returns: boolean
      }
      profile_token_keys_overlap: {
        Args: { a: string; b: string }
        Returns: boolean
      }
      profile_tokenize_value: { Args: { t: string }; Returns: string[] }
      profile_value_contains_fact: {
        Args: { subset: string; superset: string }
        Returns: boolean
      }
      relationship_canonical_label: { Args: { p: string }; Returns: string }
      relationship_inverse_label: { Args: { p: string }; Returns: string }
      relationship_is_bond: { Args: { p: string }; Returns: boolean }
      relationship_is_symmetric: { Args: { p: string }; Returns: boolean }
      relationship_label_map: { Args: { p_key: string }; Returns: string }
      relationship_normalize_label: { Args: { p: string }; Returns: string }
      relationship_pair_key: {
        Args: {
          p_label: string
          p_user: string
          s_id: string
          s_type: string
          t_id: string
          t_type: string
        }
        Returns: string
      }
      relationship_person_pair: {
        Args: {
          p_user: string
          s_id: string
          s_type: string
          t_id: string
          t_type: string
        }
        Returns: string
      }
      relationship_strength: { Args: { p: string }; Returns: number }
      replace_group_members_section: {
        Args: { p_content: string; p_members_section: string }
        Returns: string
      }
      slugify_collection_name: { Args: { p_name: string }; Returns: string }
      sync_group_wiki_members: {
        Args: { p_force?: boolean; p_group_id: string }
        Returns: Json
      }
      wiki_apply_ingest: {
        Args: { p_actions: Json; p_note_id: string; p_source_links: Json }
        Returns: Json
      }
      wiki_resync_links: { Args: { p_page_id: string }; Returns: undefined }
      wiki_rollback_revision: { Args: { p_revision_id: string }; Returns: Json }
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
