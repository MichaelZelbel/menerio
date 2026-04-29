import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAddMembership } from "@/hooks/useGroupMemberships";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import { initials } from "@/lib/group-utils";

type ContactGroup = Database["public"]["Tables"]["contact_groups"]["Row"];
type Contact = Pick<Database["public"]["Tables"]["contacts"]["Row"], "id" | "name" | "company" | "role">;

export function AddMemberDialog({ group, existingPersonIds }: { group: ContactGroup; existingPersonIds: Set<string> }) {
  const { user } = useAuth();
  const addMembership = useAddMembership();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const { data: contacts = [], isLoading } = useQuery<Contact[]>({
    queryKey: ["contacts", user?.id, "group-picker"],
    enabled: !!user && open,
    queryFn: async () => {
      const { data, error } = await supabase.from("contacts").select("id, name, company, role").eq("user_id", user!.id).is("merged_into", null).order("name");
      if (error) throw error;
      return data || [];
    },
  });
  const available = contacts.filter((contact) => !existingPersonIds.has(contact.id) && contact.name.toLowerCase().includes(search.toLowerCase()));

  const submit = async () => {
    await Promise.all(selected.map((personId) => addMembership.mutateAsync({ groupId: group.id, personId })));
    showToast.success("Members added");
    setSelected([]);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Add Member</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Members</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search people..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {isLoading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : available.map((contact) => (
              <label key={contact.id} className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-accent">
                <Checkbox checked={selected.includes(contact.id)} onCheckedChange={(checked) => setSelected((prev) => checked ? [...prev, contact.id] : prev.filter((id) => id !== contact.id))} />
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">{initials(contact.name)}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{contact.name}</span><span className="block truncate text-xs text-muted-foreground">{[contact.role, contact.company].filter(Boolean).join(" · ")}</span></span>
              </label>
            ))}
            {!isLoading && available.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No available people found.</p>}
          </div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={selected.length === 0 || addMembership.isPending}>{addMembership.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add Selected</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
