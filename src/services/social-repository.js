/*
 * Supabase repository for the public feed.
 *
 * There is deliberately no local/mock fallback here. Published comments and
 * counters are read from Supabase for anonymous visitors too; mutations
 * still require an authenticated session.
 */

/*
 * Read budget for the public feed.
 *
 * The home feed and the Croix archive paint up to two dozen cards, and each
 * card used to issue its own reads: two SELECTs for the like/share counters,
 * one RPC for the per-publication comment setting (twice, because
 * listComments re-checked it), one SELECT for the comments, one for the
 * authors and one for the comment likes. Rendering the feed therefore cost
 * roughly six queries per card, and it was re-rendered on every catalogue
 * revalidation.
 *
 * Per-id reads are now coalesced into a single `.in(...)` query per frame
 * through cidReadCache.batch(), and their results are cached for a short
 * window. Supabase stays authoritative: mutations and realtime events
 * invalidate the affected publication immediately (see invalidatePost and
 * subscribeToFeed below), so a counter is never served stale after a change.
 */
const METRICS_TTL_MS = 45 * 1000;
const COMMENTS_TTL_MS = 30 * 1000;
const COMMENT_SETTING_TTL_MS = 5 * 60 * 1000;
const COMMENT_METRICS_TTL_MS = 45 * 1000;
const PROFILE_TTL_MS = 12 * 60 * 60 * 1000;
const COMMENTS_PAGE_SIZE = 200;
const EMPTY_METRICS = Object.freeze({ likes: 0, shares: 0, liked: false });

const readCache = () => window.cidReadCache || null;

function uniqueIds(values, limit = 100) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
  )].slice(0, limit);
}

/*
 * Drop every cached read for one publication. Called after a like, a share
 * or a comment, and whenever Realtime reports a change, so the next paint
 * reads the real row instead of the cached counter.
 */
export function invalidatePost(drawId) {
  const key = String(drawId || '').trim();
  if (!key) return;
  const reader = readCache();
  reader?.invalidate?.(`social:metrics:${key}`);
  reader?.invalidate?.(`social:comments:${key}`);
}

async function getBridge() {
  const bridge = await window.cidSupabaseReady;
  if (!bridge?.client) throw new Error('Supabase est indisponible.');
  return bridge;
}

async function getUser(action = 'effectuer cette action') {
  const bridge = await getBridge();
  const user = await bridge.getUser().catch(() => null);
  if (!user) throw new Error(`Connectez-vous à votre compte Cidmap pour ${action}.`);
  return { bridge, user };
}

function isMissingRpc(error, functionName) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === 'PGRST202'
    || /schema cache|could not find the function|searched for the function/i.test(message)
    || (functionName && message.includes(functionName) && /function/i.test(message));
}

function normalizeComment(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    draw_id: String(row.draw_id || ''),
    parent_id: row.parent_id || null,
    comment_text: String(row.comment_text || ''),
    status: String(row.status || 'visible'),
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at
  };
}

function normalizePublicProfile(row) {
  if (!row?.id) return null;
  return {
    id: String(row.id),
    full_name: String(row.full_name || '').trim()
  };
}

async function resolvePublicProfiles(userIds) {
  const bridge = await getBridge();
  const { data, error } = await bridge.client
    .from('profiles')
    .select('id,full_name')
    .in('id', userIds);
  if (error) throw error;
  const resolved = new Map();
  (Array.isArray(data) ? data : [])
    .map(normalizePublicProfile)
    .filter(Boolean)
    .forEach((profile) => {
      resolved.set(profile.id, profile);
      readCache()?.write?.(`social:profile:${profile.id}`, profile, { scope: 'public' });
    });
  return resolved;
}

/*
 * A display name changes far less often than a feed repaints, so an already
 * resolved author is never queried again within the cache window and only
 * the genuinely unknown ids reach Postgres - in one grouped `.in(...)` read.
 */
export async function listPublicProfiles(userIds = []) {
  const ids = uniqueIds(userIds);
  const profiles = new Map();
  if (!ids.length) return profiles;

  const reader = readCache();
  const missing = [];
  ids.forEach((id) => {
    const cached = reader?.read?.(`social:profile:${id}`, {
      scope: 'public',
      maxAgeMs: PROFILE_TTL_MS
    });
    if (cached?.value) profiles.set(id, cached.value);
    else missing.push(id);
  });
  if (!missing.length) return profiles;

  try {
    const resolved = reader?.batch
      ? await reader.batch('social:profiles', missing, resolvePublicProfiles, {
        windowMs: 16,
        maxBatch: 100
      })
      : await resolvePublicProfiles(missing);
    resolved.forEach((profile, id) => profiles.set(id, profile));
  } catch (error) {
    // The public-profile migration is separate from the comment migration.
    // Keep comments readable if an older Supabase project has not run it yet.
    console.warn('Profils publics indisponibles', error);
  }
  return profiles;
}

export async function getPublicProfile(userId) {
  const profiles = await listPublicProfiles([userId]);
  return profiles.get(String(userId || '').trim()) || null;
}

async function resolveCommentMetrics(commentIds) {
  const bridge = await getBridge();
  const user = await bridge.getUser().catch(() => null);
  // `user_id` is only read when there is a session to compare it against;
  // an anonymous visitor needs the grouping key alone.
  const columns = user ? 'comment_id,user_id' : 'comment_id';
  const { data, error } = await bridge.client
    .from('comment_likes')
    .select(columns)
    .in('comment_id', commentIds);
  if (error) throw error;
  const resolved = new Map(commentIds.map((id) => [id, { likes: 0, liked: false }]));
  (Array.isArray(data) ? data : []).forEach((row) => {
    const current = resolved.get(String(row.comment_id || ''));
    if (!current) return;
    current.likes += 1;
    if (user && row.user_id === user.id) current.liked = true;
  });
  resolved.forEach((value, id) => {
    readCache()?.write?.(`social:comment-metrics:${id}`, value, { persist: false });
  });
  return resolved;
}

export async function listCommentMetrics(commentIds = []) {
  const ids = uniqueIds(commentIds);
  const metrics = new Map(ids.map((id) => [id, { likes: 0, liked: false }]));
  if (!ids.length) return metrics;

  const reader = readCache();
  const missing = [];
  ids.forEach((id) => {
    const cached = reader?.read?.(`social:comment-metrics:${id}`, {
      maxAgeMs: COMMENT_METRICS_TTL_MS,
      persist: false
    });
    if (cached?.value) metrics.set(id, cached.value);
    else missing.push(id);
  });
  if (!missing.length) return metrics;

  try {
    const resolved = reader?.batch
      ? await reader.batch('social:comment-metrics', missing, resolveCommentMetrics, {
        windowMs: 16,
        maxBatch: 100
      })
      : await resolveCommentMetrics(missing);
    resolved.forEach((value, id) => metrics.set(id, value));
  } catch (error) {
    // Older databases may not have the public comment-like policy yet.
    // Comments remain readable; counters simply stay at zero until migration.
    console.warn('Compteurs de likes des commentaires indisponibles', error);
  }
  return metrics;
}

export async function toggleCommentLike(commentId) {
  const { bridge, user } = await getUser('aimer ce commentaire');
  const id = String(commentId || '').trim();
  if (!id) throw new Error('Commentaire manquant.');

  const rpcResult = await bridge.client.rpc('toggle_comment_like', {
    target_comment_id: id
  });
  if (!rpcResult.error) {
    readCache()?.invalidate?.(`social:comment-metrics:${id}`);
    return Boolean(rpcResult.data);
  }

  if (!isMissingRpc(rpcResult.error, 'toggle_comment_like')) {
    throw normalizeSocialWriteError(rpcResult.error, 'like');
  }

  const existing = await bridge.client
    .from('comment_likes')
    .select('comment_id')
    .eq('comment_id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (existing.error) throw normalizeSocialWriteError(existing.error, 'like');

  if (existing.data) {
    const removed = await bridge.client
      .from('comment_likes')
      .delete()
      .eq('comment_id', id)
      .eq('user_id', user.id);
    if (removed.error) throw normalizeSocialWriteError(removed.error, 'like');
    readCache()?.invalidate?.(`social:comment-metrics:${id}`);
    return false;
  }

  const added = await bridge.client
    .from('comment_likes')
    .insert({ comment_id: id, user_id: user.id });
  if (added.error) throw normalizeSocialWriteError(added.error, 'like');
  readCache()?.invalidate?.(`social:comment-metrics:${id}`);
  return true;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeCroixGeneration(row) {
  if (!row?.programme_date) return null;
  return {
    id: row.id,
    programme_date: String(row.programme_date),
    generated_year: Number(row.generated_year) || 0,
    generated_month: Number(row.generated_month) || 0,
    scope_key: String(row.scope_key || ''),
    term: String(row.term || ''),
    removed_digits: parseJsonArray(row.removed_digits).map(String),
    visible_terminaison: String(row.visible_terminaison || ''),
    date_sum: Number(row.date_sum) || 0,
    date_digit_sum: Number(row.date_digit_sum) || 0,
    date_finishing_digit: Number(row.date_finishing_digit) || 0,
    assignment: parseJsonArray(row.assignment).map(String),
    alignments: row.alignments || {},
    signature: String(row.signature || ''),
    created_at: row.created_at || null
  };
}

let croixHistoryRefreshPromise = null;

async function getCroixCacheService() {
  try {
    return await import('/src/croix/redCrossService.js');
  } catch (_) {
    return null;
  }
}

async function refreshCroixGenerations(safeLimit, cacheService) {
  if (croixHistoryRefreshPromise) return croixHistoryRefreshPromise;
  croixHistoryRefreshPromise = (async () => {
    const bridge = await getBridge();
    const { data, error } = await bridge.client
      .from('croix_nationale_generations')
      .select([
        'id',
        'programme_date',
        'generated_year',
        'generated_month',
        'scope_key',
        'term',
        'removed_digits',
        'visible_terminaison',
        'date_sum',
        'date_digit_sum',
        'date_finishing_digit',
        'assignment',
        'alignments',
        'signature',
        'created_at'
      ].join(','))
      .order('programme_date', { ascending: false })
      .limit(safeLimit);
    if (error) throw error;
    const rows = (Array.isArray(data) ? data : [])
      .map(normalizeCroixGeneration)
      .filter(Boolean);
    cacheService?.cacheCroixGenerations?.(rows, undefined, safeLimit);
    window.dispatchEvent(new CustomEvent('cid:croix-history-updated', {
      detail: { rows }
    }));
    return rows;
  })().finally(() => {
    croixHistoryRefreshPromise = null;
  });
  return croixHistoryRefreshPromise;
}

export async function listCroixGenerations(limit = 31, { refreshStale = true } = {}) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 31));
  const cacheService = await getCroixCacheService();
  const cachedRows = cacheService?.getCachedCroixGenerations?.(safeLimit) || [];
  if (cachedRows.length) {
    // The cached rows paint every archive, including offline visits. When
    // online, refresh an old archive in the background from Supabase unless
    // the caller is a route transition that must stay entirely local.
    if (refreshStale
      && navigator.onLine !== false
      && !cacheService?.isCroixArchiveCacheFresh?.(safeLimit)) {
      void refreshCroixGenerations(safeLimit, cacheService)
        .catch((error) => console.warn('Actualisation de l’historique indisponible', error));
    }
    // A partial cache cannot satisfy the requested archive size. Keep the
    // local-first paint for the normal feed, but allow the repository to
    // complete it when the dedicated view does not already have all rows.
    if (cachedRows.length >= safeLimit || refreshStale) return cachedRows;
  }

  // No local archive exists yet: obtain the official rows before rendering.
  return refreshCroixGenerations(safeLimit, cacheService);
}

async function readComments(drawKey) {
  // Reading published comments is public when the administrator has enabled
  // the publication. Only creating a comment still requires authentication.
  const bridge = await getBridge();
  const { data, error } = await bridge.client
    .from('comments')
    .select('id,user_id,draw_id,parent_id,comment_text,status,created_at,updated_at')
    .eq('draw_id', drawKey)
    .order('created_at', { ascending: true })
    // A thread is rendered in full, but an unbounded SELECT on a popular
    // publication would grow without limit. Read a bounded page instead.
    .limit(COMMENTS_PAGE_SIZE);
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(normalizeComment);
}

export async function listComments(drawId) {
  const drawKey = String(drawId || '').trim();
  if (!drawKey || !(await getPublicationCommentsEnabled(drawKey))) {
    throw new Error('Les commentaires sont désactivés pour cette publication.');
  }
  const reader = readCache();
  const cacheKey = `social:comments:${drawKey}`;
  if (!reader?.swr) return readComments(drawKey);
  /*
   * A card is often mounted several times in a row (feed repaint, thread
   * expansion, realtime echo). Serve the thread from the short-lived cache
   * and let a single in-flight request cover the concurrent callers; any
   * write or realtime event invalidates this entry first.
   */
  return reader.swr(cacheKey, () => readComments(drawKey), {
    ttlMs: COMMENTS_TTL_MS,
    persist: false
  });
}

export async function getPublicationCommentsEnabled(drawId) {
  /*
   * Public read of the per-publication comment setting. A publication with no
   * override row (and any installation still waiting for
   * SUPABASE_COMMENT_CONTROL.sql) stays closed to comments by default.
   */
  const drawKey = String(drawId || '').trim();
  const drawType = drawKey.split(':', 1)[0];
  if (typeof window.cidContentControl?.commentsEnabled !== 'function'
      || window.cidContentControl.commentsEnabled(drawKey, drawType) !== true) {
    return false;
  }
  /*
   * The setting is administrator-managed, so it is read at most once per
   * publication per window instead of once per card mount - listComments
   * used to re-issue the very same RPC immediately after this call.
   * `cid:admin-config-updated` and a comment write both clear it.
   */
  const reader = readCache();
  const cacheKey = `social:comments-enabled:${drawKey}`;
  const cached = reader?.read?.(cacheKey, {
    scope: 'public',
    maxAgeMs: COMMENT_SETTING_TTL_MS
  });
  if (cached) return cached.value === true;
  const request = async () => {
    try {
      const bridge = await getBridge();
      const { data, error } = await bridge.client
        .rpc('is_publication_comments_enabled', {
          target_draw_id: drawKey
        });
      if (error) return false;
      return data === true;
    } catch (_) {
      return false;
    }
  };
  const enabled = reader?.dedupe
    ? await reader.dedupe(cacheKey, request, { scope: 'public' })
    : await request();
  reader?.write?.(cacheKey, enabled === true, { scope: 'public' });
  return enabled === true;
}

export async function createComment({ drawId, text, parentId = null }) {
  const drawKey = String(drawId || '').trim();
  const commentText = String(text || '').trim();
  if (!drawKey) throw new Error('Identifiant de publication manquant.');
  if (!commentText) throw new Error('Écrivez un commentaire.');
  const drawType = drawKey.split(':', 1)[0];
  if (typeof window.cidContentControl?.commentsEnabled !== 'function'
      || window.cidContentControl.commentsEnabled(drawKey, drawType) !== true) {
    throw new Error('Les commentaires sont désactivés pour cette publication.');
  }
  if (!(await getPublicationCommentsEnabled(drawKey))) {
    throw new Error('Les commentaires sont désactivés pour cette publication.');
  }
  const { bridge, user } = await getUser('publier un commentaire');

  // Prefer the SECURITY DEFINER RPC. It validates auth.uid() inside
  // Supabase, writes a visible comment atomically, and avoids depending on
  // every older client-side INSERT policy being identical.
  const rpcResult = await bridge.client.rpc('create_public_comment', {
    target_draw_id: drawKey,
    target_comment_text: commentText,
    target_parent_id: parentId || null
  });
  if (!rpcResult.error) {
    const row = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data;
    invalidatePost(drawKey);
    return normalizeComment(row);
  }

  // Keep compatibility with installations that have not run the hotfix yet.
  // The explicit visible status also prevents an INSERT ... RETURNING row
  // from being hidden by a stale "pending" default policy.
  if (!isMissingRpc(rpcResult.error, 'create_public_comment')) {
    throw normalizeSocialWriteError(rpcResult.error, 'commentaire');
  }

  const { data, error } = await bridge.client
    .from('comments')
    .insert({
      user_id: user.id,
      draw_id: drawKey,
      parent_id: parentId || null,
      comment_text: commentText,
      status: 'visible'
    })
    .select('id,user_id,draw_id,parent_id,comment_text,status,created_at,updated_at')
    .single();
  if (error) throw normalizeSocialWriteError(error, 'commentaire');
  invalidatePost(drawKey);
  return normalizeComment(data);
}

async function resolvePostMetrics(drawIds) {
  // Public counters can be read by visitors; the like/share mutations below
  // continue to require authentication.
  const bridge = await getBridge();
  const user = await bridge.getUser().catch(() => null);
  // `draw_id` is the grouping key for the batched read; `user_id` is only
  // requested when there is a session whose like state has to be resolved.
  const likesColumns = user ? 'draw_id,user_id' : 'draw_id';
  const [likesResult, sharesResult] = await Promise.all([
    bridge.client.from('post_likes').select(likesColumns).in('draw_id', drawIds),
    bridge.client.from('post_shares').select('draw_id').in('draw_id', drawIds)
  ]);
  if (likesResult.error) throw likesResult.error;
  if (sharesResult.error) throw sharesResult.error;

  const resolved = new Map(
    drawIds.map((id) => [id, { likes: 0, shares: 0, liked: false }])
  );
  (Array.isArray(likesResult.data) ? likesResult.data : []).forEach((row) => {
    const current = resolved.get(String(row.draw_id || ''));
    if (!current) return;
    current.likes += 1;
    if (user && row.user_id === user.id) current.liked = true;
  });
  (Array.isArray(sharesResult.data) ? sharesResult.data : []).forEach((row) => {
    const current = resolved.get(String(row.draw_id || ''));
    if (current) current.shares += 1;
  });
  resolved.forEach((value, id) => {
    readCache()?.write?.(`social:metrics:${id}`, value, { persist: false });
  });
  return resolved;
}

/*
 * Counters for several publications at once. Everything the feed paints in
 * the same frame ends up in one pair of `.in(...)` queries.
 */
export async function listPostMetrics(drawIds = []) {
  const ids = uniqueIds(drawIds);
  const metrics = new Map();
  if (!ids.length) return metrics;

  const reader = readCache();
  const missing = [];
  ids.forEach((id) => {
    const cached = reader?.read?.(`social:metrics:${id}`, {
      maxAgeMs: METRICS_TTL_MS,
      persist: false
    });
    if (cached?.value) metrics.set(id, cached.value);
    else missing.push(id);
  });
  if (!missing.length) return metrics;

  const resolved = reader?.batch
    ? await reader.batch('social:post-metrics', missing, resolvePostMetrics, {
      windowMs: 16,
      maxBatch: 60
    })
    : await resolvePostMetrics(missing);
  resolved.forEach((value, id) => metrics.set(id, value));
  return metrics;
}

export async function getPostMetrics(drawId) {
  const key = String(drawId || '').trim();
  if (!key) return { ...EMPTY_METRICS };
  // Callers stay per-card; the batching window above turns those calls into
  // a single grouped read without every caller having to know about it.
  const metrics = await listPostMetrics([key]);
  return metrics.get(key) || { ...EMPTY_METRICS };
}

/*
 * A rapid double tap used to send two toggles (like, then unlike), so the
 * counter ended where it started. Taps on the same publication while a
 * toggle is in flight now share that request's answer.
 */
const pendingPostLikes = new Map();

export function togglePostLike(drawId) {
  const key = String(drawId || '').trim();
  if (!key) return Promise.reject(new Error('Identifiant de publication manquant.'));
  const inFlight = pendingPostLikes.get(key);
  if (inFlight) return inFlight;
  const request = performPostLikeToggle(key).finally(() => {
    pendingPostLikes.delete(key);
  });
  pendingPostLikes.set(key, request);
  return request;
}

async function performPostLikeToggle(key) {
  const { bridge, user } = await getUser('aimer cette publication');

  const { data, error } = await bridge.client.rpc('toggle_post_like', {
    target_draw_id: key
  });
  if (!error) {
    invalidatePost(key);
    return Boolean(data);
  }

  // Older deployments may have the tables and RLS policies but not yet the
  // SECURITY DEFINER RPC in PostgREST's schema cache. Keep likes usable while
  // the SQL migration is being refreshed; the RPC remains the preferred path
  // because it is atomic and also creates notifications.
  if (!isMissingRpc(error, 'toggle_post_like')) {
    throw normalizeSocialWriteError(error, 'like');
  }

  const existing = await bridge.client
    .from('post_likes')
    .select('draw_id')
    .eq('draw_id', key)
    .eq('user_id', user.id)
    .maybeSingle();
  if (existing.error) throw normalizeSocialWriteError(existing.error, 'like');

  if (existing.data) {
    const removed = await bridge.client
      .from('post_likes')
      .delete()
      .eq('draw_id', key)
      .eq('user_id', user.id);
    if (removed.error) throw normalizeSocialWriteError(removed.error, 'like');
    invalidatePost(key);
    return false;
  }

  const added = await bridge.client
    .from('post_likes')
    .insert({ draw_id: key, user_id: user.id });
  if (added.error) throw normalizeSocialWriteError(added.error, 'like');
  invalidatePost(key);
  return true;
}

function normalizeSocialWriteError(error, entity) {
  const message = String(error?.message || '');
  if (/connexion requise|not authenticated|jwt|auth session missing/i.test(message)) {
    const action = entity === 'like'
      ? 'aimer cette publication'
      : entity === 'commentaire'
        ? 'publier un commentaire'
        : 'effectuer cette action';
    return new Error(`Connectez-vous à votre compte Cidmap pour ${action}.`);
  }
  if (/row-level security|permission denied|violates.*policy/i.test(message)) {
    return new Error(
      `La base sociale refuse ce ${entity}. Exécutez la migration SUPABASE_SOCIAL_HOTFIX.sql dans Supabase.`
    );
  }
  return error;
}

export async function recordPostShare(drawId, channel = 'unknown') {
  const { bridge } = await getUser('partager cette publication');
  const { data, error } = await bridge.client.rpc('record_post_share', {
    target_draw_id: String(drawId),
    target_channel: String(channel || 'unknown')
  });
  if (error) throw error;
  invalidatePost(drawId);
  return Number(data) || 0;
}

export async function recordCoreCalculation(feature, programmeDate, payload = {}) {
  const { bridge } = await getUser('enregistrer ce calcul');
  const { data, error } = await bridge.client.rpc('record_core_calculation', {
    feature_name: String(feature),
    target_programme_date: programmeDate || null,
    calculation_payload: payload
  });
  if (error) throw error;
  return data;
}

/*
 * Apply a like/share realtime event to the cached counters of its
 * publication. Returns the updated metrics, or null when there is no cached
 * base to apply the delta to (the caller then falls back to a re-read).
 *
 * Realtime is broadcast to every open tab: re-reading the counters on each
 * event turned one like into two SELECTs per connected visitor. The event
 * already says what changed, so the counter is adjusted in place.
 */
function applyMetricsDelta(table, payload, drawId) {
  const reader = readCache();
  if (!reader?.read || !reader?.write) return null;
  const type = String(payload?.eventType || '').toUpperCase();
  const delta = type === 'INSERT' ? 1 : type === 'DELETE' ? -1 : 0;
  if (!delta) return null;
  const key = `social:metrics:${drawId}`;
  const cached = reader.read(key, { maxAgeMs: Infinity, persist: false });
  if (!cached?.value) return null;
  const next = { ...EMPTY_METRICS, ...cached.value };
  if (table === 'post_likes') {
    const row = payload?.new || payload?.old || {};
    const me = String(window.cidAuthCurrentUserId || '');
    const isMine = Boolean(me) && String(row.user_id || '') === me;
    // The visitor's own like is often already counted: the re-read after
    // togglePostLike can land before its realtime echo. Adding the delta
    // again counted one tap twice, so an echo matching the cached state is
    // ignored.
    if (isMine && next.liked === (delta > 0)) return next;
    next.likes = Math.max(0, Number(next.likes || 0) + delta);
    if (isMine) next.liked = delta > 0;
  } else {
    next.shares = Math.max(0, Number(next.shares || 0) + delta);
  }
  reader.write(key, next, { persist: false });
  return next;
}

/*
 * One realtime channel is shared by every subscriber (home feed, Déchiffrement
 * MT…). Supabase returns the already-joined channel when the same topic is
 * requested twice, so a second subscriber used to fail silently and its
 * section never saw a like. Sharing the relay also applies each like/share
 * delta to the cached counters exactly once, whatever the number of
 * listeners.
 */
const feedListeners = new Set();
let feedChannelPromise = null;

async function openFeedChannel() {
  // Keep the real-time feed available to anonymous visitors too. RLS still
  // decides which rows may be delivered; posting remains authenticated.
  const bridge = await getBridge();
  const dispatch = (event) => {
    feedListeners.forEach((listener) => {
      Promise.resolve()
        .then(() => listener(event))
        .catch((error) => console.warn('Abonné temps réel en erreur', error));
    });
  };
  /*
   * Realtime is the change signal for the cached counters. Like/share events
   * are applied to the cached counters directly (no read). Anything else
   * drops the affected publication before the UI handler runs, so the
   * repaint it triggers reads the new row rather than the cached entry.
   */
  const relay = (table) => (payload) => {
    const row = payload?.new || payload?.old || null;
    const drawId = String(row?.draw_id || '').trim();
    if (drawId && (table === 'post_likes' || table === 'post_shares')) {
      const metrics = applyMetricsDelta(table, payload, drawId);
      if (metrics) {
        dispatch({ table, payload, metrics });
        return;
      }
    }
    invalidatePost(row?.draw_id);
    if (row?.comment_id) {
      readCache()?.invalidate?.(`social:comment-metrics:${String(row.comment_id)}`);
    }
    dispatch({ table, payload });
  };
  const channel = bridge.client
    .channel('cid-feed-public')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'comments' },
      relay('comments')
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'post_likes' },
      relay('post_likes')
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'post_shares' },
      relay('post_shares')
    );
  await channel.subscribe();
  return { bridge, channel };
}

export async function subscribeToFeed(callback) {
  if (typeof callback !== 'function') return () => {};
  if (!feedChannelPromise) {
    feedChannelPromise = openFeedChannel().catch((error) => {
      feedChannelPromise = null;
      throw error;
    });
  }
  await feedChannelPromise;
  feedListeners.add(callback);
  return () => {
    feedListeners.delete(callback);
    if (feedListeners.size || !feedChannelPromise) return;
    const closing = feedChannelPromise;
    feedChannelPromise = null;
    closing
      .then(({ bridge, channel }) => bridge.client.removeChannel(channel))
      .catch(() => {});
  };
}

/*
 * An administrator toggling comments must take effect without waiting for
 * the setting TTL to lapse.
 */
window.addEventListener('cid:admin-config-updated', () => {
  readCache()?.clearScope?.('public');
});

window.cidSocialRepository = Object.freeze({
  createComment,
  getPublicProfile,
  getPostMetrics,
  getPublicationCommentsEnabled,
  invalidatePost,
  listCommentMetrics,
  listPostMetrics,
  listPublicProfiles,
  listCroixGenerations,
  listComments,
  recordCoreCalculation,
  recordPostShare,
  subscribeToFeed,
  toggleCommentLike,
  togglePostLike
});
