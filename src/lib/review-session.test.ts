import { describe, expect, it } from "vitest";
import { isNextReviewResponse, nextLocalMidnight } from "./review-session";

// Local time is whatever zone the test runner uses; every assertion is phrased
// in local terms so the test holds in any zone.
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m, d, h, min);

describe("nextLocalMidnight", () => {
  it.each([
    ["the morning", local(2026, 9, 10, 9, 0)],
    ["just after midnight", local(2026, 9, 10, 0, 1)],
    ["one minute before midnight", local(2026, 9, 10, 23, 59)],
  ])("from %s, is the next local midnight", (_label, now) => {
    expect(nextLocalMidnight(now)).toEqual(local(2026, 9, 11));
  });

  it("is always after now and at most a day ahead", () => {
    const now = local(2026, 9, 10, 0, 0);
    const end = nextLocalMidnight(now);
    expect(end.getTime()).toBeGreaterThan(now.getTime());
    // 25 h covers a DST day in zones that have one
    expect(end.getTime() - now.getTime()).toBeLessThanOrEqual(25 * 3_600_000);
  });

  it("rolls over the end of a month and a year", () => {
    expect(nextLocalMidnight(local(2026, 9, 31, 12))).toEqual(local(2026, 10, 1));
    expect(nextLocalMidnight(local(2026, 11, 31, 12))).toEqual(local(2027, 0, 1));
  });
});

describe("isNextReviewResponse", () => {
  const card = { id: "c1", front: "Q", back: "A", state: "new" };

  it.each([
    ["a card", { card, due_count: 3 }],
    ["an empty queue", { card: null, due_count: 0 }],
  ])("accepts %s", (_label, body) => {
    expect(isNextReviewResponse(body)).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "ok"],
    ["an empty object", {}],
    ["a missing card", { due_count: 1 }],
    ["a missing due_count", { card }],
    ["a string due_count", { card, due_count: "1" }],
    ["a card without front", { card: { id: "c1", back: "A", state: "new" }, due_count: 1 }],
    ["a card with a numeric id", { card: { ...card, id: 1 }, due_count: 1 }],
    ["a card without state", { card: { id: "c1", front: "Q", back: "A" }, due_count: 1 }],
  ])("rejects %s", (_label, body) => {
    expect(isNextReviewResponse(body)).toBe(false);
  });
});
