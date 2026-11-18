-- Health check for the purchase functions (read-only).
--
-- Run in the Supabase SQL editor after applying, in order:
--   migrations/20260924_unify_purchase_subscription_plan.sql
--   migrations/20260925_individual_collective_entitlements.sql
-- Every query below must return the "expected" result. If one does not,
-- replay the two migrations above (they are idempotent).

-- 1. Exactly ONE collective purchase command.
--    Expected: a single row
--    purchase_subscription_plan(uuid,text,integer,boolean)
select p.oid::regprocedure as signature
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'purchase_subscription_plan';

-- 2. Exactly ONE individual purchase command.
--    Expected: a single row purchase_feature_unlock(uuid,text)
select p.oid::regprocedure as signature
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'purchase_feature_unlock';

-- 3. Exactly ONE browser preflight, returning boolean.
--    Expected: a single row user_can_access_tableau(text) | boolean
select p.oid::regprocedure as signature, p.prorettype::regtype as returns
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'user_can_access_tableau';

-- 4. Browsers must not be able to call the purchase commands directly
--    (they take the target user as a parameter). Expected: all false.
select
  has_function_privilege('anon',
    'public.purchase_subscription_plan(uuid,text,integer,boolean)', 'execute') as anon_collective,
  has_function_privilege('authenticated',
    'public.purchase_subscription_plan(uuid,text,integer,boolean)', 'execute') as auth_collective,
  has_function_privilege('anon',
    'public.purchase_feature_unlock(uuid,text)', 'execute') as anon_individual,
  has_function_privilege('authenticated',
    'public.purchase_feature_unlock(uuid,text)', 'execute') as auth_individual;

-- 5. At most one active collective subscription per user.
--    Expected: no rows. Rows here block the unique index
--    user_subscriptions_one_active_idx; keep the row that expires last and
--    set the others to 'cancelled', then replay migration 20260924.
select user_id, count(*) as active_rows,
       array_agg(plan_slug order by expires_at desc nulls first) as plans
from public.user_subscriptions
where status = 'active'
group by user_id
having count(*) > 1;

-- 6. Individual vs collective, for one account and one feature.
--    Replace the uuid and the key. `source` is one of
--    free | admin | individual | collective | none.
-- select public.user_feature_entitlement(
--   '00000000-0000-0000-0000-000000000000'::uuid,
--   'tableaux-oracle'
-- );
