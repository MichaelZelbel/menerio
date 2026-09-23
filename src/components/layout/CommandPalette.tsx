import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  FileText,
  Plus,
  UserPlus,
  Users,
  Settings,
  Sun,
  Moon,
  LayoutDashboard,
  Network,
  BookOpen,
  Calendar,
  LayoutGrid,
  Image as ImageIcon,
  ClipboardList,
  User,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNotes, useCreateNote } from "@/hooks/useNotes";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { OFFLINE_CORE } from "@/lib/flags";

type PaletteNote = { id: string; title: string | null };

// The palette lists the first 50 notes in the notes list's order and nothing
// else. It is mounted in DashboardLayout, so on the server path it used to run
// useNotes("all") on every signed-in page: every note in the vault, full
// bodies, paged 1,000 at a time, refetched on each mount once 60 s stale, and
// all of it just to show 50 titles in a dialog that is usually closed. Now it
// fetches those 50 titles, and only while the dialog is open.
function usePaletteNotesRemote(open: boolean): PaletteNote[] | undefined {
  const { user } = useAuth();
  const { data } = useQuery<PaletteNote[]>({
    queryKey: ["command-palette-notes", user?.id],
    enabled: open && !!user,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notes")
        .select("id, title")
        .eq("user_id", user!.id)
        .eq("is_trashed", false)
        .order("is_pinned", { ascending: false })
        .order("updated_at", { ascending: false })
        .order("id", { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as PaletteNote[];
    },
  });
  return data;
}

// Local-first sessions read the list from the device's SQLite replica, which
// costs no network, so they keep sharing the notes list.
function usePaletteNotesLocal(_open: boolean): PaletteNote[] | undefined {
  return useNotes("all").data;
}

// OFFLINE_CORE is fixed for the page's lifetime, so this never changes hooks.
const usePaletteNotes = OFFLINE_CORE ? usePaletteNotesLocal : usePaletteNotesRemote;

const NAV_ITEMS: { title: string; url: string; icon: typeof FileText }[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Notes", url: "/dashboard/notes", icon: FileText },
  { title: "Note Graph", url: "/dashboard/graph", icon: Network },
  { title: "Lexicon", url: "/lexicon", icon: BookOpen },
  { title: "People", url: "/dashboard/people", icon: Users },
  { title: "Groups", url: "/dashboard/groups", icon: Users },
  { title: "Timeline", url: "/dashboard/timeline", icon: Calendar },
  { title: "Collections", url: "/collections", icon: LayoutGrid },
  { title: "Media Library", url: "/dashboard/media", icon: ImageIcon },
  { title: "Review Queue", url: "/dashboard/review-queue", icon: ClipboardList },
  { title: "Weekly Review", url: "/dashboard/review", icon: Calendar },
  { title: "My Profile", url: "/dashboard/profile", icon: User },
  { title: "Settings", url: "/dashboard/settings", icon: Settings },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const notes = usePaletteNotes(open);
  const createNote = useCreateNote();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd/Ctrl+K (without Shift — Shift+K is reserved for AI chat)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const run = (fn: () => void) => {
    setOpen(false);
    // defer to allow dialog to close cleanly
    setTimeout(fn, 0);
  };

  const noteItems = useMemo(() => (notes ?? []).slice(0, 50), [notes]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search notes, run actions…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Create">
          <CommandItem
            onSelect={() =>
              run(async () => {
                const note = await createNote.mutateAsync({});
                if (note?.id) navigate(`/dashboard/notes/${note.id}`);
              })
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            New note
          </CommandItem>
          <CommandItem onSelect={() => run(() => navigate("/dashboard/people?new=1"))}>
            <UserPlus className="mr-2 h-4 w-4" />
            New contact
          </CommandItem>
          <CommandItem onSelect={() => run(() => navigate("/dashboard/groups?new=1"))}>
            <Users className="mr-2 h-4 w-4" />
            New group
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Navigate">
          {NAV_ITEMS.map((item) => (
            <CommandItem
              key={item.url}
              value={`nav ${item.title}`}
              onSelect={() => run(() => navigate(item.url))}
            >
              <item.icon className="mr-2 h-4 w-4" />
              {item.title}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Preferences">
          <CommandItem onSelect={() => run(() => setTheme(theme === "dark" ? "light" : "dark"))}>
            {theme === "dark" ? (
              <Sun className="mr-2 h-4 w-4" />
            ) : (
              <Moon className="mr-2 h-4 w-4" />
            )}
            Toggle theme
          </CommandItem>
          <CommandItem onSelect={() => run(() => navigate("/dashboard/settings"))}>
            <Settings className="mr-2 h-4 w-4" />
            Open settings
          </CommandItem>
        </CommandGroup>

        {noteItems.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Go to note">
              {noteItems.map((n) => (
                <CommandItem
                  key={n.id}
                  value={`note ${n.title} ${n.id}`}
                  onSelect={() => run(() => navigate(`/dashboard/notes/${n.id}`))}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  <span className="truncate">{n.title || "Untitled"}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
