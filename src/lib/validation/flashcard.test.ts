import { describe, expect, it } from "vitest";
import { BACK_MAX, FRONT_MAX, createFlashcardSchema } from "./flashcard";

const valid = { front: "Q", back: "A" };

describe("createFlashcardSchema", () => {
  it.each([
    ["front", 1],
    ["front", FRONT_MAX],
    ["back", 1],
    ["back", BACK_MAX],
  ])("accepts %s of length %i", (field, length) => {
    const result = createFlashcardSchema.safeParse({ ...valid, [field]: "x".repeat(length) });
    expect(result.success).toBe(true);
  });

  it.each([
    ["front", 0],
    ["front", FRONT_MAX + 1],
    ["back", 0],
    ["back", BACK_MAX + 1],
  ])("rejects %s of length %i", (field, length) => {
    const result = createFlashcardSchema.safeParse({ ...valid, [field]: "x".repeat(length) });
    expect(result.success).toBe(false);
  });

  it.each(["front", "back"])("rejects whitespace-only %s", (field) => {
    const result = createFlashcardSchema.safeParse({ ...valid, [field]: " \n\t " });
    expect(result.success).toBe(false);
  });

  it("trims surrounding whitespace and measures the trimmed value", () => {
    const front = `  ${"x".repeat(FRONT_MAX)}  `;
    const result = createFlashcardSchema.safeParse({ front, back: "  answer \n" });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ front: "x".repeat(FRONT_MAX), back: "answer" });
  });

  it.each([
    ["zero-width space", "​"],
    ["zero-width space and BOM around a space", "​ ﻿"],
  ])("rejects a front with no visible character (%s)", (_name, front) => {
    const result = createFlashcardSchema.safeParse({ ...valid, front });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toEqual(["Front is required"]);
  });

  it.each([
    ["NUL", "a\u0000b"],
    ["lone surrogate", "a\ud800b"],
  ])("rejects a back Postgres cannot store (%s)", (_name, back) => {
    const result = createFlashcardSchema.safeParse({ ...valid, back });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toEqual(["Back contains characters that cannot be saved"]);
  });

  it("reports an empty front once", () => {
    const result = createFlashcardSchema.safeParse({ ...valid, front: "" });
    expect(result.error?.issues.map((i) => i.message)).toEqual(["Front is required"]);
  });

  it.each([{}, { front: "Q" }, { front: 1, back: "A" }])("rejects malformed input %j", (input) => {
    expect(createFlashcardSchema.safeParse(input).success).toBe(false);
  });
});
