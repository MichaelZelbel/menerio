import { useState } from "react";
import { MediaAnalysisEntry, useReanalyzeMedia } from "@/hooks/useMediaAnalysis";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Copy, ChevronDown, ChevronRight, RefreshCw, Loader2, X, FileText, Search } from "lucide-react";
import { showToast } from "@/lib/toast";
import { useNavigate } from "react-router-dom";

interface MediaAnalysisPanelProps {
  entries: MediaAnalysisEntry[];
  noteId: string;
  onClose: () => void;
  storagePath: string;
}

export function MediaAnalysisPanel({ entries, noteId, onClose, storagePath }: MediaAnalysisPanelProps) {
  const navigate = useNavigate();
  const reanalyze = useReanalyzeMedia();
  const isPdf = entries.some(e => e.media_type === "pdf" || e.media_type === "pdf_page");
  const pages = entries.filter(e => e.page_number !== null).sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0));
  const singleEntry = entries.length === 1 ? entries[0] : null;
  const mainEntry = singleEntry || entries[0];

  if (!mainEntry) return null;

  const rawAnalysis = mainEntry.raw_analysis as Record<string, unknown> | null;
  const contentType = rawAnalysis?.content_type as string | undefined;

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast.success("Copied to clipboard");
  };

  const handleReanalyze = () => {
    reanalyze.mutate({
      noteId,
      storagePath,
      mediaType: isPdf ? "pdf" : "image",
      originalFilename: mainEntry.original_filename || undefined,
    });
  };

  const searchTopic = (topic: string) => {
    navigate(`/dashboard/notes?q=${encodeURIComponent(topic)}`);
  };

  // For PDFs, combine all text
  const allExtractedText = isPdf && pages.length > 0
    ? pages.map(p => `--- Page ${p.page_number} ---\n${p.extracted_text || ""}`).join("\n\n")
    : mainEntry.extracted_text;

  return (
    <div className="border border-border rounded-lg bg-card p-3 space-y-3 text-sm animate-in slide-in-from-top-2 duration-200">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">AI Analysis</span>
          {contentType && (
            <Badge variant="secondary" className="text-[10px]">{contentType}</Badge>
          )}
          {isPdf && pages.length > 0 && (
            <Badge variant="outline" className="text-[10px]">
              <FileText className="h-3 w-3 mr-1" />
              {pages.length} pages
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleReanalyze}
            disabled={reanalyze.isPending}
            title="Re-analyze"
          >
            {reanalyze.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Description */}
      {mainEntry.description && (
        <div>
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">AI Description</span>
          <p className="text-sm text-foreground mt-0.5">{mainEntry.description}</p>
        </div>
      )}

      {/* Topics */}
      {mainEntry.topics && mainEntry.topics.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {mainEntry.topics.map(topic => (
            <Badge
              key={topic}
              variant="secondary"
              className="text-[10px] cursor-pointer hover:bg-primary/10 transition-colors gap-1"
              onClick={() => searchTopic(topic)}
            >
              <Search className="h-2.5 w-2.5" />
              {topic}
            </Badge>
          ))}
        </div>
      )}

      {/* Extracted text — single image */}
      {!isPdf && (
        <ExtractedTextSection text={mainEntry.extracted_text} onCopy={copyText} />
      )}

      {/* PDF page-by-page */}
      {isPdf && pages.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Extracted Text</span>
            {allExtractedText && (
              <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={() => copyText(allExtractedText)}>
                <Copy className="h-3 w-3" /> Copy all text
              </Button>
            )}
          </div>
          {pages.map(page => (
            <PageTextCollapsible key={page.id} page={page} onCopy={copyText} />
          ))}
        </div>
      )}

      {/* Single non-paged PDF or image with no pages */}
      {isPdf && pages.length === 0 && (
        <ExtractedTextSection text={mainEntry.extracted_text} onCopy={copyText} />
      )}
    </div>
  );
}

function ExtractedTextSection({ text, onCopy }: { text: string | null; onCopy: (t: string) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Extracted Text</span>
        {text && (
          <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={() => onCopy(text)}>
            <Copy className="h-3 w-3" /> Copy
          </Button>
        )}
      </div>
      {text ? (
        <pre className="mt-1 text-xs font-mono bg-muted/50 rounded p-2 whitespace-pre-wrap max-h-40 overflow-y-auto text-foreground">
          {text}
        </pre>
      ) : (
        <p className="text-xs text-muted-foreground italic mt-1">No text detected in this image</p>
      )}
    </div>
  );
}

function PageTextCollapsible({ page, onCopy }: { page: MediaAnalysisEntry; onCopy: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 w-full text-xs text-muted-foreground hover:text-foreground py-1">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span>Page {page.page_number}</span>
        {page.extracted_text && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-[10px] gap-1 ml-auto"
            onClick={(e) => { e.stopPropagation(); onCopy(page.extracted_text!); }}
          >
            <Copy className="h-2.5 w-2.5" />
          </Button>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {page.extracted_text ? (
          <pre className="text-xs font-mono bg-muted/50 rounded p-2 whitespace-pre-wrap max-h-32 overflow-y-auto ml-4 text-foreground">
            {page.extracted_text}
          </pre>
        ) : (
          <p className="text-xs text-muted-foreground italic ml-4">No text on this page</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
