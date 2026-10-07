import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/database.types";
import { deleteFlashcard, listFlashcards, updateFlashcard } from "./flashcards";

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
    // without count: "exact" supabase-js returns count: null
    expect(builder.select).toHaveBeenCalledWith("*", { count: "exact" });
  });

  it("falls back to a count-only query when the page is past the end", async () => {
    const { client, builder, calls } = stubClient([{ error: { code: "PGRST103" } }, { count: 51 }]);
    await expect(listFlashcards(client, { from: 4950, to: 4999 })).resolves.toEqual({ items: [], total: 51 });
    expect(calls).toEqual(["page", "count"]);
    expect(builder.select).toHaveBeenLastCalledWith("*", { count: "exact", head: true });
  });

  it("refuses to report a missing count as an empty deck", async () => {
    const { client } = stubClient([{ data: [], count: null }]);
    await expect(listFlashcards(client, { from: 0, to: 49 })).rejects.toThrow("count missing");
  });

  it("throws any other database error", async () => {
    const error = { code: "42501" };
    const { client } = stubClient([{ error }]);
    await expect(listFlashcards(client, { from: 0, to: 49 })).rejects.toBe(error);
  });
});

// Builder for the mutations: update/delete/eq/select chain, and both
// maybeSingle() and a bare await resolve to the given result.
function stubMutation(result: Result) {
  const resolved = () => Promise.resolve({ data: null, error: null, ...result });
  const builder = {
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    select: vi.fn(() => builder),
    maybeSingle: vi.fn(resolved),
    then: (resolve: (r: unknown) => unknown) => resolved().then(resolve),
  };
  const client = { from: vi.fn(() => builder) } as unknown as SupabaseClient<Database>;
  return { client, builder };
}

describe("updateFlashcard", () => {
  it("sends only front and back for the addressed id and returns the row", async () => {
    const { client, builder } = stubMutation({ data: { id: "a", front: "Q", back: "A" } });
    await expect(updateFlashcard(client, "a", { front: "Q", back: "A" })).resolves.toEqual({
      id: "a",
      front: "Q",
      back: "A",
    });
    expect(builder.update).toHaveBeenCalledWith({ front: "Q", back: "A" });
    expect(builder.eq).toHaveBeenCalledWith("id", "a");
    expect(builder.maybeSingle).toHaveBeenCalled();
  });

  it("returns null when no row matched (missing or another user's card)", async () => {
    const { client } = stubMutation({ data: null });
    await expect(updateFlashcard(client, "a", { front: "Q", back: "A" })).resolves.toBeNull();
  });

  it("throws a database error", async () => {
    const error = { code: "23514" };
    const { client } = stubMutation({ error });
    await expect(updateFlashcard(client, "a", { front: "Q", back: "A" })).rejects.toBe(error);
  });
});

describe("deleteFlashcard", () => {
  it("deletes the addressed id and reports success", async () => {
    const { client, builder } = stubMutation({ data: [{ id: "a" }] });
    await expect(deleteFlashcard(client, "a")).resolves.toBe(true);
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("id", "a");
    expect(builder.select).toHaveBeenCalledWith("id");
  });

  it("reports false when no row was deleted", async () => {
    const { client } = stubMutation({ data: [] });
    await expect(deleteFlashcard(client, "a")).resolves.toBe(false);
  });

  it("throws a database error", async () => {
    const error = { code: "42501" };
    const { client } = stubMutation({ error });
    await expect(deleteFlashcard(client, "a")).rejects.toBe(error);
  });
});
