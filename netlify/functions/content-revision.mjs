/*
 * Cross-device "administrator changed something" signal.
 *
 * Administrator writes (keys, crosses, matrices, results, configuration) go
 * through Supabase Edge Functions, and the browser events they dispatch only
 * reach the administrator's own tab. Every other phone kept its localStorage
 * copy until the next 16:00 UTC publication.
 *
 * This endpoint stores one tiny revision stamp in Netlify Blobs:
 *
 *   GET  /content-revision  -> { revision, updatedAt, scopes, deploy }   (public)
 *   POST /content-revision  -> bumps one scope { scope }         (admin only)
 *
 * `scopes` keeps the last revision of each kind of change, so a client that
 * missed several bumps still learns every kind that moved:
 *   - config      plans, prices, locks, banners, payment, comments
 *   - publication programmes, keys, crosses, matrices, draw sources
 *   - results     published draw results
 *
 * Clients compare the stamp with the one they last saw and, when it moved,
 * refetch their data in the background (src/shared/content-sync.js). The
 * stamp carries no content; Supabase stays the only source of data.
 *
 * `deploy` is the id of the deploy serving the request. The installed PWA
 * compares it with the one it started on to notice a new deployment
 * (src/shared/pwa-register.js).
 */

import { getStore } from '@netlify/blobs';

const STORE = 'content-revision';
const KEY = 'current';
const SCOPES = new Set(['config', 'publication', 'results']);

// Public browser configuration (same values as src/auth/supabase-config.js).
// The publishable key is public by design; RLS remains the security boundary.
const SUPABASE_URL = String(
  process.env.CIDMAP_SUPABASE_URL || process.env.SUPABASE_URL
    || 'https://vgebpqzyawnoezgarmfn.supabase.co'
).replace(/\/+$/, '');
const SUPABASE_PUBLISHABLE_KEY = String(
  process.env.CIDMAP_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
    || 'sb_publishable_W55jL4xLKmxITLe_sZP9XQ_AXhQWjMb'
);

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

// A bump must be visible to the next read from any region.
const store = () => getStore({ name: STORE, consistency: 'strong' });

async function readRevision() {
  const current = await store().get(KEY, { type: 'json' });
  const scopes = {};
  SCOPES.forEach((scope) => {
    const revision = Number(current?.scopes?.[scope]);
    if (revision > 0) scopes[scope] = revision;
  });
  return {
    revision: Number(current?.revision) || 0,
    updatedAt: Number(current?.updatedAt) || 0,
    scopes
  };
}

/*
 * The caller's Supabase access token is checked against Supabase itself:
 * first the user behind the token, then the `has_role` helper the account
 * view already uses (falling back to the caller's own `user_roles` row),
 * always evaluated with that same token.
 */
async function isAdministrator(authorization) {
  const token = String(authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  const headers = {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    authorization: `Bearer ${token}`,
    'content-type': 'application/json'
  };
  try {
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers });
    if (!userResponse.ok) return false;
    const user = await userResponse.json();
    if (!user?.id) return false;
    const roleResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/has_role`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ requested_user_id: user.id, requested_role: 'admin' })
    });
    if (roleResponse.ok && (await roleResponse.json()) === true) return true;
    // Same fallback as the account view: RLS lets a user read their own role.
    const rowsResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/user_roles?select=role&role=eq.admin&user_id=eq.${encodeURIComponent(user.id)}`,
      { headers }
    );
    if (!rowsResponse.ok) return false;
    const rows = await rowsResponse.json();
    return Array.isArray(rows) && rows.some((row) => row?.role === 'admin');
  } catch (_) {
    return false;
  }
}

export default async (req, context) => {
  const deploy = String(context?.deploy?.id || process.env.DEPLOY_ID || '');
  if (req.method === 'GET') return json({ ...await readRevision(), deploy });

  if (!await isAdministrator(req.headers.get('authorization'))) {
    return json({ error: 'Accès administrateur requis.' }, 403);
  }
  let scope = 'config';
  try {
    const body = await req.json();
    const requested = String(body?.scope || '').trim().toLowerCase();
    if (SCOPES.has(requested)) scope = requested;
  } catch (_) {}

  const previous = await readRevision();
  // Monotonic even if two administrators save in the same millisecond.
  const revision = Math.max(Date.now(), previous.revision + 1);
  const next = {
    revision,
    updatedAt: Date.now(),
    scopes: { ...previous.scopes, [scope]: revision }
  };
  await store().setJSON(KEY, next);
  return json({ ...next, deploy });
};

export const config = {
  path: '/content-revision',
  method: ['GET', 'POST'],
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
