-- S-03 review-and-save-proposals: generations are owner-only and immutable,
-- save_generation writes cards and counts atomically and idempotently, and
-- neither another account nor anon can read or replay someone's generation.
-- Runs with `npx supabase test db` against the local stack; everything happens
-- inside one transaction that is rolled back.
--
-- Users are impersonated the way PostgREST does it: switch the database role
-- and set the JWT claims that auth.uid() reads. throws_ok runs its statement in
-- a subtransaction, so a failed call is rolled back exactly as PostgREST would
-- roll back the RPC's transaction.

begin;

create extension if not exists pgtap with schema extensions;

select plan(38);

-- fixtures (as postgres)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'user-a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'user-b@example.test');

-- structure

select ok(
  (select relrowsecurity from pg_class where oid = 'public.generations'::regclass),
  'RLS is enabled on public.generations'
);

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'generations'),
  8,
  'generations has exactly 8 policies'
);

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'generations' and cmd = 'ALL'),
  0,
  'no policy uses FOR ALL'
);

select bag_eq(
  $$ select r::text, cmd from pg_policies, unnest(roles) as r
     where schemaname = 'public' and tablename = 'generations' $$,
  $$ values ('authenticated', 'SELECT'), ('authenticated', 'INSERT'),
            ('authenticated', 'UPDATE'), ('authenticated', 'DELETE'),
            ('anon', 'SELECT'), ('anon', 'INSERT'),
            ('anon', 'UPDATE'), ('anon', 'DELETE') $$,
  'exactly one policy per role and operation'
);

-- privileges

select table_privs_are(
  'public', 'generations', 'authenticated',
  array['SELECT', 'INSERT'],
  'authenticated can only read and add generations'
);

select table_privs_are(
  'public', 'generations', 'service_role',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'service_role has exactly CRUD on generations'
);

select table_privs_are(
  'public', 'generations', 'anon',
  array[]::text[],
  'anon has no privileges on generations'
);

select function_privs_are(
  'public', 'save_generation', array['uuid', 'integer', 'jsonb'], 'authenticated',
  array['EXECUTE'],
  'authenticated can execute save_generation'
);

select function_privs_are(
  'public', 'save_generation', array['uuid', 'integer', 'jsonb'], 'service_role',
  array['EXECUTE'],
  'service_role can execute save_generation'
);

select function_privs_are(
  'public', 'save_generation', array['uuid', 'integer', 'jsonb'], 'anon',
  array[]::text[],
  'anon cannot execute save_generation'
);

-- as user A

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- flashcards.source

insert into public.flashcards (id, front, back)
values ('00000000-0000-0000-0000-0000000000c1', 'manual Q', 'manual A');

select is(
  (select source from public.flashcards where id = '00000000-0000-0000-0000-0000000000c1'),
  'manual',
  'a plain insert defaults source to manual'
);

select throws_ok(
  $$ insert into public.flashcards (front, back, source) values ('Q', 'A', 'bogus') $$,
  '23514',
  null,
  'an unknown source is rejected'
);

-- happy path: 5 shown, 2 kept unchanged, 1 kept after edit, 2 rejected

select is(
  public.save_generation(
    '00000000-0000-0000-0000-0000000000e1', 5,
    '[{"front":"Q1","back":"A1","source":"ai"},
      {"front":"Q2","back":"A2","source":"ai"},
      {"front":"Q3 edited","back":"A3","source":"ai_edited"}]'
  ),
  3,
  'save returns the number of saved cards'
);

select bag_eq(
  $$ select source from public.flashcards where source <> 'manual' $$,
  $$ values ('ai'), ('ai'), ('ai_edited') $$,
  'A sees the three saved cards with their sources'
);

select results_eq(
  $$ select accepted_unedited_count, accepted_edited_count, rejected_count
     from public.generations where id = '00000000-0000-0000-0000-0000000000e1' $$,
  $$ values (2, 1, 2) $$,
  'the generation row records 2 unedited / 1 edited / 2 rejected'
);

-- zero kept cards ("Discard all")

select is(
  public.save_generation('00000000-0000-0000-0000-0000000000e2', 4, '[]'),
  0,
  'an all-rejected generation saves zero cards'
);

select results_eq(
  $$ select accepted_unedited_count, accepted_edited_count, rejected_count
     from public.generations where id = '00000000-0000-0000-0000-0000000000e2' $$,
  $$ values (0, 0, 4) $$,
  'the all-rejected generation row records 0 / 0 / 4'
);

select is(
  (select count(*)::int from public.flashcards),
  4,
  'discarding writes no cards (1 manual + 3 saved)'
);

-- replay of the happy path: same answer, nothing written

select is(
  public.save_generation(
    '00000000-0000-0000-0000-0000000000e1', 5,
    '[{"front":"Q1","back":"A1","source":"ai"},
      {"front":"Q2","back":"A2","source":"ai"},
      {"front":"Q3 edited","back":"A3","source":"ai_edited"}]'
  ),
  3,
  'a replay returns the original saved count'
);

select is(
  (select count(*)::int from public.flashcards),
  4,
  'a replay writes no cards'
);

select is(
  (select count(*)::int from public.generations),
  2,
  'a replay writes no generation row'
);

-- atomicity: one invalid card rolls back the whole call

select throws_ok(
  $$ select public.save_generation(
       '00000000-0000-0000-0000-0000000000e3', 3,
       '[{"front":"good","back":"good","source":"ai"},
         {"front":"   ","back":"blank front","source":"ai"}]') $$,
  '23514',
  null,
  'a card with a blank front fails the call'
);

select is(
  (select count(*)::int from public.generations where id = '00000000-0000-0000-0000-0000000000e3'),
  0,
  'the failed call left no generation row'
);

select is(
  (select count(*)::int from public.flashcards),
  4,
  'the failed call left no cards, not even the valid one'
);

-- bounds

select throws_ok(
  $$ select public.save_generation(
       '00000000-0000-0000-0000-0000000000e4', 1,
       '[{"front":"Q","back":"A","source":"ai"},
         {"front":"Q","back":"A","source":"ai"}]') $$,
  '23514',
  null,
  'more cards than generated is rejected'
);

select throws_ok(
  $$ select public.save_generation('00000000-0000-0000-0000-0000000000e4', 21, '[]') $$,
  '23514',
  null,
  'more than 20 generated is rejected'
);

select throws_ok(
  $$ select public.save_generation(
       '00000000-0000-0000-0000-0000000000e4', 1,
       '[{"front":"Q","back":"A","source":"manual"}]') $$,
  '22023',
  'invalid card source',
  'a card with source manual is rejected'
);

select throws_ok(
  $$ select public.save_generation('00000000-0000-0000-0000-0000000000e4', 1, '{}') $$,
  '22023',
  'p_cards must be a json array',
  'a non-array cards payload is rejected'
);

select throws_ok(
  $$ select public.save_generation(
       '00000000-0000-0000-0000-0000000000e4', 20,
       (select jsonb_agg(jsonb_build_object('front', 'Q', 'back', 'A', 'source', 'ai'))
          from generate_series(1, 21))) $$,
  '22023',
  'too many cards',
  'more than 20 cards is rejected before any work'
);

-- forging: the insert policy, not only the auth.uid() default, keeps rows owned

select throws_ok(
  $$ insert into public.generations
       (id, user_id, generated_count, accepted_unedited_count, accepted_edited_count, rejected_count)
     values ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-00000000000b', 1, 0, 0, 1) $$,
  '42501',
  null,
  'A cannot insert a generation owned by B'
);

-- immutability: no UPDATE/DELETE privilege, so the owner is stopped before RLS

select throws_ok(
  $$ update public.generations set rejected_count = 0
     where id = '00000000-0000-0000-0000-0000000000e1' $$,
  '42501',
  null,
  'A cannot change an own generation'
);

select throws_ok(
  $$ delete from public.generations where id = '00000000-0000-0000-0000-0000000000e1' $$,
  '42501',
  null,
  'A cannot delete an own generation'
);

-- as user B: cannot see or replay A's generation

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select is(
  (select count(*)::int from public.generations),
  0,
  'B cannot read A''s generations'
);

select throws_ok(
  $$ select public.save_generation(
       '00000000-0000-0000-0000-0000000000e1', 5,
       '[{"front":"stolen","back":"stolen","source":"ai"}]') $$,
  '22023',
  'generation id unavailable',
  'B replaying A''s generation id is refused'
);

select is(
  (select count(*)::int from public.flashcards),
  0,
  'B''s refused replay wrote no cards'
);

-- as anon: no EXECUTE and no table privileges

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok(
  $$ select public.save_generation('00000000-0000-0000-0000-0000000000e5', 1, '[]') $$,
  '42501',
  null,
  'anon cannot execute save_generation'
);

select throws_ok(
  $$ select count(*) from public.generations $$,
  '42501',
  null,
  'anon cannot read generations'
);

-- account deletion cascades to the account's generations

reset role;

delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.generations where user_id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'deleting an account deletes its generations'
);

select * from finish();

rollback;
