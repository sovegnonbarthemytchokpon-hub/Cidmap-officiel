/*
 * Share-time picture of a table.
 *
 * Social crawlers never run the app, so they cannot see the numbers of the
 * day. When a table is shared, this module photographs the table exactly as
 * displayed, uploads it (netlify/functions/share-snapshot-upload.mjs) and
 * adds `?shot=<slug>.<id>` to the shared link. The edge function
 * netlify/edge-functions/share-preview.ts then serves that picture as
 * og:image. The id is known before the upload finishes, so the native share
 * sheet opens right away. Until the picture lands, the image route falls
 * back to the static card of the table.
 *
 * The picture is drawn by the browser itself (modern-screenshot renders the
 * table through an SVG foreignObject), so it matches the screen exactly:
 * html2canvas re-implements CSS and breaks the Croix (vertical
 * "Terminaison" text, rotated blocks, stroked digits). html2canvas is only
 * kept as a fallback when the native renderer fails.
 */

const MODERN_SCREENSHOT_SRC = 'https://cdn.jsdelivr.net/npm/modern-screenshot@4.7.0/dist/index.mjs';
const HTML2CANVAS_SRC = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
const WIDTH = 1200;
const HEIGHT = 630;
const PADDING = 28;
const MAX_BYTES = 850 * 1024;

// App identifiers (feed types, feature keys) → preview slug of the table.
const SLUGS = {
  cross: 'croix-nationale',
  matrix: 'matrice',
  rejected: 'boules-rejetees',
  'tableaux-universelle': 'cle-universelle',
  'tableaux-intuition': 'intuition',
  'tableaux-oracle': 'oracle',
  'tableaux-lnb': 'lnb',
  'tableaux-balsa': 'balsa-plus',
  'tableaux-standby': 'stand-by'
};

export function shareSlugFor(value) {
  const key = String(value || '').trim().toLowerCase();
  return SLUGS[key] || key;
}

// Same table, same content → same picture and id for the whole session.
const snapshots = new Map();
let html2canvasPromise = null;
let modernScreenshotPromise = null;

function loadModernScreenshot() {
  modernScreenshotPromise ||= import(MODERN_SCREENSHOT_SRC).catch((error) => {
    modernScreenshotPromise = null;
    throw error;
  });
  return modernScreenshotPromise;
}

function loadHtml2canvas() {
  if (typeof window.html2canvas === 'function') return Promise.resolve(window.html2canvas);
  html2canvasPromise ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = HTML2CANVAS_SRC;
    script.async = true;
    script.onload = () => (typeof window.html2canvas === 'function'
      ? resolve(window.html2canvas)
      : reject(new Error('html2canvas unavailable')));
    script.onerror = () => reject(new Error('html2canvas failed to load'));
    document.head.appendChild(script);
  }).catch((error) => {
    html2canvasPromise = null;
    throw error;
  });
  return html2canvasPromise;
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function contentKey(slug, element) {
  const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
  return `${slug}|${text}`;
}

function backgroundOf(element) {
  for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (color && color !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(color)) return color;
  }
  return '#ffffff';
}

function toJpeg(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

// Picture of `element` as rendered on screen, at `scale`.
async function render(element, scale) {
  try {
    const { domToCanvas } = await loadModernScreenshot();
    return await domToCanvas(element, {
      backgroundColor: null,
      scale,
      timeout: 8000
    });
  } catch (error) {
    console.warn('[share-snapshot] native renderer failed, using html2canvas', error?.message || error);
  }
  const html2canvas = await loadHtml2canvas();
  return html2canvas(element, {
    backgroundColor: null,
    scale,
    useCORS: true,
    logging: false
  });
}

async function capture(element) {
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) throw new Error('Table not visible');
  const scale = Math.min(3, Math.max(1, (WIDTH - PADDING * 2) / rect.width));
  const shot = await render(element, scale);

  // Letterbox into the 1.91:1 frame every network expects.
  const card = document.createElement('canvas');
  card.width = WIDTH;
  card.height = HEIGHT;
  const context = card.getContext('2d');
  context.fillStyle = backgroundOf(element);
  context.fillRect(0, 0, WIDTH, HEIGHT);
  const fit = Math.min((WIDTH - PADDING * 2) / shot.width, (HEIGHT - PADDING * 2) / shot.height);
  const width = shot.width * fit;
  const height = shot.height * fit;
  context.drawImage(shot, (WIDTH - width) / 2, (HEIGHT - height) / 2, width, height);

  // WhatsApp drops previews heavier than ~600 KB-1 MB.
  for (const quality of [0.88, 0.75, 0.6]) {
    const blob = await toJpeg(card, quality);
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error('Snapshot too large');
}

async function upload(id, element) {
  const blob = await capture(element);
  const response = await fetch(`/share-snapshot?id=${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg' },
    body: blob
  });
  if (!response.ok && response.status !== 409) throw new Error(`Upload failed (${response.status})`);
}

/*
 * Starts (or reuses) the picture of `element` for table `slug` and returns
 * its id. Call it as early as possible (share panel opening, pointerdown) so
 * the upload is done before the crawler asks for the image.
 */
export function prepareShareSnapshot(slug, element) {
  if (!slug || !element?.isConnected) return null;
  const key = contentKey(slug, element);
  const existing = snapshots.get(key);
  if (existing) return existing.id;

  const entry = { id: `${slug}.${randomId()}` };
  snapshots.set(key, entry);
  upload(entry.id, element).catch((error) => {
    // Forget failed pictures so the next share tries again with a fresh id.
    snapshots.delete(key);
    console.warn('[share-snapshot]', error?.message || error);
  });
  return entry.id;
}

// Adds the `shot` parameter for `element` to `url` (string or URL).
export function withShareSnapshot(url, slug, element) {
  const target = new URL(String(url), window.location.origin);
  target.searchParams.delete('shot');
  const id = prepareShareSnapshot(slug, element);
  if (id) target.searchParams.set('shot', id);
  return target.toString();
}
