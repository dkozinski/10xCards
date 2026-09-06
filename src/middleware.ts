import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/dashboard"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  const isProtected = PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route));
  const response = isProtected && !context.locals.user ? context.redirect("/auth/signin") : await next();

  // Every response leaving this Worker is treated as session-bearing (E25).
  //
  // Two reasons it is done here, unconditionally, rather than per route:
  //
  // 1. A response cannot be inspected for cookies at this point. Astro's
  //    attachCookiesToResponse only pins the AstroCookies object to the Response
  //    under a symbol; the actual Set-Cookie headers are serialised later, in the
  //    adapter. `response.headers.has("set-cookie")` is therefore always false here.
  // 2. getUser() above runs on every request and can refresh the session on any of
  //    them (E27), so any response — not just the auth routes — may carry a cookie.
  //
  // Astro sets no cache headers of its own, and a session cookie held at the edge
  // is the one bug whose symptom is another user's data. Static assets are served
  // by the ASSETS binding before the Worker runs, so their caching is untouched.
  // A route that is genuinely public and cacheable opts out by setting its own
  // Cache-Control.
  if (!response.headers.has("Cache-Control")) {
    response.headers.set("Cache-Control", "private, no-store");
  }

  return response;
});
