import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Supabase is not configured")}`);
  }
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // Without this, Supabase falls back to the dashboard's Site URL. Pointing it
    // at the request origin keeps preview deployments self-contained.
    options: { emailRedirectTo: new URL("/auth/confirm", context.url.origin).toString() },
  });

  if (error) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent(error.message)}`);
  }

  // A session here means email confirmation is off and the user is already signed
  // in; sending them to confirm-email would tell them to check an inbox for a mail
  // that was never sent. The page cannot decide this itself — it keys its copy off
  // import.meta.env.DEV, which is always false on the Worker (E22).
  return context.redirect(data.session ? "/" : "/auth/confirm-email");
};
