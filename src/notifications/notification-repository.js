/*
 * Supabase notification repository.
 *
 * Notifications are private rows addressed to auth.uid(). The browser never
 * fabricates notifications and never writes a recipient id; database
 * triggers/RPCs own creation and RLS owns access.
 */
(function initCidNotificationRepository() {
  'use strict';

  let realtimeChannel = null;
  let realtimeCleanup = null;

  /*
   * Notification rows accumulate for the lifetime of an account, so the
   * panel reads a bounded page instead of the whole personal history. The
   * short cache window absorbs the duplicate refreshes fired when the page
   * boots and the session syncs in the same instant; every write and every
   * realtime event below drops it, so the badge is never stale.
   */
  const LIST_PAGE_SIZE = 50;
  const LIST_TTL_MS = 20 * 1000;
  const ADMIN_TTL_MS = 10 * 60 * 1000;
  const LIST_CACHE_KEY = 'notifications:list';
  const ADMIN_CACHE_KEY = 'notifications:admin-recipient';
  const readCache = () => window.cidReadCache || null;

  function invalidateList() {
    readCache()?.invalidate?.(LIST_CACHE_KEY);
  }

  async function getBridgeAndUser() {
    const bridge = await window.cidSupabaseReady;
    if (!bridge?.client) throw new Error('Supabase est indisponible.');
    const user = await bridge.getUser();
    if (!user) throw new Error('Connexion requise.');
    return { bridge, user };
  }

  function normalize(row) {
    return {
      id: row.id,
      type: String(row.type || 'INFO').toUpperCase(),
      title: String(row.title || ''),
      message: String(row.message || ''),
      actor_id: row.actor_id || null,
      conversation_id: row.conversation_id || null,
      post_id: row.post_id || null,
      comment_id: row.comment_id || null,
      is_read: Boolean(row.is_read),
      read_at: row.read_at || null,
      created_at: row.created_at
    };
  }

  async function readList() {
    const { bridge, user } = await getBridgeAndUser();
    const { data, error } = await bridge.client
      .from('notifications')
      .select('id,user_id,actor_id,conversation_id,type,title,message,post_id,comment_id,is_read,read_at,created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(LIST_PAGE_SIZE);
    if (error) throw error;
    return (Array.isArray(data) ? data : []).map(normalize);
  }

  async function list() {
    const reader = readCache();
    if (!reader?.swr) return readList();
    return reader.swr(LIST_CACHE_KEY, readList, {
      ttlMs: LIST_TTL_MS,
      persist: false
    });
  }

  async function markRead(id) {
    const { bridge, user } = await getBridgeAndUser();
    const { error } = await bridge.client
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) throw error;
    invalidateList();
  }

  async function markAllRead() {
    const { bridge, user } = await getBridgeAndUser();
    const { error } = await bridge.client
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('is_read', false);
    if (error) throw error;
    invalidateList();
  }

  async function readAdminRecipient() {
    try {
      const { bridge, user } = await getBridgeAndUser();
      const { data, error } = await bridge.client
        .from('notification_admins')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) return false;
      return Boolean(data?.user_id);
    } catch (_) {
      return false;
    }
  }

  /*
   * Recipient membership is granted by an administrator and is scoped to the
   * signed-in account, so it is read once per session window rather than on
   * every panel initialization. The realtime handler below drops it as soon
   * as notification_admins actually changes.
   */
  async function isAdminRecipient() {
    const reader = readCache();
    if (!reader?.read) return readAdminRecipient();
    const cached = reader.read(ADMIN_CACHE_KEY, { maxAgeMs: ADMIN_TTL_MS });
    if (cached) return cached.value === true;
    const value = await (reader.dedupe
      ? reader.dedupe(ADMIN_CACHE_KEY, readAdminRecipient)
      : readAdminRecipient());
    reader.write?.(ADMIN_CACHE_KEY, value === true);
    return value === true;
  }

  async function subscribe(callback) {
    if (typeof callback !== 'function') return () => {};
    const { bridge, user } = await getBridgeAndUser();
    if (realtimeChannel) {
      bridge.client.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    realtimeCleanup?.();
    realtimeCleanup = null;

    realtimeChannel = bridge.client
      .channel(`cid-notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          // Realtime is the change signal for the cached page above.
          invalidateList();
          callback({ table: 'notifications', payload });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notification_admins' },
        (payload) => {
          readCache()?.invalidate?.(ADMIN_CACHE_KEY);
          callback({ table: 'notification_admins', payload });
        }
      );

    const result = await realtimeChannel.subscribe();
    if (result === 'CHANNEL_ERROR' || result === 'TIMED_OUT') {
      throw new Error('Le temps réel des notifications est indisponible.');
    }

    realtimeCleanup = () => {
      if (realtimeChannel) bridge.client.removeChannel(realtimeChannel);
      realtimeChannel = null;
    };
    return realtimeCleanup;
  }

  window.cidNotificationRepository = Object.freeze({
    list,
    markRead,
    markAllRead,
    isAdminRecipient,
    subscribe
  });
})();
