import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2, Users } from "lucide-react";
import { ProfileRow } from "@/components/profile/ProfileRow";
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
  relationshipPairKey,
  type Gender,
} from "@/lib/relationship-canonical";

import { relationshipWriteDecision } from "@/lib/profile-integrity";

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
  const { relationships, isLoading, upsertRelationship, deleteRelationship } =
    useContactRelationships(contactId);

  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [proExpanded, setProExpanded] = useState(false);
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

  // Gender / pronoun facts for everyone, so a role can be rendered in the
  // other person's own gender ("Husband: Michael"). Keyed by contact id;
  // the "self" key holds the owner's own facts. Never guessed from a name.
  // Stored as a plain record, NOT a Map: the query cache is persisted, and a
  // Map does not survive that round-trip (it rehydrates as a bare object,
  // which used to blow up on `.get`).
  const { data: genderByPerson } = useQuery({
    queryKey: ["relationship-genders", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("profile_entries")
        .select("contact_id, label, value")
        .eq("user_id", user!.id)
        .in("label", ["Gender", "Pronouns"]);
      const raw: Record<string, { gender?: string; pronouns?: string }> = {};
      for (const row of (data || []) as Array<{ contact_id: string | null; label: string; value: string }>) {
        const key = row.contact_id ?? "self";
        const bucket = raw[key] ?? {};
        if (row.label === "Gender") bucket.gender = row.value;
        else bucket.pronouns = row.value;
        raw[key] = bucket;
      }
      const out: Record<string, Gender> = {};
      for (const [key, v] of Object.entries(raw)) out[key] = genderFromFacts(v.gender, v.pronouns);
      return out;
    },
  });

  /** Safe lookup that tolerates both a fresh object and a rehydrated one. */
  const genderOf = (key: string): Gender | null =>
    (genderByPerson as Record<string, Gender> | undefined)?.[key] ?? null;


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
    const decision = relationshipWriteDecision({
      userId: user?.id || "",
      sourceType,
      sourceId,
      targetType: formTargetType,
      targetId: formTargetType === "contact" ? formTargetId : null,
      label: formLabel,
    });
    if (!decision.ok) {
      const reason = "reason" in decision ? decision.reason : "";
      showToast.error(
        reason === "unrecognized_relationship_label"
          ? "That is not a relationship — pick a family, social or professional role"
          : "This relationship cannot be saved",
      );
      return;
    }



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

  // One row per (person, bond). Both stored directions of the same bond
  // ("Jürgen is my stepfather" + "I am Jürgen's stepson") collapse into the
  // single row that reads correctly from the viewed person's perspective.
  const { personalRows, professionalRows } = useMemo(() => {
    const described = relationships.map((rel) => {
      const otherIsSelf =
        contactId === null
          ? false
          : rel.source_id === contactId
            ? rel.target_type === "self"
            : rel.source_type === "self";
      const otherContactId =
        contactId === null
          ? rel.source_type === "contact"
            ? rel.source_id
            : rel.target_type === "contact"
              ? rel.target_id
              : null
          : rel.source_id === contactId
            ? rel.target_id
            : rel.source_id;
      const otherKey = otherIsSelf ? "self" : otherContactId ?? "unknown";

      const description = describeRelationship({
        sourceType: rel.source_type,
        sourceId: rel.source_id,
        targetType: rel.target_type,
        targetId: rel.target_id,
        label: rel.label,
        customLabel: rel.custom_label,
        viewingContactId: contactId,
        sourceName: rel.source_type === "self" ? myName : rel.source_contact?.name || "Unknown",
        targetName: rel.target_type === "self" ? myName : rel.target_contact?.name || "Unknown",
        otherGender: genderOf(otherKey),
      });

      const bondKey = rel.custom_label?.trim()
        ? `${otherKey}|custom|${rel.custom_label.trim().toLowerCase()}`
        : relationshipPairKey(
            user?.id || "",
            { type: rel.source_type as "contact" | "self", id: rel.source_id },
            { type: rel.target_type as "contact" | "self", id: rel.target_id },
            rel.label,
          );

      return { rel, description, otherKey, otherContactId, otherIsSelf, bondKey };
    });

    // Prefer the stored direction where the viewed person is the TARGET: its
    // label already names the other person's role, so no inversion is needed.
    const byBond = new Map<string, (typeof described)[number]>();
    for (const row of described) {
      const existing = byBond.get(row.bondKey);
      if (!existing || (existing.description.viewingIsSource && !row.description.viewingIsSource)) {
        byBond.set(row.bondKey, row);
      }
    }

    const all = Array.from(byBond.values()).filter((r) => r.description.kind !== "other");
    return {
      personalRows: all.filter((r) => r.description.kind === "personal"),
      professionalRows: all.filter((r) => r.description.kind === "professional"),
    };
  }, [relationships, contactId, myName, genderByPerson, user?.id]);

  const rows = personalRows;
  if (isLoading) return null;

  // Neutral summary: never infer exclusivity or monogamy from stored edges.
  const derivedStatus = (() => {
    const labels = relationships.map((r) => canonicalLabel(r.custom_label || r.label));
    if (labels.some((l) => l === "spouse" || l === "husband" || l === "wife")) return "Married";
    if (labels.some((l) => l === "partner" || l === "lover")) return "Romantic relationships";
    return null;
  })();

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Header — same shape as every other profile section. */}
      <div className="flex items-center gap-2 px-4 py-2.5 group">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={expanded ? "Collapse section" : "Expand section"}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <Users className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-medium text-sm flex-1 truncate">Relationships</span>
        {derivedStatus && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
            {derivedStatus}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground shrink-0">{rows.length + professionalRows.length}</span>
        {!adding && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Add relationship"
            onClick={() => {
              setAdding(true);
              setExpanded(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Existing relationships — always "Role: Name", where Role is the role
          the OTHER person holds toward {contactName}. */}
      {expanded && rows.length > 0 && (
        <div className="border-t border-border">
          {rows.map(({ rel, description, otherContactId, otherIsSelf }) => (
            <ProfileRow
              key={rel.id}
              label={description.role}
              actions={
                <>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(rel)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => handleDelete(rel.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              }
            >
              {otherIsSelf ? (
                <Link to="/dashboard/profile" className="text-sm hover:underline break-words">
                  {description.otherName}
                </Link>
              ) : otherContactId ? (
                <Link
                  to={`/dashboard/people/${otherContactId}`}
                  className="text-sm hover:underline break-words"
                >
                  {description.otherName}
                </Link>
              ) : (
                <span className="text-sm break-words">{description.otherName}</span>
              )}
            </ProfileRow>
          ))}
        </div>
      )}


      {/* Professional and service roles are real, but they are not family or
          friends — they never mix into the personal list. */}
      {expanded && professionalRows.length > 0 && (
        <div className="border-t border-border">
          <div className="px-4 pt-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            Professional &amp; service contacts
          </div>
          {professionalRows.map(({ rel, description, otherContactId, otherIsSelf }) => (
            <ProfileRow
              key={rel.id}
              label={description.role}
              actions={
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => handleDelete(rel.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              }
            >
              {otherIsSelf ? (
                <Link to="/dashboard/profile" className="text-sm hover:underline break-words">
                  {description.otherName}
                </Link>
              ) : otherContactId ? (
                <Link to={`/dashboard/people/${otherContactId}`} className="text-sm hover:underline break-words">
                  {description.otherName}
                </Link>
              ) : (
                <span className="text-sm break-words">{description.otherName}</span>
              )}
            </ProfileRow>
          ))}
        </div>
      )}


      {expanded && rows.length === 0 && professionalRows.length === 0 && !adding && (
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border">
          <span className="text-sm text-muted-foreground">No relationships yet — add one</span>
          <Button variant="ghost" size="sm" className="h-7 gap-1 shrink-0" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      )}



      {/* Non-edge relational facts live in this same card — one surface. */}
      {expanded && milestones.length > 0 && (
        <div className="border-t border-border">
          {milestones.map((m) => (
            <ProfileRow key={m.id} label={m.label}>
              <span className="text-sm break-words">{m.value}</span>
            </ProfileRow>
          ))}
        </div>

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
