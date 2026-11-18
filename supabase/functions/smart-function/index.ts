/*
 * Supabase Edge Function: smart-function
 *
 * Cette fonction est une lecture publique de l'archive officielle.
 * Les résultats doivent être enregistrés dans public.daily_matrices par
 * l'administrateur ou par un processus serveur de confiance.
 *
 * La publication normale reste gratuite et accessible sans abonnement.
 * La fenêtre de dates futures est contrôlée par l'administration.
 *
 * Deploy with:
 *   supabase functions deploy smart-function
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  baseEntitlementEndDate,
  hasActiveLegacyEarlyAccess,
  hasEarlyAccessGrant,
  readEarlyAccessRule
} from '../_shared.ts';

type MatrixProgramme = {
  country: string;
  name: string;
  hasKeyboard?: boolean;
  hasCerveau?: boolean;
  hour?: number;
  matrix: number[];
  keyboard: number[] | null;
  cerveau: number[] | null;
  code: string;
  event: string;
  date: string;
  ten_numbers: string[];
};

type MatrixArchiveRow = {
  programme_date: string;
  draw_number: number;
  results: MatrixProgramme[];
  created_at: string;
  updated_at: string;
};

type ConfiguredMatrixSource = {
  country_code: string;
  country_name: string;
  draw_name: string;
  draw_time: string;
  matrix: Record<string, unknown>;
  keyboard: Record<string, unknown>;
  cerveau: Record<string, unknown>;
  code: string;
  event: string;
  settings?: Record<string, unknown>;
  enabled: boolean;
};

type GeneratedMatrixValues = {
  matrix: number[];
  keyboard: number[] | null;
  cerveau: number[] | null;
  code: string;
  event: string;
  ten_numbers: string[];
};

type CalculateMatrixBody = {
  programmeDate?: unknown;
  date?: unknown;
};

const TIME_ZONE = 'Africa/Abidjan';
const PROGRAM_GENERATION_TIME = '16:00';
const PROGRAM_GENERATION_HOUR = 16;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

function getAdminClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Les variables SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont absentes.'
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders
  });
}

function canonicalFeatureKey(value: unknown): string {
  const aliases: Record<string, string> = {
    universelle: 'tableaux-universelle',
    intuition: 'tableaux-intuition',
    oracle: 'tableaux-oracle',
    lnb: 'tableaux-lnb',
    balsa: 'tableaux-balsa',
    standby: 'tableaux-standby'
  };
  const key = String(value || '').trim().toLowerCase();
  return aliases[key] || key;
}

function planIncludesFeature(plan: any, featureKey: string): boolean {
  const wanted = canonicalFeatureKey(featureKey);
  const features = Array.isArray(plan?.features)
    ? plan.features.map(canonicalFeatureKey)
    : [];
  if (features.includes(wanted) || features.includes('tableaux')) return true;
  return wanted === 'tableaux'
    && features.some((item: string) => item.startsWith('tableaux-'));
}

function missingAccessTables(error: any): boolean {
  return String(error?.code || '') === '42P01'
    || /subscription_plans|feature_access_rules|user_subscriptions|user_feature_unlocks|relation .* does not exist|column .* does not exist|schema cache/i
      .test(String(error?.message || ''));
}

function optionalSchemaError(error: any, relation: string): boolean {
  return new RegExp(
    `relation .* does not exist|${relation}|column .* does not exist|schema cache`,
    'i'
  ).test(String(error?.message || ''));
}

async function enforceFeatureAccess(
  request: Request,
  featureKey: string
): Promise<Response | null> {
  const client = getAdminClient();
  const wanted = canonicalFeatureKey(featureKey);

  const [plansResult, rulesResult] = await Promise.all([
    client
      .from('subscription_plans')
      .select('slug,features,enabled'),
    client
      .from('feature_access_rules')
      .select('feature_key,plan_slug,required_stars,required_tokens,enabled')
  ]);

  if (
    missingAccessTables(plansResult.error)
    || missingAccessTables(rulesResult.error)
  ) {
    return null;
  }

  if (plansResult.error) throw plansResult.error;
  if (rulesResult.error) throw rulesResult.error;

  const allPlans = plansResult.data || [];
  const enabledPlans = allPlans.filter(
    (plan: any) => plan.enabled !== false
  );
  const enabledPlanSlugs = new Set(
    enabledPlans.map((plan: any) => plan.slug)
  );

  const rule = (rulesResult.data || []).find((item: any) => (
    item.enabled !== false
    && canonicalFeatureKey(item.feature_key) === wanted
    && (
      !item.plan_slug
      || enabledPlanSlugs.has(item.plan_slug)
    )
  ));

  const protectedByOffer = enabledPlans.some(
    (plan: any) => planIncludesFeature(plan, wanted)
  );

  if (
    rule
    && !rule.plan_slug
    && Number(rule.required_stars || 0) <= 0
    && Number(rule.required_tokens || 0) <= 0
    && !protectedByOffer
  ) {
    return null;
  }

  if (!rule && !protectedByOffer) {
    return null;
  }

  const token = request.headers
    .get('Authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim() || '';

  if (!token) {
    return json({
      error: 'Connexion requise pour accéder à cette section.'
    }, 401);
  }

  const session = await client.auth.getUser(token);

  if (
    session.error
    || !session.data?.user?.id
  ) {
    return json({
      error: 'Session invalide.'
    }, 401);
  }

  const userId = session.data.user.id;

  const adminRole = await client
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .maybeSingle();

  if (
    !adminRole.error
    && adminRole.data?.role === 'admin'
  ) {
    return null;
  }

  const principal = await client
    .from('admin_control_settings')
    .select('principal_user_id')
    .eq('id', true)
    .limit(1)
    .maybeSingle();
  if (!principal.error && principal.data?.principal_user_id === userId) {
    return null;
  }

  const now = new Date().toISOString();
  const individualUnlock = await client
    .from('user_feature_unlocks')
    .select('feature_key,expires_at')
    .eq('user_id', userId)
    .eq('feature_key', wanted)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .limit(1)
    .maybeSingle();
  if (individualUnlock.error) {
    if (!missingAccessTables(individualUnlock.error)) {
      throw individualUnlock.error;
    }
  } else if (individualUnlock.data) {
    // Keep a direct programme unlock valid even if the collective offer is
    // disabled or expired.
    return null;
  }

  const subscription = await client
    .from('user_subscriptions')
    .select('plan_slug,status,started_at,expires_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .lte('started_at', now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .maybeSingle();

  if (subscription.error) {
    if (missingAccessTables(subscription.error)) {
      return null;
    }
    throw subscription.error;
  }

  const plan = allPlans.find(
    (item: any) => item.slug === subscription.data?.plan_slug
  );

  const allowed = Boolean(plan)
    && (
      planIncludesFeature(plan, wanted)
      || Boolean(
        rule?.plan_slug
        && rule.plan_slug === plan.slug
      )
    );

  return allowed
    ? null
    : json({
        error: 'Cette section nécessite un abonnement actif.'
      }, 403);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function getProgrammeDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);

  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value);

  const date = new Date(Date.UTC(
    get('year'),
    get('month') - 1,
    get('day') + (get('hour') >= PROGRAM_GENERATION_HOUR ? 1 : 0)
  ));

  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

async function enforceEarlyAccess(
  request: Request,
  featureKey: string,
  requestedProgrammeDate: string
): Promise<Response | null> {
  const wanted = String(featureKey || '').trim().toLowerCase();
  if (!['boules-rejetees', 'matrice', 'croix'].includes(wanted)) {
    return null;
  }

  const client = getAdminClient();
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
  const normalDate = getProgrammeDate(now);
  const currentHour = part('hour');
  const requestedDateObject = new Date(
    `${requestedProgrammeDate}T12:00:00.000Z`
  );
  const normalDateObject = new Date(`${normalDate}T12:00:00.000Z`);
  const dayOffset = Number.isNaN(requestedDateObject.getTime())
    || Number.isNaN(normalDateObject.getTime())
    ? 0
    : Math.floor(
      (requestedDateObject.getTime() - normalDateObject.getTime()) / 86400000
    );
  const isNormalDate = requestedProgrammeDate === normalDate;
  const isFutureDate = dayOffset > 0;

  if (isFutureDate) {
    const previewToken = request.headers
      .get('Authorization')
      ?.replace(/^Bearer\s+/i, '')
      .trim() || '';
    if (previewToken) {
      const previewSession = await client.auth.getUser(previewToken);
      if (!previewSession.error && previewSession.data?.user?.id) {
        const previewRole = await client
          .from('user_roles')
          .select('role')
          .eq('user_id', previewSession.data.user.id)
          .eq('role', 'admin')
          .maybeSingle();
        if (!previewRole.error && previewRole.data?.role === 'admin') {
          return null;
        }
      }
    }
  }

  if (ruleResult.error) {
    if (optionalSchemaError(ruleResult.error, 'feature_early_access_rules')) {
      return isFutureDate
        ? currentHour < PROGRAM_GENERATION_HOUR
          ? json({
              error: 'Cette publication sera disponible à 16h.',
              code: 'PUBLIC_RELEASE_NOT_AVAILABLE',
              featureKey: wanted,
              programmeDate: requestedProgrammeDate,
              releaseHour: PROGRAM_GENERATION_HOUR
            }, 425)
          : json({
              error: 'Cette publication anticipée n’est pas configurée.',
              code: 'EARLY_ACCESS_DISABLED',
              featureKey: wanted,
              programmeDate: requestedProgrammeDate
            }, 403)
        : null;
    }
    throw ruleResult.error;
  }

  if (!isNormalDate && !isFutureDate) return null;

  // The normal publication remains free and visible all day.
  if (isNormalDate) return null;

  const rule = ruleResult.data;
  if (!rule || rule.enabled !== true) {
    return json({
      error: 'Cette publication anticipée n’est pas activée.',
      code: 'EARLY_ACCESS_DISABLED',
      featureKey: wanted,
      programmeDate: requestedProgrammeDate
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
      programmeDate: requestedProgrammeDate,
      previewDays
    }, 403);
  }

  const token = request.headers
    .get('Authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim() || '';
  if (!token) {
    return json({
      error: 'Débloquez cette publication pour la recevoir dès maintenant.',
      code: 'EARLY_ACCESS_REQUIRED',
      featureKey: wanted,
      programmeDate: requestedProgrammeDate,
      releaseHour: PROGRAM_GENERATION_HOUR,
      requiredTokens: Math.max(1, Number(rule.required_tokens) || 1)
    }, 403);
  }

  const session = await client.auth.getUser(token);
  if (session.error || !session.data?.user?.id) {
    return json({ error: 'Session invalide.' }, 401);
  }

  const userId = session.data.user.id;
  const adminRole = await client
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .maybeSingle();
  if (!adminRole.error && adminRole.data?.role === 'admin') {
    return null;
  }

  const entitlementEndDate = await baseEntitlementEndDate(
    client,
    userId,
    wanted
  );
  if (entitlementEndDate && requestedProgrammeDate > entitlementEndDate) {
    return json({
      error: 'Votre droit d’accès au programme expire avant cette publication.',
      code: 'BASE_ACCESS_EXPIRES_BEFORE_PROGRAM',
      featureKey: wanted,
      programmeDate: requestedProgrammeDate,
      entitlementEndDate
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
    .eq('programme_date', requestedProgrammeDate)
    .maybeSingle();
  if (unlock.error) {
    if (optionalSchemaError(unlock.error, 'user_feature_early_access')) {
      return json({
        error: 'L’accès anticipé n’est pas encore configuré.'
      }, 403);
    }
    throw unlock.error;
  }

  if (currentHour < PROGRAM_GENERATION_HOUR && !unlock.data) {
    return json({
      error: 'Cette publication sera disponible à 16h, sauf pour un accès anticipé déjà activé.',
      code: 'PUBLIC_RELEASE_NOT_AVAILABLE',
      featureKey: wanted,
      programmeDate: requestedProgrammeDate,
      releaseHour: PROGRAM_GENERATION_HOUR
    }, 425);
  }

  return unlock.data
    ? null
    : json({
        error: 'Débloquez cette publication pour la recevoir dès maintenant.',
        code: 'EARLY_ACCESS_REQUIRED',
        featureKey: wanted,
        programmeDate: requestedProgrammeDate,
        releaseHour: PROGRAM_GENERATION_HOUR,
        requiredTokens: Math.max(1, Number(rule.required_tokens) || 1)
      }, 403);
}

function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function canonicalMatrixCountry(value: unknown): string {
  const raw = String(value || '').trim();
  const key = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const aliases: Record<string, string> = {
    benin: 'Bénin',
    'cote d ivoire': "Côte d'Ivoire",
    'ivory coast': "Côte d'Ivoire",
    ghana: 'Ghana',
    niger: 'Niger',
    senegal: 'Sénégal',
    togo: 'Togo'
  };
  return aliases[key] || raw;
}

/*
 * Sources de secours pour la publication normale. Elles permettent au moteur
 * de produire les programmes du jour même lorsqu'aucune archive n'a encore
 * été matérialisée et qu'aucune source n'a été saisie dans l'administration.
 * Elles ne changent pas le calcul des sources administratives existantes.
 */
function defaultMatrixSources(): ConfiguredMatrixSource[] {
  const sources: Array<
    [string, string, string, string, boolean, boolean]
  > = [
    ["CI", "Côte d'Ivoire", "Côte d'Ivoire Digital 7h", "07:00", true, false],
    ["CI", "Côte d'Ivoire", "Côte d'Ivoire 10h", "10:00", false, false],
    ["CI", "Côte d'Ivoire", "Côte d'Ivoire 13h", "13:00", true, false],
    ["CI", "Côte d'Ivoire", "Côte d'Ivoire 16h", "16:00", false, false],
    ["CI", "Côte d'Ivoire", "Côte d'Ivoire Matrice 8h", "08:00", false, false],
    ["CI", "Côte d'Ivoire", "Côte d'Ivoire Matrice 22h", "22:00", false, false],
    ["GH", "Ghana", "Ghana", "12:00", true, true],
    ["TG", "Togo", "Lonato Togo 9h", "09:00", true, false],
    ["TG", "Togo", "Lonato Togo 13h", "13:00", false, false],
    ["TG", "Togo", "Lonato Togo 18h", "18:00", false, true],
    ["NE", "Niger", "Soudji Niger", "20:00", true, false],
    ["BJ", "Bénin", "LNB Bénin 11h", "11:00", false, false],
    ["BJ", "Bénin", "LNB Bénin 14h", "14:00", true, false],
    ["BJ", "Bénin", "LNB Bénin 18h", "18:00", true, false],
    ["SN", "Sénégal", "Sénégal 11h", "11:00", false, false],
    ["SN", "Sénégal", "Sénégal 13h", "13:00", true, false],
    ["SN", "Sénégal", "Sénégal 15h", "15:00", false, false],
    ["SN", "Sénégal", "Sénégal 17h", "17:00", true, false]
  ];

  return sources.map(([
    countryCode,
    countryName,
    drawName,
    drawTime,
    hasKeyboard,
    hasCerveau
  ]) => ({
    country_code: countryCode,
    country_name: countryName,
    draw_name: drawName,
    draw_time: drawTime,
    matrix: {},
    keyboard: {},
    cerveau: {},
    code: '',
    event: '',
    settings: {
      generation: 'universal-matrix-v1',
      generationTime: PROGRAM_GENERATION_TIME,
      generationTimeZone: TIME_ZONE,
      generationScope: 'global',
      hasKeyboard,
      hasCerveau,
      hasCode: true,
      hasEvent: true
    },
    enabled: true
  })) as ConfiguredMatrixSource[];
}

/*
 * An administrator source is an override for one country/hour slot, not a
 * replacement for the built-in catalogue. Keep every default country and
 * merge the configured rows on top so adding (for example) Bénin at 08:00
 * cannot make Côte d'Ivoire, Ghana, Togo, etc. disappear.
 */
function matrixSourceSlot(source: ConfiguredMatrixSource): string {
  const country = String(source.country_code || '').trim().toUpperCase();
  const hour = String(source.draw_time || '').trim().slice(0, 2);
  return `${country}|${hour}`;
}

function mergeMatrixSources(
  configuredSources: ConfiguredMatrixSource[] = []
): ConfiguredMatrixSource[] {
  const configuredBySlot = new Map(
    configuredSources.map((source) => [matrixSourceSlot(source), source])
  );
  const defaults = defaultMatrixSources();
  const merged = defaults.map((source) => (
    configuredBySlot.get(matrixSourceSlot(source)) || source
  ));
  const defaultSlots = new Set(merged.map(matrixSourceSlot));
  configuredSources.forEach((source) => {
    if (!defaultSlots.has(matrixSourceSlot(source))) merged.push(source);
  });
  return merged.sort((left, right) => (
    left.country_name.localeCompare(right.country_name)
    || String(left.draw_time).localeCompare(String(right.draw_time))
  ));
}

async function readArchivedMatrix(
  programmeDate: string
): Promise<MatrixArchiveRow | null> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('daily_matrices')
    .select('programme_date, draw_number, results, created_at, updated_at')
    .eq('programme_date', programmeDate)
    .maybeSingle();

  if (error) {
    if (optionalSchemaError(error, 'daily_matrices')) {
      return null;
    }
    throw error;
  }
  return data as MatrixArchiveRow | null;
}

function arrayFromSource(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    return value.map(Number).filter((item) => Number.isFinite(item));
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['numbers', 'values', 'result', 'results']) {
      if (Array.isArray(record[key])) return arrayFromSource(record[key]);
    }
  }
  return null;
}

function createSeededGenerator(seedText: string) {
  let seed = 2166136261;
  for (const character of seedText) {
    seed ^= character.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function generatedNumberList(random: () => number, count: number, min: number, max: number) {
  const values = new Set<number>();
  while (values.size < count) {
    values.add(min + Math.floor(random() * (max - min + 1)));
  }
  return [...values];
}

function generatedDigitString(random: () => number, count: number) {
  return Array.from({ length: count }, () => Math.floor(random() * 10)).join('');
}

/*
 * L'évent est dérivé du code, il ne doit plus être tiré séparément.
 *
 * La règle est : ajouter le chiffre 1 au code, puis chercher l'ordre des
 * quatre chiffres qui équilibre les deux paires. Ainsi 234 devient 1234,
 * puis 1423 car 1 + 4 = 2 + 3 = 5. Si aucun équilibre exact n'existe
 * (par exemple avec certains codes contenant des zéros), l'ordre qui
 * minimise l'écart est retenu afin de toujours produire un évent cohérent.
 */
function deriveMatrixEvent(code: string): string {
  const codeDigits = String(code || '').replace(/\D/g, '').slice(0, 3);
  if (codeDigits.length !== 3) return '';

  const digits = ['1', ...codeDigits.split('')];
  let best = '';
  let bestDifference = Number.POSITIVE_INFINITY;
  const seen = new Set<string>();

  for (let first = 0; first < digits.length; first += 1) {
    for (let second = 0; second < digits.length; second += 1) {
      if (second === first) continue;
      for (let third = 0; third < digits.length; third += 1) {
        if (third === first || third === second) continue;
        for (let fourth = 0; fourth < digits.length; fourth += 1) {
          if (fourth === first || fourth === second || fourth === third) continue;
          const candidate = `${digits[first]}${digits[second]}${digits[third]}${digits[fourth]}`;
          if (seen.has(candidate)) continue;
          seen.add(candidate);

          const difference = Math.abs(
            Number(candidate[0]) + Number(candidate[1])
              - Number(candidate[2]) - Number(candidate[3])
          );
          if (
            difference < bestDifference
            || (difference === bestDifference && (!best || candidate < best))
          ) {
            best = candidate;
            bestDifference = difference;
          }
        }
      }
    }
  }

  return best;
}

function generateSourceValues(
  source: ConfiguredMatrixSource,
  programmeDate: string
): GeneratedMatrixValues {
  const settings = source.settings || {};
  const random = createSeededGenerator(
    `${source.country_code}|${source.country_name}|${source.draw_name}|${source.draw_time}|${programmeDate}`
  );
  const hasKeyboard = settings.hasKeyboard !== false;
  const hasCerveau = settings.hasCerveau === true;
  const hasCode = settings.hasCode !== false;
  const hasEvent = settings.hasEvent !== false;
  const matrix = generatedNumberList(random, 4, 100, 999);
  const keyboard = hasKeyboard ? generatedNumberList(random, 4, 100, 999) : null;
  const cerveau = hasCerveau ? generatedNumberList(random, 4, 100, 999) : null;
  const code = hasCode ? generatedDigitString(random, 3) : '';
  // Advance the seeded stream exactly as before; only the event rule changes.
  if (hasEvent) generatedDigitString(random, 4);
  const tenNumbers = generatedNumberList(random, 10, 1, 90)
    .sort((left, right) => left - right)
    .map((value) => String(value).padStart(2, '0'));
  return {
    matrix,
    keyboard,
    cerveau,
    code,
    event: hasEvent ? deriveMatrixEvent(code) : '',
    ten_numbers: tenNumbers
  };
}

function configuredSourceToProgram(
  source: ConfiguredMatrixSource,
  programmeDate = ''
): MatrixProgramme {
  const hour = Number(String(source.draw_time || '').slice(0, 2));
  const generated = source.settings?.generation === 'universal-matrix-v1'
    ? generateSourceValues(source, programmeDate)
    : null;
  const matrix = generated?.matrix || arrayFromSource(source.matrix) || [];
  const keyboard = generated
    ? generated.keyboard
    : arrayFromSource(source.keyboard);
  const cerveau = generated
    ? generated.cerveau
    : arrayFromSource(source.cerveau);
  const tenNumbers = generated
    ? generated.ten_numbers
    : Array.isArray(source.settings?.ten_numbers)
      ? source.settings.ten_numbers.map(String).slice(0, 10)
      : [];
  return {
    country: canonicalMatrixCountry(source.country_name),
    name: source.draw_name,
    hasKeyboard: Boolean(keyboard?.length),
    hasCerveau: Boolean(cerveau?.length),
    hour: Number.isFinite(hour) ? hour : undefined,
    matrix,
    keyboard,
    cerveau,
    code: (generated?.code ?? source.code) || '',
    event: (generated?.event ?? source.event) || '',
    date: programmeDate,
    ten_numbers: tenNumbers
  };
}

function responseFromArchive(
  archive: MatrixArchiveRow,
  effectiveSources: ConfiguredMatrixSource[] = []
) {
  const results = Array.isArray(archive.results)
    ? archive.results.map((item: any) => {
        const derivedEvent = deriveMatrixEvent(String(item?.code || ''));
        const country = canonicalMatrixCountry(item?.country);
        const normalized = country && country !== item?.country
          ? { ...item, country }
          : item;
        return derivedEvent ? { ...normalized, event: derivedEvent } : normalized;
      })
    : [];
  const existing = new Set(results.map((item: any) =>
    `${String(item?.country || item?.name || '').trim().toUpperCase()}|${String(item?.hour ?? '')}`));
  effectiveSources.forEach((source) => {
    const hour = Number(String(source.draw_time || '').slice(0, 2));
    const countryName = canonicalMatrixCountry(source.country_name);
    const signatures = [
      `${source.country_code}|${hour}`,
      `${countryName.trim().toUpperCase()}|${hour}`,
      `${source.draw_name.trim().toUpperCase()}|${hour}`
    ];
    if (!signatures.some((signature) => existing.has(signature))) {
      results.push(configuredSourceToProgram(source, archive.programme_date));
    }
  });
  return {
    results,
    meta: {
      drawNumber: archive.draw_number,
      programmeDate: archive.programme_date,
      timeZone: TIME_ZONE,
      generationTime: PROGRAM_GENERATION_TIME,
      generatedAt: archive.created_at,
      updatedAt: archive.updated_at,
      source: 'database',
      persisted: true
    }
  };
}

async function readConfiguredMatrixSources(): Promise<ConfiguredMatrixSource[]> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('admin_draw_sources')
    .select('country_code,country_name,draw_name,draw_time,matrix,keyboard,cerveau,code,event,settings,enabled')
    .eq('module_key', 'matrice')
    .eq('enabled', true)
    .order('country_name')
    .order('draw_time');
  if (error) {
    if (optionalSchemaError(error, 'admin_draw_sources')) {
      return [];
    }
    throw error;
  }
  return (data || []) as ConfiguredMatrixSource[];
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Méthode non autorisée.' }, 405);
  }

  try {
    let body: CalculateMatrixBody = {};
    try {
      body = await request.json();
    } catch (_) {
      return json({ error: 'Le corps de la requête doit être un JSON valide.' }, 400);
    }

    // Accept both names during the rolling deployment. The browser uses
    // programmeDate, while older Supabase test snippets used date.
    const requestedDate = body?.programmeDate ?? body?.date;
    const programmeDate = requestedDate == null
      ? getProgrammeDate()
      : (isValidIsoDate(requestedDate) ? requestedDate : null);

    if (!programmeDate) {
      return json({
        error: 'programmeDate doit être une date ISO valide (YYYY-MM-DD).'
      }, 400);
    }

    const denied = await enforceFeatureAccess(request, 'matrice');
    if (denied) return denied;

    const earlyDenied = await enforceEarlyAccess(request, 'matrice', programmeDate);
    if (earlyDenied) return earlyDenied;

    const configuredSources = await readConfiguredMatrixSources();
    const effectiveSources = mergeMatrixSources(configuredSources);
    const archived = await readArchivedMatrix(programmeDate);

    if (!archived) {
      return json({
        results: effectiveSources.map(
          (source) => configuredSourceToProgram(source, programmeDate)
        ),
        meta: {
          programmeDate,
          timeZone: TIME_ZONE,
          generationTime: PROGRAM_GENERATION_TIME,
          source: configuredSources.length
            ? 'admin-configuration+defaults'
            : 'default-generation',
          persisted: false
        }
      });
    }

    return json(responseFromArchive(archived, effectiveSources));
  } catch (error) {
    console.error('smart-function read failed', error);
    return json({
      error: 'Impossible de lire la matrice archivée.'
    }, 500);
  }
});
