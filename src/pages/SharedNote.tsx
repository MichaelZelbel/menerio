import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { SEOHead } from "@/components/SEOHead";

interface SharedNoteData {
  title: string;
  content: string;
  tags: string[] | null;
  entity_type: string | null;
  created_at: string;
  updated_at: string;
}

export default function SharedNote() {
  const { token } = useParams<{ token: string }>();
  const [note, setNote] = useState<SharedNoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    supabase.functions
      .invoke("get-shared-note", { body: undefined, method: "GET" as any })
      .then(() => {})
      .catch(() => {});

    // Use fetch directly since we need GET with query params
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-shared-note?token=${encodeURIComponent(token)}`;
    fetch(url, {
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Note not found");
        }
        return res.json();
      })
      .then((data) => setNote(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <Skeleton className="h-10 w-3/4 mb-4" />
        <Skeleton className="h-4 w-1/4 mb-8" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !note) {
    return (
      <>
        <SEOHead title="Note not found — Menerio" description="This shared note does not exist or sharing has been disabled." />
        <div className="max-w-3xl mx-auto px-4 py-24 text-center">
          <h1 className="text-2xl font-bold mb-2">Note not found</h1>
          <p className="text-muted-foreground mb-6">
            This note doesn't exist or sharing has been disabled by the owner.
          </p>
          <Link to="/" className="text-primary hover:underline">
            Go to Menerio →
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <SEOHead title={`${note.title} — Menerio`} description={`Shared note: ${note.title}`} />
      <article className="max-w-3xl mx-auto px-4 py-12">
        <header className="mb-8">
          <h1 className="text-3xl font-bold mb-2">{note.title || "Untitled"}</h1>
          <p className="text-sm text-muted-foreground">
            Last updated {format(new Date(note.updated_at), "PPP")}
          </p>
          {note.tags && note.tags.length > 0 && (
            <div className="flex gap-1.5 mt-3 flex-wrap">
              {note.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </header>

        <div
          className="prose prose-neutral dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: note.content }}
        />

        <footer className="mt-16 pt-6 border-t border-border text-center">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Powered by <span className="font-semibold">Menerio</span>
          </Link>
        </footer>
      </article>
    </>
  );
}
