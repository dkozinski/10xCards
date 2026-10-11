-- S-05 srs-review-session: review logs are owner-only and immutable,
-- record_review writes a grade and the card's new state atomically and
-- idempotently, and next_review_card picks only the caller's own due cards in
-- tier order. Runs with `npx supabase test db` against the local stack;
-- everything happens inside one transaction that is rolled back.
--
-- Users are impersonated the way PostgREST does it: switch the database role
-- and set the JWT claims that auth.uid() reads. Times are fixed around
-- T = 2026-10-10 12:00 UTC with the client's day ending at D = 2026-10-11 00:00.

begin;

create extension if not exists pgtap with schema extensions;

select plan(65);

-- fixtures (as postgres) -----------------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'user-a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'user-b@example.test');

-- A's deck, one card per queue situation (ids end in a mnemonic). Orderings
-- are built so that a wrong sort key picks a different card: a2 has the older
-- due but the newer created_at, a3 is the oldest new card but due after the
-- day ends, and c0 (lower id) is due later than c2 in the learn-ahead window.
insert into public.flashcards (id, user_id, front, back, state, due, created_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'new old', 'A', 'new',
   '2026-10-08 12:00+00', '2026-10-08 12:00+00'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a', 'new young', 'A', 'new',
   '2026-10-07 12:00+00', '2026-10-09 12:00+00'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000000a', 'new due tomorrow', 'A', 'new',
   '2026-10-11 06:00+00', '2026-10-01 12:00+00'),
  ('00000000-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-00000000000a', 'learning in 15m', 'A', 'learning',
   '2026-10-10 12:15+00', '2026-10-01 12:00+00'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000a', 'review overdue', 'A', 'review',
   '2026-10-10 09:00+00', '2026-10-01 12:00+00'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000000a', 'review tonight', 'A', 'review',
   '2026-10-10 17:00+00', '2026-10-01 12:00+00'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-00000000000a', 'review tomorrow', 'A', 'review',
   '2026-10-11 01:00+00', '2026-10-01 12:00+00'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'learning due', 'A', 'learning',
   '2026-10-10 11:59+00', '2026-10-01 12:00+00'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000a', 'learning in 5m', 'A', 'learning',
   '2026-10-10 12:05+00', '2026-10-01 12:00+00'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-00000000000a', 'relearning in 25m', 'A', 'relearning',
   '2026-10-10 12:25+00', '2026-10-01 12:00+00');

-- B's card is overdue learning: it would win tier 1 if RLS let A see it
insert into public.flashcards (id, user_id, front, back, state, due) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000b', 'B secret', 'B', 'learning',
   '2026-10-10 11:00+00');

-- structure ------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.review_logs'::regclass),
  'RLS is enabled on public.review_logs'
);

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'review_logs'),
  8,
  'review_logs has exactly 8 policies'
);

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'review_logs' and cmd = 'ALL'),
  0,
  'no policy uses FOR ALL'
);

select bag_eq(
  $$ select r::text, cmd from pg_policies, unnest(roles) as r
     where schemaname = 'public' and tablename = 'review_logs' $$,
  $$ values ('authenticated', 'SELECT'), ('authenticated', 'INSERT'),
            ('authenticated', 'UPDATE'), ('authenticated', 'DELETE'),
            ('anon', 'SELECT'), ('anon', 'INSERT'),
            ('anon', 'UPDATE'), ('anon', 'DELETE') $$,
  'exactly one policy per role and operation'
);

-- privileges -----------------------------------------------------------------

select table_privs_are(
  'public', 'review_logs', 'authenticated',
  array['SELECT', 'INSERT'],
  'authenticated can only read and add review logs'
);

select table_privs_are(
  'public', 'review_logs', 'service_role',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'service_role has exactly CRUD on review_logs'
);

select table_privs_are(
  'public', 'review_logs', 'anon',
  array[]::text[],
  'anon has no privileges on review_logs'
);

select function_privs_are(
  'public', 'record_review',
  array['uuid', 'uuid', 'smallint', 'timestamp with time zone', 'jsonb', 'jsonb'], 'authenticated',
  array['EXECUTE'],
  'authenticated can execute record_review'
);

select function_privs_are(
  'public', 'record_review',
  array['uuid', 'uuid', 'smallint', 'timestamp with time zone', 'jsonb', 'jsonb'], 'service_role',
  array['EXECUTE'],
  'service_role can execute record_review'
);

select function_privs_are(
  'public', 'record_review',
  array['uuid', 'uuid', 'smallint', 'timestamp with time zone', 'jsonb', 'jsonb'], 'anon',
  array[]::text[],
  'anon cannot execute record_review'
);

select function_privs_are(
  'public', 'next_review_card',
  array['timestamp with time zone', 'timestamp with time zone', 'boolean'], 'authenticated',
  array['EXECUTE'],
  'authenticated can execute next_review_card'
);

select function_privs_are(
  'public', 'next_review_card',
  array['timestamp with time zone', 'timestamp with time zone', 'boolean'], 'service_role',
  array['EXECUTE'],
  'service_role can execute next_review_card'
);

select function_privs_are(
  'public', 'next_review_card',
  array['timestamp with time zone', 'timestamp with time zone', 'boolean'], 'anon',
  array[]::text[],
  'anon cannot execute next_review_card'
);

-- as user A --------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

-- defaults: a card from any insert path starts as new and due now

insert into public.flashcards (id, front, back)
values ('00000000-0000-0000-0000-0000000000d1', 'plain Q', 'plain A');

select results_eq(
  $$ select state, reps, lapses, stability, difficulty, last_review is null, due = now()
     from public.flashcards where id = '00000000-0000-0000-0000-0000000000d1' $$,
  $$ values ('new'::text, 0, 0, 0::double precision, 0::double precision, true, true) $$,
  'a plain insert is a new card, due now, with empty FSRS state'
);

select throws_ok(
  $$ insert into public.flashcards (front, back, state) values ('Q', 'A', 'bogus') $$,
  '23514',
  null,
  'an unknown state is rejected'
);

select throws_ok(
  $$ insert into public.flashcards (front, back, reps) values ('Q', 'A', -1) $$,
  '23514',
  null,
  'a negative counter is rejected'
);

-- the plain card would sit in the new tier; keep the tier tests about the fixtures
delete from public.flashcards where id = '00000000-0000-0000-0000-0000000000d1';

-- next_review_card: tier order ---------------------------------------------------

select is(
  public.next_review_card('2026-10-10 12:00+00', '2026-10-11 00:00+00', false)->'card'->>'id',
  '00000000-0000-0000-0000-0000000000c1',
  'tier 1: overdue learning card first (B''s older one is invisible)'
);

select is(
  (public.next_review_card('2026-10-10 12:00+00', '2026-10-11 00:00+00', false)->>'due_count')::int,
  5,
  'due_count: 1 learning + 2 review before midnight + 2 new; not B''s, not tomorrow''s, not learning-ahead'
);

select is(
  public.next_review_card('2026-10-10 12:00+00', '2026-10-11 00:00+00', false)->'card'->>'front',
  'learning due',
  'the card carries its front'
);

select is(
  (select array_agg(k order by k)
     from jsonb_object_keys(public.next_review_card('2026-10-10 12:00+00', '2026-10-11 00:00+00', false)->'card') k),
  array['back', 'front', 'id', 'state'],
  'the card carries only id, front, back and state'
);

update public.flashcards set due = '2026-10-10 12:30+00' where id = '00000000-0000-0000-0000-0000000000c1';

select is(
  public.next_review_card('2026-10-10 12:00+00', '2026-10-11 00:00+00', false)->'card'->>'id',
  '00000000-0000-0000-0000-0000000000b1',
  'tier 2: the most overdue review card next'
);

select is(
  public.next_review_card('2026-10-10 12:00+00', '2026-10-11 00:00+00', true)->'card'->>'id',
  '00000000-0000-0000-0000-0000000000c2',
  'learning_only skips review and new cards and learns ahead'
);

select is(
  (public.next_review_card('2026-10-10 12:00+00', '2026-10-11 00:00+00', true)->>'due_count')::int,
  4,
  'learning_only does not change due_count'
);

update public.flashcards set due = '2026-10-15 12:00+00'
 where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');

select is(
  public.next_review_card('2026-10-10 12:00+00', '2026-10-11 00:00+00', false)->'card'->>'id',
  '00000000-0000-0000-0000-0000000000a1',
  'tier 3: the oldest-created new card due today (not a2 by due, not a3 due tomorrow), while learning cards wait'
);

update public.flashcards set state = 'review', due = '2026-10-15 12:00+00'
 where id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2');

select is(
  public.next_review_card('2026-10-10 12:00+00', '2026-10-11 00:00+00', false)->'card'->>'id',
  '00000000-0000-0000-0000-0000000000c2',
  'tier 4: with nothing else due, the oldest-due learning card within 20 minutes is shown (c2, not c0)'
);

update public.flashcards set due = '2026-10-10 12:26+00' where id = '00000000-0000-0000-0000-0000000000c2';
update public.flashcards set due = '2026-10-10 12:30+00' where id = '00000000-0000-0000-0000-0000000000c1';
update public.flashcards set due = '2026-10-10 12:40+00' where id = '00000000-0000-0000-0000-0000000000c0';

select is(
  public.next_review_card('2026-10-10 12:00+00', '2026-10-11 00:00+00', false)->'card',
  'null'::jsonb,
  'learning cards 25+ minutes away are not shown: the session is empty'
);

select is(
  (public.next_review_card('2026-10-10 12:00+00', '2026-10-11 00:00+00', false)->>'due_count')::int,
  0,
  'an empty session has due_count 0'
);

select is(
  public.next_review_card('2026-10-11 01:30+00', '2026-10-12 00:00+00', false)->'card'->>'id',
  '00000000-0000-0000-0000-0000000000c3',
  'the next day: the oldest-due learning card is overdue and comes first'
);

-- a null or inverted window is refused, not answered with a wrong queue

select throws_ok(
  $$ select public.next_review_card('2026-10-10 12:00+00', null, false) $$,
  '22023',
  'p_day_end must be after p_now, and no parameter may be null',
  'a null day end is refused'
);

select throws_ok(
  $$ select public.next_review_card('2026-10-10 12:00+00', '2026-10-10 12:00+00', false) $$,
  '22023',
  'p_day_end must be after p_now, and no parameter may be null',
  'a day end not after now is refused'
);

select throws_ok(
  $$ select public.next_review_card('2026-10-10 12:00+00', '2026-10-11 00:00+00', null) $$,
  '22023',
  'p_day_end must be after p_now, and no parameter may be null',
  'a null learning_only is refused'
);

-- record_review ------------------------------------------------------------------

select is(
  public.record_review(
    '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b3', 3::smallint,
    '2026-10-11 01:30+00',
    '{"due":"2026-10-20T01:30:00Z","stability":9.5,"difficulty":4.2,"scheduled_days":9,
      "learning_steps":0,"reps":4,"lapses":1,"state":"review","last_review":"2026-10-11T01:30:00Z"}',
    '{"state":"review","due":"2026-10-11T01:00:00Z","stability":3.1,"difficulty":4.4,
      "scheduled_days":3,"learning_steps":0}'
  ),
  true,
  'a first grade is applied'
);

select results_eq(
  $$ select state, due, reps, lapses, scheduled_days, last_review
     from public.flashcards where id = '00000000-0000-0000-0000-0000000000b3' $$,
  $$ values ('review'::text, '2026-10-20 01:30+00'::timestamptz, 4, 1, 9, '2026-10-11 01:30+00'::timestamptz) $$,
  'the card holds the new FSRS state'
);

select results_eq(
  $$ select flashcard_id, rating, state, due, reviewed_at, user_id
     from public.review_logs where id = '00000000-0000-0000-0000-0000000000e1' $$,
  $$ values ('00000000-0000-0000-0000-0000000000b3'::uuid, 3::smallint, 'review'::text,
             '2026-10-11 01:00+00'::timestamptz, '2026-10-11 01:30+00'::timestamptz,
             '00000000-0000-0000-0000-00000000000a'::uuid) $$,
  'the log row holds the grade, the pre-review snapshot and the owner'
);

select is(
  public.record_review(
    '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b3', 1::smallint,
    '2026-10-11 02:00+00',
    '{"due":"2026-10-11T02:10:00Z","stability":1,"difficulty":8,"scheduled_days":0,
      "learning_steps":0,"reps":5,"lapses":2,"state":"relearning","last_review":"2026-10-11T02:00:00Z"}',
    '{"state":"review","due":"2026-10-20T01:30:00Z","stability":9.5,"difficulty":4.2,
      "scheduled_days":9,"learning_steps":0}'
  ),
  false,
  'a replay with a different payload reports a replay'
);

select results_eq(
  $$ select state, reps from public.flashcards where id = '00000000-0000-0000-0000-0000000000b3' $$,
  $$ values ('review'::text, 4) $$,
  'a replay leaves the card unchanged'
);

select is(
  (select count(*)::int from public.review_logs),
  1,
  'a replay writes no log row'
);

select throws_ok(
  $$ select public.record_review(
       '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c3', 3::smallint,
       '2026-10-11 02:00+00',
       '{"due":"2026-10-12T02:00:00Z","stability":2,"difficulty":5,"scheduled_days":1,
         "learning_steps":0,"reps":1,"lapses":0,"state":"review","last_review":"2026-10-11T02:00:00Z"}',
       '{"state":"relearning","due":"2026-10-10T12:25:00Z","stability":0,"difficulty":0,
         "scheduled_days":0,"learning_steps":0}') $$,
  '22023',
  'review id belongs to another card',
  'an own review id reused on another card is refused, not reported as saved'
);

select results_eq(
  $$ select state, reps from public.flashcards where id = '00000000-0000-0000-0000-0000000000c3' $$,
  $$ values ('relearning'::text, 0) $$,
  'the refused reuse left the other card unchanged'
);

select throws_ok(
  $$ select public.record_review(
       '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000b3', 3::smallint,
       '2026-10-11 02:00+00', '{"due":"2026-10-20T01:30:00Z"}',
       '{"state":"review","due":"2026-10-11T01:00:00Z","stability":3.1,"difficulty":4.4,
         "scheduled_days":3,"learning_steps":0}') $$,
  '22023',
  'p_next must carry the full card state',
  'an incomplete next state is rejected'
);

select throws_ok(
  $$ select public.record_review(
       '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000b3', 3::smallint,
       '2026-10-11 02:00+00', '[]',
       '{"state":"review","due":"2026-10-11T01:00:00Z","stability":3.1,"difficulty":4.4,
         "scheduled_days":3,"learning_steps":0}') $$,
  '22023',
  'p_next must carry the full card state',
  'a next state that is not an object is rejected'
);

select throws_ok(
  $$ select public.record_review(
       '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000b3', 3::smallint,
       '2026-10-11 02:00+00',
       '{"due":"2026-10-20T01:30:00Z","stability":9.5,"difficulty":4.2,"scheduled_days":9,
         "learning_steps":0,"reps":4,"lapses":1,"state":"review","last_review":"2026-10-11T01:30:00Z"}',
       '{"state":"review","due":"2026-10-11T01:00:00Z"}') $$,
  '22023',
  'p_log must carry the full review snapshot',
  'an incomplete review snapshot is rejected'
);

select throws_ok(
  $$ select public.record_review(
       '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000ff', 3::smallint,
       '2026-10-11 02:00+00',
       '{"due":"2026-10-20T01:30:00Z","stability":9.5,"difficulty":4.2,"scheduled_days":9,
         "learning_steps":0,"reps":4,"lapses":1,"state":"review","last_review":"2026-10-11T01:30:00Z"}',
       '{"state":"review","due":"2026-10-11T01:00:00Z","stability":3.1,"difficulty":4.4,
         "scheduled_days":3,"learning_steps":0}') $$,
  'P0002',
  'flashcard not found',
  'grading a card id that does not exist reads as not found'
);

select throws_ok(
  $$ select public.record_review(
       '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000b3', 5::smallint,
       '2026-10-11 02:00+00',
       '{"due":"2026-10-20T01:30:00Z","stability":9.5,"difficulty":4.2,"scheduled_days":9,
         "learning_steps":0,"reps":4,"lapses":1,"state":"review","last_review":"2026-10-11T01:30:00Z"}',
       '{"state":"review","due":"2026-10-11T01:00:00Z","stability":3.1,"difficulty":4.4,
         "scheduled_days":3,"learning_steps":0}') $$,
  '23514',
  null,
  'a rating outside 1-4 is rejected'
);

select throws_ok(
  $$ select public.record_review(
       '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000b3', 3::smallint,
       '2026-10-11 02:00+00',
       '{"due":"2026-10-20T01:30:00Z","stability":9.5,"difficulty":4.2,"scheduled_days":9,
         "learning_steps":0,"reps":4,"lapses":1,"state":"mastered","last_review":"2026-10-11T01:30:00Z"}',
       '{"state":"review","due":"2026-10-11T01:00:00Z","stability":3.1,"difficulty":4.4,
         "scheduled_days":3,"learning_steps":0}') $$,
  '23514',
  null,
  'an unknown next state fails the whole call'
);

select is(
  (select count(*)::int from public.review_logs),
  1,
  'the failed call left no log row (atomicity)'
);

select throws_ok(
  $$ select public.record_review(
       '00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000f1', 3::smallint,
       '2026-10-11 02:00+00',
       '{"due":"2026-10-20T01:30:00Z","stability":9.5,"difficulty":4.2,"scheduled_days":9,
         "learning_steps":0,"reps":4,"lapses":1,"state":"review","last_review":"2026-10-11T01:30:00Z"}',
       '{"state":"learning","due":"2026-10-10T11:00:00Z","stability":1,"difficulty":5,
         "scheduled_days":0,"learning_steps":0}') $$,
  'P0002',
  'flashcard not found',
  'A grading B''s card reads as not found'
);

-- forging: the insert policy, not only the FK and the auth.uid() default

select throws_ok(
  $$ insert into public.review_logs
       (id, flashcard_id, rating, state, due, stability, difficulty, scheduled_days, learning_steps, reviewed_at)
     values ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000f1', 3, 'learning',
             now(), 0, 0, 0, 0, now()) $$,
  '42501',
  null,
  'A cannot log a grade against B''s card, although the FK would accept it'
);

select throws_ok(
  $$ insert into public.review_logs
       (id, user_id, flashcard_id, rating, state, due, stability, difficulty, scheduled_days, learning_steps, reviewed_at)
     values ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-00000000000b',
             '00000000-0000-0000-0000-0000000000b3', 3, 'review', now(), 0, 0, 0, 0, now()) $$,
  '42501',
  null,
  'A cannot insert a log row owned by B'
);

-- immutability

select throws_ok(
  $$ update public.review_logs set rating = 4 where id = '00000000-0000-0000-0000-0000000000e1' $$,
  '42501',
  null,
  'A cannot change an own log row'
);

select throws_ok(
  $$ delete from public.review_logs where id = '00000000-0000-0000-0000-0000000000e1' $$,
  '42501',
  null,
  'A cannot delete an own log row'
);

-- as user B ----------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select is(
  (select count(*)::int from public.review_logs),
  0,
  'B cannot read A''s review logs'
);

select throws_ok(
  $$ select public.record_review(
       '00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000b3', 1::smallint,
       '2026-10-11 02:00+00',
       '{"due":"2026-10-11T02:10:00Z","stability":1,"difficulty":8,"scheduled_days":0,
         "learning_steps":0,"reps":5,"lapses":2,"state":"relearning","last_review":"2026-10-11T02:00:00Z"}',
       '{"state":"review","due":"2026-10-20T01:30:00Z","stability":9.5,"difficulty":4.2,
         "scheduled_days":9,"learning_steps":0}') $$,
  'P0002',
  'flashcard not found',
  'B grading A''s card reads as not found'
);

select throws_ok(
  $$ select public.record_review(
       '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 1::smallint,
       '2026-10-11 02:00+00',
       '{"due":"2026-10-11T02:10:00Z","stability":1,"difficulty":8,"scheduled_days":0,
         "learning_steps":0,"reps":1,"lapses":0,"state":"learning","last_review":"2026-10-11T02:00:00Z"}',
       '{"state":"learning","due":"2026-10-10T11:00:00Z","stability":0,"difficulty":0,
         "scheduled_days":0,"learning_steps":0}') $$,
  '22023',
  'review id unavailable',
  'B reusing A''s review id on an own card is refused'
);

select results_eq(
  $$ select state, reps from public.flashcards where id = '00000000-0000-0000-0000-0000000000f1' $$,
  $$ values ('learning'::text, 0) $$,
  'B''s refused call left B''s card unchanged'
);

select is(
  public.next_review_card('2026-10-10 12:00+00', '2026-10-11 00:00+00', false)->'card'->>'id',
  '00000000-0000-0000-0000-0000000000f1',
  'B''s session shows only B''s card'
);

select is(
  (public.next_review_card('2026-10-10 12:00+00', '2026-10-11 00:00+00', false)->>'due_count')::int,
  1,
  'B''s due_count counts only B''s cards'
);

-- as anon --------------------------------------------------------------------------

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok(
  $$ select public.next_review_card(now(), now() + interval '1 day', false) $$,
  '42501',
  null,
  'anon cannot execute next_review_card'
);

select throws_ok(
  $$ select public.record_review(
       '00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000b3', 3::smallint,
       now(), '{}', '{}') $$,
  '42501',
  null,
  'anon cannot execute record_review'
);

select throws_ok(
  $$ select count(*) from public.review_logs $$,
  '42501',
  null,
  'anon cannot read review logs'
);

-- cascades (as postgres) -----------------------------------------------------------

reset role;

select is(
  (select count(*)::int from public.review_logs),
  1,
  'refused calls by B and anon wrote no log rows'
);

select results_eq(
  $$ select state, reps, due from public.flashcards where id = '00000000-0000-0000-0000-0000000000b3' $$,
  $$ values ('review'::text, 4, '2026-10-20 01:30+00'::timestamptz) $$,
  'B''s refused grade left A''s card unchanged'
);

-- as A, who holds no DELETE on review_logs: the cascade still removes the rows
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

delete from public.flashcards where id = '00000000-0000-0000-0000-0000000000b3';

reset role;

select is(
  (select count(*)::int from public.review_logs where flashcard_id = '00000000-0000-0000-0000-0000000000b3'),
  0,
  'deleting a card deletes its review logs'
);

-- account deletion cascades via the account's cards and directly via user_id
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select ok(
  public.record_review(
    '00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000c3', 3::smallint,
    '2026-10-11 02:00+00',
    '{"due":"2026-10-12T02:00:00Z","stability":2,"difficulty":5,"scheduled_days":1,
      "learning_steps":0,"reps":1,"lapses":0,"state":"review","last_review":"2026-10-11T02:00:00Z"}',
    '{"state":"relearning","due":"2026-10-10T12:25:00Z","stability":0,"difficulty":0,
      "scheduled_days":0,"learning_steps":0}'
  ),
  'a grade on a relearning card is applied'
);

reset role;

delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.review_logs where user_id = '00000000-0000-0000-0000-00000000000a'),
  0,
  'deleting an account deletes its review logs'
);

select * from finish();

rollback;
