import { useRef } from "react";
import { FileText, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";

export interface ChatAttachment {
  name: string;
  content: string;
  size: number;
}

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  onSend: () => void;
  loading: boolean;
  attachments: ChatAttachment[];
  onAddAttachment: (attachment: ChatAttachment) => void;
  onRemoveAttachment: (index: number) => void;
}

const MAX_FILE_SIZE = 100 * 1024;

export function ChatInput({ input, setInput, onSend, loading, attachments, onAddAttachment, onRemoveAttachment }: ChatInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_SIZE) continue;
      try {
        onAddAttachment({ name: file.name, content: await file.text(), size: file.size });
      } catch {
        // Ignore unreadable binary files.
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const formatSize = (bytes: number) => bytes < 1024 ? `${bytes}B` : `${(bytes / 1024).toFixed(1)}KB`;

  return (
    <div className="space-y-2">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((attachment, index) => (
            <div key={`${attachment.name}-${index}`} className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
              <FileText className="h-3 w-3 text-muted-foreground" />
              <span className="max-w-[140px] truncate">{attachment.name}</span>
              <span className="text-muted-foreground">({formatSize(attachment.size)})</span>
              <button type="button" onClick={() => onRemoveAttachment(index)} className="text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <input ref={fileInputRef} type="file" multiple className="hidden" accept=".txt,.md,.csv,.json,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.yaml,.yml,.toml,.log,.cfg,.ini,.rtf" onChange={handleFileSelect} />
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" disabled={loading} onClick={() => fileInputRef.current?.click()}>
          <Paperclip className="h-4 w-4" />
        </Button>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); } }}
          disabled={loading}
          rows={2}
          placeholder={`Ask ${BRAND.personaName}…`}
          className="min-h-[56px] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Button size="icon" className="shrink-0" disabled={loading || (!input.trim() && attachments.length === 0)} onClick={onSend}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
