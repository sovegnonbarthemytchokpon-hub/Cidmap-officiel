/*
 * regen-daily — scheduled server-side regeneration of the daily "Numéros
 * Valides du Jour" archives (`daily_*_programs`), excluding Stand-by.
 *
 * The Croix nationale, Matrices and Boules rejetées already reserve the
 * 16:00 Africa/Abidjan programme boundary themselves, server-side. The
 * daily Tableaux archives are the same kind of server-owned archive, but
 * nothing forced them to materialise the new day's rows automatically. The
 * Stand-by archive has its own seven-day cycle and is deliberately excluded
 * from this function.
 *
 * Schedule it in Supabase Dashboard → Database → Cron (pg_cron) at
 * ``0 16 * * *`` Africa/Abidjan (16:00 local, Côte d'Ivoire) calling this
 * function with ``Authorization: Bearer <secret>`` (see CRON_TOKEN below).
 *
 * It is deliberately idempotent: for each programme it recalculates the pure
 * payload for the target date and upserts it, so running it at 16:00 (or
 * later) after a calculation-version bump reconciles the whole archive for
 * the day the administrator sees.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  corsHeaders,
  dateIso,
  programmeDateFromClock,
  readOptionalNigerResult
} from '../_shared.ts';
import { calculateUniverselle } from '../calcul-universelle.ts';
import { calculateIntuition } from '../calcul-intuition.ts';
import { calculateOracle } from '../calcul-oracle.ts';
import { calculateLnb } from '../calcul-lnb.ts';
import { calculateBalsa } from '../calcul-balsa.ts';
import { calculateRobot } from '../calcul-robot.ts';

const TIME_ZONE = 'Africa/Abidjan';
const PROGRAM_GENERATION_TIME = '16:00';

type MatrixSource = {
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

type Json = Record<string, unknown>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders
  });
}

/**
 * One entry per programme the administrator's "Numéros Valides du Jour"
 * reads. Each avoids the feature-access boundary by writing with the
 * service-role client below.
 */
const PROGRAMMES: ReadonlyArray<{
  table: string;
  id: string;
  calculate: (date: Date) => unknown;
}> = [
  { table: 'daily_universal_programs', id: 'universelle', calculate: (date) => calculateUniverselle(date) },
  { table: 'daily_intuition_programs', id: 'intuition', calculate: (date) => calculateIntuition(date) },
  { table: 'daily_oracle_programs', id: 'oracle', calculate: (date) => calculateOracle(date) },
  { table: 'daily_lnb_programs', id: 'lnb', calculate: (date) => calculateLnb(date) },
  { table: 'daily_balsa_programs', id: 'balsa', calculate: (date) => calculateBalsa(date) },
  { table: 'daily_robot_programs', id: 'robot', calculate: (date) => calculateRobot(date) }
];

async function readPublishedUniversalControl(admin: ReturnType<typeof getAdminClient>) {
  try {
    const result = await admin
      .from('program_method_controls')
      .select('version,rule')
      .eq('program_key', 'universelle')
      .eq('status', 'published')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (result.error || !result.data) return null;
    return result.data;
  } catch (_) {
    // The method-control migration is optional on older installations.
    return null;
  }
}

function getAdminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) {
    throw new Error('Configuration Supabase serveur incomplète.');
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function readEarlyAccessHorizons(
  admin: ReturnType<typeof getAdminClient>
) {
  const result = await admin
    .from('feature_early_access_rules')
    .select('feature_key,enabled,preview_days');
  if (result.error) {
    if (/feature_early_access_rules|preview_days|relation .* does not exist/i
      .test(String(result.error.message || ''))) {
      return {} as Record<string, number>;
    }
    throw result.error;
  }
  return (result.data || []).reduce((map: Record<string, number>, rule: any) => {
    if (rule.enabled !== true) return map;
    map[String(rule.feature_key)] = Math.max(
      1,
      Math.min(30, Number(rule.preview_days) || 1)
    );
    return map;
  }, {});
}

function dateForOffset(programmeDate: string, offset: number) {
  const date = new Date(`${programmeDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date;
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

function generatedNumberList(
  random: () => number,
  count: number,
  min: number,
  max: number
) {
  const values = new Set<number>();
  while (values.size < count) {
    values.add(min + Math.floor(random() * (max - min + 1)));
  }
  return [...values];
}

function generatedDigitString(random: () => number, count: number) {
  return Array.from({ length: count }, () => Math.floor(random() * 10)).join('');
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

function sourceArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map(Number).filter((item) => Number.isFinite(item));
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['numbers', 'values', 'result', 'results']) {
      if (Array.isArray(record[key])) return sourceArray(record[key]);
    }
  }
  return [];
}

/*
 * Adding one source in the dashboard must be additive. The configured row
 * overrides only the same country/hour slot; all other default countries and
 * hours remain scheduled.
 */
function defaultMatrixSources(): MatrixSource[] {
  const sources: Array<
    [string, string, string, string, boolean, boolean]
  > = [
    ['CI', "Côte d'Ivoire", "Côte d'Ivoire Digital 7h", '07:00', true, false],
    ['CI', "Côte d'Ivoire", "Côte d'Ivoire 10h", '10:00', false, false],
    ['CI', "Côte d'Ivoire", "Côte d'Ivoire 13h", '13:00', true, false],
    ['CI', "Côte d'Ivoire", "Côte d'Ivoire 16h", '16:00', false, false],
    ['CI', "Côte d'Ivoire", "Côte d'Ivoire Matrice 8h", '08:00', false, false],
    ['CI', "Côte d'Ivoire", "Côte d'Ivoire Matrice 22h", '22:00', false, false],
    ['GH', 'Ghana', 'Ghana', '12:00', true, true],
    ['TG', 'Togo', 'Lonato Togo 9h', '09:00', true, false],
    ['TG', 'Togo', 'Lonato Togo 13h', '13:00', false, false],
    ['TG', 'Togo', 'Lonato Togo 18h', '18:00', false, true],
    ['NE', 'Niger', 'Soudji Niger', '20:00', true, false],
    ['BJ', 'Bénin', 'LNB Bénin 11h', '11:00', false, false],
    ['BJ', 'Bénin', 'LNB Bénin 14h', '14:00', true, false],
    ['BJ', 'Bénin', 'LNB Bénin 18h', '18:00', true, false],
    ['SN', 'Sénégal', 'Sénégal 11h', '11:00', false, false],
    ['SN', 'Sénégal', 'Sénégal 13h', '13:00', true, false],
    ['SN', 'Sénégal', 'Sénégal 15h', '15:00', false, false],
    ['SN', 'Sénégal', 'Sénégal 17h', '17:00', true, false]
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
  })) as MatrixSource[];
}

function matrixSourceSlot(source: MatrixSource): string {
  const country = String(source.country_code || '').trim().toUpperCase();
  const hour = String(source.draw_time || '').trim().slice(0, 2);
  return `${country}|${hour}`;
}

function mergeMatrixSources(configuredSources: MatrixSource[]): MatrixSource[] {
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

function sourceRunsOnDate(source: MatrixSource, programmeDate: string) {
  const configuredDays = source.settings?.generationDays;
  // Backward compatibility: sources created before weekday scheduling are
  // interpreted as daily sources.
  if (!Array.isArray(configuredDays)) return true;
  const days = configuredDays
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  const weekday = new Date(`${programmeDate}T12:00:00.000Z`).getUTCDay();
  return days.includes(weekday);
}

function matrixProgrammeFromSource(source: MatrixSource, programmeDate: string) {
  const settings = source.settings || {};
  const generated = settings.generation === 'universal-matrix-v1';
  const random = createSeededGenerator(
    `${source.country_code}|${source.country_name}|${source.draw_name}|${source.draw_time}|${programmeDate}`
  );
  const hasKeyboard = settings.hasKeyboard !== false;
  const hasCerveau = settings.hasCerveau === true;
  const hasCode = settings.hasCode !== false;
  const hasEvent = settings.hasEvent !== false;
  const hour = Number(String(source.draw_time || '').slice(0, 2));
  const matrix = generated
    ? generatedNumberList(random, 4, 100, 999)
    : sourceArray(source.matrix);
  const keyboard = generated
    ? (hasKeyboard ? generatedNumberList(random, 4, 100, 999) : null)
    : sourceArray(source.keyboard);
  const cerveau = generated
    ? (hasCerveau ? generatedNumberList(random, 4, 100, 999) : null)
    : sourceArray(source.cerveau);
  const code = generated
    ? (hasCode ? generatedDigitString(random, 3) : '')
    : source.code || '';
  // Keep the seeded stream stable for valid-number generation.
  if (generated && hasEvent) generatedDigitString(random, 4);
  const event = generated
    ? (hasEvent ? deriveMatrixEvent(code) : '')
    : source.event || '';

  return {
    country: canonicalMatrixCountry(source.country_name),
    name: source.draw_name,
    hasKeyboard: generated ? hasKeyboard : sourceArray(source.keyboard).length > 0,
    hasCerveau: generated ? hasCerveau : sourceArray(source.cerveau).length > 0,
    hour: Number.isFinite(hour) ? hour : undefined,
    matrix,
    keyboard,
    cerveau,
    code,
    event,
    date: programmeDate,
    ten_numbers: generated
      ? generatedNumberList(random, 10, 1, 90)
        .sort((left, right) => left - right)
        .map((value) => String(value).padStart(2, '0'))
      : Array.isArray(settings.ten_numbers)
        ? settings.ten_numbers.map(String).slice(0, 10)
        : []
  };
}

async function regenerateMatrixArchive(
  admin: ReturnType<typeof getAdminClient>,
  programmeDate: string,
  runAt: string
) {
  const sources = await admin
    .from('admin_draw_sources')
    .select('country_code,country_name,draw_name,draw_time,matrix,keyboard,cerveau,code,event,settings,enabled')
    .eq('module_key', 'matrice')
    .eq('enabled', true)
    .order('country_name')
    .order('draw_time');
  if (sources.error) {
    if (/admin_draw_sources|relation .* does not exist/i.test(String(sources.error.message || ''))) {
      return { skipped: true, reason: 'admin_draw_sources_missing' };
    }
    throw sources.error;
  }
  const effectiveSources = mergeMatrixSources(
    (sources.data || []) as MatrixSource[]
  );
  const eligibleSources = effectiveSources.filter((source) =>
    sourceRunsOnDate(source, programmeDate)
  );
  const results = eligibleSources.map((source) =>
    matrixProgrammeFromSource(source as MatrixSource, programmeDate)
  );
  if (!results.length) {
    const removed = await admin
      .from('daily_matrices')
      .delete()
      .eq('programme_date', programmeDate);
    if (removed.error) {
      if (/daily_matrices|relation .* does not exist/i.test(String(removed.error.message || ''))) {
        return { skipped: true, reason: 'daily_matrices_missing' };
      }
      throw removed.error;
    }
    return {
      skipped: true,
      reason: 'no_matrix_sources_for_weekday',
      generationTime: PROGRAM_GENERATION_TIME
    };
  }

  const archive = await admin
    .from('daily_matrices')
    .upsert({
      programme_date: programmeDate,
      draw_number: 2710,
      results,
      updated_at: runAt
    }, { onConflict: 'programme_date' });
  if (archive.error) {
    if (/daily_matrices|relation .* does not exist/i.test(String(archive.error.message || ''))) {
      return { skipped: true, reason: 'daily_matrices_missing' };
    }
    throw archive.error;
  }
  return {
    programmeDate,
    persisted: true,
    generationTime: PROGRAM_GENERATION_TIME,
    generatedAt: runAt,
    sourceCount: results.length
  };
}

/** The shared scheduler secret kept in the database, read with service_role. */
async function authorize(request: Request, admin: ReturnType<typeof getAdminClient>): Promise<boolean> {
  const header = request.headers.get('Authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim();
  if (!header) return false;
  const { error, data } = await admin
    .from('scheduler_secrets')
    .select('regen_secret')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data) return false;
  return header === data.regen_secret;
}

export async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);

  const admin = getAdminClient();
  if (!(await authorize(request, admin))) {
    return json({ error: 'Non autorisé.' }, 403);
  }

  let target: Date;
  try {
    let body: { date?: unknown } = {};
    try {
      body = await request.json() as { date?: unknown };
    } catch (_) { /* fall through */ }
    const parsed = typeof body?.date === 'string'
      ? parseProgrammeDate(body.date)
      : null;
    target = parsed || programmeDateFromClock();
  } catch (error) {
    return json({ error: 'Date de programme invalide.' }, 400);
  }

  const programmeDate = dateIso(target);
  const results: Record<string, unknown> = {};
  const errors: string[] = [];
  const runAt = new Date().toISOString();
  const universalControl = await readPublishedUniversalControl(admin);
  const horizons = await readEarlyAccessHorizons(admin);
  const horizonFor = (featureKey: string) => horizons[featureKey] || 1;

  const matrixDates = Array.from(
    { length: horizonFor('matrice') + 1 },
    (_, offset) => dateIso(dateForOffset(programmeDate, offset))
  );
  results.matrice = [];
  for (const targetDate of matrixDates) {
    try {
      (results.matrice as unknown[]).push(
        await regenerateMatrixArchive(admin, targetDate, runAt)
      );
    } catch (error) {
      errors.push(`matrice:${targetDate}: ${error instanceof Error ? error.message : String(error)}`);
      (results.matrice as unknown[]).push({
        ok: false,
        programmeDate: targetDate,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  for (const entry of PROGRAMMES) {
    const featureKey = `tableaux-${entry.id}`;
    const dates = Array.from(
      { length: horizonFor(featureKey) + 1 },
      (_, offset) => dateIso(dateForOffset(programmeDate, offset))
    );
    results[entry.id] = [];
    for (const targetDate of dates) {
      try {
        const date = dateForOffset(programmeDate, dates.indexOf(targetDate));
        const nigerResult = entry.id === 'universelle' || entry.id === 'balsa'
          ? await readOptionalNigerResult(date)
          : null;
        const payload = entry.id === 'universelle'
          ? calculateUniverselle(
              date,
              undefined,
              universalControl?.rule || {},
              Number(universalControl?.version || 0),
              nigerResult
            )
          : entry.id === 'balsa'
            ? calculateBalsa(date, nigerResult)
          : entry.calculate(date);
        const { error } = await admin
          .from(entry.table)
          .upsert({
            programme_date: targetDate,
            payload: payload as Json,
            // The archive tables have no automatic updated_at trigger. Write
            // one shared timestamp so the administrator can verify that every
            // programme belongs to the same server generation run.
            updated_at: runAt
          },
            { onConflict: 'programme_date' });
        if (error) throw error;
        (results[entry.id] as unknown[]).push({
          programmeDate: targetDate,
          persisted: true,
          generatedAt: runAt,
          date: String((payload as Record<string, unknown>)?.date ?? targetDate)
        });
      } catch (error) {
        errors.push(`${entry.id}:${targetDate}: ${error instanceof Error ? error.message : String(error)}`);
        (results[entry.id] as unknown[]).push({
          ok: false,
          programmeDate: targetDate,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  return json({
    ok: errors.length === 0,
    timeZone: TIME_ZONE,
    programmeDate,
    generatedThrough: Object.fromEntries(
      Object.entries(horizons).map(([key, days]) => [
        key,
        dateIso(dateForOffset(programmeDate, days))
      ])
    ),
    persisted: results,
    errors
  }, errors.length ? 500 : 200);
}

function parseProgrammeDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

Deno.serve(handler);
