import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/database.types";
import type { SaveGenerationCommand } from "@/types";
import { saveGeneration } from "./generations";

function stubClient(result: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn(() => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }));
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

const cmd: SaveGenerationCommand = {
  generation_id: "6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f",
  generated_count: 3,
  cards: [
    { front: "Q1", back: "A1", source: "ai" },
    { front: "Q2", back: "A2", source: "ai_edited" },
  ],
};

describe("saveGeneration", () => {
  it("calls save_generation with exactly the mapped arguments", async () => {
    const { client, rpc } = stubClient({ data: 2 });
    await expect(saveGeneration(client, cmd)).resolves.toEqual({ saved_count: 2 });
    expect(rpc).toHaveBeenCalledWith("save_generation", {
      p_generation_id: cmd.generation_id,
      p_generated_count: 3,
      p_cards: [
        { front: "Q1", back: "A1", source: "ai" },
        { front: "Q2", back: "A2", source: "ai_edited" },
      ],
    });
  });

  it("sends only front, back and source for each card", async () => {
    const { client, rpc } = stubClient({ data: 1 });
    const extra = { ...cmd, cards: [{ front: "Q", back: "A", source: "ai", user_id: "x" }] } as SaveGenerationCommand;
    await saveGeneration(client, extra);
    expect(rpc).toHaveBeenCalledWith(
      "save_generation",
      expect.objectContaining({
        p_cards: [{ front: "Q", back: "A", source: "ai" }],
      }),
    );
  });

  it("passes zero through for an all-rejected generation", async () => {
    const { client } = stubClient({ data: 0 });
    await expect(saveGeneration(client, { ...cmd, cards: [] })).resolves.toEqual({ saved_count: 0 });
  });

  it("throws the PostgrestError unchanged", async () => {
    const error = { code: "23514", message: "violates check constraint" };
    const { client } = stubClient({ error });
    await expect(saveGeneration(client, cmd)).rejects.toBe(error);
  });

  it("treats a non-numeric result as an error", async () => {
    const { client } = stubClient({ data: null });
    await expect(saveGeneration(client, cmd)).rejects.toThrow("save_generation returned no count");
  });
});
