import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Tags } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GROUP_TEMPLATES, instantiateTemplate } from "@/lib/group-templates";
import { useCreateGroup } from "@/hooks/useGroups";
import { useAddMembership } from "@/hooks/useGroupMemberships";
import { showToast } from "@/lib/toast";

type TaggedContact = { id: string; tags: string[] | null };

type Candidate = { tag: string; count: number; personIds: string[] };

export function InitialMigrationCard() {
  const { user } = useAuth();
  const createGroup = useCreateGroup();
  const addMembership = useAddMembership();
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [templateId, setTemplateId] = useState("");

  const { data: contacts = [], isLoading } = useQuery<TaggedContact[]>({
    queryKey: ["contacts", user?.id, "tag-migration"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("id, tags")
        .eq("user_id", user!.id)
        .is("merged_into", null);
      if (error) throw error;
      return (data || []) as TaggedContact[];
    },
  });

  const candidates = useMemo(() => {
    const byTag = new Map<string, Set<string>>();
    contacts.forEach((contact) => {
      (contact.tags || []).forEach((rawTag) => {
        const tag = rawTag.trim();
        if (!tag) return;
        if (!byTag.has(tag)) byTag.set(tag, new Set());
        byTag.get(tag)!.add(contact.id);
      });
    });
    return [...byTag.entries()]
      .map(([tag, ids]) => ({ tag, count: ids.size, personIds: [...ids] }))
      .filter((candidate) => candidate.count >= 3)
      .sort((a, b) => b.count - a.count);
  }, [contacts]);

  const submit = async () => {
    const template = GROUP_TEMPLATES.find((item) => item.id === templateId);
    if (!selectedCandidate || !template) return;
    try {
      const group = await createGroup.mutateAsync({
        ...instantiateTemplate(template, selectedCandidate.tag),
        description: `Migrated from tag '${selectedCandidate.tag}'`,
      });
      const firstStage = template.stages[0]?.id || null;
      await Promise.all(selectedCandidate.personIds.map((personId) => addMembership.mutateAsync({ groupId: group.id, personId, status: firstStage })));
      showToast.success(`Created group from '${selectedCandidate.tag}'`);
      setSelectedCandidate(null);
      setTemplateId("");
    } catch (error: any) {
      showToast.error(error.message || "Migration failed");
    }
  };

  if (isLoading) {
    return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  if (candidates.length === 0) return null;

  return (
    <div className="mt-4 space-y-3">
      {candidates.map((candidate) => (
        <Card key={candidate.tag}>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div className="flex min-w-0 items-center gap-3">
              <Tags className="h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="truncate text-sm">{candidate.count} people are tagged with '{candidate.tag}' — convert to a group?</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setSelectedCandidate(candidate)}>Convert</Button>
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!selectedCandidate} onOpenChange={(open) => { if (!open) setSelectedCandidate(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Group from Tag</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1 text-sm">
              <p className="font-medium">{selectedCandidate?.tag}</p>
              <p className="text-muted-foreground">Migrated from tag '{selectedCandidate?.tag}'</p>
            </div>
            <div className="space-y-2">
              <Label>Template</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger><SelectValue placeholder="Choose template" /></SelectTrigger>
                <SelectContent>
                  {GROUP_TEMPLATES.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedCandidate(null)}>Cancel</Button>
            <Button onClick={submit} disabled={!templateId || createGroup.isPending || addMembership.isPending}>
              {(createGroup.isPending || addMembership.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
