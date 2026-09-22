-- F-01 deck-data-contract: the owner-scoped flashcard store.
-- Every row belongs to exactly one account; row level security is the only
-- thing standing between the publishable key (shipped to the browser) and
-- another user's cards, so isolation is enforced here, not in app code.

create table public.flashcards (
  id uuid primary key default gen_random_uuid(),
  -- defaults to the caller, so inserts may omit it; the insert policy still
  -- rejects any explicit value that is not the caller's own id
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  front text not null,
  back text not null,
  created_at timestamptz not null default now(),
  constraint flashcards_front_length check (char_length(btrim(front)) >= 1 and char_length(front) <= 200),
  constraint flashcards_back_length check (char_length(btrim(back)) >= 1 and char_length(back) <= 500)
);

comment on table public.flashcards is 'User-owned flashcards. Access is owner-only via RLS.';

create index flashcards_user_id_idx on public.flashcards (user_id);

-- New tables in public no longer get API-role privileges by default, so the
-- owner's role must be granted explicitly. anon gets nothing: it is stopped by
-- missing privileges first and by the deny policies below second.
grant select, insert, update, delete on public.flashcards to authenticated;

alter table public.flashcards enable row level security;

-- authenticated: owner-only, one policy per operation.
-- (select auth.uid()) is evaluated once per statement instead of once per row.

create policy "flashcards_select_own"
  on public.flashcards for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "flashcards_insert_own"
  on public.flashcards for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- using picks which rows may be targeted; with check validates the row after
-- the change, so an owner cannot hand a card to another account via user_id
create policy "flashcards_update_own"
  on public.flashcards for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "flashcards_delete_own"
  on public.flashcards for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- anon: explicit deny per operation. RLS already denies anything without a
-- matching policy; these make the intent visible and satisfy the repo rule
-- of one policy per operation per role.

create policy "flashcards_select_anon_deny"
  on public.flashcards for select
  to anon
  using (false);

create policy "flashcards_insert_anon_deny"
  on public.flashcards for insert
  to anon
  with check (false);

create policy "flashcards_update_anon_deny"
  on public.flashcards for update
  to anon
  using (false)
  with check (false);

create policy "flashcards_delete_anon_deny"
  on public.flashcards for delete
  to anon
  using (false);
