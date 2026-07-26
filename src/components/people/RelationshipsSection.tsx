import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useContactRelationships, type ContactRelationship } from "@/hooks/useContactRelationships";
import { ALL_RELATIONSHIP_LABELS } from "@/lib/relationship-labels";
import {
  canonicalLabel,
  describeRelationship,
  genderFromFacts,
  isRomanticSocialBond,
  relationshipStrength,
  type Gender,
} from "@/lib/relationship-canonical";

import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { showToast } from "@/lib/toast";

export interface RelationshipMilestone {
  id: string;
  label: string;
  value: string;
}

interface RelationshipsSectionProps {
  /** null = viewing own profile ("self") */
  contactId: string | null;
  contactName: string;
  /**
   * Non-edge relational facts (Wedding date, Anniversary, How we met…). They
   * render inside this card so a profile has exactly ONE relationship surface.
   */
  milestones?: RelationshipMilestone[];
}

export function RelationshipsSection({ contactId, contactName, milestones = [] }: RelationshipsSectionProps) {
  const { user } = useAuth();
  const { relationships, isLoading, upsertRelationship, deleteRelationship } = useContactRelationships(contactId);

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formLabel, setFormLabel] = useState("");
  const [formCustomLabel, setFormCustomLabel] = useState("");
  const [formTargetType, setFormTargetType] = useState<"contact" | "self">("contact");
  const [formTargetId, setFormTargetId] = useState("");

  // Fetch user's display name for "self" references
  const { data: profile } = useQuery({
    queryKey: ["my-profile-name"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user!.id)
        .single();
      return data;
    },
    enabled: !!user,
  });
  const myName = profile?.display_name || "Me";

  // Fetch contacts for the picker
  const { data: allContacts = [] } = useQuery({
    queryKey: ["contacts-for-relationship-picker"],
    queryFn: async () => {
      const { data } = await supabase
        .from("contacts")
        .select("id, name")
        .eq("user_id", user!.id)
        .is("merged_into", null)
        .order("name");
      return data || [];
    },
    enabled: !!user,
  });

  const resetForm = () => {
    setFormLabel("");
    setFormCustomLabel("");
    setFormTargetType("contact");
    setFormTargetId("");
    setAdding(false);
    setEditingId(null);
  };

  const handleSave = () => {
    if (!formLabel) {
      showToast.error("Please select a relationship label");
      return;
    }
    if (formTargetType === "contact" && !formTargetId) {
      showToast.error("Please select a person");
      return;
    }

    // Source is the entity whose profile we're viewing
    const sourceType = contactId ? "contact" : "self";
    const sourceId = contactId || null;

    upsertRelationship.mutate(
      {
        id: editingId || undefined,
        source_type: sourceType,
        source_id: sourceId,
        target_type: formTargetType,
        target_id: formTargetType === "contact" ? formTargetId : null,
        label: formLabel,
        custom_label: formCustomLabel.trim() || null,
      },
      {
        onSuccess: () => {
          showToast.success("Relationship saved");
          resetForm();
        },
        onError: (err: any) => {
          if (err.message?.includes("uq_contact_relationship")) {
            showToast.error("This relationship already exists");
          } else {
            showToast.error(err.message || "Failed to save");
          }
        },
      }
    );
  };

  const startEdit = (rel: ContactRelationship) => {
    setEditingId(rel.id);
    setFormLabel(rel.label);
    setFormCustomLabel(rel.custom_label || "");

    // Determine the "other" side of the relationship from the viewed profile's perspective
    const viewingIsSource =
      (contactId === null && rel.source_type === "self") ||
      (contactId !== null && rel.source_type === "contact" && rel.source_id === contactId);

    if (viewingIsSource) {
      setFormTargetType(rel.target_type as "contact" | "self");
      setFormTargetId(rel.target_id || "");
    } else {
      setFormTargetType(rel.source_type as "contact" | "self");
      setFormTargetId(rel.source_id || "");
    }
    setAdding(true);
  };

  const handleDelete = (id: string) => {
    deleteRelationship.mutate(id, {
      onSuccess: () => showToast.success("Relationship removed"),
      onError: (err: any) => showToast.error(err.message || "Failed to delete"),
    });
  };

  // Filter out current contact from the picker
  const availableContacts = allContacts.filter((c) => c.id !== contactId);

  if (isLoading) return null;

  // Derived relationship status — never a stored, LLM-authored string.
  const derivedStatus = (() => {
    const labels = relationships.map((r) => canonicalLabel(r.custom_label || r.label));
    if (labels.some((l) => l === "spouse" || l === "husband" || l === "wife")) return "Married";
    if (labels.some((l) => l === "partner")) return "In a relationship";
    return null;
  })();

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between p-3 pb-2">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Relationships</h3>
          {relationships.length > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {relationships.length}
            </Badge>
          )}
          {derivedStatus && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
              {derivedStatus}
            </Badge>
          )}
        </div>
        {!adding && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAdding(true)}>
            <Plus className="h-3 w-3 mr-1" /> Add
          </Button>
        )}
      </div>


      {/* Existing relationships */}
      {relationships.length > 0 && (
        <div className="px-3 pb-2 space-y-1">
          {relationships.map((rel) => {
            const { otherName, displayLabel } = getRelationshipDisplay({
              sourceType: rel.source_type,
              sourceId: rel.source_id,
              targetType: rel.target_type,
              targetId: rel.target_id,
              label: rel.label,
              customLabel: rel.custom_label,
              viewingContactId: contactId,
              sourceName: rel.source_type === "self" ? myName : (rel.source_contact?.name || "Unknown"),
              targetName: rel.target_type === "self" ? myName : (rel.target_contact?.name || "Unknown"),
            });

            // Determine the other person's contact ID for linking
            const otherContactId =
              contactId === null
                ? (rel.source_type === "contact" ? rel.source_id : rel.target_type === "contact" ? rel.target_id : null)
                : (rel.source_id === contactId ? rel.target_id : rel.source_id);
            const otherIsSelf =
              contactId === null
                ? false
                : (rel.source_id === contactId ? rel.target_type === "self" : rel.source_type === "self");

            return (
              <div key={rel.id} className="flex items-center justify-between group py-1 px-2 rounded hover:bg-muted/50 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  <Badge variant="outline" className="text-[10px] shrink-0">{displayLabel}</Badge>
                  {otherIsSelf ? (
                    <Link to="/dashboard/profile" className="text-foreground hover:underline truncate">
                      {myName}
                    </Link>
                  ) : otherContactId ? (
                    <Link to={`/dashboard/people/${otherContactId}`} className="text-foreground hover:underline truncate">
                      {otherName}
                    </Link>
                  ) : (
                    <span className="truncate">{otherName}</span>
                  )}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => startEdit(rel)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDelete(rel.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {relationships.length === 0 && !adding && (
        <p className="px-3 pb-3 text-xs text-muted-foreground">
          No relationships yet. Add one to track how people are connected.
        </p>
      )}

      {/* Add/edit form */}
      {adding && (
        <div className="px-3 pb-3 space-y-2 border-t border-border pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Select value={formLabel} onValueChange={setFormLabel}>
              <SelectTrigger className="text-sm h-8">
                <SelectValue placeholder="Select label…" />
              </SelectTrigger>
              <SelectContent>
                {ALL_RELATIONSHIP_LABELS.map((l) => (
                  <SelectItem key={l} value={l} className="capitalize">{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              placeholder="Custom label (optional)"
              value={formCustomLabel}
              onChange={(e) => setFormCustomLabel(e.target.value)}
              className="text-sm h-8"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Select value={formTargetType} onValueChange={(v) => { setFormTargetType(v as "contact" | "self"); setFormTargetId(""); }}>
              <SelectTrigger className="text-sm h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="contact">A contact</SelectItem>
                {contactId !== null && <SelectItem value="self">Me ({myName})</SelectItem>}
              </SelectContent>
            </Select>

            {formTargetType === "contact" && (
              <Select value={formTargetId} onValueChange={setFormTargetId}>
                <SelectTrigger className="text-sm h-8">
                  <SelectValue placeholder="Select person…" />
                </SelectTrigger>
                <SelectContent>
                  {availableContacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" className="h-7" onClick={resetForm}>Cancel</Button>
            <Button size="sm" className="h-7" onClick={handleSave} disabled={upsertRelationship.isPending}>
              {editingId ? "Update" : "Add"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
