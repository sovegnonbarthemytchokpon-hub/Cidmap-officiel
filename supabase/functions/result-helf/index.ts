/*
 * Résultat-Aide — mémoire des tirages et contrôleur d'évaluation.
 *
 * Les archives daily_*_programs restent privées. Cette fonction prend un
 * snapshot par pays/date, évalue uniquement un tirage publié, puis sépare :
 *   - la réponse publique : résultats déjà publiés et pourcentages agrégés ;
 *   - la réponse administrateur : heures, clés, numéros, correspondances et
 *     trafic.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildPublicSuggestions,
  buildDayOfWeekStats,
  buildDelayStats,
  buildWeeklyStats,
  comparePublishedDraw,
  comparePublishedDraws,
  RESULTAT_AIDE_DELAY_OFFSETS,
  type PredictionMatch,
  type ProgramPredictionSnapshot,
  type RealDraw
} from '../result-helf.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

const PROGRAMS = [
  ['daily_universal_programs', 'universelle', 'Universelle'],
  ['daily_intuition_programs', 'intuition', 'Intuition'],
  ['daily_oracle_programs', 'oracle', 'Oracle'],
  ['daily_lnb_programs', 'lnb', 'LNB'],
  ['daily_balsa_programs', 'balsa', 'Balsa Plus']
] as const;
const HISTORY_RESULTS_FEATURE = 'historique-resultats';

const AUTHORIZED_PROGRAMS = [
  'universelle',
  'intuition',
  'oracle',
  'lnb',
  'balsa',
  'standby',
  'robot',
  'created',
  'croix',
  'matrice',
  'boules-rejetees',
  'dechiffrement-plus'
] as const;

const COUNTRY_ALIASES: Record<string, string> = {
  benin: 'BJ',
  bj: 'BJ',
  'cote d ivoire': 'CI',
  'cote divoire': 'CI',
  'ivory coast': 'CI',
  ci: 'CI',
  ghana: 'GH',
  gh: 'GH',
  cameroun: 'CM',
  cameroon: 'CM',
  cm: 'CM',
  suisse: 'CH',
  switzerland: 'CH',
  ch: 'CH',
  niger: 'NE',
  ne: 'NE',
  guinee: 'GN',
  guinea: 'GN',
  gn: 'GN',
  senegal: 'SN',
  sn: 'SN',
  togo: 'TG',
  tg: 'TG'
};

const json = (body: unknown, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: corsHeaders }
);

const nowIso = () => new Date().toISOString();
const isEnglishLocale = (value: unknown) => (
  String(value || '').trim().toLowerCase().startsWith('en')
);
const localeGroup = (value: unknown) => (
  String(value || 'fr').trim().toLowerCase().split(/[-_]/)[0] || 'fr'
);
const SERVER_MESSAGES: Record<string, Record<string, string>> = {
  fr: {
    published: 'Résultat reçu et publié directement. Il est maintenant disponible pour les consultations et les statistiques.',
    pending: 'Résultat reçu et enregistré en attente de confirmation par un abonné actif ou par l’administration. Il n’est pas encore visible publiquement.',
    confirmed: 'Résultat confirmé et publié dans la section Résultats.',
    warning: ' Les statistiques seront synchronisées prochainement.'
  },
  en: {
    published: 'Result received and published directly. It is now available for viewing and statistics.',
    pending: 'Result received and saved pending confirmation by an active subscriber or the administration. It is not public yet.',
    confirmed: 'Result confirmed and published in the Results section.',
    warning: ' Statistics will be synchronized shortly.'
  },
  es: {
    published: 'Resultado recibido y publicado directamente. Ya está disponible para consulta y estadísticas.',
    pending: 'Resultado recibido y guardado a la espera de la confirmación de un suscriptor activo o de la administración. Aún no es público.',
    confirmed: 'Resultado confirmado y publicado en la sección Resultados.',
    warning: ' Las estadísticas se sincronizarán pronto.'
  },
  pt: {
    published: 'Resultado recebido e publicado diretamente. Já está disponível para consulta e estatísticas.',
    pending: 'Resultado recebido e guardado aguardando a confirmação de um assinante ativo ou da administração. Ainda não é público.',
    confirmed: 'Resultado confirmado e publicado na seção Resultados.',
    warning: ' As estatísticas serão sincronizadas em breve.'
  },
  ar: {
    published: 'تم استلام النتيجة ونشرها مباشرة. أصبحت متاحة الآن للعرض والإحصاءات.',
    pending: 'تم استلام النتيجة وحفظها بانتظار تأكيد مشترك نشط أو الإدارة. لم تصبح عامة بعد.',
    confirmed: 'تم تأكيد النتيجة ونشرها في قسم النتائج.',
    warning: ' ستتم مزامنة الإحصاءات قريباً.'
  }
};
const serverMessage = (locale: unknown, key: string) => (
  SERVER_MESSAGES[localeGroup(locale)]?.[key]
    || SERVER_MESSAGES.fr[key]
    || ''
);

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Configuration Supabase serveur incomplète.');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function parseDate(value: unknown): string {
  const date = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function dateDistance(left: string, right: string): number {
  return Math.round((
    Date.parse(`${right}T12:00:00.000Z`)
    - Date.parse(`${left}T12:00:00.000Z`)
  ) / 86400000);
}

function foldCountry(value: unknown): string {
  return String(value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ');
}

function numberList(value: unknown, max = 5): number[] {
  const values = Array.isArray(value)
    ? value
    : String(value || '').split(/[,\s;|+]+/);
  return [...new Set(values
    .map((item) => Number(String(item).replace(/[^\d-]/g, '')))
    .filter((item) => Number.isInteger(item) && item >= 1 && item <= 90))]
    .slice(0, max);
}

function normalizeInputSchema(
  value: unknown,
  first: number[],
  machine: number[],
  bonus: number[]
) {
  const requested = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const groups = [
    {
      key: 'first',
      count: first.length,
      required: true
    },
    ...(machine.length
      ? [{
          key: 'second',
          count: machine.length,
          required: true
        }]
      : [])
  ];
  return {
    version: 1,
    groups,
    bonus: {
      enabled: bonus.length > 0,
      count: bonus.length
    },
    requestedGroups: Array.isArray(requested.groups)
      ? requested.groups.length
      : groups.length
  };
}

// National lotteries that only publish the five winning numbers. Visitors
// cannot attach Machine or Bonus groups to these countries.
const COUNTRIES_WITHOUT_EXTRA_GROUPS = new Set(['NE']);

function countryCode(value: unknown): string {
  const folded = foldCountry(value);
  if (folded === 'tous' || folded === 'all') return '';
  if (COUNTRY_ALIASES[folded]) return COUNTRY_ALIASES[folded];
  return folded.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8);
}

function historyToday() {
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

function historySubtractDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateText;
  date.setUTCDate(date.getUTCDate() - Math.max(0, days));
  return date.toISOString().slice(0, 10);
}

async function resultHistoryGate(client: any, user: any) {
  const ruleResult = await client.from('feature_access_rules')
    .select('feature_key,enabled,history_free_days,required_tokens,required_stars,plan_slug')
    .eq('feature_key', HISTORY_RESULTS_FEATURE)
    .maybeSingle();
  if (ruleResult.error && !/feature_access_rules|history_free_days|relation .* does not exist|column .* does not exist|schema cache/i.test(String(ruleResult.error.message || ''))) {
    throw ruleResult.error;
  }
  const rule = ruleResult.data || null;
  const today = historyToday();
  const freeDays = Math.max(0, Number(rule?.history_free_days) || 0);
  if (!rule || rule.enabled === false) {
    return { cutoff: '1900-01-01', unlocked: true };
  }
  if (!user?.id) {
    return { cutoff: historySubtractDays(today, freeDays), unlocked: false };
  }
  if (
    !rule.plan_slug
    && Number(rule.required_tokens || 0) <= 0
    && Number(rule.required_stars || 0) <= 0
  ) {
    return { cutoff: '1900-01-01', unlocked: true };
  }
  const [roles, unlock, subscription] = await Promise.all([
    client.from('user_roles').select('role').eq('user_id', user.id)
      .in('role', ['admin', 'moderator']).limit(1),
    client.from('user_feature_unlocks').select('feature_key,expires_at')
      .eq('user_id', user.id)
      .in('feature_key', [HISTORY_RESULTS_FEATURE, 'historique-tous'])
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('expires_at', { ascending: false, nullsFirst: true })
      .limit(2),
    client.from('user_subscriptions').select('plan_slug,status,expires_at')
      .eq('user_id', user.id).eq('status', 'active')
      .lte('started_at', new Date().toISOString())
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).maybeSingle()
  ]);
  const administrator = !roles.error && ['admin', 'moderator'].includes(String(roles.data?.[0]?.role || ''));
  let plan: any = null;
  if (subscription.data?.plan_slug) {
    const planResult = await client.from('subscription_plans')
      .select('slug,features,enabled').eq('slug', subscription.data.plan_slug).maybeSingle();
    plan = planResult.data || null;
  }
  const features = Array.isArray(plan?.features)
    ? plan.features.map((feature: unknown) => String(feature || '').trim().toLowerCase())
    : [];
  const planAccess = subscription.data && plan?.enabled !== false
    && (features.includes(HISTORY_RESULTS_FEATURE)
      || features.includes('historique-tous')
      || (rule.plan_slug && rule.plan_slug === plan.slug));
  return {
    cutoff: historySubtractDays(today, freeDays),
    unlocked: administrator
      || (Array.isArray(unlock.data) && unlock.data.length > 0)
      || Boolean(planAccess)
  };
}

function isValidTime(value: unknown): boolean {
  return !value || /^\d{2}:\d{2}(:\d{2})?$/.test(String(value));
}

function weekKey(dateText: string): string {
  const date = new Date(`${dateText}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - start.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function weekBounds(value: unknown): [string, string] | null {
  const match = String(value || '').match(/^(\d{4})-W(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return [monday.toISOString().slice(0, 10), sunday.toISOString().slice(0, 10)];
}

function numbersFromAny(value: unknown): number[] {
  if (Array.isArray(value)) return numberList(value, 90);
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    if (Array.isArray(item.numbers)) return numberList(item.numbers, 90);
    return numberList(item.value ?? item.number ?? item.result, 90);
  }
  return numberList(value, 90);
}

function satelliteDetailsFromPayload(payload: any) {
  const satellites = Array.isArray(payload?.satellites) ? payload.satellites : [];
  return satellites.map((satellite: any) => ({
    value: Number(satellite?.value),
    combinations: (Array.isArray(satellite?.combinations)
      ? satellite.combinations
      : []).map((parts: any, index: number) => ({
        label: `${satellite?.value || ''} · combinaison ${index + 1}`,
        satelliteValue: Number(satellite?.value),
        combinationIndex: index + 1,
        numbers: numbersFromAny(Array.isArray(parts)
          ? parts.map((part: any) => part?.value ?? part)
          : parts)
      })).filter((item: { numbers: number[] }) => item.numbers.length >= 2)
  })).filter((item: { value: number }) => Number.isInteger(item.value));
}

function predictionFromArchive(
  row: any,
  country: string,
  programKey: string,
  programName: string
): ProgramPredictionSnapshot {
  const payload = row?.payload || {};
  const nap = payload?.nap || {};
  const snapshotId = `${country}:${row.programme_date}:${programKey}`;
  return {
    snapshotId,
    countryCode: country,
    programmeDate: String(row.programme_date),
    drawTime: null,
    programKey,
    programName,
    key: payload.key ?? null,
    order: payload.order ?? null,
    cross: payload.cross
      ? numbersFromAny([
          payload.cross.top,
          payload.cross.bottom,
          payload.cross.left,
          payload.cross.right
        ])
      : [],
    satellites: Array.isArray(payload.satellites)
      ? payload.satellites.flatMap((item: any) => numbersFromAny(item?.value))
      : [],
    satelliteDetails: satelliteDetailsFromPayload(payload),
    nap1: numbersFromAny(nap.nap1),
    nap2: numbersFromAny(nap.nap2),
    combinations: satelliteDetailsFromPayload(payload).flatMap(
      (satellite: any) => satellite.combinations
    ),
    createdAt: String(row.updated_at || row.created_at || nowIso()),
    calculationVersion: payload.calculationVersion ?? null
  };
}

async function readPredictions(
  client: any,
  country: string,
  date: string
): Promise<ProgramPredictionSnapshot[]> {
  const dates = [...new Set(
    RESULTAT_AIDE_DELAY_OFFSETS
      .map((offset) => {
        const value = new Date(`${date}T12:00:00.000Z`);
        value.setUTCDate(value.getUTCDate() - offset);
        return value.toISOString().slice(0, 10);
      })
  )];
  const results = await Promise.all(dates.flatMap((programmeDate) => (
    PROGRAMS.map(async ([table, key, name]) => {
      const result = await client
        .from(table)
        .select('programme_date,payload,created_at,updated_at')
        .eq('programme_date', programmeDate)
        .maybeSingle();
      // A deployment can enable a program table later. Missing optional
      // programs must not prevent the other four from being evaluated.
      if (result.error || !result.data?.payload) return null;
      return predictionFromArchive(result.data, country, key, name);
    })
  )));
  return results.filter(Boolean) as ProgramPredictionSnapshot[];
}

async function authenticate(client: any, request: Request) {
  const token = request.headers.get('Authorization')
    ?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { user: null, isAdmin: false };
  const session = await client.auth.getUser(token);
  if (session.error || !session.data?.user?.id) return { user: null, isAdmin: false };
  const user = session.data.user;
  const role = await client.from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .in('role', ['admin', 'moderator'])
    .limit(1)
    .maybeSingle();
  const principal = await client.from('admin_control_settings')
    .select('principal_user_id')
    .eq('id', true)
    .limit(1)
    .maybeSingle();
  const roleName = role.error ? '' : String(role.data?.role || '');
  const principalUserId = principal.error
    ? ''
    : String(principal.data?.principal_user_id || '');
  return {
    user,
    role: roleName,
    principal: principalUserId === user.id,
    isAdmin: ['admin', 'moderator'].includes(roleName)
      || principalUserId === user.id
  };
}

async function requireAdmin(client: any, request: Request) {
  const auth = await authenticate(client, request);
  return auth.isAdmin ? auth : null;
}

async function requirePrincipalAdmin(client: any, request: Request) {
  const auth = await authenticate(client, request);
  return auth.isAdmin && (auth.role === 'admin' || auth.principal) ? auth : null;
}

function canonicalProgramKey(value: unknown): string {
  return String(value || '').trim().toLowerCase()
    .replace(/^tableaux-/, '')
    .replace(/[_\s]+/g, '-')
    .replace(/^balsa-plus$/, 'balsa')
    .replace(/^stand-by$/, 'standby');
}

function missingRelation(error: any, relation: string): boolean {
  return Boolean(error)
    && new RegExp(`(?:relation .*${relation}|${relation}).*(?:does not exist|schema cache)`, 'i')
      .test(String(error.message || ''));
}

function planIncludesProgram(plan: any, programKey: string): boolean {
  const features = Array.isArray(plan?.features)
    ? plan.features.map(canonicalProgramKey)
    : [];
  return features.includes('tableaux')
    || features.includes(canonicalProgramKey(programKey));
}

async function readActivePlanAccess(client: any, userId: string) {
  const now = new Date().toISOString();
  const [subscription, unlocks, roleResult, principalResult] = await Promise.all([
    client.from('user_subscriptions')
      .select('id,plan_slug,status,started_at,expires_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .lte('started_at', now)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .maybeSingle(),
    client.from('user_feature_unlocks')
      .select('feature_key,unlocked_at,expires_at')
      .eq('user_id', userId)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('feature_key', { ascending: true }),
    client.from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .in('role', ['admin', 'moderator'])
      .limit(1),
    client.from('admin_control_settings')
      .select('principal_user_id')
      .eq('id', true)
      .limit(1)
      .maybeSingle()
  ]);
  if (subscription.error) throw subscription.error;
  if (unlocks.error && !missingRelation(unlocks.error, 'user_feature_unlocks')) {
    throw unlocks.error;
  }
  if (roleResult.error && !missingRelation(roleResult.error, 'user_roles')) {
    throw roleResult.error;
  }
  if (principalResult.error && !missingRelation(principalResult.error, 'admin_control_settings')) {
    throw principalResult.error;
  }

  let plan = null;
  if (subscription.data?.plan_slug) {
    const result = await client.from('subscription_plans')
      .select('slug,display_name,enabled,features')
      .eq('slug', subscription.data.plan_slug)
      .maybeSingle();
    if (result.error) throw result.error;
    plan = result.data || null;
  }

  const isAdmin = roleResult.data?.[0]?.role === 'admin'
    || principalResult.data?.principal_user_id === userId;
  const isModerator = roleResult.data?.[0]?.role === 'moderator';
  const activeSubscription = Boolean(subscription.data && plan?.enabled !== false);
  const individualUnlocks = (unlocks.error ? [] : (unlocks.data || []))
    .filter((item: any) => !item?.expires_at || Date.parse(item.expires_at) > Date.now())
    .map((item: any) => ({
      featureKey: String(item.feature_key || ''),
      unlockedAt: item.unlocked_at || null,
      expiresAt: item.expires_at || null
    }));
  const individualPrograms = individualUnlocks
    .map((item: any) => canonicalProgramKey(item.featureKey))
    .filter(Boolean);
  const authorizedPrograms = AUTHORIZED_PROGRAMS.filter((programKey) => (
    isAdmin
      || isModerator
      || (activeSubscription && planIncludesProgram(plan, programKey))
      || individualPrograms.includes(programKey)
  ));
  const source = isAdmin || isModerator
    ? 'administration'
    : activeSubscription && individualPrograms.length
      ? 'collectif_et_individuel'
      : activeSubscription
        ? 'collectif'
        : individualPrograms.length
          ? 'individuel'
          : 'aucun';
  return {
    active: Boolean(activeSubscription || individualPrograms.length || isAdmin || isModerator),
    isAdmin,
    isModerator,
    scope: {
      source,
      authorizedPrograms,
      individual: individualPrograms,
      collective: activeSubscription
    },
    individualUnlocks,
    subscription: activeSubscription && subscription.data
      ? {
          planSlug: subscription.data.plan_slug,
          planName: plan?.display_name || subscription.data.plan_slug,
          startedAt: subscription.data.started_at,
          expiresAt: subscription.data.expires_at,
          features: Array.isArray(plan?.features) ? plan.features : []
        }
      : null
  };
}

async function recordTraffic(
  client: any,
  eventType: string,
  request: Request,
  country: string | null,
  userId: string | null = null,
  metadata: Record<string, unknown> = {}
) {
  await client.from('resultat_aide_traffic_events').insert({
    event_type: eventType,
    country_code: country || null,
    path: new URL(request.url).pathname,
    actor_user_id: userId,
    metadata
  });
}

async function storeSnapshots(
  client: any,
  predictions: ProgramPredictionSnapshot[]
) {
  if (!predictions.length) return;
  const rows = predictions.map((prediction) => ({
    country_code: prediction.countryCode,
    programme_date: prediction.programmeDate,
    program_key: prediction.programKey,
    program_name: prediction.programName,
    payload: prediction,
    captured_at: nowIso()
  }));
  const result = await client.from('resultat_aide_prediction_snapshots')
    .upsert(rows, { onConflict: 'country_code,programme_date,program_key' })
    .select('id,country_code,programme_date,program_key,program_name,payload,captured_at');
  if (result.error) throw result.error;
  return result.data || [];
}

function dbMatch(
  match: PredictionMatch,
  drawId: string,
  snapshotId: string,
  drawTime: string | null
) {
  return {
    draw_id: drawId,
    snapshot_id: snapshotId,
    country_code: match.countryCode,
    programme_date: match.programmeDate,
    draw_time: drawTime,
    program_key: match.programKey,
    program_name: match.programName,
    prediction_kind: match.kind,
    predicted_numbers: match.predictedNumbers,
    matched_numbers: match.matchedNumbers,
    matched_groups: match.matchedGroups,
    match_level: match.level,
    hit: match.hit,
    draw_date: match.drawDate,
    day_offset: match.dayOffset,
    prediction_day: match.predictionDay,
    draw_day: match.drawDay,
    prediction_label: match.predictionLabel || '',
    satellite_value: match.satelliteValue ?? null,
    combination_index: match.combinationIndex ?? null,
    permutation_label: match.permutationLabel || null,
    permutation_numbers: match.permutationNumbers || [],
    permutation_combination_indexes: match.permutationCombinationIndexes || []
  };
}

async function rebuildWeeklyStats(client: any, country: string) {
  const publishedDraws = await client.from('resultat_aide_draws')
    .select('id')
    .eq('country_code', country)
    .eq('status', 'published')
    .limit(10000);
  if (publishedDraws.error) throw publishedDraws.error;
  const publishedIds = (publishedDraws.data || []).map((row: any) => row.id);
  let rows: any = { data: [], error: null };
  if (publishedIds.length) {
    rows = await client.from('resultat_aide_matches')
      .select('draw_id,country_code,programme_date,draw_date,day_offset,prediction_day,draw_day,program_key,program_name,prediction_kind,prediction_label,satellite_value,combination_index,permutation_label,permutation_numbers,permutation_combination_indexes,predicted_numbers,matched_numbers,matched_groups,match_level,hit')
      .eq('country_code', country)
      .in('draw_id', publishedIds)
      .limit(10000);
  }
  if (rows.error) throw rows.error;
  const matches: PredictionMatch[] = (rows.data || []).map((row: any) => ({
    snapshotId: '',
    countryCode: row.country_code,
    programmeDate: row.programme_date,
    drawDate: row.draw_date || row.programme_date,
    drawTime: null,
    dayOffset: Number(row.day_offset || 0),
    predictionDay: row.prediction_day || '',
    drawDay: row.draw_day || '',
    programKey: row.program_key,
    programName: row.program_name,
    kind: row.prediction_kind,
    predictedNumbers: row.predicted_numbers || [],
    matchedNumbers: row.matched_numbers || [],
    matchedGroups: row.matched_groups || [],
    level: row.match_level,
    hit: Boolean(row.hit),
    publishedDrawStatus: 'published',
    predictionLabel: row.prediction_label || null,
    satelliteValue: row.satellite_value ?? null,
    combinationIndex: row.combination_index ?? null,
    permutationLabel: row.permutation_label || null,
    permutationNumbers: row.permutation_numbers || [],
    permutationCombinationIndexes: row.permutation_combination_indexes || []
  }));
  const stats = buildWeeklyStats(matches);
  const dayStats = buildDayOfWeekStats(matches);
  const delayStats = buildDelayStats(matches);
  for (const table of [
    'resultat_aide_weekly_stats',
    'resultat_aide_day_stats',
    'resultat_aide_delay_stats'
  ]) {
    const cleared = await client.from(table).delete().eq('country_code', country);
    if (cleared.error) throw cleared.error;
  }
  const payload = stats.map((stat) => ({
    country_code: stat.countryCode,
    week_key: stat.weekKey,
    program_key: stat.programKey,
    program_name: stat.programName,
    draws_evaluated: stat.drawsEvaluated,
    key_metric: stat.key,
    order_metric: stat.order,
    nap1_metric: stat.nap1,
    nap2_metric: stat.nap2,
    combination_metric: stat.combination,
    satellite_metric: stat.satellite,
    permutation_metric: stat.permutation,
    overall_metric: stat.overall,
    calculated_at: nowIso()
  }));
  if (payload.length) {
    const result = await client.from('resultat_aide_weekly_stats')
      .upsert(payload, { onConflict: 'country_code,week_key,program_key' });
    if (result.error) throw result.error;
  }
  const dayPayload = dayStats.map((stat) => ({
    country_code: stat.countryCode,
    day_of_week: stat.dayOfWeek,
    day_name: stat.dayName,
    program_key: stat.programKey,
    program_name: stat.programName,
    draws_evaluated: stat.drawsEvaluated,
    key_metric: stat.key,
    order_metric: stat.order,
    nap1_metric: stat.nap1,
    nap2_metric: stat.nap2,
    combination_metric: stat.combination,
    satellite_metric: stat.satellite,
    permutation_metric: stat.permutation,
    overall_metric: stat.overall,
    calculated_at: nowIso()
  }));
  if (dayPayload.length) {
    const result = await client.from('resultat_aide_day_stats')
      .upsert(dayPayload, { onConflict: 'country_code,day_of_week,program_key' });
    if (result.error) throw result.error;
  }
  const delayPayload = delayStats.map((stat) => ({
    country_code: stat.countryCode,
    day_offset: stat.dayOffset,
    prediction_day_of_week: stat.predictionDayOfWeek,
    prediction_day_name: stat.predictionDayName,
    draw_day_of_week: stat.drawDayOfWeek,
    draw_day_name: stat.drawDayName,
    program_key: stat.programKey,
    program_name: stat.programName,
    draws_evaluated: stat.drawsEvaluated,
    key_metric: stat.key,
    order_metric: stat.order,
    nap1_metric: stat.nap1,
    nap2_metric: stat.nap2,
    combination_metric: stat.combination,
    satellite_metric: stat.satellite,
    permutation_metric: stat.permutation,
    overall_metric: stat.overall,
    calculated_at: nowIso()
  }));
  if (delayPayload.length) {
    const result = await client.from('resultat_aide_delay_stats')
      .upsert(delayPayload, {
        onConflict: 'country_code,day_offset,prediction_day_of_week,draw_day_of_week,program_key'
      });
    if (result.error) throw result.error;
  }
  return { stats, dayStats, delayStats };
}

async function publishVictoryBanners(
  client: any,
  matches: PredictionMatch[],
  country: string,
  validatorId: string
) {
  const winners = matches.filter((match) => (
    match.hit && ['strong', 'extraordinary'].includes(match.level)
  ));
  if (!winners.length) return;
  const ends = new Date(Date.now() + 7 * 86400000).toISOString();
  for (const match of winners) {
    const kindLabel = match.kind === 'key' ? 'la clé'
      : match.kind === 'order' ? 'l’ordre'
        : match.kind.toUpperCase();
    const result = await client.from('promo_banners').insert({
      country_code: country,
      placement: 'homepage',
      title: `Félicitations ${country} — ${match.programName}`,
      description: `${kindLabel} du programme ${match.programName} a été confirmé(e) dans le premier tirage.`,
      feature_key: `tableaux-${match.programKey}`,
      key_value: match.predictedNumbers.join(' · '),
      image_url: '',
      target_url: '/?section=categories-resultat-aide',
      action_label: 'Voir Résultat-Aide',
      sort_order: 20,
      starts_at: nowIso(),
      ends_at: ends,
      enabled: true,
      created_by: validatorId,
      updated_by: validatorId
    });
    // Older installations may not have the optional banner migration yet.
    // The validated match and statistics remain authoritative in that case.
    if (result.error) console.warn('result-helf victory banner skipped', result.error);
  }
}

async function evaluateDraw(client: any, draw: any, validatorId: string, note = '') {
  const country = countryCode(draw.country_code);
  const date = String(draw.draw_date);
  const predictions = await readPredictions(client, country, date);
  const snapshots = await storeSnapshots(client, predictions);
  const snapshotByProgram = new Map<string, { id?: string }>(
    (snapshots || []).map((row: any) => [
      `${row.program_key}|${row.programme_date}`,
      row as { id?: string }
    ] as [string, { id?: string }])
  );
  const realDraw: RealDraw = {
    countryCode: country,
    drawDate: date,
    drawTime: draw.draw_time,
    first: draw.first_numbers || [],
    machine: draw.machine_numbers || [],
    bonus: draw.bonus_numbers || [],
    status: 'published',
    source: draw.source
  };
  const matches = comparePublishedDraws(predictions, realDraw);
  const dbRows = matches.map((match) => dbMatch(
    match,
    draw.id,
    snapshotByProgram.get(
      `${match.programKey}|${match.programmeDate}`
    )?.id || match.snapshotId,
    draw.draw_time || null
  ));
  if (dbRows.length) {
    const stored = await client.from('resultat_aide_matches')
      .upsert(dbRows, {
        onConflict: 'draw_id,snapshot_id,prediction_kind,predicted_numbers,day_offset,prediction_label'
      });
    if (stored.error) throw stored.error;
  }
  const updated = await client.from('resultat_aide_draws')
    .update({
      status: 'published',
      validated_by: validatorId,
      validation_note: note,
      validated_at: nowIso(),
      published_at: nowIso(),
      updated_at: nowIso()
    })
    .eq('id', draw.id)
    .select('*')
    .single();
  if (updated.error) throw updated.error;
  const rebuilt = await rebuildWeeklyStats(client, country);
  await publishVictoryBanners(client, matches, country, validatorId);
  return {
    draw: updated.data,
    predictions,
    matches,
    stats: rebuilt.stats,
    dayStats: rebuilt.dayStats,
    delayStats: rebuilt.delayStats
  };
}

async function clearDrawEvaluation(client: any, drawId: string) {
  const result = await client.from('resultat_aide_matches')
    .delete()
    .eq('draw_id', drawId);
  if (result.error) throw result.error;
}

function publicStatsFromRows(rows: any[]) {
  return rows.map((row) => ({
    countryCode: row.country_code,
    weekKey: row.week_key,
    programKey: row.program_key,
    programName: row.program_name,
    drawsEvaluated: row.draws_evaluated,
    key: row.key_metric,
    order: row.order_metric,
    nap1: row.nap1_metric,
    nap2: row.nap2_metric,
    combination: row.combination_metric,
    satellite: row.satellite_metric,
    permutation: row.permutation_metric,
    overall: row.overall_metric
  }));
}

function publicDaySuggestions(rows: any[]) {
  const best = new Map<string, any>();
  for (const row of rows) {
    const candidate = {
      countryCode: row.country_code,
      dayOfWeek: row.day_of_week,
      dayName: row.day_name,
      programKey: row.program_key,
      programName: row.program_name,
      percentage: Number(row.overall_metric?.percentage || 0),
      drawsEvaluated: Number(row.draws_evaluated || 0)
    };
    const key = `${candidate.countryCode}|${candidate.dayOfWeek}`;
    const previous = best.get(key);
    if (!previous
      || candidate.percentage > previous.percentage
      || (candidate.percentage === previous.percentage
        && candidate.drawsEvaluated > previous.drawsEvaluated)) {
      best.set(key, candidate);
    }
  }
  return [...best.values()].sort((left, right) => (
    left.countryCode.localeCompare(right.countryCode)
    || left.dayOfWeek - right.dayOfWeek
  ));
}

function buildPublicDrawNumberMemory(rows: any[]) {
  const grouped = new Map<string, any>();
  for (const row of rows || []) {
    const countryCode = String(row?.country_code || '').toUpperCase();
    const date = String(row?.draw_date || '');
    const time = String(row?.draw_time || '').slice(0, 5);
    const rawDrawNumber = row?.draw_number;
    if (rawDrawNumber === null || rawDrawNumber === undefined || rawDrawNumber === '') continue;
    const drawNumber = Number(rawDrawNumber);
    if (!countryCode || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !/^\d{2}:\d{2}$/.test(time) || !Number.isInteger(drawNumber)) continue;
    const key = `${countryCode}|${time}`;
    const series = grouped.get(key) || {
      countryCode,
      drawTime: time,
      rows: [],
      weekdays: new Set<number>()
    };
    series.rows.push({ date, time, drawNumber });
    const dateObject = new Date(`${date}T12:00:00.000Z`);
    if (!Number.isNaN(dateObject.getTime())) series.weekdays.add(dateObject.getUTCDay());
    grouped.set(key, series);
  }
  const series = [...grouped.values()].map((item) => {
    const ordered = item.rows.sort((left: any, right: any) => (
      `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`)
    ));
    const differences: number[] = [];
    for (let index = 1; index < ordered.length; index += 1) {
      differences.push(ordered[index].drawNumber - ordered[index - 1].drawNumber);
    }
    const frequency = new Map<number, number>();
    differences.forEach((difference) => {
      frequency.set(difference, (frequency.get(difference) || 0) + 1);
    });
    const increment = [...frequency.entries()]
      .sort((left, right) => right[1] - left[1] || right[0] - left[0])[0]?.[0] ?? null;
    let trailingIncrementCount = 0;
    if (increment !== null) {
      for (let index = differences.length - 1; index >= 0; index -= 1) {
        if (differences[index] !== increment) break;
        trailingIncrementCount += 1;
      }
    }
    return {
      countryCode: item.countryCode,
      drawTime: item.drawTime,
      observations: ordered.length,
      observedWeekdays: [...item.weekdays].sort((left, right) => left - right),
      latest: ordered.at(-1) || null,
      increment,
      trailingIncrementCount,
      confidence: ordered.length >= 3 && increment !== null && trailingIncrementCount >= 2
        ? 'historical-sequence'
        : 'insufficient',
      recent: ordered.slice(-30)
    };
  }).sort((left, right) => (
    left.countryCode.localeCompare(right.countryCode)
    || left.drawTime.localeCompare(right.drawTime)
  ));
  return {
    generatedAt: nowIso(),
    minimumObservations: 3,
    series,
    note: 'Mémoire publique calculée uniquement avec les résultats published. Une estimation reste une estimation et sera remplacée par la valeur confirmée.'
  };
}

async function handlePublicDrawNumberMemory(client: any, body: any, request: Request) {
  const country = body.countryCode ? countryCode(body.countryCode) : '';
  let query = client.from('resultat_aide_draws')
    .select('country_code,draw_date,draw_time,draw_number')
    .eq('status', 'published')
    .order('draw_date', { ascending: true })
    .order('draw_time', { ascending: true })
    .limit(10000);
  if (country) query = query.eq('country_code', country);
  const result = await query;
  if (result.error) throw result.error;
  await recordTraffic(client, 'public_view', request, country || null, null, {
    surface: 'public-draw-number-memory'
  });
  return json({
    ok: true,
    publicOnly: true,
    drawNumberMemory: buildPublicDrawNumberMemory(result.data || [])
  });
}

async function handlePublicSuggestions(client: any, body: any, request: Request) {
  const country = body.countryCode ? countryCode(body.countryCode) : '';
  const requestedWeek = String(body.weekKey || '').trim()
    || weekKey(new Date().toISOString().slice(0, 10));
  let query = client.from('resultat_aide_weekly_stats')
    .select('country_code,week_key,program_key,program_name,draws_evaluated,key_metric,order_metric,nap1_metric,nap2_metric,combination_metric,satellite_metric,permutation_metric,overall_metric')
    .order('week_key', { ascending: false })
    .limit(500);
  if (country) query = query.eq('country_code', country);
  if (requestedWeek) query = query.eq('week_key', requestedWeek);
  const result = await query;
  /*
   * Older projects can have the Resultat-Aide tables but not the latest
   * metric columns yet. Public suggestions are optional context for the
   * assistant; they must not turn the whole snapshot into a 500 while the
   * schema is being synchronized.
   */
  if (result.error && optionalMetadataError(result.error)) {
    return json({
      ok: true,
      weekKey: requestedWeek || null,
      suggestions: [],
      stats: [],
      daySuggestions: [],
      degraded: true,
      warning: 'Les statistiques publiées sont momentanément indisponibles.'
    });
  }
  if (result.error) throw result.error;
  let dayQuery = client.from('resultat_aide_day_stats')
    .select('country_code,day_of_week,day_name,program_key,program_name,draws_evaluated,overall_metric,satellite_metric,permutation_metric')
    .order('day_of_week', { ascending: true })
    .limit(500);
  if (country) dayQuery = dayQuery.eq('country_code', country);
  const dayResult = await dayQuery;
  if (dayResult.error && optionalMetadataError(dayResult.error)) {
    const stats = publicStatsFromRows(result.data || []);
    return json({
      ok: true,
      weekKey: requestedWeek || stats[0]?.weekKey || null,
      suggestions: buildPublicSuggestions(stats),
      stats,
      daySuggestions: [],
      degraded: true,
      warning: 'Les tendances par jour sont momentanément indisponibles.'
    });
  }
  if (dayResult.error) throw dayResult.error;
  const stats = publicStatsFromRows(result.data || []);
  const suggestions = buildPublicSuggestions(stats);
  await recordTraffic(client, 'suggestion_view', request, country || null);
  return json({
    ok: true,
    weekKey: requestedWeek || suggestions[0]?.weekKey || null,
    suggestions,
    stats,
    daySuggestions: publicDaySuggestions(dayResult.data || [])
  });
}

async function handleProgramView(client: any, body: any, request: Request, user: any) {
  const programKey = String(body.programKey || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,59}$/.test(programKey)) {
    return json({ error: 'Programme invalide.' }, 400);
  }
  const rawCountry = String(body.country || body.countryCode || '').trim();
  const normalizedCountry = /^[A-Z]{2,8}$/.test(rawCountry.toUpperCase())
    ? rawCountry.toUpperCase()
    : null;
  await recordTraffic(client, 'program_view', request, normalizedCountry, user?.id || null, {
    programKey,
    countryLabel: rawCountry.slice(0, 80)
  });
  return json({ ok: true });
}

async function existingSlot(
  client: any,
  country: string,
  date: string,
  time: string,
  excludedId = ''
) {
  const result = await client.from('resultat_aide_draws')
    .select('id,status,country_code,draw_date,draw_time,draw_number,submitted_by')
    .eq('country_code', country)
    .eq('draw_date', date)
    .in('status', ['pending', 'published', 'disputed'])
    .order('created_at', { ascending: false })
    .limit(20);
  if (result.error) throw result.error;
  const wanted = String(time || '').slice(0, 5);
  return (result.data || []).find((row: any) =>
    row.id !== excludedId
    && String(row.draw_time || '').slice(0, 5) === wanted
  ) || null;
}

function dayName(dateText: string): string {
  const names = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const date = new Date(`${dateText}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? '' : names[date.getUTCDay()];
}

function optionalMetadataError(error: any): boolean {
  return /relation .* does not exist|admin_draw_sources|column .* does not exist|schema cache/i
    .test(String(error?.message || ''));
}

function schemaDriftError(error: any): boolean {
  return /column .* does not exist|could not find the .* column|schema cache/i
    .test(String(error?.message || ''));
}

async function insertResultDraw(client: any, payload: Record<string, unknown>) {
  let result = await client.from('resultat_aide_draws')
    .insert(payload)
    .select('*')
    .single();
  if (!result.error || !schemaDriftError(result.error)) return result;

  /*
   * draw_number and input_schema were added after the first Resultat-Aide
   * migration. Keep a production deployment usable while Supabase's schema
   * cache is being refreshed: the core result is still stored, and the
   * optional fields can be backfilled by the next schema synchronization.
   */
  const {
    draw_number: _drawNumber,
    input_schema: _inputSchema,
    ...legacyPayload
  } = payload;
  result = await client.from('resultat_aide_draws')
    .insert(legacyPayload)
    .select('*')
    .single();
  return result;
}

async function handleResultMetadata(
  client: any,
  body: any,
  request: Request,
  auth: any
) {
  let profileCountry = '';
  let profileCountryName = '';
  if (auth.user?.id) {
    const profile = await client.from('profiles')
      .select('country')
      .eq('id', auth.user.id)
      .maybeSingle();
    if (profile.error && !optionalMetadataError(profile.error)) throw profile.error;
    profileCountryName = String(profile.data?.country || '').trim();
    profileCountry = countryCode(profileCountryName);
  }

  // The result country is chosen by the contributor. A profile country is
  // only a convenient default when the request does not specify one; it
  // never restricts which country can be reported.
  const country = body.countryCode
    ? countryCode(body.countryCode)
    : profileCountry;
  const date = parseDate(body.drawDate)
    || new Date().toISOString().slice(0, 10);
  const access = auth.user?.id
    ? await readActivePlanAccess(client, auth.user.id)
    : { active: false, subscription: null };

  let sourceRows: any[] = [];
  if (country) {
    const sources = await client.from('admin_draw_sources')
      .select('country_code,country_name,draw_name,draw_time,module_key,enabled')
      .eq('country_code', country)
      .eq('enabled', true)
      .order('draw_time', { ascending: true });
    if (sources.error && !optionalMetadataError(sources.error)) throw sources.error;
    sourceRows = sources.error ? [] : (sources.data || []);
  }

  const existing = country
    ? await client.from('resultat_aide_draws')
      .select('draw_time,draw_number,status')
      .eq('country_code', country)
      .eq('draw_date', date)
      .in('status', ['pending', 'published', 'disputed'])
    : { data: [], error: null };
  if (existing.error) throw existing.error;

  const existingByTime = new Map<string, string>();
  (existing.data || []).forEach((row: any) => {
    const time = String(row.draw_time || '').slice(0, 5);
    if (time && !existingByTime.has(time)) {
      existingByTime.set(time, String(row.status || 'pending'));
    }
  });

  const slotsByTime = new Map<string, any>();
  sourceRows.forEach((row: any) => {
    const time = String(row.draw_time || '').slice(0, 5);
    if (!/^\d{2}:\d{2}$/.test(time)) return;
    const current = slotsByTime.get(time) || {
      time,
      names: [],
      modules: []
    };
    const name = String(row.draw_name || '').trim();
    const module = String(row.module_key || '').trim();
    if (name && !current.names.includes(name)) current.names.push(name);
    if (module && !current.modules.includes(module)) current.modules.push(module);
    slotsByTime.set(time, current);
  });

  const countryName = String(
    sourceRows[0]?.country_name || profileCountryName || country || ''
  ).trim();
  const schedule = [...slotsByTime.values()]
    .sort((left, right) => left.time.localeCompare(right.time))
    .map((slot) => {
      const status = existingByTime.get(slot.time) || null;
      return {
        ...slot,
        status,
        recorded: Boolean(status)
      };
    });

  await recordTraffic(
    client,
    'public_view',
    request,
    country || null,
    auth.user?.id || null,
    { surface: 'result-metadata', date, slots: schedule.length }
  );

  return json({
    ok: true,
    country: country
      ? { code: country, name: countryName || country }
      : null,
    date,
    dayName: dayName(date),
    schedule,
    missingCount: schedule.filter((slot) => !slot.recorded).length,
    recordedCount: schedule.filter((slot) => slot.recorded).length,
    signedIn: Boolean(auth.user?.id),
    canSubmit: Boolean(auth.user?.id),
    canPublishDirectly: access.active,
    subscription: access.subscription
  });
}

async function handleSubmit(client: any, body: any, request: Request, user: any) {
  if (!user?.id) {
    return json({ error: 'Connectez-vous pour transmettre un résultat à vérifier.' }, 401);
  }
  let access: any;
  try {
    access = await readActivePlanAccess(client, user.id);
  } catch (error) {
    /*
     * Access information is useful for deciding between direct publication
     * and moderation, but it must not make a valid contribution impossible
     * when an optional access table is still being synchronized. Fall back to
     * the safe pending path; never grant direct publication on an access read
     * failure.
     */
    console.error('result-helf access lookup degraded', error);
    access = { active: false, isAdmin: false, isModerator: false };
  }
  const country = countryCode(body.countryCode);
  const date = parseDate(body.drawDate);
  const first = numberList(body.first, 90);
  const machine = numberList(body.machine, 90);
  const bonus = numberList(body.bonus, 90);
  const rawDrawNumber = String(body.drawNumber ?? '').trim();
  const parsedDrawNumber = Number.parseInt(rawDrawNumber, 10);
  const drawNumber = rawDrawNumber === ''
    ? null
    : parsedDrawNumber;
  if (!country || !date || !body.drawTime
    || (drawNumber !== null && (drawNumber < 0 || !Number.isInteger(drawNumber)))
    || !first.length
    || !isValidTime(body.drawTime)) {
    return json({
      error: 'Pays, heure et au moins un groupe de numéros sont requis. Le numéro de tirage est facultatif.'
    }, 400);
  }
  if (body.certifiedOfficial !== true) {
    return json({
      error: 'Certifiez qu’il s’agit du tirage officiel publié par la Loterie Nationale avant l’envoi.'
    }, 400);
  }
  if (COUNTRIES_WITHOUT_EXTRA_GROUPS.has(country) && (machine.length || bonus.length)) {
    return json({
      error: 'Ce pays ne publie pas de numéros Machine ni Bonus. Laissez ces cases vides.'
    }, 400);
  }
  const inputSchema = normalizeInputSchema(body.inputSchema, first, machine, bonus);
  const duplicate = await existingSlot(client, country, date, String(body.drawTime));
  if (duplicate) {
    return json({
      error: `Un résultat existe déjà pour ${country}, le ${date} à ${String(body.drawTime).slice(0, 5)}. Vérifiez s’il s’agit bien du dernier tirage avant de renvoyer une saisie.`
    }, 409);
  }
  if (user?.id) {
    const contributor = await client.from('resultat_aide_contributors')
      .select('disabled')
      .eq('user_id', user.id)
      .maybeSingle();
    if (contributor.data?.disabled) return json({ error: 'Votre saisie de résultats est désactivée.' }, 403);
  }
  const inserted = await insertResultDraw(client, {
      country_code: country,
      draw_date: date,
      draw_time: body.drawTime || null,
      draw_number: drawNumber,
      first_numbers: first,
      machine_numbers: machine,
      bonus_numbers: bonus,
      input_schema: inputSchema,
      status: access.active ? 'published' : 'pending',
      source: String(body.source || 'visitor').slice(0, 80),
      submitted_by: user?.id || null
    });
  if (inserted.error) throw inserted.error;
  let evaluated = null;
  let evaluationWarning = '';
  const language = localeGroup(body.localeCode);
  if (access.active) {
    try {
      evaluated = await evaluateDraw(
        client,
        inserted.data,
        user.id,
        'Résultat publié directement par un compte actif.'
      );
    } catch (error) {
      /*
       * The draw row is already the source of truth and was inserted with
       * status=published. A missing/older optional statistics table must not
       * turn a successful publication into a fake failure. Keep the result
       * published and let the next synchronization/rebuild fill statistics.
       */
      console.error('result-helf evaluation deferred after publication', error);
      evaluationWarning = serverMessage(language, 'warning');
    }
  }
  if (user?.id) {
    const existing = await client.from('resultat_aide_contributors')
      .select('submissions,accepted,rejected,disputes')
      .eq('user_id', user.id)
      .maybeSingle();
    await client.from('resultat_aide_contributors').upsert({
      user_id: user.id,
      submissions: Number(existing.data?.submissions || 0) + 1,
      accepted: Number(existing.data?.accepted || 0) + (access.active ? 1 : 0),
      rejected: Number(existing.data?.rejected || 0),
      disputes: Number(existing.data?.disputes || 0),
      last_submission_at: nowIso(),
      updated_at: nowIso()
    }, { onConflict: 'user_id' });
  }
  await recordTraffic(client, 'submit', request, country, user?.id || null);
  return json({
    ok: true,
    draw: evaluated?.draw || inserted.data,
    published: access.active,
    pendingConfirmation: !access.active,
    requiresConfirmation: !access.active,
    matches: evaluated?.matches || [],
    message: `${serverMessage(language, access.active ? 'published' : 'pending')}${evaluationWarning}`
  });
}

async function handleSubmitSeries(client: any, body: any, request: Request, user: any) {
  if (!user?.id) {
    return json({ error: 'Connectez-vous pour transmettre une série de résultats à vérifier.' }, 401);
  }
  const access = await readActivePlanAccess(client, user.id);
  const rows = Array.isArray(body.draws) ? body.draws : [];
  if (!rows.length || rows.length > 31) {
    return json({ error: 'Envoyez au moins un jour et au maximum 31 jours consécutifs.' }, 400);
  }
  type NormalizedSeriesRow = {
    country: string;
    date: string;
    time: string | null;
    drawNumber: number;
    first: number[];
    machine: number[];
    bonus: number[];
    inputSchema: unknown;
  };
  const normalized: NormalizedSeriesRow[] = rows.map((row: any) => ({
    country: countryCode(row.countryCode || body.countryCode),
    date: parseDate(row.drawDate || row.date),
    time: String(row.drawTime || row.time || '').trim().slice(0, 5) || null,
    drawNumber: Number.parseInt(String(row.drawNumber ?? body.drawNumber ?? '').trim(), 10),
    first: numberList(row.first, 90),
    machine: numberList(row.machine, 90),
    bonus: numberList(row.bonus, 90),
    inputSchema: row.inputSchema || body.inputSchema || null
  })).sort((left: NormalizedSeriesRow, right: NormalizedSeriesRow) =>
    left.date.localeCompare(right.date)
  );
  const country = normalized[0]?.country;
  if (!country || normalized.some((row) => (
    row.country !== country || !row.date || !row.time
    || !Number.isInteger(row.drawNumber) || row.drawNumber < 0 || !row.first.length
    || !isValidTime(row.time)
  ))) {
    return json({ error: 'Chaque ligne doit contenir le même pays, une date, une heure et les tirages complets.' }, 400);
  }
  const duplicates = [];
  for (const row of normalized) {
    const duplicate = await existingSlot(client, country, row.date, String(row.time));
    if (duplicate) duplicates.push(`${row.date} ${String(row.time).slice(0, 5)}`);
  }
  if (duplicates.length) {
    return json({
      error: `Ces résultats existent déjà dans la mémoire : ${duplicates.join(', ')}. Ne renvoyez pas les mêmes horaires.`
    }, 409);
  }
  const uniqueDates = [...new Set(normalized.map((row) => row.date))];
  if (uniqueDates.length !== normalized.length
    || uniqueDates.some((date, index) => index > 0 && dateDistance(uniqueDates[index - 1], date) !== 1)) {
    return json({ error: 'La série doit couvrir des jours consécutifs sans sauter de résultat ni répéter une date.' }, 400);
  }
  const contributor = await client.from('resultat_aide_contributors')
    .select('disabled,submissions,accepted,rejected,disputes')
    .eq('user_id', user.id)
    .maybeSingle();
  if (contributor.data?.disabled) return json({ error: 'Votre saisie de résultats est désactivée.' }, 403);
  const batchId = crypto.randomUUID();
  const start = uniqueDates[0];
  const end = uniqueDates[uniqueDates.length - 1];
  const inserted = await client.from('resultat_aide_draws').insert(normalized.map((row) => ({
    country_code: country,
    draw_date: row.date,
    draw_time: row.time,
    draw_number: row.drawNumber,
    first_numbers: row.first,
    machine_numbers: row.machine,
    bonus_numbers: row.bonus,
    input_schema: normalizeInputSchema(row.inputSchema, row.first, row.machine, row.bonus),
    status: access.active ? 'published' : 'pending',
    source: 'virtual-assistant-series',
    submitted_by: user.id,
    batch_id: batchId,
    series_start: start,
    series_end: end,
    series_complete: true
  }))).select('*');
  if (inserted.error) throw inserted.error;
  const evaluated = [];
  if (access.active) {
    for (const draw of inserted.data || []) {
      evaluated.push(await evaluateDraw(
        client,
        draw,
        user.id,
        'Résultat publié directement par un compte actif.'
      ));
    }
  }
  await client.from('resultat_aide_contributors').upsert({
    user_id: user.id,
    submissions: Number(contributor.data?.submissions || 0) + normalized.length,
    accepted: Number(contributor.data?.accepted || 0) + (access.active ? normalized.length : 0),
    rejected: Number(contributor.data?.rejected || 0),
    disputes: Number(contributor.data?.disputes || 0),
    last_submission_at: nowIso(),
    updated_at: nowIso()
  }, { onConflict: 'user_id' });
  await recordTraffic(client, 'submit', request, country, user.id, {
    batchId,
    seriesStart: start,
    seriesEnd: end,
    count: normalized.length
  });
  return json({
    ok: true,
    batchId,
    count: normalized.length,
    draws: evaluated.length ? evaluated.map((item) => item.draw) : (inserted.data || []),
    published: access.active,
    pendingConfirmation: !access.active,
    requiresConfirmation: !access.active,
    message: access.active
      ? `Série complète reçue : ${normalized.length} jour(s) publié(s) directement.`
      : `Série complète reçue : ${normalized.length} jour(s) sans interruption. Elle reste en attente de confirmation.`
  });
}

async function handleEditableDrawsDuplicate(client: any, request: Request, user: any) {
  if (!user?.id) return json({ error: 'Connectez-vous pour gérer vos résultats.' }, 401);
  const access = await readActivePlanAccess(client, user.id);
  let query = client.from('resultat_aide_draws')
    .select('id,country_code,draw_date,draw_time,draw_number,first_numbers,machine_numbers,bonus_numbers,input_schema,status,source,submitted_by,created_at,updated_at')
    .order('created_at', { ascending: false })
    .limit(access.isAdmin ? 100 : 30);
  if (!access.isAdmin) query = query.eq('submitted_by', user.id);
  const result = await query;
  if (result.error) throw result.error;
  await recordTraffic(client, 'public_view', request, null, user.id, {
    surface: 'editable-results',
    canManageAny: access.isAdmin
  });
  return json({
    ok: true,
    canManageAny: access.isAdmin,
    draws: result.data || []
  });
}

async function handleUpdateDrawDuplicate(client: any, body: any, request: Request, user: any) {
  if (!user?.id) return json({ error: 'Connectez-vous pour modifier un résultat.' }, 401);
  const drawId = String(body.drawId || '').trim();
  if (!drawId) return json({ error: 'Le résultat à modifier est requis.' }, 400);
  const access = await readActivePlanAccess(client, user.id);
  const existing = await client.from('resultat_aide_draws')
    .select('*')
    .eq('id', drawId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  const draw = existing.data;
  if (!draw) return json({ error: 'Ce résultat n’existe plus.' }, 404);
  const isOwner = draw.submitted_by === user.id;
  if (!isOwner && !access.isAdmin) {
    return json({ error: 'Vous ne pouvez modifier que votre propre résultat.' }, 403);
  }
  const country = countryCode(body.countryCode || draw.country_code);
  const date = parseDate(body.drawDate || draw.draw_date);
  const drawTime = String(body.drawTime || draw.draw_time || '').trim();
  const drawNumber = Number.parseInt(String(body.drawNumber ?? draw.draw_number ?? '').trim(), 10);
  const first = numberList(body.first, 90);
  const machine = numberList(body.machine, 90);
  const bonus = numberList(body.bonus, 90);
  if (!country || !date || !drawTime || !Number.isInteger(drawNumber)
    || drawNumber < 0 || !first.length || !isValidTime(drawTime)) {
    return json({
      error: 'Pays, date, heure et au moins un groupe de numéros sont requis pour la modification.'
    }, 400);
  }
  const duplicate = await existingSlot(client, country, date, drawTime, drawId);
  if (duplicate) {
    return json({
      error: `Un autre résultat existe déjà pour ${country}, le ${date} à ${drawTime.slice(0, 5)}.`
    }, 409);
  }
  const direct = access.active || access.isAdmin;
  const oldCountry = String(draw.country_code || '');
  const hadEvaluation = ['published', 'disputed'].includes(String(draw.status || ''));
  await clearDrawEvaluation(client, drawId);
  const updated = await client.from('resultat_aide_draws')
    .update({
      country_code: country,
      draw_date: date,
      draw_time: drawTime,
      draw_number: drawNumber,
      first_numbers: first,
      machine_numbers: machine,
      bonus_numbers: bonus,
      input_schema: normalizeInputSchema(body.inputSchema, first, machine, bonus),
      status: direct ? 'published' : 'pending',
      source: String(body.source || draw.source || 'visitor').slice(0, 80),
      validated_by: null,
      validation_note: direct
        ? 'Résultat modifié et publié directement par son auteur autorisé.'
        : 'Résultat modifié par son auteur et remis en attente de confirmation.',
      validated_at: null,
      published_at: null,
      updated_at: nowIso()
    })
    .eq('id', drawId)
    .select('*')
    .single();
  if (updated.error) throw updated.error;
  if (hadEvaluation && oldCountry) {
    await rebuildWeeklyStats(client, oldCountry);
  }
  const evaluated = direct
    ? await evaluateDraw(
      client,
      updated.data,
      user.id,
      access.isAdmin
        ? 'Résultat modifié et publié par l’administration.'
        : 'Résultat modifié et publié directement par son auteur autorisé.'
    )
    : null;
  await recordTraffic(client, 'submit', request, country, user.id, {
    action: 'update-draw',
    drawId,
    published: direct
  });
  return json({
    ok: true,
    draw: evaluated?.draw || updated.data,
    published: direct,
    pendingConfirmation: !direct,
    requiresConfirmation: !direct,
    message: direct
      ? 'Résultat modifié et publié directement.'
      : 'Résultat modifié et remis en attente de confirmation.'
  });
}

async function handleDeleteDrawDuplicate(client: any, body: any, request: Request, user: any) {
  if (!user?.id) return json({ error: 'Connectez-vous pour supprimer un résultat.' }, 401);
  const drawId = String(body.drawId || '').trim();
  if (!drawId) return json({ error: 'Le résultat à supprimer est requis.' }, 400);
  const access = await readActivePlanAccess(client, user.id);
  const existing = await client.from('resultat_aide_draws')
    .select('*')
    .eq('id', drawId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  const draw = existing.data;
  if (!draw) return json({ error: 'Ce résultat n’existe plus.' }, 404);
  if (draw.submitted_by !== user.id && !access.isAdmin) {
    return json({ error: 'Vous ne pouvez supprimer que votre propre résultat.' }, 403);
  }
  const country = String(draw.country_code || '');
  const hadEvaluation = ['published', 'disputed'].includes(String(draw.status || ''));
  await clearDrawEvaluation(client, drawId);
  const deleted = await client.from('resultat_aide_draws')
    .delete()
    .eq('id', drawId)
    .select('id')
    .maybeSingle();
  if (deleted.error) throw deleted.error;
  if (!deleted.data) return json({ error: 'Ce résultat vient déjà d’être supprimé.' }, 404);
  if (hadEvaluation && country) await rebuildWeeklyStats(client, country);
  await recordTraffic(client, 'submit', request, country || null, user.id, {
    action: 'delete-draw',
    drawId
  });
  return json({
    ok: true,
    deleted: true,
    drawId,
    message: access.isAdmin
      ? 'Résultat supprimé par l’administration.'
      : 'Votre résultat a été supprimé.'
  });
}

async function handleEditableDraws(client: any, request: Request, user: any) {
  if (!user?.id) return json({ error: 'Connectez-vous pour gérer vos résultats.' }, 401);
  const access = await readActivePlanAccess(client, user.id);
  let query = client.from('resultat_aide_draws')
    .select('id,country_code,draw_date,draw_time,draw_number,first_numbers,machine_numbers,bonus_numbers,input_schema,status,source,submitted_by,created_at,updated_at')
    .order('created_at', { ascending: false })
    .limit(access.isAdmin ? 100 : 30);
  if (!access.isAdmin) query = query.eq('submitted_by', user.id);
  const result = await query;
  if (result.error) throw result.error;
  await recordTraffic(client, 'public_view', request, null, user.id, {
    surface: 'editable-results',
    canManageAny: access.isAdmin
  });
  return json({
    ok: true,
    canManageAny: access.isAdmin,
    draws: result.data || []
  });
}

async function handleUpdateDraw(client: any, body: any, request: Request, user: any) {
  if (!user?.id) return json({ error: 'Connectez-vous pour modifier un résultat.' }, 401);
  const drawId = String(body.drawId || '').trim();
  if (!drawId) return json({ error: 'Le résultat à modifier est requis.' }, 400);
  const access = await readActivePlanAccess(client, user.id);
  const existing = await client.from('resultat_aide_draws')
    .select('*')
    .eq('id', drawId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  const draw = existing.data;
  if (!draw) return json({ error: 'Ce résultat n’existe plus.' }, 404);
  const isOwner = draw.submitted_by === user.id;
  if (!isOwner && !access.isAdmin) {
    return json({ error: 'Vous ne pouvez modifier que votre propre résultat.' }, 403);
  }
  const country = countryCode(body.countryCode || draw.country_code);
  const date = parseDate(body.drawDate || draw.draw_date);
  const drawTime = String(body.drawTime || draw.draw_time || '').trim();
  const drawNumber = Number.parseInt(String(body.drawNumber ?? draw.draw_number ?? '').trim(), 10);
  const first = numberList(body.first, 90);
  const machine = numberList(body.machine, 90);
  const bonus = numberList(body.bonus, 90);
  if (!country || !date || !drawTime || !Number.isInteger(drawNumber)
    || drawNumber < 0 || !first.length || !isValidTime(drawTime)) {
    return json({
      error: 'Pays, date, heure et au moins un groupe de numéros sont requis pour la modification.'
    }, 400);
  }
  const duplicate = await existingSlot(client, country, date, drawTime, drawId);
  if (duplicate) {
    return json({
      error: `Un autre résultat existe déjà pour ${country}, le ${date} à ${drawTime.slice(0, 5)}.`
    }, 409);
  }
  const direct = access.active || access.isAdmin;
  const oldCountry = String(draw.country_code || '');
  const hadEvaluation = ['published', 'disputed'].includes(String(draw.status || ''));
  await clearDrawEvaluation(client, drawId);
  const updated = await client.from('resultat_aide_draws')
    .update({
      country_code: country,
      draw_date: date,
      draw_time: drawTime,
      draw_number: drawNumber,
      first_numbers: first,
      machine_numbers: machine,
      bonus_numbers: bonus,
      input_schema: normalizeInputSchema(body.inputSchema, first, machine, bonus),
      status: direct ? 'published' : 'pending',
      source: String(body.source || draw.source || 'visitor').slice(0, 80),
      validated_by: null,
      validation_note: direct
        ? 'Résultat modifié et publié directement par son auteur autorisé.'
        : 'Résultat modifié par son auteur et remis en attente de confirmation.',
      validated_at: null,
      published_at: null,
      updated_at: nowIso()
    })
    .eq('id', drawId)
    .select('*')
    .single();
  if (updated.error) throw updated.error;
  if (hadEvaluation && oldCountry) {
    await rebuildWeeklyStats(client, oldCountry);
  }
  const evaluated = direct
    ? await evaluateDraw(
      client,
      updated.data,
      user.id,
      access.isAdmin
        ? 'Résultat modifié et publié par l’administration.'
        : 'Résultat modifié et publié directement par son auteur autorisé.'
    )
    : null;
  await recordTraffic(client, 'submit', request, country, user.id, {
    action: 'update-draw',
    drawId,
    published: direct
  });
  return json({
    ok: true,
    draw: evaluated?.draw || updated.data,
    published: direct,
    pendingConfirmation: !direct,
    requiresConfirmation: !direct,
    message: direct
      ? 'Résultat modifié et publié directement.'
      : 'Résultat modifié et remis en attente de confirmation.'
  });
}

async function handleDeleteDraw(client: any, body: any, request: Request, user: any) {
  if (!user?.id) return json({ error: 'Connectez-vous pour supprimer un résultat.' }, 401);
  const drawId = String(body.drawId || '').trim();
  if (!drawId) return json({ error: 'Le résultat à supprimer est requis.' }, 400);
  const access = await readActivePlanAccess(client, user.id);
  const existing = await client.from('resultat_aide_draws')
    .select('*')
    .eq('id', drawId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  const draw = existing.data;
  if (!draw) return json({ error: 'Ce résultat n’existe plus.' }, 404);
  if (draw.submitted_by !== user.id && !access.isAdmin) {
    return json({ error: 'Vous ne pouvez supprimer que votre propre résultat.' }, 403);
  }
  const country = String(draw.country_code || '');
  const hadEvaluation = ['published', 'disputed'].includes(String(draw.status || ''));
  await clearDrawEvaluation(client, drawId);
  const deleted = await client.from('resultat_aide_draws')
    .delete()
    .eq('id', drawId)
    .select('id')
    .maybeSingle();
  if (deleted.error) throw deleted.error;
  if (!deleted.data) return json({ error: 'Ce résultat vient déjà d’être supprimé.' }, 404);
  if (hadEvaluation && country) await rebuildWeeklyStats(client, country);
  await recordTraffic(client, 'submit', request, country || null, user.id, {
    action: 'delete-draw',
    drawId
  });
  return json({
    ok: true,
    deleted: true,
    drawId,
    message: access.isAdmin
      ? 'Résultat supprimé par l’administration.'
      : 'Votre résultat a été supprimé.'
  });
}

async function handlePendingDraw(client: any, request: Request, user: any) {
  if (!user?.id) return json({ ok: true, pending: null, canConfirm: false }, 401);
  const access = await readActivePlanAccess(client, user.id);
  if (!access.active) return json({ ok: true, pending: null, canConfirm: false });
  let pendingQuery = client.from('resultat_aide_draws')
    .select('id,country_code,draw_date,draw_time,draw_number,first_numbers,machine_numbers,bonus_numbers,submitted_by,created_at')
    .eq('status', 'pending')
    .neq('submitted_by', user.id)
    .order('created_at', { ascending: true })
    .limit(1);
  const result = await pendingQuery.maybeSingle();
  if (result.error) throw result.error;
  await recordTraffic(client, 'public_view', request, null, user.id, {
    surface: 'pending-result-confirmation'
  });
  return json({
    ok: true,
    canConfirm: true,
    pending: result.data || null
  });
}

async function handleConfirmDraw(client: any, body: any, request: Request, user: any) {
  if (!user?.id) return json({ error: 'Connectez-vous pour confirmer un résultat.' }, 401);
  const access = await readActivePlanAccess(client, user.id);
  if (!access.active) {
    return json({ error: 'La confirmation est réservée aux abonnés ayant un forfait actif.' }, 403);
  }
  const drawId = String(body.drawId || '').trim();
  if (!drawId) return json({ error: 'Le résultat à confirmer est requis.' }, 400);
  const drawResult = await client.from('resultat_aide_draws')
    .select('*')
    .eq('id', drawId)
    .eq('status', 'pending')
    .maybeSingle();
  if (drawResult.error) throw drawResult.error;
  const draw = drawResult.data;
  if (!draw) return json({ error: 'Ce résultat n’est plus en attente de confirmation.' }, 404);
  if (draw.submitted_by === user.id) {
    return json({ error: 'Le contributeur ne peut pas confirmer son propre résultat.' }, 403);
  }
  const approved = body.approved === true;
  if (!approved) {
    const rejected = await client.from('resultat_aide_draws')
      .update({
        status: 'rejected',
        validated_by: user.id,
        validation_note: 'Résultat non confirmé par un abonné actif.',
        validated_at: nowIso(),
        updated_at: nowIso()
      })
      .eq('id', draw.id)
      .eq('status', 'pending')
      .select('id,country_code,draw_date,draw_time,status')
      .single();
    if (rejected.error) throw rejected.error;
    if (draw.submitted_by) {
      const contributor = await client.from('resultat_aide_contributors')
        .select('rejected')
        .eq('user_id', draw.submitted_by)
        .maybeSingle();
      await client.from('resultat_aide_contributors')
        .update({
          rejected: Number(contributor.data?.rejected || 0) + 1,
          updated_at: nowIso()
        })
        .eq('user_id', draw.submitted_by);
    }
    await recordTraffic(client, 'submit', request, draw.country_code || null, user.id, {
      action: 'confirm-rejected',
      drawId
    });
    return json({
      ok: true,
      confirmed: false,
      draw: rejected.data,
      message: 'Résultat refusé. Il ne sera pas publié.'
    });
  }
  const claimed = await client.from('resultat_aide_draws')
    .update({
      status: 'disputed',
      validated_by: user.id,
      validation_note: access.isAdmin || access.isModerator
        ? 'Confirmation en cours par l’administration.'
        : 'Confirmation en cours par un abonné actif, quel que soit son pays.',
      updated_at: nowIso()
    })
    .eq('id', draw.id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  if (claimed.error) throw claimed.error;
  if (!claimed.data) {
    return json({ error: 'Ce résultat vient d’être confirmé par une autre personne.' }, 409);
  }
  let evaluated: any = null;
  let evaluationWarning = '';
  const language = localeGroup(body.localeCode);
  try {
    evaluated = await evaluateDraw(
      client,
      claimed.data,
      user.id,
      access.isAdmin || access.isModerator
        ? 'Résultat confirmé par l’administration.'
        : 'Résultat confirmé par un abonné actif, quel que soit son pays.'
    );
  } catch (error) {
    /*
     * The confirmation has already claimed the pending row. If an optional
     * historical/statistics table is behind the deployed function, finish
     * the publication instead of leaving the result in "disputed" forever.
     */
    console.error('result-helf confirmation evaluation deferred', error);
    const published = await client.from('resultat_aide_draws')
      .update({
        status: 'published',
        published_at: nowIso(),
        validated_at: nowIso(),
        validation_note: 'Résultat confirmé ; les statistiques seront synchronisées prochainement.',
        updated_at: nowIso()
      })
      .eq('id', claimed.data.id)
      .select('*')
      .single();
    if (published.error) throw published.error;
    evaluated = { draw: published.data, matches: [] };
    evaluationWarning = serverMessage(language, 'warning');
  }
  if (draw.submitted_by) {
    const contributor = await client.from('resultat_aide_contributors')
      .select('accepted')
      .eq('user_id', draw.submitted_by)
      .maybeSingle();
    await client.from('resultat_aide_contributors')
      .update({
        accepted: Number(contributor.data?.accepted || 0) + 1,
        updated_at: nowIso()
      })
      .eq('user_id', draw.submitted_by);
  }
  await recordTraffic(client, 'submit', request, draw.country_code || null, user.id, {
    action: 'confirm-published',
    drawId
  });
  return json({
    ok: true,
    confirmed: true,
    draw: evaluated.draw,
    matches: evaluated.matches,
    message: `${serverMessage(language, 'confirmed')}${evaluationWarning}`
  });
}

async function handleViewerState(client: any, auth: any) {
  if (!auth.user?.id) {
    return json({
      ok: true,
      signedIn: false,
      canSubmit: false,
      canSendResult: false,
      canPublishDirectly: false,
      hasActiveAccess: false,
      requiresConfirmation: false,
      canConfirmResult: false
    });
  }
  const access = await readActivePlanAccess(client, auth.user.id);
  return json({
    ok: true,
    signedIn: true,
    // Any connected account may contribute. Active access publishes directly;
    // other connected accounts create a pending contribution.
    canSubmit: true,
    canSendResult: true,
    canPublishDirectly: access.active,
    hasActiveAccess: access.active,
    requiresConfirmation: !access.active,
    canConfirmResult: access.active,
    isAdmin: access.isAdmin,
    isModerator: access.isModerator,
    scope: access.scope,
    individualUnlocks: access.individualUnlocks,
    subscription: access.subscription
  });
}

async function handleAdminDashboard(client: any, body: any, request: Request, admin: any) {
  const country = body.countryCode ? countryCode(body.countryCode) : '';
  const status = String(body.status || '').trim();
  let drawQuery = client.from('resultat_aide_draws')
    .select('*')
    .order('draw_date', { ascending: false })
    .order('draw_time', { ascending: false })
    .limit(300);
  if (country) drawQuery = drawQuery.eq('country_code', country);
  if (status) drawQuery = drawQuery.eq('status', status);
  if (body.fromDate) drawQuery = drawQuery.gte('draw_date', parseDate(body.fromDate));
  if (body.toDate) drawQuery = drawQuery.lte('draw_date', parseDate(body.toDate));
  const bounds = weekBounds(body.weekKey);
  if (bounds) drawQuery = drawQuery.gte('draw_date', bounds[0]).lte('draw_date', bounds[1]);
  if (/^\d{4}-\d{2}$/.test(String(body.monthKey || ''))) {
    const month = String(body.monthKey);
    const start = `${month}-01`;
    const endDate = new Date(`${month}-01T12:00:00Z`);
    endDate.setUTCMonth(endDate.getUTCMonth() + 1);
    endDate.setUTCDate(0);
    drawQuery = drawQuery.gte('draw_date', start).lte('draw_date', endDate.toISOString().slice(0, 10));
  }
  if (body.drawTime && isValidTime(body.drawTime)) {
    drawQuery = drawQuery.eq('draw_time', String(body.drawTime).slice(0, 5));
  }
  const [draws, matches, stats, dayStats, delayStats, traffic, disputes] = await Promise.all([
    drawQuery,
    client.from('resultat_aide_matches').select('*').order('programme_date', { ascending: false }).limit(2000),
    client.from('resultat_aide_weekly_stats').select('*').order('week_key', { ascending: false }).limit(1000),
    client.from('resultat_aide_day_stats').select('*').order('country_code', { ascending: true }).order('day_of_week', { ascending: true }).limit(1000),
    client.from('resultat_aide_delay_stats').select('*').order('country_code', { ascending: true }).order('day_offset', { ascending: true }).limit(2000),
    client.from('resultat_aide_traffic_events').select('event_type,country_code,path,occurred_at,metadata').order('occurred_at', { ascending: false }).limit(3000),
    client.from('resultat_aide_disputes').select('*').order('created_at', { ascending: false }).limit(300)
  ]);
  for (const result of [draws, matches, stats, dayStats, delayStats, traffic, disputes]) {
    if (result.error) throw result.error;
  }
  const records = (matches.data || []).map((row: any) => ({
    countryCode: row.country_code,
    drawDate: row.programme_date,
    drawTime: row.draw_time,
    dayKey: row.programme_date,
    weekKey: weekKey(row.programme_date),
    monthKey: String(row.programme_date).slice(0, 7),
    dayOfWeek: new Date(`${row.programme_date}T12:00:00Z`).getUTCDay(),
    programKey: row.program_key,
    programName: row.program_name,
      match: {
      snapshotId: row.snapshot_id,
      countryCode: row.country_code,
      programmeDate: row.programme_date,
      drawTime: row.draw_time,
      programKey: row.program_key,
      programName: row.program_name,
        kind: row.prediction_kind,
        drawDate: row.draw_date || row.programme_date,
        dayOffset: Number(row.day_offset || 0),
        predictionDay: row.prediction_day || '',
        drawDay: row.draw_day || '',
        predictionLabel: row.prediction_label || null,
        satelliteValue: row.satellite_value ?? null,
        combinationIndex: row.combination_index ?? null,
        permutationLabel: row.permutation_label || null,
        permutationNumbers: row.permutation_numbers || [],
        permutationCombinationIndexes: row.permutation_combination_indexes || [],
      predictedNumbers: row.predicted_numbers || [],
      matchedNumbers: row.matched_numbers || [],
      matchedGroups: row.matched_groups || [],
      level: row.match_level,
      hit: Boolean(row.hit),
      publishedDrawStatus: 'published'
    }
  }));
  const trafficSummary = (traffic.data || []).reduce((map: Record<string, number>, item: any) => {
    const key = `${item.event_type}:${item.country_code || item.metadata?.countryLabel || 'ALL'}`;
    map[key] = (map[key] || 0) + 1;
    return map;
  }, {});
  await recordTraffic(client, 'admin_view', request, country || null, admin.user.id);
  return json({
    ok: true,
    canDeleteResults: Boolean(admin.role === 'admin' || admin.principal),
    draws: draws.data || [],
    records,
    stats: stats.data || [],
    dayStats: dayStats.data || [],
    delayStats: delayStats.data || [],
    traffic: { events: traffic.data || [], summary: trafficSummary },
    disputes: disputes.data || []
  });
}

async function handleAdminImportDraws(client: any, body: any, request: Request, admin: any) {
  const country = countryCode(body.countryCode);
  const inputRows = Array.isArray(body.draws) ? body.draws : [];
  if (!country || !inputRows.length || inputRows.length > 500) {
    return json({ error: 'Choisissez un pays et envoyez entre 1 et 500 tirages.' }, 400);
  }

  type ImportedDrawRow = {
    drawDate: string;
    drawTime: string;
    drawNumber: number | null;
    first: number[];
    machine: number[];
    bonus: number[];
    programName: string;
  };
  const normalized: ImportedDrawRow[] = inputRows.map((row: any) => {
    const drawDate = parseDate(row?.drawDate || row?.date);
    const drawTime = String(row?.drawTime || row?.time || '').trim().slice(0, 5);
    const first = numberList(row?.first, 10);
    const machine = numberList(row?.machine, 10);
    const bonus = numberList(row?.bonus, 10);
    const parsedDrawNumber = Number.parseInt(String(row?.drawNumber ?? '').trim(), 10);
    const drawNumber = Number.isInteger(parsedDrawNumber) && parsedDrawNumber >= 0
      ? parsedDrawNumber
      : null;
    const programName = String(row?.programName || '').trim().slice(0, 120);
    return {
      drawDate,
      drawTime,
      drawNumber,
      first,
      machine,
      bonus,
      programName
    };
  });

  const invalid = normalized.findIndex((row) => (
    !row.drawDate
    || !isValidTime(row.drawTime)
    || !row.drawTime
    || !row.first.length
  ));
  if (invalid >= 0) {
    return json({
      error: `La ligne ${invalid + 1} doit contenir une date, une heure et au moins un numéro gagnant.`
    }, 400);
  }

  // One ranged read replaces a lookup per row: a historical paste can cover
  // hundreds of days. A draw is a duplicate when the same country already has
  // a row for that date at the same time, or with the same draw number.
  const dates = normalized.map((row) => row.drawDate).sort();
  const existingRows = await client.from('resultat_aide_draws')
    .select('draw_date,draw_time,draw_number')
    .eq('country_code', country)
    .gte('draw_date', dates[0])
    .lte('draw_date', dates[dates.length - 1])
    .in('status', ['pending', 'published', 'disputed'])
    .limit(5000);
  if (existingRows.error) throw existingRows.error;
  const seen = new Set<string>();
  const seenNumbers = new Set<string>();
  (existingRows.data || []).forEach((row: any) => {
    seen.add(`${row.draw_date}|${String(row.draw_time || '').slice(0, 5)}`);
    if (row.draw_number !== null && row.draw_number !== undefined) {
      seenNumbers.add(`${row.draw_date}|#${row.draw_number}`);
    }
  });
  const duplicates: string[] = [];
  const accepted: ImportedDrawRow[] = [];
  for (const row of normalized) {
    const slot = `${row.drawDate}|${row.drawTime}`;
    const numberSlot = row.drawNumber === null ? '' : `${row.drawDate}|#${row.drawNumber}`;
    if (seen.has(slot) || (numberSlot && seenNumbers.has(numberSlot))) {
      duplicates.push(`${row.drawDate} ${row.drawTime}`);
      continue;
    }
    seen.add(slot);
    if (numberSlot) seenNumbers.add(numberSlot);
    accepted.push(row);
  }
  accepted.sort((left, right) => (
    left.drawDate.localeCompare(right.drawDate) || left.drawTime.localeCompare(right.drawTime)
  ));

  if (!accepted.length) {
    return json({
      ok: true,
      inserted: 0,
      duplicates,
      message: 'Tous les résultats proposés existent déjà dans la base.'
    });
  }

  const source = String(body.source || 'admin-import-document').slice(0, 80);
  const batchId = crypto.randomUUID();
  const inserted = await client.from('resultat_aide_draws').insert(accepted.map((row) => ({
    country_code: country,
    draw_date: row.drawDate,
    draw_time: row.drawTime,
    draw_number: row.drawNumber,
    first_numbers: row.first,
    machine_numbers: row.machine,
    bonus_numbers: row.bonus,
    input_schema: {
      ...normalizeInputSchema({}, row.first, row.machine, row.bonus),
      import: {
        programName: row.programName,
        source,
        batchId,
        importedBy: 'principal-administrator'
      }
    },
    status: 'published',
    source,
    submitted_by: admin.user.id,
    batch_id: batchId,
    series_start: accepted[0].drawDate,
    series_end: accepted[accepted.length - 1].drawDate,
    series_complete: false,
    validated_by: admin.user.id,
    validation_note: 'Import documentaire validé par l’administrateur principal.',
    validated_at: nowIso(),
    published_at: nowIso()
  }))).select('*');
  if (inserted.error) throw inserted.error;

  const evaluated = [];
  for (const draw of inserted.data || []) {
    try {
      evaluated.push(await evaluateDraw(
        client,
        draw,
        admin.user.id,
        'Import documentaire validé par l’administrateur principal.'
      ));
    } catch (error) {
      // The result itself is already valid and published. An older
      // installation may not yet have every prediction archive table, so do
      // not lose the imported draw only because its optional evaluation is
      // temporarily unavailable.
      console.error('admin import evaluation failed', error);
      evaluated.push({ draw });
    }
  }
  try {
    await rebuildWeeklyStats(client, country);
  } catch (error) {
    console.error('admin import statistics rebuild failed', error);
  }
  await recordTraffic(client, 'admin_view', request, country, admin.user.id, {
    batchId,
    count: accepted.length,
    duplicates: duplicates.length,
    source,
    action: 'admin_import'
  });
  return json({
    ok: true,
    batchId,
    inserted: accepted.length,
    duplicates,
    draws: evaluated.map((item) => item.draw),
    message: `${accepted.length} résultat(s) enregistré(s) et publié(s).${duplicates.length ? ` ${duplicates.length} doublon(s) ignoré(s).` : ''}`
  });
}

async function handleAdminResultSchedules(client: any, body: any, request: Request, admin: any) {
  const action = String(body.action || 'list').trim().toLowerCase();
  const country = countryCode(body.countryCode);
  if (!country) return json({ error: 'Le pays est requis pour les horaires de routine.' }, 400);

  if (action === 'list') {
    const result = await client.from('resultat_aide_schedules')
      .select('id,country_code,program_name,day_of_week,draw_time,source,enabled')
      .eq('country_code', country)
      .order('program_name', { ascending: true })
      .order('day_of_week', { ascending: true, nullsFirst: true });
    if (result.error) throw result.error;
    return json({ ok: true, schedules: result.data || [] });
  }

  if (action !== 'save') return json({ error: 'Action horaire inconnue.' }, 400);
  const rows = Array.isArray(body.schedules) ? body.schedules : [];
  if (!rows.length || rows.length > 100) {
    return json({ error: 'Envoyez entre 1 et 100 horaires de routine.' }, 400);
  }
  type ResultScheduleRow = {
    programName: string;
    dayOfWeek: number | null;
    drawTime: string;
  };
  const normalized: ResultScheduleRow[] = rows.map((row: any) => {
    const programName = String(row?.programName || '').trim().slice(0, 120);
    const rawDay = row?.dayOfWeek;
    const dayOfWeek = rawDay === null || rawDay === '' || rawDay === undefined
      ? null
      : Number.parseInt(String(rawDay), 10);
    const drawTime = String(row?.drawTime || '').trim().slice(0, 5);
    return { programName, dayOfWeek, drawTime };
  });
  const invalid = normalized.findIndex((row) => (
    row.programName.length < 1
    || (row.dayOfWeek !== null && (!Number.isInteger(row.dayOfWeek) || row.dayOfWeek < 0 || row.dayOfWeek > 6))
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.drawTime)
  ));
  if (invalid >= 0) {
    return json({ error: `La routine ${invalid + 1} est invalide. Utilisez Nom=HH:MM et un jour compris entre 0 et 6.` }, 400);
  }

  for (const row of normalized) {
    let existingQuery = client.from('resultat_aide_schedules')
      .select('id')
      .eq('country_code', country)
      .eq('program_name', row.programName);
    existingQuery = row.dayOfWeek === null
      ? existingQuery.is('day_of_week', null)
      : existingQuery.eq('day_of_week', row.dayOfWeek);
    const existing = await existingQuery.maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.id) {
      const updated = await client.from('resultat_aide_schedules')
        .update({
          draw_time: row.drawTime,
          source: 'admin-routine',
          enabled: true,
          updated_at: nowIso(),
          created_by: admin.user.id
        })
        .eq('id', existing.data.id);
      if (updated.error) throw updated.error;
    } else {
      const inserted = await client.from('resultat_aide_schedules').insert({
        country_code: country,
        program_name: row.programName,
        day_of_week: row.dayOfWeek,
        draw_time: row.drawTime,
        source: 'admin-routine',
        enabled: true,
        created_by: admin.user.id
      });
      if (inserted.error) throw inserted.error;
    }
  }
  await recordTraffic(client, 'admin_view', request, country, admin.user.id, {
    action: 'admin_schedule_save',
    count: normalized.length
  });
  return json({
    ok: true,
    saved: normalized.length,
    message: `${normalized.length} horaire(s) de routine enregistré(s) pour ${country}.`
  });
}

async function handleValidate(client: any, body: any, request: Request, admin: any) {
  const id = String(body.drawId || '').trim();
  if (!id) return json({ error: 'drawId est requis.' }, 400);
  const draw = await client.from('resultat_aide_draws').select('*').eq('id', id).single();
  if (draw.error) throw draw.error;
  if (body.status === 'rejected') {
    await clearDrawEvaluation(client, id);
    const rejected = await client.from('resultat_aide_draws').update({
      status: 'rejected',
      validated_by: admin.user.id,
      validation_note: String(body.note || '').slice(0, 1000),
      validated_at: nowIso(),
      updated_at: nowIso()
    }).eq('id', id).select('*').single();
    if (rejected.error) throw rejected.error;
    if (draw.data?.country_code) {
      await rebuildWeeklyStats(client, draw.data.country_code);
    }
    return json({ ok: true, draw: rejected.data });
  }
  const result = await evaluateDraw(
    client,
    draw.data,
    admin.user.id,
    String(body.note || '').slice(0, 1000)
  );
  await recordTraffic(client, 'admin_view', request, draw.data.country_code, admin.user.id, { action: 'validate' });
  return json({
    ok: true,
    draw: result.draw,
    matches: result.matches,
    stats: result.stats
  });
}

async function handleDispute(client: any, body: any, request: Request, user: any) {
  const drawId = String(body.drawId || '').trim();
  const reason = String(body.reason || '').trim();
  if (!drawId || reason.length < 3) return json({ error: 'Résultat et motif de contestation requis.' }, 400);
  const inserted = await client.from('resultat_aide_disputes').insert({
    draw_id: drawId,
    submitted_by: user?.id || null,
    reason: reason.slice(0, 1000),
    evidence_reference: String(body.evidence || '').trim().slice(0, 2000)
  }).select('id,draw_id,status,created_at').single();
  if (inserted.error) throw inserted.error;
  const existingDraw = await client.from('resultat_aide_draws')
    .select('country_code,dispute_count')
    .eq('id', drawId)
    .maybeSingle();
  await client.from('resultat_aide_draws')
    .update({
      status: 'disputed',
      dispute_count: Number(existingDraw.data?.dispute_count || 0) + 1,
      updated_at: nowIso()
    })
    .eq('id', drawId)
    .eq('status', 'published');
  await clearDrawEvaluation(client, drawId);
  if (existingDraw.data?.country_code) {
    await rebuildWeeklyStats(client, existingDraw.data.country_code);
  }
  await recordTraffic(client, 'dispute', request, null, user?.id || null);
  return json({ ok: true, dispute: inserted.data });
}

export async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);
  let body: any;
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: 'Le corps doit être un JSON valide.' }, 400);
  }
  const client = adminClient();
  const action = String(body?.action || 'public-suggestions').trim().toLowerCase();
  const auth = await authenticate(client, request);
  try {
    if (action === 'public-draw-number-memory') {
      return await handlePublicDrawNumberMemory(client, body, request);
    }
    if (action === 'public-suggestions' || action === 'public-stats') {
      return await handlePublicSuggestions(client, body, request);
    }
    if (action === 'record-program-view') {
      return await handleProgramView(client, body, request, auth.user);
    }
    if (action === 'viewer-state') {
      return await handleViewerState(client, auth);
    }
    if (action === 'pending-draw') {
      return await handlePendingDraw(client, request, auth.user);
    }
    if (action === 'confirm-draw') {
      return await handleConfirmDraw(client, body, request, auth.user);
    }
    if (action === 'result-metadata') {
      return await handleResultMetadata(client, body, request, auth);
    }
    if (action === 'submit-draw') {
      return await handleSubmit(client, body, request, auth.user);
    }
    if (action === 'submit-draw-series') {
      return await handleSubmitSeries(client, body, request, auth.user);
    }
    if (action === 'editable-draws') {
      return await handleEditableDraws(client, request, auth.user);
    }
    if (action === 'update-draw') {
      return await handleUpdateDraw(client, body, request, auth.user);
    }
    if (action === 'delete-draw') {
      return await handleDeleteDraw(client, body, request, auth.user);
    }
    if (action === 'dispute-draw') {
      return await handleDispute(client, body, request, auth.user);
    }
    if (action === 'admin-dashboard') {
      const admin = await requireAdmin(client, request);
      if (!admin) return json({ error: 'Accès administrateur refusé.' }, 403);
      return await handleAdminDashboard(client, body, request, admin);
    }
    if (action === 'admin-result-schedules' || action === 'admin-save-result-schedules') {
      const admin = await requirePrincipalAdmin(client, request);
      if (!admin) return json({ error: 'Seul l’administrateur principal peut gérer les horaires de routine.' }, 403);
      return await handleAdminResultSchedules(
        client,
        { ...body, action: action === 'admin-save-result-schedules' ? 'save' : 'list' },
        request,
        admin
      );
    }
    if (action === 'admin-import-draws') {
      const admin = await requirePrincipalAdmin(client, request);
      if (!admin) return json({ error: 'Seul l’administrateur principal peut importer des résultats.' }, 403);
      return await handleAdminImportDraws(client, body, request, admin);
    }
    if (action === 'validate-draw') {
      const admin = await requireAdmin(client, request);
      if (!admin) return json({ error: 'Accès administrateur refusé.' }, 403);
      return await handleValidate(client, body, request, admin);
    }
    if (action === 'list-published') {
      const country = body.countryCode ? countryCode(body.countryCode) : '';
      const historyGate = await resultHistoryGate(client, auth.user);
      let query = client.from('resultat_aide_draws')
        .select('id,country_code,draw_date,draw_time,draw_number,first_numbers,machine_numbers,bonus_numbers,status,batch_id,series_start,series_end,series_complete,created_at,published_at')
        .eq('status', 'published')
        .order('draw_date', { ascending: false })
        .order('country_code', { ascending: true })
        .limit(500);
      if (!historyGate.unlocked) query = query.gte('draw_date', historyGate.cutoff);
      if (country) query = query.eq('country_code', country);
      const result = await query;
      if (result.error) throw result.error;
      return json({ ok: true, draws: result.data || [] });
    }
    return json({ error: 'Action Résultat-Aide inconnue.' }, 400);
  } catch (error) {
    console.error('result-helf failed', error);
    return json({
      error: error instanceof Error ? error.message : 'Le service Résultat-Aide est indisponible.'
    }, 500);
  }
}

Deno.serve(handler);
