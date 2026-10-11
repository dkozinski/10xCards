-- S-06 account-and-data-deletion: a signed-in user deletes their own account.
--
-- Deleting the auth.users row is the whole operation: flashcards, generations
-- and review_logs all reference auth.users (id) on delete cascade, and
-- review_logs also cascades from flashcards. Referential actions run as the
-- table owner, so the cascade reaches generations and review_logs even though
-- authenticated may not delete from them. A table added later is covered as
-- long as its user_id follows the same rule.
--
-- This is the first security definer function in the repo. authenticated has
-- no privilege on auth.users (owned by supabase_auth_admin), but postgres, the
-- owner of this function, holds an explicit DELETE grant on it. The function
-- can only ever delete the caller: the row is chosen by auth.uid(), never by an
-- argument, and a call without a user (anon, service_role, no sub claim) is
-- refused.
--
-- Concurrency (S-05 impl review F6): record_review locks the card, then the
-- log, then auth.users (FK key-share); this delete takes them in the opposite
-- order. A grade landing in another tab at the same instant can deadlock;
-- Postgres aborts one side with 40P01 and the caller can retry.

create function public.delete_my_account()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'no signed-in user' using errcode = '42501';
  end if;

  delete from auth.users where id = v_uid;

  -- false: the row was already gone (deleted from another tab)
  return found;
end;
$$;

comment on function public.delete_my_account() is
  'Deletes the calling user''s auth.users row; the FK cascades remove all of their data. Returns false when the row was already gone.';

-- Functions are executable by PUBLIC, and Supabase grants anon, authenticated
-- and service_role directly. Only a signed-in user may call this one;
-- service_role has no auth.uid() to act on.
revoke execute on function public.delete_my_account() from public, anon, authenticated, service_role;
grant execute on function public.delete_my_account() to authenticated;
