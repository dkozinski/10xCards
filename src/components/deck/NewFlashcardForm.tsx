import React, { useState } from "react";
import { Plus } from "lucide-react";
import { z } from "zod";
import { ServerError } from "@/components/auth/ServerError";
import { CardField, type FieldErrors, firstErrors } from "@/components/deck/CardField";
import { Button } from "@/components/ui/button";
import type { ApiErrorBody } from "@/lib/api-errors";
import { BACK_MAX, FRONT_MAX, createFlashcardSchema } from "@/lib/validation/flashcard";

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
        const fields = firstErrors(body.error.details.fieldErrors);
        setErrors(fields);
        // e.g. only _root (body too large): nothing to show under a field
        if (!fields.front && !fields.back) setServerError("Could not save the flashcard. Please try again.");
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
        name="front"
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
        name="back"
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
