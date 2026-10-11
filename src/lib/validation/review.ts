import { z } from "zod";

// No server imports here: the review island may share these limits.

// day_end is the client's next local midnight, so it lies at most a day ahead;
// two days leave room for clock skew and the longest time-zone offsets.
export const DAY_END_MAX_HOURS = 48;

export const DAY_END_MESSAGE = `Must be after now and at most ${DAY_END_MAX_HOURS} hours ahead`;

// An ISO datetime with an offset, parsed into a Date.
const dayEndFormat = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .refine((dayEnd) => !Number.isNaN(dayEnd.getTime()), "Must be a valid date");

// Bounds day_end against the server's clock: strictly after now (the queue
// would otherwise hide overdue cards) and at most DAY_END_MAX_HOURS ahead.
// next_review_card refuses anything outside this as well.
export function dayEndInWindow(dayEnd: Date, now: Date): boolean {
  return dayEnd.getTime() > now.getTime() && dayEnd.getTime() <= now.getTime() + DAY_END_MAX_HOURS * 3_600_000;
}

// Query of GET /api/reviews/next. Search params are strings, so learning_only
// is "true" or "false" (absent means false).
export function nextReviewQuerySchema(now: Date) {
  return z.object({
    day_end: dayEndFormat.refine((dayEnd) => dayEndInWindow(dayEnd, now), DAY_END_MESSAGE),
    learning_only: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  });
}

// Body of POST /api/reviews. Ids use z.guid(), not z.uuid(): Postgres accepts
// any 8-4-4-4-12 hex string, so the RFC version bits are not ours to check.
// rating is Again (1), Hard (2), Good (3) or Easy (4); ts-fsrs rejects Manual (0).
// day_end is checked for shape only: the route bounds it with dayEndInWindow
// after the grade is saved, so a stale day_end never costs the grade.
export const recordReviewSchema = z.object({
  review_id: z.guid(),
  flashcard_id: z.guid(),
  rating: z.literal([1, 2, 3, 4]),
  day_end: dayEndFormat,
  learning_only: z.boolean().default(false),
});
