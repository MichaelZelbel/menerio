import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Home, LayoutDashboard, Search, FileQuestion, Loader2 } from "lucide-react";

// How long "this page does not exist" is held back while the browser looks for a newer
// build. Long enough for a service worker update check on a slow phone, short enough that a
// real wrong address still gets its answer quickly.
const NEWER_BUILD_WAIT_MS = 4000;

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  // A browser that has been here before runs the app shell its service worker kept, and that
  // shell does not know a page added since. Seen live on 2026-09-21: the first visit to the
  // new /connect-godspeed answered "doesn't exist" until the worker had updated. So before saying
  // so, ask for the newest build; when one takes over, registerType "autoUpdate" reloads the
  // tab and the page is there.
  const [lookingForNewerBuild, setLookingForNewerBuild] = useState(
    typeof navigator !== "undefined" && "serviceWorker" in navigator && !!navigator.serviceWorker.controller,
  );

  useEffect(() => {
    if (!lookingForNewerBuild) return;
    let done = false;
    const giveUp = window.setTimeout(() => { if (!done) setLookingForNewerBuild(false); }, NEWER_BUILD_WAIT_MS);
    navigator.serviceWorker.getRegistration()
      .then((registration) => registration?.update())
      .then((registration) => {
        // Nothing newer is installing or waiting: this address really does not exist.
        if (!registration?.installing && !registration?.waiting) {
          done = true;
          setLookingForNewerBuild(false);
        }
      })
      .catch(() => { done = true; setLookingForNewerBuild(false); });
    return () => window.clearTimeout(giveUp);
  }, [lookingForNewerBuild]);

  if (lookingForNewerBuild) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="mt-4 text-sm text-muted-foreground">Loading the newest version of this page…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="mx-auto max-w-md text-center">
        {/* Illustration */}
        <div className="mx-auto mb-8 flex h-32 w-32 items-center justify-center rounded-full bg-muted">
          <FileQuestion className="h-16 w-16 text-muted-foreground/60" />
        </div>

        <h1 className="text-6xl font-bold font-display text-foreground">404</h1>
        <p className="mt-3 text-lg text-muted-foreground">
          The page <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono text-foreground">{location.pathname}</code> doesn't exist.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          It may have been moved or deleted.
        </p>

        {/* Search */}
        <form
          className="mt-8 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) navigate(`/docs?q=${encodeURIComponent(query.trim())}`);
          }}
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for something…"
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="outline">Search</Button>
        </form>

        {/* Actions */}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={() => navigate("/")} variant="outline" className="gap-2">
            <Home className="h-4 w-4" /> Go Home
          </Button>
          <Button onClick={() => navigate("/dashboard")} className="gap-2">
            <LayoutDashboard className="h-4 w-4" /> Go to Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
