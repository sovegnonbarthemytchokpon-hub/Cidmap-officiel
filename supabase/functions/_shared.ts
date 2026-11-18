/*
 * Private server-side primitives shared by the Tableaux Edge Functions.
 * This file is never imported by browser code.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type Cross = {
  top: string;
  bottom: string;
  left: string;
  right: string;
  base1: number;
  base2: number;
};

export type Satellite = {
  value: number;
  operation: 'addition' | 'subtraction';
  combinations: Array<Array<{ value: number; yellow: boolean }> & { operator?: string }>;
};

export const TIME_ZONE = 'Africa/Abidjan';
export const PROGRAM_RELEASE_HOUR = 16;
export const CALCULATION_VERSION = 5;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

const FEATURE_ALIASES: Record<string, string> = {
  universelle: 'tableaux-universelle',
  intuition: 'tableaux-intuition',
  oracle: 'tableaux-oracle',
  lnb: 'tableaux-lnb',
  balsa: 'tableaux-balsa',
  standby: 'tableaux-standby'
};

export function canonicalFeatureKey(value: unknown): string {
  const key = String(value || '').trim().toLowerCase();
  return FEATURE_ALIASES[key] || key;
}

function planIncludesFeature(plan: any, featureKey: string): boolean {
  const wanted = canonicalFeatureKey(featureKey);
  const features = Array.isArray(plan?.features)
    ? plan.features.map(canonicalFeatureKey)
    : [];
  // `tableaux` is the legacy/global offer key. It grants every individual
  // Tableau, while specific keys keep working for plans configured one card
  // at a time.
  return features.includes(wanted)
    || (wanted.startsWith('tableaux-') && features.includes('tableaux'));
}

function accessClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Configuration Supabase serveur incomplète.');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function missingAccessTables(error: any) {
  return String(error?.code || '') === '42P01'
    || /subscription_plans|feature_access_rules|user_subscriptions|user_feature_unlocks|user_feature_early_access_grants|relation .* does not exist|column .* does not exist|schema cache/i
      .test(String(error?.message || ''));
}

async function isAdministrator(client: any, userId: string): Promise<boolean> {
  const role = await client.from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle();
  if (!role.error && role.data?.role === 'admin') return true;

  /*
   * During the admin migration the principal account can exist in
   * admin_control_settings before its duplicate user_roles row is created.
   * Keep this compatibility path fail-closed: only the server-side principal
   * row can grant it, and a missing old table is simply ignored.
   */
  const principal = await client.from('admin_control_settings')
    .select('principal_user_id')
    .eq('id', true)
    .limit(1)
    .maybeSingle();
  return !principal.error
    && principal.data?.principal_user_id === userId;
}

function dateInTimeZone(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const part = (type: string) =>
    String(parts.find((item) => item.type === type)?.value || '').padStart(2, '0');
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/*
 * Return the last calendar date covered by the user's base entitlement.
 * null means either a free programme or an entitlement with no expiry.
 * The early-access gate uses this to prevent a subscription with ten days
 * remaining from unlocking future dates beyond its own end.
 */
export async function baseEntitlementEndDate(
  client: any,
  userId: string,
  featureKey: string
): Promise<string | null> {
  const wanted = canonicalFeatureKey(featureKey);
  const [plansResult, rulesResult, unlockResult, subscriptionResult] =
    await Promise.all([
      client.from('subscription_plans').select('slug,features,enabled'),
      client.from('feature_access_rules')
        .select('feature_key,plan_slug,enabled'),
      client.from('user_feature_unlocks')
        .select('feature_key,expires_at')
        .eq('user_id', userId)
        .eq('feature_key', wanted)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .maybeSingle(),
      client.from('user_subscriptions')
        .select('plan_slug,status,started_at,expires_at')
        .eq('user_id', userId)
        .eq('status', 'active')
        .lte('started_at', new Date().toISOString())
        .maybeSingle()
    ]);
  if (plansResult.error || rulesResult.error) {
    throw plansResult.error || rulesResult.error;
  }
  if (unlockResult.error && !missingAccessTables(unlockResult.error)) {
    throw unlockResult.error;
  }
  if (subscriptionResult.error && !missingAccessTables(subscriptionResult.error)) {
    throw subscriptionResult.error;
  }

  const enabledPlans = (plansResult.data || [])
    .filter((plan: any) => plan.enabled !== false);
  const rule = (rulesResult.data || []).find((item: any) => (
    item.enabled !== false
      && canonicalFeatureKey(item.feature_key) === wanted
  ));
  const configuredInOffer = enabledPlans.some((plan: any) =>
    planIncludesFeature(plan, wanted)
  );

  // A feature without an access rule or an offer is genuinely free.
  if (!rule && !configuredInOffer) return null;

  const expiryDates: string[] = [];
  if (unlockResult.data) {
    if (!unlockResult.data.expires_at) return null;
    expiryDates.push(dateInTimeZone(unlockResult.data.expires_at));
  }

  const subscription = subscriptionResult.data;
  const subscriptionPlan = enabledPlans.find(
    (plan: any) => String(plan.slug) === String(subscription?.plan_slug)
  );
  const subscriptionCoversFeature = Boolean(
    subscriptionPlan
      && (
        planIncludesFeature(subscriptionPlan, wanted)
        || Boolean(rule?.plan_slug && rule.plan_slug === subscriptionPlan.slug)
      )
  );
  if (subscriptionCoversFeature) {
    if (!subscription.expires_at) return null;
    expiryDates.push(dateInTimeZone(subscription.expires_at));
  }

  return expiryDates.filter(Boolean).sort().at(-1) || '';
}

export async function hasEarlyAccessGrant(
  client: any,
  userId: string,
  featureKey: string,
  dayOffset: number
): Promise<boolean> {
  const result = await client
    .from('user_feature_early_access_grants')
    .select('days,expires_at')
    .eq('user_id', userId)
    .eq('feature_key', canonicalFeatureKey(featureKey))
    .maybeSingle();
  if (result.error) {
    if (missingAccessTables(result.error)) return false;
    throw result.error;
  }
  return Boolean(
    result.data
      && Number(result.data.days) >= dayOffset
      && (!result.data.expires_at
        || Date.parse(result.data.expires_at) > Date.now())
  );
}

/*
 * Compatibility for the original date-based anticipation table.
 *
 * Before the rolling-grant migration, buying anticipation created one row
 * for one date. That made a valid user fall back to a locked template as
 * soon as the calendar moved on, even though the entitlement was still
 * active. The current next-day publication may use the latest active legacy
 * row until the rolling grant table is populated.
 */
export async function hasActiveLegacyEarlyAccess(
  client: any,
  userId: string,
  featureKey: string,
  normalProgrammeDate: string,
  rule: any
): Promise<boolean> {
  let result = await client
    .from('user_feature_early_access')
    .select('programme_date,unlocked_at,expires_at')
    .eq('user_id', userId)
    .eq('feature_key', canonicalFeatureKey(featureKey))
    .order('programme_date', { ascending: false })
    .limit(20);

  if (result.error
      && /expires_at|column .* does not exist|schema cache/i
        .test(String(result.error.message || ''))) {
    result = await client
      .from('user_feature_early_access')
      .select('programme_date,unlocked_at')
      .eq('user_id', userId)
      .eq('feature_key', canonicalFeatureKey(featureKey))
      .order('programme_date', { ascending: false })
      .limit(20);
  }

  if (result.error) {
    if (missingAccessTables(result.error)) return false;
    throw result.error;
  }

  const durationDays = Math.max(1, Number(rule?.duration_days) || 30);
  const now = Date.now();
  return (result.data || []).some((unlock: any) => {
    const programmeDate = String(unlock?.programme_date || '').slice(0, 10);
    if (!programmeDate || programmeDate > normalProgrammeDate) return false;

    const expiry = unlock?.expires_at
      ? Date.parse(unlock.expires_at)
      : Date.parse(String(unlock?.unlocked_at || '')) + durationDays * 86400000;
    return Number.isFinite(expiry) && expiry > now;
  });
}

/*
 * Read the current rule while remaining compatible with the original
 * one-day schema. The horizon migration adds four columns; during a rolling
 * deployment their absence means one future day and the legacy token price,
 * not a server error.
 */
export async function readEarlyAccessRule(
  client: any,
  featureKey: string
) {
  const current = await client
    .from('feature_early_access_rules')
    .select(
      'feature_key,enabled,early_hour,required_tokens,duration_days,preview_days,token_cost_1_day,token_cost_2_days,token_cost_3_days'
    )
    .eq('feature_key', featureKey)
    .limit(1)
    .maybeSingle();
  if (!current.error || !missingAccessTables(current.error)) return current;

  const legacy = await client
    .from('feature_early_access_rules')
    .select('feature_key,enabled,early_hour,required_tokens,duration_days')
    .eq('feature_key', featureKey)
    .limit(1)
    .maybeSingle();
  if (legacy.error) return legacy;
  if (!legacy.data) return { data: null, error: null };
  const one = Math.max(0, Number(legacy.data.required_tokens) || 0);
  return {
    data: {
      ...legacy.data,
      preview_days: 1,
      token_cost_1_day: one,
      token_cost_2_days: one * 2,
      token_cost_3_days: one * 3
    },
    error: null
  };
}

/*
 * Enforce the same catalogue decision as the browser, at the Edge Function
 * boundary too. An administrator can change an offer while a visitor keeps an
 * old page open, so UI masking alone is not sufficient.
 *
 * Prediction features are fail-closed: a missing or expired entitlement
 * never exposes a key, cross or satellite payload.
 */
export async function enforceFeatureAccess(
  request: Request,
  featureKey: string
): Promise<Response | null> {
  const client = accessClient();
  const wanted = canonicalFeatureKey(featureKey);
  const [plansResult, rulesResult] = await Promise.all([
    client.from('subscription_plans')
      .select('slug,features,enabled'),
    client.from('feature_access_rules')
      .select('feature_key,plan_slug,required_stars,required_tokens,enabled')
  ]);
  if (missingAccessTables(plansResult.error) || missingAccessTables(rulesResult.error)) {
    // A missing access catalogue cannot verify a subscription. Keep legacy
    // non-prediction endpoints compatible, but fail closed for every
    // individually protected surface.
    return json({ error: 'Catalogue d’accès Supabase non vérifiable.' }, 503);
  }
  if (plansResult.error) throw plansResult.error;
  if (rulesResult.error) throw rulesResult.error;

  const allPlans = plansResult.data || [];
  const enabledPlans = allPlans.filter((plan: any) => plan.enabled !== false);
  const enabledPlanSlugs = new Set(enabledPlans.map((plan: any) => plan.slug));
  const rule = (rulesResult.data || []).find((item: any) => (
    item.enabled !== false
    && canonicalFeatureKey(item.feature_key) === wanted
    && (!item.plan_slug || enabledPlanSlugs.has(item.plan_slug))
  ));
  const protectedByOffer = enabledPlans.some((plan: any) => (
    planIncludesFeature(plan, wanted)
  ));
  const requiresSubscription = Boolean(rule) || protectedByOffer;
  if (
    rule
    && Number(rule.required_stars || 0) <= 0
    && Number(rule.required_tokens || 0) <= 0
    && !rule.plan_slug
    && !protectedByOffer
  ) {
    return null;
  }
  if (!requiresSubscription) return null;

  const token = request.headers.get('Authorization')
    ?.replace(/^Bearer\s+/i, '').trim() || '';
  if (!token) return json({ error: 'Connexion requise pour accéder à cette section.' }, 401);

  const session = await client.auth.getUser(token);
  if (session.error || !session.data?.user?.id) {
    return json({ error: 'Session invalide.' }, 401);
  }
  const userId = session.data.user.id;

  // Keep the administrator's diagnostic and preview tools available.
  if (await isAdministrator(client, userId)) return null;

  const now = new Date().toISOString();
  const unlock = await client.from('user_feature_unlocks')
    .select('feature_key,unlocked_at,expires_at')
    .eq('user_id', userId)
    .eq('feature_key', wanted)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .maybeSingle();
  if (unlock.error && !missingAccessTables(unlock.error)) {
    throw unlock.error;
  }
  if (unlock.data) return null;

  const subscription = await client.from('user_subscriptions')
    .select('plan_slug,status,started_at,expires_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .lte('started_at', now)
    // A collective subscription may be perpetual. Keep NULL expiry aligned
    // with the subscription-access state endpoint and the client gate.
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .maybeSingle();
  if (subscription.error) {
    if (missingAccessTables(subscription.error)) {
      return json({ error: 'Abonnement actif non vérifiable.' }, 403);
    }
    throw subscription.error;
  }
  const plan = enabledPlans.find(
    (item: any) => item.slug === subscription.data?.plan_slug
  );
  const allowed = Boolean(plan) && (
    planIncludesFeature(plan, wanted)
    || Boolean(rule?.plan_slug && rule.plan_slug === plan.slug)
  );
  return allowed
    ? null
    : json({ error: 'Cette section nécessite un abonnement actif.' }, 403);
}

/*
 * Publication anticipée pilotée par l'administration.
 *
 * `preview_days` définit le nombre de dates futures qui peuvent être
 * anticipées. Chaque date garde son propre déblocage dans
 * user_feature_early_access. L'anticipation ne remplace jamais le droit
 * d'accès au programme : le handler appelle enforceFeatureAccess avant cette
 * fonction et subscription-access vérifie le même droit avant l'achat.
 */
export async function enforceEarlyAccess(
  request: Request,
  featureKey: string,
  programmeDate: string
): Promise<Response | null> {
  const wanted = canonicalFeatureKey(featureKey);
  if (!/^[a-z][a-z0-9_-]{1,59}$/.test(wanted)) return null;

  const client = accessClient();
  const ruleResult = await readEarlyAccessRule(client, wanted);
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const part = (type: string) =>
    Number(parts.find((item) => item.type === type)?.value);
  const normalDate = dateIso(programmeDateFromClock(now));
  const currentHour = part('hour');
  const token = request.headers.get('Authorization')
    ?.replace(/^Bearer\s+/i, '').trim() || '';
  const requestedDate = new Date(`${programmeDate}T12:00:00.000Z`);
  const normalDateObject = new Date(`${normalDate}T12:00:00.000Z`);
  if (
    Number.isNaN(requestedDate.getTime())
    || Number.isNaN(normalDateObject.getTime())
  ) return json({ error: 'Date de publication invalide.' }, 400);

  const dayOffset = Math.floor(
    (requestedDate.getTime() - normalDateObject.getTime()) / 86400000
  );

  // Current and historical archives remain readable once the base programme
  // entitlement has been checked by the caller.
  if (dayOffset <= 0) return null;

  /*
   * Administrators can inspect any generated date from the protected
   * programme endpoint, even when the public anticipation window is disabled
   * or shorter than the requested date.
   */
  if (!token) {
    return json({
      error: 'Débloquez cette publication pour la recevoir dès maintenant.',
      code: 'EARLY_ACCESS_REQUIRED',
      featureKey: wanted,
      programmeDate
    }, 403);
  }
  const session = await client.auth.getUser(token);
  if (session.error || !session.data?.user?.id) {
    return json({ error: 'Session invalide.' }, 401);
  }
  const userId = session.data.user.id;
  if (await isAdministrator(client, userId)) return null;

  const entitlementEndDate = await baseEntitlementEndDate(
    client,
    userId,
    wanted
  );
  if (entitlementEndDate && programmeDate > entitlementEndDate) {
    return json({
      error: 'Votre droit d’accès au programme expire avant cette publication.',
      code: 'BASE_ACCESS_EXPIRES_BEFORE_PROGRAM',
      featureKey: wanted,
      programmeDate,
      entitlementEndDate
    }, 403);
  }

  if (ruleResult.error) {
    if (
      missingAccessTables(ruleResult.error)
      || /feature_early_access_rules/i.test(String(ruleResult.error.message || ''))
    ) {
      return json({
        error: 'Cette publication anticipée n’est pas configurée.',
        code: 'EARLY_ACCESS_DISABLED',
        featureKey: wanted,
        programmeDate
      }, 403);
    }
    throw ruleResult.error;
  }
  const rule = ruleResult.data?.enabled === true
    ? ruleResult.data
    : null;
  if (!rule) {
    return json({
      error: 'Cette publication anticipée n’est pas activée.',
      code: 'EARLY_ACCESS_DISABLED',
      featureKey: wanted,
      programmeDate
    }, 403);
  }

  const previewDays = Math.max(
    1,
    Math.min(30, Number(rule.preview_days) || 1)
  );
  if (dayOffset > previewDays) {
    return json({
      error: `Cette date dépasse la fenêtre de ${previewDays} jour(s) configurée par l’administration.`,
      code: 'EARLY_ACCESS_OUT_OF_RANGE',
      featureKey: wanted,
      programmeDate,
      previewDays
    }, 403);
  }

  if (await hasEarlyAccessGrant(client, userId, wanted, dayOffset)) {
    return null;
  }

  if (await hasActiveLegacyEarlyAccess(
    client,
    userId,
    wanted,
    normalDate,
    rule
  )) {
    return null;
  }

  const unlock = await client
    .from('user_feature_early_access')
    .select('id')
    .eq('user_id', userId)
    .eq('feature_key', wanted)
    .eq('programme_date', programmeDate)
    .limit(1)
    .maybeSingle();
  if (unlock.error) {
    if (missingAccessTables(unlock.error)
      || /user_feature_early_access/i.test(String(unlock.error.message || ''))) {
      return json({ error: 'L’accès anticipé n’est pas encore configuré.' }, 403);
    }
    throw unlock.error;
  }
  if (currentHour < PROGRAM_RELEASE_HOUR && !unlock.data) {
    return json({
      error: 'Cette publication sera disponible à 16h, sauf pour un accès anticipé déjà activé.',
      code: 'PUBLIC_RELEASE_NOT_AVAILABLE',
      featureKey: wanted,
      programmeDate,
      releaseHour: PROGRAM_RELEASE_HOUR
    }, 425);
  }
  return unlock.data
    ? null
    : json({
        error: 'Débloquez cette publication pour la recevoir dès maintenant.',
        code: 'EARLY_ACCESS_REQUIRED',
        featureKey: wanted,
        programmeDate,
        releaseHour: PROGRAM_RELEASE_HOUR,
        requiredTokens: Math.max(1, Number(rule.required_tokens) || 1)
      }, 403);
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

export function pad2(value: unknown): string {
  return String(value ?? '').padStart(2, '0').slice(-2);
}

export function sumDigits(value: unknown): number {
  return String(Math.abs(Number(value) || 0))
    .split('')
    .reduce((sum, digit) => sum + Number(digit), 0);
}

export function reduceTo90(value: unknown): number {
  let result = Math.abs(Number(value) || 0);
  while (result > 90) result = sumDigits(result);
  return result || 1;
}

/*
 * Optional Niger-result bridge for the daily number engines.
 *
 * Resultat-Aide remains the authority for publication.  This reader is
 * deliberately best-effort: an installation without the Resultat-Aide
 * tables, or a day without a published Niger result, must never prevent the
 * normal date calculation from running.
 *
 * A result such as 45, 49, 38, 36 + bonus 75 produces:
 *   - direct numbers: 45, 49, 38, 36, 75
 *   - total: 243 -> reduced value 9
 *   - digit sum of the primary groups: 4+5+4+9+3+8+3+6 = 42
 *
 * The bonus participates in the total, while the primary groups are used for
 * the "mother" digit sum.  This mirrors the way Resultat-Aide stores a
 * primary result separately from a bonus and keeps the interpretation
 * explicit in the persisted trace.
 */
export type NigerResultContext = {
  available: true;
  source: 'resultat_aide_draws';
  resultId: string | null;
  drawDate: string;
  drawTime: string | null;
  drawNumber: number | null;
  directNumbers: number[];
  primaryNumbers: number[];
  bonusNumbers: number[];
  aggregateSum: number;
  aggregateReduced: number;
  primaryDigitSum: number;
  derivedNumbers: number[];
  eligibleAt: string;
};

function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function resultNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((number) => (
    Number.isInteger(number) && number >= 1 && number <= 90
  )))];
}

function digitSumOfNumbers(numbers: number[]): number {
  return numbers.reduce((total, number) => (
    total + String(number).split('').reduce((sum, digit) => sum + Number(digit), 0)
  ), 0);
}

function digitalRoot(value: number): number {
  let result = Math.abs(Number(value) || 0);
  while (result >= 10) result = sumDigits(result);
  return result || 1;
}

function nigerResultFromRow(row: any, eligibleAt: string): NigerResultContext | null {
  const first = resultNumbers(row?.first_numbers);
  const machine = resultNumbers(row?.machine_numbers);
  const bonus = resultNumbers(row?.bonus_numbers);
  const primaryNumbers = [...new Set([...first, ...machine])];
  const directNumbers = [...new Set([...primaryNumbers, ...bonus])];
  if (!directNumbers.length) return null;

  // Older/manual imports may use only one of the number columns. In that
  // case the available direct numbers are also the safe "mother" source.
  const mothers = primaryNumbers.length ? primaryNumbers : directNumbers;
  const aggregateSum = directNumbers.reduce((total, number) => total + number, 0);
  const aggregateReduced = digitalRoot(aggregateSum);
  const primaryDigitSum = digitSumOfNumbers(mothers);
  const derivedNumbers = [...new Set([aggregateReduced, primaryDigitSum])]
    .filter((number) => Number.isInteger(number) && number >= 1 && number <= 90);

  return {
    available: true,
    source: 'resultat_aide_draws',
    resultId: row?.id ? String(row.id) : null,
    drawDate: String(row?.draw_date || ''),
    drawTime: row?.draw_time ? String(row.draw_time).slice(0, 5) : null,
    drawNumber: row?.draw_number === null || row?.draw_number === undefined
      ? null
      : Number(row.draw_number),
    directNumbers,
    primaryNumbers: mothers,
    bonusNumbers: bonus,
    aggregateSum,
    aggregateReduced,
    primaryDigitSum,
    derivedNumbers,
    eligibleAt
  };
}

/**
 * Read the latest published Niger result that was available by the planned
 * 16:00 generation boundary for the requested programme date.
 */
export async function readOptionalNigerResult(
  programmeDate: string | Date
): Promise<NigerResultContext | null> {
  const targetDate = programmeDate instanceof Date
    ? dateIso(programmeDate)
    : String(programmeDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return null;

  const client = serviceClient();
  if (!client) return null;

  // Africa/Abidjan is UTC. Looking at a small window lets us skip a same-day
  // result published after 16:00 and still use the previous eligible draw.
  const generationBoundary = new Date(`${targetDate}T16:00:00.000Z`);
  const eligibleAt = generationBoundary.toISOString();
  try {
    const result = await client
      .from('resultat_aide_draws')
      .select(
        'id,country_code,draw_date,draw_time,draw_number,first_numbers,machine_numbers,bonus_numbers,published_at,status'
      )
      .eq('country_code', 'NE')
      .eq('status', 'published')
      .lte('draw_date', targetDate)
      .order('draw_date', { ascending: false })
      .order('draw_time', { ascending: false, nullsFirst: false })
      .limit(25);
    if (result.error) return null;

    for (const row of result.data || []) {
      const publishedAt = row?.published_at ? Date.parse(row.published_at) : NaN;
      if (Number.isFinite(publishedAt) && publishedAt > generationBoundary.getTime()) {
        continue;
      }
      const context = nigerResultFromRow(row, eligibleAt);
      if (context) return context;
    }
  } catch (_) {
    // Resultat-Aide is an optional enhancement, never a hard dependency.
  }
  return null;
}

export function parseProgrammeDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') {
    return programmeDateFromClock();
  }
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
    ? parsed
    : null;
}

export function programmeDateFromClock(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  return new Date(Date.UTC(
    part('year'),
    part('month') - 1,
    part('day') + (part('hour') >= 16 ? 1 : 0),
    12
  ));
}

export async function readDate(request: Request): Promise<Date | null> {
  let body: { date?: unknown } = {};
  try {
    body = await request.json() as { date?: unknown };
  } catch (_) {
    return null;
  }
  return parseProgrammeDate(body?.date);
}

export async function serveCalculation(
  request: Request,
  calculate: (date: Date) => unknown
): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);
  const date = await readDate(request);
  if (!date) return json({ error: 'date doit être une date ISO valide (YYYY-MM-DD).' }, 400);
  try {
    return json(calculate(date));
  } catch (error) {
    console.error('Tableaux calculation failed', error);
    return json({ error: 'Calcul indisponible côté serveur.' }, 500);
  }
}

export function dateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function normalizeDateForOffset(date: Date, offset: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + offset);
  result.setUTCHours(12, 0, 0, 0);
  return result;
}

export function getAllValidNumbersForDate(date: Date): number[] {
  const day = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  const yearSum = sumDigits(year);
  const numbers = new Set<number>();
  const add = (value: number, reduceLarge = true) => {
    const safe = reduceLarge && value > 45 ? sumDigits(value) : value;
    if (Number.isInteger(safe) && safe >= 1 && safe <= 90) numbers.add(safe);
  };

  add(day);
  add(day + month + yearSum);
  add(sumDigits(`${day}${month}${year}`));
  const wholeDate = day + month + year;
  add(wholeDate > 90
    ? Number(String(wholeDate).slice(0, Math.ceil(String(wholeDate).length / 2)))
      + Number(String(wholeDate).slice(Math.ceil(String(wholeDate).length / 2)))
    : wholeDate, wholeDate <= 90);

  const start = Date.UTC(year, 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start) / 86400000);
  add(sumDigits(dayOfYear));
  add(day * month);
  add(day + month + Number(String(year).slice(-2)));
  return [...numbers].sort((a, b) => a - b);
}

function addLucky(set: Set<number>, calculations: Array<Record<string, unknown>>,
  label: string, expression: string, value: number): void {
  let result = Math.abs(Number(value));
  if (!Number.isFinite(result) || result === 0) return;
  while (result > 90) result = sumDigits(result);
  set.add(result);
  calculations.push({ label, expression, value: Number(value), result });
}

export function extractLuckyNumbersFromDate(date: Date) {
  const day = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  const century = Math.floor(year / 100);
  const shortYear = year % 100;
  const yearDigitSum = sumDigits(year);
  const dayOfYear = Math.floor((date.getTime() - Date.UTC(year, 0, 0)) / 86400000);
  const counterLastTwo = dayOfYear % 100;
  const counterDigitSum = sumDigits(dayOfYear);
  const dateDigits = `${String(day).padStart(2, '0')}${String(month).padStart(2, '0')}${year}`;
  const dateDigitSum = sumDigits(dateDigits);
  const calculations: Array<Record<string, unknown>> = [];
  const lucky = new Set<number>();

  [
    ['Jour', 'J', day],
    ['Mois', 'M', month],
    ['Deux derniers chiffres du compteur', `${dayOfYear} → ${counterLastTwo}`, counterLastTwo],
    ['Somme des chiffres du compteur', String(dayOfYear).split('').join(' + '), counterDigitSum],
    ['J + M', `${day} + ${month}`, day + month],
    ['J + A', `${day} + ${shortYear}`, day + shortYear],
    ['A − M', `${shortYear} − ${month}`, shortYear - month],
    ['J + M + A', `${day} + ${month} + ${shortYear}`, day + month + shortYear]
  ].forEach(([label, expression, value]) => addLucky(
    lucky, calculations, String(label), String(expression), Number(value)
  ));

  const grandBlock = day + month + year;
  const grandBlockText = String(grandBlock);
  const firstBlock = Number(grandBlockText.slice(0, 2));
  const secondBlock = Number(grandBlockText.slice(2, 4));
  addLucky(lucky, calculations, 'Total global', `${day} + ${month} + ${year}`, grandBlock);
  addLucky(lucky, calculations, 'Somme des chiffres du total',
    String(grandBlock).split('').join(' + '), sumDigits(grandBlock));
  const blockAssembly = firstBlock + secondBlock;
  addLucky(lucky, calculations, 'Assemblage des blocs',
    `${firstBlock} + ${secondBlock}`, blockAssembly);
  const blockDecomposition = firstBlock
    + Number(grandBlockText.slice(2, 3))
    + Number(grandBlockText.slice(3, 4));
  addLucky(lucky, calculations, 'Découpage du bloc',
    `${firstBlock} + ${grandBlockText.slice(2, 3)} + ${grandBlockText.slice(3, 4)}`,
    blockDecomposition);
  addLucky(lucky, calculations, 'Somme de tous les chiffres de la date',
    `${dateDigits} → ${dateDigitSum}`, dateDigitSum);

  const luckyNumbers = [...lucky].sort((a, b) => a - b);
  return {
    date: dateIso(date),
    components: {
      day, month, century, shortYear, year, yearDigitSum, dayOfYear,
      counterLastTwo, counterDigitSum, dateDigitSum, grandBlock
    },
    calculations,
    luckyNumbers,
    odd: luckyNumbers.filter((number) => number % 2 === 1),
    even: luckyNumbers.filter((number) => number % 2 === 0)
  };
}

export type LuckyNumberDetails = ReturnType<typeof extractLuckyNumbersFromDate>;

/*
 * Public programme contract.
 *
 * The archive keeps the complete calculation payload for the server and the
 * administrator. Visitors only need the values rendered in the tables. Do
 * not spread an internal payload into a public response: that would expose
 * the rule trace, caller chains and calculation expressions in DevTools.
 */
export function publicProgramPayload(payload: any) {
  const cross = payload?.cross && typeof payload.cross === 'object'
    ? {
        top: String(payload.cross.top ?? ''),
        bottom: String(payload.cross.bottom ?? ''),
        left: String(payload.cross.left ?? ''),
        right: String(payload.cross.right ?? '')
      }
    : null;
  const satellites = Array.isArray(payload?.satellites)
    ? payload.satellites.map((satellite: any) => {
        const combinations = Array.isArray(satellite?.combinations)
          ? satellite.combinations.map((parts: any) => {
              const safeParts = (Array.isArray(parts)
                ? parts.map((part: any) => ({
                    value: Number(part?.value ?? 0),
                    yellow: Boolean(part?.yellow)
                  }))
                : []) as Array<{ value: number; yellow: boolean }> & {
                  operator?: string;
                };
              if (parts?.operator === '−') safeParts.operator = '−';
              else safeParts.operator = '+';
              return safeParts;
            })
          : [];
        return {
          value: Number(satellite?.value ?? 0),
          combinations
        };
      })
    : [];
  const output: Record<string, unknown> = {};
  [
    'id', 'displayName', 'functionName', 'theme', 'date', 'weekDate',
    'schedules', 'calculationVersion', 'controlVersion', 'luckyNumbers',
    'selectedNumber', 'key', 'order', 'code', 'filter', 'addition',
    'group', 'nextDate', 'followingDate', 'power', 'result', 'digitCount',
    'pairs', 'retained', 'primes'
  ].forEach((key) => {
    if (payload?.[key] !== undefined) output[key] = payload[key];
  });
  if (cross) output.cross = cross;
  output.satellites = satellites;
  if (payload?.nap && typeof payload.nap === 'object') {
    output.nap = {
      nap1: Array.isArray(payload.nap.nap1) ? payload.nap.nap1.map(String) : [],
      nap2: Array.isArray(payload.nap.nap2) ? payload.nap.nap2.map(String) : []
    };
  }
  return output;
}

/*
 * Denied visitors receive only a stable structural preview. The calculation
 * remains server-side and the real key/order/cross values never cross the
 * API boundary for an unauthorised request.
 */
export function maskedProgramPayload(payload: any) {
  const output = publicProgramPayload(payload);
  output.key = '000000';
  output.order = '000000';
  output.code = '00';
  output.filter = '00';
  output.addition = '00';
  output.luckyNumbers = [];
  if (output.selectedNumber !== undefined) output.selectedNumber = '00';
  if (output.power !== undefined) output.power = '00';
  if (output.result !== undefined) output.result = '00';
  if (output.cross && typeof output.cross === 'object') {
    output.cross = {
      ...(output.cross as Record<string, unknown>),
      top: '0',
      bottom: '0',
      left: '0',
      right: '0'
    };
  }
  // Denied responses carry one structural preview only. The browser follows
  // the same rule and never expands a locked satellite list.
  output.satellites = [{ value: '00' }];
  if (output.nap && typeof output.nap === 'object') {
    output.nap = {
      nap1: ['00'],
      nap2: ['00']
    };
  }
  if (Array.isArray(output.pairs)) output.pairs = [];
  if (Array.isArray(output.retained)) output.retained = [];
  if (Array.isArray(output.primes)) output.primes = [];
  return output;
}

/**
 * Resolve the common lucky-number phase for a programme request.
 *
 * Programme handlers may accept a list from an older client for compatibility,
 * but the normal browser request sends only the date. The date remains
 * authoritative on the server, and a modified/stale list is rejected instead
 * of being allowed to influence a key or a cross.
 */
export function resolveLuckyNumberDetails(
  date: Date,
  suppliedLuckyNumbers?: unknown
): LuckyNumberDetails {
  const details = extractLuckyNumbersFromDate(date);
  if (suppliedLuckyNumbers === undefined) return details;
  if (!Array.isArray(suppliedLuckyNumbers)) {
    throw new Error('luckyNumbers doit être un tableau.');
  }

  const rawNumbers = suppliedLuckyNumbers.map((value) => Number(value));
  if (rawNumbers.some((value) => !Number.isInteger(value) || value < 1 || value > 90)) {
    throw new Error('Les numéros chanceux doivent être compris entre 1 et 90.');
  }
  const supplied = [...new Set(rawNumbers)].sort((a, b) => a - b);
  if (supplied.length !== rawNumbers.length) {
    throw new Error('La liste des numéros chanceux contient des doublons.');
  }
  if (supplied.length !== details.luckyNumbers.length
      || supplied.some((value, index) => value !== details.luckyNumbers[index])) {
    throw new Error('Les numéros chanceux ne correspondent pas à la date.');
  }
  return details;
}

export function getDateCandidates(date: Date): number[] {
  return getAllValidNumbersForDate(date);
}

export function createCross(primaryValue: unknown, secondaryValue = 63): Cross {
  const primary = pad2(primaryValue);
  const secondary = pad2(secondaryValue);
  return {
    top: primary[0],
    bottom: primary[1],
    left: secondary[0],
    right: secondary[1],
    base1: Number(primary) || 0,
    base2: Number(secondary) || 0
  };
}

type RawCombination = {
  sum: number;
  pair1: { number: number; indices: number[] };
  pair2: { number: number; indices: number[] };
};

function combination(
  first: number,
  second: number,
  firstIndices: number[],
  secondIndices: number[],
  operator: string
) {
  const result = [
    { value: first, yellow: firstIndices.some((index) => index === 0 || index === 3) },
    { value: second, yellow: secondIndices.some((index) => index === 0 || index === 3) }
  ] as Array<{ value: number; yellow: boolean }> & { operator?: string };
  result.operator = operator;
  return result;
}

export function decryptCross(cross: Cross): Satellite[] {
  const digits = [cross.top, cross.bottom, cross.left, cross.right];
  const raw: RawCombination[] = [];
  for (let i = 0; i < 4; i += 1) {
    for (let j = i + 1; j < 4; j += 1) {
      const rest = [0, 1, 2, 3].filter((index) => index !== i && index !== j);
      const left = [Number(`${digits[i]}${digits[j]}`), Number(`${digits[j]}${digits[i]}`)];
      const right = [Number(`${digits[rest[0]]}${digits[rest[1]]}`), Number(`${digits[rest[1]]}${digits[rest[0]]}`)];
      [...new Set(left)].forEach((first) => [...new Set(right)].forEach((second) => {
        raw.push({ sum: first + second, pair1: { number: first, indices: [i, j] },
          pair2: { number: second, indices: rest } });
      }));
    }
  }

  const groups = new Map<number, RawCombination[]>();
  const subtractionGroups = new Map<number, RawCombination[]>();
  const add = (map: Map<number, RawCombination[]>, value: number, item: RawCombination) => {
    if (!Number.isInteger(value) || value < 1 || value > 90) return;
    const list = map.get(value) || [];
    const signature = `${Math.min(item.pair1.number, item.pair2.number)}_${Math.max(item.pair1.number, item.pair2.number)}`;
    if (!list.some((entry) => (
      `${Math.min(entry.pair1.number, entry.pair2.number)}_${Math.max(entry.pair1.number, entry.pair2.number)}` === signature
    ))) list.push(item);
    map.set(value, list);
  };
  raw.forEach((item) => {
    if (item.sum <= 90) add(groups, item.sum, item);
    else {
      const first = item.pair1.number;
      const second = item.pair2.number;
      if (first !== second) {
        add(subtractionGroups, Math.abs(first - second), first >= second
          ? item
          : { ...item, pair1: item.pair2, pair2: item.pair1 });
      }
    }
  });

  const output = new Map<number, Satellite>();
  const append = (map: Map<number, RawCombination[]>, operation: 'addition' | 'subtraction') => {
    map.forEach((list, value) => {
      if (list.length < 2 || output.has(value)) return;
      const operator = operation === 'subtraction' ? '−' : '+';
      output.set(value, {
        value,
        operation,
        combinations: [
          combination(list[0].pair1.number, list[0].pair2.number, list[0].pair1.indices, list[0].pair2.indices, operator),
          combination(list[1].pair1.number, list[1].pair2.number, list[1].pair1.indices, list[1].pair2.indices, operator)
        ]
      });
    });
  };
  append(groups, 'addition');
  append(subtractionGroups, 'subtraction');
  return [...output.values()].sort((a, b) => a.value - b.value);
}

export function buildKeyFromValues(values: unknown[]): string {
  const normalized = values.map((value) => pad2(reduceTo90(value)));
  return `${normalized[0] || '01'}${normalized[1] || '02'}${normalized[2] || pad2(sumDigits(
    `${normalized[0] || '01'}${normalized[1] || '02'}`
  ))}`.padStart(6, '0').slice(-6);
}

export function keyPayload(key: string, cross: Cross, satellites: Satellite[], validNumbers: number[]) {
  const safeKey = key.padStart(6, '0').slice(-6);
  return {
    calculationVersion: CALCULATION_VERSION,
    key: safeKey,
    order: safeKey.split('').sort().join(''),
    code: safeKey.slice(0, 2),
    filter: safeKey.slice(2, 4),
    addition: String(sumDigits(safeKey)),
    cross,
    satellites,
    validNumbers
  };
}

export function deriveNap(
  key: string,
  satellites: Satellite[],
  options: { code?: string; filter?: string; cross?: Cross } = {}
) {
  const safeKey = key.padStart(6, '0').slice(-6);
  const keyParts = [safeKey.slice(0, 2), safeKey.slice(2, 4), safeKey.slice(4, 6)];
  const remaining = [...keyParts];
  [options.code, options.filter]
    .filter((value): value is string => value !== undefined)
    .map(pad2)
    .forEach((part) => {
      const index = remaining.indexOf(part);
      if (index >= 0) remaining.splice(index, 1);
    });
  const keyRemainder = remaining[0] || keyParts[2];
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let sequence = 0;
  const preferred = [options.cross?.base1, options.cross?.base2]
    .filter((value): value is number => value !== undefined)
    .map(pad2);
  satellites.forEach((satellite) => {
    (satellite.combinations || []).forEach((parts) => {
      parts.forEach((part) => {
        const value = Number(part.value);
        if (!Number.isFinite(value) || value < 0 || value > 90) return;
        const normalized = pad2(value);
        counts.set(normalized, (counts.get(normalized) || 0) + 1);
        if (!firstSeen.has(normalized)) firstSeen.set(normalized, sequence++);
      });
    });
  });
  const preferenceRank = (value: string) => {
    const index = preferred.indexOf(value);
    return index >= 0 ? index : Number.POSITIVE_INFINITY;
  };
  const repeated = [...counts.entries()]
    .filter(([value]) => value !== keyRemainder)
    .sort((a, b) => (
      (b[1] - a[1])
      || (preferenceRank(a[0]) - preferenceRank(b[0]))
      || ((firstSeen.get(a[0]) || 0) - (firstSeen.get(b[0]) || 0))
    ))[0]?.[0]
    || keyParts.find((value) => value !== keyRemainder)
    || preferred.find((value) => value !== keyRemainder)
    || [...counts.keys()].find((value) => value !== keyRemainder)
    || '01';
  const nap1 = [keyRemainder, repeated];
  return { keyRemainder, repeated, firstNap1: nap1[0], secondNap1: nap1[1], nap1, nap2: [...nap1] };
}

export function calculateCrossAndSatellites(
  key: string,
  secondaryBase = 63,
  source: 'code' | 'remainder' | 'magic' = 'code'
) {
  const safeKey = key.padStart(6, '0').slice(-6);
  const primary = source === 'remainder'
    ? safeKey.slice(-2)
    : safeKey.slice(0, 2);
  const secondary = source === 'magic' ? safeKey.slice(2, 4) : secondaryBase;
  const cross = createCross(primary, secondary);
  return { cross, satellites: decryptCross(cross).slice(0, 10) };
}

export function calculateLuckyNumber(
  date: Date,
  luckyDetails: LuckyNumberDetails = extractLuckyNumbersFromDate(date)
): number {
  const values = luckyDetails.luckyNumbers;
  // Universal chooses a caller separately. This helper is the neutral
  // fallback: the largest yellow number of the date, with no date-specific
  // exception or hard-coded lucky number.
  const largest = values.length ? values[values.length - 1] : 27;
  return largest + 63 > 90 ? sumDigits(largest) : largest;
}
