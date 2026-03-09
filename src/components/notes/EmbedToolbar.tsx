import { useState } from "react";
import { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ImagePlus,
  Film,
  FileText,
  Music,
  Paperclip,
  ChevronDown,
} from "lucide-react";

interface EmbedToolbarProps {
  editor: Editor | null;
}

type EmbedType = "image" | "video" | "pdf" | "audio";

const EMBED_OPTIONS: { type: EmbedType; label: string; icon: React.ElementType; placeholder: string }[] = [
  { type: "image", label: "Image", icon: ImagePlus, placeholder: "https://example.com/image.png" },
  { type: "video", label: "Video", icon: Film, placeholder: "https://youtube.com/watch?v=... or direct .mp4 URL" },
  { type: "pdf", label: "PDF", icon: FileText, placeholder: "https://example.com/document.pdf" },
  { type: "audio", label: "Audio", icon: Music, placeholder: "https://example.com/audio.mp3" },
];

export function EmbedToolbar({ editor }: EmbedToolbarProps) {
  const [open, setOpen] = useState(false);
  const [embedType, setEmbedType] = useState<EmbedType>("image");
  const [url, setUrl] = useState("");

  if (!editor) return null;

  const selected = EMBED_OPTIONS.find((o) => o.type === embedType)!;

  const handleInsert = () => {
    if (!url.trim()) return;

    const src = url.startsWith("http") ? url : `https://${url}`;

    switch (embedType) {
      case "image":
        editor.chain().focus().setImage({ src }).run();
        break;
      case "video":
        (editor.commands as any).setVideoEmbed({ src });
        break;
      case "pdf":
        (editor.commands as any).setPdfEmbed({ src });
        break;
      case "audio":
        (editor.commands as any).setAudioEmbed({ src });
        break;
    }

    setUrl("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Embed media (image, video, PDF, audio)"
        >
          <Paperclip className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="start">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground shrink-0">Type</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs w-full justify-between">
                  <span className="flex items-center gap-1.5">
                    <selected.icon className="h-3.5 w-3.5" />
                    {selected.label}
                  </span>
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                {EMBED_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={opt.type}
                    onClick={() => setEmbedType(opt.type)}
                  >
                    <opt.icon className="mr-2 h-4 w-4" />
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">URL</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={selected.placeholder}
              className="h-8 text-sm"
              onKeyDown={(e) => e.key === "Enter" && handleInsert()}
              autoFocus
            />
          </div>

          <Button size="sm" className="w-full h-8" onClick={handleInsert} disabled={!url.trim()}>
            Insert {selected.label}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
