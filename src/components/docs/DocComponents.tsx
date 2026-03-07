import { Info, AlertTriangle, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface CalloutProps {
  type?: "info" | "warning" | "tip";
  title?: string;
  children: React.ReactNode;
}

const calloutStyles = {
  info: { icon: Info, border: "border-info/30", bg: "bg-info/5", text: "text-info" },
  warning: { icon: AlertTriangle, border: "border-warning/30", bg: "bg-warning/5", text: "text-warning" },
  tip: { icon: Lightbulb, border: "border-success/30", bg: "bg-success/5", text: "text-success" },
};

export function Callout({ type = "info", title, children }: CalloutProps) {
  const s = calloutStyles[type];
  const Icon = s.icon;
  return (
    <div className={cn("my-4 rounded-lg border p-4", s.border, s.bg)}>
      <div className="flex items-start gap-3">
        <Icon className={cn("h-5 w-5 mt-0.5 shrink-0", s.text)} />
        <div className="min-w-0">
          {title && <p className={cn("font-semibold text-sm mb-1", s.text)}>{title}</p>}
          <div className="text-sm text-muted-foreground [&_p]:mb-0">{children}</div>
        </div>
      </div>
    </div>
  );
}

interface CodeBlockProps {
  code: string;
  language?: string;
  title?: string;
}

export function CodeBlock({ code, language = "bash", title }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-4 rounded-lg border bg-foreground/[0.03] overflow-hidden">
      {title && (
        <div className="flex items-center justify-between border-b px-4 py-2 bg-muted/50">
          <span className="text-xs font-medium text-muted-foreground">{title}</span>
          <span className="text-xs text-muted-foreground/60">{language}</span>
        </div>
      )}
      <div className="relative">
        <pre className="overflow-x-auto p-4 text-sm leading-relaxed">
          <code className="text-foreground">{code}</code>
        </pre>
        <button
          onClick={handleCopy}
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md border bg-background/80 text-muted-foreground transition-colors hover:text-foreground hover:bg-background"
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}
