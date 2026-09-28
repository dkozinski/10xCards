import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/database.types";
import { listFlashcards } from "./flashcards";

interface Result {
  data?: unknown;
  count?: number | null;
  error?: { code: string } | null;
}

// Minimal stand-in for the supabase-js query builder: every chain method
// returns the builder, and awaiting it yields the next queued result.
function stubClient(results: Result[]) {
  const calls: string[] = [];
  const builder = {
    select: vi.fn((_cols: string, opts?: { head?: boolean }) => {
      calls.push(opts?.head ? "count" : "page");
      return builder;
    }),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    then: (resolve: (r: Result) => unknown) => {
      const next = results.shift() ?? {};
      return Promise.resolve({ data: null, count: null, error: null, ...next }).then(resolve);
    },
  };
  const client = { from: () => builder } as unknown as SupabaseClient<Database>;
  return { client, builder, calls };
}

describe("listFlashcards", () => {
  it("returns the page and the total, newest first with an id tiebreak", async () => {
    const { client, builder } = stubClient([{ data: [{ id: "a" }], count: 51 }]);
    await expect(listFlashcards(client, { from: 50, to: 99 })).resolves.toEqual({ items: [{ id: "a" }], total: 51 });
    expect(builder.order).toHaveBeenNthCalledWith(1, "created_at", { ascending: false });
    expect(builder.order).toHaveBeenNthCalledWith(2, "id", { ascending: false });
    expect(builder.range).toHaveBeenCalledWith(50, 99);
  });

  it("falls back to a count-only query when the page is past the end", async () => {
    const { client, calls } = stubClient([{ error: { code: "PGRST103" } }, { count: 51 }]);
    await expect(listFlashcards(client, { from: 4950, to: 4999 })).resolves.toEqual({ items: [], total: 51 });
    expect(calls).toEqual(["page", "count"]);
  });

  it("throws any other database error", async () => {
    const error = { code: "42501" };
    const { client } = stubClient([{ error }]);
    await expect(listFlashcards(client, { from: 0, to: 49 })).rejects.toBe(error);
  });
});
