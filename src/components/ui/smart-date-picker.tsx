import { useEffect, useMemo, useRef, useState } from "react";
import { format, parse, isValid, setMonth, setYear, lastDayOfMonth } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type SmartDatePickerProps = {
  value: Date | null;
  onChange: (date: Date | null) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
};

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  format(new Date(2000, i, 1), "MMMM"),
);

const PARSE_FORMATS = ["yyyy-MM-dd", "dd.MM.yyyy", "MM/dd/yyyy", "yyyy/MM/dd"];

function parseLooseDate(input: string): Date | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  for (const fmt of PARSE_FORMATS) {
    const d = parse(trimmed, fmt, new Date());
    if (isValid(d)) return d;
  }
  return null;
}

function clampDay(year: number, monthIndex: number, day: number): Date {
  const candidate = new Date(year, monthIndex, 1);
  const lastDay = lastDayOfMonth(candidate).getDate();
  candidate.setDate(Math.min(day, lastDay));
  return candidate;
}

export function SmartDatePicker({
  value,
  onChange,
  placeholder = "Select date",
  className,
  ariaLabel,
}: SmartDatePickerProps) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState<Date>(value ?? new Date());
  const [text, setText] = useState<string>(value ? format(value, "yyyy-MM-dd") : "");
  const [textInvalid, setTextInvalid] = useState(false);
  const lastValueRef = useRef<Date | null>(value);

  useEffect(() => {
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;
      setText(value ? format(value, "yyyy-MM-dd") : "");
      if (value) setViewMonth(value);
      setTextInvalid(false);
    }
  }, [value]);

  const currentYear = new Date().getFullYear();
  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = currentYear + 10; y >= currentYear - 100; y--) list.push(y);
    return list;
  }, [currentYear]);

  const handleTextChange = (raw: string) => {
    setText(raw);
    if (!raw.trim()) {
      setTextInvalid(false);
      onChange(null);
      return;
    }
    const parsed = parseLooseDate(raw);
    if (parsed) {
      setTextInvalid(false);
      setViewMonth(parsed);
      onChange(parsed);
    } else {
      setTextInvalid(true);
    }
  };

  const handleMonthSelect = (monthStr: string) => {
    const m = Number(monthStr);
    const next = setMonth(viewMonth, m);
    setViewMonth(next);
    if (value) {
      const clamped = clampDay(next.getFullYear(), m, value.getDate());
      onChange(clamped);
      setText(format(clamped, "yyyy-MM-dd"));
    }
  };

  const handleYearSelect = (yearStr: string) => {
    const y = Number(yearStr);
    const next = setYear(viewMonth, y);
    setViewMonth(next);
    if (value) {
      const clamped = clampDay(y, value.getMonth(), value.getDate());
      onChange(clamped);
      setText(format(clamped, "yyyy-MM-dd"));
    }
  };

  const handleCalendarSelect = (d: Date | undefined) => {
    if (!d) {
      onChange(null);
      setText("");
      return;
    }
    onChange(d);
    setText(format(d, "yyyy-MM-dd"));
    setViewMonth(d);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={ariaLabel}
          className={cn(
            "w-full justify-start",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value ? format(value, "MMM d, yyyy") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <div className="space-y-2 border-b p-3">
          <Input
            value={text}
            placeholder="YYYY-MM-DD"
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const parsed = parseLooseDate(text);
                if (parsed) {
                  onChange(parsed);
                  setViewMonth(parsed);
                  setOpen(false);
                }
              }
            }}
            className={cn(
              "h-9",
              textInvalid && "border-destructive focus-visible:ring-destructive",
            )}
          />
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={String(viewMonth.getMonth())}
              onValueChange={handleMonthSelect}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {MONTHS.map((name, idx) => (
                  <SelectItem key={name} value={String(idx)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(viewMonth.getFullYear())}
              onValueChange={handleYearSelect}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Calendar
          mode="single"
          selected={value ?? undefined}
          onSelect={handleCalendarSelect}
          month={viewMonth}
          onMonthChange={setViewMonth}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
