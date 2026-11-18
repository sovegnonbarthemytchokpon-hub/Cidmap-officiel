-- Individual vs collective entitlements: one decision, two purchase commands.
--
-- Cidmap sells access in two ways:
--   * individual  -> purchase_feature_unlock(target_user_id, target_feature_key)
--                    writes one timed row in user_feature_unlocks;
--   * collective  -> purchase_subscription_plan(target_user_id, target_plan_slug,
--                    target_duration_months, target_renewal)
--                    writes one row in user_subscriptions whose plan lists the
--                    covered features (packs, groups, subscriptions).
--
-- The Edge Functions and the browser already treat an active collective plan
-- as covering its features (`tableaux` covers every `tableaux-*` key, legacy
-- short keys such as `oracle` are aliases, and a feature_access_rules row can
-- be linked to a plan through plan_slug). The database side did not: the
-- browser preflight user_can_access_tableau() only knew individual grants and
-- stale overloads of the purchase functions made some calls ambiguous
-- (PGRST203 / 42725).
--
-- This migration:
--   1. adds the shared SQL helpers that encode the individual/collective link;
--   2. adds user_feature_entitlement(), the single decision used by SQL;
--   3. recreates user_can_access_tableau() on top of it, without overloads;
--   4. removes stale overloads of purchase_feature_unlock so the individual
--      command has exactly one signature, like the collective one.
--
-- Idempotent: it can be replayed from the SQL editor.

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------

create or replace function public.canonical_feature_key(value text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(btrim(coalesce(value, '')))
    when 'universelle' then 'tableaux-universelle'
    when 'intuition' then 'tableaux-intuition'
    when 'oracle' then 'tableaux-oracle'
    when 'lnb' then 'tableaux-lnb'
    when 'balsa' then 'tableaux-balsa'
    when 'standby' then 'tableaux-standby'
    else lower(btrim(coalesce(value, '')))
  end;
$$;

-- `plan_features` is passed as jsonb (to_jsonb(subscription_plans.features))
-- so the helper works whether the column is text[] or jsonb.
create or replace function public.plan_covers_feature(
  plan_features jsonb,
  target_feature_key text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  with wanted as (
    select public.canonical_feature_key(target_feature_key) as key
  ),
  features as (
    select public.canonical_feature_key(item) as key
    from jsonb_array_elements_text(
      case when jsonb_typeof(plan_features) = 'array'
        then plan_features else '[]'::jsonb end
    ) as item
  )
  select exists (
    select 1 from features, wanted
    where features.key = wanted.key
       or (wanted.key like 'tableaux-%' and features.key = 'tableaux')
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Single entitlement decision
--
-- Mirrors enforceFeatureAccess() in supabase/functions/_shared.ts:
--   free        no enabled rule and no enabled plan covers the key, or a
--               zero-priced rule that is not tied to a plan;
--   admin       user_roles.role = 'admin';
--   individual  active row in user_feature_unlocks;
--   collective  active subscription whose enabled plan covers the key, either
--               through its features or through feature_access_rules.plan_slug;
--   none        otherwise.
-- When both an individual grant and a collective plan apply, the one that
-- lasts longest is reported (null expiry = unlimited).
-- ---------------------------------------------------------------------------

create or replace function public.user_feature_entitlement(
  target_user_id uuid,
  target_feature_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_key text := public.canonical_feature_key(target_feature_key);
  v_now timestamptz := now();
  v_rule_found boolean := false;
  v_rule_plan text;
  v_rule_stars integer := 0;
  v_rule_tokens integer := 0;
  v_protected_by_offer boolean := false;
  v_is_admin boolean := false;
  v_individual_found boolean := false;
  v_individual_expires timestamptz;
  v_collective_found boolean := false;
  v_collective_expires timestamptz;
  v_collective_plan text;
begin
  if v_key = '' then
    return jsonb_build_object('allowed', false, 'source', 'none', 'featureKey', v_key);
  end if;

  select true, r.plan_slug, coalesce(r.required_stars, 0), coalesce(r.required_tokens, 0)
  into v_rule_found, v_rule_plan, v_rule_stars, v_rule_tokens
  from public.feature_access_rules r
  where r.enabled is distinct from false
    and public.canonical_feature_key(r.feature_key) = v_key
    and (
      r.plan_slug is null
      or exists (
        select 1 from public.subscription_plans p
        where p.slug = r.plan_slug and p.enabled is distinct from false
      )
    )
  limit 1;

  select exists (
    select 1 from public.subscription_plans p
    where p.enabled is distinct from false
      and public.plan_covers_feature(to_jsonb(p.features), v_key)
  ) into v_protected_by_offer;

  v_rule_found := coalesce(v_rule_found, false);

  if not v_rule_found and not v_protected_by_offer then
    return jsonb_build_object('allowed', true, 'source', 'free', 'featureKey', v_key);
  end if;
  if v_rule_found
     and v_rule_plan is null
     and coalesce(v_rule_stars, 0) <= 0
     and coalesce(v_rule_tokens, 0) <= 0
     and not v_protected_by_offer then
    return jsonb_build_object('allowed', true, 'source', 'free', 'featureKey', v_key);
  end if;

  if target_user_id is null then
    return jsonb_build_object('allowed', false, 'source', 'none', 'featureKey', v_key);
  end if;

  if to_regclass('public.user_roles') is not null then
    execute 'select exists (select 1 from public.user_roles
               where user_id = $1 and role = ''admin'')'
      into v_is_admin using target_user_id;
    if v_is_admin then
      return jsonb_build_object('allowed', true, 'source', 'admin', 'featureKey', v_key);
    end if;
  end if;

  -- Individual grant.
  select true, u.expires_at into v_individual_found, v_individual_expires
  from public.user_feature_unlocks u
  where u.user_id = target_user_id
    and public.canonical_feature_key(u.feature_key) = v_key
    and (u.expires_at is null or u.expires_at > v_now)
  order by u.expires_at desc nulls first
  limit 1;

  -- Collective plan.
  select true, s.expires_at, p.slug
  into v_collective_found, v_collective_expires, v_collective_plan
  from public.user_subscriptions s
  join public.subscription_plans p
    on p.slug = s.plan_slug and p.enabled is distinct from false
  where s.user_id = target_user_id
    and s.status = 'active'
    and (s.started_at is null or s.started_at <= v_now)
    and (s.expires_at is null or s.expires_at > v_now)
    and (
      public.plan_covers_feature(to_jsonb(p.features), v_key)
      or (v_rule_found and v_rule_plan = p.slug)
    )
  order by s.expires_at desc nulls first
  limit 1;

  if coalesce(v_individual_found, false) and coalesce(v_collective_found, false) then
    if v_collective_expires is null
       or (v_individual_expires is not null and v_collective_expires >= v_individual_expires) then
      v_individual_found := false;
    else
      v_collective_found := false;
    end if;
  end if;

  if coalesce(v_collective_found, false) then
    return jsonb_build_object(
      'allowed', true, 'source', 'collective', 'featureKey', v_key,
      'planSlug', v_collective_plan, 'expiresAt', v_collective_expires
    );
  end if;
  if coalesce(v_individual_found, false) then
    return jsonb_build_object(
      'allowed', true, 'source', 'individual', 'featureKey', v_key,
      'expiresAt', v_individual_expires
    );
  end if;
  return jsonb_build_object('allowed', false, 'source', 'none', 'featureKey', v_key);
end;
$$;

comment on function public.user_feature_entitlement(uuid, text) is
  'Single access decision for a feature: free, admin, individual (user_feature_unlocks) or collective (active user_subscriptions plan covering the key). Service role only.';

revoke all on function public.user_feature_entitlement(uuid, text)
  from public, anon, authenticated;
grant execute on function public.user_feature_entitlement(uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Browser preflight: user_can_access_tableau(target_feature_key text)
--
-- Only one signature is kept. The browser accepts a boolean, so the function
-- returns boolean and always checks the caller (auth.uid()), never a user id
-- passed as a parameter.
-- ---------------------------------------------------------------------------

do $$
declare
  stale record;
begin
  for stale in
    select p.oid::regprocedure as signature,
           pg_get_function_identity_arguments(p.oid) as args,
           p.prorettype = 'boolean'::regtype as returns_boolean
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'user_can_access_tableau'
  loop
    -- The (text) signature returning boolean is replaced in place below;
    -- every other overload (or a (text) returning another type) is dropped.
    if stale.args = 'target_feature_key text' and stale.returns_boolean then
      continue;
    end if;
    begin
      execute format('drop function if exists %s', stale.signature);
    exception when dependent_objects_still_exist then
      raise exception
        'user_can_access_tableau overload % is referenced by another object (policy/view). Update that object to use user_feature_entitlement(), then replay this migration.',
        stale.signature;
    end;
  end loop;
end
$$;

create or replace function public.user_can_access_tableau(target_feature_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (public.user_feature_entitlement(auth.uid(), target_feature_key) ->> 'allowed')::boolean,
    false
  );
$$;

comment on function public.user_can_access_tableau(text) is
  'Browser preflight for protected Tableaux: true when the caller has a free, admin, individual or collective entitlement for the key. The Edge Functions still enforce the same rule before returning values.';

revoke all on function public.user_can_access_tableau(text) from public, anon;
grant execute on function public.user_can_access_tableau(text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Individual purchase command: exactly one signature
--
-- subscription-access calls purchase_feature_unlock with the named arguments
-- (target_user_id, target_feature_key). Any other overload (for example one
-- with extra defaulted duration/currency parameters) makes that call
-- ambiguous. The canonical (uuid, text) version is kept untouched; the others
-- are dropped only when it exists, so an installation is never left without
-- an individual purchase command.
-- ---------------------------------------------------------------------------

do $$
declare
  canonical regprocedure := to_regprocedure('public.purchase_feature_unlock(uuid, text)');
  stale record;
begin
  if canonical is null then
    raise notice 'purchase_feature_unlock(uuid, text) not found: overloads left unchanged.';
    return;
  end if;

  for stale in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'purchase_feature_unlock'
      and p.oid <> canonical::oid
  loop
    execute format('drop function if exists %s', stale.signature);
  end loop;

  comment on function public.purchase_feature_unlock(uuid, text) is
    'Individual purchase command: debits the feature rule price and creates or extends one user_feature_unlocks grant. Never touches user_subscriptions. Called by the subscription-access Edge Function with the service role.';
  revoke all on function public.purchase_feature_unlock(uuid, text)
    from public, anon, authenticated;
  grant execute on function public.purchase_feature_unlock(uuid, text)
    to service_role;
end
$$;

-- Collective purchase command: re-assert the single signature installed by
-- 20260924_unify_purchase_subscription_plan.sql in case an overload was
-- recreated by hand since.
do $$
declare
  canonical regprocedure := to_regprocedure(
    'public.purchase_subscription_plan(uuid, text, integer, boolean)'
  );
  stale record;
begin
  if canonical is null then
    raise notice 'purchase_subscription_plan(uuid, text, integer, boolean) not found: apply 20260924_unify_purchase_subscription_plan.sql first.';
    return;
  end if;
  for stale in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'purchase_subscription_plan'
      and p.oid <> canonical::oid
  loop
    execute format('drop function if exists %s', stale.signature);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Indexes used by the entitlement decision.
-- ---------------------------------------------------------------------------

create index if not exists user_subscriptions_user_active_window_idx
  on public.user_subscriptions (user_id, expires_at desc)
  where status = 'active';

do $$
begin
  if to_regclass('public.user_feature_unlocks') is not null then
    execute 'create index if not exists user_feature_unlocks_user_expiry_idx
      on public.user_feature_unlocks (user_id, feature_key, expires_at desc)';
  end if;
end
$$;

notify pgrst, 'reload schema';
