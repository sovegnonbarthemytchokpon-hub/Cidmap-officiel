/*
 * Netlify API bridge.
 *
 * Netlify serves the public frontend, while the existing server.js Worker
 * remains the authoritative backend. Set CIDMAP_BACKEND_URL in Netlify to the
 * deployed Cloudflare Worker URL. No secret is stored in this file.
 */

const FORWARDED_HEADERS = [
  'accept',
  'authorization',
  'content-type',
  'cookie',
  'x-cidmap-locale'
];

function backendUrl(event) {
  const configured = String(process.env.CIDMAP_BACKEND_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (!configured) return '';

  const rawPath = String(event.path || '')
    .replace(/^\/\.netlify\/functions\/api/, '')
    .replace(/^\/api(?=\/|$)/, '');
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const query = String(event.rawQuery || '').trim();
  return `${configured}/api${path}${query ? `?${query}` : ''}`;
}

function requestHeaders(event) {
  const headers = {};
  const incoming = event.headers || {};
  FORWARDED_HEADERS.forEach((name) => {
    const value = incoming[name] || incoming[name.toLowerCase()];
    if (value) headers[name] = value;
  });
  return headers;
}

function requestBody(event) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(String(event.httpMethod || '').toUpperCase())) {
    return undefined;
  }
  if (!event.body) return undefined;
  return event.isBase64Encoded
    ? Buffer.from(event.body, 'base64')
    : event.body;
}

exports.handler = async (event) => {
  const target = backendUrl(event);
  if (!target) {
    return {
      statusCode: 503,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        error: 'Le backend CIDMAP n’est pas encore configuré sur Netlify.'
      })
    };
  }

  try {
    const response = await fetch(target, {
      method: event.httpMethod || 'GET',
      headers: requestHeaders(event),
      body: requestBody(event),
      redirect: 'manual'
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const headers = {};
    ['content-type', 'cache-control', 'location', 'set-cookie'].forEach((name) => {
      const value = response.headers.get(name);
      if (value) headers[name] = value;
    });
    return {
      statusCode: response.status,
      headers,
      isBase64Encoded: true,
      body: bytes.toString('base64')
    };
  } catch (error) {
    console.error('CIDMAP Netlify API bridge failed', error);
    return {
      statusCode: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        error: 'Le backend CIDMAP est momentanément indisponible.'
      })
    };
  }
};
