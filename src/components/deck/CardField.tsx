import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type FieldErrors = Partial<Record<"front" | "back", string>>;

// The first message per field from zod's (or the API's) fieldErrors record.
export function firstErrors(fieldErrors: Partial<Record<string, string[]>>): FieldErrors {
  return { front: fieldErrors.front?.[0], back: fieldErrors.back?.[0] };
}

interface CardFieldProps {
  // free-form so several editors can share a page ("p-<itemId>-front")
  id: string;
  name: "front" | "back";
  label: string;
  value: string;
  max: number;
  rows: number;
  placeholder: string;
  error?: string;
  // read-only rather than disabled, so a focused field keeps focus during a request
  readOnly?: boolean;
  onChange: (value: string) => void;
}

export function CardField({
  id,
  name,
  label,
  value,
  max,
  rows,
  placeholder,
  error,
  readOnly,
  onChange,
}: CardFieldProps) {
  const errorId = `${id}-error`;
  // the schema measures the trimmed value, so the counter does too
  const length = value.trim().length;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <label htmlFor={id} className="text-blue-100/80">
          {label}
        </label>
        <span className={cn("text-xs", length > max ? "text-red-300" : "text-white/40")}>
          {length}/{max}
        </span>
      </div>
      <textarea
        id={id}
        name={name}
        rows={rows}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className={cn(
          "w-full resize-y rounded-lg border bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:outline-none",
          error ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400",
        )}
      />
      {error && (
        <p id={errorId} className="mt-1 flex items-center gap-1 text-xs text-red-300">
          <CircleAlert className="size-3" />
          {error}
        </p>
      )}
    </div>
  );
}
