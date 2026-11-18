import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  calculateCrossAndSatellites,
  CALCULATION_VERSION,
  corsHeaders,
  dateIso,
  extractLuckyNumbersFromDate,
  json,
  keyPayload,
  programmeDateFromClock,
  publicProgramPayload,
  maskedProgramPayload,
  resolveLuckyNumberDetails,
  enforceFeatureAccess,
  enforceEarlyAccess,
  LuckyNumberDetails
} from './_shared.ts';

const ORACLE_NUMBERS = [3, 6, 7, 9, 12, 15, 17, 18, 21, 24, 27, 30, 33, 39, 42, 63, 70, 89];
const ORACLE_APPLICATIONS: Record<number, string> = {
  3: '273060', 6: '152469', 7: '242856', 9: '182454', 12: '212457',
  15: '065660', 17: '164679', 18: '213357', 21: '063951', 24: '465175',
  27: '335772', 30: '306090', 33: '576366', 39: '182169', 42: '425783',
  63: '242839', 70: '243546', 89: '465175'
};

export function calculateOracle(
  date: Date,
  luckyNumberDetails: LuckyNumberDetails = extractLuckyNumbersFromDate(date)
) {
  const validNumbers = luckyNumberDetails.luckyNumbers
    .filter((number) => ORACLE_NUMBERS.includes(number));
  const selectedNumber = validNumbers.at(-1) || 3;
  const value = String(selectedNumber).padStart(2, '0');
  const key = ORACLE_APPLICATIONS[selectedNumber] || `${value}30${value}`.slice(-6);
  const { cross, satellites } = calculateCrossAndSatellites(key, 30);
  const values = validNumbers.length ? validNumbers : [selectedNumber];
  return {
    ...keyPayload(key, cross, satellites, values),
    calculationVersion: CALCULATION_VERSION,
    id: 'oracle',
    date: dateIso(date),
    luckyNumberDetails: {
      ...luckyNumberDetails,
      methodLuckyNumbers: validNumbers
    },
    luckyNumbers: luckyNumberDetails.luckyNumbers,
    selectedNumber,
    nap: { nap1: [key.slice(-2)], nap2: [key.slice(-2), key.slice(0, 2)] }
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

async function readOrCreateOracleProgram(date: Date, luckyNumberDetails: LuckyNumberDetails) {
  const programmeDate = dateIso(date);
  const admin = getAdminClient();
  const existing = await admin
    .from('daily_oracle_programs')
    .select('programme_date, payload, created_at, updated_at')
    .eq('programme_date', programmeDate)
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (existing.data?.payload
      && existing.data.payload.calculationVersion !== CALCULATION_VERSION) {
    const payload = calculateOracle(date, luckyNumberDetails);
    const refreshed = await admin
      .from('daily_oracle_programs')
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
    const methodLuckyNumbers = luckyNumbers.filter((number) => ORACLE_NUMBERS.includes(number));
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

  const payload = calculateOracle(date, luckyNumberDetails);
  const inserted = await admin
    .from('daily_oracle_programs')
    .insert({ programme_date: programmeDate, payload })
    .select('programme_date, payload, created_at, updated_at')
    .maybeSingle();

  if (inserted.error) {
    const raced = await admin
      .from('daily_oracle_programs')
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
    : typeof body.date === 'string'
      ? new Date(`${body.date}T12:00:00.000Z`)
      : null;
  const validDate = body.date === undefined || (
    typeof body.date === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    && !Number.isNaN(date?.getTime())
  );

  if (!date || Number.isNaN(date.getTime()) || !validDate) {
    return json({ error: 'date doit être une date ISO valide (YYYY-MM-DD).' }, 400);
  }
  let luckyNumberDetails: LuckyNumberDetails;
  try {
    luckyNumberDetails = resolveLuckyNumberDetails(date, body.luckyNumbers);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Numéros chanceux invalides.' }, 400);
  }

  try {
    const result = await readOrCreateOracleProgram(date, luckyNumberDetails);
    const denied = await enforceFeatureAccess(request, 'tableaux-oracle');
    const earlyDenied = denied
      ? null
      : await enforceEarlyAccess(request, 'tableaux-oracle', dateIso(date));
    const payload = publicProgramPayload(result);
    return (denied || earlyDenied)
      && ((denied || earlyDenied)?.status === 401
        || (denied || earlyDenied)?.status === 403)
      ? json(maskedProgramPayload(payload))
      : earlyDenied || denied || json(payload);
  } catch (error) {
    console.error('calcul-oracle failed', error);
    return json({
      error: 'La table daily_oracle_programs est absente ou indisponible. Exécutez le script SQL fourni.'
    }, 500);
  }
}
