/*
 * Share preview cards (Open Graph / Twitter).
 *
 * Social crawlers never run the app, so each shareable table needs a static
 * 1200x630 PNG. This script draws one card per table and rasterises it with
 * `rsvg-convert` into src/shared/images/share/. The edge function
 * netlify/edge-functions/share-preview.ts picks the card matching the link.
 *
 * Usage: node scripts/share-cards/generate.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'src/shared/images/share');
const logo = readFileSync(join(root, 'src/shared/images/squirrel-croix-512.png')).toString('base64');

const RED = '#d90a16';
const DARK = '#1a0f10';

const escape = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

// Right-hand illustrations, drawn inside a 440x440 box.
const visuals = {
  cross: () => `
    <rect x="0" y="0" width="440" height="440" rx="28" fill="${RED}"/>
    <line x1="220" y1="30" x2="220" y2="410" stroke="#fff" stroke-opacity=".35" stroke-width="3"/>
    <line x1="30" y1="220" x2="410" y2="220" stroke="#fff" stroke-opacity=".35" stroke-width="3"/>
    ${[[220, 95, '12'], [95, 220, '47'], [345, 220, '59'], [220, 345, '83']].map(([x, y, n]) => `
      <circle cx="${x}" cy="${y}" r="58" fill="#fff"/>
      <text x="${x}" y="${y + 20}" text-anchor="middle" font-size="56" font-weight="700" fill="${RED}">${n}</text>`).join('')}
    <rect x="178" y="190" width="84" height="60" rx="12" fill="#ffe600"/>
    <text x="220" y="232" text-anchor="middle" font-size="34" font-weight="700" fill="${DARK}">5/0</text>`,
  balls: () => {
    const numbers = ['07', '21', '33', '48', '62', '75', '19', '86', '54'];
    return numbers.map((n, i) => {
      const x = 80 + (i % 3) * 140;
      const y = 80 + Math.floor(i / 3) * 140;
      return `
        <circle cx="${x}" cy="${y}" r="60" fill="${i % 2 ? '#fff' : RED}" stroke="${RED}" stroke-width="6"/>
        <text x="${x}" y="${y + 18}" text-anchor="middle" font-size="50" font-weight="700" fill="${i % 2 ? RED : '#fff'}">${n}</text>
        ${i === 4 ? `<line x1="${x - 52}" y1="${y + 52}" x2="${x + 52}" y2="${y - 52}" stroke="${DARK}" stroke-width="10" stroke-linecap="round"/>` : ''}`;
    }).join('');
  },
  grid: (accent) => {
    const cells = [];
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        const n = String(((row * 17 + col * 29) % 89) + 1).padStart(2, '0');
        const hot = (row + col) % 4 === 0;
        cells.push(`
          <rect x="${col * 88}" y="${row * 88}" width="80" height="80" rx="12" fill="${hot ? accent : '#fff'}" stroke="${accent}" stroke-width="4"/>
          <text x="${col * 88 + 40}" y="${row * 88 + 54}" text-anchor="middle" font-size="34" font-weight="700" fill="${hot ? '#fff' : DARK}">${n}</text>`);
      }
    }
    return cells.join('');
  },
  clock: () => `
    <circle cx="220" cy="220" r="200" fill="#fff" stroke="${RED}" stroke-width="14"/>
    ${Array.from({ length: 12 }, (_, i) => {
      const a = (i * Math.PI) / 6;
      return `<line x1="${220 + Math.sin(a) * 160}" y1="${220 - Math.cos(a) * 160}" x2="${220 + Math.sin(a) * 180}" y2="${220 - Math.cos(a) * 180}" stroke="${DARK}" stroke-width="8" stroke-linecap="round"/>`;
    }).join('')}
    <line x1="220" y1="220" x2="220" y2="100" stroke="${DARK}" stroke-width="14" stroke-linecap="round"/>
    <line x1="220" y1="220" x2="310" y2="260" stroke="${RED}" stroke-width="10" stroke-linecap="round"/>
    <circle cx="220" cy="220" r="16" fill="${RED}"/>`
};

const cards = [
  { file: 'croix-nationale', title: 'Croix nationale', subtitle: 'La croix du jour', visual: visuals.cross() },
  { file: 'boules-rejetees', title: 'Boules rejetées', subtitle: 'Les numéros rejetés du jour', visual: visuals.balls() },
  { file: 'matrice', title: 'Matrice du jour', subtitle: 'Matrices plurijetées', visual: visuals.grid('#7a1fd1') },
  { file: 'tableaux', title: 'Tableaux du jour', subtitle: 'Tous les programmes', visual: visuals.grid(RED) },
  { file: 'cle-universelle', title: 'Clé universelle', subtitle: 'Tableau du jour', visual: visuals.grid('#0b63ce') },
  { file: 'intuition', title: 'Intuition', subtitle: 'Tableau du jour', visual: visuals.grid('#0e9f6e') },
  { file: 'oracle', title: 'Oracle', subtitle: 'Tableau du jour', visual: visuals.grid('#b7791f') },
  { file: 'lnb', title: 'LNB', subtitle: 'Tableau du jour', visual: visuals.grid('#1f3a93') },
  { file: 'balsa-plus', title: 'Balsa Plus', subtitle: 'Tableau du jour', visual: visuals.grid('#c2185b') },
  { file: 'stand-by', title: 'Stand-by', subtitle: 'Tableau du jour', visual: visuals.grid('#4a5568') },
  { file: 'horaires', title: 'Horaires', subtitle: 'Les programmes du jour', visual: visuals.clock() }
];

function cardSvg({ title, subtitle, visual }) {
  // Bold DejaVu glyphs average ~0.66em; keep the title inside the 580px column.
  const titleSize = Math.min(92, Math.floor(580 / (title.length * 0.66)));
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630" font-family="DejaVu Sans, Arial, sans-serif">
  <rect width="1200" height="630" fill="#fff7f7"/>
  <rect x="0" y="0" width="1200" height="14" fill="${RED}"/>
  <rect x="0" y="616" width="1200" height="14" fill="${RED}"/>
  <image x="64" y="60" width="96" height="96" xlink:href="data:image/png;base64,${logo}"/>
  <text x="176" y="124" font-size="44" font-weight="700" fill="${RED}">Cidmap</text>
  <text x="64" y="320" font-size="${titleSize}" font-weight="700" fill="${DARK}">${escape(title)}</text>
  <text x="68" y="400" font-size="38" fill="#5b4b4c">${escape(subtitle)}</text>
  <text x="68" y="540" font-size="32" font-weight="700" fill="${RED}">cidmap.com</text>
  <g transform="translate(700 95)">${visual}</g>
</svg>`;
}

mkdirSync(outDir, { recursive: true });
for (const card of cards) {
  const svgPath = join(outDir, `${card.file}.svg`);
  writeFileSync(svgPath, cardSvg(card));
  execFileSync('rsvg-convert', ['-w', '1200', '-h', '630', '-o', join(outDir, `${card.file}.png`), svgPath]);
  rmSync(svgPath);
  console.log(`share card: ${card.file}.png`);
}
