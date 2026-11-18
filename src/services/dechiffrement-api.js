/*
 * Client boundary for the protected Déchiffrement Edge Function.
 *
 * The browser forwards the pasted values and receives the ten numbers
 * calculated by the autonomous server. It never reads a programme archive.
 */
(function exposeDechiffrementApi() {
  const REMOTE_TIMEOUT_MS = 12000;

  const remoteFailureStatus = (error) => Number(
    error?.context?.status || error?.status || error?.statusCode || 0
  );

  /*
   * supabase-js only reports "Edge Function returned a non-2xx status code".
   * The function answers with a JSON `{ error }` explaining what it expects
   * (number of values, missing Matrice…), so that message is shown instead.
   */
  const withServerMessage = async (error) => {
    const response = error?.context;
    if (!response || typeof response.clone !== 'function') return error;
    try {
      const body = await response.clone().json();
      const message = String(body?.error || body?.message || '').trim();
      if (!message) return error;
      const detailed = new Error(message);
      detailed.name = error.name || 'DechiffrementServerError';
      detailed.status = remoteFailureStatus(error);
      detailed.context = response;
      return detailed;
    } catch (_) {
      return error;
    }
  };

  window.invokeDechiffrement = async function invokeDechiffrement(payload = {}) {
    const bridge = await window.cidSupabaseReady;
    if (!bridge?.client?.functions?.invoke) {
      throw new Error('Supabase n’est pas configuré pour le déchiffrement.');
    }

    let data;
    let error;
    try {
      ({ data, error } = await Promise.race([
        bridge.client.functions.invoke('dechiffrement-mt', {
          body: payload
        }),
        new Promise((_, reject) => {
          window.setTimeout(() => {
            const timeout = new Error(
              'La fonction de déchiffrement ne répond pas actuellement.'
            );
            timeout.name = 'DechiffrementTimeoutError';
            reject(timeout);
          }, REMOTE_TIMEOUT_MS);
        })
      ]));
    } catch (remoteError) {
      if (String(payload?.action || '').trim().toLowerCase() === 'plus'
        || [401, 403].includes(remoteFailureStatus(remoteError))) {
        throw await withServerMessage(remoteError);
      }
      console.warn('Déchiffrement distant indisponible.', remoteError);
      throw await withServerMessage(remoteError);
    }
    if (error) {
      const status = remoteFailureStatus(error);
      if (String(payload?.action || '').trim().toLowerCase() === 'plus'
        || [401, 403].includes(status)) {
        throw await withServerMessage(error);
      }
      console.warn('Déchiffrement distant en erreur.', error);
      throw await withServerMessage(error);
    }
    const isPlus = String(payload?.action || '').trim().toLowerCase() === 'plus';
    const hasExpectedResult = isPlus ? data?.plus : data?.program;
    if (!data?.ok || !hasExpectedResult) {
      throw new Error(data?.error || 'Le serveur n’a pas trouvé de programme.');
    }
    return data;
  };
})();
