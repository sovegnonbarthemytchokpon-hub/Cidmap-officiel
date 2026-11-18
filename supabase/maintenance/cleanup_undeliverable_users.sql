-- Manual cleanup of accounts that keep producing bounced e-mails.
--
-- NOT a migration: run it by hand from the Supabase SQL editor, one step at a
-- time, after 20260926_email_bounce_protection.sql has been applied (it uses
-- public.email_is_acceptable()).
--
-- Only UNCONFIRMED accounts are targeted: an address that never clicked the
-- confirmation link has no verified mailbox, owns no purchase in practice,
-- and is exactly what Supabase re-mails (and bounces) on every new signUp().
-- Confirmed accounts are never touched.

-- ---------------------------------------------------------------------------
-- Step 1 - Preview. Read the list before deleting anything.
-- ---------------------------------------------------------------------------
select
  u.id,
  u.email,
  u.created_at,
  u.confirmation_sent_at,
  case
    when not public.email_is_acceptable(u.email) then 'invalid_or_blocked_domain'
    else 'unconfirmed_over_7_days'
  end as cleanup_reason
from auth.users u
where u.email_confirmed_at is null
  and u.email is not null
  and (
    not public.email_is_acceptable(u.email)
    or u.created_at < now() - interval '7 days'
  )
order by u.created_at desc;

-- ---------------------------------------------------------------------------
-- Step 2 - Delete. Uncomment and run after checking step 1.
-- Rows in tables referencing auth.users(id) with ON DELETE CASCADE (profiles,
-- roles...) are removed with the user. If a foreign key without cascade
-- blocks the delete, the transaction is rolled back and nothing is lost.
-- ---------------------------------------------------------------------------
-- begin;
-- delete from auth.users u
-- where u.email_confirmed_at is null
--   and u.email is not null
--   and (
--     not public.email_is_acceptable(u.email)
--     or u.created_at < now() - interval '7 days'
--   );
-- commit;

-- ---------------------------------------------------------------------------
-- Step 3 - Block a domain reported in bounce notifications (optional).
-- New signups on that domain are then refused by the Auth hook.
-- ---------------------------------------------------------------------------
-- insert into public.email_blocked_domains (domain, reason)
-- values ('domaine-qui-rebondit.com', 'bounce')
-- on conflict (domain) do nothing;
