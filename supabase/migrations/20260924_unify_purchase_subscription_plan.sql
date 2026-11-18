-- Single, unambiguous subscription purchase command.
--
-- Two overloads were installed side by side:
--   purchase_subscription_plan(uuid, text)
--   purchase_subscription_plan(uuid, text, integer, boolean)
-- Because the second one declares defaults for its last two parameters, a call
-- with only target_user_id/target_plan_slug matched both, and PostgREST /
-- Postgres rejected it as ambiguous (PGRST203 / 42725). Every overload is
-- dropped here and replaced by one function whose optional parameters cover
-- the legacy two-argument call, renewals and multi-month purchases.
--
-- The migration is idempotent: it can be replayed from the SQL editor.

-- ---------------------------------------------------------------------------
-- 1. Remove every existing overload.
-- ---------------------------------------------------------------------------

drop function if exists public.purchase_subscription_plan(uuid, text);
drop function if exists public.purchase_subscription_plan(uuid, text, integer, boolean);

-- Catch any other stale signature (e.g. created by hand from the dashboard).
do $$
declare
  stale record;
begin
  for stale in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'purchase_subscription_plan'
  loop
    execute format('drop function if exists %s', stale.signature);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Structure used by purchases, subscriptions and unlocked sections.
--    Additive only: columns read by the Edge Functions are guaranteed to
--    exist, no existing data is rewritten.
-- ---------------------------------------------------------------------------

alter table if exists public.subscription_plans
  add column if not exists unlock_currency text not null default 'stars',
  add column if not exists required_stars integer not null default 0,
  add column if not exists required_tokens integer not null default 0,
  add column if not exists regular_tokens integer not null default 0,
  add column if not exists duration_days integer not null default 30,
  add column if not exists referral_reward_stars integer not null default 0,
  add column if not exists referral_reward_tokens integer not null default 0,
  add column if not exists features text[] not null default '{}'::text[],
  add column if not exists enabled boolean not null default true;

alter table if exists public.user_metrics
  add column if not exists stars integer not null default 0,
  add column if not exists tokens integer not null default 0;

alter table if exists public.user_subscriptions
  add column if not exists started_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.star_spends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null check (amount > 0),
  plan_slug text,
  plan_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.token_spends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null check (amount > 0),
  plan_slug text,
  plan_name text,
  created_at timestamptz not null default now()
);

alter table public.star_spends enable row level security;
alter table public.token_spends enable row level security;

create index if not exists user_subscriptions_user_status_idx
  on public.user_subscriptions (user_id, status, expires_at desc);
create index if not exists star_spends_user_created_idx
  on public.star_spends (user_id, created_at desc);
create index if not exists token_spends_user_created_idx
  on public.token_spends (user_id, created_at desc);
do $$
begin
  if to_regclass('public.user_feature_unlocks') is not null then
    execute 'create index if not exists user_feature_unlocks_user_feature_idx
      on public.user_feature_unlocks (user_id, feature_key)';
  end if;
end
$$;

-- The Edge Functions read the active subscription with maybeSingle(); more
-- than one active row per user makes that read fail. Enforce it only when the
-- existing data is already clean so the migration never cancels a paid row.
do $$
declare
  duplicated_users integer;
begin
  select count(*) into duplicated_users
  from (
    select user_id
    from public.user_subscriptions
    where status = 'active'
    group by user_id
    having count(*) > 1
  ) duplicates;

  if duplicated_users = 0 then
    execute 'create unique index if not exists user_subscriptions_one_active_idx
      on public.user_subscriptions (user_id) where status = ''active''';
  else
    raise notice
      'user_subscriptions: % user(s) have several active rows; unique index user_subscriptions_one_active_idx not created. Resolve them, then replay this migration.',
      duplicated_users;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Unified purchase function.
--
--   target_duration_months  null  -> the plan's configured duration_days
--                           1..120 -> that many months, priced per started
--                                     plan period (3 months of a 30-day plan
--                                     cost 3x the plan price)
--   target_renewal          null  -> automatic: extend the current
--                                     subscription when it is the same plan
--                           true  -> same as automatic (explicit renewal)
--                           false -> start a fresh period now and cancel the
--                                     current subscription
-- ---------------------------------------------------------------------------

create function public.purchase_subscription_plan(
  target_user_id uuid,
  target_plan_slug text,
  target_duration_months integer default null,
  target_renewal boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text := lower(btrim(coalesce(target_plan_slug, '')));
  v_plan public.subscription_plans%rowtype;
  v_currency text;
  v_unit_price integer;
  v_price integer;
  v_periods integer := 1;
  v_duration_days integer;
  v_balance_stars integer := 0;
  v_balance_tokens integer := 0;
  v_current public.user_subscriptions%rowtype;
  v_is_renewal boolean := false;
  v_now timestamptz := now();
  v_start timestamptz;
  v_expires timestamptz;
  v_subscription_id uuid;
  v_referrer uuid;
  v_reward_stars integer := 0;
  v_reward_tokens integer := 0;
  v_referral_rewarded boolean := false;
begin
  if target_user_id is null then
    raise exception 'INVALID_USER' using errcode = '22023';
  end if;
  if v_slug !~ '^[a-z][a-z0-9_-]{1,39}$' then
    raise exception 'INVALID_PLAN' using errcode = '22023';
  end if;
  if target_duration_months is not null
     and (target_duration_months < 1 or target_duration_months > 120) then
    raise exception 'INVALID_DURATION' using errcode = '22023';
  end if;

  select * into v_plan
  from public.subscription_plans
  where lower(slug) = v_slug and enabled = true;
  if not found then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_currency := case when v_plan.unlock_currency = 'stars' then 'stars' else 'tokens' end;
  v_unit_price := greatest(0, case
    when v_currency = 'stars' then coalesce(v_plan.required_stars, 0)
    else coalesce(v_plan.required_tokens, v_plan.regular_tokens, 0)
  end);
  v_duration_days := greatest(1, coalesce(v_plan.duration_days, 30));

  -- Serialize concurrent purchases of the same user (double tap, two tabs).
  perform pg_advisory_xact_lock(hashtextextended(target_user_id::text, 0));

  -- Current subscription, expired rows are closed first.
  update public.user_subscriptions
  set status = 'expired', updated_at = v_now
  where user_id = target_user_id
    and status = 'active'
    and expires_at is not null
    and expires_at <= v_now;

  select * into v_current
  from public.user_subscriptions
  where user_id = target_user_id and status = 'active'
  order by expires_at desc nulls first
  limit 1
  for update;

  v_is_renewal := found
    and coalesce(target_renewal, true)
    and lower(v_current.plan_slug) = v_slug
    and v_current.expires_at is not null;

  v_start := case when v_is_renewal then v_current.expires_at else v_now end;
  if target_duration_months is null then
    v_expires := v_start + make_interval(days => v_duration_days);
  else
    v_expires := v_start + make_interval(months => target_duration_months);
    v_periods := greatest(1, ceil(
      extract(epoch from (v_expires - v_start)) / 86400.0 / v_duration_days
    )::integer);
  end if;
  v_price := v_unit_price * v_periods;

  -- Balance check and debit.
  select coalesce(stars, 0), coalesce(tokens, 0)
  into v_balance_stars, v_balance_tokens
  from public.user_metrics
  where user_id = target_user_id
  for update;
  -- No user_metrics row yet means an empty balance.
  v_balance_stars := coalesce(v_balance_stars, 0);
  v_balance_tokens := coalesce(v_balance_tokens, 0);

  if v_currency = 'stars' and v_balance_stars < v_price then
    raise exception 'INSUFFICIENT_STARS:%:%', v_balance_stars, v_price
      using errcode = 'P0001';
  end if;
  if v_currency = 'tokens' and v_balance_tokens < v_price then
    raise exception 'INSUFFICIENT_TOKENS:%:%', v_balance_tokens, v_price
      using errcode = 'P0001';
  end if;

  if v_price > 0 then
    if v_currency = 'stars' then
      update public.user_metrics set stars = stars - v_price
      where user_id = target_user_id;
      insert into public.star_spends (user_id, amount, plan_slug, plan_name)
      values (target_user_id, v_price, v_plan.slug, v_plan.display_name);
      v_balance_stars := v_balance_stars - v_price;
    else
      update public.user_metrics set tokens = tokens - v_price
      where user_id = target_user_id;
      insert into public.token_spends (user_id, amount, plan_slug, plan_name)
      values (target_user_id, v_price, v_plan.slug, v_plan.display_name);
      v_balance_tokens := v_balance_tokens - v_price;
    end if;
  end if;

  -- Subscription row.
  if v_is_renewal then
    update public.user_subscriptions
    set expires_at = v_expires, updated_at = v_now
    where id = v_current.id;
    v_subscription_id := v_current.id;
  else
    update public.user_subscriptions
    set status = 'cancelled', updated_at = v_now
    where user_id = target_user_id and status = 'active';

    insert into public.user_subscriptions
      (user_id, plan_slug, status, started_at, expires_at, updated_at)
    values
      (target_user_id, v_plan.slug, 'active', v_start, v_expires, v_now)
    returning id into v_subscription_id;
  end if;

  -- Referral reward: once per referred user (event key unlock:<filleul>).
  -- Isolated in a sub-transaction so a referral issue never blocks a purchase;
  -- the Edge Function falls back to grant_referral_token_for_purchase when
  -- referralRewarded is false.
  if v_price > 0 then
    begin
      select parent.user_id into v_referrer
      from public.referral_accounts child
      join public.referral_accounts parent
        on parent.referral_code = child.referred_by
      where child.user_id = target_user_id
        and parent.user_id <> target_user_id;

      v_reward_stars := greatest(0, coalesce(v_plan.referral_reward_stars, 0));
      v_reward_tokens := greatest(0, coalesce(v_plan.referral_reward_tokens, 0));

      if v_referrer is not null
         and (v_reward_stars > 0 or v_reward_tokens > 0)
         and not exists (
           select 1 from public.referral_events
           where user_id = target_user_id and event_type = 'unlock'
         ) then
        insert into public.referral_events
          (user_id, event_key, event_type, referrer_user_id)
        values
          (target_user_id, 'unlock:' || target_user_id::text, 'unlock', v_referrer);

        insert into public.user_metrics (user_id, stars, tokens)
        values (v_referrer, v_reward_stars, v_reward_tokens)
        on conflict (user_id) do update
          set stars = public.user_metrics.stars + excluded.stars,
              tokens = public.user_metrics.tokens + excluded.tokens;

        v_referral_rewarded := true;
      end if;
    exception
      when unique_violation then
        v_referral_rewarded := true; -- already rewarded for this referred user
      when others then
        v_referral_rewarded := false;
    end;
  end if;

  return jsonb_build_object(
    'subscriptionId', v_subscription_id,
    'planSlug', v_plan.slug,
    'planName', v_plan.display_name,
    'currency', v_currency,
    'price', v_price,
    'spentStars', case when v_currency = 'stars' then v_price else 0 end,
    'spentTokens', case when v_currency = 'tokens' then v_price else 0 end,
    'remainingStars', v_balance_stars,
    'remainingTokens', v_balance_tokens,
    'isRenewal', v_is_renewal,
    'startedAt', v_start,
    'expiresAt', v_expires,
    'durationDays', ceil(extract(epoch from (v_expires - v_start)) / 86400.0)::integer,
    'referralRewarded', v_referral_rewarded
  );
end;
$$;

comment on function public.purchase_subscription_plan(uuid, text, integer, boolean) is
  'Only purchase entry point for subscription plans. Debits stars/tokens, creates or extends the user subscription and rewards the referrer atomically. Called by the subscription-access Edge Function with the service role.';

-- The target user is a parameter, so the function must never be callable
-- directly by browsers: only the Edge Function (service role) may use it.
revoke all on function public.purchase_subscription_plan(uuid, text, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.purchase_subscription_plan(uuid, text, integer, boolean)
  to service_role;

-- Refresh the PostgREST schema cache, otherwise it keeps advertising the
-- dropped overloads until the next restart.
notify pgrst, 'reload schema';
