import React, { useState } from "react";
import { CircleAlert, Plus } from "lucide-react";
import { z } from "zod";
import { ServerError } from "@/components/auth/ServerError";
import { Button } from "@/components/ui/button";
import type { ApiErrorBody } from "@/lib/api-errors";
import { cn } from "@/lib/utils";
import { BACK_MAX, FRONT_MAX, createFlashcardSchema } from "@/lib/validation/flashcard";

type Field = "front" | "back";
type FieldErrors = Partial<Record<Field, string>>;

function firstErrors(fieldErrors: Partial<Record<string, string[]>>): FieldErrors {
  return { front: fieldErrors.front?.[0], back: fieldErrors.back?.[0] };
}

interface CardFieldProps {
  id: Field;
  label: string;
  value: string;
  max: number;
  rows: number;
  placeholder: string;
  error?: string;
  onChange: (value: string) => void;
}

function CardField({ id, label, value, max, rows, placeholder, error, onChange }: CardFieldProps) {
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
        name={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
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

export default function NewFlashcardForm() {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setServerError(null);

    const parsed = createFlashcardSchema.safeParse({ front, back });
    if (!parsed.success) {
      setErrors(firstErrors(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    setErrors({});
    setPending(true);

    try {
      const response = await fetch("/api/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (response.status === 201) {
        // The list is rendered on the server; reloading page 1 shows the new card on top.
        // The button stays disabled until the navigation replaces the page.
        window.location.assign("/deck");
        return;
      }
      // Partial: a proxy or platform error page may answer with JSON of another shape
      const body = (await response.json().catch(() => null)) as Partial<ApiErrorBody> | null;
      if (body?.error?.code === "validation_failed" && body.error.details) {
        setErrors(firstErrors(body.error.details.fieldErrors));
      } else if (body?.error?.code === "unauthorized") {
        setServerError("Your session has expired. Sign in again to save this card.");
      } else {
        setServerError("Could not save the flashcard. Please try again.");
      }
    } catch {
      setServerError("Network error. Check your connection and try again.");
    }
    setPending(false);
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      <CardField
        id="front"
        label="Front"
        value={front}
        max={FRONT_MAX}
        rows={2}
        placeholder="Question or term"
        error={errors.front}
        onChange={(v) => {
          setFront(v);
          if (errors.front) setErrors((prev) => ({ ...prev, front: undefined }));
        }}
      />
      <CardField
        id="back"
        label="Back"
        value={back}
        max={BACK_MAX}
        rows={4}
        placeholder="Answer or definition"
        error={errors.back}
        onChange={(v) => {
          setBack(v);
          if (errors.back) setErrors((prev) => ({ ...prev, back: undefined }));
        }}
      />

      <ServerError message={serverError} />

      <Button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
      >
        {pending ? (
          <span className="flex items-center gap-2">
            <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Saving...
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <Plus className="size-4" />
            Add flashcard
          </span>
        )}
      </Button>
    </form>
  );
}
