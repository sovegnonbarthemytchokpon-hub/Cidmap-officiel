import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type SupabaseClient = any;
type AuthenticatedUser = { id: string; email?: string | null };

const MAX_QUANTITY = 1_000_000;
const PACK_ID_PATTERN = /^[a-z][a-z0-9_-]{2,59}$/;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
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

function bearerToken(request: Request) {
  return request.headers.get('Authorization')
    ?.replace(/^Bearer\s+/i, '').trim() || '';
}

async function authenticate(request: Request): Promise<AuthenticatedUser | null> {
  const token = bearerToken(request);
  if (!token) return null;
  const client = serviceClient();
  const result = await client.auth.getUser(token);
  if (result.error || !result.data?.user?.id) return null;
  return {
    id: result.data.user.id,
    email: result.data.user.email || null
  };
}

function readEmail(value: unknown) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function amountInXof(value: unknown) {
  /*
   * `token_prices.price_xof` is the human-facing XOF price. Paystack's
   * checkout expects the gateway subunit value for this account: sending
   * 100 made the checkout display 1. Keep the catalog price untouched and
   * convert only the immutable gateway amount stored on the transaction.
   */
  const amount = Math.round(Number(value) * 100);
  return Number.isFinite(amount) && amount > 0 && Number.isSafeInteger(amount)
    ? amount : 0;
}

async function configuredTokenPack(client: SupabaseClient, packId: string) {
  const result = await client
    .from('token_prices')
    .select('pack_id,name,quantity,price_xof')
    .eq('pack_id', packId)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data || null;
}

function configuredReturnUrl() {
  const configured = String(
    Deno.env.get('PAYSTACK_CALLBACK_URL') || ''
  ).trim();

  try {
    const url = new URL(configured);
    if (['http:', 'https:'].includes(url.protocol)) {
      return url.toString();
    }
  } catch (_) {
    // URL de retour absente ou invalide : Paystack utilisera la configuration
    // par défaut du compte marchand.
  }

  return undefined;
}

async function handleRequest(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);

  let input: Record<string, unknown>;
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json({ error: 'Corps de requête invalide.' }, 400);
    }
    input = body as Record<string, unknown>;
  } catch (_) {
    return json({ error: 'Corps JSON invalide.' }, 400);
  }

  try {
    const user = await authenticate(request);
    if (!user) return json({ error: 'Connexion requise.' }, 401);

    const keys = Object.keys(input).sort();
    if (keys.join(',') !== 'email,pack_id,user_id') {
      return json({
        error: 'La requête doit contenir uniquement pack_id, user_id et email.'
      }, 400);
    }

    const packId = String(input.pack_id || '').trim().toLowerCase();
    if (!PACK_ID_PATTERN.test(packId)) {
      return json({ error: 'Le pack de jetons est invalide.' }, 400);
    }

    const requestedUserId = String(input.user_id || '').trim();
    if (!requestedUserId || requestedUserId !== user.id) {
      return json({ error: 'Identité utilisateur invalide.' }, 403);
    }
    const rawRequestedEmail = String(input.email || '').trim();
    const requestedEmail = readEmail(rawRequestedEmail);
    const authenticatedEmail = readEmail(user.email);
    if (!authenticatedEmail || !requestedEmail || requestedEmail !== authenticatedEmail) {
      return json({ error: 'L’adresse e-mail est invalide.' }, 400);
    }

    const client = serviceClient();
    const settings = await client
      .from('payment_settings')
      .select('payment_mode,paystack_enabled')
      .eq('id', 1)
      .maybeSingle();
    if (settings.error) throw settings.error;
    const paymentMode = String(settings.data?.payment_mode || '').toLowerCase();
    if (settings.data?.paystack_enabled !== true
      && paymentMode !== 'online'
      && paymentMode !== 'both') {
      return json({ error: 'Le paiement Paystack est désactivé.' }, 403);
    }
    const pack = await configuredTokenPack(client, packId);
    const quantity = Number(pack?.quantity);
    const packPrice = Number(pack?.price_xof);
    if (!pack
      || !Number.isInteger(quantity)
      || quantity < 1
      || quantity > MAX_QUANTITY
      || !Number.isFinite(packPrice)
      || packPrice <= 0) {
      return json({ error: 'Le pack de jetons n’est pas configuré.' }, 400);
    }
    const productType = 'tokens';
    const currency = 'XOF';
    const amount = amountInXof(packPrice);
    if (!amount) return json({ error: 'Le tarif du pack est invalide.' }, 400);

    const secretKey = Deno.env.get('PAYSTACK_SECRET_KEY')
      || Deno.env.get('PAYSTACK_SECRET');
    if (!secretKey) throw new Error('Clé secrète Paystack non configurée.');

    // Generate the reference on the trusted server and persist the pending
    // order before contacting Paystack. The webhook can therefore always
    // resolve a successful charge to one immutable server-side order.
    const reference = `cid_${crypto.randomUUID().replace(/-/g, '')}`;
    const pending = await client.from('payment_transactions').insert({
      reference,
      user_id: user.id,
      product_type: productType,
      plan_slug: null,
      quantity,
      amount,
      currency,
      status: 'pending'
    }).select('reference').single();
    if (pending.error) throw pending.error;

    const metadata = {
      user_id: user.id,
      product_type: productType,
      pack_id: packId,
      quantity,
      reference,
      // This metadata is informational. The webhook trusts only the pending
      // transaction row created below, never metadata supplied by the gateway.
      currency,
      amount
    };
    const payload: Record<string, unknown> = {
      amount,
      email: authenticatedEmail,
      currency,
      reference,
      metadata
    };
    const callback = configuredReturnUrl();
    if (callback) payload.callback_url = callback;

    const paystackResponse = await fetch(
      'https://api.paystack.co/transaction/initialize',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );
    let paystackBody: any = null;
    try { paystackBody = await paystackResponse.json(); } catch (_) {}
    const paymentData = paystackBody?.data;
    if (!paystackResponse.ok || !paystackBody?.status || !paymentData?.authorization_url) {
      await client.from('payment_transactions')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('reference', reference)
        .eq('status', 'pending');
      console.error('Paystack initialization failed', {
        status: paystackResponse.status,
        message: paystackBody?.message || ''
      });
      return json({
        error: paystackBody?.message || 'Paystack a refusé la demande de paiement.'
      }, 502);
    }

    if (String(paymentData.reference || '').trim() !== reference) {
      await client.from('payment_transactions')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('reference', reference)
        .eq('status', 'pending');
      throw new Error('Paystack a retourné une référence inattendue.');
    }

    return json({
      ok: true,
      authorization_url: paymentData.authorization_url,
      payment_url: paymentData.authorization_url,
      url: paymentData.authorization_url,
      reference,
      data: {
        authorization_url: paymentData.authorization_url,
        payment_url: paymentData.authorization_url,
        access_code: paymentData.access_code || '',
        reference
      }
    });
  } catch (error) {
    console.error('create-paystack-payment failed', error);
    return json({ error: 'Initialisation du paiement indisponible.' }, 500);
  }
}

Deno.serve(handleRequest);
