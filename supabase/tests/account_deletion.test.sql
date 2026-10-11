-- S-06 account-and-data-deletion: delete_my_account() deletes exactly the
-- caller, and with them every row they own in every table, while another
-- account stays intact. Nobody without a user session can call it. Runs with
-- `npx supabase test db` against the local stack; everything happens inside
-- one transaction that is rolled back.
--
-- Users are impersonated the way PostgREST does it: switch the database role
-- and set the JWT claims that auth.uid() reads. throws_ok runs its statement in
-- a subtransaction, so a refused call is rolled back as PostgREST would.

begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

-- fixtures (as postgres): each user owns one row in every user table ----------

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'user-a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'user-b@example.test');

insert into public.flashcards (id, user_id, front, back) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'A front', 'A back'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'B front', 'B back');

insert into public.generations
  (id, user_id, generated_count, accepted_unedited_count, accepted_edited_count, rejected_count)
values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a', 2, 1, 0, 1),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000000b', 1, 1, 0, 0);

insert into public.review_logs
  (id, user_id, flashcard_id, rating, state, due, stability, difficulty,
   scheduled_days, learning_steps, reviewed_at)
values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000000a',
   '00000000-0000-0000-0000-0000000000a1', 3, 'new', '2026-10-11 12:00+00', 0, 0, 0, 0, '2026-10-11 12:00+00'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-00000000000b',
   '00000000-0000-0000-0000-0000000000b1', 3, 'new', '2026-10-11 12:00+00', 0, 0, 0, 0, '2026-10-11 12:00+00');

-- structure --------------------------------------------------------------------

select ok(
  (select prosecdef from pg_proc where oid = 'public.delete_my_account()'::regprocedure),
  'delete_my_account is security definer'
);

select ok(
  (select 'search_path=""' = any(proconfig) from pg_proc where oid = 'public.delete_my_account()'::regprocedure),
  'delete_my_account pins an empty search_path'
);

select function_privs_are(
  'public', 'delete_my_account', array[]::text[], 'authenticated',
  array['EXECUTE'],
  'authenticated can execute delete_my_account'
);

select function_privs_are(
  'public', 'delete_my_account', array[]::text[], 'anon',
  array[]::text[],
  'anon cannot execute delete_my_account'
);

select function_privs_are(
  'public', 'delete_my_account', array[]::text[], 'service_role',
  array[]::text[],
  'service_role cannot execute delete_my_account'
);

-- PUBLIC is not a role in pg_roles, so function_privs_are cannot name it; an
-- ACL entry with grantee 0 is the grant to PUBLIC. A NULL ACL means the
-- defaults, which include PUBLIC, so it is expanded instead of skipped.
select is(
  (select count(*)::int
     from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'public.delete_my_account()'::regprocedure and a.grantee = 0),
  0,
  'PUBLIC cannot execute delete_my_account'
);

-- refused callers -------------------------------------------------------------

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok(
  $$ select public.delete_my_account() $$,
  '42501', 'permission denied for function delete_my_account',
  'anon cannot call delete_my_account'
);

reset role;

-- a session without a user id: auth.uid() is null
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';

select throws_ok(
  $$ select public.delete_my_account() $$,
  '42501', 'no signed-in user',
  'a call without a user id is refused'
);

reset role;

select is(
  (select (select count(*) from auth.users where id = '00000000-0000-0000-0000-00000000000a')
        + (select count(*) from public.flashcards where user_id = '00000000-0000-0000-0000-00000000000a')
        + (select count(*) from public.generations where user_id = '00000000-0000-0000-0000-00000000000a')
        + (select count(*) from public.review_logs where user_id = '00000000-0000-0000-0000-00000000000a'))::int,
  4,
  'refused calls deleted nothing of A'
);

-- A deletes their account ---------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select is(
  (select public.delete_my_account()),
  true,
  'A deletes their own account'
);

-- the same session again: the row is already gone
select is(
  (select public.delete_my_account()),
  false,
  'a second call reports that nothing was left to delete'
);

reset role;

select is(
  (select count(*)::int from auth.users where id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'A is gone from auth.users'
);

select is(
  (select count(*)::int from public.flashcards where user_id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'no flashcard of A remains'
);

select is(
  (select count(*)::int from public.generations where user_id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'no generation of A remains'
);

select is(
  (select count(*)::int from public.review_logs where user_id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'no review log of A remains'
);

-- B is untouched -----------------------------------------------------------------

select is(
  (select count(*)::int from auth.users where id = '00000000-0000-0000-0000-00000000000b'),
  1,
  'B still exists in auth.users'
);

select is(
  (select count(*)::int from public.flashcards where user_id = '00000000-0000-0000-0000-00000000000b'),
  1,
  'B keeps their flashcard'
);

select is(
  (select count(*)::int from public.generations where user_id = '00000000-0000-0000-0000-00000000000b'),
  1,
  'B keeps their generation'
);

select is(
  (select count(*)::int from public.review_logs where user_id = '00000000-0000-0000-0000-00000000000b'),
  1,
  'B keeps their review log'
);

select * from finish();

rollback;
