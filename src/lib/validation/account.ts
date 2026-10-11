import { z } from "zod";

// No server imports here: the account island shares the matching rule.

// Generous for any real address; only keeps the body small.
const CONFIRM_EMAIL_MAX = 320;

export const CONFIRM_EMAIL_MESSAGE = "Type the email address of this account to confirm";

// Body of DELETE /api/account.
export const deleteAccountSchema = z.object({
  confirm_email: z.string().min(1, CONFIRM_EMAIL_MESSAGE).max(CONFIRM_EMAIL_MAX),
});

// The typed confirmation matches the account's email after trimming and
// ignoring case: addresses are case-insensitive in practice and Supabase stores
// them lowercased. An empty side never matches.
export function emailsMatch(typed: string, accountEmail: string): boolean {
  const a = typed.trim().toLowerCase();
  const b = accountEmail.trim().toLowerCase();
  return a !== "" && a === b;
}
