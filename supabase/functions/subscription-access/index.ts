import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type SupabaseClient = any;
type AuthenticatedUser = { id: string; email?: string | null };
type AuthContext = { client: SupabaseClient; user: AuthenticatedUser };

const MAX_STARS = 1_000_000;
const INDIVIDUAL_FEATURE_PATTERN = /^[a-z][a-z0-9_-]{1,59}$/;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders
  });
}

function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) {
    throw new Error('Configuration Supabase serveur incomplète.');
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function bearerToken(request: Request) {
  return request.headers
    .get('Authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim() || '';
}

async function authenticate(request: Request): Promise<AuthContext | null> {
  const token = bearerToken(request);
  if (!token) return null;

  const client = serviceClient();
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user?.id) return null;

  return {
    client,
    user: {
      id: data.user.id,
      email: data.user.email || null
    }
  };
}

const COUNTRY_CODES: Record<string, string> = {
  CI: 'Côte d’Ivoire',
  BJ: 'Bénin',
  NE: 'Niger',
  GH: 'Ghana',
  GN: 'Guinée',
  SN: 'Sénégal',
  TG: 'Togo',
  DEFAULT: 'Autre pays'
};

function normalizeCountry(value: unknown) {
  const code = String(value || '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(COUNTRY_CODES, code)
    ? code
    : 'DEFAULT';
}

function normalizeAction(value: unknown) {
  return String(value || 'state')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeFeatureKey(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

/*
 * Individual and collective purchases are two distinct commands backed by
 * two distinct SQL functions:
 *   individual -> purchase_feature_unlock(target_user_id, target_feature_key)
 *                 one timed grant in user_feature_unlocks
 *   collective -> purchase_subscription_plan(target_user_id, target_plan_slug,
 *                 target_duration_months, target_renewal)
 *                 one row in user_subscriptions covering every feature of
 *                 the plan (`tableaux` covers every tableaux-* key)
 * A request that declares the other type, or sends the other identifier, is
 * rejected explicitly instead of being looked up in the wrong catalogue.
 */
type PurchaseType = 'individual' | 'collective';

function purchaseTypeMismatch(
  input: Record<string, unknown>,
  expected: PurchaseType
) {
  const declared = String(input.purchaseType || input.purchase_type || '')
    .trim()
    .toLowerCase();
  if (declared && declared !== expected) return true;
  if (expected === 'individual') {
    return !input.featureKey && Boolean(input.planSlug || input.plan_slug);
  }
  return !(input.planSlug || input.plan_slug) && Boolean(input.featureKey);
}

function isAmbiguousFunction(error: any) {
  return String(error?.code || '') === 'PGRST203'
    || String(error?.code || '') === '42725'
    || /could not choose the best candidate function|is not unique/i
      .test(String(error?.message || ''));
}

function planIncludesFeature(plan: any, featureKey: string) {
  const wanted = normalizeFeatureKey(featureKey);
  const features = Array.isArray(plan?.features)
    ? plan.features.map(normalizeFeatureKey)
    : [];
  return features.includes(wanted)
    || (
      wanted.startsWith('tableaux-')
      && features.includes('tableaux')
    );
}

function hasFeatureAccess(
  access: any,
  featureKey: string
) {
  const wanted = normalizeFeatureKey(featureKey);
  const grant = (access?.featureUnlocks || []).find((item: any) => (
    normalizeFeatureKey(item?.feature_key || item?.featureKey) === wanted
    && (
      !item?.expires_at
      || Date.parse(item.expires_at) > Date.now()
    )
  ));

  if (grant) return true;

  const plans = Array.isArray(access?.plans) ? access.plans : [];
  const rule = (access?.rules || []).find((item: any) => (
    normalizeFeatureKey(item?.feature_key || item?.featureKey) === wanted
  ));
  const configuredInOffer = plans.some((plan: any) =>
    planIncludesFeature(plan, wanted)
  );

  if (!rule && !configuredInOffer) return true;

  const requiredStars = Number(rule?.required_stars || 0);
  const requiredTokens = Number(rule?.required_tokens || 0);
  if (
    rule
    && !rule.plan_slug
    && requiredStars <= 0
    && requiredTokens <= 0
    && !configuredInOffer
  ) {
    return true;
  }

  const subscription = access?.subscription;
  if (
    !subscription
    || subscription.status !== 'active'
    || (
      subscription.started_at
      && Date.parse(subscription.started_at) > Date.now()
    )
    || (
      subscription.expires_at
      && Date.parse(subscription.expires_at) <= Date.now()
    )
  ) {
    return false;
  }

  return planIncludesFeature(access.activePlan, wanted)
    || Boolean(
      rule?.plan_slug
      && rule.plan_slug === access.activePlan?.slug
    );
}

function isIsoDate(value: unknown) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;

  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === date;
}

function currentProgrammeDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Abidjan',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const part = (type: string) =>
    Number(parts.find((item) => item.type === type)?.value);
  return {
    date: new Date(Date.UTC(
      part('year'),
      part('month') - 1,
      part('day') + (part('hour') >= 16 ? 1 : 0),
      12
    )),
    hour: part('hour')
  };
}

function earlyAccessDayOffset(programmeDate: string, now = new Date()) {
  const current = currentProgrammeDate(now);
  const requested = new Date(`${programmeDate}T12:00:00.000Z`);
  if (Number.isNaN(requested.getTime())) return null;
  return Math.floor(
    (requested.getTime() - current.date.getTime()) / 86400000
  );
}

function earlyAccessTokenCost(rule: any, days: number) {
  // Anticipation is never a free unlock. Keep legacy zero-valued rows from
  // confirming successfully without debiting the user's token balance.
  const one = Math.max(1, Number(rule?.token_cost_1_day ?? rule?.required_tokens) || 1);
  const two = Math.max(2, Number(rule?.token_cost_2_days ?? (one * 2)) || (one * 2));
  const three = Math.max(3, Number(rule?.token_cost_3_days ?? (one * 3)) || (one * 3));
  return days === 3 ? three : days === 2 ? two : one;
}

function addIsoDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateInAbidjan(value: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Abidjan',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(value));
  const part = (type: string) =>
    String(parts.find((item) => item.type === type)?.value || '').padStart(2, '0');
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function entitlementEndDate(access: any, featureKey: string) {
  const wanted = normalizeFeatureKey(featureKey);
  const rule = (access?.rules || []).find((item: any) => (
    normalizeFeatureKey(item?.feature_key || item?.featureKey) === wanted
  ));
  const plans = Array.isArray(access?.plans) ? access.plans : [];
  const configuredInOffer = plans.some((plan: any) =>
    planIncludesFeature(plan, wanted)
  );
  if (!rule && !configuredInOffer) return null;

  const dates: string[] = [];
  const grant = (access?.featureUnlocks || []).find((item: any) => (
    normalizeFeatureKey(item?.feature_key || item?.featureKey) === wanted
    && (!item?.expires_at || Date.parse(item.expires_at) > Date.now())
  ));
  if (grant) {
    if (!grant.expires_at) return null;
    dates.push(dateInAbidjan(grant.expires_at));
  }

  const subscription = access?.subscription;
  if (subscription && subscription.status === 'active'
      && (
        planIncludesFeature(access.activePlan, wanted)
        || Boolean(
          rule?.plan_slug
          && rule.plan_slug === access.activePlan?.slug
        )
      )) {
    if (!subscription.expires_at) return null;
    dates.push(dateInAbidjan(subscription.expires_at));
  }
  return dates.filter(Boolean).sort().at(-1) || '';
}

function paymentMethod(value: unknown) {
  const method = String(value || '').trim().toLowerCase();
  return method === 'manual' || method === 'online' ? method : 'manual';
}

function missingRelation(error: any, relation: string) {
  return String(error?.code || '') === '42P01'
    || new RegExp(`${relation}|relation .* does not exist`, 'i')
      .test(String(error?.message || ''));
}

const EARLY_ACCESS_RULE_COLUMNS = [
  'feature_key',
  'display_name',
  'enabled',
  'early_hour',
  'required_tokens',
  'duration_days',
  'preview_days',
  'token_cost_1_day',
  'token_cost_2_days',
  'token_cost_3_days'
].join(',');

const LEGACY_EARLY_ACCESS_RULE_COLUMNS = [
  'feature_key',
  'display_name',
  'enabled',
  'early_hour',
  'required_tokens',
  'duration_days'
].join(',');

function missingEarlyAccessColumns(error: any) {
  return /preview_days|token_cost_[123]_day|column .* does not exist|schema cache/i
    .test(String(error?.message || ''));
}

function addLegacyEarlyAccessDefaults(rows: any) {
  return (rows || []).map((row: any) => {
    const one = Math.max(0, Number(row.required_tokens) || 0);
    return {
      ...row,
      preview_days: 1,
      token_cost_1_day: one,
      token_cost_2_days: one * 2,
      token_cost_3_days: one * 3
    };
  });
}

async function readEarlyAccessRules(
  client: SupabaseClient,
  featureKey: string | null = null
) {
  let query = client
    .from('feature_early_access_rules')
    .select(EARLY_ACCESS_RULE_COLUMNS);
  query = featureKey
    ? query.eq('feature_key', featureKey).maybeSingle()
    : query.order('feature_key', { ascending: true });
  const result = await query;
  if (!result.error || !missingEarlyAccessColumns(result.error)) return result;

  let legacyQuery = client
    .from('feature_early_access_rules')
    .select(LEGACY_EARLY_ACCESS_RULE_COLUMNS);
  legacyQuery = featureKey
    ? legacyQuery.eq('feature_key', featureKey).maybeSingle()
    : legacyQuery.order('feature_key', { ascending: true });
  const legacy = await legacyQuery;
  if (legacy.error) return legacy;
  return {
    data: featureKey
      ? (legacy.data ? addLegacyEarlyAccessDefaults([legacy.data])[0] : null)
      : addLegacyEarlyAccessDefaults(legacy.data),
    error: null
  };
}

async function readPaymentSettings(client: SupabaseClient) {
  /*
   * `payment_settings` was extended in several migrations. The access
   * function must keep working while an installation is being upgraded:
   * selecting a column that is not in the current schema makes PostgREST
   * reject the whole query, which used to turn the wallet into a generic
   * "Edge Function returned a non-2xx status code" screen.
   */
  const defaults = {
    payment_mode: 'manual',
    online_provider: '',
    online_payment_link: '',
    physical_instructions: '',
    contact_label: '',
    manual_enabled: true,
    currency_mode: 'both',
    contact_channel: 'chat',
    whatsapp_number: '',
    chat_label: 'Contacter l’équipe',
    social_links: []
  };
  const columnSets = [
    'payment_mode,online_provider,online_payment_link,physical_instructions,contact_label,manual_enabled,currency_mode,contact_channel,whatsapp_number,chat_label,social_links',
    'payment_mode,online_provider,online_payment_link,physical_instructions,contact_label,manual_enabled,currency_mode,contact_channel,whatsapp_number,chat_label',
    'payment_mode,online_provider,online_payment_link,physical_instructions,contact_label,manual_enabled',
  ];
  let lastResult: any = null;

  for (const columns of columnSets) {
    const result = await client
      .from('payment_settings')
      .select(columns)
      .eq('id', 1)
      .maybeSingle();
    if (!result.error) {
      return {
        ...result,
        data: result.data ? { ...defaults, ...result.data } : null
      };
    }
    lastResult = result;
    if (!/column .* does not exist|schema cache|payment_settings/i
      .test(String(result.error.message || ''))) {
      return result;
    }
  }

  // A missing payment table should not prevent the public catalogue from
  // loading. The administrator can still create it and configure payment
  // later; until then the safe mode is manual/offline.
  if (lastResult?.error && missingRelation(lastResult.error, 'payment_settings')) {
    return { data: null, error: null };
  }
  return lastResult || { data: null, error: null };
}

async function readPromoBanners(client: SupabaseClient) {
  let result = await client
    .from('promo_banners')
    .select('id,country_code,placement,title,description,title_i18n,description_i18n,feature_key,key_value,image_url,target_url,action_label,action_label_i18n,sort_order,starts_at,ends_at,enabled')
    .eq('enabled', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (result.error && /column .* does not exist|schema cache/i.test(String(result.error.message || ''))) {
    result = await client
      .from('promo_banners')
      .select('id,country_code,placement,title,description,feature_key,key_value,image_url,target_url,action_label,sort_order,starts_at,ends_at,enabled')
      .eq('enabled', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });
  }
  if (result.error) {
    if (missingRelation(result.error, 'promo_banners')) return [];
    throw result.error;
  }
  const now = Date.now();
  return (result.data || []).filter((banner: any) => {
    const starts = banner.starts_at ? Date.parse(banner.starts_at) : NaN;
    const ends = banner.ends_at ? Date.parse(banner.ends_at) : NaN;
    return (!Number.isFinite(starts) || starts <= now)
      && (!Number.isFinite(ends) || ends > now);
  });
}

const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;

function normalizeLocale(value: unknown) {
  const raw = String(value || '').trim();
  if (!LOCALE_PATTERN.test(raw)) return 'fr';
  return raw;
}

function missingLocalizationTables(error: any) {
  return missingRelation(error, 'supported_locales')
    || missingRelation(error, 'country_languages')
    || missingRelation(error, 'translation_entries')
    || missingRelation(error, 'user_language_preferences');
}

function isValidLocaleCode(value: unknown) {
  return LOCALE_PATTERN.test(String(value || '').trim());
}

async function readUserLocale(
  client: SupabaseClient,
  userId: string | null | undefined
) {
  if (!userId) return '';
  const result = await client
    .from('user_language_preferences')
    .select('locale_code')
    .eq('user_id', userId)
    .maybeSingle();
  if (result.error) {
    if (missingLocalizationTables(result.error)) return '';
    throw result.error;
  }
  return String(result.data?.locale_code || '').trim();
}

async function readLocalization(
  client: SupabaseClient,
  requestedLocale = 'fr',
  userId: string | null = null
) {
  const [locales, countries, preference] = await Promise.all([
    client
      .from('supported_locales')
      .select('code,display_name,native_name,direction,enabled,catalog_ready,is_default,sort_order')
      .eq('enabled', true)
      .order('sort_order', { ascending: true })
      .order('code', { ascending: true }),
    client
      .from('country_languages')
      .select('country_code,locale_code,language_role,priority,enabled')
      .eq('enabled', true)
      .order('country_code', { ascending: true })
      .order('priority', { ascending: true }),
    readUserLocale(client, userId)
  ]);

  const localeRows = locales.error ? [] : (locales.data || []);
  const requestedCode = normalizeLocale(preference || requestedLocale);
  const locale = localeRows.find((item: any) => item.code === requestedCode)?.code
    || localeRows.find((item: any) => item.is_default)?.code
    || localeRows.find((item: any) => item.code === 'fr')?.code
    || 'fr';
  const entries = await client
    .from('translation_entries')
    .select('locale_code,translation_key,translation_value,context')
    .eq('locale_code', locale);
  const relevantError = [locales, countries, entries]
    .find((result: any) => result.error && !missingLocalizationTables(result.error))
    ?.error;
  if (relevantError) throw relevantError;

  const countryRows = countries.error ? [] : (countries.data || []);
  const entryRows = entries.error ? [] : (entries.data || []);
  const activeLocale = localeRows.find((item: any) => item.code === locale)
    || localeRows.find((item: any) => item.is_default)
    || localeRows.find((item: any) => item.code === 'fr')
    || null;
  const translations = entryRows.reduce((result: Record<string, string>, item: any) => {
    result[String(item.translation_key)] = String(item.translation_value || '');
    return result;
  }, {});

  return {
    locales: localeRows,
    countryLanguages: countryRows,
    selectedLocale: activeLocale?.code || 'fr',
    userLocaleCode: preference || null,
    defaultLocale: localeRows.find((item: any) => item.is_default)?.code || 'fr',
    translations
  };
}

async function setUserLocale(
  context: AuthContext,
  requestedLocale: unknown
) {
  const localeCode = String(requestedLocale || '').trim();
  if (!isValidLocaleCode(localeCode)) {
    return json({ error: 'Code de langue invalide.' }, 400);
  }
  const available = await context.client
    .from('supported_locales')
    .select('code')
    .eq('code', localeCode)
    .eq('enabled', true)
    .maybeSingle();
  if (available.error) throw available.error;
  if (!available.data?.code) {
    return json({ error: 'Cette langue n’est pas disponible.' }, 400);
  }
  const saved = await context.client
    .from('user_language_preferences')
    .upsert({
      user_id: context.user.id,
      locale_code: localeCode,
      detection_source: 'manual',
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' })
    .select('user_id,locale_code,updated_at')
    .single();
  if (saved.error) throw saved.error;
  return json({ ok: true, localeCode: saved.data.locale_code });
}

async function expireSubscriptions(client: SupabaseClient, userId: string, now: string) {
  const result = await client
    .from('user_subscriptions')
    .update({ status: 'expired', updated_at: now })
    .eq('user_id', userId)
    .eq('status', 'active')
    .not('expires_at', 'is', null)
    .lte('expires_at', now);

  if (result.error) throw result.error;
}

async function readUserMetrics(client: SupabaseClient, userId: string) {
  // `tokens` was added by SUPABASE_ADMIN_CONTROLS_PATCH.sql. During a
  // rolling migration the account must still load its configured prices and
  // star balance, so fall back to the pre-token columns and expose a zero
  // token balance until the migration is applied.
  let result = await client
    .from('user_metrics')
    .select('stars,tokens,share_count')
    .eq('user_id', userId)
    .maybeSingle();
  if (result.error && /tokens|column .* does not exist|schema cache/i
    .test(String(result.error.message || ''))) {
    result = await client
      .from('user_metrics')
      .select('stars,share_count')
      .eq('user_id', userId)
      .maybeSingle();
    if (!result.error && result.data) result.data.tokens = 0;
  }
  if (result.error) throw result.error;
  return result;
}

const ACCESS_PLAN_COLUMNS = 'slug,display_name,required_stars,unlock_currency,required_tokens,regular_tokens,promotion_enabled,promotion_label,promotion_ends_at,duration_days,referral_reward_stars,referral_reward_tokens,payment_mode,price_label,features,enabled';
const LEGACY_ACCESS_PLAN_COLUMNS = 'slug,display_name,required_stars,unlock_currency,required_tokens,promotion_enabled,promotion_label,promotion_ends_at,duration_days,referral_reward_stars,payment_mode,price_label,features,enabled';

async function readAccessPlans(client: SupabaseClient) {
  const current = await client
    .from('subscription_plans')
    .select(ACCESS_PLAN_COLUMNS)
    .order('required_stars', { ascending: true });
  if (!current.error) return current;
  if (!/regular_tokens|column .* does not exist|schema cache/i
    .test(String(current.error.message || ''))) {
    return current;
  }

  const legacy = await client
    .from('subscription_plans')
    .select(LEGACY_ACCESS_PLAN_COLUMNS)
    .order('required_stars', { ascending: true });
  if (legacy.error) return legacy;
  return {
    ...legacy,
    data: (legacy.data || []).map((plan: any) => ({
      ...plan,
      regular_tokens: Number(plan.regular_tokens ?? plan.required_tokens) || 0
    }))
  };
}

async function accessState(
  client: SupabaseClient,
  userId: string,
  requestedCountry = 'DEFAULT',
  requestedLocale = 'fr',
  includeHistory = true
) {
  const selectedCountry = normalizeCountry(requestedCountry);
  const now = new Date().toISOString();
  // The purchase history (six tables) is only displayed by the account page.
  // The catalogue/entitlement call made on navigation passes
  // includeHistory: false and skips those reads entirely.
  const skippedHistory = Promise.resolve({ data: [], error: null });

  await expireSubscriptions(client, userId, now);

  const [
    metrics,
    plans,
    rules,
    subscription,
    grants,
    spends,
    tokenGrants,
    tokenSpends,
    requests,
    prices,
    tokenPrices,
    settings,
    featureUnlocks,
    featureUnlockSpends,
    earlyAccessRules,
    earlyAccessUnlocks,
    earlyAccessGrants
  ] = await Promise.all([
    readUserMetrics(client, userId),
    readAccessPlans(client),
    client
      .from('feature_access_rules')
      .select('feature_key,display_name,required_stars,unlock_currency,required_tokens,duration_days,history_free_days,plan_slug,enabled')
      .order('display_name', { ascending: true }),
    client
      .from('user_subscriptions')
      .select('id,plan_slug,status,started_at,expires_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .lte('started_at', now)
      .maybeSingle(),
    includeHistory
      ? client
        .from('star_grants')
        .select('amount,payment_method,note,created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30)
      : skippedHistory,
    includeHistory
      ? client
        .from('star_spends')
        .select('amount,plan_slug,plan_name,created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30)
      : skippedHistory,
    includeHistory
      ? client
        .from('token_grants')
        .select('amount,payment_method,note,created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30)
      : skippedHistory,
    includeHistory
      ? client
        .from('token_spends')
        .select('amount,plan_slug,plan_name,created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30)
      : skippedHistory,
    includeHistory
      ? client
        .from('payment_requests')
        .select('id,stars_requested,country_code,currency_code,unit_price,total_price,status,created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30)
      : skippedHistory,
    client
      .from('star_prices')
      .select('country_code,country_name,currency_code,currency_symbol,price_per_star,enabled')
      .eq('enabled', true)
      .order('country_code', { ascending: true }),
    client
      .from('token_prices')
      .select('pack_id,name,quantity,price_xof')
      .order('pack_id', { ascending: true }),
    readPaymentSettings(client),
    client
      .from('user_feature_unlocks')
      .select('feature_key,unlocked_at,expires_at')
      .eq('user_id', userId)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('feature_key', { ascending: true }),
    includeHistory
      ? client
        .from('feature_unlock_spends')
        .select('feature_key,feature_name,currency,amount,created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30)
      : skippedHistory,
    readEarlyAccessRules(client),
    client
      .from('user_feature_early_access')
      .select('feature_key,programme_date,unlocked_at,expires_at')
      .eq('user_id', userId)
      .order('programme_date', { ascending: false })
      .limit(500)
    ,
    client
      .from('user_feature_early_access_grants')
      .select('feature_key,days,unlocked_at,expires_at')
      .eq('user_id', userId)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('feature_key', { ascending: true })
  ]);
  const localization = await readLocalization(client, requestedLocale, userId);
  const banners = await readPromoBanners(client);

  const tokenTablesMissing = missingRelation(tokenGrants.error, 'token_grants')
    || missingRelation(tokenSpends.error, 'token_spends');
  for (const result of [metrics, plans, rules, subscription, grants, spends, requests, prices, settings]) {
    if (result.error) throw result.error;
  }
  if (tokenGrants.error && !tokenTablesMissing) throw tokenGrants.error;
  if (tokenSpends.error && !tokenTablesMissing) throw tokenSpends.error;
  const featureUnlocksMissing = featureUnlocks.error
    && missingRelation(featureUnlocks.error, 'user_feature_unlocks');
  if (featureUnlocks.error && !featureUnlocksMissing) throw featureUnlocks.error;
  const featureUnlockSpendsMissing = featureUnlockSpends.error
    && missingRelation(featureUnlockSpends.error, 'feature_unlock_spends');
  if (featureUnlockSpends.error && !featureUnlockSpendsMissing) {
    throw featureUnlockSpends.error;
  }
  const earlyAccessRulesMissing = earlyAccessRules.error
    && missingRelation(
      earlyAccessRules.error,
      'feature_early_access_rules'
    );
  const earlyAccessUnlocksMissing = earlyAccessUnlocks.error
    && missingRelation(
      earlyAccessUnlocks.error,
      'user_feature_early_access'
    );
  const earlyAccessGrantsMissing = earlyAccessGrants.error
    && missingRelation(
      earlyAccessGrants.error,
      'user_feature_early_access_grants'
    );
  if (earlyAccessRules.error && !earlyAccessRulesMissing) {
    throw earlyAccessRules.error;
  }
  if (earlyAccessUnlocks.error && !earlyAccessUnlocksMissing) {
    throw earlyAccessUnlocks.error;
  }
  if (earlyAccessGrants.error && !earlyAccessGrantsMissing) {
    throw earlyAccessGrants.error;
  }

  const priceRows = prices.data || [];
  const selectedPrice = priceRows.find(
    (item: any) => item.country_code === selectedCountry
  ) || priceRows.find(
    (item: any) => item.country_code === 'DEFAULT'
  ) || null;
  // Token pricing was added by a later migration. Keep the balance endpoint
  // usable on older installations until that migration is applied.
  const tokenTableMissing = tokenPrices.error
    && (String(tokenPrices.error.code || '') === '42P01'
      || /token_prices|relation .* does not exist|column .* does not exist|schema cache/i
        .test(String(tokenPrices.error.message || '')));
  if (tokenPrices.error && !tokenTableMissing) throw tokenPrices.error;
  const tokenPriceRows = tokenTableMissing ? [] : (tokenPrices.data || []);
  const selectedTokenPrice = tokenPriceRows[0] || null;
  const allPlans = plans.data || [];
  const enabledPlanSlugs = new Set(
    allPlans
      .filter((plan: any) => plan.enabled !== false)
      .map((plan: any) => plan.slug)
  );
  const activePlan = allPlans.find(
    (plan: any) => plan.slug === subscription.data?.plan_slug
  ) || null;
  // An access rule linked to an offer that the administrator disabled must
  // not keep the corresponding feature locked forever. `enabled` controls
  // the public catalogue and therefore the effective rules returned to the
  // browser as well.
  const effectiveRules = (rules.data || []).filter((rule: any) => (
    rule.enabled !== false
    && (!rule.plan_slug || enabledPlanSlugs.has(rule.plan_slug))
  ));
  const effectiveSubscription = activePlan ? subscription.data : null;

  return {
    stars: Number(metrics.data?.stars || 0),
    tokens: Number(metrics.data?.tokens || 0),
    shareCount: Number(metrics.data?.share_count || 0),
    plans: allPlans.filter((plan: any) => plan.enabled !== false),
    rules: effectiveRules,
    subscription: effectiveSubscription,
    activePlan,
    expiresAt: effectiveSubscription?.expires_at || null,
    countryCode: selectedCountry,
    starPrices: priceRows,
    starPricing: selectedPrice,
    tokenPrices: tokenPriceRows,
    tokenPricing: selectedTokenPrice,
    settings: settings.data || null,
    localization,
    banners,
    featureUnlocks: featureUnlocksMissing ? [] : (featureUnlocks.data || []),
    earlyAccessRules: earlyAccessRulesMissing
      ? []
      : (earlyAccessRules.data || []),
    earlyAccessUnlocks: earlyAccessUnlocksMissing
      ? []
      : (earlyAccessUnlocks.data || []),
    earlyAccessGrants: earlyAccessGrantsMissing
      ? []
      : (earlyAccessGrants.data || []),
    history: {
      grants: grants.data || [],
      spends: spends.data || [],
      tokenGrants: tokenTablesMissing ? [] : (tokenGrants.data || []),
      tokenSpends: tokenTablesMissing ? [] : (tokenSpends.data || []),
      featureUnlockSpends: featureUnlockSpendsMissing
        ? []
        : (featureUnlockSpends.data || []),
      requests: requests.data || []
    }
  };
}

/*
 * Lecture publique du catalogue d'accès.
 *
 * Un visiteur non connecté peut voir les offres et les règles actives, mais
 * ne reçoit jamais de solde, d'abonnement ou d'historique privé.
 */
async function publicAccessState(
  client: SupabaseClient,
  requestedLocale = 'fr'
) {
  const [plans, rules, earlyAccessRules, tokenPrices, starPrices, settings] = await Promise.all([
    readAccessPlans(client),
    client
      .from('feature_access_rules')
      .select(
        'feature_key,display_name,required_stars,unlock_currency,required_tokens,duration_days,history_free_days,plan_slug,enabled'
      )
      .order('display_name', { ascending: true }),
    readEarlyAccessRules(client),
    client
      .from('token_prices')
      .select('pack_id,name,quantity,price_xof')
      .order('pack_id', { ascending: true }),
    client
      .from('star_prices')
      .select('country_code,country_name,currency_code,currency_symbol,price_per_star,enabled')
      .eq('enabled', true)
      .order('country_code', { ascending: true }),
    readPaymentSettings(client)
  ]);

  if (plans.error) throw plans.error;
  if (rules.error) throw rules.error;
  if (starPrices.error) throw starPrices.error;
  if (settings.error) throw settings.error;
  const earlyAccessRulesMissing = earlyAccessRules.error
    && missingRelation(
      earlyAccessRules.error,
      'feature_early_access_rules'
    );
  if (earlyAccessRules.error && !earlyAccessRulesMissing) {
    throw earlyAccessRules.error;
  }
  const tokenPricesMissing = tokenPrices.error
    && (missingRelation(tokenPrices.error, 'token_prices')
      || /token_prices|column .* does not exist|schema cache/i
        .test(String(tokenPrices.error.message || '')));
  if (tokenPrices.error && !tokenPricesMissing) throw tokenPrices.error;

  const allPlans = plans.data || [];
  const enabledPlanSlugs = new Set(
    allPlans
      .filter((plan: any) => plan.enabled !== false)
      .map((plan: any) => plan.slug)
  );
  const localization = await readLocalization(client, requestedLocale);
  const banners = await readPromoBanners(client);
  return {
    stars: 0,
    tokens: 0,
    plans: allPlans.filter((plan: any) => plan.enabled !== false),
    rules: (rules.data || []).filter((rule: any) => (
      rule.enabled !== false
      && (!rule.plan_slug || enabledPlanSlugs.has(rule.plan_slug))
    )),
    subscription: null,
    activePlan: null,
    expiresAt: null,
    starPrices: starPrices.data || [],
    settings: settings.data || null,
    localization,
    banners,
    featureUnlocks: [],
    earlyAccessRules: earlyAccessRulesMissing
      ? []
      : (earlyAccessRules.data || []),
    earlyAccessUnlocks: [],
    earlyAccessGrants: [],
    tokenPrices: tokenPricesMissing ? [] : (tokenPrices.data || [])
  };
}

/*
 * Renewal quote for an individual unlock (Débloquer / Prolonger).
 *
 * The server decides the new end date: the period is added to the latest
 * current end of this feature's access (individual grant or covering
 * collective plan), so a visitor who prolongs early never loses a remaining
 * day. The browser only displays this quote in the confirmation dialog.
 */
async function featureRenewalQuote(
  client: SupabaseClient,
  userId: string,
  featureKey: string
) {
  const now = new Date();
  const nowIso = now.toISOString();
  const [rules, grant, subscription, metrics] = await Promise.all([
    client
      .from('feature_access_rules')
      .select('feature_key,display_name,required_stars,unlock_currency,required_tokens,duration_days,plan_slug,enabled')
      .eq('feature_key', featureKey),
    client
      .from('user_feature_unlocks')
      .select('feature_key,expires_at')
      .eq('user_id', userId)
      .eq('feature_key', featureKey)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('expires_at', { ascending: false, nullsFirst: true })
      .limit(1),
    client
      .from('user_subscriptions')
      .select('plan_slug,status,started_at,expires_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .lte('started_at', nowIso)
      .maybeSingle(),
    readUserMetrics(client, userId)
  ]);
  if (rules.error) throw rules.error;
  if (metrics.error) throw metrics.error;
  const grantMissing = grant.error
    && missingRelation(grant.error, 'user_feature_unlocks');
  if (grant.error && !grantMissing) throw grant.error;
  if (subscription.error) throw subscription.error;

  const ruleRows = (rules.data || []).filter((rule: any) => rule.enabled !== false);
  const rule = ruleRows.find((item: any) => !item.plan_slug) || null;
  if (!rule) return null;
  const currency = rule.unlock_currency === 'stars' ? 'stars' : 'tokens';
  const cost = Math.max(0, Math.trunc(Number(
    currency === 'stars' ? rule.required_stars : rule.required_tokens
  ) || 0));
  const durationDays = Math.max(1, Math.trunc(Number(rule.duration_days) || 30));

  const activeGrant = grantMissing ? null : (grant.data || [])[0] || null;
  const unlimited = Boolean(activeGrant && !activeGrant.expires_at);
  const ends: number[] = [];
  if (activeGrant?.expires_at) ends.push(Date.parse(activeGrant.expires_at));

  const sub = subscription.data;
  if (sub?.plan_slug && sub.expires_at && Date.parse(sub.expires_at) > now.getTime()) {
    const plan = await client
      .from('subscription_plans')
      .select('slug,features,enabled')
      .eq('slug', sub.plan_slug)
      .maybeSingle();
    const covers = plan.data?.enabled !== false && (
      planIncludesFeature(plan.data, featureKey)
      || ruleRows.some((item: any) => item.plan_slug === sub.plan_slug)
    );
    if (covers) ends.push(Date.parse(sub.expires_at));
  }

  const currentEnd = ends.filter(Number.isFinite).sort((a, b) => b - a)[0];
  const base = currentEnd && currentEnd > now.getTime()
    ? new Date(currentEnd)
    : now;
  const next = new Date(base.getTime());
  next.setUTCDate(next.getUTCDate() + durationDays);

  return {
    featureKey,
    currency,
    cost,
    durationDays,
    balance: Number(
      currency === 'stars' ? metrics.data?.stars : metrics.data?.tokens
    ) || 0,
    renewal: Boolean(currentEnd && currentEnd > now.getTime()) || unlimited,
    unlimited,
    currentExpiry: currentEnd ? new Date(currentEnd).toISOString() : null,
    nextExpiry: unlimited ? null : next.toISOString()
  };
}

async function quoteFeatureUnlock(
  context: AuthContext,
  input: Record<string, unknown>
) {
  const featureKey = String(input.featureKey || '').trim().toLowerCase();
  if (!INDIVIDUAL_FEATURE_PATTERN.test(featureKey)) {
    return json({ error: 'Élément à débloquer invalide.' }, 400);
  }
  const quote = await featureRenewalQuote(context.client, context.user.id, featureKey);
  if (!quote) {
    return json({ error: 'Ce tableau n’a pas de déblocage individuel.' }, 404);
  }
  return json({ ok: true, quote });
}

async function unlockFeature(
  context: AuthContext,
  input: Record<string, unknown>
) {
  if (purchaseTypeMismatch(input, 'individual')) {
    return json({
      error: 'Un abonnement collectif s’achète avec son identifiant d’offre, pas comme un déblocage individuel.',
      code: 'WRONG_PURCHASE_TYPE',
      purchaseType: 'individual'
    }, 400);
  }
  const featureKey = String(input.featureKey || '').trim().toLowerCase();
  if (!INDIVIDUAL_FEATURE_PATTERN.test(featureKey)) {
    return json({ error: 'Élément à débloquer invalide.' }, 400);
  }

  // Quote taken before the debit: it fixes the end date the visitor saw in
  // the confirmation dialog (period added to the current end date).
  const quote = await featureRenewalQuote(
    context.client,
    context.user.id,
    featureKey
  ).catch(() => null);

  const purchase = await context.client.rpc('purchase_feature_unlock', {
    target_user_id: context.user.id,
    target_feature_key: featureKey
  });
  if (purchase.error) {
    const message = String(purchase.error.message || '');
    if (isAmbiguousFunction(purchase.error)) {
      console.error('purchase_feature_unlock overloads detected', purchase.error);
      return json({
        error: 'Service de déblocage en maintenance, veuillez réessayer dans un instant.',
        code: 'PURCHASE_FUNCTION_AMBIGUOUS'
      }, 503);
    }
    const insufficientTokens = message.match(/INSUFFICIENT_TOKENS:(\d+):(\d+)/);
    if (insufficientTokens) {
      return json({
        error: `Solde insuffisant : vous avez ${insufficientTokens[1]} jeton(s), il en faut ${insufficientTokens[2]}.`,
        code: 'INSUFFICIENT_TOKENS',
        currentTokens: Number(insufficientTokens[1]),
        requiredTokens: Number(insufficientTokens[2])
      }, 409);
    }
    const insufficientStars = message.match(/INSUFFICIENT_STARS:(\d+):(\d+)/);
    if (insufficientStars) {
      return json({
        error: `Solde insuffisant : vous avez ${insufficientStars[1]} étoile(s), il en faut ${insufficientStars[2]}.`,
        code: 'INSUFFICIENT_STARS',
        currentStars: Number(insufficientStars[1]),
        requiredStars: Number(insufficientStars[2])
      }, 409);
    }
    return json({ error: message || 'Déblocage impossible.' }, 400);
  }

  /*
   * The SQL command extends the individual grant only. When the feature was
   * also covered by a collective plan ending later, move the grant to the
   * quoted end date so no remaining day is lost by prolonging early.
   */
  let expiresAt: string | null = quote?.nextExpiry || null;
  if (quote?.nextExpiry) {
    const granted = await context.client
      .from('user_feature_unlocks')
      .select('expires_at')
      .eq('user_id', context.user.id)
      .eq('feature_key', featureKey)
      .order('expires_at', { ascending: false, nullsFirst: true })
      .limit(1);
    const grantedAt = (granted.data || [])[0]?.expires_at || null;
    if (!granted.error && grantedAt
      && Date.parse(grantedAt) < Date.parse(quote.nextExpiry)) {
      const extended = await context.client
        .from('user_feature_unlocks')
        .update({ expires_at: quote.nextExpiry })
        .eq('user_id', context.user.id)
        .eq('feature_key', featureKey);
      if (extended.error) {
        console.error('feature unlock end date alignment failed', extended.error);
        expiresAt = grantedAt;
      }
    } else if (!granted.error) {
      expiresAt = grantedAt;
    }
  }

  return json({
    ok: true,
    action: 'feature-unlocked',
    purchaseType: 'individual',
    unlock: purchase.data,
    expiresAt,
    // Keep the individual expiry in the response so the UI can explain the
    // hand-off when a global subscription later expires.
    access: await accessState(
      context.client,
      context.user.id,
      String(input.countryCode || ''),
      String(input.localeCode || '')
    )
  });
}

async function purchaseSubscription(
  context: AuthContext,
  input: Record<string, unknown>
) {
  if (purchaseTypeMismatch(input, 'collective')) {
    return json({
      error: 'Cet élément se débloque individuellement, pas par abonnement collectif.',
      code: 'WRONG_PURCHASE_TYPE',
      purchaseType: 'collective'
    }, 400);
  }
  const planSlug = String(input.planSlug || input.plan_slug || '')
    .trim()
    .toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(planSlug)) {
    return json({ error: 'Abonnement invalide.' }, 400);
  }

  /*
   * Always send the four named arguments of the unified SQL function. Even if
   * a stale two-argument overload survives on a database, this exact argument
   * set matches only one signature, so the call can never be ambiguous.
   * Duration and renewal stay server-decided (null = plan duration, automatic
   * renewal of the same plan): the browser cannot extend a paid period.
   */
  const purchase = await context.client.rpc('purchase_subscription_plan', {
    target_user_id: context.user.id,
    target_plan_slug: planSlug,
    target_duration_months: null,
    target_renewal: null
  });
  if (purchase.error) {
    const message = String(purchase.error.message || '');
    if (/PLAN_NOT_FOUND/.test(message)) {
      return json({
        error: 'Cette offre n’est plus disponible.',
        code: 'PLAN_NOT_FOUND'
      }, 404);
    }
    if (isAmbiguousFunction(purchase.error)) {
      console.error('purchase_subscription_plan overloads detected', purchase.error);
      return json({
        error: 'Service d’abonnement en maintenance, veuillez réessayer dans un instant.',
        code: 'PURCHASE_FUNCTION_AMBIGUOUS'
      }, 503);
    }
    const insufficientTokens = message.match(/INSUFFICIENT_TOKENS:(\d+):(\d+)/);
    if (insufficientTokens) {
      return json({
        error: `Solde insuffisant : vous avez ${insufficientTokens[1]} jeton(s), il en faut ${insufficientTokens[2]}.`,
        code: 'INSUFFICIENT_TOKENS',
        currentTokens: Number(insufficientTokens[1]),
        requiredTokens: Number(insufficientTokens[2])
      }, 409);
    }
    const insufficientStars = message.match(/INSUFFICIENT_STARS:(\d+):(\d+)/);
    if (insufficientStars) {
      return json({
        error: `Solde insuffisant : vous avez ${insufficientStars[1]} étoile(s), il en faut ${insufficientStars[2]}.`,
        code: 'INSUFFICIENT_STARS',
        currentStars: Number(insufficientStars[1]),
        requiredStars: Number(insufficientStars[2])
      }, 409);
    }
    return json({ error: message || 'Abonnement impossible.' }, 400);
  }

  /*
   * The current subscription RPC handles both currencies through the common
   * unlock:<filleul> event. Older databases do not return referralRewarded,
   * so keep the token RPC as a compatibility fallback for those installations.
   */
  let referralReward: unknown = null;
  if (purchase.data?.subscriptionId && purchase.data?.referralRewarded !== true) {
    const reward = await context.client.rpc('grant_referral_token_for_purchase', {
      subscription_id: purchase.data.subscriptionId
    });
    if (!reward.error) {
      referralReward = reward.data;
    } else if (!/grant_referral_token_for_purchase|function .* does not exist|column .* does not exist|schema cache/i
      .test(String(reward.error.message || ''))) {
      console.warn('referral token reward skipped', reward.error);
    }
  }

  return json({
    ok: true,
    action: 'subscription-purchased',
    purchaseType: 'collective',
    purchase: purchase.data,
    referralReward,
    access: await accessState(
      context.client,
      context.user.id,
      String(input.countryCode || ''),
      String(input.localeCode || '')
    )
  });
}

async function unlockEarlyAccess(
  context: AuthContext,
  input: Record<string, unknown>
) {
  const featureKey = String(input.featureKey || '').trim().toLowerCase();
  const programmeDate = String(input.programmeDate || '').trim();
  const requestedDays = Math.max(
    1,
    Math.min(3, Math.trunc(Number(input.days ?? input.targetDays) || 1))
  );
  if (!INDIVIDUAL_FEATURE_PATTERN.test(featureKey)
      || !isIsoDate(programmeDate)) {
    return json({ error: 'Publication anticipée invalide.' }, 400);
  }

  const earlyRule = await readEarlyAccessRules(context.client, featureKey);

  if (earlyRule.error) {
    if (missingRelation(earlyRule.error, 'feature_early_access_rules')) {
      return json({
        error: 'L’accès anticipé n’est pas configuré.'
      }, 403);
    }
    throw earlyRule.error;
  }

  const configuredRule = earlyRule.data?.enabled === true
    ? earlyRule.data
    : null;

  if (!configuredRule) {
    return json({
      error: 'Cette publication anticipée n’est pas activée.',
      code: 'EARLY_ACCESS_DISABLED',
      featureKey,
      programmeDate
    }, 403);
  }

  const now = new Date();
  const dayOffset = earlyAccessDayOffset(programmeDate, now);
  if (dayOffset === null || dayOffset <= 0) {
    return json({
      error: 'Choisissez une date future dans la fenêtre d’anticipation.',
      code: 'EARLY_ACCESS_DATE_INVALID',
      featureKey,
      programmeDate
    }, 400);
  }
  const previewDays = Math.max(
    1,
    Math.min(30, Number(configuredRule.preview_days) || 1)
  );
  if (
    dayOffset !== 1
    || requestedDays > previewDays
    || dayOffset + requestedDays - 1 > previewDays
  ) {
    return json({
      error: `Ce forfait dépasse la fenêtre de ${previewDays} jour(s) configurée par l’administration.`,
      code: 'EARLY_ACCESS_OUT_OF_RANGE',
      featureKey,
      programmeDate,
      previewDays,
      requestedDays
    }, 403);
  }

  /*
   * Early access is always an add-on to the base programme entitlement.
   * This applies to Tableaux, Croix, Matrice, Boules rejetées and custom
   * programmes alike. A free programme passes this check; a paid or
   * subscription-protected programme must be unlocked first.
   */
  const adminRole = await context.client
    .from('user_roles')
    .select('role')
    .eq('user_id', context.user.id)
    .eq('role', 'admin')
    .maybeSingle();

  if (adminRole.error && !missingRelation(adminRole.error, 'user_roles')) {
    throw adminRole.error;
  }

  const principal = await context.client
    .from('admin_control_settings')
    .select('principal_user_id')
    .eq('id', true)
    .limit(1)
    .maybeSingle();
  const isAdministrator = adminRole.data?.role === 'admin'
    || (!principal.error
      && principal.data?.principal_user_id === context.user.id);

  let access: any = null;
  if (!isAdministrator) {
    access = await accessState(
      context.client,
      context.user.id,
      String(input.countryCode || '')
    );

    if (!hasFeatureAccess(access, featureKey)) {
      return json({
        error: 'Débloquez d’abord cette section avant de l’anticiper.',
        code: 'PROGRAM_UNLOCK_REQUIRED',
        featureKey
      }, 403);
    }
  }

  if (access) {
    const entitlementEnd = entitlementEndDate(access, featureKey);
    const packageEnd = addIsoDays(programmeDate, requestedDays - 1);
    if (entitlementEnd && packageEnd > entitlementEnd) {
      let availableDays = 0;
      for (let days = 1; days <= requestedDays; days += 1) {
        if (addIsoDays(programmeDate, days - 1) > entitlementEnd) break;
        availableDays = days;
      }
      return json({
        error: availableDays > 0
          ? `Votre abonnement ou déblocage couvre seulement ${availableDays} jour(s) d’anticipation.`
          : 'Votre abonnement ou déblocage expire avant cette anticipation.',
        code: 'BASE_ACCESS_EXPIRES_BEFORE_PROGRAM',
        featureKey,
        programmeDate,
        requestedDays,
        availableDays,
        entitlementEndDate: entitlementEnd
      }, 403);
    }
  }

  const requiredTokens = earlyAccessTokenCost(configuredRule, requestedDays);
  let purchase = await context.client.rpc('purchase_feature_early_access', {
    target_user_id: context.user.id,
    target_feature_key: featureKey,
    target_programme_date: programmeDate,
    target_days: requestedDays
  });
  /*
   * The deployed database may still expose only the original three-argument
   * RPC. Keep the one-day purchase working during the migration window;
   * multi-day rolling grants require SUPABASE_EARLY_ACCESS_HORIZON.sql and
   * must never be silently emulated as three unrelated purchases.
   */
  const missingRollingRpc = purchase.error
    && /purchase_feature_early_access|target_days|function .* does not exist|schema cache/i
      .test(String(purchase.error.message || ''));
  if (missingRollingRpc && requestedDays === 1) {
    purchase = await context.client.rpc('purchase_feature_early_access', {
      target_user_id: context.user.id,
      target_feature_key: featureKey,
      target_programme_date: programmeDate
    });
  }
  if (missingRollingRpc && requestedDays > 1) {
    return json({
      error: 'Les forfaits glissants de deux ou trois jours nécessitent la migration Supabase d’anticipation.',
      code: 'ROLLING_EARLY_ACCESS_NOT_MIGRATED',
      requestedDays
    }, 503);
  }
  if (purchase.error) {
    const message = String(purchase.error.message || '');
    const insufficientTokens = message.match(/INSUFFICIENT_TOKENS:(\d+):(\d+)/);
    if (insufficientTokens) {
      return json({
        error: `Solde insuffisant : vous avez ${insufficientTokens[1]} jeton(s), il en faut ${insufficientTokens[2]}.`,
        code: 'INSUFFICIENT_TOKENS',
        currentTokens: Number(insufficientTokens[1]),
        requiredTokens: Number(insufficientTokens[2]),
        requestedDays
      }, 409);
    }
    return json({ error: message || 'Accès anticipé impossible.' }, 400);
  }

  return json({
    ok: true,
    action: 'early-access-unlocked',
    unlock: purchase.data,
    requestedDays,
    requiredTokens,
    access: await accessState(
      context.client,
      context.user.id,
      String(input.countryCode || '')
    )
  });
}

function availablePaymentMode(settings: any, method: string) {
  const mode = String(settings?.payment_mode || 'manual');
  if (method === 'manual') {
    return (mode === 'manual' || mode === 'both')
      && settings?.manual_enabled !== false;
  }
  return (mode === 'online' || mode === 'both')
    && Boolean(String(settings?.online_payment_link || '').trim());
}

async function requestStars(
  context: AuthContext,
  input: Record<string, unknown>
) {
  const stars = Number(input.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > MAX_STARS) {
    return json({ error: 'Le nombre d’étoiles demandé est invalide.' }, 400);
  }

  const method = paymentMethod(input.paymentMethod);
  const settingsResult = await context.client
    .from('payment_settings')
    .select('payment_mode,online_payment_link,manual_enabled')
    .eq('id', 1)
    .maybeSingle();
  if (settingsResult.error) throw settingsResult.error;

  const settings = settingsResult.data || { payment_mode: 'manual', manual_enabled: true };
  if (!availablePaymentMode(settings, method)) {
    return json({ error: 'Ce mode de paiement n’est pas disponible actuellement.' }, 400);
  }

  const selectedCountry = normalizeCountry(input.countryCode);
  const pricesResult = await context.client
    .from('star_prices')
    .select('country_code,country_name,currency_code,currency_symbol,price_per_star,enabled')
    .eq('enabled', true);
  if (pricesResult.error) throw pricesResult.error;

  const pricing = (pricesResult.data || []).find(
    (item: any) => item.country_code === selectedCountry
  ) || (pricesResult.data || []).find(
    (item: any) => item.country_code === 'DEFAULT'
  );
  if (!pricing) {
    return json({
      error: 'Le tarif des étoiles n’est pas encore configuré pour ce pays.'
    }, 400);
  }

  const total = Number((Number(pricing.price_per_star) * stars).toFixed(2));
  if (!Number.isFinite(total)) {
    return json({ error: 'Le total de la demande est invalide.' }, 400);
  }

  const created = await context.client
    .from('payment_requests')
    .insert({
      user_id: context.user.id,
      plan_slug: null,
      payment_method: method,
      stars_requested: stars,
      country_code: pricing.country_code,
      currency_code: pricing.currency_code,
      unit_price: pricing.price_per_star,
      total_price: total,
      proof_reference: ''
    })
    .select('id,stars_requested,country_code,currency_code,unit_price,total_price,status,created_at')
    .single();
  if (created.error) throw created.error;

  return json({
    ok: true,
    action: 'stars-requested',
    request: created.data,
    access: await accessState(context.client, context.user.id, selectedCountry)
  }, 201);
}

async function handleRequest(request: Request) {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Méthode non autorisée.' }, 405);
  }

  let input: Record<string, unknown> = {};
  try {
    const body = await request.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      input = body as Record<string, unknown>;
    }
  } catch (_) {
    // An empty body is equivalent to the default "state" action.
  }

  try {
    const context = await authenticate(request);
    const action = normalizeAction(input.action);

    // The catalogue is intentionally public. Private balances and all
    // mutations below still require a valid authenticated session.
    if (!context) {
      if (action !== 'state') {
        return json({ error: 'Connexion requise.' }, 401);
      }

      return json({
        ok: true,
        access: await publicAccessState(
          serviceClient(),
          String(input.localeCode || '')
        )
      });
    }

    if (action === 'set-language') {
      if (!context) return json({ error: 'Connexion requise.' }, 401);
      return await setUserLocale(context, input.localeCode);
    }
    if (action === 'unlock-feature' || action === 'unlock-schema'
      || action === 'deverrouiller-schema') {
      return await unlockFeature(context, input);
    }
    if (action === 'quote-feature-unlock') {
      return await quoteFeatureUnlock(context, input);
    }
    if (action === 'purchase-subscription'
      || action === 'purchase-plan'
      || action === 'renew-subscription') {
      return await purchaseSubscription(context, input);
    }
    if (action === 'unlock-early-access') {
      return await unlockEarlyAccess(context, input);
    }
    if (action === 'request-stars') {
      return await requestStars(context, input);
    }
    if (action !== 'state') {
      return json({ error: 'Action inconnue.' }, 400);
    }

    return json({
      ok: true,
      access: await accessState(
        context.client,
        context.user.id,
        String(input.countryCode || ''),
        String(input.localeCode || ''),
        input.includeHistory !== false
      )
    });
  } catch (error) {
    console.error('subscription-access failed', error);
    return json({ error: 'Accès aux récompenses indisponible.' }, 500);
  }
}

Deno.serve(handleRequest);
