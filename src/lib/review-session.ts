// Browser-side rules of a review session, kept out of the island so they can
// be unit-tested. No server imports: this runs in the browser.

import type { NextReviewResponseDto } from "@/types";

// A session offers this many distinct cards, then stops showing new and review
// cards (cards in learning still come back) and asks whether to continue.
export const REVIEW_BATCH_SIZE = 20;

// "Today" is the user's local day: the queue holds what is due before the next
// local midnight. Computed for every request, so a session that runs past
// midnight moves on to the new day instead of sending a day_end in the past.
// Date's local-time constructor handles DST and month ends (d + 1 rolls over).
export function nextLocalMidnight(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}

// A 2xx is trusted only in the shape the review routes send: a proxy or
// platform page answering 200 with other JSON must lead to Retry, not to a
// false "nothing to review" or an empty card that can still be graded.
export function isNextReviewResponse(body: unknown): body is NextReviewResponseDto {
  if (typeof body !== "object" || body === null) return false;
  const { card, due_count } = body as Record<string, unknown>;
  if (typeof due_count !== "number") return false;
  if (card === null) return true;
  if (typeof card !== "object") return false;
  const { id, front, back, state } = card as Record<string, unknown>;
  return typeof id === "string" && typeof front === "string" && typeof back === "string" && typeof state === "string";
}
