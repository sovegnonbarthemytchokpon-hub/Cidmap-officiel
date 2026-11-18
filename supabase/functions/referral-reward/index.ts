import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Configuration Supabase serveur incomplète.');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function authenticatedUser(request: Request) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const client = adminClient();
  const result = await client.auth.getUser(token);
  if (result.error || !result.data.user) return null;
  return { client, user: result.data.user };
}

function code(value: unknown) {
  const result = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9_-]{3,40}$/.test(result) ? result : '';
}

const DEFAULT_REWARD_SETTINGS = {
  enabled: true,
  share_reward_stars: 0,
  share_reward_tokens: 0,
  signup_reward_stars: 0,
  signup_reward_tokens: 0,
  unlock_reward_stars: 0,
  unlock_reward_tokens: 0,
  max_share_rewards_per_day: 10
};

async function rewardSettings(client: any) {
  const result = await client.from('referral_reward_settings')
    .select('enabled,share_reward_stars,share_reward_tokens,signup_reward_stars,signup_reward_tokens,unlock_reward_stars,unlock_reward_tokens,max_share_rewards_per_day')
    .eq('id', true)
    .maybeSingle();
  if (result.error && /referral_reward_settings|relation .* does not exist|schema cache/i
    .test(String(result.error.message || ''))) {
    return { ...DEFAULT_REWARD_SETTINGS };
  }
  if (result.error) throw result.error;
  return { ...DEFAULT_REWARD_SETTINGS, ...(result.data || {}) };
}

function rewardResult(stars: number, tokens: number, extra: Record<string, unknown> = {}) {
  const safeStars = Math.max(0, Number(stars) || 0);
  const safeTokens = Math.max(0, Number(tokens) || 0);
  const currency = safeStars > 0 && safeTokens > 0
    ? 'both'
    : safeTokens > 0 ? 'tokens' : 'stars';
  return {
    ...extra,
    credited: safeStars > 0 || safeTokens > 0,
    amount: safeTokens > 0 ? safeTokens : safeStars,
    currency,
    rewards: { stars: safeStars, tokens: safeTokens }
  };
}

async function grantRewards(
  client: any,
  targetUserId: string,
  actorUserId: string,
  stars: number,
  tokens: number,
  note: string
) {
  const safeStars = Math.max(0, Number(stars) || 0);
  const safeTokens = Math.max(0, Number(tokens) || 0);
  if (safeStars < 1 && safeTokens < 1) {
    return rewardResult(0, 0, { reason: 'reward-disabled' });
  }
  const balance = await client.rpc('admin_grant_user_balance_with_audit', {
    target_user_id: targetUserId,
    stars_amount: safeStars,
    tokens_amount: safeTokens,
    source: 'adjustment',
    grant_note: note,
    proof: '',
    granted_by_user_id: actorUserId
  });
  if (!balance.error) {
    return rewardResult(safeStars, safeTokens, { balance: balance.data });
  }
  /*
   * Legacy installations have the original stars RPC but not the additive
   * balance/token RPC. Preserve the old autonomous flow when no token reward
   * was configured; never silently discard configured tokens.
   */
  if (safeTokens > 0) throw balance.error;
  const legacy = await client.rpc('admin_grant_user_stars_with_audit', {
    target_user_id: targetUserId,
    amount: safeStars,
    source: 'adjustment',
    grant_note: note,
    granted_by_user_id: actorUserId
  });
  if (legacy.error) throw legacy.error;
  return rewardResult(safeStars, 0, { referrerStars: legacy.data });
}

async function planRewards(client: any, planSlug: string) {
  const current = await client.from('subscription_plans')
    .select('referral_reward_stars,referral_reward_tokens')
    .eq('slug', planSlug)
    .eq('enabled', true)
    .maybeSingle();
  if (!current.error) {
    return {
      stars: Number(current.data?.referral_reward_stars) || 0,
      tokens: Number(current.data?.referral_reward_tokens) || 0
    };
  }
  if (!/referral_reward_tokens|column .* does not exist|schema cache/i
    .test(String(current.error.message || ''))) {
    const legacy = await client.from('subscription_plans')
      .select('referral_reward_stars')
      .eq('slug', planSlug)
      .eq('enabled', true)
      .maybeSingle();
    if (legacy.error) throw legacy.error;
    return { stars: Number(legacy.data?.referral_reward_stars) || 0, tokens: 0 };
  }
  throw current.error;
}

async function ensureAccount(client: any, userId: string, accountCode: string) {
  const existing = await client
    .from('referral_accounts')
    .select('user_id,referral_code,referred_by')
    .eq('user_id', userId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;

  const sameCode = await client
    .from('referral_accounts')
    .select('user_id,referral_code')
    .eq('referral_code', accountCode)
    .maybeSingle();
  if (sameCode.error) throw sameCode.error;
  if (sameCode.data && sameCode.data.user_id !== userId) {
    throw new Error('Ce lien de parrainage est déjà associé à un autre compte.');
  }

  /*
    Upsert plutôt qu'insert : deux appels « ensure » concurrents pour le même
    utilisateur (ex. double synchronisation à la connexion) passaient tous
    deux le SELECT ci-dessus puis se percutaient sur referral_accounts_pkey
    (23505). La clé naturelle de la ligne est user_id (l'id n'est jamais
    fourni par ce code), c'est donc elle qui sert de cible au conflit.
    ignoreDuplicates conserve la ligne existante (et son referred_by).
  */
  const upserted = await client
    .from('referral_accounts')
    .upsert(
      { user_id: userId, referral_code: accountCode },
      { onConflict: 'user_id', ignoreDuplicates: true }
    )
    .select('user_id,referral_code,referred_by')
    .maybeSingle();
  if (upserted.error && String(upserted.error.code) !== '23505') {
    throw upserted.error;
  }
  if (upserted.data) return upserted.data;

  // Ligne créée entre-temps par une requête concurrente : on la relit.
  const current = await client
    .from('referral_accounts')
    .select('user_id,referral_code,referred_by')
    .eq('user_id', userId)
    .maybeSingle();
  if (current.error) throw current.error;
  if (!current.data) throw upserted.error || new Error('Compte de parrainage introuvable.');
  return current.data;
}

async function registerReferral(client: any, userId: string, input: any) {
  const referrerCode = code(input.referrerCode);
  const accountCode = code(input.accountCode);
  if (!referrerCode || !accountCode || referrerCode === accountCode) {
    return { ok: true, credited: false, reason: 'invalid-or-self-referral' };
  }

  const account = await ensureAccount(client, userId, accountCode);
  /*
    Le premier parrain est définitif. Une même personne ne peut pas
    remplacer son parrain en revenant avec un second lien ; elle pourra
    toutefois partager son propre lien et inviter de nouvelles personnes.
  */
  if (account.referred_by) {
    return {
      ok: true,
      credited: false,
      duplicate: account.referred_by === referrerCode,
      reason: account.referred_by === referrerCode
        ? 'already-registered'
        : 'already-referred'
    };
  }
  const referrer = await client
    .from('referral_accounts')
    .select('user_id,referral_code')
    .eq('referral_code', referrerCode)
    .maybeSingle();
  if (referrer.error) throw referrer.error;
  if (!referrer.data?.user_id || referrer.data.user_id === userId) {
    return { ok: true, credited: false, reason: 'referrer-not-found' };
  }
  const linked = await client
    .from('referral_accounts')
    .update({ referred_by: referrerCode, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('referred_by', null)
    .select('user_id,referred_by')
    .maybeSingle();
  if (linked.error) throw linked.error;
  if (!linked.data) {
    return {
      ok: true,
      credited: false,
      duplicate: true,
      reason: 'already-referred'
    };
  }

  const eventKey = `signup:${referrerCode}:${accountCode}`;
  const event = await client
    .from('referral_events')
    .insert({
      user_id: userId,
      event_key: eventKey,
      event_type: 'signup',
      referrer_user_id: referrer.data.user_id
    })
    .select('id')
    .maybeSingle();
  if (event.error) {
    if (String(event.error.code) === '23505') {
      return { ok: true, credited: false, duplicate: true };
    }
    throw event.error;
  }

  const settings = await rewardSettings(client);
  if (settings.enabled === false
      || (Number(settings.signup_reward_stars) < 1
        && Number(settings.signup_reward_tokens) < 1)) {
    return {
      ok: true,
      referrerCode,
      credited: false,
      reason: 'signup-reward-disabled'
    };
  }
  const reward = await grantRewards(
    client,
    referrer.data.user_id,
    userId,
    Number(settings.signup_reward_stars) || 0,
    Number(settings.signup_reward_tokens) || 0,
    'Récompense d’affiliation après inscription confirmée du filleul.'
  );
  return {
    ok: true,
    referrerCode,
    ...reward,
    reason: reward.credited ? 'signup-rewarded' : 'signup-reward-disabled'
  };
}

async function shareReferral(client: any, userId: string, input: any) {
  const accountCode = code(input.accountCode);
  const channel = String(input.channel || 'unknown').trim().toLowerCase().slice(0, 40);
  const shareKey = String(input.shareKey || input.url || channel).trim().slice(0, 240);
  if (!accountCode || !shareKey) {
    return { ok: true, credited: false, reason: 'share-data-missing' };
  }
  const account = await ensureAccount(client, userId, accountCode);
  if (account.user_id !== userId || account.referral_code !== accountCode) {
    return { ok: true, credited: false, reason: 'account-mismatch' };
  }
  const settings = await rewardSettings(client);
  if (settings.enabled === false
      || (Number(settings.share_reward_stars) < 1
        && Number(settings.share_reward_tokens) < 1)) {
    return {
      ok: true,
      credited: false,
      reason: 'share-reward-disabled',
      channel
    };
  }
  const maxShares = Math.max(0, Number(settings.max_share_rewards_per_day) || 0);
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const todayShares = await client.from('referral_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('event_type', 'share')
    .gte('created_at', dayStart.toISOString());
  if (todayShares.error) throw todayShares.error;
  if (maxShares < 1 || Number(todayShares.count) >= maxShares) {
    return {
      ok: true,
      credited: false,
      reason: 'share-daily-limit',
      channel
    };
  }
  const eventKey = `share:${userId}:${channel}:${shareKey}`;
  const event = await client.from('referral_events')
    .insert({
      user_id: userId,
      event_key: eventKey,
      event_type: 'share',
      referrer_user_id: userId
    })
    .select('id')
    .maybeSingle();
  if (event.error) {
    if (String(event.error.code) === '23505') {
      return { ok: true, credited: false, duplicate: true };
    }
    throw event.error;
  }

  const reward = await grantRewards(
    client,
    userId,
    userId,
    Number(settings.share_reward_stars) || 0,
    Number(settings.share_reward_tokens) || 0,
    `Récompense après partage du lien de parrainage (${channel}).`
  );
  return {
    ok: true,
    ...reward,
    reason: reward.credited ? 'share-rewarded' : 'share-reward-disabled',
    channel
  };
}

async function conversionReferral(client: any, userId: string, input: any) {
  const account = await client
    .from('referral_accounts')
    .select('referral_code,referred_by')
    .eq('user_id', userId)
    .maybeSingle();
  if (account.error) throw account.error;
  const referrerCode = code(account.data?.referred_by || input.referrerCode);
  if (!referrerCode) return { ok: true, credited: false, reason: 'no-referrer' };

  const referrer = await client
    .from('referral_accounts')
    .select('user_id,referral_code')
    .eq('referral_code', referrerCode)
    .maybeSingle();
  if (referrer.error) throw referrer.error;
  if (!referrer.data?.user_id || referrer.data.user_id === userId) {
    return { ok: true, credited: false, reason: 'referrer-not-found' };
  }

  let requestedPlan = String(input.planSlug || '').trim().toLowerCase();
  if (!requestedPlan) {
    const active = await client.from('user_subscriptions')
      .select('plan_slug')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('expires_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (active.error) throw active.error;
    requestedPlan = String(active.data?.plan_slug || '').trim().toLowerCase();
  }
  const settings = await rewardSettings(client);
  const configuredPlan = requestedPlan
    ? await planRewards(client, requestedPlan)
    : { stars: 0, tokens: 0 };
  const configured = configuredPlan.stars > 0 || configuredPlan.tokens > 0
    ? configuredPlan
    : {
      stars: Number(settings.unlock_reward_stars) || 0,
      tokens: Number(settings.unlock_reward_tokens) || 0
    };
  const conversionId = String(input.conversionId || 'default').slice(0, 120);
  const eventKey = `conversion:${userId}:${conversionId}`;
  const event = await client
    .from('referral_events')
    .insert({
      user_id: userId,
      event_key: eventKey,
      event_type: 'conversion',
      referrer_user_id: referrer.data.user_id
    })
    .select('id')
    .maybeSingle();
  if (event.error) {
    if (String(event.error.code) === '23505') return { ok: true, credited: false, duplicate: true };
    throw event.error;
  }

  if (settings.enabled === false
      || (configured.stars < 1 && configured.tokens < 1)) {
    return { ok: true, credited: false, reason: 'plan-reward-disabled' };
  }
  const reward = await grantRewards(
    client,
    referrer.data.user_id,
    userId,
    configured.stars,
    configured.tokens,
    `Récompense d’affiliation après conversion validée${requestedPlan ? ` du niveau ${requestedPlan}` : ''}.`
  );
  return {
    ok: true,
    referrerCode,
    ...reward
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);

  const auth = await authenticatedUser(request);
  if (!auth) return json({ error: 'Connexion requise.' }, 401);
  let input: any = {};
  try {
    input = await request.json();
  } catch (_) {
    return json({ error: 'JSON invalide.' }, 400);
  }

  try {
    const action = String(input.action || 'ensure').toLowerCase();
    const accountCode = code(input.accountCode);
    if (!accountCode) return json({ error: 'Identifiant de parrainage invalide.' }, 400);
    if (action === 'ensure') {
      const account = await ensureAccount(auth.client, auth.user.id, accountCode);
      return json({ ok: true, account });
    }
    if (action === 'register') {
      return json(await registerReferral(auth.client, auth.user.id, input));
    }
    if (action === 'share') {
      return json(await shareReferral(auth.client, auth.user.id, input));
    }
    if (action === 'conversion') {
      return json(await conversionReferral(auth.client, auth.user.id, input));
    }
    return json({ error: 'Action de parrainage inconnue.' }, 400);
  } catch (error) {
    console.error('referral-reward failed', error);
    return json({ error: error instanceof Error ? error.message : 'Récompense indisponible.' }, 500);
  }
});
