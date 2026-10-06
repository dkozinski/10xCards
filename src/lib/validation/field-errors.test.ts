import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fieldErrorsFromIssues } from "./field-errors";

function errorsOf(schema: z.ZodType, input: unknown) {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("expected the input to fail validation");
  return fieldErrorsFromIssues(result.error);
}

describe("fieldErrorsFromIssues", () => {
  const schema = z.object({
    count: z.int(),
    cards: z.array(
      z.object({ front: z.string().min(1, "Front is required"), back: z.string().min(1, "Back is required") }),
    ),
  });

  it("keys errors inside an array by their full dotted path", () => {
    const input = {
      count: 1,
      cards: [
        { front: "Q", back: "A" },
        { front: "", back: "" },
      ],
    };
    expect(errorsOf(schema, input)).toEqual({
      "cards.1.front": ["Front is required"],
      "cards.1.back": ["Back is required"],
    });
  });

  it("keeps top-level fields under their own name", () => {
    expect(Object.keys(errorsOf(schema, { count: "x", cards: [] }))).toEqual(["count"]);
  });

  it("puts issues on the payload itself under _root", () => {
    expect(Object.keys(errorsOf(schema, "not an object"))).toEqual(["_root"]);
  });

  it("collects several messages for the same path", () => {
    const twoRules = z.object({ a: z.string().min(3, "too short").regex(/^\d+$/, "digits only") });
    expect(errorsOf(twoRules, { a: "x" })).toEqual({ a: ["too short", "digits only"] });
  });
});
