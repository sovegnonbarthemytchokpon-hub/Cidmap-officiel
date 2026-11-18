/*
 * CALCUL STAND-BY — VERSION MONO-FICHIER À COPIER DANS SUPABASE
 *
 * Le serveur Stand-by utilise les fonctions déjà déployées comme moteurs
 * officiels. Il demande les résultats des sept dates du cycle, compte les
 * numéros cités par les NAP1 et les combinaisons des satellites, puis garde
 * les deux numéros les plus fréquents pour chaque pays.
 *
 * Sources :
 *   Bénin          -> calcul-intuition
 *   Niger          -> calcul-balsa + calcul-lnb
 *   Ghana          -> calcule-universelle
 *   Côte d'Ivoire  -> calcule-universelle + calcul-oracle
 *
 * Ce fichier est autonome : il ne dépend d'aucun fichier local du projet.
 * Les appels aux fonctions sources sont effectués côté serveur avec la
 * service_role key. Cette clé ne doit jamais être envoyée au navigateur.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TIME_ZONE = 'Africa/Abidjan';
const WINDOW_DAYS = 7;
const STANDBY_CALCULATION_VERSION = 6;

const SOURCE_PROGRAMS = {
  'Bénin': ['calcul-intuition'],
  'Niger': ['calcul-balsa', 'calcul-lnb'],
  'Ghana': ['calcule-universelle'],
  "Côte d'Ivoire": ['calcule-universelle', 'calcul-oracle']
} as const;

const PROGRAM_LABELS: Record<string, string> = {
  'calcul-intuition': 'Intuition',
  'calcul-balsa': 'Balsa Plus',
  'calcul-lnb': 'LNB',
  'calcule-universelle': 'Universelle',
  'calcul-oracle': 'Oracle'
};

const SOURCE_VERSIONS: Record<string, string | number> = {
  intuition: 5,
  balsa: 9,
  universelle: 5,
  oracle: 'deployed-current',
  lnb: 'deployed-current'
};
const SOURCE_TABLES: Record<string, string> = {
  'calcul-intuition': 'daily_intuition_programs',
  'calcul-balsa': 'daily_balsa_programs',
  'calcul-lnb': 'daily_lnb_programs',
  'calcule-universelle': 'daily_universal_programs',
  'calcul-oracle': 'daily_oracle_programs'
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: CORS_HEADERS
  });
}

function dateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + amount);
  result.setUTCHours(12, 0, 0, 0);
  return result;
}

function programmeDateFromClock(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);

  const part = (type: string) => Number(
    parts.find((item) => item.type === type)?.value
  );

  return new Date(
    Date.UTC(
      part('year'),
      part('month') - 1,
      part('day') + (part('hour') >= 16 ? 1 : 0),
      12
    )
  );
}

function parseDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') {
    return programmeDateFromClock();
  }

  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return null;
  }

  const date = new Date(`${value}T12:00:00.000Z`);

  return Number.isNaN(date.getTime())
    || !date.toISOString().startsWith(value)
    ? null
    : date;
}

function getAdminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !serviceRoleKey) {
    throw new Error('Configuration Supabase serveur incomplète.');
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

/*
 * Appel interne aux fonctions sources déjà déployées.
 * Une panne d'une source est isolée par Promise.allSettled plus bas.
 */
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

async function callSource(
  functionName: string,
  date: Date,
  sourceRequest?: Request
): Promise<any> {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !serviceRoleKey) {
    throw new Error('Configuration Supabase serveur incomplète.');
  }

  const response = await fetch(
    `${url}/functions/v1/${functionName}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': sourceRequest?.headers.get('Authorization')
          || `Bearer ${serviceRoleKey}`
      },
      body: JSON.stringify({
        date: dateIso(date)
      })
    }
  );

  let body: any = null;

  try {
    body = await response.json();
  } catch (_) {
    // The error below reports a stable source-unavailable message.
  }

  if (!response.ok || body?.error || isMaskedSourcePayload(body)) {
    const archived = await readArchivedSource(functionName, date);
    if (archived && !isMaskedSourcePayload(archived)) return archived;
    throw new Error(
      body?.error
      || `La fonction ${functionName} est indisponible.`
    );
  }

  return body;
}

function valuesFromProgram(program: any): unknown[] {
  const nap = Array.isArray(program?.nap?.nap1)
    ? program.nap.nap1
    : [];

  const combinations = Array.isArray(program?.satellites)
    ? program.satellites.flatMap((satellite: any) =>
        Array.isArray(satellite?.combinations)
          ? satellite.combinations.flatMap((combination: any[]) =>
              Array.isArray(combination)
                ? combination.map((part: any) => part?.value ?? part)
                : []
            )
          : []
      )
    : [];

  return [...nap, ...combinations];
}

function addValues(
  counts: Map<string, number>,
  firstSeen: Map<string, number>,
  values: unknown[],
  sequence: { value: number }
) {
  values.forEach((value) => {
    const number = Number(value);

    /*
     * Stand-by follows the real-number rule used by the new Balsa method:
     * one-digit values (01..09) are never valid programme values.
     */
    if (
      !Number.isInteger(number)
      || number < 10
      || number > 90
    ) {
      return;
    }

    const normalized = String(number).padStart(2, '0');

    counts.set(
      normalized,
      (counts.get(normalized) || 0) + 1
    );

    if (!firstSeen.has(normalized)) {
      firstSeen.set(normalized, sequence.value);
      sequence.value += 1;
    }
  });
}

function rankNumbers(
  functionNames: string[],
  loadedPrograms: Map<string, any>
) {
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  const sequence = { value: 0 };

  for (let offset = 0; offset < WINDOW_DAYS; offset += 1) {
    functionNames.forEach((functionName) => {
      const program = loadedPrograms.get(`${offset}:${functionName}`);

      if (!program) {
        return;
      }

      addValues(
        counts,
        firstSeen,
        valuesFromProgram(program),
        sequence
      );
    });
  }

  return [...counts.entries()]
    .sort((left, right) => (
      right[1] - left[1]
      || (firstSeen.get(left[0]) ?? 0)
        - (firstSeen.get(right[0]) ?? 0)
    ))
    .map(([value, count]) => ({ value, count }));
}

function chooseNumbers(
  ranked: Array<{ value: string; count: number }>
) {
  /*
   * Aucun numéro synthétique n'est créé. Un fallback commun ferait apparaître
   * Bénin et Niger avec la même liste quand une source est indisponible. Seuls
   * les numéros réellement fournis par les sources sont retenus.
   */
  const unique = [
    ...new Set(ranked.map((item) => item.value))
  ];

  return {
    nap2: unique.slice(0, 2).join(', '),
    permutation: unique.slice(0, 4).join(', '),
    available: unique.length > 0
  };
}

function nextTuesday(date: Date): Date {
  const daysUntilTuesday =
    (2 - date.getUTCDay() + 7) % 7 || 7;

  return addDays(date, daysUntilTuesday);
}

async function calculateStandby(
  date: Date,
  sourceRequest?: Request
) {
  const functionNames = [
    ...new Set(
      Object.values(SOURCE_PROGRAMS).flat()
    )
  ];

  const requests = functionNames.flatMap((functionName) =>
    Array.from(
      { length: WINDOW_DAYS },
      (_, offset) => ({
        functionName,
        offset,
        promise: callSource(
          functionName,
          addDays(date, offset),
          sourceRequest
        )
      })
    )
  );

  const results = await Promise.allSettled(
    requests.map((request) => request.promise)
  );

  const loadedPrograms = new Map<string, any>();

  results.forEach((result, index) => {
    if (result.status !== 'fulfilled') {
      console.warn(
        'Source Stand-by indisponible.',
        requests[index].functionName,
        result.reason
      );
      return;
    }

    const request = requests[index];

    loadedPrograms.set(
      `${request.offset}:${request.functionName}`,
      result.value
    );
  });

  const rows = Object.entries(SOURCE_PROGRAMS).map(
    ([country, functions]) => ({
      country,
      countryDisplay: country,
      ...chooseNumbers(
        rankNumbers(functions, loadedPrograms)
      ),
      windowDays: WINDOW_DAYS,
      sourcePrograms: functions.map(
        (name) => PROGRAM_LABELS[name] || name
      )
    })
  );

  const next = nextTuesday(date);

  return {
    id: 'standby',
    calculationVersion: STANDBY_CALCULATION_VERSION,
    sourceCalculationVersions: SOURCE_VERSIONS,
    weekDate: dateIso(date),
    rows,
    nextDate: next.toISOString(),
    followingDate: addDays(next, 7).toISOString()
  };
}

async function readOrCreateStandby(
  date: Date,
  sourceRequest?: Request
) {
  const programmeDate = dateIso(date);

  try {
    const admin = getAdminClient();
    const existing = await admin
      .from('daily_standby_programs')
      .select('programme_date,payload,created_at,updated_at')
      .eq('programme_date', programmeDate)
      .maybeSingle();

    if (existing.error) {
      throw existing.error;
    }

    const stored = existing.data?.payload;
    const current = stored
      && String(stored.calculationVersion)
        === String(STANDBY_CALCULATION_VERSION)
      && Object.entries(SOURCE_VERSIONS).every(
        ([name, version]) =>
          String(stored.sourceCalculationVersions?.[name])
          === String(version)
      );

    if (current) {
      return stored;
    }

    const payload = await calculateStandby(date, sourceRequest);
    const saved = stored
      ? await admin
          .from('daily_standby_programs')
          .update({
            payload,
            updated_at: new Date().toISOString()
          })
          .eq('programme_date', programmeDate)
          .select('programme_date,payload,created_at,updated_at')
          .maybeSingle()
      : await admin
          .from('daily_standby_programs')
          .insert({
            programme_date: programmeDate,
            payload
          })
          .select('programme_date,payload,created_at,updated_at')
          .maybeSingle();

    if (!saved.error && saved.data?.payload) {
      return saved.data.payload;
    }

    /*
     * En cas de concurrence, une autre requête a pu créer la ligne entre
     * notre lecture et notre insertion.
     */
    const raced = await admin
      .from('daily_standby_programs')
      .select('payload')
      .eq('programme_date', programmeDate)
      .maybeSingle();

    if (!raced.error && raced.data?.payload) {
      return raced.data.payload;
    }

    if (saved.error) {
      throw saved.error;
    }

    return payload;
  } catch (error) {
    /*
     * La table peut être créée plus tard. Le calcul reste disponible même
     * lorsque la persistance Supabase est momentanément indisponible.
     */
    console.warn(
      'Persistance Stand-by indisponible, calcul direct utilisé.',
      error
    );
    return calculateStandby(date, sourceRequest);
  }
}

export async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Méthode non autorisée.' }, 405);
  }

  let body: { date?: unknown } = {};

  try {
    body = await request.json() as { date?: unknown };
  } catch (_) {
    /*
     * Un corps vide est accepté : la date serveur Africa/Abidjan est utilisée.
     */
  }

  const date = parseDate(body.date);

  if (!date) {
    return json(
      { error: 'date doit être une date ISO valide (YYYY-MM-DD).' },
      400
    );
  }

  try {
    return json(await readOrCreateStandby(date, request));
  } catch (error) {
    console.error('calcul-standby failed', error);
    return json(
      { error: 'Calcul Stand-by temporairement indisponible.' },
      503
    );
  }
}

Deno.serve(handler);
