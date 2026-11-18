/*
 * Aide Cidmap : accessible avec un forfait global actif ou un Tableau
 * individuel encore valide.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  dateIso,
  programmeDateFromClock,
  publicProgramPayload
} from '../_shared.ts';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

const PROGRAM_CATALOG = [
  ['universelle', 'Universelle'],
  ['intuition', 'Intuition'],
  ['oracle', 'Oracle'],
  ['lnb', 'LNB'],
  ['balsa', 'Balsa Plus'],
  ['standby', 'Stand-by'],
  ['robot', 'Robot'],
  ['created', 'Programmes personnalisés'],
  ['croix', 'Croix nationale'],
  ['matrice', 'Matrice'],
  ['boules-rejetees', 'Boules rejetées'],
  ['dechiffrement-plus', 'Déchiffrement Plus / MT']
] as const;

const RECOMMENDATION_PROGRAMS = PROGRAM_CATALOG
  .filter(([key]) => ['universelle', 'intuition', 'oracle', 'lnb', 'balsa'].includes(key))
  .map(([key, name]) => ({ key, name }));
const MIN_RECOMMENDATION_DRAWS = 3;
const CURRENT_PROGRAM_TABLES = [
  ['universelle', 'Universelle', 'daily_universal_programs'],
  ['intuition', 'Intuition', 'daily_intuition_programs'],
  ['oracle', 'Oracle', 'daily_oracle_programs'],
  ['lnb', 'LNB', 'daily_lnb_programs'],
  ['balsa', 'Balsa Plus', 'daily_balsa_programs'],
  ['standby', 'Stand-by', 'daily_standby_programs'],
  ['robot', 'Robot', 'daily_robot_programs']
] as const;

function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Configuration Supabase serveur incomplète.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function auth(client: any, request: Request) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const result = await client.auth.getUser(token);
  return result.error ? null : result.data?.user || null;
}

async function readUserLocale(client: any, userId: string) {
  const result = await client
    .from('user_language_preferences')
    .select('locale_code')
    .eq('user_id', userId)
    .maybeSingle();
  if (result.error && !/user_language_preferences|relation .* does not exist/i
    .test(String(result.error.message || ''))) {
    throw result.error;
  }
  return String(result.data?.locale_code || 'fr').trim() || 'fr';
}

async function readAccess(client: any, user: any) {
  const now = new Date().toISOString();
  const [profile, subscription, unlocks, subscriptionHistory, roleResult, localeCode] = await Promise.all([
    client.from('profiles').select('full_name,email,country').eq('id', user.id).maybeSingle(),
    client.from('user_subscriptions')
      .select('plan_slug,status,started_at,expires_at')
      .eq('user_id', user.id).eq('status', 'active')
      .lte('started_at', now)
      .or(`expires_at.is.null,expires_at.gt.${now}`).maybeSingle(),
    client.from('user_feature_unlocks')
      .select('feature_key,unlocked_at,expires_at')
      .eq('user_id', user.id)
      .or('feature_key.like.tableaux-%,feature_key.like.historique-%')
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('feature_key', { ascending: true }),
    client.from('user_subscriptions')
      .select('plan_slug,status,started_at,expires_at')
      .eq('user_id', user.id)
      .order('started_at', { ascending: true }),
    client.from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .in('role', ['admin', 'moderator'])
      .limit(1),
    readUserLocale(client, user.id)
  ]);
  if (profile.error) throw profile.error;
  if (subscription.error) throw subscription.error;
  if (unlocks.error) throw unlocks.error;
  if (subscriptionHistory.error) throw subscriptionHistory.error;
  if (roleResult.error && !/user_roles|relation .* does not exist/i.test(String(roleResult.error.message || ''))) {
    throw roleResult.error;
  }
  let plan: any = null;
  if (subscription.data?.plan_slug) {
    const result = await client.from('subscription_plans')
      .select('slug,display_name,enabled,features')
      .eq('slug', subscription.data.plan_slug).maybeSingle();
    if (result.error) throw result.error;
    plan = result.data;
  }
  const individualUnlocks = (unlocks.data || []).map((unlock: any) => ({
    featureKey: unlock.feature_key,
    unlockedAt: unlock.unlocked_at,
    expiresAt: unlock.expires_at
  }));
  const historyUnlocks = individualUnlocks.filter((unlock: any) =>
    String(unlock.featureKey || '').startsWith('historique-')
  );
  const activeSubscription = Boolean(subscription.data && plan?.enabled !== false);
  const role = String(roleResult.data?.[0]?.role || '');
  const isAdmin = role === 'admin';
  const isModerator = role === 'moderator';
  const active = Boolean(activeSubscription || individualUnlocks.length || isAdmin || isModerator);
  const history = subscriptionHistory.data || [];
  const firstSubscribedAt = history[0]?.started_at || null;
  const loyaltyMonths = firstSubscribedAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(firstSubscribedAt)) / (86400000 * 30.44)))
    : 0;
  const access = {
    canHelp: active,
    isAdmin,
    isModerator,
    user: {
      id: user.id,
      name: String(profile.data?.full_name || user.user_metadata?.full_name || 'Membre Cidmap'),
      email: String(user.email || profile.data?.email || ''),
      country: String(profile.data?.country || '')
    },
    subscription: activeSubscription ? {
      planSlug: subscription.data.plan_slug,
      planName: plan.display_name || subscription.data.plan_slug,
      startsAt: subscription.data.started_at,
      expiresAt: subscription.data.expires_at,
      features: Array.isArray(plan.features) ? plan.features : []
    } : null,
    individualUnlocks,
    historyUnlocks,
    loyalty: {
      subscriptionCount: history.length,
      firstSubscribedAt,
      loyaltyMonths,
      level: loyaltyMonths >= 12 ? 'longue durée'
        : loyaltyMonths >= 6 ? 'fidèle'
          : history.length >= 2 ? 'régulier' : 'récent'
    }
  };
  return {
    ...access,
    localeCode,
    scope: accessScope(access)
  };
}

function dayName(dateText: string) {
  const names = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const date = new Date(`${dateText}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? '' : names[date.getUTCDay()];
}

function isoWeek(dateText: string) {
  const date = new Date(`${dateText}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - start.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function normalizeCountry(value: unknown) {
  const raw = String(value || '').trim().toLowerCase();
  const folded = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const aliases: Record<string, string> = {
    bj: 'BJ',
    benin: 'BJ',
    'cote d ivoire': 'CI',
    'cote divoire': 'CI',
    ci: 'CI',
    niger: 'NE',
    ne: 'NE',
    ghana: 'GH',
    gh: 'GH',
    guinee: 'GN',
    guinea: 'GN',
    gn: 'GN',
    senegal: 'SN',
    sn: 'SN',
    togo: 'TG',
    tg: 'TG'
  };
  return aliases[folded] || aliases[raw] || folded.toUpperCase().slice(0, 8);
}

function canReadProgram(access: any, programKey: string) {
  if (access?.isAdmin || access?.isModerator) return true;
  const features = [
    ...(access.subscription?.features || []),
    ...(access.individualUnlocks || []).map((item: any) => item.featureKey)
  ].map((feature: unknown) => String(feature).toLowerCase());
  return features.includes('tableaux')
    || features.includes(`tableaux-${programKey}`)
    || features.includes(programKey);
}

function canonicalProgramKey(value: unknown): string {
  return String(value || '').trim().toLowerCase()
    .replace(/^tableaux-/, '')
    .replace(/[_\s]+/g, '-')
    .replace(/^balsa-plus$/, 'balsa')
    .replace(/^stand-by$/, 'standby');
}

function recommendationFeatureKey(value: unknown) {
  const key = canonicalProgramKey(value);
  return key === 'universal' ? 'universelle' : key;
}

function recommendationFeatureKeys(features: unknown): string[] {
  const values = Array.isArray(features) ? features : [];
  const all = values.some((feature) => canonicalProgramKey(feature) === 'tableaux');
  const keys = all
    ? RECOMMENDATION_PROGRAMS.map((program) => program.key)
    : values.map(recommendationFeatureKey);
  return [...new Set(keys.filter((key) => (
    RECOMMENDATION_PROGRAMS.some((program) => program.key === key)
  )))];
}

function recommendationProgramName(key: string, fallback = '') {
  return RECOMMENDATION_PROGRAMS.find((program) => program.key === key)?.name
    || String(fallback || key);
}

function dayOfWeek(dateText: string) {
  const date = new Date(`${dateText}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? -1 : date.getUTCDay();
}

function buildDrawNumberMemory(rows: any[]) {
  const grouped = new Map<string, any>();
  for (const row of rows || []) {
    const countryCode = String(row?.country_code || '').toUpperCase();
    const date = String(row?.draw_date || '');
    const time = String(row?.draw_time || '').slice(0, 5);
    const drawNumber = Number(row?.draw_number);
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
    const weekday = dayOfWeek(date);
    if (weekday >= 0) series.weekdays.add(weekday);
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
    const reliable = ordered.length >= 3
      && increment !== null
      && trailingIncrementCount >= 2;
    return {
      countryCode: item.countryCode,
      drawTime: item.drawTime,
      observations: ordered.length,
      observedWeekdays: [...item.weekdays].sort((left, right) => left - right),
      latest: ordered.at(-1) || null,
      increment,
      trailingIncrementCount,
      confidence: reliable ? 'historical-sequence' : 'insufficient',
      recent: ordered.slice(-12)
    };
  }).sort((left, right) => (
    left.countryCode.localeCompare(right.countryCode)
    || left.drawTime.localeCompare(right.drawTime)
  ));
  return {
    generatedAt: new Date().toISOString(),
    minimumObservations: 3,
    series,
    note: 'Mémoire calculée uniquement avec les numéros de tirage des résultats published. Une estimation reste une estimation et doit être confirmée si la séquence est interrompue.'
  };
}

async function readDrawNumberMemory(client: any) {
  const result = await client.from('resultat_aide_draws')
    .select('country_code,draw_date,draw_time,draw_number')
    .eq('status', 'published')
    .order('draw_date', { ascending: true })
    .order('draw_time', { ascending: true })
    .limit(10000);
  if (result.error) {
    if (optionalRecommendationError(result.error, 'resultat_aide_draws')) {
      return buildDrawNumberMemory([]);
    }
    throw result.error;
  }
  return buildDrawNumberMemory(result.data || []);
}

function optionalRecommendationError(error: any, relation = '') {
  return Boolean(error) && (
    String(error?.code || '') === '42P01'
    || /relation .* does not exist|column .* does not exist|schema cache|resultat_aide_|subscription_plans|feature_access_rules/i
      .test(String(error?.message || ''))
    || (relation && String(error?.message || '').includes(relation))
  );
}

function recommendationPrice(row: any) {
  const currency = String(row?.unlock_currency || 'stars').toLowerCase() === 'tokens'
    ? 'tokens'
    : 'stars';
  const amount = currency === 'tokens'
    ? Math.max(0, Number(row?.required_tokens) || 0)
    : Math.max(0, Number(row?.required_stars) || 0);
  const regularAmount = currency === 'tokens'
    ? Math.max(0, Number(row?.regular_tokens ?? row?.required_tokens) || 0)
    : amount;
  const label = String(row?.price_label || '').trim();
  return {
    currency,
    amount,
    regularAmount,
    label,
    configured: Boolean(label || amount > 0),
    promotion: row?.promotion_enabled === true
      && regularAmount > amount
      && (!row?.promotion_ends_at || Date.parse(row.promotion_ends_at) > Date.now())
  };
}

function publicRecommendationOffer(row: any, kind: 'individual' | 'bundle', featureKeys: string[]) {
  return {
    kind,
    slug: String(row?.slug || ''),
    name: String(row?.display_name || row?.slug || 'Forfait'),
    durationDays: Math.max(1, Number(row?.duration_days) || 30),
    features: featureKeys.map((key) => ({
      key,
      name: recommendationProgramName(key)
    })),
    price: recommendationPrice(row)
  };
}

async function readRecommendationCatalogue(client: any) {
  const planColumns = [
    'slug,display_name,required_stars,unlock_currency,required_tokens,regular_tokens,',
    'promotion_enabled,promotion_label,promotion_ends_at,duration_days,price_label,features,enabled'
  ].join('');
  const legacyPlanColumns = [
    'slug,display_name,required_stars,unlock_currency,required_tokens,',
    'duration_days,price_label,features,enabled'
  ].join('');
  const [plansResult, rulesResult] = await Promise.all([
    client.from('subscription_plans').select(planColumns)
      .eq('enabled', true).order('required_stars', { ascending: true }).limit(80),
    client.from('feature_access_rules')
      .select('feature_key,display_name,required_stars,unlock_currency,required_tokens,duration_days,plan_slug,enabled')
      .eq('enabled', true).order('display_name', { ascending: true }).limit(80)
  ]);

  let plans = plansResult.data || [];
  if (plansResult.error && /regular_tokens|column .* does not exist|schema cache/i
    .test(String(plansResult.error.message || ''))) {
    const legacy = await client.from('subscription_plans').select(legacyPlanColumns)
      .eq('enabled', true).order('required_stars', { ascending: true }).limit(80);
    if (!legacy.error) {
      plans = (legacy.data || []).map((plan: any) => ({
        ...plan,
        regular_tokens: Number(plan.required_tokens) || 0
      }));
    } else if (!optionalRecommendationError(legacy.error, 'subscription_plans')) {
      throw legacy.error;
    }
  } else if (plansResult.error && !optionalRecommendationError(plansResult.error, 'subscription_plans')) {
    throw plansResult.error;
  }
  if (rulesResult.error && !optionalRecommendationError(rulesResult.error, 'feature_access_rules')) {
    throw rulesResult.error;
  }

  const individualByKey = new Map<string, any>();
  for (const rule of rulesResult.data || []) {
    const key = recommendationFeatureKey(rule.feature_key);
    if (!RECOMMENDATION_PROGRAMS.some((program) => program.key === key)) continue;
    individualByKey.set(key, {
      kind: 'individual',
      slug: `feature:${key}`,
      name: String(rule.display_name || recommendationProgramName(key)),
      duration_days: rule.duration_days,
      unlock_currency: rule.unlock_currency,
      required_stars: rule.required_stars,
      required_tokens: rule.required_tokens,
      price_label: '',
      features: [`tableaux-${key}`],
      ruleConfigured: true
    });
  }

  const individualOffers: Record<string, any[]> = {};
  const bundleOffers: Record<string, any[]> = {};
  for (const program of RECOMMENDATION_PROGRAMS) {
    individualOffers[program.key] = [];
    bundleOffers[program.key] = [];
  }
  for (const plan of plans) {
    const featureKeys = recommendationFeatureKeys(plan.features);
    if (!featureKeys.length) continue;
    if (featureKeys.length === 1) {
      individualByKey.set(featureKeys[0], plan);
    } else {
      featureKeys.forEach((key) => {
        bundleOffers[key].push(publicRecommendationOffer(plan, 'bundle', featureKeys));
      });
    }
  }
  for (const program of RECOMMENDATION_PROGRAMS) {
    const individual = individualByKey.get(program.key);
    if (individual) {
      individualOffers[program.key].push(
        publicRecommendationOffer(individual, 'individual', [program.key])
      );
    }
    bundleOffers[program.key] = bundleOffers[program.key].slice(0, 6);
  }
  return { individualOffers, bundleOffers };
}

function recommendationMetricPercentage(row: any) {
  const value = Number(row?.overall_metric?.percentage);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function buildRecommendationCountry(
  countryCode: string,
  publishedDraws: number,
  publishedDates: string[],
  weeklyRows: any[]
) {
  const grouped = new Map<string, any>();
  for (const row of weeklyRows) {
    const key = recommendationFeatureKey(row.program_key);
    if (!RECOMMENDATION_PROGRAMS.some((program) => program.key === key)) continue;
    const draws = Math.max(0, Number(row.draws_evaluated) || 0);
    if (!draws) continue;
    const current = grouped.get(key) || {
      programKey: key,
      programName: recommendationProgramName(key, row.program_name),
      observations: 0,
      weightedScore: 0,
      weeks: new Set<string>()
    };
    current.observations += draws;
    current.weightedScore += recommendationMetricPercentage(row) * draws;
    if (row.week_key) current.weeks.add(String(row.week_key));
    grouped.set(key, current);
  }
  const programs = [...grouped.values()]
    .map((row) => ({
      programKey: row.programKey,
      programName: row.programName,
      observations: row.observations,
      weeks: row.weeks.size,
      score: Math.round((row.weightedScore / Math.max(1, row.observations)) * 10) / 10,
      sufficient: publishedDraws >= MIN_RECOMMENDATION_DRAWS
        && row.observations >= MIN_RECOMMENDATION_DRAWS
    }))
    .sort((left, right) => (
      Number(right.sufficient) - Number(left.sufficient)
      || right.score - left.score
      || right.observations - left.observations
    ))
    .map((row, index) => ({ ...row, rank: index + 1 }));
  const recommended = programs.find((program) => program.sufficient) || null;
  return {
    countryCode,
    publishedDraws,
    firstPublishedDate: publishedDates.slice().sort()[0] || null,
    lastPublishedDate: publishedDates.slice().sort().at(-1) || null,
    sufficient: Boolean(recommended),
    recommendation: recommended,
    programs: programs.slice(0, RECOMMENDATION_PROGRAMS.length)
  };
}

async function readRecommendationProjection(client: any) {
  const [drawsResult, weeklyResult, catalogue] = await Promise.all([
    client.from('resultat_aide_draws')
      .select('country_code,draw_date')
      .eq('status', 'published')
      .order('draw_date', { ascending: false })
      .limit(10000),
    client.from('resultat_aide_weekly_stats')
      .select('country_code,week_key,program_key,program_name,draws_evaluated,overall_metric')
      .order('week_key', { ascending: false })
      .limit(5000),
    readRecommendationCatalogue(client)
  ]);
  if (drawsResult.error && !optionalRecommendationError(drawsResult.error, 'resultat_aide_draws')) {
    throw drawsResult.error;
  }
  if (weeklyResult.error && !optionalRecommendationError(weeklyResult.error, 'resultat_aide_weekly_stats')) {
    throw weeklyResult.error;
  }
  const datesByCountry = new Map<string, string[]>();
  for (const draw of drawsResult.data || []) {
    const country = String(draw.country_code || '').toUpperCase();
    if (!country) continue;
    const dates = datesByCountry.get(country) || [];
    dates.push(String(draw.draw_date || ''));
    datesByCountry.set(country, dates);
  }
  const weeklyByCountry = new Map<string, any[]>();
  for (const row of weeklyResult.data || []) {
    const country = String(row.country_code || '').toUpperCase();
    if (!country) continue;
    const rows = weeklyByCountry.get(country) || [];
    rows.push(row);
    weeklyByCountry.set(country, rows);
  }
  const countries = [...new Set([...datesByCountry.keys(), ...weeklyByCountry.keys()])]
    .map((country) => buildRecommendationCountry(
      country,
      (datesByCountry.get(country) || []).length,
      datesByCountry.get(country) || [],
      weeklyByCountry.get(country) || []
    ))
    .sort((left, right) => (
      Number(right.sufficient) - Number(left.sufficient)
      || right.publishedDraws - left.publishedDraws
      || left.countryCode.localeCompare(right.countryCode)
    ))
    .slice(0, 80);
  return {
    generatedAt: new Date().toISOString(),
    source: 'resultat_aide_draws:published + resultat_aide_weekly_stats',
    minimumPublishedDraws: MIN_RECOMMENDATION_DRAWS,
    countries,
    offersByProgram: Object.fromEntries(RECOMMENDATION_PROGRAMS.map((program) => [
      program.key,
      {
        individual: catalogue.individualOffers[program.key] || [],
        bundles: catalogue.bundleOffers[program.key] || []
      }
    ])),
    note: 'Projection agrégée à partir des tirages published uniquement : pending, rejected et disputed sont exclus. Aucune clé, aucun numéro, aucune combinaison ni donnée privée de tableau non autorisé.'
  };
}

function authorizedProgramKeys(access: any): string[] {
  return PROGRAM_CATALOG
    .map(([key]) => key)
    .filter((key) => canReadProgram(access, key));
}

function accessScope(access: any) {
  const collective = Boolean(access?.subscription);
  const individual = (access?.individualUnlocks || [])
    .map((item: any) => canonicalProgramKey(item.featureKey))
    .filter(Boolean);
  const source = access?.isAdmin || access?.isModerator
    ? 'administration'
    : collective && individual.length
      ? 'collectif_et_individuel'
      : collective
        ? 'collectif'
        : individual.length
          ? 'individuel'
          : 'aucun';
  return {
    source,
    collective,
    individual,
    authorizedPrograms: authorizedProgramKeys(access)
  };
}

function missingCurrentProgramTable(error: any, tableName: string) {
  return Boolean(error) && (
    String(error?.code || '') === '42P01'
    || new RegExp(`${tableName}|relation .* does not exist|column .* does not exist|schema cache`, 'i')
      .test(String(error?.message || ''))
  );
}

/*
 * The assistant must be able to distinguish a current Tableau payload from
 * Résultat-Aide's historical match memory. Both are useful, but they answer
 * different questions. Read only the programmes authorized for this account
 * and expose the same public payload shape as the Tableau Edge Function.
 */
async function readCurrentProgramExperience(client: any, access: any) {
  const programmeDate = dateIso(programmeDateFromClock());
  const rows = await Promise.all(CURRENT_PROGRAM_TABLES
    .filter(([key]) => canReadProgram(access, key))
    .map(async ([key, name, table]) => {
      const result = await client
        .from(table)
        .select('programme_date,payload,created_at,updated_at')
        .eq('programme_date', programmeDate)
        .maybeSingle();
      if (result.error) {
        if (missingCurrentProgramTable(result.error, table)) {
          return {
            programKey: key,
            programName: name,
            programmeDate,
            available: false,
            sourceTable: table,
            reason: 'table-unavailable'
          };
        }
        throw result.error;
      }
      if (!result.data?.payload) {
        return {
          programKey: key,
          programName: name,
          programmeDate,
          available: false,
          sourceTable: table,
          reason: 'programme-unavailable'
        };
      }
      return {
        programKey: key,
        programName: name,
        programmeDate: String(result.data.programme_date || programmeDate),
        available: true,
        sourceTable: table,
        createdAt: result.data.created_at || null,
        updatedAt: result.data.updated_at || null,
        payload: publicProgramPayload(result.data.payload)
      };
    }));
  return rows;
}

function isMissingDechiffrementTable(error: any) {
  return /matrix_decoding_(history|programs)|relation .* does not exist/i.test(
    String(error?.message || ''),
  ) || String(error?.code || '') === '42P01';
}

function compactJsonArray(value: unknown, limit = 20) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function compactDechiffrementResult(result: any) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const type = String(result.type || '');
  if (type === 'dechiffrement-plus') {
    return {
      type,
      inputNumbers: compactJsonArray(result.inputNumbers, 20),
      selected: result.selected || null,
      calls: compactJsonArray(result.calls, 30)
    };
  }
  const analysis = result.analysis && typeof result.analysis === 'object'
    ? result.analysis
    : {};
  return {
    type: type || 'matrice',
    name: String(result.name || ''),
    country: String(result.country || ''),
    date: String(result.date || ''),
    source: String(result.source || ''),
    matrix: compactJsonArray(result.matrix, 8),
    keyboard: compactJsonArray(result.keyboard, 8),
    cerveau: compactJsonArray(result.cerveau, 8),
    code: String(result.code || ''),
    event: String(result.event || ''),
    tenNumbers: compactJsonArray(result.ten_numbers, 20),
    repeatedNumbers: compactJsonArray(analysis.repeatedNumbers, 20),
    levels: compactJsonArray(analysis.levels, 12)
  };
}

async function readDechiffrementExperience(client: any, access: any) {
  const method = 'Déchiffrement Plus / MT';
  if (!canReadProgram(access, 'dechiffrement-plus')) {
    return {
      available: false,
      method,
      historyCount: 0,
      matrixCount: 0,
      summaries: []
    };
  }

  const history = await client.from('matrix_decoding_history')
    .select('id,program_id,country_name,draw_time,programme_date,matrix,keyboard,cerveau,code,event,result,status,created_at')
    .eq('user_id', access.user.id)
    .order('created_at', { ascending: false })
    .limit(80);
  if (history.error) {
    if (isMissingDechiffrementTable(history.error)) {
      return {
        available: true,
        method,
        historyCount: 0,
        matrixCount: 0,
        summaries: [],
        storageReady: false
      };
    }
    throw history.error;
  }

  const programIds = [...new Set(
    (history.data || [])
      .map((row: any) => row.program_id)
      .filter(Boolean),
  )];
  let programs: any[] = [];
  if (programIds.length) {
    const programResult = await client.from('matrix_decoding_programs')
      .select('id,matrix,keyboard,cerveau,result,created_at')
      .in('id', programIds);
    if (programResult.error && !isMissingDechiffrementTable(programResult.error)) {
      throw programResult.error;
    }
    programs = programResult.data || [];
  }
  const programsById = new Map(programs.map((program: any) => [program.id, program]));
  const summaries = (history.data || []).map((row: any) => {
    const program = programsById.get(row.program_id);
    const result = compactDechiffrementResult(row.result || program?.result);
    const isPlus = result?.type === 'dechiffrement-plus';
    return {
      id: row.id,
      programId: row.program_id || null,
      country: String(row.country_name || ''),
      date: row.programme_date || null,
      drawTime: row.draw_time || null,
      code: String(row.code || ''),
      event: String(row.event || ''),
      status: String(row.status || ''),
      createdAt: row.created_at || null,
      source: isPlus ? 'Déchiffrement Plus' : 'Matrice / Clavier / Cerveau',
      matrix: isPlus ? [] : compactJsonArray(row.matrix?.length ? row.matrix : program?.matrix, 8),
      keyboard: isPlus ? [] : compactJsonArray(row.keyboard?.length ? row.keyboard : program?.keyboard, 8),
      cerveau: isPlus ? [] : compactJsonArray(row.cerveau?.length ? row.cerveau : program?.cerveau, 8),
      result
    };
  });
  const matrixCount = new Set(
    summaries.map((row: any) => row.programId || `${row.source}|${row.date}|${row.createdAt}`),
  ).size;

  return {
    available: true,
    method,
    storageReady: true,
    historyCount: summaries.length,
    matrixCount: Math.max(matrixCount, programs.length),
    summaries
  };
}

function timeBucket(value: unknown) {
  const hour = Number(String(value || '').slice(0, 2));
  if (!Number.isFinite(hour)) return 'heure inconnue';
  return hour >= 6 && hour < 18 ? 'journée' : 'nuit';
}

function buildPersonalPeriodStatistics(records: any[], access: any) {
  const startSource = access?.subscription?.startsAt
    || access?.individualUnlocks?.map((item: any) => item.unlockedAt)
      .filter(Boolean)
      .sort()[0]
    || null;
  if (!startSource) {
    return {
      available: false,
      from: null,
      to: null,
      programmes: [],
      note: 'Aucune date de début d’accès individuel n’est disponible.'
    };
  }
  const startDate = new Date(startSource);
  if (Number.isNaN(startDate.getTime())) {
    return {
      available: false,
      from: null,
      to: null,
      programmes: [],
      note: 'La date de début d’accès n’est pas exploitable.'
    };
  }
  const from = startDate.toISOString().slice(0, 10);
  const to = access?.subscription?.expiresAt
    ? (() => {
      const endDate = new Date(access.subscription.expiresAt);
      return Number.isNaN(endDate.getTime()) ? null : endDate.toISOString().slice(0, 10);
    })()
    : null;
  const grouped = new Map<string, any>();
  for (const record of records) {
    const date = String(record.date || '');
    if (!date || date < from || (to && date > to)) continue;
    const key = recommendationFeatureKey(record.programKey);
    const row = grouped.get(key) || {
      programKey: key,
      programName: String(record.programName || recommendationProgramName(key)),
      observations: 0,
      hits: 0,
      draws: new Set<string>()
    };
    row.observations += 1;
    if (record.hit) row.hits += 1;
    row.draws.add(`${record.countryCode}|${date}`);
    grouped.set(key, row);
  }
  return {
    available: true,
    from,
    to,
    programmes: [...grouped.values()].map((row) => ({
      ...row,
      drawsEvaluated: row.draws.size,
      draws: undefined,
      percentage: row.observations
        ? Math.round((row.hits / row.observations) * 1000) / 10
        : 0
    })).sort((left, right) => right.percentage - left.percentage),
    note: 'Période calculée uniquement sur les observations publiées et les programmes auxquels cet utilisateur a accès.'
  };
}

async function readAssistantExperience(client: any, access: any) {
  const currentDate = new Date().toISOString().slice(0, 10);
  const currentPrograms = await readCurrentProgramExperience(client, access);
  const publishedIdsResult = await client.from('resultat_aide_draws')
    .select('id')
    .eq('status', 'published')
    .limit(10000);
  const publishedIds = publishedIdsResult.error
    && /resultat_aide_draws|relation .* does not exist/i.test(
      String(publishedIdsResult.error.message || '')
    )
    ? null
    : new Set((publishedIdsResult.data || []).map((row: any) => row.id));
  if (publishedIdsResult.error && publishedIds === null) {
    // The rest of the context will gracefully expose an empty result memory.
  } else if (publishedIdsResult.error) {
    throw publishedIdsResult.error;
  }
  const result = await client.from('resultat_aide_matches')
    .select('draw_id,country_code,programme_date,draw_date,day_offset,prediction_day,draw_day,draw_time,program_key,program_name,prediction_kind,prediction_label,satellite_value,combination_index,permutation_label,permutation_numbers,permutation_combination_indexes,predicted_numbers,matched_numbers,matched_groups,match_level,hit')
    .order('programme_date', { ascending: false })
    .limit(2500);
  if (result.error) {
    if (/resultat_aide_matches|relation .* does not exist/i.test(String(result.error.message || ''))) {
      const recommendationProjection = await readRecommendationProjection(client);
      return {
        generatedAt: new Date().toISOString(),
        currentDate,
        currentWeek: isoWeek(currentDate),
        currentPrograms,
        records: [],
        dayPatterns: [],
        delayPatterns: [],
        permutationObservations: [],
        crossProgramPatterns: [],
        dechiffrementPlus: await readDechiffrementExperience(client, access),
        recommendationProjection,
        drawNumberMemory: await readDrawNumberMemory(client),
        personalPeriodStatistics: buildPersonalPeriodStatistics([], access)
      };
    }
    throw result.error;
  }
  const allRecords = (result.data || [])
    .filter((row: any) => publishedIds === null || publishedIds.has(row.draw_id))
    .filter((row: any) => canReadProgram(access, row.program_key))
    .map((row: any) => ({
    countryCode: row.country_code,
    predictionDate: row.programme_date,
    drawDate: row.draw_date || row.programme_date,
    predictionDay: row.prediction_day || dayName(row.programme_date),
    drawDay: row.draw_day || dayName(row.draw_date || row.programme_date),
    dayOffset: Number(row.day_offset || 0),
    date: row.draw_date || row.programme_date,
    dayName: row.draw_day || dayName(row.draw_date || row.programme_date),
    weekKey: isoWeek(row.draw_date || row.programme_date),
      drawTime: row.draw_time,
      programKey: row.program_key,
      programName: row.program_name,
    kind: row.prediction_kind,
    predictionLabel: row.prediction_label || null,
    satelliteValue: row.satellite_value ?? null,
    combinationIndex: row.combination_index ?? null,
    permutationLabel: row.permutation_label || null,
    permutationNumbers: Array.isArray(row.permutation_numbers)
      ? row.permutation_numbers
      : [],
      predictedCount: (row.predicted_numbers || []).length,
      matchedCount: (row.matched_numbers || []).length,
      level: row.match_level,
      hit: Boolean(row.hit)
    }));
  // Keep the detailed context compact, but calculate the subscriber-period
  // view from the complete server-side result set rather than from the
  // truncated prompt payload.
  const records = allRecords.slice(0, 300);

  const patternMap = new Map<string, any>();
  records.forEach((record: any) => {
    const key = `${record.countryCode}|${record.dayName}|${record.programKey}|${record.kind}`;
    const row = patternMap.get(key) || {
      countryCode: record.countryCode,
      dayName: record.dayName,
      programKey: record.programKey,
      programName: record.programName,
      kind: record.kind,
      attempts: 0,
      hits: 0,
      examples: []
    };
    row.attempts += 1;
    if (record.hit) row.hits += 1;
    if (row.examples.length < 5 && record.matchedCount) {
      row.examples.push({
        date: record.date,
        matchedCount: record.matchedCount,
        level: record.level
      });
    }
    patternMap.set(key, row);
  });
  const dayPatterns = [...patternMap.values()].map((row) => ({
    ...row,
    percentage: row.attempts
      ? Math.round((row.hits / row.attempts) * 1000) / 10
      : 0
  })).sort((left, right) => right.percentage - left.percentage).slice(0, 150);

  const timeMap = new Map<string, any>();
  records.forEach((record: any) => {
    const bucket = timeBucket(record.drawTime);
    const key = `${record.countryCode}|${record.programKey}|${bucket}`;
    const row = timeMap.get(key) || {
      countryCode: record.countryCode,
      programKey: record.programKey,
      programName: record.programName,
      timeBucket: bucket,
      attempts: 0,
      hits: 0
    };
    row.attempts += 1;
    if (record.hit) row.hits += 1;
    timeMap.set(key, row);
  });
  const timePatterns = [...timeMap.values()].map((row) => ({
    ...row,
    percentage: row.attempts
      ? Math.round((row.hits / row.attempts) * 1000) / 10
      : 0
  })).sort((left, right) => right.percentage - left.percentage).slice(0, 100);

  const delayMap = new Map<string, any>();
  records.forEach((record: any) => {
    const key = [
      record.countryCode, record.programKey, record.kind,
      record.dayOffset, record.predictionDay, record.drawDay
    ].join('|');
    const row = delayMap.get(key) || {
      countryCode: record.countryCode,
      programKey: record.programKey,
      programName: record.programName,
      kind: record.kind,
      dayOffset: record.dayOffset,
      predictionDay: record.predictionDay,
      drawDay: record.drawDay,
      attempts: 0,
      hits: 0,
      examples: []
    };
    row.attempts += 1;
    if (record.hit) row.hits += 1;
    if (record.hit && row.examples.length < 5) {
      row.examples.push({
        predictionDate: record.predictionDate,
        drawDate: record.drawDate,
        matchedCount: record.matchedCount,
        level: record.level,
        predictionLabel: record.predictionLabel
      });
    }
    delayMap.set(key, row);
  });
  const delayPatterns = [...delayMap.values()]
    .map((row) => ({
      ...row,
      percentage: row.attempts
        ? Math.round((row.hits / row.attempts) * 1000) / 10
        : 0,
      observationLabel: `Observation historique sur ${row.attempts} tirage(s).`
    }))
    .filter((row) => row.attempts >= 3)
    .sort((left, right) => (
      right.percentage - left.percentage
      || right.attempts - left.attempts
    ))
    .slice(0, 250);

  const permutationMap = new Map<string, any>();
  records.filter((record: any) => record.kind === 'permutation').forEach((record: any) => {
    const key = `${record.countryCode}|${record.programKey}|${record.dayOffset}`;
    const row = permutationMap.get(key) || {
      countryCode: record.countryCode,
      programKey: record.programKey,
      programName: record.programName,
      dayOffset: record.dayOffset,
      attempts: 0,
      hits: 0,
      examples: []
    };
    row.attempts += 1;
    if (record.hit) row.hits += 1;
    if (record.hit && row.examples.length < 5) {
      row.examples.push({
        predictionDate: record.predictionDate,
        drawDate: record.drawDate,
        satelliteValue: record.satelliteValue,
        permutationNumbers: record.permutationNumbers,
        matchedCount: record.matchedCount
      });
    }
    permutationMap.set(key, row);
  });
  const permutationObservations = [...permutationMap.values()]
    .map((row) => ({
      ...row,
      percentage: row.attempts
        ? Math.round((row.hits / row.attempts) * 1000) / 10
        : 0,
      canSuggest: row.attempts >= 3 && row.hits >= 2,
      caution: 'Tendance historique, jamais une garantie.'
    }))
    .filter((row) => row.attempts >= 3)
    .sort((left, right) => right.hits - left.hits || right.attempts - left.attempts)
    .slice(0, 100);

  const weeklyMap = new Map<string, any>();
  records.forEach((record: any) => {
    const key = `${record.countryCode}|${record.programKey}|${record.weekKey}`;
    const row = weeklyMap.get(key) || {
      countryCode: record.countryCode,
      programKey: record.programKey,
      programName: record.programName,
      weekKey: record.weekKey,
      attempts: 0,
      hits: 0,
      kinds: []
    };
    row.attempts += 1;
    if (record.hit) row.hits += 1;
    if (!row.kinds.includes(record.kind)) row.kinds.push(record.kind);
    weeklyMap.set(key, row);
  });
  const currentWeek = isoWeek(new Date().toISOString().slice(0, 10));
  const weeklyActivity = [...weeklyMap.values()]
    .map((row) => ({
      ...row,
      current: row.weekKey === currentWeek,
      percentage: row.attempts
        ? Math.round((row.hits / row.attempts) * 1000) / 10
        : 0
    }))
    .sort((left, right) => (
      Number(right.current) - Number(left.current)
      || right.percentage - left.percentage
    ))
    .slice(0, 180);

  const crossMap = new Map<string, any>();
  records.filter((record: any) => record.hit).forEach((record: any) => {
    const key = `${record.countryCode}|${record.date}`;
    const row = crossMap.get(key) || {
      countryCode: record.countryCode,
      date: record.date,
      dayName: record.dayName,
      programs: [],
      matchedCount: 0
    };
    if (!row.programs.some((program: string) => program === record.programKey)) {
      row.programs.push(record.programKey);
    }
    row.matchedCount += Number(record.matchedCount || 0);
    crossMap.set(key, row);
  });
  const crossProgramPatterns = [...crossMap.values()]
    .filter((row) => row.programs.length > 1)
    .sort((left, right) => right.programs.length - left.programs.length)
    .slice(0, 100);
  const userCountry = normalizeCountry(access.user.country);
  const published = await client.from('resultat_aide_draws')
    .select('country_code,draw_date,draw_time,draw_number,first_numbers,machine_numbers,bonus_numbers,input_schema')
    .eq('status', 'published')
    .order('draw_date', { ascending: false })
    .limit(500);
  if (published.error && !/resultat_aide_draws|relation .* does not exist/i.test(String(published.error.message || ''))) {
    throw published.error;
  }
  const publishedForCountry = (published.data || [])
    .filter((draw: any) => !userCountry || draw.country_code === userCountry)
    .slice(0, 30)
    .map((draw: any) => ({
      countryCode: draw.country_code,
      date: draw.draw_date,
      drawTime: draw.draw_time,
      drawNumber: Number.isInteger(Number(draw.draw_number)) ? Number(draw.draw_number) : null,
      firstCount: (draw.first_numbers || []).length,
      machineCount: (draw.machine_numbers || []).length,
      bonusCount: (draw.bonus_numbers || []).length
    }));
  const publishedResults = (published.data || [])
    .slice(0, 120)
    .map((draw: any) => ({
      countryCode: draw.country_code,
      date: draw.draw_date,
      drawTime: draw.draw_time,
      drawNumber: Number.isInteger(Number(draw.draw_number)) ? Number(draw.draw_number) : null,
      firstNumbers: Array.isArray(draw.first_numbers) ? draw.first_numbers.slice(0, 90) : [],
      machineNumbers: Array.isArray(draw.machine_numbers) ? draw.machine_numbers.slice(0, 90) : [],
      bonusNumbers: Array.isArray(draw.bonus_numbers) ? draw.bonus_numbers.slice(0, 90) : [],
      inputSchema: draw.input_schema || null
    }));
  const [weekly, daily, delayStats] = await Promise.all([
    client.from('resultat_aide_weekly_stats')
      .select('country_code,week_key,program_key,program_name,draws_evaluated,key_metric,order_metric,nap1_metric,nap2_metric,combination_metric,satellite_metric,permutation_metric,overall_metric')
      .order('week_key', { ascending: false }).limit(1000),
    client.from('resultat_aide_day_stats')
      .select('country_code,day_of_week,day_name,program_key,program_name,draws_evaluated,key_metric,order_metric,nap1_metric,nap2_metric,combination_metric,satellite_metric,permutation_metric,overall_metric')
      .order('country_code', { ascending: true }).limit(1000),
    client.from('resultat_aide_delay_stats')
      .select('country_code,day_offset,prediction_day_of_week,prediction_day_name,draw_day_of_week,draw_day_name,program_key,program_name,draws_evaluated,key_metric,order_metric,nap1_metric,nap2_metric,combination_metric,satellite_metric,permutation_metric,overall_metric')
      .order('country_code', { ascending: true }).order('day_offset', { ascending: true }).limit(2000)
  ]);
  const aggregateError = [weekly.error, daily.error, delayStats.error].find((error) => (
    error && !/resultat_aide_(weekly_stats|day_stats|delay_stats)|relation .* does not exist|column .* does not exist|schema cache/i
      .test(String(error.message || ''))
  ));
  if (aggregateError) throw aggregateError;
  const [dechiffrementPlus, recommendationProjection, drawNumberMemory] = await Promise.all([
    readDechiffrementExperience(client, access),
    readRecommendationProjection(client),
    readDrawNumberMemory(client)
  ]);
  const metricSummary = (row: any) => ({
    key: Number(row.key_metric?.percentage || 0),
    order: Number(row.order_metric?.percentage || 0),
    nap1: Number(row.nap1_metric?.percentage || 0),
    nap2: Number(row.nap2_metric?.percentage || 0),
    combination: Number(row.combination_metric?.percentage || 0),
    satellite: Number(row.satellite_metric?.percentage || 0),
    permutation: Number(row.permutation_metric?.percentage || 0),
    overall: Number(row.overall_metric?.percentage || 0)
  });
  const authorizedWeekly = (weekly.data || [])
    .filter((row: any) => canReadProgram(access, row.program_key));
  const authorizedDaily = (daily.data || [])
    .filter((row: any) => canReadProgram(access, row.program_key));
  const authorizedDelay = (delayStats.data || [])
    .filter((row: any) => canReadProgram(access, row.program_key));
  return {
    generatedAt: new Date().toISOString(),
    currentDate,
    currentPrograms,
    userCountry,
    publishedForCountry,
    publishedCountForCountry: publishedForCountry.length,
    publishedResults,
    allProgramStatistics: authorizedWeekly.map((row: any) => ({
      countryCode: row.country_code,
      weekKey: row.week_key,
      programKey: row.program_key,
      programName: row.program_name,
      drawsEvaluated: row.draws_evaluated,
      percentages: metricSummary(row)
    })),
    dayProgramStatistics: authorizedDaily.map((row: any) => ({
      countryCode: row.country_code,
      dayName: row.day_name,
      programKey: row.program_key,
      programName: row.program_name,
      drawsEvaluated: row.draws_evaluated,
      percentages: metricSummary(row)
    })),
    delayProgramStatistics: authorizedDelay.map((row: any) => ({
      countryCode: row.country_code,
      dayOffset: Number(row.day_offset || 0),
      predictionDayOfWeek: row.prediction_day_of_week,
      predictionDayName: row.prediction_day_name,
      drawDayOfWeek: row.draw_day_of_week,
      drawDayName: row.draw_day_name,
      programKey: row.program_key,
      programName: row.program_name,
      drawsEvaluated: row.draws_evaluated,
      percentages: metricSummary(row)
    })),
    records,
    dayPatterns,
    delayPatterns,
    permutationObservations,
    timePatterns,
    currentWeek,
    weeklyActivity,
    crossProgramPatterns,
    dechiffrementPlus,
    recommendationProjection,
    drawNumberMemory,
    personalPeriodStatistics: buildPersonalPeriodStatistics(allRecords, access),
    authorizedPrograms: access.scope.authorizedPrograms,
    accessScope: access.scope.source
  };
}

async function readPublicAssistantExperience(client: any) {
  const currentDate = new Date().toISOString().slice(0, 10);
  const [weekly, daily, published, recommendationProjection, drawNumberMemory] = await Promise.all([
    client.from('resultat_aide_weekly_stats')
      .select('country_code,week_key,program_key,program_name,draws_evaluated,key_metric,order_metric,nap1_metric,nap2_metric,combination_metric,satellite_metric,permutation_metric,overall_metric')
      .order('week_key', { ascending: false })
      .limit(1000),
    client.from('resultat_aide_day_stats')
      .select('country_code,day_name,program_key,program_name,draws_evaluated,overall_metric,satellite_metric,permutation_metric')
      .order('country_code', { ascending: true })
      .limit(1000),
    client.from('resultat_aide_draws')
      .select('country_code,draw_date,draw_time,draw_number,first_numbers,machine_numbers,bonus_numbers,input_schema')
      .eq('status', 'published')
      .order('draw_date', { ascending: false })
      .limit(120),
    readRecommendationProjection(client),
    readDrawNumberMemory(client)
  ]);
  const missing = (error: any) => error
    && /resultat_aide_(weekly_stats|day_stats)|relation .* does not exist|column .* does not exist|schema cache/i
      .test(String(error.message || ''));
  if ((weekly.error && !missing(weekly.error))
    || (daily.error && !missing(daily.error))
    || (published.error && !/resultat_aide_draws|relation .* does not exist/i.test(String(published.error.message || '')))) {
    throw weekly.error || daily.error || published.error;
  }
  const metricSummary = (row: any) => ({
    key: Number(row.key_metric?.percentage || 0),
    order: Number(row.order_metric?.percentage || 0),
    nap1: Number(row.nap1_metric?.percentage || 0),
    nap2: Number(row.nap2_metric?.percentage || 0),
    combination: Number(row.combination_metric?.percentage || 0),
    satellite: Number(row.satellite_metric?.percentage || 0),
    permutation: Number(row.permutation_metric?.percentage || 0),
    overall: Number(row.overall_metric?.percentage || 0)
  });
  return {
    publicOnly: true,
    generatedAt: new Date().toISOString(),
    currentDate,
    currentWeek: isoWeek(currentDate),
    currentPrograms: [],
    accessScope: 'public',
    authorizedPrograms: [],
    publishedResults: (published.data || []).map((draw: any) => ({
      countryCode: draw.country_code,
      date: draw.draw_date,
      drawTime: draw.draw_time,
      drawNumber: Number.isInteger(Number(draw.draw_number)) ? Number(draw.draw_number) : null,
      firstNumbers: Array.isArray(draw.first_numbers) ? draw.first_numbers.slice(0, 90) : [],
      machineNumbers: Array.isArray(draw.machine_numbers) ? draw.machine_numbers.slice(0, 90) : [],
      bonusNumbers: Array.isArray(draw.bonus_numbers) ? draw.bonus_numbers.slice(0, 90) : [],
      inputSchema: draw.input_schema || null
    })),
    allProgramStatistics: (weekly.data || []).map((row: any) => ({
      countryCode: row.country_code,
      weekKey: row.week_key,
      programKey: row.program_key,
      programName: row.program_name,
      drawsEvaluated: row.draws_evaluated,
      percentages: metricSummary(row)
    })),
    dayProgramStatistics: (daily.data || []).map((row: any) => ({
      countryCode: row.country_code,
      dayName: row.day_name,
      programKey: row.program_key,
      programName: row.program_name,
      drawsEvaluated: row.draws_evaluated,
      percentages: {
        overall: Number(row.overall_metric?.percentage || 0)
      }
    })),
    recommendationProjection,
    drawNumberMemory,
    note: 'Tendances publiques agrégées uniquement. Aucune clé, aucun numéro, aucune combinaison ni archive privée.'
  };
}

async function getConversation(client: any, userId: string, create = false) {
  const existing = await client.from('conversations')
    .select('id,unread_count_user,unread_count_admin,updated_at')
    .eq('user_id', userId).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data || !create) return existing.data;
  const created = await client.from('conversations')
    .insert({ user_id: userId, unread_count_user: 0, unread_count_admin: 0 })
    .select('id,unread_count_user,unread_count_admin,updated_at').single();
  if (created.error) throw created.error;
  return created.data;
}

async function userState(client: any, access: any) {
  const conversation = await getConversation(client, access.user.id);
  const assistantContext = await readAssistantExperience(client, access);
  if (!conversation) return json({
    ok: true, access, assistantContext, conversation: null, messages: []
  });
  const messages = await client.from('messages')
    .select('id,conversation_id,sender_type,content,status,is_read,created_at')
    .eq('conversation_id', conversation.id).order('created_at', { ascending: true });
  if (messages.error) throw messages.error;
  return json({ ok: true, access, assistantContext, conversation, messages: messages.data || [] });
}

async function publicUserState(client: any, access: any) {
  const assistantContext = await readPublicAssistantExperience(client);
  return json({
    ok: true,
    publicOnly: true,
    access,
    assistantContext,
    conversation: null,
    messages: []
  });
}

async function handle(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);
  let body: any = {};
  try { body = await request.json(); } catch (_) {}
  const client = serviceClient();
  const user = await auth(client, request);
  if (!user) return json({ error: 'Connexion requise pour accéder à l’aide.' }, 401);
  const action = String(body.action || 'state').trim().toLowerCase();
  try {
    const access = await readAccess(client, user);
    if (action === 'state') {
      return access.canHelp
        ? userState(client, access)
        : publicUserState(client, access);
    }
    if (!access.canHelp) {
      return json({
        error: 'L’aide est réservée aux utilisateurs ayant un forfait ou un Tableau individuel encore actif.',
        access
      }, 403);
    }
    if (action === 'send') {
      const content = String(body.content || '').trim().slice(0, 4000);
      if (!content) return json({ error: 'Écrivez votre message avant de l’envoyer.' }, 400);
      const conversation = await getConversation(client, user.id, true);
      const message = await client.from('messages').insert({
        conversation_id: conversation.id, sender_type: 'USER',
        content, status: 'SENT', is_read: true
      }).select('*').single();
      if (message.error) throw message.error;
      return json({ ok: true, access, message: message.data });
    }
    return json({ error: 'Action d’aide inconnue.' }, 400);
  } catch (error) {
    console.error('support-chat failed', error);
    return json({ error: error instanceof Error ? error.message : 'Aide indisponible.' }, 500);
  }
}

Deno.serve(handle);
