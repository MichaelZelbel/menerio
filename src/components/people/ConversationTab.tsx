import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, Heart, Shield, Sparkles, Waves } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Chat } from "@/components/people/conversation/Chat";
import { cn } from "@/lib/utils";

const TONES = [
  { label: "Loving", value: "loving", icon: Heart },
  { label: "Calm", value: "calm", icon: Waves },
  { label: "Flirty", value: "flirty", icon: Sparkles },
  { label: "Thoughtful", value: "thoughtful", icon: Brain },
  { label: "Sincere", value: "sincere", icon: Shield },
];

interface ConversationTabProps {
  personId: string;
  personName: string;
  initialContext?: string;
}

export function ConversationTab({ personId, personName, initialContext = "" }: ConversationTabProps) {
  const { toast } = useToast();
  const [context, setContext] = useState("");
  const [intent, setIntent] = useState("");
  const [presetTone, setPresetTone] = useState("");
  const [customTone, setCustomTone] = useState("");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const appliedContextRef = useRef("");

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("contacts" as any)
        .select("conversation_context, conversation_intent, conversation_preset_tone, conversation_custom_tone, conversation_updated_at")
        .eq("id", personId)
        .single();
      setContext((data as any)?.conversation_context || "");
      setIntent((data as any)?.conversation_intent || "");
      setPresetTone((data as any)?.conversation_preset_tone || "");
      setCustomTone((data as any)?.conversation_custom_tone || "");
      setLastUpdated((data as any)?.conversation_updated_at || null);
    };
    load();
  }, [personId]);

  useEffect(() => {
    if (initialContext && initialContext !== appliedContextRef.current) {
      setContext((prev) => initialContext + (prev ? `\n\n${prev}` : ""));
      appliedContextRef.current = initialContext;
    }
  }, [initialContext]);

  const save = useCallback(async (updates: Record<string, string | null>, showToast = false) => {
    const payload = { ...updates, conversation_updated_at: new Date().toISOString() };
    const { error } = await supabase.from("contacts" as any).update(payload).eq("id", personId);
    if (error) {
      toast({ variant: "destructive", title: "Save failed", description: error.message });
      return;
    }
    setLastUpdated(payload.conversation_updated_at);
    if (showToast) toast({ title: "Saved" });
  }, [personId, toast]);

  const debouncedSave = (updates: Record<string, string | null>) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => save(updates), 1000);
  };

  const clearFields = async () => {
    setContext(""); setIntent(""); setPresetTone(""); setCustomTone(""); setLastUpdated(null);
    await supabase.from("contacts" as any).update({ conversation_context: null, conversation_intent: null, conversation_preset_tone: null, conversation_custom_tone: null, conversation_updated_at: null }).eq("id", personId);
    toast({ title: "Conversation fields cleared" });
  };

  const blurSave = (updates: Record<string, string | null>) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    save(updates, true);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Context <span className="text-xs font-normal text-muted-foreground">optional</span></Label>
          <Textarea value={context} maxLength={5000} rows={10} placeholder="Paste a chat excerpt, diary note, or describe what's happening." onChange={(e) => { const value = e.target.value.slice(0, 5000); setContext(value); debouncedSave({ conversation_context: value }); }} onBlur={() => blurSave({ conversation_context: context })} />
          <div className="flex justify-between text-xs text-muted-foreground"><span>Saved to {personName} only</span><span>{context.length} / 5,000</span></div>
        </div>
        <div className="space-y-2">
          <Label>Your Intent <span className="text-xs font-normal text-muted-foreground">optional</span></Label>
          <Textarea value={intent} maxLength={800} rows={4} placeholder="What do you want to express or achieve?" onChange={(e) => { const value = e.target.value.slice(0, 800); setIntent(value); debouncedSave({ conversation_intent: value }); }} onBlur={() => blurSave({ conversation_intent: intent })} />
          <div className="flex justify-between text-xs text-muted-foreground"><span>Saved to {personName} only</span><span>{intent.length} / 800</span></div>
        </div>
        <Card>
          <CardContent className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Quick Tone</Label>
              <div className="flex flex-wrap gap-2">
                {TONES.map((tone) => {
                  const Icon = tone.icon;
                  return <Button key={tone.value} type="button" variant={presetTone === tone.value ? "default" : "outline"} size="sm" className={cn("gap-1.5")} onClick={() => { const next = presetTone === tone.value ? "" : tone.value; setPresetTone(next); save({ conversation_preset_tone: next }); }}><Icon className="h-3.5 w-3.5" />{tone.label}</Button>;
                })}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Custom Tone</Label>
              <Input value={customTone} placeholder="Describe your tone" onChange={(e) => { setCustomTone(e.target.value); debouncedSave({ conversation_custom_tone: e.target.value }); }} onBlur={() => blurSave({ conversation_custom_tone: customTone })} />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{lastUpdated ? `Last updated ${new Date(lastUpdated).toLocaleString()}` : "Not saved yet"}</span>
              <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="sm">Clear fields</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Clear conversation fields?</AlertDialogTitle><AlertDialogDescription>This removes the saved context, intent, and tone for {personName}.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={clearFields}>Clear</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
            </div>
          </CardContent>
        </Card>
      </div>
      <Chat personId={personId} personName={personName} conversationContext={{ context, intent, presetTone, customTone }} />
    </div>
  );
}
