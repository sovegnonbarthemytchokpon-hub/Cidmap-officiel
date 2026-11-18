/*
 * Weekly Stand-by regeneration.
 *
 * Stand-by has a separate seven-day publication cycle. The Balsa keys are
 * calculation inputs for the window, but this endpoint is not part of the
 * daily key regeneration job.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  corsHeaders,
  dateIso,
  programmeDateFromClock
} from '../_shared.ts';
import { calculateStandby } from '../calcul-standby.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders
  });
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

async function authorize(
  request: Request,
  admin: ReturnType<typeof getAdminClient>
) {
  const token = request.headers.get('Authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim();
  if (!token) return false;

  const result = await admin
    .from('scheduler_secrets')
    .select('regen_secret')
    .eq('id', 1)
    .maybeSingle();

  return !result.error
    && Boolean(result.data?.regen_secret)
    && token === result.data.regen_secret;
}

function parseDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') {
    return programmeDateFromClock();
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime())
    || !date.toISOString().startsWith(value)
    ? null
    : date;
}

export async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Méthode non autorisée.' }, 405);
  }

  const admin = getAdminClient();
  if (!(await authorize(request, admin))) {
    return json({ error: 'Non autorisé.' }, 403);
  }

  let body: { date?: unknown } = {};
  try {
    body = await request.json() as { date?: unknown };
  } catch (_) {
    // An empty body is valid: use the server's programme date.
  }

  const date = parseDate(body.date);
  if (!date) {
    return json(
      { error: 'date doit être une date ISO valide (YYYY-MM-DD).' },
      400
    );
  }

  try {
    const programmeDate = dateIso(date);
    const payload = await calculateStandby(date);
    const saved = await admin
      .from('daily_standby_programs')
      .upsert(
        {
          programme_date: programmeDate,
          payload,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'programme_date' }
      )
      .select('programme_date, payload, created_at, updated_at')
      .maybeSingle();

    if (saved.error) throw saved.error;

    return json({
      ok: true,
      programmeDate,
      cycleDays: 7,
      persisted: Boolean(saved.data?.payload),
      calculationVersion: payload.calculationVersion,
      sourceCalculationVersions: payload.sourceCalculationVersions
    });
  } catch (error) {
    console.error('regen-standby failed', error);
    return json(
      {
        error: error instanceof Error
          ? error.message
          : 'Régénération Stand-by indisponible.'
      },
      500
    );
  }
}

Deno.serve(handler);
