-- Correction to 20260922190157: new public tables DO still receive TRUNCATE,
-- REFERENCES and TRIGGER for anon/authenticated/service_role through the
-- postgres role's default privileges; only select/insert/update/delete stopped
-- being automatic. RLS does not govern TRUNCATE, so one statement from any
-- logged-in user would empty every account's cards. Reset both roles to the
-- exact set the app needs.

revoke all on public.flashcards from authenticated, service_role;

grant select, insert, update, delete on public.flashcards to authenticated;
grant select, insert, update, delete on public.flashcards to service_role;
