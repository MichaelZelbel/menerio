export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type TableDefinition<Row, Insert = Partial<Row>, Update = Partial<Row>, Relationships extends readonly unknown[] = []> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: Relationships;
};

type GenericTable = TableDefinition<
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
  []
>;

export type Database = {
  public: {
    Tables: {
      [key: string]: GenericTable;
      contact_groups: TableDefinition<
        {
          id: string;
          user_id: string;
          name: string;
          slug: string;
          description: string | null;
          purpose: string | null;
          type: string;
          template: string | null;
          success_criteria: Json;
          stages: Json;
          attributes_schema: Json;
          sensitivity: string;
          icon: string | null;
          color: string | null;
          is_trashed: boolean;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          name: string;
          slug: string;
          description?: string | null;
          purpose?: string | null;
          type?: string;
          template?: string | null;
          success_criteria?: Json;
          stages?: Json;
          attributes_schema?: Json;
          sensitivity?: string;
          icon?: string | null;
          color?: string | null;
          is_trashed?: boolean;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        },
        {
          id?: string;
          user_id?: string;
          name?: string;
          slug?: string;
          description?: string | null;
          purpose?: string | null;
          type?: string;
          template?: string | null;
          success_criteria?: Json;
          stages?: Json;
          attributes_schema?: Json;
          sensitivity?: string;
          icon?: string | null;
          color?: string | null;
          is_trashed?: boolean;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        },
        []
      >;
      contact_group_memberships: TableDefinition<
        {
          id: string;
          group_id: string;
          person_id: string;
          user_id: string;
          status: string | null;
          priority: string;
          position: number;
          reason: string | null;
          notes: string | null;
          attributes: Json;
          source_note_ids: string[];
          joined_at: string;
          last_movement_at: string;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          group_id: string;
          person_id: string;
          user_id: string;
          status?: string | null;
          priority?: string;
          position?: number;
          reason?: string | null;
          notes?: string | null;
          attributes?: Json;
          source_note_ids?: string[];
          joined_at?: string;
          last_movement_at?: string;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        },
        {
          id?: string;
          group_id?: string;
          person_id?: string;
          user_id?: string;
          status?: string | null;
          priority?: string;
          position?: number;
          reason?: string | null;
          notes?: string | null;
          attributes?: Json;
          source_note_ids?: string[];
          joined_at?: string;
          last_movement_at?: string;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        },
        [
          {
            foreignKeyName: "contact_group_memberships_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "contact_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contact_group_memberships_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          }
        ]
      >;
      contact_interactions: TableDefinition<
        {
          action_items: string[] | null;
          contact_id: string;
          created_at: string | null;
          group_id: string | null;
          id: string;
          interaction_date: string;
          note_id: string | null;
          summary: string | null;
          type: string;
          user_id: string;
        },
        {
          action_items?: string[] | null;
          contact_id: string;
          created_at?: string | null;
          group_id?: string | null;
          id?: string;
          interaction_date?: string;
          note_id?: string | null;
          summary?: string | null;
          type: string;
          user_id?: string;
        },
        {
          action_items?: string[] | null;
          contact_id?: string;
          created_at?: string | null;
          group_id?: string | null;
          id?: string;
          interaction_date?: string;
          note_id?: string | null;
          summary?: string | null;
          type?: string;
          user_id?: string;
        },
        [
          {
            foreignKeyName: "contact_interactions_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "contact_groups";
            referencedColumns: ["id"];
          }
        ]
      >;
    };
    Views: { [key: string]: { Row: Record<string, unknown>; Relationships: [] } };
    Functions: { [key: string]: { Args: Record<string, unknown>; Returns: unknown } };
    Enums: { [key: string]: string };
    CompositeTypes: { [key: string]: unknown };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;
