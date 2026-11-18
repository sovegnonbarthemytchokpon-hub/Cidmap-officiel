import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildKeyFromValues,
  CALCULATION_VERSION,
  calculateCrossAndSatellites,
  corsHeaders,
  dateIso,
  extractLuckyNumbersFromDate,
  keyPayload,
  json,
  publicProgramPayload,
  maskedProgramPayload,
  programmeDateFromClock,
  parseProgrammeDate,
  sumDigits,
  resolveLuckyNumberDetails,
  enforceFeatureAccess,
  enforceEarlyAccess,
  LuckyNumberDetails
} from './_shared.ts';

const GROUP_ONE = [7, 16, 25, 34, 43, 52, 61, 70, 79, 88];
const GROUP_TWO = [9, 18, 27, 36, 45, 54, 63, 72, 81, 90];
const GROUP_THREE = [19, 29, 39, 49, 59, 69, 79, 89];

export function calculateIntuition(
  date: Date,
  luckyNumberDetails: LuckyNumberDetails = extractLuckyNumbersFromDate(date)
) {
  const luckyNumbers = luckyNumberDetails.luckyNumbers.filter((number) => [
    ...GROUP_ONE,
    ...GROUP_TWO,
    ...GROUP_THREE
  ].includes(number));
  const validNumbers = luckyNumbers;
  const selectedNumber = [...validNumbers].reverse()[0] || 27;
  const group = GROUP_ONE.includes(selectedNumber) ? 1 : GROUP_THREE.includes(selectedNumber) ? 3 : 2;
  const base = group === 1 ? 68 : 42;
  const exampleOne = Math.abs(selectedNumber - base) || selectedNumber;
  const exampleTwo = selectedNumber + base > 90 ? sumDigits(selectedNumber + base) : selectedNumber + base;
  const exampleThree = sumDigits(selectedNumber) + base;
  const key = buildKeyFromValues([exampleThree, exampleOne, exampleTwo]);
  const { cross, satellites } = calculateCrossAndSatellites(key, base, 'remainder');
  return {
    ...keyPayload(key, cross, satellites, validNumbers),
    calculationVersion: CALCULATION_VERSION,
    id: 'intuition',
    date: dateIso(date),
    luckyNumberDetails: {
      ...luckyNumberDetails,
      methodLuckyNumbers: luckyNumbers
    },
    luckyNumbers: luckyNumberDetails.luckyNumbers,
    selectedNumber,
    group,
    examples: [exampleOne, exampleTwo, exampleThree],
    nap: { nap1: [key.slice(-2), key.slice(0, 2)], nap2: [key.slice(-2), key.slice(0, 2)] }
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

async function readOrCreateIntuitionProgram(date: Date, luckyNumberDetails: LuckyNumberDetails) {
  const programmeDate = dateIso(date);
  const admin = getAdminClient();
  const existing = await admin
    .from('daily_intuition_programs')
    .select('programme_date, payload, created_at, updated_at')
    .eq('programme_date', programmeDate)
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (existing.data?.payload
      && existing.data.payload.calculationVersion !== CALCULATION_VERSION) {
    const payload = calculateIntuition(date, luckyNumberDetails);
    const refreshed = await admin
      .from('daily_intuition_programs')
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
    const methodLuckyNumbers = luckyNumbers.filter((number) => [
      ...GROUP_ONE,
      ...GROUP_TWO,
      ...GROUP_THREE
    ].includes(number));
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

  const payload = calculateIntuition(date, luckyNumberDetails);
  const inserted = await admin
    .from('daily_intuition_programs')
    .insert({ programme_date: programmeDate, payload })
    .select('programme_date, payload, created_at, updated_at')
    .maybeSingle();

  if (inserted.error) {
    // Deux visiteurs peuvent demander une nouvelle date en même temps.
    // La seconde requête renvoie alors la ligne validée par la première.
    const raced = await admin
      .from('daily_intuition_programs')
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
    const result = await readOrCreateIntuitionProgram(date, luckyNumberDetails);
    const denied = await enforceFeatureAccess(request, 'tableaux-intuition');
    const earlyDenied = denied
      ? null
      : await enforceEarlyAccess(request, 'tableaux-intuition', dateIso(date));
    const payload = publicProgramPayload(result);
    return (denied || earlyDenied)
      && ((denied || earlyDenied)?.status === 401
        || (denied || earlyDenied)?.status === 403)
      ? json(maskedProgramPayload(payload))
      : earlyDenied || denied || json(payload);
  } catch (error) {
    console.error('calcul-intuition failed', error);
    return json({
      error: 'La table daily_intuition_programs est absente ou indisponible. Exécutez le script SQL fourni.'
    }, 500);
  }
}
