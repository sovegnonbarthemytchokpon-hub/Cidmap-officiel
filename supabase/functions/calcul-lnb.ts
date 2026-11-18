import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildKeyFromValues,
  CALCULATION_VERSION,
  calculateCrossAndSatellites,
  corsHeaders,
  dateIso,
  deriveNap,
  extractLuckyNumbersFromDate,
  json,
  keyPayload,
  programmeDateFromClock,
  publicProgramPayload,
  maskedProgramPayload,
  sumDigits,
  getDateCandidates,
  parseProgrammeDate,
  resolveLuckyNumberDetails,
  enforceFeatureAccess,
  enforceEarlyAccess,
  LuckyNumberDetails
} from './_shared.ts';

const LNB_NUMBERS = [
  3, 6, 7, 9, 12, 13, 15, 16, 17, 18, 21, 24, 25, 27, 30, 31, 33, 34,
  36, 39, 42, 43, 45, 48, 51, 54, 57, 58, 60, 61, 63, 66, 67, 69, 70, 71,
  75, 76, 78, 79, 81, 84, 87, 90
];
const LNB_CALCULATION_VERSION = 6;

export function calculateLnb(
  date: Date,
  luckyNumberDetails: LuckyNumberDetails = extractLuckyNumbersFromDate(date)
) {
  const dateCandidates = getDateCandidates(date);
  const validNumbers = dateCandidates
    .filter((number) => LNB_NUMBERS.includes(number));
  const selectedNumber = [...validNumbers].reverse()[0] || 27;
  const next = sumDigits(selectedNumber + date.getUTCMonth() + 1);
  const total = sumDigits(selectedNumber + date.getUTCDate() + date.getUTCFullYear());
  const key = buildKeyFromValues([selectedNumber, next || 1, total || 1]);
  const { cross, satellites } = calculateCrossAndSatellites(key);
  const nap = deriveNap(key, satellites, {
    code: key.slice(0, 2),
    filter: key.slice(2, 4),
    cross
  });
  return {
    ...keyPayload(key, cross, satellites, validNumbers),
    calculationVersion: LNB_CALCULATION_VERSION,
    id: 'lnb',
    selectedNumber,
    date: dateIso(date),
    luckyNumberDetails: {
      ...luckyNumberDetails,
      methodLuckyNumbers: validNumbers
    },
    luckyNumbers: luckyNumberDetails.luckyNumbers,
    nap
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

async function readOrCreateLnbProgram(date: Date, luckyNumberDetails: LuckyNumberDetails) {
  const programmeDate = dateIso(date);
  const admin = getAdminClient();
  const existing = await admin
    .from('daily_lnb_programs')
    .select('programme_date, payload, created_at, updated_at')
    .eq('programme_date', programmeDate)
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (existing.data?.payload
      && existing.data.payload.calculationVersion !== LNB_CALCULATION_VERSION) {
    const payload = calculateLnb(date, luckyNumberDetails);
    const refreshed = await admin
      .from('daily_lnb_programs')
      .update({ payload })
      .eq('programme_date', programmeDate)
      .select('programme_date, payload, created_at, updated_at')
      .maybeSingle();
    if (refreshed.error) throw refreshed.error;
    return {
      ...payload,
      meta: {
        programmeDate,
        source: 'recalculated-and-persisted',
        persisted: true,
        createdAt: refreshed.data?.created_at || existing.data.created_at,
        updatedAt: refreshed.data?.updated_at || null
      }
    };
  }
  if (existing.data?.payload) {
    const storedPayload = existing.data.payload;
    const luckyNumbers = luckyNumberDetails.luckyNumbers;
    const methodLuckyNumbers = getDateCandidates(date)
      .filter((number) => LNB_NUMBERS.includes(number));
    return {
      ...storedPayload,
      luckyNumbers,
      luckyNumberDetails: { ...luckyNumberDetails, methodLuckyNumbers },
      meta: {
        programmeDate,
        source: 'database',
        persisted: true,
        createdAt: existing.data.created_at,
        updatedAt: existing.data.updated_at
      }
    };
  }

  const payload = calculateLnb(date, luckyNumberDetails);
  const inserted = await admin
    .from('daily_lnb_programs')
    .insert({ programme_date: programmeDate, payload })
    .select('programme_date, payload, created_at, updated_at')
    .maybeSingle();

  if (inserted.error) {
    const raced = await admin
      .from('daily_lnb_programs')
      .select('programme_date, payload, created_at, updated_at')
      .eq('programme_date', programmeDate)
      .maybeSingle();
    if (raced.error || !raced.data?.payload) throw inserted.error;
    return {
      ...raced.data.payload,
      meta: {
        programmeDate,
        source: 'database',
        persisted: true,
        createdAt: raced.data.created_at,
        updatedAt: raced.data.updated_at
      }
    };
  }

  return {
    ...payload,
    meta: {
      programmeDate,
      source: 'calculated-and-persisted',
      persisted: true,
      createdAt: inserted.data?.created_at || null,
      updatedAt: inserted.data?.updated_at || null
    }
  };
}

export async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Méthode non autorisée.' }, 405);
  }

  let body: { date?: unknown; luckyNumbers?: unknown } = {};
  try {
    body = await request.json() as { date?: unknown; luckyNumbers?: unknown };
  } catch (_) {
    return json({ error: 'Le corps de la requête doit être un JSON valide.' }, 400);
  }

  const date = body.date === undefined
    ? programmeDateFromClock()
    : typeof body.date === 'string' && body.date !== ''
      ? parseProgrammeDate(body.date)
      : null;

  if (!date || Number.isNaN(date.getTime())) {
    return json({ error: 'date doit être une date ISO valide (YYYY-MM-DD).' }, 400);
  }
  let luckyNumberDetails: LuckyNumberDetails;
  try {
    luckyNumberDetails = resolveLuckyNumberDetails(date, body.luckyNumbers);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Numéros chanceux invalides.' }, 400);
  }

  try {
    const result = await readOrCreateLnbProgram(date, luckyNumberDetails);
    const denied = await enforceFeatureAccess(request, 'tableaux-lnb');
    const earlyDenied = denied
      ? null
      : await enforceEarlyAccess(request, 'tableaux-lnb', dateIso(date));
    const payload = publicProgramPayload(result);
    return (denied || earlyDenied)
      && ((denied || earlyDenied)?.status === 401
        || (denied || earlyDenied)?.status === 403)
      ? json(maskedProgramPayload(payload))
      : earlyDenied || denied || json(payload);
  } catch (error) {
    console.error('calcul-lnb failed', error);
    return json({
      error: 'La table daily_lnb_programs est absente ou indisponible. Exécutez le script SQL fourni.'
    }, 500);
  }
}
