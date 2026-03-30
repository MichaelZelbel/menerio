import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Loader2,
  Download,
  FileText,
  FolderOpen,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { showToast } from "@/lib/toast";

interface VaultFile {
  path: string;
  sha: string;
  size: number;
}

interface ImportResult {
  path: string;
  status: string;
  noteId?: string;
  error?: string;
}

interface ImportSummary {
  total: number;
  imported: number;
  updated: number;
  skipped: number;
  errors: number;
  unresolved_links: string[];
  results: ImportResult[];
}

export function ImportVaultDialog() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"idle" | "scanning" | "preview" | "importing" | "done">("idle");
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [excludedFolders, setExcludedFolders] = useState<Set<string>>(new Set());
  const [skipExisting, setSkipExisting] = useState(true);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);

  // Derive folder structure from files
  const folders = Array.from(
    new Set(files.map((f) => f.path.split("/").slice(0, -1).join("/")).filter(Boolean))
  ).sort();

  const filteredFiles = files.filter((f) => {
    const folder = f.path.split("/").slice(0, -1).join("/");
    return !excludedFolders.has(folder);
  });

  const handleScan = async () => {
    setStep("scanning");
    try {
      const { data, error } = await supabase.functions.invoke("github-import-vault", {
        body: { action: "list-files" },
      });
      if (error) throw error;
      setFiles(data.files || []);
      setStep("preview");
    } catch (err: any) {
      showToast.error(err.message || "Failed to scan vault");
      setStep("idle");
    }
  };

  const handleImport = async () => {
    setStep("importing");
    try {
      const { data, error } = await supabase.functions.invoke("github-import-vault", {
        body: {
          action: "import",
          skip_existing: skipExisting,
        },
      });
      if (error) throw error;
      setImportSummary(data);
      setStep("done");
      showToast.success(`Imported ${data.imported} notes`);
    } catch (err: any) {
      showToast.error(err.message || "Import failed");
      setStep("preview");
    }
  };

  const toggleFolder = (folder: string) => {
    setExcludedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) {
      setStep("idle");
      setFiles([]);
      setExcludedFolders(new Set());
      setImportSummary(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Download className="h-4 w-4" />
          Import from Obsidian
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import from Obsidian Vault</DialogTitle>
          <DialogDescription>
            Import Markdown files from your connected GitHub repository into Menerio.
          </DialogDescription>
        </DialogHeader>

        {/* Idle — start scan */}
        {step === "idle" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <FolderOpen className="h-12 w-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground text-center">
              Scan your GitHub repo to see what Markdown files are available for import.
            </p>
            <Button onClick={handleScan}>Scan Repository</Button>
          </div>
        )}

        {/* Scanning */}
        {step === "scanning" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Scanning repository…</p>
          </div>
        )}

        {/* Preview */}
        {step === "preview" && (
          <div className="flex flex-col gap-4 min-h-0">
            <div className="flex items-center justify-between">
              <Badge variant="secondary" className="gap-1">
                <FileText className="h-3 w-3" />
                {filteredFiles.length} of {files.length} files selected
              </Badge>
            </div>

            {/* Options */}
            <div className="flex items-center gap-3">
              <Switch
                id="skip-existing"
                checked={skipExisting}
                onCheckedChange={setSkipExisting}
              />
              <Label htmlFor="skip-existing" className="text-sm">
                Skip notes that already exist (by title)
              </Label>
            </div>

            {/* Folder checkboxes */}
            {folders.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Folders</p>
                <ScrollArea className="h-32 border rounded-md p-2">
                  {folders.map((folder) => (
                    <div key={folder} className="flex items-center gap-2 py-0.5">
                      <Checkbox
                        id={`folder-${folder}`}
                        checked={!excludedFolders.has(folder)}
                        onCheckedChange={() => toggleFolder(folder)}
                      />
                      <label htmlFor={`folder-${folder}`} className="text-sm truncate">
                        📁 {folder}
                      </label>
                    </div>
                  ))}
                </ScrollArea>
              </div>
            )}

            {/* File list preview */}
            <ScrollArea className="h-40 border rounded-md p-2">
              {filteredFiles.map((f) => (
                <div key={f.path} className="text-xs text-muted-foreground py-0.5 truncate">
                  📄 {f.path}
                </div>
              ))}
              {filteredFiles.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No files to import</p>
              )}
            </ScrollArea>

            <Button onClick={handleImport} disabled={filteredFiles.length === 0}>
              Import {filteredFiles.length} Notes
            </Button>
          </div>
        )}

        {/* Importing */}
        {step === "importing" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Importing notes… This may take a moment.
            </p>
            <Progress value={undefined} className="h-2 w-full" />
          </div>
        )}

        {/* Done */}
        {step === "done" && importSummary && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <span className="font-medium">Import Complete</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="default">{importSummary.imported}</Badge> imported
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{importSummary.updated}</Badge> updated
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{importSummary.skipped}</Badge> skipped
              </div>
              {importSummary.errors > 0 && (
                <div className="flex items-center gap-2">
                  <Badge variant="destructive">{importSummary.errors}</Badge> errors
                </div>
              )}
            </div>

            {/* Unresolved links */}
            {importSummary.unresolved_links.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-xs text-amber-600">
                  <AlertTriangle className="h-3 w-3" />
                  {importSummary.unresolved_links.length} unresolved wikilinks
                </div>
                <ScrollArea className="h-24 border rounded-md p-2">
                  {importSummary.unresolved_links.map((link, i) => (
                    <div key={i} className="text-xs text-muted-foreground truncate">
                      {link}
                    </div>
                  ))}
                </ScrollArea>
              </div>
            )}

            {/* Errors */}
            {importSummary.errors > 0 && (
              <ScrollArea className="h-24 border rounded-md p-2">
                {importSummary.results
                  .filter((r) => r.status === "error")
                  .map((r, i) => (
                    <div key={i} className="flex items-start gap-1 text-xs py-0.5">
                      <XCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                      <span className="truncate">
                        {r.path}: {r.error}
                      </span>
                    </div>
                  ))}
              </ScrollArea>
            )}

            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
