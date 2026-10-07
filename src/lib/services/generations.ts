import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import type { SaveGenerationCommand, SaveGenerationResponseDto } from "@/types";

// The only module that calls public.save_generation. It takes the request-scoped
// client, so the function runs as the caller and RLS applies inside it; it never
// sends user_id (both tables default it to auth.uid()).

type Client = SupabaseClient<Database>;

export async function saveGeneration(supabase: Client, cmd: SaveGenerationCommand): Promise<SaveGenerationResponseDto> {
  const { data, error } = await supabase.rpc("save_generation", {
    p_generation_id: cmd.generation_id,
    p_generated_count: cmd.generated_count,
    // rebuilt field by field, so nothing beyond the three columns reaches the DB
    p_cards: cmd.cards.map(({ front, back, source }) => ({ front, back, source })),
  });
  if (error) throw error;
  // a missing count would let the client report a save that cannot be confirmed
  if (typeof data !== "number") throw new Error("save_generation returned no count");
  return { saved_count: data };
}
