import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { TimelineContact } from "./AddEventDialog";

interface PeopleMultiSelectProps {
  people: TimelineContact[];
  value: string[];
  onChange: (ids: string[]) => void;
}

export default function PeopleMultiSelect({ people, value, onChange }: PeopleMultiSelectProps) {
  const [open, setOpen] = useState(false);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const peopleById = useMemo(() => {
    const m = new Map<string, TimelineContact>();
    for (const p of people) m.set(p.id, p);
    return m;
  }, [people]);

  const { selected, unselected } = useMemo(() => {
    const sel: TimelineContact[] = [];
    const unsel: TimelineContact[] = [];
    const sorted = [...people].sort((a, b) => a.name.localeCompare(b.name));
    for (const p of sorted) {
      if (selectedSet.has(p.id)) sel.push(p);
      else unsel.push(p);
    }
    return { selected: sel, unselected: unsel };
  }, [people, selectedSet]);

  const toggle = (id: string) => {
    if (selectedSet.has(id)) onChange(value.filter((v) => v !== id));
    else onChange([...value, id]);
  };

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((p) => (
            <Badge key={p.id} variant="secondary" className="gap-1 pr-1 h-6 text-xs">
              {p.name}
              <button
                type="button"
                onClick={() => toggle(p.id)}
                className="rounded-sm hover:bg-muted-foreground/20 p-0.5"
                aria-label={`Remove ${p.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal text-muted-foreground"
          >
            <span className="flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              {selected.length === 0 ? "Add person" : "Add more"}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="p-0 w-[--radix-popover-trigger-width] min-w-[260px]"
          align="start"
        >
          <Command>
            <CommandInput placeholder="Search people…" />
            <CommandList className="max-h-72">
              <CommandEmpty>No people found.</CommandEmpty>

              {selected.length > 0 && (
                <>
                  <CommandGroup heading="Selected">
                    {selected.map((p) => (
                      <CommandItem
                        key={p.id}
                        value={p.name}
                        onSelect={() => toggle(p.id)}
                      >
                        <Check className={cn("mr-2 h-4 w-4 opacity-100")} />
                        {p.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  <CommandSeparator />
                </>
              )}

              <CommandGroup heading={selected.length > 0 ? "All people" : undefined}>
                {unselected.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={p.name}
                    onSelect={() => toggle(p.id)}
                  >
                    <Check className="mr-2 h-4 w-4 opacity-0" />
                    {p.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
