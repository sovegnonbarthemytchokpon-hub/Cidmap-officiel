-- Google OAuth only: refuse every account that is not created through Google.
--
-- The bounced e-mails reported by Supabase came from the manual
-- e-mail/password signup: each signUp() sends a confirmation e-mail, and
-- mistyped or fake addresses bounce. The site now only offers "Continuer avec
-- Google", but the public anon key still lets anyone call the Auth API
-- (signUp, signInWithOtp/magic link) directly. This migration updates the
-- existing "Before User Created" Auth hook so the database itself refuses any
-- new user whose provider is not Google, before Supabase sends any e-mail.
--
-- Required dashboard settings (the hook is the safety net, not a substitute):
--   1. Authentication -> Sign In / Providers -> Email: disable the provider
--      (or at least "Allow new users to sign up" and "Confirm email").
--   2. Authentication -> Sign In / Providers -> Google: enabled, with the
--      Google Cloud OAuth client ID/secret.
--   3. Authentication -> Hooks -> "Before User Created" -> Postgres function
--      -> public.hook_before_user_created (already set up by
--      20260926_email_bounce_protection.sql).
--
-- Idempotent: it can be replayed from the SQL editor.

create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  provider text := lower(coalesce(event -> 'user' -> 'app_metadata' ->> 'provider', ''));
  email text := event -> 'user' ->> 'email';
begin
  if provider = 'google' then
    return '{}'::jsonb;
  end if;

  -- E-mail/password, magic link, phone or anonymous signups are refused so
  -- no confirmation e-mail or SMS is ever sent.
  if provider <> '' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'Les inscriptions se font uniquement avec « Continuer avec Google ».'
      )
    );
  end if;

  -- Defensive fallback if a payload ever arrives without a provider: keep the
  -- previous address policy instead of blocking blindly.
  if email is null or btrim(email) = '' or public.email_is_acceptable(email) then
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

grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
