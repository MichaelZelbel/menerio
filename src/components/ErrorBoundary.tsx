import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleReport = () => {
    const { error } = this.state;
    const subject = encodeURIComponent(`Bug Report: ${error?.message ?? "Unknown error"}`);
    const body = encodeURIComponent(
      `Error: ${error?.message}\n\nStack:\n${error?.stack?.slice(0, 500) ?? "N/A"}\n\nURL: ${window.location.href}`
    );
    window.open(`mailto:support@menerio.com?subject=${subject}&body=${body}`, "_blank");
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
            An unexpected error occurred. You can try again or report this issue.
          </p>
          {this.state.error && (
            <pre className="mt-4 max-w-lg overflow-auto rounded-lg bg-muted p-3 text-left text-xs text-muted-foreground">
              {this.state.error.message}
            </pre>
          )}
          <div className="mt-6 flex gap-2">
            <Button onClick={this.handleRetry} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Try Again
            </Button>
            <Button variant="outline" onClick={this.handleReport}>
              Report Issue
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
