-- S-05 srs-review-session: FSRS scheduling state and the review log.
-- Four objects, all additive and unused by the code deployed before S-05:
--   1. flashcards FSRS columns - the card's current memory state (ts-fsrs Card)
--   2. review_logs             - one append-only row per grade (ts-fsrs ReviewLog)
--   3. record_review()         - writes a grade and the new state, atomically
--                                and idempotently by review id
--   4. next_review_card()      - picks the next card of a session and counts
--                                what is due
-- The schedule itself is computed in the Worker by ts-fsrs; the database stores
-- it and chooses among cards. Grants are written in their final state here.

-- 1. flashcards FSRS columns -----------------------------------------------

-- The defaults are ts-fsrs createEmptyCard(): every existing card and every
-- card inserted by any path (createFlashcard, save_generation) is new and due
-- now. elapsed_days is deprecated in ts-fsrs and deliberately not stored.
-- Known limitation (as for source): the owner keeps table-wide UPDATE on
-- flashcards, so a direct API call can rewrite the owner's own schedule. The
-- app writes these columns only through record_review.
alter table public.flashcards
  add column due timestamptz not null default now(),
  add column stability double precision not null default 0,
  add column difficulty double precision not null default 0,
  add column scheduled_days int not null default 0,
  add column learning_steps int not null default 0,
  add column reps int not null default 0,
  add column lapses int not null default 0,
  add column state text not null default 'new',
  add column last_review timestamptz,
  add constraint flashcards_state_check check (state in ('new', 'learning', 'review', 'relearning')),
  add constraint flashcards_srs_nonnegative check (
    stability >= 0 and difficulty >= 0 and scheduled_days >= 0
    and learning_steps >= 0 and reps >= 0 and lapses >= 0
  );

-- serves next_review_card: the owner's cards ordered by due
create index flashcards_user_id_due_idx on public.flashcards (user_id, due);

-- 2. review_logs ---------------------------------------------------------------

create table public.review_logs (
  -- minted by the client when a card is shown; doubles as the idempotency key
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- a deleted card takes its history with it
  flashcard_id uuid not null references public.flashcards (id) on delete cascade,
  rating smallint not null,
  -- the card's state before this grade, as ts-fsrs ReviewLog reports it
  state text not null,
  due timestamptz not null,
  stability double precision not null,
  difficulty double precision not null,
  scheduled_days int not null,
  learning_steps int not null,
  reviewed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint review_logs_rating_check check (rating between 1 and 4),
  constraint review_logs_state_check check (state in ('new', 'learning', 'review', 'relearning')),
  constraint review_logs_nonnegative check (
    stability >= 0 and difficulty >= 0 and scheduled_days >= 0 and learning_steps >= 0
  )
);

comment on table public.review_logs is
  'One row per grade, never card text. Owner-only via RLS; rows are immutable. Deleted with the card or the account.';

comment on column public.review_logs.due is
  'ts-fsrs ReviewLog.due: the time of the previous review (the card''s due only if it had never been reviewed). Kept verbatim so a future optimiser or rollback can read it as ts-fsrs does.';

create index review_logs_user_id_idx on public.review_logs (user_id);
create index review_logs_flashcard_id_idx on public.review_logs (flashcard_id);

-- A grade is a record: the owner may read and add, never change or remove.
-- The cascades still delete rows: referential actions run as the table owner.
revoke all on public.review_logs from anon, authenticated, service_role;
grant select, insert on public.review_logs to authenticated;
grant select, insert, update, delete on public.review_logs to service_role;

alter table public.review_logs enable row level security;

create policy "review_logs_select_own"
  on public.review_logs for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- The foreign key check bypasses RLS, so it would accept another user's card
-- id. The subquery runs under the caller's flashcards RLS, which is what makes
-- the card the caller's own.
create policy "review_logs_insert_own"
  on public.review_logs for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.flashcards f where f.id = review_logs.flashcard_id)
  );

-- authenticated holds no UPDATE/DELETE privilege, so these deny policies are
-- never reached today; they satisfy the per-operation rule and stay as a
-- second layer if a grant is ever widened.

create policy "review_logs_update_deny"
  on public.review_logs for update
  to authenticated
  using (false)
  with check (false);

create policy "review_logs_delete_deny"
  on public.review_logs for delete
  to authenticated
  using (false);

create policy "review_logs_select_anon_deny"
  on public.review_logs for select
  to anon
  using (false);

create policy "review_logs_insert_anon_deny"
  on public.review_logs for insert
  to anon
  with check (false);

create policy "review_logs_update_anon_deny"
  on public.review_logs for update
  to anon
  using (false)
  with check (false);

create policy "review_logs_delete_anon_deny"
  on public.review_logs for delete
  to anon
  using (false);

-- 3. record_review -----------------------------------------------------------

-- One RPC call is one transaction, so the log row and the card's new state
-- land together or not at all. security invoker keeps the caller's RLS in
-- force. p_next is the ts-fsrs Card after the grade, p_log its ReviewLog; both
-- are computed by the Worker. Two tabs grading the same card: last write wins,
-- and both grades are logged.
create function public.record_review(
  p_review_id uuid,
  p_flashcard_id uuid,
  p_rating smallint,
  p_reviewed_at timestamptz,
  p_next jsonb,
  p_log jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_replayed_card uuid;
begin
  if p_next is null or jsonb_typeof(p_next) <> 'object'
     or not p_next ?& array['due', 'stability', 'difficulty', 'scheduled_days',
                            'learning_steps', 'reps', 'lapses', 'state', 'last_review'] then
    raise exception 'p_next must carry the full card state' using errcode = '22023';
  end if;

  if p_log is null or jsonb_typeof(p_log) <> 'object'
     or not p_log ?& array['state', 'due', 'stability', 'difficulty', 'scheduled_days',
                           'learning_steps'] then
    raise exception 'p_log must carry the full review snapshot' using errcode = '22023';
  end if;

  -- Lock the card first. A missing card and another user's card look the same
  -- under RLS and both end here; the lock also makes a concurrent delete wait
  -- until this grade has landed.
  perform 1 from public.flashcards where id = p_flashcard_id for update;
  if not found then
    raise exception 'flashcard not found' using errcode = 'P0002';
  end if;

  -- Claim the review id; the card moves only if this call made the claim.
  insert into public.review_logs
    (id, flashcard_id, rating, state, due, stability, difficulty,
     scheduled_days, learning_steps, reviewed_at)
  values
    (p_review_id, p_flashcard_id, p_rating,
     p_log->>'state',
     (p_log->>'due')::timestamptz,
     (p_log->>'stability')::double precision,
     (p_log->>'difficulty')::double precision,
     (p_log->>'scheduled_days')::int,
     (p_log->>'learning_steps')::int,
     p_reviewed_at)
  on conflict (id) do nothing;

  if not found then
    -- replay: write nothing; the payload is ignored even if it differs. RLS
    -- shows only own rows, so an id claimed by another account reads as missing.
    -- An own id reused on another card is a client bug: refuse it rather than
    -- report the second card's grade as saved.
    select flashcard_id into v_replayed_card from public.review_logs where id = p_review_id;
    if not found then
      raise exception 'review id unavailable' using errcode = '22023';
    end if;
    if v_replayed_card <> p_flashcard_id then
      raise exception 'review id belongs to another card' using errcode = '22023';
    end if;
    return false;
  end if;

  update public.flashcards
     set due = (p_next->>'due')::timestamptz,
         stability = (p_next->>'stability')::double precision,
         difficulty = (p_next->>'difficulty')::double precision,
         scheduled_days = (p_next->>'scheduled_days')::int,
         learning_steps = (p_next->>'learning_steps')::int,
         reps = (p_next->>'reps')::int,
         lapses = (p_next->>'lapses')::int,
         state = p_next->>'state',
         last_review = (p_next->>'last_review')::timestamptz
   where id = p_flashcard_id;

  return true;
end;
$$;

comment on function public.record_review(uuid, uuid, smallint, timestamptz, jsonb, jsonb) is
  'Logs one grade and stores the card''s next FSRS state, atomically and idempotently by review id. Returns true when applied, false on replay.';

revoke execute on function public.record_review(uuid, uuid, smallint, timestamptz, jsonb, jsonb) from public, anon;
grant execute on function public.record_review(uuid, uuid, smallint, timestamptz, jsonb, jsonb) to authenticated, service_role;

-- 4. next_review_card --------------------------------------------------------

-- The first non-empty tier wins:
--   1. learning/relearning cards due by p_now           (oldest due first)
--   2. review cards due before p_day_end                 (oldest due first)
--   3. new cards                                         (oldest created first)
--   4. learning/relearning cards due within 20 minutes   ("learn ahead")
-- Learning cards never use the day cutoff: a card graded Again must wait for
-- its minute step, not come back at once. p_learning_only (set after a batch
-- of 20) keeps only tiers 1 and 4. due_count counts tiers 1-3 regardless.
-- p_day_end is the client's next local midnight; the route bounds it.
create function public.next_review_card(
  p_now timestamptz,
  p_day_end timestamptz,
  p_learning_only boolean
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  -- A null or inverted window would quietly return a wrong queue (e.g.
  -- "nothing to review" while cards are due); refuse it instead.
  if p_now is null or p_day_end is null or p_learning_only is null or p_day_end <= p_now then
    raise exception 'p_day_end must be after p_now, and no parameter may be null'
      using errcode = '22023';
  end if;

  return (
    with tiered as (
      select f.id, f.front, f.back, f.state, f.due, f.created_at,
             case
               when f.state in ('learning', 'relearning') and f.due <= p_now then 1
               when not p_learning_only and f.state = 'review' and f.due < p_day_end then 2
               when not p_learning_only and f.state = 'new' and f.due < p_day_end then 3
               when f.state in ('learning', 'relearning')
                    and f.due <= p_now + interval '20 minutes' then 4
             end as tier
        from public.flashcards f
    ),
    picked as (
      select id, front, back, state
        from tiered
       where tier is not null
       order by tier, case when tier = 3 then created_at else due end, id
       limit 1
    )
    select jsonb_build_object(
      'card', (select to_jsonb(p) from picked p),
      'due_count', (
        select count(*)::int
          from public.flashcards f
         where (f.state in ('learning', 'relearning') and f.due <= p_now)
            or (f.state in ('review', 'new') and f.due < p_day_end)
      )
    )
  );
end;
$$;

comment on function public.next_review_card(timestamptz, timestamptz, boolean) is
  'Returns {card: {id, front, back, state} | null, due_count} for the caller''s next review card.';

revoke execute on function public.next_review_card(timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.next_review_card(timestamptz, timestamptz, boolean) to authenticated, service_role;
