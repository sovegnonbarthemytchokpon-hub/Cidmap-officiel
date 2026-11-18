/*
 * Stores the picture of a table taken by the browser at share time.
 *
 * The share buttons capture the table exactly as displayed (numbers of the
 * day included) and post it here as a 1200x630 JPEG. The id travels in the
 * shared link (`?shot=<id>`); share-preview.ts turns it into og:image and
 * share-snapshot.mjs serves it to the crawlers.
 */

import { getStore } from '@netlify/blobs';

// `<table-slug>.<random>`: the slug lets the image route fall back to the
// static card of the same table while the upload is still in flight.
const SHOT_ID = /^[a-z0-9-]{2,32}\.[A-Za-z0-9_-]{10,40}$/;
const MAX_BYTES = 900 * 1024;

export default async (req) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!SHOT_ID.test(id)) return new Response('Invalid id', { status: 400 });

  const body = new Uint8Array(await req.arrayBuffer());
  const isJpeg = body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  if (!isJpeg || body.byteLength > MAX_BYTES) {
    return new Response('Invalid image', { status: 415 });
  }

  const store = getStore('share-snapshots');
  // A shared link must keep pointing at the picture it was created with.
  if (await store.getMetadata(id)) return new Response('Exists', { status: 409 });
  await store.set(id, body, { metadata: { createdAt: Date.now() } });
  return new Response(null, { status: 204 });
};

export const config = {
  path: '/share-snapshot',
  method: 'POST',
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
