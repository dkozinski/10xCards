import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const prerender = false;

// The OTP types Supabase can send to this route. `email_change` and `recovery`
// are not reachable yet (no such flows in the app), but they land here the moment
// password reset or email change is added, and rejecting them would look like an
// expired link rather than a missing feature.
const ACCEPTED_OTP_TYPES = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Confirmation links carry a caller-supplied `next`. Anything but a same-origin,
 * non-protocol-relative path turns the link Supabase mails out into an open
 * redirect, so everything else falls back to the site root.
 */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

function signinWithError(context: Parameters<APIRoute>[0], message: string) {
  return context.redirect(`/auth/signin?error=${encodeURIComponent(message)}`);
}

/**
 * Handles both email-confirmation shapes Supabase can produce:
 *
 *   ?token_hash=&type=  — the token-hash flow the Phase 2 email template uses
 *   ?code=              — the PKCE flow, for links minted by the client SDK
 *
 * Both exchange server-side, which is the only place `@supabase/ssr` can write
 * the session cookie. The stock `{{ .ConfirmationURL }}` template returns tokens
 * in the URL *fragment*, which a server-rendered app can never read — that is the
 * bug this route exists to close.
 */
export const GET: APIRoute = async (context) => {
  const params = context.url.searchParams;
  const next = safeNext(params.get("next"));

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return signinWithError(context, "Supabase is not configured");
  }

  const tokenHash = params.get("token_hash");
  const type = params.get("type");

  if (tokenHash && type && ACCEPTED_OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) {
      return signinWithError(context, error.message);
    }
    return context.redirect(next);
  }

  const code = params.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return signinWithError(context, error.message);
    }
    return context.redirect(next);
  }

  return signinWithError(context, "Invalid or expired confirmation link");
};
