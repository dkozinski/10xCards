import { describe, expect, it } from "vitest";
import { DAY_END_MAX_HOURS, dayEndInWindow, nextReviewQuerySchema, recordReviewSchema } from "./review";

const now = new Date("2026-10-10T12:00:00Z");
const windowEnd = new Date(now.getTime() + DAY_END_MAX_HOURS * 3_600_000);
const valid = {
  review_id: "6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f",
  flashcard_id: "00000000-0000-0000-0000-0000000000a1",
  rating: 3,
  day_end: "2026-10-10T22:00:00.000Z",
};

describe("recordReviewSchema", () => {
  it("accepts a grade and parses day_end into a Date, learning_only defaulting to false", () => {
    const result = recordReviewSchema.safeParse(valid);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ...valid, day_end: new Date(valid.day_end), learning_only: false });
  });

  it.each([1, 2, 3, 4])("accepts rating %i", (rating) => {
    expect(recordReviewSchema.safeParse({ ...valid, rating }).success).toBe(true);
  });

  it.each([0, 5, 2.5, "3"])("rejects rating %p", (rating) => {
    expect(recordReviewSchema.safeParse({ ...valid, rating }).success).toBe(false);
  });

  it.each(["review_id", "flashcard_id"])("rejects a malformed %s", (key) => {
    expect(recordReviewSchema.safeParse({ ...valid, [key]: "not-a-uuid" }).success).toBe(false);
  });

  it("accepts an id that is not an RFC 4122 v4 uuid, as Postgres does", () => {
    expect(recordReviewSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a day_end with a time-zone offset", () => {
    expect(recordReviewSchema.safeParse({ ...valid, day_end: "2026-10-11T00:00:00+02:00" }).success).toBe(true);
  });

  it("checks only the shape of day_end: a past one passes, so a stale day_end never blocks the save", () => {
    expect(recordReviewSchema.safeParse({ ...valid, day_end: "2026-10-01T00:00:00.000Z" }).success).toBe(true);
  });

  it.each(["tomorrow", "2026-10-11", "2026-10-11T00:00:00+0200"])(
    "rejects a day_end that is not an ISO datetime: %p",
    (day_end) => {
      expect(recordReviewSchema.safeParse({ ...valid, day_end }).success).toBe(false);
    },
  );

  it("requires day_end", () => {
    const { day_end: _omitted, ...rest } = valid;
    expect(recordReviewSchema.safeParse(rest).success).toBe(false);
  });

  it("strips keys the route does not use", () => {
    const result = recordReviewSchema.safeParse({ ...valid, user_id: "x", state: "review" });
    expect(result.data).not.toHaveProperty("user_id");
    expect(result.data).not.toHaveProperty("state");
  });
});

describe("dayEndInWindow", () => {
  it.each([
    ["a second after now", new Date(now.getTime() + 1000), true],
    ["exactly the end of the window", windowEnd, true],
    ["equal to now", now, false],
    ["in the past", new Date(now.getTime() - 1000), false],
    ["beyond the window", new Date(windowEnd.getTime() + 1000), false],
  ])("%s → %s", (_label, dayEnd, expected) => {
    expect(dayEndInWindow(dayEnd, now)).toBe(expected);
  });
});

describe("nextReviewQuerySchema", () => {
  it("defaults learning_only to false", () => {
    expect(nextReviewQuerySchema(now).parse({ day_end: valid.day_end }).learning_only).toBe(false);
  });

  it.each([
    ["true", true],
    ["false", false],
  ])("reads learning_only=%s", (value, expected) => {
    expect(nextReviewQuerySchema(now).parse({ day_end: valid.day_end, learning_only: value }).learning_only).toBe(
      expected,
    );
  });

  it.each(["1", "yes", ""])("rejects learning_only=%p", (learning_only) => {
    expect(nextReviewQuerySchema(now).safeParse({ day_end: valid.day_end, learning_only }).success).toBe(false);
  });

  it("requires day_end", () => {
    expect(nextReviewQuerySchema(now).safeParse({}).success).toBe(false);
  });

  it.each([
    ["equal to now", now.toISOString()],
    ["beyond the window", new Date(windowEnd.getTime() + 1000).toISOString()],
  ])("bounds day_end: rejects one %s", (_label, day_end) => {
    expect(nextReviewQuerySchema(now).safeParse({ day_end }).success).toBe(false);
  });
});
