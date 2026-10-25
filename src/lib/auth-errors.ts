import { isAuthRetryableFetchError, type AuthError } from "@supabase/supabase-js";

export const AUTH_UNAVAILABLE_MESSAGE = "The service is temporarily unavailable. Please try again later.";

/**
 * The message shown on the auth pages for a failed Supabase auth call.
 *
 * When Supabase itself is unreachable (a paused free-tier project, a gateway
 * 5xx, a network failure) auth-js has no message to pass on and stringifies the
 * raw response, which renders as a bare "{}". Those failures surface as
 * AuthRetryableFetchError, or AuthUnknownError when the body is not JSON. A 5xx
 * that does carry JSON is internal server text, not something a user can act on.
 */
export function authErrorMessage(error: AuthError): string {
  if (isAuthRetryableFetchError(error) || error.name === "AuthUnknownError" || (error.status ?? 0) >= 500) {
    // eslint-disable-next-line no-console
    console.error("Supabase auth unavailable", { name: error.name, status: error.status, message: error.message });
    return AUTH_UNAVAILABLE_MESSAGE;
  }
  return error.message;
}
