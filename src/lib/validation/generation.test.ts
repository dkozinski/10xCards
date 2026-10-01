import { describe, expect, it } from "vitest";
import { SOURCE_TEXT_MAX, SOURCE_TEXT_MIN, generateProposalsSchema } from "./generation";

describe("generateProposalsSchema", () => {
  it.each([SOURCE_TEXT_MIN, SOURCE_TEXT_MAX])("accepts text of length %i", (length) => {
    expect(generateProposalsSchema.safeParse({ text: "x".repeat(length) }).success).toBe(true);
  });

  it.each([SOURCE_TEXT_MIN - 1, SOURCE_TEXT_MAX + 1])("rejects text of length %i", (length) => {
    expect(generateProposalsSchema.safeParse({ text: "x".repeat(length) }).success).toBe(false);
  });

  it("measures the trimmed text, so whitespace padding does not count", () => {
    const text = `   ${"x".repeat(SOURCE_TEXT_MIN - 1)}\n\n  `;
    expect(generateProposalsSchema.safeParse({ text }).success).toBe(false);
  });

  it("returns the trimmed text", () => {
    const result = generateProposalsSchema.safeParse({ text: `  ${"x".repeat(SOURCE_TEXT_MIN)} \n` });
    expect(result.data).toEqual({ text: "x".repeat(SOURCE_TEXT_MIN) });
  });

  it.each([
    ["NUL", "\0"],
    ["lone surrogate", "\uD800"],
  ])("rejects text containing a %s", (_name, bad) => {
    const text = "x".repeat(SOURCE_TEXT_MIN) + bad;
    expect(generateProposalsSchema.safeParse({ text }).success).toBe(false);
  });

  it("rejects a missing or non-string text", () => {
    expect(generateProposalsSchema.safeParse({}).success).toBe(false);
    expect(generateProposalsSchema.safeParse({ text: 42 }).success).toBe(false);
  });
});
