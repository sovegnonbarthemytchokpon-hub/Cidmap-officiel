-- E-mail bounce protection for Supabase Auth.
--
-- Supabase restricts the e-mail privileges of projects whose confirmation
-- e-mails bounce too often. The browser already refuses bad addresses, but
-- the public anon key lets anyone call the Auth API directly, so the same
-- policy is enforced here, before auth.users receives the row and before
-- Supabase sends any e-mail:
--   1. public.email_blocked_domains lists reserved/test domains, disposable
--      inbox providers and frequent typos. Admins can add a domain seen in a
--      bounce report without redeploying anything;
--   2. public.email_is_acceptable(text) applies strict syntax + that list;
--   3. public.hook_before_user_created(jsonb) is the "Before User Created"
--      Auth hook. It rejects the signup with HTTP 400 so no confirmation
--      e-mail is ever sent to the address.
--
-- After applying this migration, enable the hook in the Supabase dashboard:
--   Authentication -> Hooks -> "Before User Created" -> Postgres function
--   -> public.hook_before_user_created.
--
-- Idempotent: it can be replayed from the SQL editor.

create table if not exists public.email_blocked_domains (
  domain text primary key check (domain = lower(domain) and domain <> ''),
  reason text not null default 'manual'
    check (reason in ('reserved', 'disposable', 'typo', 'bounce', 'manual')),
  created_at timestamptz not null default now()
);

alter table public.email_blocked_domains enable row level security;
revoke all on public.email_blocked_domains from anon, authenticated;

insert into public.email_blocked_domains (domain, reason) values
  ('example.com', 'reserved'),
  ('example.net', 'reserved'),
  ('example.org', 'reserved'),
  ('example.fr', 'reserved'),
  ('test.com', 'reserved'),
  ('test.fr', 'reserved'),
  ('test.net', 'reserved'),
  ('test.org', 'reserved'),
  ('localhost', 'reserved'),
  ('localhost.localdomain', 'reserved'),
  ('invalid', 'reserved'),
  ('local', 'reserved'),
  ('domain.com', 'reserved'),
  ('email.com', 'reserved'),
  ('mail.test', 'reserved'),
  ('fake.com', 'reserved'),
  ('nowhere.com', 'reserved'),
  ('noemail.com', 'reserved'),
  ('no-reply.com', 'reserved'),
  ('noreply.com', 'reserved'),
  ('asdf.com', 'reserved'),
  ('aaa.com', 'reserved'),
  ('abc.com', 'reserved'),
  ('xyz.com', 'reserved'),
  ('mailinator.local', 'reserved'),
  ('mailinator.com', 'disposable'),
  ('guerrillamail.com', 'disposable'),
  ('guerrillamail.net', 'disposable'),
  ('guerrillamail.org', 'disposable'),
  ('sharklasers.com', 'disposable'),
  ('grr.la', 'disposable'),
  ('10minutemail.com', 'disposable'),
  ('10minutemail.net', 'disposable'),
  ('tempmail.com', 'disposable'),
  ('temp-mail.org', 'disposable'),
  ('temp-mail.io', 'disposable'),
  ('tempmail.net', 'disposable'),
  ('tempmailo.com', 'disposable'),
  ('throwawaymail.com', 'disposable'),
  ('yopmail.com', 'disposable'),
  ('yopmail.fr', 'disposable'),
  ('yopmail.net', 'disposable'),
  ('trashmail.com', 'disposable'),
  ('trashmail.de', 'disposable'),
  ('getnada.com', 'disposable'),
  ('nada.email', 'disposable'),
  ('dispostable.com', 'disposable'),
  ('maildrop.cc', 'disposable'),
  ('mailnesia.com', 'disposable'),
  ('mintemail.com', 'disposable'),
  ('fakeinbox.com', 'disposable'),
  ('emailondeck.com', 'disposable'),
  ('mohmal.com', 'disposable'),
  ('moakt.com', 'disposable'),
  ('spamgourmet.com', 'disposable'),
  ('mytemp.email', 'disposable'),
  ('tempr.email', 'disposable'),
  ('discard.email', 'disposable'),
  ('burnermail.io', 'disposable'),
  ('mailpoof.com', 'disposable'),
  ('mail.tm', 'disposable'),
  ('emailfake.com', 'disposable'),
  ('tempinbox.com', 'disposable'),
  ('inboxkitten.com', 'disposable'),
  ('mail7.io', 'disposable'),
  ('spambox.us', 'disposable'),
  ('cuvox.de', 'disposable'),
  ('armyspy.com', 'disposable'),
  ('dayrep.com', 'disposable'),
  ('einrot.com', 'disposable'),
  ('fleckens.hu', 'disposable'),
  ('gustr.com', 'disposable'),
  ('jourrapide.com', 'disposable'),
  ('rhyta.com', 'disposable'),
  ('superrito.com', 'disposable'),
  ('teleworm.us', 'disposable'),
  ('gmial.com', 'typo'),
  ('gmai.com', 'typo'),
  ('gmal.com', 'typo'),
  ('gmaill.com', 'typo'),
  ('gamil.com', 'typo'),
  ('gnail.com', 'typo'),
  ('gmail.co', 'typo'),
  ('gmail.cm', 'typo'),
  ('gmail.con', 'typo'),
  ('gmail.fr', 'typo'),
  ('gmail.om', 'typo'),
  ('gmail.cim', 'typo'),
  ('gmailcom', 'typo'),
  ('g-mail.com', 'typo'),
  ('gmsil.com', 'typo'),
  ('hotmial.com', 'typo'),
  ('hotmal.com', 'typo'),
  ('hotmai.com', 'typo'),
  ('hotmail.co', 'typo'),
  ('hotmail.con', 'typo'),
  ('hotmil.com', 'typo'),
  ('hotmail.frr', 'typo'),
  ('hotmal.fr', 'typo'),
  ('hotmai.fr', 'typo'),
  ('yahooo.com', 'typo'),
  ('yaho.com', 'typo'),
  ('yahoo.co', 'typo'),
  ('yahoo.con', 'typo'),
  ('yhoo.com', 'typo'),
  ('yahou.fr', 'typo'),
  ('yaho.fr', 'typo'),
  ('outlok.com', 'typo'),
  ('outloo.com', 'typo'),
  ('outlook.co', 'typo'),
  ('outlook.con', 'typo'),
  ('outllok.com', 'typo'),
  ('iclod.com', 'typo'),
  ('icoud.com', 'typo'),
  ('icloud.co', 'typo'),
  ('live.co', 'typo'),
  ('live.con', 'typo'),
  ('orange.f', 'typo')
on conflict (domain) do nothing;

create or replace function public.email_is_acceptable(candidate text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  email text := lower(btrim(coalesce(candidate, '')));
  domain_part text;
  tld text;
begin
  if email = '' or length(email) > 254 then
    return false;
  end if;
  -- Same shape as src/shared/email-validation.js: dot-atom local part,
  -- LDH domain labels, alphabetic TLD of 2 to 24 letters.
  if email !~ '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$' then
    return false;
  end if;
  if length(split_part(email, '@', 1)) > 64 then
    return false;
  end if;

  domain_part := split_part(email, '@', 2);
  tld := regexp_replace(domain_part, '^.*\.', '');
  if tld in ('test', 'example', 'invalid', 'localhost', 'local') then
    return false;
  end if;

  -- Block the domain itself and any of its parent domains.
  return not exists (
    select 1
    from public.email_blocked_domains b
    where domain_part = b.domain
       or domain_part like '%.' || b.domain
  );
end;
$$;

create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  email text := event -> 'user' ->> 'email';
begin
  -- Phone or OAuth identities without an e-mail are not concerned.
  if email is null or btrim(email) = '' then
    return '{}'::jsonb;
  end if;
  if public.email_is_acceptable(email) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 400,
      'message', 'Cette adresse e-mail ne peut pas recevoir de message. Utilisez une adresse valide.'
    )
  );
end;
$$;

-- Only the Auth server may call the hook; clients must not probe it.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant execute on function public.email_is_acceptable(text) to supabase_auth_admin;
grant select on public.email_blocked_domains to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
revoke execute on function public.email_is_acceptable(text) from public, anon, authenticated;

drop policy if exists "Auth admin reads blocked e-mail domains" on public.email_blocked_domains;
create policy "Auth admin reads blocked e-mail domains"
  on public.email_blocked_domains
  as permissive
  for select
  to supabase_auth_admin
  using (true);
