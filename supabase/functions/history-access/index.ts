/*
 * Cidmap historical archives.
 *
 * The free window and the token cost are configured in
 * public.feature_access_rules using the history-* feature keys. The existing
 * subscription-access purchase_feature_unlock RPC then creates the timed
 * user_feature_unlocks grant; this function only decides which dates may be
 * read and returns the selected archive.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

const HISTORY_KEYS = Object.freeze({
  results: 'historique-resultats',
  cross: 'historique-croix',
  matrix: 'historique-matrice',
  rejected: 'historique-rejetees'
});

const DOMAIN_LABELS = Object.freeze({
  results: 'Résultats',
  cross: 'Croix nationale',
  matrix: 'Matrices',
  rejected: 'Boules rejetées'
});

const json = (body: unknown, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: corsHeaders }
);

function client() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Configuration Supabase serveur incomplète.');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function authenticate(db: any, request: Request) {
  const token = request.headers.get('Authorization')
    ?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const result = await db.auth.getUser(token);
  return result.error ? null : result.data?.user || null;
}

function validDate(value: unknown) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const parsed = new Date(`${date}T12:00:00.000Z`);
  return Number.isNaN(parsed.getTime())
    ? ''
    : parsed.toISOString().slice(0, 10) === date ? date : '';
}

function todayInAbidjan() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Abidjan',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const part = (type: string) =>
    String(parts.find((item) => item.type === type)?.value || '').padStart(2, '0');
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function addDays(dateText: string, amount: number) {
  const date = new Date(`${dateText}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function domainKey(value: unknown) {
  const domain = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(HISTORY_KEYS, domain)
    ? domain as keyof typeof HISTORY_KEYS
    : null;
}

function ruleKeyFor(domain: keyof typeof HISTORY_KEYS) {
  return HISTORY_KEYS[domain];
}

function missingRuleTable(error: any) {
  return /feature_access_rules|history_free_days|relation .* does not exist|column .* does not exist|schema cache/i
    .test(String(error?.message || ''));
}

async function readRule(db: any, featureKey: string) {
  const result = await db.from('feature_access_rules')
    .select('feature_key,display_name,required_stars,unlock_currency,required_tokens,duration_days,history_free_days,plan_slug,enabled')
    .eq('feature_key', featureKey)
    .maybeSingle();
  if (result.error && missingRuleTable(result.error)) return null;
  if (result.error) throw result.error;
  return result.data || null;
}

async function readRules(db: any) {
  const result = await db.from('feature_access_rules')
    .select('feature_key,display_name,required_stars,unlock_currency,required_tokens,duration_days,history_free_days,plan_slug,enabled')
    .in('feature_key', Object.values(HISTORY_KEYS))
    .order('feature_key', { ascending: true });
  if (result.error && missingRuleTable(result.error)) return [];
  if (result.error) throw result.error;
  return result.data || [];
}

async function readAccess(db: any, user: any, featureKey: string, rule: any) {
  if (!user?.id) {
    return {
      authenticated: false,
      unlocked: false,
      administrator: false,
      subscription: null
    };
  }
  const now = new Date().toISOString();
  const [roles, subscription, unlock] = await Promise.all([
    db.from('user_roles').select('role').eq('user_id', user.id)
      .in('role', ['admin', 'moderator']).limit(1),
    db.from('user_subscriptions')
      .select('plan_slug,status,started_at,expires_at')
      .eq('user_id', user.id).eq('status', 'active')
      .lte('started_at', now)
      .or(`expires_at.is.null,expires_at.gt.${now}`).maybeSingle(),
    db.from('user_feature_unlocks')
      .select('feature_key,unlocked_at,expires_at')
      .eq('user_id', user.id)
      .in('feature_key', [featureKey, 'historique-tous'])
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('expires_at', { ascending: false, nullsFirst: true })
      .limit(2)
  ]);
  if (roles.error && !/user_roles|relation .* does not exist/i.test(String(roles.error.message || ''))) {
    throw roles.error;
  }
  if (subscription.error && !/user_subscriptions|relation .* does not exist/i.test(String(subscription.error.message || ''))) {
    throw subscription.error;
  }
  if (unlock.error && !/user_feature_unlocks|relation .* does not exist/i.test(String(unlock.error.message || ''))) {
    throw unlock.error;
  }
  const administrator = ['admin', 'moderator'].includes(String(roles.data?.[0]?.role || ''));
  let plan: any = null;
  if (subscription.data?.plan_slug) {
    const planResult = await db.from('subscription_plans')
      .select('slug,display_name,features,enabled')
      .eq('slug', subscription.data.plan_slug).maybeSingle();
    if (planResult.error && !/subscription_plans|relation .* does not exist/i.test(String(planResult.error.message || ''))) {
      throw planResult.error;
    }
    plan = planResult.data || null;
  }
  const features = Array.isArray(plan?.features)
    ? plan.features.map((value: unknown) => String(value || '').trim().toLowerCase())
    : [];
  const subscriptionCovers = Boolean(
    subscription.data
      && plan?.enabled !== false
      && (
        features.includes(featureKey)
        || features.includes('historique-tous')
        || (rule?.plan_slug && rule.plan_slug === plan.slug)
      )
  );
  return {
    authenticated: true,
    unlocked: administrator || Boolean((unlock.data || []).length) || subscriptionCovers,
    administrator,
    subscription: subscription.data
      ? {
        planSlug: subscription.data.plan_slug,
        planName: plan?.display_name || subscription.data.plan_slug,
        expiresAt: subscription.data.expires_at || null
      }
      : null,
    unlock: Array.isArray(unlock.data) ? unlock.data[0] || null : null
  };
}

function publicRule(rule: any, domain: string) {
  return {
    domain,
    featureKey: rule?.feature_key || ruleKeyFor(domain as keyof typeof HISTORY_KEYS),
    displayName: rule?.display_name || DOMAIN_LABELS[domain as keyof typeof DOMAIN_LABELS],
    enabled: rule?.enabled !== false,
    freeDays: Math.max(0, Number(rule?.history_free_days) || 0),
    requiredTokens: Math.max(0, Number(rule?.required_tokens) || 0),
    requiredStars: Math.max(0, Number(rule?.required_stars) || 0),
    currency: rule?.unlock_currency === 'stars' ? 'stars' : 'tokens',
    durationDays: Math.max(1, Number(rule?.duration_days) || 30)
  };
}

async function readArchivePages(buildQuery: () => any) {
  const rows: any[] = [];
  const pageSize = 1000;
  const maxRows = 10000;
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const result = await buildQuery().range(offset, offset + pageSize - 1);
    if (result.error) throw result.error;
    const page = Array.isArray(result.data) ? result.data : [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function searchArchive(db: any, domain: keyof typeof HISTORY_KEYS, from: string, to: string, countryCode: string) {
  if (domain === 'results') {
    return readArchivePages(() => {
      let query = db.from('resultat_aide_draws')
      .select('id,country_code,draw_date,draw_time,draw_number,first_numbers,machine_numbers,bonus_numbers,status,published_at')
      .eq('status', 'published').gte('draw_date', from).lte('draw_date', to)
      .order('draw_date', { ascending: false }).order('draw_time', { ascending: false });
      if (countryCode) query = query.eq('country_code', countryCode);
      return query;
    });
  }
  if (domain === 'cross') {
    return readArchivePages(() => db.from('croix_nationale_generations')
      .select('id,programme_date,generated_year,generated_month,scope_key,term,removed_digits,visible_terminaison,date_sum,date_digit_sum,date_finishing_digit,assignment,alignments,signature,created_at')
      .gte('programme_date', from).lte('programme_date', to)
      .order('programme_date', { ascending: false }));
  }
  if (domain === 'matrix') {
    return readArchivePages(() => db.from('daily_matrices')
      .select('programme_date,draw_number,results,created_at,updated_at')
      .gte('programme_date', from).lte('programme_date', to)
      .order('programme_date', { ascending: false }));
  }
  return readArchivePages(() => db.from('daily_rejected_balls')
    .select('programme_date,first_finish,second_finish,difference,finishes,groups,formatted_text,created_at,updated_at')
    .gte('programme_date', from).lte('programme_date', to)
    .order('programme_date', { ascending: false }));
}

async function handle(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);
  let body: any = {};
  try { body = await request.json(); } catch (_) {
    return json({ error: 'JSON invalide.' }, 400);
  }
  const db = client();
  const user = await authenticate(db, request);
  const action = String(body.action || 'state').trim().toLowerCase();
  try {
    if (action === 'state') {
      const rules = await readRules(db);
      const domains = await Promise.all(Object.keys(HISTORY_KEYS).map(async (domain) => {
        const typedDomain = domain as keyof typeof HISTORY_KEYS;
        const rule = rules.find((item: any) => item.feature_key === ruleKeyFor(typedDomain));
        const access = await readAccess(db, user, ruleKeyFor(typedDomain), rule);
        return {
          ...publicRule(rule, domain),
          access: {
            authenticated: access.authenticated,
            unlocked: access.unlocked,
            expiresAt: access.unlock?.expires_at || access.subscription?.expiresAt || null
          }
        };
      }));
      return json({ ok: true, domains });
    }
    if (action !== 'search') return json({ error: 'Action historique inconnue.' }, 400);
    const domain = domainKey(body.domain);
    if (!domain) return json({ error: 'Domaine historique invalide.' }, 400);
    const featureKey = ruleKeyFor(domain);
    const rule = await readRule(db, featureKey);
    if (!rule || rule.enabled === false) {
      return json({ ok: false, configured: false, error: 'Cet historique n’est pas encore configuré par l’administration.' });
    }
    const access = await readAccess(db, user, featureKey, rule);
    const today = todayInAbidjan();
    const freeFrom = addDays(today, -(Math.max(0, Number(rule.history_free_days) || 0)));
    const from = validDate(body.fromDate) || freeFrom;
    const to = validDate(body.toDate) || today;
    if (!from || !to || from > to) return json({ error: 'Période historique invalide.' }, 400);
    const configuredFree = !rule.plan_slug
      && Number(rule.required_tokens || 0) <= 0
      && Number(rule.required_stars || 0) <= 0;
    if (from < freeFrom && !access.unlocked && !configuredFree) {
      return json({
        ok: false,
        requiresUnlock: true,
        domain,
        featureKey,
        rule: publicRule(rule, domain),
        cutoffDate: freeFrom,
        access: {
          authenticated: access.authenticated,
          unlocked: false
        }
      });
    }
    const rows = await searchArchive(db, domain, from, to, String(body.countryCode || '').trim().toUpperCase());
    return json({
      ok: true,
      domain,
      label: DOMAIN_LABELS[domain],
      from,
      to,
      unlocked: access.unlocked,
      rows
    });
  } catch (error) {
    console.error('history-access failed', error);
    return json({ error: error instanceof Error ? error.message : 'Historique indisponible.' }, 500);
  }
}

Deno.serve(handle);
