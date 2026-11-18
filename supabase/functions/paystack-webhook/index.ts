import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type SupabaseClient = any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-paystack-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};
const MAX_BODY_BYTES = 512 * 1024;
const MAX_REFERENCE_LENGTH = 120;
const REFERENCE_PATTERN = /^cid_[a-f0-9]{32}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders
  });
}

function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) {
    throw new Error('Configuration Supabase serveur incomplète.');
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function signatureFor(body: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  return hex(await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(body)
  ));
}

function constantTimeEqual(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function handleRequest(request: Request) {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Méthode non autorisée.' }, 405);
  }

  const secret = Deno.env.get('PAYSTACK_SECRET_KEY')
    || Deno.env.get('PAYSTACK_SECRET');
  const receivedSignature = String(
    request.headers.get('x-paystack-signature') || ''
  ).trim().toLowerCase();
  if (!secret || !receivedSignature) {
    return json({ error: 'Signature Paystack absente.' }, 401);
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return json({ error: 'Événement Paystack trop volumineux.' }, 413);
  }
  const expectedSignature = await signatureFor(body, secret);
  if (!constantTimeEqual(receivedSignature, expectedSignature)) {
    return json({ error: 'Signature Paystack invalide.' }, 401);
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch (_) {
    return json({ error: 'Événement Paystack invalide.' }, 400);
  }

  // Les autres événements sont acceptés sans mutation : Paystack ne doit pas
  // retenter inutilement un événement que l'application ne traite pas.
  if (event?.event !== 'charge.success') {
    return json({ ok: true, ignored: true });
  }

  const data = event?.data || {};
  const reference = String(data.reference || '').trim();
  const amount = Number(data.amount);
  const currency = String(data.currency || '').trim().toUpperCase();
  if (
    !reference
    || reference.length > MAX_REFERENCE_LENGTH
    || !REFERENCE_PATTERN.test(reference)
    || !Number.isSafeInteger(amount)
    || amount <= 0
    || currency !== 'XOF'
  ) {
    return json({ error: 'Données de paiement Paystack incomplètes.' }, 400);
  }

  try {
    const result = await serviceClient().rpc('finalize_paystack_payment', {
      payment_reference: reference,
      gateway_amount: amount,
      gateway_currency: currency,
      payment_paid_at: data.paid_at || data.paidAt || new Date().toISOString(),
      gateway_event: event
    });
    if (result.error) {
      console.error('Paystack credit rejected', {
        reference,
        message: result.error.message || ''
      });
      // 5xx demande à Paystack de livrer à nouveau l'événement après une
      // correction de configuration ou de migration.
      return json({ error: 'Crédit Paystack non finalisé.' }, 500);
    }
    return json({ ok: true, payment: result.data });
  } catch (error) {
    console.error('paystack-webhook failed', error);
    return json({ error: 'Webhook Paystack indisponible.' }, 500);
  }
}

Deno.serve(handleRequest);
