/*
 * Supabase Edge Function: rejected-balls
 *
 * Le calcul est exécuté côté serveur uniquement.
 * Une date absente est calculée puis archivée dans
 * public.daily_rejected_balls. Une date déjà archivée est renvoyée sans
 * recalcul ni écrasement.
 *
 * Deploy with:
 *   supabase functions deploy rejected-balls
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  enforceFeatureAccess,
  hasActiveLegacyEarlyAccess,
  hasEarlyAccessGrant,
  readEarlyAccessRule
} from '../_shared.ts';

type RejectedGroups = {
  ghana: string[];
  coteDIvoire: string[];
  benin: string[];
  niger: string[];
  senegal: string[];
  togo: string[];
};

type RejectedFinishes = {
  ghFirst: number;
  ghSecond: number;
  coteDIvoire: number;
  benin: number;
  niger: number;
  senegal: number;
  togo: number;
};

type RejectedArchiveRow = {
  programme_date: string;
  first_finish: number;
  second_finish: number;
  difference: number;
  finishes: RejectedFinishes;
  groups: RejectedGroups;
  formatted_text: string;
  created_at: string;
  updated_at: string;
};

type RejectedProgramme = {
  country: string;
  countryCode: string;
  name: string;
  hour?: number;
  date: string;
  groups: string[];
};

type RejectedSource = {
  country_code: string;
  country_name: string;
  draw_name: string;
  draw_time: string;
  settings?: Record<string, unknown>;
  enabled: boolean;
};

type RequestBody = {
  programmeDate?: unknown;
  localeCode?: unknown;
};

const TIME_ZONE = 'Africa/Abidjan';
const PROGRAM_RELEASE_HOUR = 16;
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

function missingAccessTables(error: any): boolean {
  return String(error?.code || '') === '42P01'
    || /subscription_plans|feature_access_rules|user_subscriptions|user_feature_early_access_grants|relation .* does not exist|column .* does not exist|schema cache/i
      .test(String(error?.message || ''));
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function parseDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour')
  };
}

function getProgrammeDate(now = new Date()): string {
  const parts = parseDateParts(now);
  const date = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day + (
      parts.hour >= PROGRAM_RELEASE_HOUR ? 1 : 0
    )
  ));

  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function dateIso(date: Date): string {
  return Number.isNaN(date.getTime())
    ? ''
    : date.toISOString().slice(0, 10);
}

function programmeDateFromClock(now = new Date()): Date {
  const parts = parseDateParts(now);

  return new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day + (
      parts.hour >= PROGRAM_RELEASE_HOUR ? 1 : 0
    ),
    12
  ));
}

/*
 * Verrouillage de l'anticipation :
 *
 * - le programme normal reste gratuit avant et après 16h ;
 * - l'anticipation respecte la fenêtre de dates futures configurée ;
 * - l'accès anticipé nécessite un déblocage utilisateur valide ;
 * - les anciennes dates restent accessibles.
 */
async function enforceEarlyAccess(
  request: Request,
  featureKey: string,
  requestedProgrammeDate: string
): Promise<Response | null> {
  const wanted = String(featureKey || '')
    .trim()
    .toLowerCase();

  if (wanted !== 'boules-rejetees') {
    return null;
  }

  const client = getAdminClient();

  const ruleResult = await readEarlyAccessRule(client, wanted);

  const now = new Date();
  const parts = parseDateParts(now);
  const normalDate = dateIso(
    programmeDateFromClock(now)
  );
  const currentHour = parts.hour;

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

  /*
   * Si la table d'anticipation n'existe pas :
   * - la publication normale reste accessible ;
   * - l'anticipation reste indisponible.
   */
  if (ruleResult.error) {
    if (
      missingAccessTables(ruleResult.error)
      || /feature_early_access_rules/i.test(
        String(ruleResult.error.message || '')
      )
    ) {
      return isFutureDate
        ? currentHour < PROGRAM_RELEASE_HOUR
          ? json({
              error:
                `Cette publication sera disponible à `
                + `${PROGRAM_RELEASE_HOUR}h.`,
              code: 'PUBLIC_RELEASE_NOT_AVAILABLE',
              featureKey: wanted,
              programmeDate: requestedProgrammeDate,
              releaseHour: PROGRAM_RELEASE_HOUR
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

  /*
   * Les anciennes publications restent disponibles.
   */
  if (!isNormalDate && !isFutureDate) {
    return null;
  }

  /*
   * La publication normale reste toujours gratuite et visible.
   */
  if (isNormalDate) {
    return null;
  }

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
      releaseHour: PROGRAM_RELEASE_HOUR,
      requiredTokens: Math.max(
        0,
        Number(rule.required_tokens) || 0
      ),
      durationDays: Math.max(
        1,
        Number(rule.duration_days) || 30
      )
    }, 403);
  }

  const session = await client.auth.getUser(token);

  if (session.error || !session.data?.user?.id) {
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

  if (!adminRole.error && adminRole.data?.role === 'admin') {
    return null;
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
    .select('id,expires_at')
    .eq('user_id', userId)
    .eq('feature_key', wanted)
    .eq('programme_date', requestedProgrammeDate)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle();

  if (unlock.error) {
    if (
      missingAccessTables(unlock.error)
      || /user_feature_early_access/i.test(
        String(unlock.error.message || '')
      )
    ) {
      return json({
        error: 'L’accès anticipé n’est pas encore configuré.',
        code: 'EARLY_ACCESS_NOT_CONFIGURED',
        featureKey: wanted,
        programmeDate: requestedProgrammeDate
      }, 403);
    }

    throw unlock.error;
  }

  if (currentHour < PROGRAM_RELEASE_HOUR && !unlock.data) {
    return json({
      error:
        `Cette publication sera disponible à ${PROGRAM_RELEASE_HOUR}h, `
        + 'sauf pour un accès anticipé déjà activé.',
      code: 'PUBLIC_RELEASE_NOT_AVAILABLE',
      featureKey: wanted,
      programmeDate: requestedProgrammeDate,
      releaseHour: PROGRAM_RELEASE_HOUR
    }, 425);
  }

  return unlock.data
    ? null
    : json({
        error: 'Débloquez cette publication pour la recevoir dès maintenant.',
        code: 'EARLY_ACCESS_REQUIRED',
        featureKey: wanted,
        programmeDate: requestedProgrammeDate,
        releaseHour: PROGRAM_RELEASE_HOUR,
        requiredTokens: Math.max(
          0,
          Number(rule.required_tokens) || 0
        ),
        durationDays: Math.max(
          1,
          Number(rule.duration_days) || 30
        )
      }, 403);
}

function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function reduceToSingle(value: number): number {
  let result = Math.abs(Number(value) || 0);
  while (result >= 10) {
    result = String(result)
      .split('')
      .reduce((sum, digit) => sum + Number(digit), 0);
  }
  return result;
}

function tenForFinition(finition: number): string[] {
  const result: string[] = [];
  let start = Number(finition);
  if (start === 0) start = 90;

  for (let index = 0; index < 10; index += 1) {
    const candidate = ((start + index * 9) - 1) % 90 + 1;
    result.push(pad(candidate));
  }
  return result;
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

const rejectedCountryKeys: Record<string, keyof RejectedGroups> = {
  GH: 'ghana',
  GHANA: 'ghana',
  CI: 'coteDIvoire',
  "COTE D'IVOIRE": 'coteDIvoire',
  BJ: 'benin',
  BENIN: 'benin',
  NE: 'niger',
  NIGER: 'niger',
  SN: 'senegal',
  SENEGAL: 'senegal',
  TG: 'togo',
  TOGO: 'togo'
};

function rejectedCountryKey(source: RejectedSource): keyof RejectedGroups | null {
  const code = String(source.country_code || '').trim().toUpperCase();
  const name = String(source.country_name || '').trim().toUpperCase();
  return rejectedCountryKeys[code] || rejectedCountryKeys[name] || null;
}

function rejectedProgrammeFromSource(
  source: RejectedSource,
  programmeDate: string,
  base: ReturnType<typeof calculateRejectedBalls>
): RejectedProgramme {
  const hour = Number(String(source.draw_time || '').slice(0, 2));
  const countryKey = rejectedCountryKey(source);
  const baseFinish = countryKey ? base.finishes[countryKey] : 0;
  const seed = createSeededGenerator(
    `${source.country_code}|${source.country_name}|${source.draw_name}|${source.draw_time}|${programmeDate}`
  );
  const variation = Math.floor(seed() * 9) + 1;
  const finish = reduceToSingle(
    (baseFinish || base.firstFinish || 1) + (hour || 0) + variation
  );
  return {
    country: source.country_name,
    countryCode: source.country_code,
    name: source.draw_name,
    hour: Number.isFinite(hour) ? hour : undefined,
    date: programmeDate,
    groups: tenForFinition(finish)
  };
}

async function readConfiguredRejectedSources(): Promise<RejectedSource[]> {
  const admin = getAdminClient();
  const result = await admin
    .from('admin_draw_sources')
    .select('country_code,country_name,draw_name,draw_time,settings,enabled')
    .eq('module_key', 'boules-rejetees')
    .eq('enabled', true)
    .order('country_name')
    .order('draw_time');
  if (result.error) {
    if (/admin_draw_sources|relation .* does not exist/i.test(
      String(result.error.message || '')
    )) return [];
    throw result.error;
  }
  return (result.data || []) as RejectedSource[];
}

function formatRejectedText(
  programmeDate: string,
  groups: RejectedGroups,
  localeCode = 'fr'
): string {
  const locale = /^(?:fr|en|es|pt|ar)(?:-[A-Z]{2})?$/i.test(String(localeCode || ''))
    ? String(localeCode)
    : 'fr';
  const copy = {
    fr: {
      forFun: 'pour le #divertissement 💯 de ce',
      ghana: 'Ghana bonanza',
      ivory: "Côte d'Ivoire solution",
      benin: 'Bénin',
      niger: 'niger',
      senegal: 'Sénégal',
      togo: 'Togo',
      chance: 'Pourcentage de chance à sortir est à 25%'
    },
    en: {
      forFun: 'for #entertainment 💯 on',
      ghana: 'Ghana bonanza',
      ivory: "Côte d'Ivoire solution",
      benin: 'Benin',
      niger: 'Niger',
      senegal: 'Senegal',
      togo: 'Togo',
      chance: 'Estimated chance of appearing is 25%'
    },
    es: {
      forFun: 'para el #entretenimiento 💯 del',
      ghana: 'Bonanza de Ghana',
      ivory: 'Solución de Costa de Marfil',
      benin: 'Benín',
      niger: 'Níger',
      senegal: 'Senegal',
      togo: 'Togo',
      chance: 'El porcentaje estimado de salida es del 25%'
    },
    pt: {
      forFun: 'para o #entretenimento 💯 de',
      ghana: 'Bonanza do Gana',
      ivory: 'Solução da Costa do Marfim',
      benin: 'Benim',
      niger: 'Níger',
      senegal: 'Senegal',
      togo: 'Togo',
      chance: 'A percentagem estimada de saída é de 25%'
    },
    ar: {
      forFun: 'للترفيه #divertissement 💯 بتاريخ',
      ghana: 'غانا بونانزا',
      ivory: 'حل ساحل العاج',
      benin: 'بنين',
      niger: 'النيجر',
      senegal: 'السنغال',
      togo: 'توغو',
      chance: 'النسبة التقديرية للظهور هي 25%'
    }
  }[String(locale).split('-')[0] as 'fr' | 'en' | 'es' | 'pt' | 'ar'] || undefined;
  const labels = copy || {
    forFun: 'pour le #divertissement 💯 de ce',
    ghana: 'Ghana bonanza',
    ivory: "Côte d'Ivoire solution",
    benin: 'Bénin',
    niger: 'niger',
    senegal: 'Sénégal',
    togo: 'Togo',
    chance: 'Pourcentage de chance à sortir est à 25%'
  };
  const date = new Date(`${programmeDate}T12:00:00.000Z`).toLocaleDateString(
    locale,
    {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: TIME_ZONE
    }
  );

  return [
    `#Boules #rejetées ${labels.forFun} ${date}`,
    '',
    labels.ghana,
    groups.ghana.slice(0, 10).join('-'),
    groups.ghana.slice(10).join('-'),
    '',
    labels.ivory,
    groups.coteDIvoire.join('-'),
    '',
    labels.benin,
    groups.benin.join('-'),
    '',
    labels.niger,
    groups.niger.join('-'),
    '',
    labels.senegal,
    groups.senegal.join('-'),
    '',
    labels.togo,
    groups.togo.join('-'),
    '',
    labels.chance,
    '',
    '#divertissement 💯'
  ].join('\n');
}

function calculateRejectedBalls(programmeDate: string, localeCode = 'fr') {
  const [year, month, day] = programmeDate.split('-').map(Number);
  const firstFinish = reduceToSingle(
    String(day).split('').reduce((sum, digit) => sum + Number(digit), 0)
  );
  const secondFinish = reduceToSingle(day + month + year);
  const small = Math.min(firstFinish, secondFinish);
  const large = Math.max(firstFinish, secondFinish);
  const difference = Math.abs(large - small);
  const nextFinish = (previous: number) =>
    reduceToSingle(previous + difference);

  const finishes: RejectedFinishes = {
    ghFirst: firstFinish,
    ghSecond: secondFinish,
    coteDIvoire: reduceToSingle(large + difference),
    benin: 0,
    niger: 0,
    senegal: 0,
    togo: 0
  };

  finishes.benin = nextFinish(finishes.coteDIvoire);
  finishes.niger = nextFinish(finishes.benin);
  finishes.senegal = nextFinish(finishes.niger);
  finishes.togo = nextFinish(finishes.senegal);

  const groups: RejectedGroups = {
    ghana: tenForFinition(firstFinish).concat(tenForFinition(secondFinish)),
    coteDIvoire: tenForFinition(finishes.coteDIvoire),
    benin: tenForFinition(finishes.benin),
    niger: tenForFinition(finishes.niger),
    senegal: tenForFinition(finishes.senegal),
    togo: tenForFinition(finishes.togo)
  };

  return {
    firstFinish,
    secondFinish,
    difference,
    finishes,
    groups,
    formattedText: formatRejectedText(programmeDate, groups, localeCode)
  };
}

async function readArchive(
  programmeDate: string
): Promise<RejectedArchiveRow | null> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('daily_rejected_balls')
    .select(`
      programme_date,
      first_finish,
      second_finish,
      difference,
      finishes,
      groups,
      formatted_text,
      created_at,
      updated_at
    `)
    .eq('programme_date', programmeDate)
    .maybeSingle();

  if (error) throw error;
  return data as RejectedArchiveRow | null;
}

async function archiveResult(
  programmeDate: string,
  result: ReturnType<typeof calculateRejectedBalls> & {
    programmes?: RejectedProgramme[];
  }
): Promise<{ archive: RejectedArchiveRow; created: boolean }> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('daily_rejected_balls')
    .insert({
      programme_date: programmeDate,
      first_finish: result.firstFinish,
      second_finish: result.secondFinish,
      difference: result.difference,
      finishes: result.finishes,
      groups: {
        ...result.groups,
        _programmes: Array.isArray(result.programmes) ? result.programmes : []
      },
      formatted_text: result.formattedText
    })
    .select(`
      programme_date,
      first_finish,
      second_finish,
      difference,
      finishes,
      groups,
      formatted_text,
      created_at,
      updated_at
    `)
    .single();

  if (error?.code === '23505') {
    const existing = await readArchive(programmeDate);
    if (existing) return { archive: existing, created: false };
  }
  if (error) throw error;
  return { archive: data as RejectedArchiveRow, created: true };
}

function responseFromArchive(
  archive: RejectedArchiveRow,
  source: 'database' | 'new-calculation',
  configuredSources: RejectedSource[] = [],
  localeCode = 'fr'
) {
  const storedProgrammes = (archive.groups as any)?._programmes;
  const programmes = configuredSources.length
    ? configuredSources.map((item) => rejectedProgrammeFromSource(
      item,
      archive.programme_date,
      {
        firstFinish: archive.first_finish,
        secondFinish: archive.second_finish,
        difference: archive.difference,
        finishes: archive.finishes,
        groups: archive.groups
      }
    ))
    : (Array.isArray(storedProgrammes) ? storedProgrammes : []);
  return {
    programmeDate: archive.programme_date,
    firstFinish: archive.first_finish,
    secondFinish: archive.second_finish,
    difference: archive.difference,
    finishes: archive.finishes,
    groups: archive.groups,
    programmes,
    formattedText: formatRejectedText(
      archive.programme_date,
      archive.groups,
      localeCode
    ),
    meta: {
      programmeDate: archive.programme_date,
      timeZone: TIME_ZONE,
      createdAt: archive.created_at,
      updatedAt: archive.updated_at,
      source,
      persisted: true
    }
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Méthode non autorisée.' }, 405);
  }

  try {
    let body: RequestBody = {};
    try {
      body = await request.json() as RequestBody;
    } catch (_) {
      return json({ error: 'Le corps de la requête doit être un JSON valide.' }, 400);
    }

    const requestedDate = body.programmeDate;
    const localeCode = String(body.localeCode || 'fr').trim() || 'fr';
    const programmeDate = requestedDate == null
      ? getProgrammeDate()
      : (isValidIsoDate(requestedDate) ? requestedDate : null);

    if (!programmeDate) {
      return json({
        error: 'programmeDate doit être une date ISO valide (YYYY-MM-DD).'
      }, 400);
    }

    /*
     * Boules rejetées remains public when no active access rule or plan
     * includes it. If administration protects the section, the same
     * individual/collective gate as the other programmes applies here too.
     */
    const accessDenied = await enforceFeatureAccess(
      request,
      'boules-rejetees'
    );
    if (accessDenied) return accessDenied;

    const earlyDenied = await enforceEarlyAccess(
      request,
      'boules-rejetees',
      programmeDate
    );
    if (earlyDenied) return earlyDenied;

    const configuredSources = await readConfiguredRejectedSources();
    const archived = await readArchive(programmeDate);
    if (archived) {
      return json(responseFromArchive(
        archived,
        'database',
        configuredSources,
        localeCode
      ));
    }

    const result = calculateRejectedBalls(programmeDate, localeCode);
    const programmes = configuredSources.map((source) => (
      rejectedProgrammeFromSource(source, programmeDate, result)
    ));
    const { archive, created } = await archiveResult(programmeDate, {
      ...result,
      programmes
    });
    return json(responseFromArchive(
      archive,
      created ? 'new-calculation' : 'database',
      configuredSources,
      localeCode
    ));
  } catch (error) {
    console.error('rejected-balls failed', error);
    return json({
      error: 'Impossible de lire ou d’archiver les Boules rejetées.'
    }, 500);
  }
});
