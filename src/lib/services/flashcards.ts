import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import type { CreateFlashcardCommand, FlashcardDto } from "@/types";

// The only module that queries public.flashcards. It takes the request-scoped
// client, so RLS limits every query to the caller; it never filters by or sends
// user_id itself (the column defaults to auth.uid()).

type Client = SupabaseClient<Database>;

// PostgREST answers an offset past the last row with 416 and no count.
const RANGE_NOT_SATISFIABLE = "PGRST103";

export async function createFlashcard(supabase: Client, cmd: CreateFlashcardCommand): Promise<FlashcardDto> {
  const { data, error } = await supabase
    .from("flashcards")
    .insert({ front: cmd.front, back: cmd.back })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listFlashcards(
  supabase: Client,
  { from, to }: { from: number; to: number },
): Promise<{ items: FlashcardDto[]; total: number }> {
  const { data, count, error } = await supabase
    .from("flashcards")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);

  if (error?.code === RANGE_NOT_SATISFIABLE) {
    const { count: total, error: countError } = await supabase
      .from("flashcards")
      .select("*", { count: "exact", head: true });
    if (countError) throw countError;
    return { items: [], total: total ?? 0 };
  }
  if (error) throw error;
  return { items: data, total: count ?? 0 };
}
