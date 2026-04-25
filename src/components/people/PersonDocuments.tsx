import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Database, FileText, Loader2, Plus, Save, Trash2, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

interface PersonDocument {
  id: string;
  title: string;
  doc_type: string;
  content: string;
  memory_type: "short_term" | "long_term";
  embedding_updated_at: string | null;
  updated_at: string;
}

const DOC_TYPES = [
  { value: "journal", label: "Journal" },
  { value: "chat-notes", label: "Chat Notes" },
  { value: "reflections", label: "Reflections" },
  { value: "other", label: "Other" },
];

export function PersonDocuments({ personId, personName }: { personId: string; personName: string }) {
  const { toast } = useToast();
  const [documents, setDocuments] = useState<PersonDocument[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<PersonDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [embedding, setEmbedding] = useState(false);
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editDocType, setEditDocType] = useState("other");

  const loadDocuments = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase.from("person_documents" as any).select("*").eq("user_id", user.id).eq("person_id", personId).order("updated_at", { ascending: false });
    if (error) toast({ variant: "destructive", title: "Failed to load documents", description: error.message });
    setDocuments((data || []) as unknown as PersonDocument[]);
    setLoading(false);
  }, [personId, toast]);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  const openDocument = (doc: PersonDocument) => {
    setSelectedDoc(doc); setEditTitle(doc.title); setEditContent(doc.content); setEditDocType(doc.doc_type);
  };

  const createDocument = async (memoryType: "short_term" | "long_term") => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase.from("person_documents" as any).insert({ user_id: user.id, person_id: personId, title: memoryType === "short_term" ? "New Note" : "New Memory", content: "", memory_type: memoryType, doc_type: "other" }).select().single();
    if (error) return toast({ variant: "destructive", title: "Failed to create document", description: error.message });
    openDocument(data as unknown as PersonDocument);
    await loadDocuments();
  };

  const embedDocument = async (documentId: string) => {
    setEmbedding(true);
    try {
      const { error } = await supabase.functions.invoke("embed-document", { body: { documentId } });
      if (error) throw error;
    } catch (error: any) {
      toast({ variant: "destructive", title: "Indexing failed", description: error?.message });
    } finally {
      setEmbedding(false);
    }
  };

  const saveDocument = async () => {
    if (!selectedDoc) return;
    setSaving(true);
    const { error } = await supabase.from("person_documents" as any).update({ title: editTitle, content: editContent, doc_type: editDocType }).eq("id", selectedDoc.id);
    if (error) {
      setSaving(false);
      return toast({ variant: "destructive", title: "Failed to save", description: error.message });
    }
    if (selectedDoc.memory_type === "long_term" && editContent.trim()) await embedDocument(selectedDoc.id);
    toast({ title: "Saved" });
    setSaving(false);
    await loadDocuments();
    setSelectedDoc({ ...selectedDoc, title: editTitle, content: editContent, doc_type: editDocType, embedding_updated_at: selectedDoc.memory_type === "long_term" ? new Date().toISOString() : selectedDoc.embedding_updated_at });
  };

  const deleteDocument = async () => {
    if (!deleteDocId) return;
    const { error } = await supabase.from("person_documents" as any).delete().eq("id", deleteDocId);
    if (error) return toast({ variant: "destructive", title: "Failed to delete", description: error.message });
    if (selectedDoc?.id === deleteDocId) setSelectedDoc(null);
    setDeleteDocId(null);
    await loadDocuments();
  };

  const shortTermDocs = documents.filter((d) => d.memory_type === "short_term");
  const longTermDocs = documents.filter((d) => d.memory_type === "long_term");
  const docTypeLabel = (value: string) => DOC_TYPES.find((type) => type.value === value)?.label || "Other";

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  if (selectedDoc) return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Button variant="ghost" size="sm" onClick={() => setSelectedDoc(null)}><ArrowLeft className="mr-1 h-4 w-4" />Back</Button><Badge variant="outline">{selectedDoc.memory_type === "short_term" ? "Short-term" : "Long-term"}</Badge>{selectedDoc.memory_type === "long_term" && <Badge variant={selectedDoc.embedding_updated_at ? "default" : "secondary"}>{embedding ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}{embedding ? "Indexing…" : selectedDoc.embedding_updated_at ? "Indexed" : "Pending"}</Badge>}</div>
      <Card><CardContent className="space-y-4 pt-6"><div className="space-y-2"><Label>Title</Label><Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} /></div><div className="space-y-2"><Label>Type</Label><Select value={editDocType} onValueChange={setEditDocType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{DOC_TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Content</Label><Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={14} /></div><div className="flex justify-between"><Button variant="ghost" className="text-destructive" onClick={() => setDeleteDocId(selectedDoc.id)}><Trash2 className="mr-2 h-4 w-4" />Delete</Button><Button onClick={saveDocument} disabled={saving || embedding}>{(saving || embedding) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save</Button></div></CardContent></Card>
      <ConfirmDelete deleteDocument={deleteDocument} deleteDocId={deleteDocId} setDeleteDocId={setDeleteDocId} />
    </div>
  );

  const renderSection = (type: "short_term" | "long_term", docs: PersonDocument[]) => {
    const isShort = type === "short_term";
    const Icon = isShort ? Zap : Database;
    return <Card><CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2 text-base"><Icon className="h-4 w-4 text-primary" />{isShort ? "Short-term Memory" : "Long-term Memory"}</CardTitle><p className="mt-2 text-sm text-muted-foreground">{isShort ? `These notes are directly on Mira's mind during every conversation with ${personName}. They increase AI usage and too much information might confuse Mira, so keep it short and sweet.` : `These are memories that Mira can access when you talk about them. Otherwise, they won't play a huge role in the conversation. They don't use up too many extra AI credits.`}</p></div><Button size="sm" variant="outline" onClick={() => createDocument(type)}><Plus className="mr-1 h-4 w-4" />{isShort ? "Add Note" : "Add Memory"}</Button></div></CardHeader><CardContent>{docs.length === 0 ? <p className="text-sm text-muted-foreground">No documents yet.</p> : <div className="space-y-2">{docs.map((doc) => <button key={doc.id} onClick={() => openDocument(doc)} className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent/50"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{doc.title || "Untitled"}</p><p className="text-xs text-muted-foreground">{docTypeLabel(doc.doc_type)} · Updated {new Date(doc.updated_at).toLocaleDateString()}</p></div><div className="flex items-center gap-2">{!isShort && <Badge variant={doc.embedding_updated_at ? "default" : "secondary"}>{doc.embedding_updated_at ? "Indexed" : "Pending"}</Badge>}<FileText className="h-4 w-4 text-muted-foreground" /></div></div></button>)}</div>}</CardContent></Card>;
  };

  return <div className="space-y-4">{renderSection("short_term", shortTermDocs)}{renderSection("long_term", longTermDocs)}<ConfirmDelete deleteDocument={deleteDocument} deleteDocId={deleteDocId} setDeleteDocId={setDeleteDocId} /></div>;
}

function ConfirmDelete({ deleteDocId, setDeleteDocId, deleteDocument }: { deleteDocId: string | null; setDeleteDocId: (id: string | null) => void; deleteDocument: () => void }) {
  return <AlertDialog open={!!deleteDocId} onOpenChange={(open) => !open && setDeleteDocId(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete document?</AlertDialogTitle><AlertDialogDescription>This cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={deleteDocument}>Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}
