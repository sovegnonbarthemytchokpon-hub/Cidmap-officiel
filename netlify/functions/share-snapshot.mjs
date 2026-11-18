/*
 * Serves the table pictures stored by share-snapshot-upload.mjs.
 * Unknown ids redirect to the static card of the table named in the id, so a
 * crawler never gets a broken image.
 */

import { getStore } from '@netlify/blobs';

const SHOT_ID = /^[a-z0-9-]{2,32}\.[A-Za-z0-9_-]{10,40}$/;
const STATIC_CARDS = new Set([
  'croix-nationale', 'boules-rejetees', 'matrice', 'tableaux', 'cle-universelle',
  'intuition', 'oracle', 'lnb', 'balsa-plus', 'stand-by', 'horaires'
]);

export default async (req) => {
  const id = new URL(req.url).pathname.split('/').pop().replace(/\.jpg$/, '');
  if (SHOT_ID.test(id)) {
    const image = await getStore('share-snapshots').get(id, { type: 'arrayBuffer' });
    if (image) {
      return new Response(image, {
        headers: {
          'content-type': 'image/jpeg',
          'cache-control': 'public, max-age=31536000, immutable'
        }
      });
    }
  }
  const slug = id.split('.')[0];
  const card = STATIC_CARDS.has(slug) ? slug : 'tableaux';
  return new Response(null, {
    status: 302,
    // Short cache: the real picture may land a few seconds later.
    headers: { location: `/src/shared/images/share/${card}.png`, 'cache-control': 'public, max-age=60' }
  });
};

export const config = {
  path: '/share-snapshot/*',
  method: 'GET'
};
