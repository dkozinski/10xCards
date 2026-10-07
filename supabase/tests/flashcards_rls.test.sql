-- F-01 deck-data-contract: a second account cannot read, update, delete or
-- forge the first account's cards. Runs with `npx supabase test db` against the
-- local stack; everything happens inside one transaction that is rolled back.
--
-- Users are impersonated the way PostgREST does it: switch the database role
-- and set the JWT claims that auth.uid() reads.
--
-- RLS denial has two shapes: a blocked select/update/delete silently affects
-- 0 rows, while a blocked insert (or an update whose new row fails WITH CHECK)
-- raises 42501. Assertions below check each shape accordingly.

begin;

create extension if not exists pgtap with schema extensions;

select plan(31);

-- fixtures (as postgres)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'user-a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'user-b@example.test');

-- structure

select ok(
  (select relrowsecurity from pg_class where oid = 'public.flashcards'::regclass),
  'RLS is enabled on public.flashcards'
);

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'flashcards'),
  8,
  'flashcards has exactly 8 policies'
);

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'flashcards' and cmd = 'ALL'),
  0,
  'no policy uses FOR ALL'
);

select bag_eq(
  $$ select r::text, cmd from pg_policies, unnest(roles) as r
     where schemaname = 'public' and tablename = 'flashcards' $$,
  $$ values ('authenticated', 'SELECT'), ('authenticated', 'INSERT'),
            ('authenticated', 'UPDATE'), ('authenticated', 'DELETE'),
            ('anon', 'SELECT'), ('anon', 'INSERT'),
            ('anon', 'UPDATE'), ('anon', 'DELETE') $$,
  'exactly one policy per role and operation'
);

select table_privs_are(
  'public', 'flashcards', 'authenticated',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'authenticated has exactly CRUD on flashcards (no TRUNCATE/REFERENCES/TRIGGER)'
);

select table_privs_are(
  'public', 'flashcards', 'service_role',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'service_role has exactly CRUD on flashcards'
);

select table_privs_are(
  'public', 'flashcards', 'anon',
  array[]::text[],
  'anon has no privileges on flashcards'
);

-- as user A: create and see an own card

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select lives_ok(
  $$ insert into public.flashcards (id, front, back)
     values ('00000000-0000-0000-0000-0000000000c1', 'Q1', 'A1') $$,
  'A can insert an own card (user_id defaults to the caller)'
);

select is(
  (select count(*)::int from public.flashcards),
  1,
  'A sees exactly the one own card'
);

-- as user B: every attempt on A's card is refused

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select is(
  (select count(*)::int from public.flashcards),
  0,
  'B cannot read A''s cards'
);

-- row_count is read from B's side: the statements must match nothing, not fail
select lives_ok(
  $$ do $d$ declare n int; begin
       update public.flashcards set front = 'hacked by B' where id = '00000000-0000-0000-0000-0000000000c1';
       get diagnostics n = row_count;
       if n <> 0 then raise exception 'B updated % rows', n; end if;
     end $d$ $$,
  'B''s update of A''s card affects 0 rows'
);

select lives_ok(
  $$ do $d$ declare n int; begin
       delete from public.flashcards where id = '00000000-0000-0000-0000-0000000000c1';
       get diagnostics n = row_count;
       if n <> 0 then raise exception 'B deleted % rows', n; end if;
     end $d$ $$,
  'B''s delete of A''s card affects 0 rows'
);

select throws_ok(
  $$ insert into public.flashcards (user_id, front, back)
     values ('00000000-0000-0000-0000-00000000000a', 'forged', 'forged') $$,
  '42501',
  null,
  'B cannot insert a card owned by A'
);

-- back as A: B's update and delete changed nothing

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select is(
  (select count(*)::int from public.flashcards where id = '00000000-0000-0000-0000-0000000000c1'),
  1,
  'B''s delete did not remove A''s card'
);

select is(
  (select front from public.flashcards where id = '00000000-0000-0000-0000-0000000000c1'),
  'Q1',
  'B''s update did not change A''s card'
);

select throws_ok(
  $$ update public.flashcards set user_id = '00000000-0000-0000-0000-00000000000b'
     where id = '00000000-0000-0000-0000-0000000000c1' $$,
  '42501',
  null,
  'A cannot hand an own card to B'
);

select lives_ok(
  $$ update public.flashcards set front = 'Q1 fixed', back = 'A1 fixed'
     where id = '00000000-0000-0000-0000-0000000000c1' $$,
  'A can edit an own card'
);

select is(
  (select front || '/' || back from public.flashcards where id = '00000000-0000-0000-0000-0000000000c1'),
  'Q1 fixed/A1 fixed',
  'A''s edit is stored'
);

-- content constraints, as the owner so RLS passes and the CHECK is reached

select throws_ok(
  $$ insert into public.flashcards (front, back) values ('   ', 'A') $$,
  '23514',
  null,
  'blank front is rejected'
);

select throws_ok(
  $$ insert into public.flashcards (front, back) values (repeat('x', 201), 'A') $$,
  '23514',
  null,
  'front longer than 200 characters is rejected'
);

select throws_ok(
  $$ insert into public.flashcards (front, back) values ('Q', repeat('x', 501)) $$,
  '23514',
  null,
  'back longer than 500 characters is rejected'
);

select lives_ok(
  $$ insert into public.flashcards (front, back) values (repeat('x', 200), repeat('y', 500)) $$,
  'front of exactly 200 and back of exactly 500 characters are accepted'
);

select throws_ok(
  $$ update public.flashcards set front = '   ' where id = '00000000-0000-0000-0000-0000000000c1' $$,
  '23514',
  null,
  'an edit to a blank front is rejected'
);

select throws_ok(
  $$ update public.flashcards set back = repeat('x', 501) where id = '00000000-0000-0000-0000-0000000000c1' $$,
  '23514',
  null,
  'an edit to a back longer than 500 characters is rejected'
);

select lives_ok(
  $$ delete from public.flashcards where id = '00000000-0000-0000-0000-0000000000c1' $$,
  'A can delete an own card'
);

select is(
  (select count(*)::int from public.flashcards where id = '00000000-0000-0000-0000-0000000000c1'),
  0,
  'A''s delete removed the card'
);

-- as anon: no table privileges at all, so every access raises 42501 before
-- RLS is consulted (the anon deny policies are the second layer)

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok(
  $$ select count(*) from public.flashcards $$,
  '42501',
  null,
  'anon cannot read any card'
);

select throws_ok(
  $$ insert into public.flashcards (user_id, front, back)
     values ('00000000-0000-0000-0000-00000000000a', 'Q', 'A') $$,
  '42501',
  null,
  'anon cannot insert'
);

select throws_ok(
  $$ update public.flashcards set front = 'x' $$,
  '42501',
  null,
  'anon cannot update'
);

select throws_ok(
  $$ delete from public.flashcards $$,
  '42501',
  null,
  'anon cannot delete'
);

-- account deletion cascades to the account's cards

reset role;

delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.flashcards where user_id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'deleting an account deletes its cards'
);

select * from finish();

rollback;
