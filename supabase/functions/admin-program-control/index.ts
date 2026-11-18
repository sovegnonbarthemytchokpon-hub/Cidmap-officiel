import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/*
 * Point d'entrée séparé pour les outils de méthodes et de programmes du
 * tableau administrateur.
 *
 * Les prix, les soldes, les crédits manuels, Paystack, les abonnements et les
 * administrateurs restent gérés par admin-method-control.
 *
 * Cette fonction accepte uniquement les actions liées aux programmes,
 * matrices, méthodes, tests, publications et sources de tirage.
 */

const PROGRAM_ACTIONS = new Set([
  'list',
  'list-dashboard-modules',
  'list-balsa-program',
  'list-valid-numbers',
  'create-program',
  'save-draft',
  'test',
  'publish',
  'delete-program',
  'preview-program',
  'duplicate-program',
  'save-draw-source',
  'delete-draw-source',
  'generate-draw-source'
]);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders
  });
}

function supabaseUrl() {
  const value = String(
    Deno.env.get('SUPABASE_URL') || ''
  ).trim().replace(/\/+$/, '');

  if (!value) {
    throw new Error('Configuration Supabase serveur incomplète.');
  }

  return value;
}

function serviceClient() {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!key) {
    throw new Error('Clé serveur Supabase absente.');
  }

  return createClient(supabaseUrl(), key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function bearerToken(request: Request) {
  return request.headers
    .get('Authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim() || '';
}

async function verifyAdministrator(request: Request) {
  const token = bearerToken(request);

  if (!token) {
    return {
      token: '',
      error: 'Connexion administrateur requise.'
    };
  }

  const client = serviceClient();

  const session = await client.auth.getUser(token);

  if (session.error || !session.data?.user?.id) {
    return {
      token: '',
      error: 'Session administrateur invalide.'
    };
  }

  const role = await client
    .from('user_roles')
    .select('role')
    .eq('user_id', session.data.user.id)
    .in('role', ['admin', 'moderator'])
    .limit(1)
    .maybeSingle();

  let resolvedRole = String(role.data?.role || '');
  if (!['admin', 'moderator'].includes(resolvedRole)) {
    /*
     * Keep the principal account usable during the role-table migration.
     * This is still a server-side identity check; a normal authenticated
     * visitor cannot satisfy it.
     */
    try {
      const principal = await client
        .from('admin_control_settings')
        .select('principal_user_id')
        .eq('id', true)
        .maybeSingle();
      if (!principal.error
        && principal.data?.principal_user_id === session.data.user.id) {
        resolvedRole = 'admin';
      }
    } catch (_) { /* user_roles remains authoritative on older schemas */ }
  }

  if (!['admin', 'moderator'].includes(resolvedRole)) {
    return {
      token: '',
      error: 'Accès administrateur refusé.'
    };
  }

  return {
    token,
    error: ''
  };
}

function internalHeaders(request: Request, token: string) {
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  });

  /*
   * La clé publique peut être nécessaire pour les appels internes entre
   * fonctions Supabase. La clé service_role n'est jamais transmise au client.
   */
  const projectKey =
    Deno.env.get('SUPABASE_ANON_KEY')
    || Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
    || request.headers.get('apikey')
    || '';

  if (projectKey) {
    headers.set('apikey', projectKey);
  }

  return headers;
}

async function forwardToSecureController(
  request: Request,
  token: string,
  body: Record<string, unknown>
) {
  const response = await fetch(
    `${supabaseUrl()}/functions/v1/admin-method-control`,
    {
      method: 'POST',
      headers: internalHeaders(request, token),
      body: JSON.stringify(body)
    }
  );

  const text = await response.text();

  const contentType = response.headers.get('content-type')
    || 'application/json; charset=utf-8';

  return new Response(text, {
    status: response.status,
    headers: {
      ...corsHeaders,
      'Content-Type': contentType
    }
  });
}

async function handler(request: Request) {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }

  if (request.method !== 'POST') {
    return json({
      error: 'Méthode non autorisée.'
    }, 405);
  }

  let body: Record<string, unknown>;

  try {
    const parsed = await request.json();

    if (
      !parsed
      || typeof parsed !== 'object'
      || Array.isArray(parsed)
    ) {
      return json({
        error: 'Le corps doit être un objet JSON.'
      }, 400);
    }

    body = parsed as Record<string, unknown>;
  } catch (_) {
    return json({
      error: 'Le corps de la requête doit être un JSON valide.'
    }, 400);
  }

  const action = String(
    body.action || 'list'
  ).trim().toLowerCase();

  if (!PROGRAM_ACTIONS.has(action)) {
    return json({
      error:
        'Cette fonction est réservée aux méthodes, matrices et programmes.'
    }, 403);
  }

  try {
    const auth = await verifyAdministrator(request);

    if (auth.error) {
      return json({
        error: auth.error
      }, 403);
    }

    /*
     * Le contrôleur sécurisé existant effectue également le contrôle
     * détaillé des permissions : programs.read, programs.write,
     * programs.publish et draws.write.
     */
    return await forwardToSecureController(
      request,
      auth.token,
      {
        ...body,
        action
      }
    );
  } catch (error) {
    console.error('admin-program-control failed', error);

    return json({
      error:
        'Le contrôle des programmes administrateur est indisponible.'
    }, 500);
  }
}

Deno.serve(handler);
