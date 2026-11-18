import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  corsHeaders,
  dateIso,
  json,
  normalizeDateForOffset,
  parseProgrammeDate,
  publicProgramPayload,
  maskedProgramPayload,
  enforceFeatureAccess,
  enforceEarlyAccess,
  programmeDateFromClock
} from './_shared.ts';

const WINDOW_DAYS = 7;
/*
 * Stand-by is an aggregate programme. Its archive must be invalidated when
 * either its own aggregation rule or one of its source engines changes.
 * In particular, the Niger row depends on the deployed Balsa Plus service.
 */
const STANDBY_CALCULATION_VERSION = 6;
const SOURCE_CALCULATION_VERSIONS = {
  intuition: 5,
  balsa: 10,
  universelle: 8,
  oracle: 'deployed-current',
  lnb: 'deployed-current'
} as const;
const standbyRequests = new Map<string, Promise<any>>();
const PROGRAM_LABELS: Record<string, string> = {
  'calcul-intuition': 'Intuition',
  'calcul-balsa': 'Balsa Plus',
  'calcul-lnb': 'LNB',
  'calcule-universelle': 'Universelle',
  'calcul-oracle': 'Oracle'
};
const SOURCE_FUNCTIONS_BY_COUNTRY: Record<string, string[]> = {
  'Bénin': ['calcul-intuition'],
  'Niger': ['calcul-balsa', 'calcul-lnb'],
  'Ghana': ['calcule-universelle'],
  "Côte d'Ivoire": ['calcule-universelle', 'calcul-oracle']
};
const SOURCE_PROGRAMS_BY_COUNTRY: Record<string, string[]> =
  Object.fromEntries(
    Object.entries(SOURCE_FUNCTIONS_BY_COUNTRY).map(
      ([country, functions]) => [
        country,
        functions.map((name) => PROGRAM_LABELS[name] || name)
      ]
    )
  );
const SOURCE_TABLES: Record<string, string> = {
  'calcul-intuition': 'daily_intuition_programs',
  'calcul-balsa': 'daily_balsa_programs',
  'calcul-lnb': 'daily_lnb_programs',
  'calcule-universelle': 'daily_universal_programs',
  'calcul-oracle': 'daily_oracle_programs'
};

function normalizeStandbyPayload(payload: any) {
  if (!payload || typeof payload !== 'object') return payload;
  return {
    ...payload,
    rows: Array.isArray(payload.rows)
      ? payload.rows.map((row: any) => ({
          ...row,
          sourcePrograms: Array.isArray(row.sourcePrograms) && row.sourcePrograms.length
            ? row.sourcePrograms.map(String)
            : SOURCE_PROGRAMS_BY_COUNTRY[row.countryDisplay || row.country] || []
        }))
      : []
  };
}

function addValues(counts: Map<string, number>, firstSeen: Map<string, number>,
  values: unknown[], sequence: { value: number }) {
  values.forEach((value) => {
    const number = Number(value);
    /*
     * Stand-by follows the real-number rule used by the new Balsa method:
     * one-digit values (01..09) are never valid programme values.
     */
    if (!Number.isInteger(number) || number < 10 || number > 90) return;
    const key = String(number).padStart(2, '0');
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!firstSeen.has(key)) firstSeen.set(key, sequence.value++);
  });
}

function addDays(date: Date, offset: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + offset);
  result.setUTCHours(12, 0, 0, 0);
  return result;
}

async function readArchivedSource(functionName: string, date: Date) {
  const table = SOURCE_TABLES[functionName];
  if (!table) return null;

  try {
    const archived = await getAdminClient()
      .from(table)
      .select('payload')
      .eq('programme_date', dateIso(date))
      .maybeSingle();
    return archived.error ? null : archived.data?.payload || null;
  } catch (_) {
    return null;
  }
}

function isMaskedSourcePayload(payload: any) {
  return payload?.key === '000000'
    || payload?.nap?.nap1?.some?.((value: unknown) => String(value) === '00');
}

async function callProgram(
  functionName: string,
  date: Date,
  sourceRequest?: Request
) {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) {
    throw new Error('Configuration Supabase serveur incomplète.');
  }

  const authorization = sourceRequest?.headers.get('Authorization')
    || `Bearer ${serviceRoleKey}`;
  const response = await fetch(
    `${url}/functions/v1/${functionName}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': authorization
      },
      body: JSON.stringify({ date: dateIso(date) })
    }
  );

  let body: any = null;
  try {
    body = await response.json();
  } catch (_) {
    // The error below gives the caller a stable message for non-JSON replies.
  }
  if (!response.ok || body?.error || isMaskedSourcePayload(body)) {
    const archived = await readArchivedSource(functionName, date);
    if (archived && !isMaskedSourcePayload(archived)) return archived;
    throw new Error(
      body?.error || `La fonction ${functionName} est indisponible.`
    );
  }
  return body;
}

function programValues(program: any): unknown[] {
  const nap = Array.isArray(program?.nap?.nap1) ? program.nap.nap1 : [];
  const combinations = (program?.satellites || []).flatMap((satellite: any) => (
    (satellite?.combinations || []).flatMap((combination: any[]) => (
      Array.isArray(combination) ? combination.map((part: any) => part?.value ?? part) : []
    ))
  ));
  return [...nap, ...combinations];
}

function rankFutureNumbers(
  programNames: string[],
  loadedPrograms: Map<string, any>
) {
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  const sequence = { value: 0 };
  for (let offset = 0; offset < WINDOW_DAYS; offset += 1) {
    programNames.forEach((programName) => {
      const program = loadedPrograms.get(`${offset}:${programName}`);
      if (program) {
        addValues(counts, firstSeen, programValues(program), sequence);
      }
    });
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || (firstSeen.get(a[0])! - firstSeen.get(b[0])!))
    .map(([value, count]) => ({ value, count }));
}

function chooseStandbyNumbers(ranked: Array<{ value: string; count: number }>) {
  /*
   * No synthetic numbers are created here. A common fallback such as
   * 01,02 (or even 10,11) would make Bénin and Niger look identical when a
   * source function is unavailable. Only values really returned by the
   * country sources may be selected.
   */
  const unique = [...new Set(ranked.map(({ value }) => value))];
  return {
    nap2: unique.slice(0, 2).join(', '),
    permutation: unique.slice(0, 4).join(', '),
    available: unique.length > 0
  };
}

function emptyStandbyPayload(date: Date) {
  const next = normalizeDateForOffset(date, (2 - date.getUTCDay() + 7) % 7 || 7);
  return {
    id: 'standby',
    weekDate: dateIso(date),
    rows: Object.entries(SOURCE_PROGRAMS_BY_COUNTRY).map(([country, sourcePrograms]) => ({
      country,
      countryDisplay: country,
      ...chooseStandbyNumbers([]),
      windowDays: WINDOW_DAYS,
      sourcePrograms
    })),
    nextDate: next.toISOString(),
    followingDate: normalizeDateForOffset(next, 7).toISOString()
  };
}

async function calculatedFallback(
  date: Date,
  sourceRequest?: Request
) {
  /*
   * Stand-by is public, deterministic content. Persistence is useful for
   * keeping one official payload, but it must not make the public endpoint
   * unusable when the table has not been migrated yet or Supabase is
   * temporarily unavailable.
   */
  let payload;
  try {
    payload = await calculateStandby(date, sourceRequest);
  } catch (error) {
    console.error('Stand-by calculation fallback used.', error);
    payload = emptyStandbyPayload(date);
  }
  return {
    ...payload,
    meta: {
      programmeDate: dateIso(date),
      source: 'calculated-fallback',
      persisted: false
    }
  };
}

export async function calculateStandby(
  date: Date,
  sourceRequest?: Request
) {
  const programNames = [
    ...new Set(Object.values(SOURCE_FUNCTIONS_BY_COUNTRY).flat())
  ];
  const requests = programNames.flatMap((programName) =>
    Array.from({ length: WINDOW_DAYS }, (_, offset) => ({
      offset,
      programName,
      promise: callProgram(
        programName,
        addDays(date, offset),
        sourceRequest
      )
    }))
  );
  const results = await Promise.allSettled(
    requests.map((request) => request.promise)
  );
  const loadedPrograms = new Map<string, any>();
  results.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    const request = requests[index];
    loadedPrograms.set(
      `${request.offset}:${request.programName}`,
      result.value
    );
  });

  const rows = Object.entries(SOURCE_FUNCTIONS_BY_COUNTRY).map(
    ([country, functions]) => ({
      country,
      countryDisplay: country,
      ...chooseStandbyNumbers(
        rankFutureNumbers(functions, loadedPrograms)
      ),
      windowDays: WINDOW_DAYS,
      sourcePrograms: functions.map(
        (name) => PROGRAM_LABELS[name] || name
      )
    })
  );
  const next = normalizeDateForOffset(date, (2 - date.getUTCDay() + 7) % 7 || 7);
  return {
    id: 'standby',
    calculationVersion: STANDBY_CALCULATION_VERSION,
    sourceCalculationVersions: {
      ...Object.fromEntries(
        Object.entries(SOURCE_CALCULATION_VERSIONS)
          .map(([name, version]) => [name, version])
      )
    },
    weekDate: dateIso(date),
    rows,
    nextDate: next.toISOString(),
    followingDate: normalizeDateForOffset(next, 7).toISOString()
  };
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

async function readOrCreateStandbyProgram(
  date: Date,
  sourceRequest?: Request
) {
  const programmeDate = dateIso(date);
  if (standbyRequests.has(programmeDate)) return standbyRequests.get(programmeDate);

  const request = (async () => {
    try {
      const admin = getAdminClient();
      const existing = await admin
        .from('daily_standby_programs')
        .select('programme_date, payload, created_at, updated_at')
        .eq('programme_date', programmeDate)
        .maybeSingle();

      if (existing.error) throw existing.error;
      const storedPayload = existing.data?.payload;
      const hasCurrentCalculation = (
        Number(storedPayload?.calculationVersion)
          === STANDBY_CALCULATION_VERSION
        && Object.entries(SOURCE_CALCULATION_VERSIONS).every(
          ([name, version]) => String(
            storedPayload?.sourceCalculationVersions?.[name]
          ) === String(version)
        )
      );

      if (storedPayload && hasCurrentCalculation) {
        const result = normalizeStandbyPayload({
          ...storedPayload,
          meta: {
            programmeDate,
            source: 'database',
            persisted: true,
            createdAt: existing.data.created_at,
            updatedAt: existing.data.updated_at
          }
        });
        return result;
      }

      const payload = await calculateStandby(date, sourceRequest);
      const persistence = storedPayload
        ? admin
            .from('daily_standby_programs')
            .update({
              payload,
              updated_at: new Date().toISOString()
            })
            .eq('programme_date', programmeDate)
            .select('programme_date, payload, created_at, updated_at')
            .maybeSingle()
        : admin
            .from('daily_standby_programs')
            .insert({ programme_date: programmeDate, payload })
            .select('programme_date, payload, created_at, updated_at')
            .maybeSingle();
      const inserted = await persistence;

      if (inserted.error) {
        const raced = await admin
          .from('daily_standby_programs')
          .select('programme_date, payload, created_at, updated_at')
          .eq('programme_date', programmeDate)
          .maybeSingle();
        if (raced.error || !raced.data?.payload) throw inserted.error;
        const result = normalizeStandbyPayload({
          ...raced.data.payload,
          meta: {
            programmeDate,
            source: 'database',
            persisted: true,
            createdAt: raced.data.created_at,
            updatedAt: raced.data.updated_at
          }
        });
        return result;
      }

      const result = normalizeStandbyPayload({
        ...payload,
        meta: {
          programmeDate,
          source: storedPayload
            ? 'recalculated-and-persisted'
            : 'calculated-and-persisted',
          persisted: true,
          createdAt: inserted.data?.created_at || null,
          updatedAt: inserted.data?.updated_at || null
        }
      });
      return result;
    } catch (error) {
      /*
       * Do not cache a degraded response. A later request can then retry the
       * database and persist the same deterministic programme after a
       * migration, cold start, or transient Supabase outage.
       */
      console.warn('Stand-by persistence unavailable; serving calculated payload.', error);
      return calculatedFallback(date, sourceRequest);
    }
  })();

  standbyRequests.set(programmeDate, request);
  try {
    return await request;
  } finally {
    standbyRequests.delete(programmeDate);
  }
}

export async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Méthode non autorisée.' }, 405);
  }

  let body: { date?: unknown } = {};
  try {
    body = await request.json() as { date?: unknown };
  } catch (_) {
    return json({ error: 'Le corps de la requête doit être un JSON valide.' }, 400);
  }

  const date = body.date === undefined
    ? programmeDateFromClock()
    : parseProgrammeDate(body.date);

  if (!date) {
    return json({ error: 'date doit être une date ISO valide (YYYY-MM-DD).' }, 400);
  }

  try {
    const result = await readOrCreateStandbyProgram(date, request);
    const payload = {
      ...publicProgramPayload(result),
      rows: Array.isArray(result?.rows)
        ? result.rows.map((row: any) => ({
            country: row.country,
            countryDisplay: row.countryDisplay,
            sourcePrograms: Array.isArray(row.sourcePrograms)
              ? row.sourcePrograms.map(String)
              : [],
            nap2: row.nap2,
            permutation: row.permutation,
            available: row.available === true
          }))
        : []
    };
    const denied = await enforceFeatureAccess(request, 'tableaux-standby');
    const earlyDenied = denied
      ? null
      : await enforceEarlyAccess(request, 'tableaux-standby', dateIso(date));
    if (denied && (denied.status === 401 || denied.status === 403)) {
      const masked = maskedProgramPayload(payload);
      masked.rows = [{
        country: 'Pays',
        countryDisplay: 'Pays',
        sourcePrograms: [],
        nap2: '00',
        permutation: '00'
      }];
      return json(masked);
    }
    if (earlyDenied && (earlyDenied.status === 401 || earlyDenied.status === 403)) {
      const masked = maskedProgramPayload(payload);
      masked.rows = [{
        country: 'Pays',
        countryDisplay: 'Pays',
        sourcePrograms: [],
        nap2: '00',
        permutation: '00'
      }];
      return json(masked);
    }
    return earlyDenied || denied || json(payload);
  } catch (error) {
    console.error('calcul-standby failed', error);
    return json({ error: 'Calcul Stand-by temporairement indisponible.' }, 503);
  }
}
