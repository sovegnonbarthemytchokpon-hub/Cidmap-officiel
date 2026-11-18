/*
 * Per-table share previews.
 *
 * WhatsApp, Facebook, X… read the Open Graph tags of the raw HTML and never
 * run the app, so the tags must be correct before the page leaves the edge.
 * The shared table is identified from the link itself:
 *   ?share=<slug>          explicit tag added by every share button
 *   ?publication=<type:…>  archived publication links (history view)
 *   ?section=<route>       any deep link to a section
 * Links without a known table keep the default brand tags from index.html.
 *
 * When the link also carries `?shot=<slug>.<id>`, og:image is the picture of
 * the table taken at share time (real numbers of the day), stored by
 * netlify/functions/share-snapshot-upload.mjs. The static card of the table
 * stays the fallback.
 */

const ORIGIN = 'https://cidmap.com';
const IMAGE_DIR = `${ORIGIN}/src/shared/images/share`;

type Preview = { title: string; description: string; image: string; alt: string };

const PREVIEWS: Record<string, Preview> = {
  'croix-nationale': {
    title: 'Croix nationale',
    description: 'Découvrez la Croix nationale du jour sur Cidmap.',
    image: 'croix-nationale.png',
    alt: 'Croix nationale du jour'
  },
  'boules-rejetees': {
    title: 'Boules rejetées',
    description: 'Consultez les boules rejetées du jour sur Cidmap.',
    image: 'boules-rejetees.png',
    alt: 'Boules rejetées du jour'
  },
  matrice: {
    title: 'Matrice du jour',
    description: 'Retrouvez la matrice plurijetée du jour sur Cidmap.',
    image: 'matrice.png',
    alt: 'Matrice du jour'
  },
  tableaux: {
    title: 'Tableaux du jour',
    description: 'Tous les tableaux et programmes du jour sur Cidmap.',
    image: 'tableaux.png',
    alt: 'Tableaux du jour'
  },
  'cle-universelle': {
    title: 'Clé universelle',
    description: 'Découvrez le tableau Clé universelle du jour sur Cidmap.',
    image: 'cle-universelle.png',
    alt: 'Tableau Clé universelle'
  },
  intuition: {
    title: 'Intuition',
    description: 'Découvrez le tableau Intuition du jour sur Cidmap.',
    image: 'intuition.png',
    alt: 'Tableau Intuition'
  },
  oracle: {
    title: 'Oracle',
    description: 'Découvrez le tableau Oracle du jour sur Cidmap.',
    image: 'oracle.png',
    alt: 'Tableau Oracle'
  },
  lnb: {
    title: 'LNB',
    description: 'Découvrez le tableau LNB du jour sur Cidmap.',
    image: 'lnb.png',
    alt: 'Tableau LNB'
  },
  'balsa-plus': {
    title: 'Balsa Plus',
    description: 'Découvrez le tableau Balsa Plus du jour sur Cidmap.',
    image: 'balsa-plus.png',
    alt: 'Tableau Balsa Plus'
  },
  'stand-by': {
    title: 'Stand-by',
    description: 'Découvrez le tableau Stand-by du jour sur Cidmap.',
    image: 'stand-by.png',
    alt: 'Tableau Stand-by'
  },
  horaires: {
    title: 'Horaires des programmes',
    description: 'Consultez les horaires des programmes du jour sur Cidmap.',
    image: 'horaires.png',
    alt: 'Horaires des programmes'
  }
};

// Every identifier the app uses for a table (routes, feed types, feature keys).
const ALIASES: Record<string, string> = {
  croix: 'croix-nationale',
  cross: 'croix-nationale',
  'croix-nationale': 'croix-nationale',
  rejetes: 'boules-rejetees',
  rejected: 'boules-rejetees',
  'boules-rejetees': 'boules-rejetees',
  'numeros-rejetes': 'boules-rejetees',
  matrice: 'matrice',
  matrices: 'matrice',
  matrix: 'matrice',
  tableaux: 'tableaux',
  universal: 'cle-universelle',
  universelle: 'cle-universelle',
  'cle-universelle': 'cle-universelle',
  'tableaux-universelle': 'cle-universelle',
  intuition: 'intuition',
  'tableaux-intuition': 'intuition',
  oracle: 'oracle',
  'tableaux-oracle': 'oracle',
  lnb: 'lnb',
  'tableaux-lnb': 'lnb',
  balsa: 'balsa-plus',
  'balsa-plus': 'balsa-plus',
  'tableaux-balsa': 'balsa-plus',
  standby: 'stand-by',
  'stand-by': 'stand-by',
  'tableaux-standby': 'stand-by',
  schedule: 'horaires',
  horaires: 'horaires'
};

function normalize(value: string | null): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-');
}

const SHOT_ID = /^[a-z0-9-]{2,32}\.[A-Za-z0-9_-]{10,40}$/;

function resolveShot(url: URL): string | null {
  const shot = url.searchParams.get('shot') || '';
  return SHOT_ID.test(shot) ? shot : null;
}

function resolvePreview(url: URL): Preview | null {
  const candidates = [
    url.searchParams.get('share'),
    resolveShot(url)?.split('.')[0] ?? null,
    url.searchParams.get('publication')?.split(':')[0] ?? null,
    url.searchParams.get('section')
  ];
  for (const candidate of candidates) {
    const key = ALIASES[normalize(candidate)];
    if (key) return PREVIEWS[key];
  }
  return null;
}

const escapeAttr = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

function setMeta(html: string, attr: 'property' | 'name', key: string, value: string): string {
  const tag = `<meta ${attr}="${key}" content="${escapeAttr(value)}" />`;
  const pattern = new RegExp(`<meta\\s+${attr}="${key.replace(/[.:]/g, '\\$&')}"[^>]*>`, 'i');
  return pattern.test(html) ? html.replace(pattern, tag) : html.replace('</head>', `${tag}\n</head>`);
}

export default async (req: Request, context: { next: () => Promise<Response> }) => {
  const url = new URL(req.url);
  const preview = resolvePreview(url);
  if (!preview) return;

  const response = await context.next();
  if (!(response.headers.get('content-type') || '').includes('text/html')) return response;

  const title = `${preview.title} - Cidmap`;
  const shot = resolveShot(url);
  const image = shot ? `${ORIGIN}/share-snapshot/${shot}.jpg` : `${IMAGE_DIR}/${preview.image}`;
  // The crawler re-reads og:url, so it must stay on the shared link or the
  // preview falls back to the home page tags.
  const shareUrl = new URL(url.pathname + url.search, ORIGIN).toString();

  let html = await response.text();
  const tags: Array<['property' | 'name', string, string]> = [
    ['property', 'og:url', shareUrl],
    ['property', 'og:title', title],
    ['property', 'og:description', preview.description],
    ['property', 'og:image', image],
    ['property', 'og:image:alt', preview.alt],
    ['property', 'og:image:type', shot ? 'image/jpeg' : 'image/png'],
    ['property', 'og:image:width', '1200'],
    ['property', 'og:image:height', '630'],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', title],
    ['name', 'twitter:description', preview.description],
    ['name', 'twitter:image', image],
    ['name', 'twitter:image:alt', preview.alt],
    ['name', 'description', preview.description]
  ];
  for (const [attr, key, value] of tags) html = setMeta(html, attr, key, value);
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeAttr(title)}</title>`);

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(html, { status: response.status, headers });
};

export const config = {
  path: ['/', '/index.html']
};
