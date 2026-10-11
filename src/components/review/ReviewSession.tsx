import { useEffect, useEffectEvent, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { ServerError } from "@/components/auth/ServerError";
import { Button } from "@/components/ui/button";
import type { ApiErrorBody } from "@/lib/api-errors";
import { REVIEW_BATCH_SIZE, isNextReviewResponse, nextLocalMidnight } from "@/lib/review-session";
import type { NextReviewResponseDto, ReviewCardDto, ReviewRating } from "@/types";

// One grade write plus one next-card read; anything slower is a hung connection.
const REQUEST_TIMEOUT_MS = 30_000;

const ITEM_BUTTON = "rounded-lg border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20";
const PRIMARY_BUTTON = "rounded-lg bg-purple-600 text-white transition-colors hover:bg-purple-500";
// focused from code only (tabIndex -1), so no focus ring around plain text
const END_MESSAGE = "text-blue-100/80 outline-none";

const GRADES: { rating: ReviewRating; label: string }[] = [
  { rating: 1, label: "Again" },
  { rating: 2, label: "Hard" },
  { rating: 3, label: "Good" },
  { rating: 4, label: "Easy" },
];

// Pessimistic: the screen moves on only after the server answered 2xx.
type Phase =
  | { kind: "loading" }
  | { kind: "front"; card: ReviewCardDto }
  | { kind: "revealed"; card: ReviewCardDto }
  | { kind: "grading"; card: ReviewCardDto; rating: ReviewRating }
  | { kind: "batchDone"; dueCount: number }
  | { kind: "nothingDue" }
  | { kind: "expired" };

// What Retry repeats after a failure.
type Retry = { action: "load" } | { action: "grade"; card: ReviewCardDto; rating: ReviewRating };

// Why it failed decides what the user is told: only the clock is theirs to fix.
type Cause = "clock" | "network" | "server";
type Failed = Retry & { cause: Cause };

// The island builds every field itself, so validation_failed can only mean
// day_end fell outside the server's window: the device clock is off. No code
// means the request never got an API answer (offline, timeout, a proxy page).
function causeOf(code: string | undefined): Cause {
  if (code === "validation_failed") return "clock";
  return code === undefined ? "network" : "server";
}

function failureMessage(failed: Failed): string {
  if (failed.cause === "clock") return "Your device clock looks wrong. Check its date and time, then retry.";
  if (failed.cause === "server") return "Something went wrong on our side. Retry in a moment.";
  return failed.action === "grade"
    ? "Could not save the grade. Check your connection and retry."
    : "Could not load the next card. Check your connection and retry.";
}

type Outcome = { ok: true; data: NextReviewResponseDto } | { ok: false; code?: string };

async function call(url: string, init?: RequestInit): Promise<Outcome> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (response.ok) {
      const body: unknown = await response.json();
      // no code: treated like a failed request, so Retry (a POST replays)
      return isNextReviewResponse(body) ? { ok: true, data: body } : { ok: false };
    }
    // Partial: a proxy or platform error page may answer with JSON of another shape
    const body = (await response.json().catch(() => null)) as Partial<ApiErrorBody> | null;
    return { ok: false, code: body?.error?.code };
  } catch {
    // network failure, timeout, or a 2xx body that is not JSON
    return { ok: false };
  }
}

function fetchNext(learningOnly: boolean): Promise<Outcome> {
  const params = new URLSearchParams({
    day_end: nextLocalMidnight().toISOString(),
    learning_only: String(learningOnly),
  });
  return call(`/api/reviews/next?${params.toString()}`);
}

export default function ReviewSession() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [dueCount, setDueCount] = useState<number | null>(null);
  const [failed, setFailed] = useState<Failed | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // Distinct cards graded in this batch; at REVIEW_BATCH_SIZE only cards in
  // learning keep coming (they would otherwise be forgotten until tomorrow).
  const gradedRef = useRef(new Set<string>());
  // Minted when a card is displayed, kept across retries of that card: a retry
  // of a grade that was already saved replays instead of grading twice.
  const reviewIdRef = useRef("");
  const showAnswerRef = useRef<HTMLButtonElement>(null);
  const goodRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  // the message of whichever end screen is showing; only one renders at a time
  const endMessageRef = useRef<HTMLParagraphElement>(null);
  // Bumped on every displayed card, so the same card coming back (learn ahead)
  // still moves focus and is announced with different text.
  const shownRef = useRef(0);
  const [shown, setShown] = useState(0);

  const learningOnly = (graded: Set<string>) => graded.size >= REVIEW_BATCH_SIZE;

  // lead: a notice the next announcement must carry, since it replaces the
  // live region's text before a screen reader gets to read the notice alone
  function show(data: NextReviewResponseDto, wasLearningOnly: boolean, lead = "") {
    setDueCount(data.due_count);
    setFailed(null);
    if (data.card) {
      reviewIdRef.current = crypto.randomUUID();
      setPhase({ kind: "front", card: data.card });
      shownRef.current += 1;
      setShown(shownRef.current);
      setAnnouncement(`${lead}Card ${shownRef.current}: ${data.card.front}`);
    } else if (wasLearningOnly) {
      setPhase({ kind: "batchDone", dueCount: data.due_count });
      setAnnouncement(`${lead}Batch done.`);
    } else {
      setPhase({ kind: "nothingDue" });
      setAnnouncement(`${lead}Nothing to review today.`);
    }
  }

  function fail(code: string | undefined, retry: Retry) {
    if (code === "unauthorized") {
      setFailed(null);
      setPhase({ kind: "expired" });
      setAnnouncement("Your session has expired.");
      return;
    }
    const failure: Failed = { ...retry, cause: causeOf(code) };
    setFailed(failure);
    setAnnouncement(failureMessage(failure));
  }

  function settleLoad(outcome: Outcome, only: boolean, lead = "") {
    if (outcome.ok) show(outcome.data, only, lead);
    else fail(outcome.code, { action: "load" });
  }

  async function loadNext(lead = "") {
    setFailed(null);
    setPhase({ kind: "loading" });
    const only = learningOnly(gradedRef.current);
    settleLoad(await fetchNext(only), only, lead);
  }

  async function grade(card: ReviewCardDto, rating: ReviewRating) {
    setFailed(null);
    setNotice(null);
    setPhase({ kind: "grading", card, rating });
    // the card being graded counts towards the batch for the lookup that follows
    const graded = new Set(gradedRef.current).add(card.id);
    const only = learningOnly(graded);
    const outcome = await call("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        review_id: reviewIdRef.current,
        flashcard_id: card.id,
        rating,
        // recomputed per attempt: a stale day_end is refused after the save,
        // and the retry replays with a fresh one
        day_end: nextLocalMidnight().toISOString(),
        learning_only: only,
      }),
    });
    if (outcome.ok) {
      gradedRef.current = graded;
      show(outcome.data, only);
      return;
    }
    if (outcome.code === "not_found") {
      // deleted in another tab (a grade saved before a failed lookup went
      // with it, by cascade) or never ours: skip it
      setNotice("This card no longer exists. Moving on to the next one.");
      await loadNext("This card no longer exists. ");
      return;
    }
    setPhase({ kind: "revealed", card });
    fail(outcome.code, { action: "grade", card, rating });
  }

  function retry() {
    if (!failed) return;
    if (failed.action === "load") void loadNext();
    else void grade(failed.card, failed.rating);
  }

  // First card. The state already reads "loading", so only the answer sets state.
  const onFirstCard = useEffectEvent((outcome: Outcome) => {
    settleLoad(outcome, false);
  });
  useEffect(() => {
    void fetchNext(false).then(onFirstCard);
  }, []);

  // Focus follows the card: "Show answer" on a new card, "Good" after reveal,
  // Retry after a failure, and Continue or the message on an end screen (the
  // focused grade button is gone by then). Never on the first loading render.
  useEffect(() => {
    if (failed) retryRef.current?.focus();
    else if (phase.kind === "front") showAnswerRef.current?.focus();
    else if (phase.kind === "revealed") goodRef.current?.focus();
    else if (continueRef.current) continueRef.current.focus();
    else endMessageRef.current?.focus();
  }, [phase.kind, shown, failed]);

  const card = phase.kind === "front" || phase.kind === "revealed" || phase.kind === "grading" ? phase.card : null;
  const answerVisible = phase.kind === "revealed" || phase.kind === "grading";

  return (
    <div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {dueCount !== null && card && <p className="mb-3 text-sm text-blue-100/60">{dueCount} due today</p>}

      {notice && <p className="mb-3 text-sm text-amber-200">{notice}</p>}

      {phase.kind === "loading" && !failed && <p className="text-sm text-blue-100/60">Loading the next card…</p>}

      {card && (
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <p className="font-medium break-words whitespace-pre-wrap">{card.front}</p>
          {answerVisible && (
            <p className="mt-2 border-t border-white/10 pt-2 text-sm break-words whitespace-pre-wrap text-blue-100/80">
              {card.back}
            </p>
          )}
        </div>
      )}

      {failed && (
        <div className="mt-3 space-y-3">
          <ServerError message={failureMessage(failed)} />
          <div className="flex justify-end">
            <Button type="button" size="sm" ref={retryRef} onClick={retry} className={ITEM_BUTTON}>
              <RotateCw />
              Retry
            </Button>
          </div>
        </div>
      )}

      {!failed && phase.kind === "front" && (
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            ref={showAnswerRef}
            onClick={() => {
              setPhase({ kind: "revealed", card: phase.card });
            }}
            className={PRIMARY_BUTTON}
          >
            Show answer
          </Button>
        </div>
      )}

      {!failed && (phase.kind === "revealed" || phase.kind === "grading") && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Grade this card">
          {GRADES.map(({ rating, label }) => (
            <Button
              key={rating}
              type="button"
              ref={rating === 3 ? goodRef : undefined}
              disabled={phase.kind === "grading"}
              onClick={() => void grade(phase.card, rating)}
              className={rating === 3 ? PRIMARY_BUTTON : ITEM_BUTTON}
            >
              {phase.kind === "grading" && phase.rating === rating && (
                <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              )}
              {label}
            </Button>
          ))}
        </div>
      )}

      {phase.kind === "nothingDue" && (
        <p ref={endMessageRef} tabIndex={-1} className={END_MESSAGE}>
          Nothing to review today — come back tomorrow.
        </p>
      )}

      {phase.kind === "batchDone" && (
        <div className="space-y-3">
          <p ref={endMessageRef} tabIndex={-1} className={END_MESSAGE}>
            {phase.dueCount > 0
              ? `Done — ${phase.dueCount} more ${phase.dueCount === 1 ? "card is" : "cards are"} waiting. Continue?`
              : "Done — nothing else is due today."}
          </p>
          <div className="flex justify-end gap-2">
            {phase.dueCount > 0 && (
              <Button
                type="button"
                ref={continueRef}
                onClick={() => {
                  gradedRef.current = new Set();
                  setNotice(null);
                  void loadNext();
                }}
                className={PRIMARY_BUTTON}
              >
                Continue
              </Button>
            )}
            <Button asChild className={ITEM_BUTTON}>
              <a href="/deck">Finish</a>
            </Button>
          </div>
        </div>
      )}

      {phase.kind === "expired" && (
        <p ref={endMessageRef} tabIndex={-1} className={END_MESSAGE}>
          Your session has expired.{" "}
          <a href="/auth/signin" className="text-purple-300 hover:text-purple-100 hover:underline">
            Sign in again
          </a>{" "}
          to continue reviewing.
        </p>
      )}
    </div>
  );
}
