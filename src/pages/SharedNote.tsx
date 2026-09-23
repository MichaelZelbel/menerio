import { useEffect, useState } from "react";
import { CookieSettingsButton } from "@/components/legal/CookieSettingsButton";
import { useParams, Link } from "react-router-dom";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { SEOHead } from "@/components/SEOHead";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import DOMPurify from "dompurify";
import { BRAND } from "@/lib/brand";

interface SharedNoteData {
  title: string;
  content: string;
  tags: string[] | null;
  entity_type: string | null;
  created_at: string;
  updated_at: string;
}

/** Returns true when content looks like HTML (has block-level tags) */
function looksLikeHtml(content: string): boolean {
  return /<(?:p|h[1-6]|ul|ol|li|blockquote|pre|img|table)\b/i.test(content);
}

export default function SharedNote() {
  const { token } = useParams<{ token: string }>();
  const [note, setNote] = useState<SharedNoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A network failure or server error is not "this note does not exist";
  // telling a visitor sharing was disabled when the server merely hiccuped
  // sent them away from a link that works.
  const [notFound, setNotFound] = useState(true);

  useEffect(() => {
    if (!token) return;

    const url = `${SUPABASE_URL}/functions/v1/get-shared-note?token=${encodeURIComponent(token)}`;
    fetch(url, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setNotFound(res.status === 404 || res.status === 410);
          throw new Error(body.error || "Note not found");
        }
        return res.json();
      })
      .then((data) => setNote(data))
      .catch((err) => {
        if (err instanceof TypeError) setNotFound(false); // fetch() itself failed
        setError(err.message);
      })
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
        {notFound ? (
          <SEOHead title="Note not found — Menerio" description="This shared note does not exist or sharing has been disabled." noIndex />
        ) : (
          <SEOHead title="Note could not be loaded — Menerio" description="This shared note could not be loaded." noIndex />
        )}
        <div className="max-w-3xl mx-auto px-4 py-24 text-center">
          <h1 className="text-2xl font-bold mb-2">{notFound ? "Note not found" : "This note could not be loaded"}</h1>
          <p className="text-muted-foreground mb-6">
            {notFound
              ? "This note doesn't exist or sharing has been disabled by the owner."
              : "Something went wrong while loading it. Check your connection and try again."}
          </p>
          {!notFound && (
            <button type="button" onClick={() => window.location.reload()} className="text-primary hover:underline mr-4">
              Try again
            </button>
          )}
          <Link to="/" className="text-primary hover:underline">
            Go to {BRAND.name} →
          </Link>
        </div>
      </>
    );
  }

  const displayTitle = note.title || "Untitled";
  const isHtml = looksLikeHtml(note.content);
  const safeHtml = isHtml ? DOMPurify.sanitize(note.content, { USE_PROFILES: { html: true } }) : "";

  return (
    <>
      <SEOHead title={`${displayTitle} — Menerio`} description={`Shared note: ${displayTitle}`} />
      <article className="max-w-3xl mx-auto px-4 py-12">
        <header className="mb-8">
          <h1 className="text-3xl font-bold mb-2">{displayTitle}</h1>
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

        {isHtml ? (
          <div
            className="prose prose-neutral dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
        ) : (
          <div className="prose prose-neutral dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.content}</ReactMarkdown>
          </div>
        )}

        <footer className="mt-16 pt-6 border-t border-border text-center">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Powered by <span className="font-semibold">{BRAND.name}</span>
          </Link>
          <div className="mt-2">
            <CookieSettingsButton className="text-xs text-muted-foreground hover:text-foreground transition-colors" />
          </div>
        </footer>
      </article>
    </>
  );
}
