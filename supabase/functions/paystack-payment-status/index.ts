import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type SupabaseClient = any;
type AuthenticatedUser = { id: string };
const REFERENCE_PATTERN = /^cid_[a-f0-9]{32}$/i;
const MAX_BODY_BYTES = 8 * 1024;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Cache-Control': 'no-store'
    }
  });
}

function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Configuration Supabase serveur incomplète.');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function paystackSecret() {
  return Deno.env.get('PAYSTACK_SECRET_KEY')
    || Deno.env.get('PAYSTACK_SECRET')
    || '';
}

async function verifyWithPaystack(reference: string) {
  const secret = paystackSecret();
  if (!secret) throw new Error('Clé secrète Paystack non configurée.');

  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: 'application/json'
      }
    }
  );
  let body: any = null;
  try { body = await response.json(); } catch (_) {}

  if (!response.ok || body?.status !== true || !body?.data) {
    const error = new Error(
      String(body?.message || 'Vérification Paystack indisponible.')
    );
    throw error;
  }

  return body;
}

function isTerminalFailure(status: unknown) {
  return ['failed', 'abandoned', 'reversed'].includes(
    String(status || '').trim().toLowerCase()
  );
}

async function authenticate(request: Request): Promise<AuthenticatedUser | null> {
  const token = request.headers.get('Authorization')
    ?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const result = await serviceClient().auth.getUser(token);
  return result.error || !result.data?.user?.id
    ? null
    : { id: result.data.user.id };
}

async function handleRequest(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);

  const user = await authenticate(request);
  if (!user) return json({ error: 'Connexion requise.' }, 401);

  let body: any;
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: 'Corps JSON invalide.' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Corps de requête invalide.' }, 400);
  }
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > MAX_BODY_BYTES) {
    return json({ error: 'Corps de requête trop volumineux.' }, 413);
  }
  const keys = Object.keys(body).sort();
  if (keys.join(',') !== 'reference') {
    return json({
      error: 'La requête doit contenir uniquement reference.'
    }, 400);
  }
  const reference = String(body?.reference || '').trim();
  if (
    !reference
    || reference.length > 120
    || !REFERENCE_PATTERN.test(reference)
  ) {
    return json({ error: 'Référence de paiement invalide.' }, 400);
  }

  const client = serviceClient();
  const result = await client
    .from('payment_transactions')
    .select('id,reference,status,product_type,quantity,amount,currency,paid_at')
    .eq('reference', reference)
    .eq('user_id', user.id)
    .maybeSingle();
  if (result.error) {
    console.error('paystack-payment-status failed', result.error);
    return json({ error: 'Statut de paiement indisponible.' }, 500);
  }
  if (!result.data) {
    return json({ error: 'Paiement introuvable.' }, 404);
  }
  if (
    result.data.product_type !== 'tokens'
    || result.data.currency !== 'XOF'
  ) {
    return json({ error: 'Produit de paiement non autorisé.' }, 403);
  }

  /*
   * The webhook remains the primary settlement path, but a browser return
   * must be able to recover a legitimate payment when Paystack delivered the
   * webhook late (or when the merchant webhook was temporarily unavailable).
   * The reference and expected amount come from our immutable pending order;
   * no value supplied by the browser or by Paystack can choose the quantity.
   */
  if (result.data.status === 'pending') {
    try {
      const verification = await verifyWithPaystack(reference);
      const gatewayPayment = verification.data || {};
      const gatewayReference = String(gatewayPayment.reference || '').trim();
      const gatewayCurrency = String(gatewayPayment.currency || '')
        .trim()
        .toUpperCase();
      const gatewayAmount = Number(gatewayPayment.amount);
      const gatewayStatus = String(gatewayPayment.status || '')
        .trim()
        .toLowerCase();

      if (
        gatewayReference !== reference
        || gatewayCurrency !== result.data.currency
        || !Number.isSafeInteger(gatewayAmount)
        || gatewayAmount !== Number(result.data.amount)
      ) {
        console.error('Paystack verification mismatch', {
          reference,
          gatewayReference,
          gatewayAmount,
          expectedAmount: result.data.amount,
          gatewayCurrency
        });
        return json({ error: 'Le montant du paiement ne correspond pas à la commande.' }, 409);
      }

      if (gatewayStatus === 'success') {
        const finalized = await client.rpc('finalize_paystack_payment', {
          payment_reference: reference,
          gateway_amount: gatewayAmount,
          gateway_currency: gatewayCurrency,
          payment_paid_at: gatewayPayment.paid_at
            || gatewayPayment.paidAt
            || new Date().toISOString(),
          gateway_event: {
            source: 'paystack-payment-status',
            reference: gatewayReference,
            amount: gatewayAmount,
            currency: gatewayCurrency,
            status: gatewayStatus,
            paid_at: gatewayPayment.paid_at || gatewayPayment.paidAt || null,
            transaction_date: gatewayPayment.transaction_date || null,
            id: gatewayPayment.id || null
          }
        });
        if (finalized.error) {
          console.error('Paystack reconciliation failed', {
            reference,
            message: finalized.error.message || ''
          });
          return json({ error: 'Le paiement est confirmé, mais sa recharge est encore en cours.' }, 503);
        }

        // The RPC is atomic and has already settled the order. Keep the
        // response truthful even if the follow-up read briefly hits a
        // replica that has not caught up yet.
        result.data = {
          ...result.data,
          status: 'paid',
          paid_at: gatewayPayment.paid_at
            || gatewayPayment.paidAt
            || new Date().toISOString()
        };
        const refreshed = await client
          .from('payment_transactions')
          .select('reference,status,product_type,quantity,currency,paid_at')
          .eq('reference', reference)
          .eq('user_id', user.id)
          .maybeSingle();
        if (refreshed.error) {
          console.error('Paystack status refresh failed', refreshed.error);
        }
        if (refreshed.data) result.data = refreshed.data;
      } else if (isTerminalFailure(gatewayStatus)) {
        const failed = await client
          .from('payment_transactions')
          .update({
            status: 'failed',
            updated_at: new Date().toISOString()
          })
          .eq('id', result.data.id)
          .eq('status', 'pending');
        if (failed.error) {
          console.error('Paystack failed-status update rejected', failed.error);
        } else {
          result.data.status = 'failed';
        }
      }
    } catch (error) {
      // A transient gateway/API outage must leave the order pending so the
      // next return, refresh, or webhook retry can reconcile it safely.
      console.warn('Paystack verification unavailable', {
        reference,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return json({
    ok: true,
    status: ['pending', 'paid', 'failed'].includes(result.data.status)
      ? result.data.status
      : 'pending',
    payment: result.data
  });
}

Deno.serve(handleRequest);
