import { useState } from "react";
import { Check, Pencil, RotateCcw, Save, Trash2, Undo2, X } from "lucide-react";
import { z } from "zod";
import { ServerError } from "@/components/auth/ServerError";
import { CardField, type FieldErrors, firstErrors } from "@/components/deck/CardField";
import { useUnsavedChangesGuard } from "@/components/hooks/useUnsavedChangesGuard";
import { Button } from "@/components/ui/button";
import type { ApiErrorBody } from "@/lib/api-errors";
import { cn } from "@/lib/utils";
import { BACK_MAX, FRONT_MAX, createFlashcardSchema } from "@/lib/validation/flashcard";
import { proposalSource } from "@/lib/validation/generation";
import type { FlashcardProposalDto, SaveGenerationCommand, SaveGenerationResponseDto } from "@/types";

// One RPC of at most 21 rows; anything slower is a hung connection.
const SAVE_TIMEOUT_MS = 30_000;

const SAVE_FAILED = "Could not save. Please try again.";

// The failing editors may be off-screen in a list of 20, so the alert names how many.
function needsFixing(count: number): string {
  return count === 1 ? "1 card needs fixing before saving." : `${count} cards need fixing before saving.`;
}

const ITEM_BUTTON = "rounded-lg border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20";

interface ReviewItem {
  id: string;
  original: FlashcardProposalDto;
  front: string;
  back: string;
  rejected: boolean;
  editing: boolean;
  errors: FieldErrors;
}

// A command as it went out, with the item behind each card so per-card errors
// ("cards.3.back") can be mapped back to the list.
interface SentCommand {
  command: SaveGenerationCommand;
  itemIds: string[];
}

function cardErrors(fieldErrors: Partial<Record<string, string[]>>, itemIds: string[]): Map<string, FieldErrors> {
  const byItem = new Map<string, FieldErrors>();
  for (const [key, messages] of Object.entries(fieldErrors)) {
    const match = /^cards\.(\d+)\.(front|back)$/.exec(key);
    if (!match || !messages?.[0]) continue;
    const id = itemIds[Number(match[1])];
    if (!id) continue;
    byItem.set(id, { ...byItem.get(id), [match[2]]: messages[0] });
  }
  return byItem;
}

interface ProposalReviewProps {
  generationId: string;
  proposals: FlashcardProposalDto[];
  onDiscarded: () => void;
}

export default function ProposalReview({ generationId, proposals, onDiscarded }: ProposalReviewProps) {
  const [items, setItems] = useState<ReviewItem[]>(() =>
    proposals.map((p) => ({
      id: crypto.randomUUID(),
      original: p,
      front: p.front,
      back: p.back,
      rejected: false,
      editing: false,
      errors: {},
    })),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set after an ambiguous failure: the server may already have committed, and a
  // retry with the same generation_id replays that first result whatever the new
  // payload says. So the list is locked and Try again resends this exact command.
  const [frozen, setFrozen] = useState<SentCommand | null>(null);
  const [announce, setAnnounce] = useState(false);
  // mounted = a review is pending, so the guard is armed for the component's lifetime
  const { disarm } = useUnsavedChangesGuard(true);

  const locked = pending || frozen !== null;
  const keptCount = items.filter((i) => !i.rejected).length;

  function update(id: string, change: (item: ReviewItem) => Partial<ReviewItem>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...change(i) } : i)));
  }

  function setRejected(id: string, rejected: boolean) {
    // a rejected card is not saved, so its editor and errors no longer matter
    update(id, () => (rejected ? { rejected, editing: false, errors: {} } : { rejected }));
    setAnnounce(true);
  }

  function finishEditing(item: ReviewItem) {
    const parsed = createFlashcardSchema.safeParse({ front: item.front, back: item.back });
    update(item.id, () =>
      parsed.success
        ? { editing: false, errors: {} }
        : { errors: firstErrors(z.flattenError(parsed.error).fieldErrors) },
    );
  }

  function revert(item: ReviewItem) {
    update(item.id, () => ({ front: item.original.front, back: item.original.back, errors: {} }));
  }

  // Validates every kept card, editors open or not; opens the invalid ones.
  function buildCommand(): SentCommand | null {
    const kept = items.filter((i) => !i.rejected);
    const cards: SaveGenerationCommand["cards"] = [];
    const invalid = new Map<string, FieldErrors>();
    for (const item of kept) {
      const parsed = createFlashcardSchema.safeParse({ front: item.front, back: item.back });
      if (parsed.success) cards.push({ ...parsed.data, source: proposalSource(item.original, parsed.data) });
      else invalid.set(item.id, firstErrors(z.flattenError(parsed.error).fieldErrors));
    }
    if (invalid.size > 0) {
      setItems((prev) => prev.map((i) => ({ ...i, ...openWith(invalid.get(i.id)) })));
      setError(needsFixing(invalid.size));
      return null;
    }
    return {
      command: { generation_id: generationId, generated_count: proposals.length, cards },
      itemIds: kept.map((i) => i.id),
    };
  }

  async function save() {
    if (pending) return;
    setError(null);

    const sent = frozen ?? buildCommand();
    if (!sent) return;
    // every kept card is valid and about to go out; closing the editors keeps
    // the list from drifting away from the command while it is in flight
    setItems((prev) => prev.map((i) => ({ ...i, editing: false, errors: {} })));
    setPending(true);

    let response: Response;
    try {
      response = await fetch("/api/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sent.command),
        signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
      });
    } catch {
      // network error or timeout: the request may have reached the database
      setFrozen(sent);
      setError(SAVE_FAILED);
      setPending(false);
      return;
    }

    // Partial: a proxy or platform page may answer with a body of another shape, or none at all
    const body = (await response.json().catch(() => null)) as Partial<SaveGenerationResponseDto & ApiErrorBody> | null;
    const code = body?.error?.code;
    if (response.ok && typeof body?.saved_count === "number") {
      // branch on what was sent, not on the list: after a retry they are the same
      // command, but the sent one is what the server recorded
      if (sent.command.cards.length > 0) {
        // the deck is rendered on the server; the button stays disabled until the
        // navigation replaces the page, and the guard must not prompt for it
        disarm();
        window.location.assign("/deck");
        return;
      }
      onDiscarded();
      return;
    }

    if (code === "validation_failed" && body?.error?.details) {
      // the route validates before the RPC, so nothing was written: even a
      // frozen list can be unlocked for the user to fix the cards
      setFrozen(null);
      const byItem = cardErrors(body.error.details.fieldErrors, sent.itemIds);
      if (byItem.size > 0) {
        setItems((prev) => prev.map((i) => ({ ...i, ...openWith(byItem.get(i.id)) })));
        setError(needsFixing(byItem.size));
      } else {
        setError(SAVE_FAILED);
      }
    } else if (code === "unauthorized") {
      // signing in from this tab would leave the page and lose the review
      setError("Your session has expired. Sign in again in another tab, then save again.");
    } else {
      // 5xx or a 200 of another shape: the server may have committed
      setFrozen(sent);
      setError(SAVE_FAILED);
    }
    setPending(false);
  }

  const discarding = (frozen?.command.cards.length ?? keptCount) === 0;

  return (
    <div>
      <h2 className="mb-1 text-xl font-semibold">Proposals ({proposals.length})</h2>
      <p className="mb-4 text-sm text-blue-100/60">
        Reject what you don&apos;t want, edit what&apos;s almost right, then save.
      </p>

      {/* Mounted empty with the list, so only later changes are announced; the
          initial count is announced by the island's own live region. */}
      <p className="sr-only" aria-live="polite">
        {announce ? `${keptCount} of ${proposals.length} proposals kept` : ""}
      </p>

      <ul className="space-y-3">
        {items.map((item, index) => {
          const n = index + 1;
          const edited = !item.rejected && proposalSource(item.original, item) === "ai_edited";
          return (
            <li
              key={item.id}
              className={cn("rounded-lg border border-white/10 bg-white/5 p-4", item.rejected && "opacity-50")}
            >
              {item.editing ? (
                <div className="space-y-3">
                  <CardField
                    id={`p-${item.id}-front`}
                    name="front"
                    label="Front"
                    value={item.front}
                    max={FRONT_MAX}
                    rows={2}
                    placeholder="Question or term"
                    error={item.errors.front}
                    onChange={(v) => {
                      update(item.id, (i) => ({ front: v, errors: { ...i.errors, front: undefined } }));
                    }}
                  />
                  <CardField
                    id={`p-${item.id}-back`}
                    name="back"
                    label="Back"
                    value={item.back}
                    max={BACK_MAX}
                    rows={4}
                    placeholder="Answer or definition"
                    error={item.errors.back}
                    onChange={(v) => {
                      update(item.id, (i) => ({ back: v, errors: { ...i.errors, back: undefined } }));
                    }}
                  />
                </div>
              ) : (
                <div className={cn(item.rejected && "line-through")}>
                  <p className="font-medium break-words whitespace-pre-wrap">{item.front}</p>
                  <p className="mt-2 border-t border-white/10 pt-2 text-sm break-words whitespace-pre-wrap text-blue-100/80">
                    {item.back}
                  </p>
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {edited && (
                  <span className="rounded-full border border-purple-300/40 bg-purple-500/20 px-2 py-0.5 text-xs text-purple-100">
                    Edited
                  </span>
                )}
                {item.rejected && <span className="text-xs text-white/60">Rejected</span>}
                <div className="ml-auto flex flex-wrap gap-2">
                  {!item.rejected &&
                    (item.editing ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={locked}
                        aria-label={`Done editing proposal ${n}`}
                        onClick={() => {
                          finishEditing(item);
                        }}
                        className={ITEM_BUTTON}
                      >
                        <Check />
                        Done
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        disabled={locked}
                        aria-label={`Edit proposal ${n}`}
                        onClick={() => {
                          update(item.id, () => ({ editing: true }));
                        }}
                        className={ITEM_BUTTON}
                      >
                        <Pencil />
                        Edit
                      </Button>
                    ))}
                  {edited && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={locked}
                      aria-label={`Revert proposal ${n} to the original`}
                      onClick={() => {
                        revert(item);
                      }}
                      className={ITEM_BUTTON}
                    >
                      <Undo2 />
                      Revert
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    disabled={locked}
                    aria-label={`${item.rejected ? "Restore" : "Reject"} proposal ${n}`}
                    onClick={() => {
                      setRejected(item.id, !item.rejected);
                    }}
                    className={ITEM_BUTTON}
                  >
                    {item.rejected ? <RotateCcw /> : <X />}
                    {item.rejected ? "Restore" : "Reject"}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 space-y-3">
        <ServerError message={error} />
        {frozen && (
          <Button
            type="button"
            disabled={pending}
            onClick={() => void save()}
            className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-white transition-colors hover:bg-white/20"
          >
            <RotateCcw className="size-4" />
            Try again
          </Button>
        )}
        {/* Always enabled outside a request: discarding everything is a decision too,
            and it is recorded like a save (a generations row with no cards). */}
        <Button
          type="button"
          disabled={locked}
          onClick={() => void save()}
          className={cn(
            "w-full rounded-lg px-4 py-2 font-medium text-white transition-colors",
            discarding ? "border border-white/20 bg-white/10 hover:bg-white/20" : "bg-purple-600 hover:bg-purple-500",
          )}
        >
          {pending ? (
            <span className="flex items-center gap-2">
              <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              {discarding ? "Discarding…" : "Saving…"}
            </span>
          ) : discarding ? (
            <span className="flex items-center gap-2">
              <Trash2 className="size-4" />
              Discard all
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Save className="size-4" />
              Save {keptCount} {keptCount === 1 ? "card" : "cards"}
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}

// Opens an item's editor with the given errors; no errors leaves it untouched.
function openWith(errors: FieldErrors | undefined): Partial<ReviewItem> {
  return errors ? { editing: true, errors } : {};
}
