-- S-03 review-and-save-proposals: saving reviewed AI proposals.
-- Three objects, all additive and unused by the code deployed before S-03:
--   1. flashcards.source  - where a card came from, for the deck-share metric
--   2. generations        - per-generation counts, for the acceptance metric
--   3. save_generation()  - writes both in one transaction, idempotently
-- Grants are written in their final state here (lesson of F-01: new public
-- tables still inherit TRUNCATE/REFERENCES/TRIGGER through default privileges).

-- 1. flashcards.source -------------------------------------------------------

-- Existing rows and every manual card default to 'manual'; only
-- save_generation writes 'ai' (kept unchanged) or 'ai_edited' (edited first).
-- Known limitation: the metrics are self-reported. The owner keeps table-wide
-- UPDATE on flashcards and INSERT on generations (the function runs as the
-- caller), so a direct API call can relabel or invent the owner's own rows.
-- The app never writes source outside save_generation.
alter table public.flashcards
  add column source text not null default 'manual',
  add constraint flashcards_source_check check (source in ('manual', 'ai', 'ai_edited'));

-- 2. generations ---------------------------------------------------------------

create table public.generations (
  -- minted by the client when proposals arrive; doubles as the idempotency key
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- number of proposals the user was shown and judged
  generated_count int not null check (generated_count between 1 and 20),
  accepted_unedited_count int not null check (accepted_unedited_count >= 0),
  accepted_edited_count int not null check (accepted_edited_count >= 0),
  rejected_count int not null check (rejected_count >= 0),
  created_at timestamptz not null default now(),
  constraint generations_counts_sum check (
    accepted_unedited_count + accepted_edited_count + rejected_count = generated_count
  )
);

comment on table public.generations is
  'Per-generation counts only, never text: no source text and no rejected card content. Owner-only via RLS; rows are immutable.';

create index generations_user_id_idx on public.generations (user_id);

-- Counts are records, not user data to edit: the owner may read and add, never
-- change or remove. Account deletion still removes them via the cascade.
revoke all on public.generations from anon, authenticated, service_role;
grant select, insert on public.generations to authenticated;
grant select, insert, update, delete on public.generations to service_role;

alter table public.generations enable row level security;

create policy "generations_select_own"
  on public.generations for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "generations_insert_own"
  on public.generations for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- authenticated holds no UPDATE/DELETE privilege, so these deny policies are
-- never reached today; they satisfy the per-operation rule and stay as a
-- second layer if a grant is ever widened.

create policy "generations_update_deny"
  on public.generations for update
  to authenticated
  using (false)
  with check (false);

create policy "generations_delete_deny"
  on public.generations for delete
  to authenticated
  using (false);

create policy "generations_select_anon_deny"
  on public.generations for select
  to anon
  using (false);

create policy "generations_insert_anon_deny"
  on public.generations for insert
  to anon
  with check (false);

create policy "generations_update_anon_deny"
  on public.generations for update
  to anon
  using (false)
  with check (false);

create policy "generations_delete_anon_deny"
  on public.generations for delete
  to anon
  using (false);

-- 3. save_generation ---------------------------------------------------------

-- PostgREST runs one RPC call in one transaction, so the cards and the counts
-- land together or not at all. security invoker keeps the caller's RLS in
-- force: user_id defaults to auth.uid() in both tables and the insert policies
-- check it. The function guarantees only what the DB constraints guarantee;
-- content validation (trimming, visible characters) is zod's job in the route.
create function public.save_generation(
  p_generation_id uuid,
  p_generated_count int,
  p_cards jsonb
)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_unedited int;
  v_edited int;
  v_total int;
  v_saved int;
begin
  if p_cards is null or jsonb_typeof(p_cards) <> 'array' then
    raise exception 'p_cards must be a json array' using errcode = '22023';
  end if;

  -- the route caps the body, but a direct RPC call does not
  if jsonb_array_length(p_cards) > 20 then
    raise exception 'too many cards' using errcode = '22023';
  end if;

  select count(*) filter (where c->>'source' = 'ai'),
         count(*) filter (where c->>'source' = 'ai_edited'),
         count(*)
    into v_unedited, v_edited, v_total
    from jsonb_array_elements(p_cards) as c;

  if v_unedited + v_edited <> v_total then
    raise exception 'invalid card source' using errcode = '22023';
  end if;

  -- Claim the id first; cards are written only if this call made the claim.
  -- A concurrent duplicate waits on the primary key and then becomes a replay.
  -- Count bounds (more cards than generated, generated > 20) fail the table
  -- CHECKs with 23514.
  insert into public.generations
    (id, generated_count, accepted_unedited_count, accepted_edited_count, rejected_count)
  values
    (p_generation_id, p_generated_count, v_unedited, v_edited, p_generated_count - v_total)
  on conflict (id) do nothing;

  if not found then
    -- replay: return the first result and write nothing. The payload is
    -- ignored, even if it differs from the first call. RLS shows only own
    -- rows, so an id claimed by another account reads as missing.
    select accepted_unedited_count + accepted_edited_count
      into v_saved
      from public.generations
     where id = p_generation_id;

    if not found then
      raise exception 'generation id unavailable' using errcode = '22023';
    end if;

    return v_saved;
  end if;

  insert into public.flashcards (front, back, source)
  select c->>'front', c->>'back', c->>'source'
    from jsonb_array_elements(p_cards) as c;

  return v_total;
end;
$$;

comment on function public.save_generation(uuid, int, jsonb) is
  'Saves the kept cards of one reviewed generation plus its counts, atomically and idempotently by generation id. Returns the saved-card count.';

-- Functions are executable by PUBLIC (and so by anon) by default.
-- service_role keeps EXECUTE for parity with its table grants, but it cannot
-- actually save: without a user JWT auth.uid() is null and user_id rejects it.
revoke execute on function public.save_generation(uuid, int, jsonb) from public, anon;
grant execute on function public.save_generation(uuid, int, jsonb) to authenticated, service_role;
