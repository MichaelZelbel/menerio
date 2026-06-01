import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Play, RotateCcw, Save } from "lucide-react";

type Provider = "lovable" | "openrouter" | "openai" | "anthropic" | "gemini" | "mistral";

type Config = {
  call_site: string;
  description: string | null;
  provider: Provider;
  model: string;
  system_prompt: string | null;
  temperature: number | null;
  max_tokens: number | null;
  extra_options: Record<string, unknown>;
  enabled: boolean;
  updated_at: string;
  placeholders?: string[];
  is_chat?: boolean;
};

const PROVIDER_LABELS: Record<Provider, string> = {
  lovable: "Lovable AI Gateway",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini (Google)",
  mistral: "Mistral",
};

const MODEL_PRESETS: Record<Provider, { value: string; label: string }[]> = {
  lovable: [
    { value: "google/gemini-3-flash-preview", label: "Gemini 3 Flash Preview (default)" },
    { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite (cheapest)" },
    { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro (strongest)" },
    { value: "openai/gpt-5", label: "GPT-5" },
    { value: "openai/gpt-5-mini", label: "GPT-5 Mini" },
    { value: "openai/gpt-5-nano", label: "GPT-5 Nano" },
  ],
  openrouter: [
    { value: "openrouter/auto", label: "Auto (OpenRouter chooses)" },
    { value: "openai/gpt-4o-mini", label: "OpenAI GPT-4o Mini" },
    { value: "openai/gpt-4o", label: "OpenAI GPT-4o" },
    { value: "anthropic/claude-3.5-sonnet", label: "Anthropic Claude 3.5 Sonnet" },
    { value: "google/gemini-2.0-flash-001", label: "Google Gemini 2.0 Flash" },
    { value: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (free)" },
    { value: "google/gemini-2.0-flash-exp:free", label: "Gemini 2.0 Flash Exp (free)" },
    { value: "deepseek/deepseek-r1:free", label: "DeepSeek R1 (free)" },
    { value: "qwen/qwen-2.5-72b-instruct:free", label: "Qwen 2.5 72B (free)" },
  ],
  openai: [
    { value: "gpt-4o-mini", label: "gpt-4o-mini" },
    { value: "gpt-4o", label: "gpt-4o" },
    { value: "gpt-4.1-mini", label: "gpt-4.1-mini" },
    { value: "gpt-4.1", label: "gpt-4.1" },
  ],
  anthropic: [
    { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
    { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
    { value: "claude-3-opus-20240229", label: "Claude 3 Opus" },
  ],
  gemini: [
    { value: "gemini-2.0-flash", label: "gemini-2.0-flash" },
    { value: "gemini-2.0-flash-lite", label: "gemini-2.0-flash-lite" },
    { value: "gemini-1.5-pro", label: "gemini-1.5-pro" },
  ],
  mistral: [
    { value: "mistral-ocr-latest", label: "Mistral OCR (PDF/Image)" },
    { value: "pixtral-12b-2409", label: "Pixtral 12B (Vision)" },
    { value: "pixtral-large-latest", label: "Pixtral Large (Vision)" },
    { value: "mistral-small-latest", label: "Mistral Small" },
    { value: "mistral-medium-latest", label: "Mistral Medium" },
    { value: "mistral-large-latest", label: "Mistral Large" },
  ],
};

export default function LLMConfigPanel() {
  const [loading, setLoading] = useState(true);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [availability, setAvailability] = useState<Record<Provider, boolean>>({
    lovable: false, openrouter: false, openai: false, anthropic: false, gemini: false, mistral: false,
  });
  const [editing, setEditing] = useState<Config | null>(null);
  const [filter, setFilter] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-llm-config", {
        body: { action: "list" },
      });
      if (error) throw error;
      setConfigs(data.configs);
      setAvailability(data.availability);
    } catch (e) {
      toast.error("Failed to load LLM configs", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(
    () => configs.filter((c) => c.call_site.toLowerCase().includes(filter.toLowerCase())),
    [configs, filter]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>LLM Call Configuration</CardTitle>
        <CardDescription>
          Konfiguriere pro AI-Aufruf Provider, Modell und System-Prompt. Inaktive Einträge fallen auf den Code-Default zurück.
        </CardDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
            <Badge key={p} variant={availability[p] ? "default" : "outline"} className="text-xs">
              {PROVIDER_LABELS[p]}{availability[p] ? "" : " (no key)"}
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          placeholder="Filter by call-site…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-sm"
        />
        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Call-Site</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Modell</TableHead>
                  <TableHead>System-Prompt</TableHead>
                  <TableHead>Aktiv</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.call_site}>
                    <TableCell className="font-mono text-xs">{c.call_site}</TableCell>
                    <TableCell>
                      <Badge variant={availability[c.provider] ? "secondary" : "destructive"} className="text-[10px]">
                        {PROVIDER_LABELS[c.provider]}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.model}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.system_prompt ? "Custom" : <span className="italic">Code-Default</span>}
                    </TableCell>
                    <TableCell>{c.enabled ? "✓" : "—"}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => setEditing(c)}>Edit</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {editing && (
          <EditDialog
            config={editing}
            availability={availability}
            onClose={() => setEditing(null)}
            onSaved={async () => { setEditing(null); await load(); }}
          />
        )}
      </CardContent>
    </Card>
  );
}

function EditDialog({
  config, availability, onClose, onSaved,
}: {
  config: Config;
  availability: Record<Provider, boolean>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Config>({ ...config });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testPrompt, setTestPrompt] = useState("Sag 'Hallo' und nenne das Modell und den Provider, den du gerade nutzt.");
  const [testResult, setTestResult] = useState<any>(null);

  const presets = MODEL_PRESETS[draft.provider] ?? [];
  const isCustomModel = !presets.some((p) => p.value === draft.model);

  const save = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("llm_call_configs")
        .update({
          provider: draft.provider,
          model: draft.model.trim(),
          system_prompt: draft.system_prompt?.trim() ? draft.system_prompt : null,
          temperature: draft.temperature,
          max_tokens: draft.max_tokens,
          enabled: draft.enabled,
        })
        .eq("call_site", draft.call_site);
      if (error) throw error;
      toast.success("Saved");
      onSaved();
    } catch (e) {
      toast.error("Save failed", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    // Save first so the test runs against the persisted config.
    setTesting(true);
    setTestResult(null);
    try {
      await save();
      const { data, error } = await supabase.functions.invoke("admin-llm-config", {
        body: { action: "test", call_site: draft.call_site, prompt: testPrompt },
      });
      if (error) throw error;
      setTestResult(data);
    } catch (e) {
      setTestResult({ ok: false, error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">{draft.call_site}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Provider</Label>
              <Select
                value={draft.provider}
                onValueChange={(v) => setDraft({ ...draft, provider: v as Provider, model: MODEL_PRESETS[v as Provider]?.[0]?.value ?? draft.model })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
                    <SelectItem key={p} value={p} disabled={!availability[p]}>
                      {PROVIDER_LABELS[p]}{!availability[p] && " — no API key"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Modell</Label>
              <Select
                value={isCustomModel ? "__custom__" : draft.model}
                onValueChange={(v) => {
                  if (v === "__custom__") return;
                  setDraft({ ...draft, model: v });
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {presets.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                  <SelectItem value="__custom__">Custom…</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="mt-2 font-mono text-xs"
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                placeholder="z. B. openai/gpt-4o-mini oder openrouter/auto"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>System-Prompt</Label>
              {draft.system_prompt && (
                <Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, system_prompt: null })}>
                  <RotateCcw className="h-3 w-3 mr-1" /> Auf Code-Default zurücksetzen
                </Button>
              )}
            </div>
            <Textarea
              rows={6}
              value={draft.system_prompt ?? ""}
              onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })}
              placeholder="(leer = der hartkodierte Default in der Edge Function wird verwendet)"
              className="font-mono text-xs"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Temperature</Label>
              <Input
                type="number" step="0.1" min="0" max="2"
                value={draft.temperature ?? ""}
                onChange={(e) => setDraft({ ...draft, temperature: e.target.value === "" ? null : Number(e.target.value) })}
                placeholder="auto"
              />
            </div>
            <div>
              <Label>Max Tokens</Label>
              <Input
                type="number" min="1"
                value={draft.max_tokens ?? ""}
                onChange={(e) => setDraft({ ...draft, max_tokens: e.target.value === "" ? null : Number(e.target.value) })}
                placeholder="auto"
              />
            </div>
            <div className="flex items-end gap-2 pb-2">
              <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
              <Label>Aktiv</Label>
            </div>
          </div>

          <div className="space-y-2 rounded-md border p-3 bg-muted/30">
            <Label className="text-xs">Test Run</Label>
            <Textarea
              rows={2}
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
              className="text-xs"
            />
            <Button size="sm" onClick={runTest} disabled={testing || saving}>
              {testing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
              Save & Test
            </Button>
            {testResult && (
              <div className="text-xs mt-2 space-y-1">
                {testResult.ok ? (
                  <>
                    <div className="text-muted-foreground">
                      {testResult.provider} / <code>{testResult.model}</code> · {testResult.latency_ms}ms
                      · config: {testResult.config_source}
                      {testResult.credits && ` · ${testResult.credits.tokens_deducted} tokens`}
                    </div>
                    <pre className="whitespace-pre-wrap rounded bg-background p-2 border max-h-48 overflow-auto">{testResult.content}</pre>
                  </>
                ) : (
                  <div className="text-destructive">Error: {testResult.error}</div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
