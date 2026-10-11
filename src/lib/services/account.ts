import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

// The only module that calls public.delete_my_account. It takes the
// request-scoped client, so the function deletes exactly the signed-in caller
// (it reads auth.uid() from the session's JWT); it never sends a user id.

type Client = SupabaseClient<Database>;

// Deletes the caller's account; the database cascades remove all of their
// data. Returns false when a concurrent request deleted it first.
export async function deleteMyAccount(supabase: Client): Promise<boolean> {
  const { data, error } = await supabase.rpc("delete_my_account");
  if (error) throw error;
  return data;
}
