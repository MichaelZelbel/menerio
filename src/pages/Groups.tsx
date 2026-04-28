import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus, Search, Sparkles, Landmark, Clapperboard, Handshake, Podcast, UserSearch, Compass, UsersRound, Users } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Progress } from "@/components/ui/progress";
import { useCreateGroup, useGroups } from "@/hooks/useGroups";
import { useGroupMemberships } from "@/hooks/useGroupMemberships";
import { GROUP_TEMPLATES, getTemplateById, instantiateTemplate, type GroupTemplate } from "@/lib/group-templates";
import { showToast } from "@/lib/toast";
import type { Database, Json } from "@/integrations/supabase/types";

const iconMap = { Sparkles, Landmark, Clapperboard, Handshake, Podcast, UserSearch, Compass, UsersRound };

type ContactGroup = Database["public"]["Tables"]["contact_groups"]["Row"];
type SuccessCriterion = { label: string; target?: number; current?: number };

function parseArray<T>(value: Json): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function TemplateIcon({ icon, className = "h-5 w-5" }: { icon?: string | null; className?: string }) {
  const Icon = icon && icon in iconMap ? iconMap[icon as keyof typeof iconMap] : Users;
  return <Icon className={className} />;
}

function GroupCard({ group }: { group: ContactGroup }) {
  const navigate = useNavigate();
  const { data: memberships = [] } = useGroupMemberships(group.id);
  const firstCriterion = parseArray<SuccessCriterion>(group.success_criteria)[0];
  const target = Number(firstCriterion?.target || 0);
  const current = Number(firstCriterion?.current || 0);
  const progress = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

  return (
    <Card className="cursor-pointer transition-colors hover:bg-accent/50" onClick={() => navigate(`/dashboard/groups/${group.slug}`)}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <TemplateIcon icon={group.icon} />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-base">{group.name}</CardTitle>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{group.description || "No description"}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{memberships.length} member{memberships.length === 1 ? "" : "s"}</span>
          {group.archived_at && <Badge variant="secondary">Archived</Badge>}
        </div>
        {firstCriterion ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="truncate text-muted-foreground">{firstCriterion.label}</span>
              <span className="text-muted-foreground">{current}/{target || "—"}</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        ) : (
          <div className="h-2 rounded-full bg-secondary" />
        )}
      </CardContent>
    </Card>
  );
}

function NewGroupDialog() {
  const navigate = useNavigate();
  const createGroup = useCreateGroup();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const selectedTemplate = selectedTemplateId ? getTemplateById(selectedTemplateId) : null;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const chooseTemplate = (template: GroupTemplate | null) => {
    setSelectedTemplateId(template?.id ?? null);
    setName(template?.name ?? "");
    setDescription(template?.description ?? "");
    setStep(2);
  };

  const reset = () => {
    setStep(1);
    setSelectedTemplateId(null);
    setName("");
    setDescription("");
  };

  const submit = () => {
    if (!name.trim()) return;
    const input = selectedTemplate
      ? { ...instantiateTemplate(selectedTemplate, name.trim()), description: description.trim() || null }
      : {
          name: name.trim(),
          description: description.trim() || null,
          purpose: null,
          type: "other",
          template: null,
          stages: [
            { id: "new", label: "New", color: "bg-muted text-muted-foreground border-border" },
            { id: "active", label: "Active", color: "bg-primary/10 text-primary border-primary/20" },
            { id: "done", label: "Done", color: "bg-success/10 text-success border-success/20" },
          ],
          success_criteria: [],
          attributes_schema: {},
          icon: "Users",
          color: "text-primary",
        };

    createGroup.mutate(input, {
      onSuccess: (group) => {
        showToast.success("Group created");
        setOpen(false);
        reset();
        navigate(`/dashboard/groups/${group.slug}`);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> New Group</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{step === 1 ? "Choose a template" : "New Group"}</DialogTitle>
        </DialogHeader>
        {step === 1 ? (
          <div className="grid max-h-[65vh] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
            {GROUP_TEMPLATES.map((template) => (
              <button key={template.id} type="button" onClick={() => chooseTemplate(template)} className="rounded-lg border p-4 text-left transition-colors hover:bg-accent">
                <div className="mb-2 flex items-center gap-2">
                  <TemplateIcon icon={template.icon} className="h-4 w-4 text-primary" />
                  <span className="font-medium">{template.name}</span>
                </div>
                <p className="text-sm text-muted-foreground">{template.description}</p>
              </button>
            ))}
            <button type="button" onClick={() => chooseTemplate(null)} className="rounded-lg border p-4 text-left transition-colors hover:bg-accent">
              <div className="mb-2 flex items-center gap-2"><Users className="h-4 w-4 text-primary" /><span className="font-medium">From Scratch</span></div>
              <p className="text-sm text-muted-foreground">Start with a simple custom group and shape it later.</p>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dream 100" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-24" />
            </div>
          </div>
        )}
        {step === 2 && (
          <DialogFooter>
            <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
            <Button onClick={submit} disabled={!name.trim() || createGroup.isPending}>
              {createGroup.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Group
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Groups() {
  const { data: groups = [], isLoading } = useGroups();
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState("active");

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return groups.filter((group) => {
      if (filter === "active" && group.archived_at) return false;
      if (filter === "archived" && !group.archived_at) return false;
      if (!q) return true;
      return group.name.toLowerCase().includes(q) || (group.description || "").toLowerCase().includes(q);
    });
  }, [filter, groups, searchQuery]);

  return (
    <div className="max-w-3xl">
      <SEOHead title="Groups — Menerio" noIndex />
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold">Groups</h1>
          <p className="mt-1 text-sm text-muted-foreground">{groups.filter((g) => !g.archived_at).length} active · {groups.filter((g) => g.archived_at).length} archived</p>
        </div>
        <NewGroupDialog />
      </div>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search groups..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <ToggleGroup type="single" value={filter} onValueChange={(value) => value && setFilter(value)}>
          <ToggleGroupItem value="active">Active</ToggleGroupItem>
          <ToggleGroupItem value="archived">Archived</ToggleGroupItem>
          <ToggleGroupItem value="all">All</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-14 text-center">
            <Users className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No groups yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">Start with a template to organize your people.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {filtered.map((group) => <GroupCard key={group.id} group={group} />)}
        </div>
      )}
    </div>
  );
}
