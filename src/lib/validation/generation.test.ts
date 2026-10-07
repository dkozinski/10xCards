import { describe, expect, it } from "vitest";
import {
  MAX_PROPOSALS,
  SOURCE_TEXT_MAX,
  SOURCE_TEXT_MIN,
  generateProposalsSchema,
  proposalSource,
  saveGenerationSchema,
} from "./generation";

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

describe("saveGenerationSchema", () => {
  const ID = "6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f";
  const card = { front: "Q", back: "A", source: "ai" };

  it("accepts an empty cards array (every proposal rejected)", () => {
    expect(saveGenerationSchema.safeParse({ generation_id: ID, generated_count: 3, cards: [] }).success).toBe(true);
  });

  it("rejects more cards than were generated", () => {
    const result = saveGenerationSchema.safeParse({ generation_id: ID, generated_count: 1, cards: [card, card] });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ["cards"], message: "Cannot save more cards than were generated" }),
    ]);
  });

  it("rejects a generated_count outside 1..MAX_PROPOSALS or not an integer", () => {
    for (const generated_count of [0, MAX_PROPOSALS + 1, 2.5]) {
      expect(saveGenerationSchema.safeParse({ generation_id: ID, generated_count, cards: [] }).success).toBe(false);
    }
  });

  it("rejects a card with source manual", () => {
    const cards = [{ ...card, source: "manual" }];
    expect(saveGenerationSchema.safeParse({ generation_id: ID, generated_count: 1, cards }).success).toBe(false);
  });

  it("rejects a generation_id that is not a uuid", () => {
    expect(saveGenerationSchema.safeParse({ generation_id: "abc", generated_count: 1, cards: [] }).success).toBe(false);
  });

  it("returns trimmed card text and drops unknown keys", () => {
    const cards = [{ front: "  Q ", back: "\nA\t", source: "ai_edited", user_id: "someone-else" }];
    const result = saveGenerationSchema.safeParse({ generation_id: ID, generated_count: 1, cards });
    expect(result.data?.cards).toEqual([{ front: "Q", back: "A", source: "ai_edited" }]);
  });
});

describe("proposalSource", () => {
  const original = { front: "What is ATP?", back: "The cell's energy currency." };

  it("is ai when the card is unchanged", () => {
    expect(proposalSource(original, { ...original })).toBe("ai");
  });

  it("is ai when only surrounding whitespace was added", () => {
    expect(proposalSource(original, { front: `${original.front}  `, back: `\n${original.back}` })).toBe("ai");
  });

  // the rule compares end states, so a revert is indistinguishable from no edit
  it("is ai after an edit was reverted to the original text", () => {
    expect(proposalSource(original, { front: original.front, back: ` ${original.back}` })).toBe("ai");
  });

  it("is ai_edited when only the front really changed", () => {
    expect(proposalSource(original, { ...original, front: "What does ATP store?" })).toBe("ai_edited");
  });

  it("is ai_edited when only the back really changed", () => {
    expect(proposalSource(original, { ...original, back: "Energy currency of the cell." })).toBe("ai_edited");
  });
});
