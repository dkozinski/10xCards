import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { z } from "zod";
import { ServerError } from "@/components/auth/ServerError";
import { CardField, type FieldErrors, firstErrors } from "@/components/deck/CardField";
import { useUnsavedChangesGuard } from "@/components/hooks/useUnsavedChangesGuard";
import { Button } from "@/components/ui/button";
import type { ApiErrorBody } from "@/lib/api-errors";
import { BACK_MAX, FRONT_MAX, createFlashcardSchema } from "@/lib/validation/flashcard";
import type { FlashcardDto } from "@/types";

// A single-row update or delete by primary key; anything slower is a hung connection.
const REQUEST_TIMEOUT_MS = 30_000;

const ITEM_BUTTON = "rounded-lg border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20";

type Mode = "view" | "editing" | "confirmDelete";

interface DeckCardProps {
  // only what the island uses: every prop is serialized into the page's HTML
  card: Pick<FlashcardDto, "id" | "front" | "back">;
  // 1-based position in the whole deck, so screen readers can tell the buttons apart
  position: number;
}

function Spinner() {
  return <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />;
}

export default function DeckCard({ card, position }: DeckCardProps) {
  const [mode, setMode] = useState<Mode>("view");
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState<"save" | "delete" | null>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const prevModeRef = useRef<Mode>(mode);

  const modified = mode === "editing" && (front.trim() !== card.front || back.trim() !== card.back);
  const { disarm } = useUnsavedChangesGuard(modified);

  // The focused button is gone after every switch: focus moves into the new mode,
  // and back to the button that opened it on return (never on the first render).
  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = mode;
    if (prev === mode) return;
    if (mode === "editing") document.getElementById(`card-${card.id}-front`)?.focus();
    if (mode === "confirmDelete") cancelDeleteRef.current?.focus();
    if (mode === "view") (prev === "editing" ? editRef : deleteRef).current?.focus();
  }, [mode, card.id]);

  function backToView() {
    setFront(card.front);
    setBack(card.back);
    setErrors({});
    setServerError(null);
    setMode("view");
  }

  // Shared by save and delete: success reloads the server-rendered deck, anything
  // else re-enables the buttons with a message.
  async function send(kind: "save" | "delete", init: RequestInit, okStatus: number) {
    setServerError(null);
    setPending(kind);
    try {
      const response = await fetch(`/api/flashcards/${card.id}`, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      // A delete that finds no card has still reached its goal, e.g. a retry after a
      // timeout whose first request was already committed.
      if (response.status === okStatus || (kind === "delete" && response.status === 404)) {
        // Same URL keeps ?page=; the page redirects itself if a delete emptied it.
        // The buttons stay disabled until the navigation replaces the page.
        disarm();
        window.location.assign(window.location.href);
        // Another card's unsaved-changes prompt can cancel the navigation ("Stay"),
        // which the page cannot observe; re-enable the buttons if it is still here.
        setTimeout(() => {
          setPending(null);
        }, 1000);
        return;
      }
      // Partial: a proxy or platform error page may answer with JSON of another shape
      const body = (await response.json().catch(() => null)) as Partial<ApiErrorBody> | null;
      const code = body?.error?.code;
      if (code === "validation_failed" && body?.error?.details) {
        const fields = firstErrors(body.error.details.fieldErrors);
        setErrors(fields);
        // e.g. only _root (body too large): nothing to show under a field
        if (!fields.front && !fields.back) setServerError("Could not save the card. Please try again.");
      } else if (code === "not_found") {
        setServerError("This card no longer exists. Refresh the deck.");
      } else if (code === "unauthorized") {
        setServerError("Your session has expired. Sign in again, then retry.");
      } else {
        setServerError(
          kind === "save"
            ? "Could not save the card. Please try again."
            : "Could not delete the card. Please try again.",
        );
      }
    } catch {
      setServerError("Network error. Check your connection and try again.");
    }
    setPending(null);
  }

  function save() {
    const parsed = createFlashcardSchema.safeParse({ front, back });
    if (!parsed.success) {
      setErrors(firstErrors(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    setErrors({});
    if (parsed.data.front === card.front && parsed.data.back === card.back) {
      backToView();
      return;
    }
    void send(
      "save",
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) },
      200,
    );
  }

  const busy = pending !== null;

  return (
    <div>
      {mode === "editing" ? (
        <div className="space-y-3">
          <CardField
            id={`card-${card.id}-front`}
            name="front"
            label="Front"
            value={front}
            max={FRONT_MAX}
            rows={2}
            placeholder="Question or term"
            error={errors.front}
            readOnly={busy}
            onChange={(v) => {
              setFront(v);
              if (errors.front) setErrors((prev) => ({ ...prev, front: undefined }));
            }}
          />
          <CardField
            id={`card-${card.id}-back`}
            name="back"
            label="Back"
            value={back}
            max={BACK_MAX}
            rows={4}
            placeholder="Answer or definition"
            error={errors.back}
            readOnly={busy}
            onChange={(v) => {
              setBack(v);
              if (errors.back) setErrors((prev) => ({ ...prev, back: undefined }));
            }}
          />
        </div>
      ) : (
        <>
          <p className="font-medium break-words whitespace-pre-wrap">{card.front}</p>
          <p className="mt-2 border-t border-white/10 pt-2 text-sm break-words whitespace-pre-wrap text-blue-100/80">
            {card.back}
          </p>
        </>
      )}

      {serverError && (
        <div className="mt-3">
          <ServerError message={serverError} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {mode === "view" && (
          <>
            <Button
              type="button"
              size="sm"
              ref={editRef}
              aria-label={`Edit card ${position}`}
              onClick={() => {
                setServerError(null);
                setMode("editing");
              }}
              className={ITEM_BUTTON}
            >
              <Pencil />
              Edit
            </Button>
            <Button
              type="button"
              size="sm"
              ref={deleteRef}
              aria-label={`Delete card ${position}`}
              onClick={() => {
                setServerError(null);
                setMode("confirmDelete");
              }}
              className={ITEM_BUTTON}
            >
              <Trash2 />
              Delete
            </Button>
          </>
        )}

        {mode === "editing" && (
          <>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              aria-label={`Save card ${position}`}
              onClick={save}
              className="rounded-lg bg-purple-600 text-white transition-colors hover:bg-purple-500"
            >
              {pending === "save" ? <Spinner /> : <Check />}
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              aria-label={`Cancel editing card ${position}`}
              onClick={backToView}
              className={ITEM_BUTTON}
            >
              <X />
              Cancel
            </Button>
          </>
        )}

        {mode === "confirmDelete" && (
          <>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy}
              aria-label={`Confirm delete card ${position}`}
              onClick={() => void send("delete", { method: "DELETE" }, 204)}
              className="rounded-lg"
            >
              {pending === "delete" ? <Spinner /> : <Trash2 />}
              Confirm delete
            </Button>
            <Button
              ref={cancelDeleteRef}
              type="button"
              size="sm"
              disabled={busy}
              aria-label={`Cancel deleting card ${position}`}
              onClick={backToView}
              className={ITEM_BUTTON}
            >
              <X />
              Cancel
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
