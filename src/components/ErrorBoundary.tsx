import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
  copied: boolean;
}

const RELOADED_KEY = "menerio:error-auto-reloaded";

// A failed lazy-chunk load usually means a new build was deployed while this
// tab was open (the old hashed chunk no longer exists). One hard reload picks
// up the current version; the sessionStorage guard prevents a reload loop.
function isStaleChunkError(error: Error): boolean {
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i.test(
    error.message,
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null, copied: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, copied: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
    if (isStaleChunkError(error) && sessionStorage.getItem(RELOADED_KEY) !== "1") {
      sessionStorage.setItem(RELOADED_KEY, "1");
      window.location.reload();
    }
  }

  private handleReload = () => {
    window.location.reload();
  };

  // mailto: links silently do nothing on systems without a mail handler, so
  // the report goes to the clipboard instead — reliable everywhere, and the
  // user gets the full details to paste into an email or chat.
  private handleReport = async () => {
    const { error, componentStack } = this.state;
    const report = [
      `Bug report for ${BRAND.supportEmail}`,
      `URL: ${window.location.href}`,
      `Time: ${new Date().toISOString()}`,
      `User agent: ${navigator.userAgent}`,
      ``,
      `Error: ${error?.message ?? "Unknown error"}`,
      ``,
      `Stack:`,
      error?.stack ?? "N/A",
      ``,
      `Component stack:`,
      componentStack ?? "N/A",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(report);
    } catch {
      // Clipboard access denied — show the report so it can be copied by hand.
      window.prompt("Copy the report below:", report);
    }
    this.setState({ copied: true });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex min-h-[400px] flex-col items-center justify-center px-4 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <h2 className="text-xl font-bold font-display text-foreground">Something went wrong</h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            An unexpected error occurred. Reloading usually fixes it — or copy the report and send
            it to us.
          </p>
          {this.state.error && (
            <pre className="mt-4 max-w-lg overflow-auto rounded-lg bg-muted p-3 text-left text-xs text-muted-foreground">
              {this.state.error.message}
            </pre>
          )}
          <div className="mt-6 flex gap-2">
            <Button onClick={this.handleReload} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Reload App
            </Button>
            <Button variant="outline" onClick={this.handleReport} className="gap-2">
              {this.state.copied && <Check className="h-4 w-4" />}
              {this.state.copied ? "Copied!" : "Copy Error Report"}
            </Button>
          </div>
          {this.state.copied && (
            <p className="mt-3 max-w-sm text-xs text-muted-foreground">
              The report is in your clipboard — please paste it into an email to {BRAND.supportEmail}.
            </p>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
