import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Search,
  Users,
  User,
  ArrowLeft,
  Clock,
  Phone,
  Mail,
  Building2,
  Briefcase,
  MessageSquare,
  Calendar,
  AlertTriangle,
  Loader2,
  Trash2,
} from "lucide-react";

interface Contact {
  id: string;
  user_id: string;
  name: string;
  relationship: string | null;
  company: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  last_contact_date: string | null;
  contact_frequency_days: number | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface Interaction {
  id: string;
  contact_id: string;
  user_id: string;
  interaction_date: string;
  type: string;
  summary: string | null;
  action_items: string[];
  note_id: string | null;
  created_at: string;
}

const RELATIONSHIP_TYPES = ["colleague", "client", "friend", "family", "mentor", "acquaintance", "other"];
const INTERACTION_TYPES = ["meeting", "call", "email", "message", "social", "other"];

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function contactStatusColor(daysSince: number | null): string {
  if (daysSince === null) return "text-muted-foreground";
  if (daysSince < 30) return "text-green-500";
  if (daysSince < 60) return "text-yellow-500";
  return "text-destructive";
}

function contactStatusBg(daysSince: number | null): string {
  if (daysSince === null) return "bg-muted";
  if (daysSince < 30) return "bg-green-500/10 border-green-500/20";
  if (daysSince < 60) return "bg-yellow-500/10 border-yellow-500/20";
  return "bg-destructive/10 border-destructive/20";
}

export default function People() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterRelationship, setFilterRelationship] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [interactionOpen, setInteractionOpen] = useState(false);

  // Form state
  const [form, setForm] = useState({
    name: "", relationship: "", company: "", role: "",
    email: "", phone: "", notes: "", contact_frequency_days: "",
  });
  const [intForm, setIntForm] = useState({
    type: "meeting", summary: "", action_items: "",
  });

  // ── Queries ──
  const { data: contacts = [], isLoading } = useQuery<Contact[]>({
    queryKey: ["contacts", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts" as any)
        .select("*")
        .eq("user_id", user!.id)
        .order("name");
      if (error) throw error;
      return (data as unknown as Contact[]) || [];
    },
  });

  const selectedContact = contacts.find((c) => c.id === selectedContactId);

  const { data: interactions = [] } = useQuery<Interaction[]>({
    queryKey: ["interactions", selectedContactId],
    enabled: !!selectedContactId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contact_interactions" as any)
        .select("*")
        .eq("contact_id", selectedContactId!)
        .order("interaction_date", { ascending: false });
      if (error) throw error;
      return (data as unknown as Interaction[]) || [];
    },
  });

  // Related notes (notes mentioning this person)
  const { data: relatedNotes = [] } = useQuery({
    queryKey: ["contact_notes", selectedContact?.name],
    enabled: !!selectedContact,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notes")
        .select("id, title, created_at, metadata")
        .eq("user_id", user!.id)
        .eq("is_trashed", false)
        .contains("metadata", { people: [selectedContact!.name] })
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
  });

  // ── Mutations ──
  const createContact = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("contacts" as any).insert({
        user_id: user!.id,
        name: form.name.trim(),
        relationship: form.relationship || null,
        company: form.company || null,
        role: form.role || null,
        email: form.email || null,
        phone: form.phone || null,
        notes: form.notes || null,
        contact_frequency_days: form.contact_frequency_days ? Number(form.contact_frequency_days) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      setCreateOpen(false);
      setForm({ name: "", relationship: "", company: "", role: "", email: "", phone: "", notes: "", contact_frequency_days: "" });
      showToast.success("Contact created");
    },
    onError: (e: any) => showToast.error(e.message),
  });

  const logInteraction = useMutation({
    mutationFn: async () => {
      const actionItems = intForm.action_items
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const { error } = await supabase.from("contact_interactions" as any).insert({
        contact_id: selectedContactId!,
        user_id: user!.id,
        type: intForm.type,
        summary: intForm.summary || null,
        action_items: actionItems,
      });
      if (error) throw error;

      // Update last_contact_date
      await supabase
        .from("contacts" as any)
        .update({ last_contact_date: new Date().toISOString().split("T")[0] })
        .eq("id", selectedContactId!);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["interactions"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      setInteractionOpen(false);
      setIntForm({ type: "meeting", summary: "", action_items: "" });
      showToast.success("Interaction logged");
    },
    onError: (e: any) => showToast.error(e.message),
  });

  const deleteContact = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contacts" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      setSelectedContactId(null);
      showToast.success("Contact deleted");
    },
  });

  // ── Filtered contacts ──
  const filtered = contacts.filter((c) => {
    if (searchQuery && !c.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !(c.company || "").toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterRelationship !== "all" && c.relationship !== filterRelationship) return false;
    return true;
  });

  // Overdue contacts for dashboard card
  const overdueContacts = contacts
    .filter((c) => {
      if (!c.contact_frequency_days) return false;
      const days = daysSince(c.last_contact_date);
      return days === null || days > c.contact_frequency_days;
    })
    .sort((a, b) => {
      const dA = daysSince(a.last_contact_date) ?? 999;
      const dB = daysSince(b.last_contact_date) ?? 999;
      return dB - dA;
    });

  // ── Detail view ──
  if (selectedContact) {
    const days = daysSince(selectedContact.last_contact_date);
    const isOverdue = selectedContact.contact_frequency_days && days !== null && days > selectedContact.contact_frequency_days;

    return (
      <div className="max-w-3xl">
        <SEOHead title={`${selectedContact.name} — People — Menerio`} noIndex />

        <Button variant="ghost" size="sm" onClick={() => setSelectedContactId(null)} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to People
        </Button>

        <div className="space-y-6">
          {/* Header */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-xl">{selectedContact.name}</CardTitle>
                  <div className="flex items-center gap-2 mt-1">
                    {selectedContact.relationship && (
                      <Badge variant="secondary" className="text-xs capitalize">{selectedContact.relationship}</Badge>
                    )}
                    {isOverdue && (
                      <Badge variant="destructive" className="text-xs gap-1">
                        <AlertTriangle className="h-3 w-3" /> Needs attention
                      </Badge>
                    )}
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteContact.mutate(selectedContact.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                {selectedContact.company && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5" /> {selectedContact.company}
                  </div>
                )}
                {selectedContact.role && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Briefcase className="h-3.5 w-3.5" /> {selectedContact.role}
                  </div>
                )}
                {selectedContact.email && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-3.5 w-3.5" />
                    <a href={`mailto:${selectedContact.email}`} className="hover:underline text-primary">{selectedContact.email}</a>
                  </div>
                )}
                {selectedContact.phone && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-3.5 w-3.5" /> {selectedContact.phone}
                  </div>
                )}
              </div>

              {/* Days since contact */}
              <div className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm ${contactStatusBg(days)}`}>
                <Clock className={`h-3.5 w-3.5 ${contactStatusColor(days)}`} />
                <span className={contactStatusColor(days)}>
                  {days === null ? "Never contacted" : `${days} days since last contact`}
                </span>
                {selectedContact.contact_frequency_days && (
                  <span className="text-muted-foreground text-xs ml-1">
                    (goal: every {selectedContact.contact_frequency_days}d)
                  </span>
                )}
              </div>

              {selectedContact.notes && (
                <>
                  <Separator />
                  <p className="text-sm text-muted-foreground">{selectedContact.notes}</p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Log Interaction */}
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Interactions</h3>
            <Dialog open={interactionOpen} onOpenChange={setInteractionOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5">
                  <Plus className="h-4 w-4" /> Log Interaction
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Log Interaction</DialogTitle>
                  <DialogDescription>Record a new interaction with {selectedContact.name}.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={intForm.type} onValueChange={(v) => setIntForm((p) => ({ ...p, type: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {INTERACTION_TYPES.map((t) => (
                          <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Summary</Label>
                    <Textarea
                      value={intForm.summary}
                      onChange={(e) => setIntForm((p) => ({ ...p, summary: e.target.value }))}
                      placeholder="What did you discuss?"
                      rows={3}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Action Items <span className="text-muted-foreground">(one per line)</span></Label>
                    <Textarea
                      value={intForm.action_items}
                      onChange={(e) => setIntForm((p) => ({ ...p, action_items: e.target.value }))}
                      placeholder="Follow up on proposal&#10;Send intro to Alex"
                      rows={2}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => logInteraction.mutate()} disabled={logInteraction.isPending}>
                    {logInteraction.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Log
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {interactions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No interactions logged yet.</p>
          ) : (
            <div className="space-y-3">
              {interactions.map((int) => (
                <div key={int.id} className="flex items-start gap-3 rounded-lg border p-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted shrink-0">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] capitalize">{int.type}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(int.interaction_date).toLocaleDateString()}
                      </span>
                    </div>
                    {int.summary && <p className="text-sm mt-1">{int.summary}</p>}
                    {int.action_items && int.action_items.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {int.action_items.map((ai, i) => (
                          <li key={i} className="text-xs text-muted-foreground flex items-center gap-1">
                            <span>⬜</span> {ai}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Related Notes */}
          {relatedNotes.length > 0 && (
            <>
              <h3 className="text-lg font-semibold mt-6">Related Notes</h3>
              <div className="space-y-2">
                {relatedNotes.map((note: any) => (
                  <div key={note.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">{note.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(note.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="max-w-3xl">
      <SEOHead title="People — Menerio" noIndex />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold">People</h1>
          <p className="text-sm text-muted-foreground mt-1">Your personal CRM</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-1.5"><Plus className="h-4 w-4" /> Add Contact</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add Contact</DialogTitle>
              <DialogDescription>Add a new person to your CRM.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Jane Smith" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Relationship</Label>
                  <Select value={form.relationship} onValueChange={(v) => setForm((p) => ({ ...p, relationship: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      {RELATIONSHIP_TYPES.map((t) => (
                        <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Company</Label>
                  <Input value={form.company} onChange={(e) => setForm((p) => ({ ...p, company: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Input value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))} placeholder="CTO" />
                </div>
                <div className="space-y-1.5">
                  <Label>Contact every (days)</Label>
                  <Input type="number" value={form.contact_frequency_days} onChange={(e) => setForm((p) => ({ ...p, contact_frequency_days: e.target.value }))} placeholder="30" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => createContact.mutate()} disabled={!form.name.trim() || createContact.isPending}>
                {createContact.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Overdue card */}
      {overdueContacts.length > 0 && (
        <Card className="mb-6 border-warning/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              People you haven't contacted in a while
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {overdueContacts.slice(0, 5).map((c) => {
                const d = daysSince(c.last_contact_date);
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedContactId(c.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors hover:bg-accent ${contactStatusBg(d)}`}
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className={`${contactStatusColor(d)}`}>
                      {d === null ? "never" : `${d}d ago`}
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search & Filter */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search contacts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={filterRelationship} onValueChange={setFilterRelationship}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {RELATIONSHIP_TYPES.map((t) => (
              <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Contact List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">{contacts.length === 0 ? "No contacts yet." : "No contacts match your search."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => {
            const d = daysSince(c.last_contact_date);
            return (
              <button
                key={c.id}
                onClick={() => setSelectedContactId(c.id)}
                className="w-full flex items-center justify-between rounded-lg border p-4 text-left transition-colors hover:bg-accent/50"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 shrink-0">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[c.role, c.company].filter(Boolean).join(" · ") || c.relationship || "No details"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {c.relationship && (
                    <Badge variant="outline" className="text-[10px] capitalize hidden sm:inline-flex">{c.relationship}</Badge>
                  )}
                  <span className={`text-xs ${contactStatusColor(d)}`}>
                    {d === null ? "—" : `${d}d`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
