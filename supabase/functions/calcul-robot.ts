import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  corsHeaders,
  dateIso,
  json,
  publicProgramPayload,
  programmeDateFromClock,
  maskedProgramPayload,
  enforceFeatureAccess,
  enforceEarlyAccess
} from './_shared.ts';
import { calculateBalsa } from './calcul-balsa.ts';
import { calculateIntuition } from './calcul-intuition.ts';
import { calculateLnb } from './calcul-lnb.ts';
import { calculateOracle } from './calcul-oracle.ts';
import { calculateUniverselle } from './calcul-universelle.ts';

function isPrime(value: number) {
  if (!Number.isInteger(value) || value < 2) return false;
  for (let divisor = 2; divisor <= Math.sqrt(value); divisor += 1) {
    if (value % divisor === 0) return false;
  }
  return true;
}

function valuesFrom(program: any): number[] {
  const nap = Array.isArray(program?.nap?.nap1) ? program.nap.nap1 : [];
  const combinations = (program?.satellites || []).flatMap((satellite: any) => (
    (satellite?.combinations || []).flatMap((combination: any[]) => (
      Array.isArray(combination) ? combination.map((part: any) => part?.value ?? part) : []
    ))
  ));
  return [...nap, ...combinations].map(Number)
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 90);
}

export function calculateRobot(date: Date) {
  const programs = [
    calculateUniverselle(date),
    calculateIntuition(date),
    calculateOracle(date),
    calculateLnb(date),
    calculateBalsa(date)
  ];
  const retained = [...new Set(programs.flatMap(valuesFrom))].sort((a, b) => a - b);
  const result = retained.slice(-6);
  return {
    id: 'robot',
    date: dateIso(date),
    power: String(result.reduce((total, value) => total + value, 0)),
    result: result.join(', ') || '00',
    digitCount: String(result.join('').length),
    pairs: (result.join('').match(/.{1,2}/g) || []).join(' · ') || '00',
    retained: retained.join(', ') || '00',
    primes: retained.filter(isPrime).join(', ') || '00'
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

async function readOrCreateRobotProgram(date: Date) {
  const programmeDate = dateIso(date);
  const admin = getAdminClient();
  const existing = await admin
    .from('daily_robot_programs')
    .select('programme_date, payload, created_at, updated_at')
    .eq('programme_date', programmeDate)
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (existing.data?.payload) {
    return {
      ...existing.data.payload,
      meta: {
        programmeDate,
        source: 'database',
        persisted: true,
        createdAt: existing.data.created_at,
        updatedAt: existing.data.updated_at
      }
    };
  }

  const payload = calculateRobot(date);
  const inserted = await admin
    .from('daily_robot_programs')
    .insert({ programme_date: programmeDate, payload })
    .select('programme_date, payload, created_at, updated_at')
    .maybeSingle();

  if (inserted.error) {
    const raced = await admin
      .from('daily_robot_programs')
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

  let body: { date?: unknown } = {};
  try {
    body = await request.json() as { date?: unknown };
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

  try {
    const result = await readOrCreateRobotProgram(date);
    const payload = publicProgramPayload(result);
    const denied = await enforceFeatureAccess(request, 'tableaux-robot');
    const earlyDenied = denied
      ? null
      : await enforceEarlyAccess(
        request,
        'tableaux-robot',
        dateIso(date)
      );

    if (
      (denied || earlyDenied)
      && ((denied || earlyDenied)?.status === 401
        || (denied || earlyDenied)?.status === 403)
    ) {
      return json(maskedProgramPayload(payload));
    }

    return earlyDenied || denied || json(payload);
  } catch (error) {
    console.error('calcul-robot failed', error);
    return json({
      error: 'La table daily_robot_programs est absente ou indisponible. Exécutez le script SQL fourni.'
    }, 500);
  }
}
