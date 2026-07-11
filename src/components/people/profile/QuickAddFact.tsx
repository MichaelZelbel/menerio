import { useRef, useState } from "react";
import { CornerDownLeft, Loader2, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProfileIcon } from "@/components/profile/ProfileIcon";
import { ensureProfileCategory } from "@/lib/profile-categories";
import { buildClassifyBody } from "@/lib/quick-add-fact";
import { PROFILE_TAXONOMY, taxonomyBySlug } from "@/lib/profile-taxonomy";
import { supabase } from "@/integrations/supabase/client";
import { showToast } from "@/lib/toast";

/** The classify-profile-fact edge function's success shape. */
interface FactProposal {
  label: string;
  value: string;
  category_slug: string;
  category_name: string;
  confidence?: number;
  source?: string;
}

/**
 * Extract the `{ error }` message from a supabase FunctionsHttpError's Response
 * body (`.context`), falling back to null so the caller can use error.message.
 */
async function readEdgeError(error: unknown): Promise<string | null> {
  try {
    const ctx = (error as { context?: { json?: () => Promise<unknown>; text?: () => Promise<string> } }).context;
    if (ctx && typeof ctx.json === "function") {
      const body = (await ctx.json()) as { error?: string };
      return body?.error ?? null;
    }
    if (ctx && typeof ctx.text === "function") {
      const t = await ctx.text();
      try {
        return (JSON.parse(t) as { error?: string })?.error ?? t;
      } catch {
        return t;
      }
    }
  } catch {
    /* ignore — fall back to error.message */
  }
  return null;
}

interface QuickAddFactProps {
  userId: string;
  contactId: string;
  /**
   * Persists the confirmed fact. Should resolve once the entry is written (the
   * caller's existing `upsertEntry` mutation invalidates the section query and
   * toasts on success).
   */
  onCommit: (entry: { category_id: string; label: string; value: string }) => Promise<void>;
}

/**
 * One-line AI fact capture for the contact profile. Type a fact and press
 * Enter → the edge function proposes a destination as a chip → Enter again
 * commits it into the right section. The chip can be clicked to re-file to any
 * of the 17 taxonomy categories, and Esc dismisses the proposal (keeping the
 * typed text for editing). Focus never leaves the input during the happy path.
 */
export function QuickAddFact({ userId, contactId, onCommit }: QuickAddFactProps) {
  const [text, setText] = useState("");
  const [proposal, setProposal] = useState<FactProposal | null>(null);
  const [status, setStatus] = useState<"idle" | "classifying" | "committing">("idle");
  const [refileOpen, setRefileOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = status !== "idle";

  const classify = async () => {
    const raw = text.trim();
    if (!raw || busy) return;
    setStatus("classifying");
    try {
      const { data, error } = await supabase.functions.invoke("classify-profile-fact", {
        body: buildClassifyBody(contactId, raw),
      });
      // supabase.functions.invoke surfaces non-2xx as a FunctionsHttpError whose
      // `.context` is the Response — dig out the server's `{ error }` message.
      if (error) {
        throw new Error((await readEdgeError(error)) || error.message || "Classification failed");
      }
      const proposalData = data as FactProposal;
      if (!proposalData?.category_slug || !proposalData?.label || !proposalData?.value) {
        throw new Error("Classification returned an incomplete result");
      }
      setProposal(proposalData);
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : "Could not classify this fact");
    } finally {
      setStatus("idle");
      inputRef.current?.focus();
    }
  };

  const commit = async () => {
    if (!proposal || busy) return;
    setStatus("committing");
    try {
      const categoryId = await ensureProfileCategory(userId, contactId, proposal.category_slug);
      await onCommit({ category_id: categoryId, label: proposal.label, value: proposal.value });
      setText("");
      setProposal(null);
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : "Could not save this fact");
    } finally {
      setStatus("idle");
      inputRef.current?.focus();
    }
  };

  const refile = (slug: string) => {
    setProposal((prev) =>
      prev
        ? { ...prev, category_slug: slug, category_name: taxonomyBySlug[slug]?.name ?? slug }
        : prev,
    );
    setRefileOpen(false);
    // Radix returns focus to the chip (the trigger) on close; defer so focus
    // lands back in the input and Enter still commits.
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (busy) return;
      if (proposal) void commit();
      else void classify();
    } else if (e.key === "Escape" && proposal) {
      // Dismiss the proposal but keep the typed text for editing.
      e.preventDefault();
      setProposal(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Sparkles className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // Editing invalidates a stale proposal; a fresh Enter re-classifies.
            if (proposal) setProposal(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder={'Add a fact… "shoe size: 38" or "loves hotpot"'}
          className="h-9 pl-8 pr-9 text-sm"
          aria-label="Add a fact with AI"
          aria-busy={busy}
        />
        {busy && (
          <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      <div aria-live="polite">
        {proposal && (
          <div className="flex items-center gap-2 text-xs">
            <Popover open={refileOpen} onOpenChange={setRefileOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-primary transition-colors hover:bg-primary/10"
                  aria-label={`Filing under ${proposal.category_name} as ${proposal.label}. Click to re-file.`}
                >
                  <ProfileIcon
                    name={taxonomyBySlug[proposal.category_slug]?.icon ?? "folder"}
                    className="h-3.5 w-3.5 shrink-0"
                  />
                  <span className="shrink-0 font-medium">{proposal.category_name}</span>
                  <span className="text-primary/50">·</span>
                  <span className="truncate">{proposal.label}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-60 p-1">
                <div className="max-h-72 overflow-y-auto">
                  {PROFILE_TAXONOMY.map((cat) => (
                    <button
                      key={cat.slug}
                      type="button"
                      onClick={() => refile(cat.slug)}
                      className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent ${
                        cat.slug === proposal.category_slug ? "bg-accent/60 font-medium" : ""
                      }`}
                    >
                      <ProfileIcon name={cat.icon} className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{cat.name}</span>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <span className="truncate text-muted-foreground">{proposal.value}</span>
            <span className="ml-auto hidden shrink-0 items-center gap-1 text-muted-foreground sm:inline-flex">
              <CornerDownLeft className="h-3 w-3" /> to save
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
