/*
 * Intelligent result import for the principal administrator.
 *
 * The browser prepares a reviewable draft with the vision/text model. The
 * server remains the only place allowed to publish rows into Supabase.
 */

const COUNTRIES = [
  ['BJ', 'Bénin'],
  ['CI', "Côte d’Ivoire"],
  ['GH', 'Ghana'],
  ['AO', 'Angola'],
  ['GN', 'Guinée'],
  ['NE', 'Niger'],
  ['SN', 'Sénégal'],
  ['TG', 'Togo'],
  ['__custom', 'Autre pays…']
];

const DEFAULT_SCHEDULE = [
  'Digital 21h=21:00',
  'Digital 22h=22:00',
  'Digital 23h=23:00',
  'Awale=16:00',
  'dimanche | Benediction=10:00',
  'dimanche | Prestige=13:00',
  'dimanche | Espoir=18:00'
].join('\n');

const DAY_NAMES = [
  ['dimanche', 0],
  ['lundi', 1],
  ['mardi', 2],
  ['mercredi', 3],
  ['jeudi', 4],
  ['vendredi', 5],
  ['samedi', 6]
];

const imagePart = (url) => ({
  type: 'image_url',
  image_url: { url }
});

const textPart = (text) => ({ type: 'text', text });

const IMPORT_CHUNK_SIZE = 200;

const escapeText = (value) => String(value ?? '');

function parseTime(value) {
  const raw = escapeText(value).trim().toLowerCase();
  const match = raw.match(/(?:^|\D)([01]?\d|2[0-3])(?:[:h.]([0-5]\d))?\s*(?:h|heure|hrs?)?(?:\D|$)/i);
  if (!match) return '';
  return `${String(Number(match[1])).padStart(2, '0')}:${String(match[2] || '00').padStart(2, '0')}`;
}

function normalizeName(value) {
  return escapeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeCountryCode(value) {
  const dialMatch = window.cidInternationalPhone?.match?.(value);
  const dialCode = dialMatch
    ? window.cidInternationalPhone?.isoByDial?.[dialMatch[0]]
    : '';
  if (dialCode) return dialCode;
  const raw = escapeText(value).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ').replace(/\s+/g, ' ');
  if (raw === 'angola' || raw === 'ao') return 'AO';
  return /^[a-z]{2,8}$/.test(raw) ? raw.toUpperCase() : '';
}

function dayNumber(value) {
  const key = normalizeName(value);
  if (!key || key === 'tous' || key === 'tous les jours' || key === 'quotidien') return null;
  return DAY_NAMES.find(([name]) => name === key)?.[1] ?? null;
}

function parseScheduleRows(text) {
  const rows = [];
  escapeText(text).split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*(?:(.+?)\s*\|\s*)?(.+?)\s*=\s*(.+?)\s*$/);
    if (!match) return;
    const time = parseTime(match[3]);
    const programName = normalizeName(match[2]);
    if (time && programName) {
      rows.push({
        programName,
        dayOfWeek: match[1] ? dayNumber(match[1]) : null,
        drawTime: time
      });
    }
  });
  return rows;
}

function defaultTimeFor(programName, schedule, drawDate) {
  const key = normalizeName(programName);
  if (!key) return '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(drawDate || '')
    ? new Date(`${drawDate}T12:00:00Z`).getUTCDay()
    : null;
  const matches = schedule.filter((row) => (
    (row.programName === key || key.includes(row.programName) || row.programName.includes(key))
    && (row.dayOfWeek === null || row.dayOfWeek === day)
  ));
  const exactDay = matches.find((row) => row.dayOfWeek === day);
  if (exactDay) return exactDay.drawTime;
  const allDays = matches.find((row) => row.dayOfWeek === null);
  if (allDays) return allDays.drawTime;
  for (const row of schedule) {
    // Do not assign the first Digital slot to every generic "Digital" row.
    // A numbered routine entry is only safe when the document also names that
    // numbered slot explicitly.
    if (/\d/.test(row.programName)) continue;
    if (row.dayOfWeek !== null && row.dayOfWeek !== day) continue;
    if (key.includes(row.programName) || row.programName.includes(key)) return row.drawTime;
  }
  return '';
}

function scheduleTextFromRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const dayOfWeek = row.dayOfWeek ?? row.day_of_week;
    const drawTime = row.drawTime ?? row.draw_time;
    const programName = row.programName ?? row.program_name;
    const day = dayOfWeek === null || dayOfWeek === undefined
      ? ''
      : `${DAY_NAMES.find(([, number]) => number === Number(dayOfWeek))?.[0] || ''} | `;
    return `${day}${programName}=${String(drawTime || '').slice(0, 5)}`;
  }).filter((line) => !line.endsWith('=')).join('\n');
}

// Country names recognised in pasted headings (“NIGER MARS 2026”, “Bénin 8h”).
// Matched as whole words on the folded text, so “Nigeria” never becomes NE.
const COUNTRY_ALIASES = [
  ['cote d ivoire', 'CI'],
  ['cote divoire', 'CI'],
  ['ivoire', 'CI'],
  ['rci', 'CI'],
  ['benin', 'BJ'],
  ['ghana', 'GH'],
  ['angola', 'AO'],
  ['guinee', 'GN'],
  ['guinea', 'GN'],
  ['niger', 'NE'],
  ['senegal', 'SN'],
  ['togo', 'TG'],
  ['cameroun', 'CM'],
  ['cameroon', 'CM'],
  ['suisse', 'CH']
];

// National lotteries that only publish the five winning numbers.
const COUNTRIES_WITHOUT_EXTRA_GROUPS = new Set(['NE']);

const MONTHS = [
  ['janvier', 1], ['janv', 1], ['january', 1], ['jan', 1],
  ['fevrier', 2], ['fevr', 2], ['february', 2], ['fev', 2], ['feb', 2],
  ['mars', 3], ['march', 3], ['mar', 3],
  ['avril', 4], ['april', 4], ['avr', 4], ['apr', 4],
  ['mai', 5], ['may', 5],
  ['juin', 6], ['june', 6], ['jun', 6],
  ['juillet', 7], ['juil', 7], ['july', 7], ['jul', 7],
  ['aout', 8], ['august', 8], ['aug', 8],
  ['septembre', 9], ['september', 9], ['sept', 9], ['sep', 9],
  ['octobre', 10], ['october', 10], ['oct', 10],
  ['novembre', 11], ['november', 11], ['nov', 11],
  ['decembre', 12], ['december', 12], ['dec', 12]
];
const MONTH_PATTERN = MONTHS.map(([name]) => name).join('|');
const WEEKDAY_PATTERN = 'dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi|sunday|monday|tuesday|wednesday|thursday|friday|saturday';

function detectCountry(value) {
  const folded = ` ${normalizeName(value)} `;
  return COUNTRY_ALIASES.find(([alias]) => folded.includes(` ${alias} `))?.[1] || '';
}

function isoFromParts(day, month, year) {
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return '';
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return '';
  const result = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${result}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.getUTCDate() === day ? result : '';
}

function fullYear(value, fallbackYear) {
  if (value === undefined || value === '') return fallbackYear;
  const year = Number(value);
  return year < 100 ? 2000 + year : year;
}

/*
 * Reads one date from a line: “31-03-2026”, “31/03/26”, “31.03.2026”,
 * “2026-03-31”, “Mardi 31 mars 2026” or “31 mars”. Returns the ISO date and
 * the matched text so the caller can tell a date line from a heading.
 */
function findDate(value, fallbackYear) {
  const raw = escapeText(value);
  const folded = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let match = folded.match(/(?:^|[^\d])(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?![\d])/);
  if (match) {
    const iso = isoFromParts(Number(match[3]), Number(match[2]), Number(match[1]));
    if (iso) return { iso, text: match[0] };
  }
  match = folded.match(/(?:^|[^\d])(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?(?![\d])/);
  if (match) {
    const year = fullYear(match[3], fallbackYear);
    const twoDigitYear = match[3] && match[3].length === 2;
    // “02-11-47” is a row of numbers, not a date in 2047.
    const plausible = !twoDigitYear || year <= new Date().getFullYear() + 1;
    const iso = plausible ? isoFromParts(Number(match[1]), Number(match[2]), year) : '';
    if (iso) return { iso, text: match[0] };
  }
  match = folded.match(new RegExp(`(?:^|[^\\d])(\\d{1,2})(?:er)?\\s+(${MONTH_PATTERN})\\.?(?:\\s+(\\d{4}))?(?![a-z\\d])`));
  if (match) {
    const month = MONTHS.find(([name]) => name === match[2])?.[1];
    const iso = isoFromParts(Number(match[1]), month, fullYear(match[3], fallbackYear));
    if (iso) return { iso, text: match[0] };
  }
  return null;
}

// Removes period mentions such as “MARS 2026”, weekdays and dates from a
// heading so that only the country / programme name remains.
function cleanHeading(value) {
  const months = new Set(MONTHS.map(([name]) => name));
  const weekdays = new Set(WEEKDAY_PATTERN.split('|'));
  return escapeText(value)
    .normalize('NFC')
    .replace(/\b\d{1,4}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g, ' ')
    .split(/\s+/)
    .filter((word) => {
      const folded = normalizeName(word);
      return folded && !months.has(folded) && !weekdays.has(folded) && !/^(?:19|20)\d{2}$/.test(folded);
    })
    .join(' ')
    .replace(/^[\s—–:|-]+|[\s—–:|-]+$/g, '')
    .trim();
}

function countryLabel(code) {
  return COUNTRIES.find(([value]) => value === code)?.[1] || code;
}

/*
 * Deterministic parser for pasted result lists. Each block may carry its own
 * country, date, time and draw number, so a long history (for example every
 * day since 2025) becomes one row per draw:
 *
 *   NIGER MARS 2026
 *   31-03-2026
 *   Heure 15:00
 *   Tirage 2798
 *   Gagnants 46 - 73 - 11 - 41 - 36
 *
 * The older single-day layout (“Bénin 8h / Gagnants : …”) still works: a
 * date written once at the top applies to every following block.
 */
function parsePlainResultBlock(text, { fallbackDate = '' } = {}) {
  const lines = escapeText(text).split(/\r?\n/).map((line) => line.trim());
  const fallbackYear = Number(String(fallbackDate).slice(0, 4)) || new Date().getFullYear();
  const draws = [];
  let current = null;
  let group = '';
  let lastDate = '';
  let lastHeading = { countryCode: '', programName: '' };
  let detectedDate = null;

  const hasNumbers = (draw) => Boolean(
    draw && (draw.firstNumbers.length || draw.machineNumbers.length || draw.bonusNumbers.length)
  );
  const flush = () => {
    if (!current) return;
    draws.push({
      ...current,
      sourceOrder: draws.length,
      note: hasNumbers(current) ? '' : 'Aucun numéro reconnu pour ce programme.'
    });
    current = null;
    group = '';
  };
  const headingInfo = (heading) => {
    const cleaned = cleanHeading(heading);
    const time = parseTime(cleaned);
    const withoutTime = cleaned
      .replace(/(?:^|\s)(?:[01]?\d|2[0-3])(?:[:h.]([0-5]\d))?\s*(?:h|heure|hrs?)?(?=\s|$)/i, '')
      .replace(/\s*[—–-]\s*$/, '')
      .trim() || cleaned;
    const countryCode = detectCountry(withoutTime);
    const isCountryOnly = countryCode && normalizeName(withoutTime).split(' ').every((word) => (
      COUNTRY_ALIASES.some(([alias]) => alias.split(' ').includes(word)) || ['d', 'de', 'du'].includes(word)
    ));
    return {
      countryCode,
      programName: isCountryOnly ? countryLabel(countryCode) : withoutTime,
      drawTime: time
    };
  };
  const startDraw = (info = lastHeading) => {
    flush();
    current = {
      countryCode: info.countryCode || '',
      programName: info.programName || '',
      drawDate: lastDate || null,
      drawTime: info.drawTime || '',
      drawNumber: null,
      firstNumbers: [],
      machineNumbers: [],
      bonusNumbers: []
    };
    group = '';
  };
  // Field lines (Heure, Tirage, Gagnants…) without a heading in between
  // start a new draw that inherits the previous block's country.
  const ensureDraw = (isFilled) => {
    if (!current || isFilled(current)) startDraw();
  };
  const appendNumbers = (name, value) => {
    if (!current || !name) return;
    const numbers = normalizeNumbers(value);
    if (!numbers.length) return;
    current[`${name}Numbers`].push(...numbers);
    current[`${name}Numbers`] = [...new Set(current[`${name}Numbers`])].slice(0, 10);
  };
  const groupFor = (label) => {
    const key = normalizeName(label);
    if (key.startsWith('gagnant') || key.startsWith('winning')) return 'first';
    if (key.startsWith('machine')) return 'machine';
    return 'bonus';
  };
  const setDate = (iso) => {
    if (!detectedDate) detectedDate = iso;
    lastDate = iso;
    if (current && !hasNumbers(current) && !current.ownDate) {
      current.drawDate = iso;
      current.ownDate = true;
    } else if (current) {
      flush();
    }
  };
  const LABEL = '(gagnants?|winning numbers?|machines?|bonus)';

  lines.forEach((line) => {
    if (!line) return;

    const inlineLabels = [...line.matchAll(new RegExp(`(?:^|[—–|])\\s*${LABEL}\\s*:?\\s*`, 'gi'))];
    if (inlineLabels.length && (inlineLabels[0].index > 0 || inlineLabels.length > 1)) {
      const heading = line.slice(0, inlineLabels[0].index).replace(/[—–|]\s*$/, '').trim();
      if (heading) {
        const info = headingInfo(heading);
        lastHeading = info;
        startDraw(info);
        const inlineDate = findDate(heading, fallbackYear);
        if (inlineDate) setDate(inlineDate.iso);
      }
      inlineLabels.forEach((match, index) => {
        group = groupFor(match[1]);
        if (group === 'first') ensureDraw((draw) => draw.firstNumbers.length > 0);
        const start = match.index + match[0].length;
        const end = index + 1 < inlineLabels.length ? inlineLabels[index + 1].index : line.length;
        appendNumbers(group, line.slice(start, end));
      });
      return;
    }

    const timeMatch = line.match(/^(?:heure|horaire|time)\s*(?:du tirage)?\s*:?\s*(.+)$/i);
    if (timeMatch && parseTime(timeMatch[1])) {
      ensureDraw((draw) => hasNumbers(draw) || (draw.drawTime && draw.timeFromLine));
      current.drawTime = parseTime(timeMatch[1]);
      current.timeFromLine = true;
      return;
    }

    const drawNumberMatch = line.match(/^(?:n[°ºo]\.?\s*(?:de\s+)?)?tirage\s*(?:n[°ºo]\.?)?\s*:?\s*#?\s*(\d{1,6})\s*$/i);
    if (drawNumberMatch) {
      ensureDraw((draw) => hasNumbers(draw) || draw.drawNumber !== null);
      current.drawNumber = Number(drawNumberMatch[1]);
      return;
    }

    const labelMatch = line.match(new RegExp(`^${LABEL}\\s*:?\\s*(.*)$`, 'i'));
    if (labelMatch) {
      group = groupFor(labelMatch[1]);
      if (group === 'first') ensureDraw((draw) => draw.firstNumbers.length > 0);
      else if (!current) return;
      appendNumbers(group, labelMatch[2]);
      return;
    }

    // A line that is only a date (optionally with its weekday).
    const date = findDate(line, fallbackYear);
    if (date) {
      const rest = line.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(date.text, ' ')
        .replace(new RegExp(`\\b(?:${WEEKDAY_PATTERN})\\b`, 'g'), ' ')
        .replace(/[\s,.:—–-]+/g, '');
      if (!rest) {
        setDate(date.iso);
        return;
      }
    }

    if (group && current && /^\d{1,2}(?:\s*[-–—,;\s]\s*\d{1,2})*$/.test(line)) {
      appendNumbers(group, line);
      return;
    }

    // Any other line is a heading: a country (“NIGER MARS 2026”) or a
    // programme (“Digital 23h”). It may also carry the date.
    const info = headingInfo(line);
    if (current && !hasNumbers(current) && current.drawNumber === null
      && !current.timeFromLine && !current.ownDate) {
      // Consecutive heading lines (“RÉSULTATS” then “NIGER”) describe the
      // same block; keep the most specific one.
      current.countryCode = info.countryCode || current.countryCode;
      current.programName = info.programName || current.programName;
      current.drawTime = info.drawTime || current.drawTime;
    } else {
      startDraw(info);
    }
    lastHeading = {
      countryCode: current.countryCode,
      programName: current.programName,
      drawTime: ''
    };
    if (date) setDate(date.iso);
  });
  flush();
  const cleaned = draws
    .filter((draw) => hasNumbers(draw) || draw.drawNumber !== null || draw.timeFromLine)
    .map(({ ownDate, timeFromLine, ...draw }, index) => ({ ...draw, sourceOrder: index }));
  return cleaned.length ? { detectedDate, draws: cleaned, warnings: [] } : null;
}

function normalizeNumbers(value) {
  const source = Array.isArray(value)
    ? value
    : escapeText(value).split(/[,\s;|+–—-]+/);
  return [...new Set(source
    .map((item) => Number.parseInt(String(item).replace(/[^\d]/g, ''), 10))
    .filter((item) => Number.isInteger(item) && item >= 1 && item <= 90))]
    .slice(0, 10);
}

function toIsoDate(value, fallback) {
  const raw = escapeText(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (!match) return fallback;
  const year = Number(match[3] || String(fallback || '').slice(0, 4) || new Date().getFullYear());
  const fullYear = year < 100 ? 2000 + year : year;
  const month = Number(match[2]);
  const day = Number(match[1]);
  if (!Number.isInteger(day) || !Number.isInteger(month) || month < 1 || month > 12) return fallback;
  const result = `${fullYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${result}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : result;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Le fichier image ne peut pas être lu.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

async function pdfToImages(file) {
  let pdfjs;
  try {
    pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
  } catch (_) {
    throw new Error('Le lecteur PDF est indisponible. Vous pouvez copier-coller le texte du PDF.');
  }
  pdfjs.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
  const documentProxy = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const images = [];
  const pageCount = Math.min(Number(documentProxy.numPages) || 0, 8);
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await documentProxy.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    images.push(canvas.toDataURL('image/jpeg', 0.86));
  }
  return images;
}

async function readInputFile(file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  if (type.startsWith('image/')) {
    return { images: [await readFileAsDataUrl(file)], text: '' };
  }
  if (type === 'application/pdf' || name.endsWith('.pdf')) {
    return { images: await pdfToImages(file), text: '' };
  }
  if (type.startsWith('text/') || /\.(txt|csv|tsv|json)$/i.test(name)) {
    return { images: [], text: await file.text() };
  }
  throw new Error('Format non reconnu. Utilisez une image, un PDF ou un fichier texte.');
}

function modelSchema() {
  const nullable = (type) => ({ anyOf: [{ type }, { type: 'null' }] });
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      detectedDate: nullable('string'),
      draws: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            countryCode: nullable('string'),
            programName: { type: 'string' },
            drawDate: nullable('string'),
            drawTime: nullable('string'),
            drawNumber: nullable('integer'),
            firstNumbers: { type: 'array', items: { type: 'integer' } },
            machineNumbers: { type: 'array', items: { type: 'integer' } },
            bonusNumbers: { type: 'array', items: { type: 'integer' } },
            sourceOrder: { type: 'integer' },
            note: { type: 'string' }
          },
          required: [
            'countryCode',
            'programName',
            'drawDate',
            'drawTime',
            'drawNumber',
            'firstNumbers',
            'machineNumbers',
            'bonusNumbers',
            'sourceOrder',
            'note'
          ]
        }
      },
      warnings: { type: 'array', items: { type: 'string' } }
    },
    required: ['detectedDate', 'draws', 'warnings']
  };
}

async function analyzeWithModel({ countryCode, countryName, fallbackDate, text, images }) {
  // Pasted text is read by the deterministic parser first: it never invents
  // a number and handles long multi-day histories instantly. The model is
  // only needed for images/PDF or layouts the parser does not recognise.
  const local = images.length ? null : parsePlainResultBlock(text, { fallbackDate });
  if (local && local.draws.every((draw) => draw.firstNumbers.length)) return local;
  if (!window.websim?.chat?.completions?.create) {
    if (local) return local;
    throw new Error('Le service d’analyse intelligente est indisponible.');
  }
  const instructions = `Tu analyses une capture ou un document de résultats de tirages.
Pays choisi par l’administrateur : ${countryName} (${countryCode}).
Date de secours si la date n’est pas complète : ${fallbackDate}.
Extrais uniquement ce qui est réellement visible. N’invente jamais un numéro,
une heure ou un numéro de tirage. « Gagnants » correspond à firstNumbers,
« Machine(s) » à machineNumbers et « Bonus » à bonusNumbers. Les heures écrites « 23h », « 22 h »
ou « 21:00 » doivent être converties en HH:MM. Si une information manque,
retourne null et ajoute une note. Le texte peut contenir un nombre par ligne :
regroupe les cinq numéros qui suivent « Gagnants : » dans firstNumbers et les
cinq numéros qui suivent « Machine(s) : » dans machineNumbers. Un bonus peut
contenir un seul numéro ou plusieurs numéros selon le pays, et ne doit jamais
être inventé. Les nombres peuvent être écrits sur la même ligne ou un par ligne.
Le document peut couvrir plusieurs jours : donne à chaque tirage sa propre
date (drawDate, format YYYY-MM-DD) et, si le bloc nomme un pays, son code ISO
à deux lettres (countryCode, ex. NE pour Niger), sinon null. Les mentions de
période comme « MARS 2026 » ne font pas partie du nom.
Conserve l’ordre des programmes dans sourceOrder, même si
les heures sont absentes. Les intitulés « Special Weekend », « Digital
Reveil », « Digital », « Benediction », « Prestige », « Awale » et
« Afterwork » sont des noms de programmes, pas des numéros.
Retourne uniquement le JSON conforme au schéma demandé.`;
  const content = [textPart(instructions)];
  if (text.trim()) content.push(textPart(`Texte à analyser :\n${text.slice(0, 120000)}`));
  images.slice(0, 8).forEach((image) => content.push(imagePart(image)));
  try {
    const completion = await window.websim.chat.completions.create({
      messages: [{ role: 'user', content }],
      schema: modelSchema()
    });
    return JSON.parse(completion.content);
  } catch (error) {
    if (local) return local;
    throw new Error(error?.message || 'La réponse de l’analyse n’est pas exploitable. Réessayez avec une image plus nette.');
  }
}

function drawKeys(row) {
  const keys = [`${row.countryCode}|${row.drawDate}|${row.drawTime}`];
  if (row.drawNumber !== null && row.drawNumber !== undefined) {
    keys.push(`${row.countryCode}|${row.drawDate}|#${row.drawNumber}`);
  }
  return keys;
}

// Most recent first, matching ORDER BY draw_date DESC, draw_time DESC.
function compareDrawsDesc(left, right) {
  if (left.drawDate !== right.drawDate) return right.drawDate.localeCompare(left.drawDate);
  if (!left.drawTime && !right.drawTime) return left.sourceOrder - right.sourceOrder;
  if (!left.drawTime) return 1;
  if (!right.drawTime) return -1;
  return right.drawTime.localeCompare(left.drawTime) || left.sourceOrder - right.sourceOrder;
}

function normalizeDraft(payload, options) {
  const schedule = parseScheduleRows(options.scheduleText);
  const fallbackDate = options.fallbackDate;
  const detectedDate = toIsoDate(payload?.detectedDate, fallbackDate);
  const warnings = Array.isArray(payload?.warnings) ? payload.warnings.map(String) : [];
  const seen = new Set();
  let batchDuplicates = 0;
  const rows = (Array.isArray(payload?.draws) ? payload.draws : [])
    .map((raw, index) => {
      const countryCode = detectCountry(raw?.countryCode) || normalizeCountryCode(raw?.countryCode) || options.countryCode;
      const drawDate = toIsoDate(raw?.drawDate, detectedDate);
      const programName = escapeText(raw?.programName).trim() || `Programme ${index + 1}`;
      const detectedTime = parseTime(raw?.drawTime);
      const configuredTime = detectedTime || defaultTimeFor(programName, schedule, drawDate);
      const first = normalizeNumbers(raw?.firstNumbers);
      const machine = normalizeNumbers(raw?.machineNumbers);
      const bonus = normalizeNumbers(raw?.bonusNumbers);
      const drawNumber = Number.isInteger(raw?.drawNumber) && raw.drawNumber >= 0
        ? raw.drawNumber
        : null;
      const notes = [];
      if (detectedTime) notes.push('heure détectée');
      else if (configuredTime) notes.push('heure ajoutée depuis la routine');
      else notes.push('heure à confirmer');
      if (!first.length) notes.push('groupe Gagnants introuvable');
      else if (first.length !== 5) notes.push(`${first.length} numéro(s) gagnant(s) au lieu de 5`);
      if (!machine.length && !COUNTRIES_WITHOUT_EXTRA_GROUPS.has(countryCode)) {
        notes.push('groupe Machine introuvable');
      }
      if (drawNumber === null) notes.push('numéro de tirage facultatif non fourni');
      if (raw?.note) notes.push(escapeText(raw.note));
      return {
        sourceOrder: Number.isInteger(raw?.sourceOrder) ? raw.sourceOrder : index,
        countryCode,
        drawDate,
        programName,
        drawTime: configuredTime,
        drawNumber,
        first,
        machine,
        bonus,
        timeOrigin: detectedTime ? 'detected' : configuredTime ? 'configured' : 'missing',
        notes: [...new Set(notes)].join(' · ')
      };
    })
    .filter((row) => {
      // The same draw pasted twice is kept once; the database check on save
      // also skips draws that were already recorded earlier.
      const keys = drawKeys(row);
      if (row.drawTime && keys.some((key) => seen.has(key))) {
        batchDuplicates += 1;
        return false;
      }
      if (row.drawTime) keys.forEach((key) => seen.add(key));
      return true;
    })
    .sort(compareDrawsDesc);
  if (batchDuplicates) warnings.push(`${batchDuplicates} tirage(s) en double dans le texte collé ont été ignorés.`);
  return { rows, warnings, detectedDate };
}

function input(className, value, type = 'text') {
  const element = document.createElement('input');
  element.className = className;
  element.type = type;
  element.value = value ?? '';
  return element;
}

function textarea(className, value) {
  const element = document.createElement('textarea');
  element.className = className;
  element.value = value ?? '';
  return element;
}

function button(label, className) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  return element;
}

function renderPreview(root, state) {
  const preview = root.querySelector('[data-result-import-preview]');
  const summary = root.querySelector('[data-result-import-summary]');
  const saveButton = root.querySelector('[data-result-import-save]');
  preview.replaceChildren();
  if (!state.rows.length) {
    summary.textContent = 'Aucun tirage reconnu.';
    saveButton.disabled = true;
    return;
  }
  const missing = state.rows.filter((row) => !row.drawTime || !row.first.length || !row.countryCode).length;
  const dates = state.rows.map((row) => row.drawDate).filter(Boolean).sort();
  const countries = [...new Set(state.rows.map((row) => countryLabel(row.countryCode)))].join(', ');
  const period = dates.length ? ` · du ${dates[0]} au ${dates[dates.length - 1]}` : '';
  summary.textContent = `${state.rows.length} tirage(s) reconnu(s) (${countries})${period} · ${missing} ligne(s) à compléter${state.warnings.length ? ` · ${state.warnings.join(' ')}` : ''}`;
  state.rows.forEach((row, index) => {
    const card = document.createElement('article');
    card.className = 'admin-result-import-row';
    card.dataset.importIndex = String(index);
    const heading = document.createElement('div');
    heading.className = 'admin-result-import-row-heading';
    const headingName = document.createElement('strong');
    headingName.textContent = [row.drawDate, row.drawTime, row.programName].filter(Boolean).join(' · ');
    const headingSource = document.createElement('span');
    headingSource.textContent = row.timeOrigin === 'detected'
      ? 'Heure détectée'
      : row.timeOrigin === 'configured'
        ? 'Heure de routine'
        : 'Heure manquante';
    heading.append(headingName, headingSource);
    const grid = document.createElement('div');
    grid.className = 'admin-result-import-row-grid';
    const field = (label, control) => {
      const wrap = document.createElement('label');
      wrap.innerHTML = `<span>${label}</span>`;
      wrap.appendChild(control);
      return wrap;
    };
    const country = document.createElement('select');
    country.className = 'admin-result-import-country';
    const countryOptions = COUNTRIES.filter(([code]) => code !== '__custom');
    if (row.countryCode && !countryOptions.some(([code]) => code === row.countryCode)) {
      countryOptions.push([row.countryCode, row.countryCode]);
    }
    countryOptions.forEach(([code, name]) => {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = code === name ? code : `${name} (${code})`;
      option.selected = code === row.countryCode;
      country.appendChild(option);
    });
    grid.append(
      field('Pays', country),
      field('Date', input('admin-result-import-date', row.drawDate, 'date')),
      field('Programme', input('admin-result-import-program', row.programName)),
      field('Heure', input('admin-result-import-time', row.drawTime, 'time')),
      field('N° tirage (facultatif)', input('admin-result-import-number', row.drawNumber ?? '', 'number'))
    );
    const numbers = document.createElement('div');
    numbers.className = 'admin-result-import-number-grid';
    numbers.append(
      field('Gagnants (5 premiers)', textarea('admin-result-import-first', row.first.join(' - '))),
      field('Machines (5 derniers)', textarea('admin-result-import-machine', row.machine.join(' - '))),
      field('Bonus (facultatif, variable)', textarea('admin-result-import-bonus', row.bonus.join(' - ')))
    );
    const note = document.createElement('small');
    note.className = `admin-result-import-note${row.timeOrigin === 'missing' || !row.first.length ? ' is-warning' : ''}`;
    note.textContent = row.notes || 'Vérifiez cette ligne avant l’enregistrement.';
    card.append(heading, grid, numbers, note);
    preview.appendChild(card);
  });
  saveButton.disabled = missing > 0;
}

function readRows(root) {
  return [...root.querySelectorAll('.admin-result-import-row')].map((card) => ({
    countryCode: card.querySelector('.admin-result-import-country')?.value || '',
    drawDate: card.querySelector('.admin-result-import-date')?.value || '',
    programName: card.querySelector('.admin-result-import-program')?.value.trim() || '',
    drawTime: card.querySelector('.admin-result-import-time')?.value || '',
    drawNumber: card.querySelector('.admin-result-import-number')?.value === ''
      ? null
      : Number.parseInt(card.querySelector('.admin-result-import-number')?.value || '', 10),
    first: normalizeNumbers(card.querySelector('.admin-result-import-first')?.value || ''),
    machine: normalizeNumbers(card.querySelector('.admin-result-import-machine')?.value || ''),
    bonus: normalizeNumbers(card.querySelector('.admin-result-import-bonus')?.value || '')
  }));
}

export function createAdminResultImport({
  onSave,
  onComplete = null,
  loadSchedules = null,
  saveSchedules = null
} = {}) {
  const root = document.createElement('section');
  root.className = 'admin-result-import';
  root.innerHTML = `
    <div class="admin-result-import-header">
      <div>
        <p class="admin-v3-eyebrow">Import intelligent</p>
        <h3>Ajouter plusieurs résultats</h3>
        <p>Choisissez le pays, importez une capture/PDF ou collez un long texte, même un historique de plusieurs mois. Chaque bloc garde son pays, sa date, son heure et son numéro de tirage ; les tirages déjà enregistrés sont ignorés automatiquement. Les données restent en aperçu jusqu’à votre validation.</p>
      </div>
      <span class="admin-result-import-badge">Administrateur</span>
    </div>
    <div class="admin-result-import-controls">
      <label><span>Pays</span><select data-result-import-country>${COUNTRIES.map(([code, name]) => `<option value="${code}"${code === 'CI' ? ' selected' : ''}>${name}${code === '__custom' ? '' : ` (${code})`}</option>`).join('')}</select><input data-result-import-country-custom type="text" placeholder="Nom ou code du pays (ex. Angola ou AO)" hidden></label>
      <label><span>Date de secours</span><input data-result-import-date type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label class="admin-result-import-file"><span>Image / PDF / fichier</span><input data-result-import-file type="file" accept="image/*,.pdf,.txt,.csv,.tsv,.json"></label>
    </div>
    <label class="admin-result-import-schedule"><span>Horaires de routine si l’image ne les indique pas</span><textarea data-result-import-schedule>${DEFAULT_SCHEDULE}</textarea><small>Format : <code>Awale=16:00</code> ou <code>lundi | Awale=16:00</code>. Une règle enregistrée sera réutilisée pour les prochains imports.</small></label>
    <div class="admin-result-import-routine-actions"><button type="button" class="admin-v3-button admin-v3-button--secondary" data-result-import-save-schedule>Enregistrer ces routines</button><span class="admin-v3-status" data-result-import-routine-status role="status"></span></div>
    <label class="admin-result-import-paste"><span>Ou coller le texte des résultats</span><textarea data-result-import-text placeholder="Exemple : NIGER MARS 2026&#10;31-03-2026&#10;Heure 15:00&#10;Tirage 2798&#10;Gagnants 46 - 73 - 11 - 41 - 36&#10;&#10;Bénin 8h&#10;15-09-2026&#10;Gagnants : 01-20-44-80-76&#10;&#10;Côte d’Ivoire 7h&#10;Tirage:145&#10;Gagnants: 30-56-05-80-77&#10;Machines: 11-85-40-35-52&#10;Bonus : 67"></textarea></label>
    <div class="admin-result-import-actions">
      <button type="button" class="admin-v3-button admin-v3-button--primary" data-result-import-analyze>Analyser le document</button>
      <span class="admin-v3-status" data-result-import-status role="status"></span>
    </div>
    <div class="admin-result-import-summary" data-result-import-summary>Aucun document analysé.</div>
    <div class="admin-result-import-preview" data-result-import-preview></div>
    <div class="admin-result-import-actions admin-result-import-save-actions">
      <button type="button" class="admin-v3-button admin-v3-button--primary" data-result-import-save disabled>Valider et enregistrer les résultats</button>
    </div>`;

  const state = { rows: [], warnings: [] };
  const status = root.querySelector('[data-result-import-status]');
  const analyzeButton = root.querySelector('[data-result-import-analyze]');
  const saveButton = root.querySelector('[data-result-import-save]');
  const saveScheduleButton = root.querySelector('[data-result-import-save-schedule]');
  const routineStatus = root.querySelector('[data-result-import-routine-status]');
  const selectedCountryCode = () => {
    const selected = root.querySelector('[data-result-import-country]').value;
    return selected === '__custom'
      ? normalizeCountryCode(root.querySelector('[data-result-import-country-custom]')?.value || '')
      : selected;
  };
  const syncCustomCountry = () => {
    const custom = root.querySelector('[data-result-import-country-custom]');
    const isCustom = root.querySelector('[data-result-import-country]').value === '__custom';
    if (custom) {
      custom.hidden = !isCustom;
      custom.required = isCustom;
    }
  };
  const setStatus = (message, kind = '') => {
    status.textContent = message;
    status.className = `admin-v3-status${kind ? ` is-${kind}` : ''}`;
  };
  const updateSaveAvailability = () => {
    const rows = readRows(root);
    saveButton.disabled = !rows.length
      || rows.some((row) => !row.countryCode || !row.drawDate || !row.drawTime || !row.first.length);
  };
  root.querySelector('[data-result-import-preview]').addEventListener('input', updateSaveAvailability);
  root.querySelector('[data-result-import-preview]').addEventListener('change', updateSaveAvailability);

  const loadRoutineText = async () => {
    if (typeof loadSchedules !== 'function') return;
    const countryCode = selectedCountryCode();
    try {
      const result = await loadSchedules(countryCode);
      const text = scheduleTextFromRows(result?.schedules || []);
      if (text) root.querySelector('[data-result-import-schedule]').value = text;
    } catch (error) {
      routineStatus.textContent = error?.message || 'Les routines existantes ne peuvent pas être chargées.';
      routineStatus.className = 'admin-v3-status is-error';
    }
  };
  root.querySelector('[data-result-import-country]').addEventListener('change', () => {
    syncCustomCountry();
    void loadRoutineText();
  });
  saveScheduleButton.addEventListener('click', async () => {
    if (typeof saveSchedules !== 'function') {
      routineStatus.textContent = 'La sauvegarde des routines est indisponible.';
      routineStatus.className = 'admin-v3-status is-error';
      return;
    }
    const countryCode = selectedCountryCode();
    const schedules = parseScheduleRows(root.querySelector('[data-result-import-schedule]').value)
      .map((row) => ({
        programName: row.programName,
        dayOfWeek: row.dayOfWeek,
        drawTime: row.drawTime
      }));
    if (!schedules.length) {
      routineStatus.textContent = 'Ajoutez au moins une routine valide.';
      routineStatus.className = 'admin-v3-status is-error';
      return;
    }
    saveScheduleButton.disabled = true;
    routineStatus.textContent = 'Enregistrement des routines…';
    routineStatus.className = 'admin-v3-status';
    try {
      const result = await saveSchedules(countryCode, schedules);
      routineStatus.textContent = result?.message || 'Routines enregistrées.';
      routineStatus.className = 'admin-v3-status is-success';
    } catch (error) {
      routineStatus.textContent = error?.message || 'Les routines n’ont pas été enregistrées.';
      routineStatus.className = 'admin-v3-status is-error';
    } finally {
      saveScheduleButton.disabled = false;
    }
  });

  analyzeButton.addEventListener('click', async () => {
    const file = root.querySelector('[data-result-import-file]').files?.[0] || null;
    const pasted = root.querySelector('[data-result-import-text]').value || '';
    if (!file && !pasted.trim()) {
      setStatus('Ajoutez une image/PDF ou collez le texte des résultats.', 'error');
      return;
    }
    analyzeButton.disabled = true;
    saveButton.disabled = true;
    setStatus('Lecture et analyse en cours…');
    try {
      const country = selectedCountryCode();
      const countryName = COUNTRIES.find(([code]) => code === country)?.[1] || country;
      const fallbackDate = root.querySelector('[data-result-import-date]').value;
      const source = file ? await readInputFile(file) : { images: [], text: pasted };
      const payload = await analyzeWithModel({
        countryCode: country,
        countryName,
        fallbackDate,
        text: `${source.text}\n${pasted}`.trim(),
        images: source.images
      });
      const normalized = normalizeDraft(payload, {
        countryCode: country,
        fallbackDate,
        scheduleText: root.querySelector('[data-result-import-schedule]').value
      });
      state.rows = normalized.rows;
      state.warnings = normalized.warnings;
      renderPreview(root, state);
      setStatus(
        `${state.rows.length} tirage(s) analysé(s). Relisez chaque ligne avant validation.`,
        state.rows.length ? 'success' : 'error'
      );
    } catch (error) {
      state.rows = [];
      state.warnings = [];
      renderPreview(root, state);
      setStatus(error?.message || 'Analyse impossible.', 'error');
    } finally {
      analyzeButton.disabled = false;
    }
  });

  saveButton.addEventListener('click', async () => {
    const draws = readRows(root);
    if (!draws.length || draws.some((row) => !row.countryCode || !row.drawDate || !row.drawTime || !row.first.length)) {
      setStatus('Chaque ligne doit contenir un pays, une date, une heure et les numéros gagnants.', 'error');
      return;
    }
    saveButton.disabled = true;
    // The server publishes one country per request; long histories are sent
    // in chunks so a paste covering every day since 2025 stays under its limit.
    const byCountry = new Map();
    draws.forEach((row) => {
      const { countryCode, ...draw } = row;
      if (!byCountry.has(countryCode)) byCountry.set(countryCode, []);
      byCountry.get(countryCode).push(draw);
    });
    const batches = [];
    byCountry.forEach((rows, countryCode) => {
      for (let start = 0; start < rows.length; start += IMPORT_CHUNK_SIZE) {
        batches.push({ countryCode, draws: rows.slice(start, start + IMPORT_CHUNK_SIZE) });
      }
    });
    let inserted = 0;
    let duplicates = 0;
    try {
      for (const [index, batch] of batches.entries()) {
        setStatus(`Enregistrement sécurisé en cours… (${index + 1}/${batches.length})`);
        const result = await onSave({ ...batch, source: 'admin-import-document' });
        inserted += Number(result?.inserted ?? batch.draws.length) || 0;
        duplicates += Array.isArray(result?.duplicates) ? result.duplicates.length : 0;
      }
      setStatus(
        `${inserted} nouveau(x) tirage(s) enregistré(s).${duplicates ? ` ${duplicates} tirage(s) déjà présent(s) en base ignoré(s).` : ''}`,
        'success'
      );
      root.querySelector('[data-result-import-preview]').replaceChildren();
      root.querySelector('[data-result-import-summary]').textContent = 'Import validé.';
      state.rows = [];
      // A failed dashboard refresh must not hide a successful import.
      if (typeof onComplete === 'function') await Promise.resolve(onComplete()).catch(() => {});
    } catch (error) {
      const done = inserted ? ` ${inserted} tirage(s) déjà enregistré(s) avant l’erreur ; relancez l’import, les doublons seront ignorés.` : '';
      setStatus(`${error?.message || 'Les résultats n’ont pas été enregistrés.'}${done}`, 'error');
      saveButton.disabled = false;
    }
  });

  syncCustomCountry();
  void loadRoutineText();
  return root;
}
