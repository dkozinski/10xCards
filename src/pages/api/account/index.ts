import type { APIRoute } from "astro";
import { CONFIRM_EMAIL_MESSAGE, deleteAccountSchema, emailsMatch } from "@/lib/validation/account";
import { apiError } from "@/lib/api-errors";
import { readBody } from "@/lib/read-body";
import { deleteMyAccount } from "@/lib/services/account";
import { createClient } from "@/lib/supabase";
import { fieldErrorsFromIssues } from "@/lib/validation/field-errors";

export const prerender = false;

// One email address plus the JSON key.
const MAX_BODY_BYTES = 1024;

function logFailure(operation: string, error: unknown) {
  // Only code and message reach the Worker log, never the user's email or id:
  // Workers Logs cannot be purged after the account is gone.
  const { code, message } = error as { code?: string; message?: string };
  // eslint-disable-next-line no-console
  console.error(`${operation} failed`, { code, message });
}

// Deletes the signed-in user's account and, by cascade, all of their data,
// once they have typed their own email. The session cookies are cleared in the
// same response. DELETE is never a simple CORS method, so a cross-site page
// cannot send it without a preflight this app never answers.
export const DELETE: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return apiError("unauthorized", "Sign in to delete your account");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return apiError("server_error", "Supabase is not configured");
  }

  const read = await readBody(context.request, MAX_BODY_BYTES);
  if (read === "too_large") {
    return apiError("validation_failed", "Invalid confirmation", {
      fieldErrors: { _root: ["Request body is too large"] },
    });
  }
  if (read === "unreadable") {
    return apiError("invalid_json", "Request body could not be read");
  }

  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return apiError("invalid_json", "Request body must be valid JSON");
  }

  const parsed = deleteAccountSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("validation_failed", "Invalid confirmation", {
      fieldErrors: fieldErrorsFromIssues(parsed.error),
    });
  }

  // the email getUser() just validated with the Auth server; every account in
  // this app has one, so a missing one simply never matches
  if (!emailsMatch(parsed.data.confirm_email, user.email ?? "")) {
    return apiError("validation_failed", "Invalid confirmation", {
      fieldErrors: { confirm_email: [CONFIRM_EMAIL_MESSAGE] },
    });
  }

  // false means a concurrent request deleted the account first: the outcome
  // the user asked for, so it is answered like a fresh delete
  try {
    await deleteMyAccount(supabase);
  } catch (error) {
    // includes a 40P01 deadlock with a grade landing in another tab; nothing
    // was deleted and the user can retry
    logFailure("deleteMyAccount", error);
    return apiError("server_error", "Could not delete the account");
  }

  // After the delete, never before: the RPC needs the session's JWT. signOut
  // ignores the Auth server's 401/404 for a user that no longer exists and
  // clears the sb-* cookies. It can fail by returning an error or by throwing
  // (a cookie write inside setAll); either way the account is already gone, so
  // the answer stays 204, and getUser() rejects the stale cookies next time.
  try {
    const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
    if (signOutError) {
      logFailure("signOut", signOutError);
    }
  } catch (error) {
    logFailure("signOut", error);
  }

  return new Response(null, { status: 204 });
};
