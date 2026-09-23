-- Make flashcards privileges explicit so they do not depend on each
-- environment's default privileges. The cloud project still auto-grants new
-- public tables to anon and service_role; the local stack does not. Without
-- this, anon could reach the table in the cloud (RLS alone denied it) but not
-- locally, and the two environments disagreed.

-- anon: no table privileges at all (layer 1); the deny policies are layer 2.
revoke all on public.flashcards from anon;

-- service_role: server-side admin key that bypasses RLS and never reaches the
-- browser; granted here so both environments match.
grant select, insert, update, delete on public.flashcards to service_role;
