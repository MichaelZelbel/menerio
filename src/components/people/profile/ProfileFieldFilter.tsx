import { useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface ProfileFieldFilterProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Live filter box for the compact fact list. Pressing "/" anywhere on the
 * page focuses this input, unless focus is already in an editable element
 * (input/textarea/contentEditable) or a dialog is open — so it never
 * hijacks "/" while the user is typing elsewhere or a modal is up. Esc
 * inside the input clears the query and blurs.
 */
export function ProfileFieldFilter({ value, onChange }: ProfileFieldFilterProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditableTarget = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
      if (isEditableTarget) return;

      // Radix Dialog renders role="dialog", but AlertDialog (e.g. the
      // delete-category confirmation) renders role="alertdialog" — guard both.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;

      e.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onChange("");
            inputRef.current?.blur();
          }
        }}
        placeholder="Filter fields… ( / )"
        className="h-9 pl-8 text-sm"
      />
    </div>
  );
}
