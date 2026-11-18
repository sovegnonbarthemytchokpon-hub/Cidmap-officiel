/*
 * Result-helf — contrat de comparaison des pronostics et des tirages réels.
 *
 * Ce module conserve la règle métier dans le code du projet afin qu'elle ne
 * dépende pas d'une conversation ou d'une version d'interface.
 *
 * Règles enregistrées :
 * - NAP1 est une liste de possibilités : un seul numéro retrouvé suffit ;
 * - NAP2 exige que tous ses numéros soient retrouvés ;
 * - une combinaison est évaluée comme NAP2 ;
 * - un numéro dans le premier tirage est une réussite forte ;
 * - un numéro dans la machine est une réussite secondaire ;
 * - les bonus restent identifiés séparément ;
 * - les valeurs sont toujours celles du snapshot du programme et de la date,
 *   jamais des valeurs recalculées après coup.
 *
 * Ce fichier ne contient aucun numéro d'exemple en dur.
 */

export const RESULTAT_AIDE_VERSION = 2;
export const RESULTAT_AIDE_DELAY_OFFSETS = [0, 1, 2, 3, 7] as const;

export type DrawGroup = 'first' | 'machine' | 'bonus';
export type MatchLevel = (
  | 'none'
  | 'partial'
  | 'secondary'
  | 'strong'
  | 'extraordinary'
  | 'mixed'
);
export type PredictionKind =
  | 'key'
  | 'order'
  | 'cross'
  | 'satellite'
  | 'nap1'
  | 'nap2'
  | 'combination'
  | 'permutation';

export type RealDraw = {
  countryCode: string;
  drawDate: string;
  drawTime?: string | null;
  first: number[];
  machine: number[];
  bonus?: number[];
  status: 'pending' | 'published' | 'rejected' | 'disputed';
  source?: string | null;
};

export type PredictionCombination = {
  label?: string;
  numbers: number[];
  satelliteValue?: number | null;
  combinationIndex?: number | null;
};

export type PredictionSatellite = {
  value: number;
  combinations: PredictionCombination[];
};

export type ProgramPredictionSnapshot = {
  snapshotId: string;
  countryCode: string;
  programmeDate: string;
  drawTime?: string | null;
  programKey: string;
  programName: string;
  key?: string | null;
  order?: string | null;
  cross?: number[];
  satellites?: number[];
  satelliteDetails?: PredictionSatellite[];
  nap1?: number[];
  nap2?: number[];
  combinations?: PredictionCombination[];
  createdAt: string;
  calculationVersion?: string | number | null;
};

export type PredictionMatch = {
  snapshotId: string;
  countryCode: string;
  programmeDate: string;
  drawTime?: string | null;
  programKey: string;
  programName: string;
  kind: PredictionKind;
  predictedNumbers: number[];
  matchedNumbers: number[];
  matchedGroups: DrawGroup[];
  level: MatchLevel;
  hit: boolean;
  publishedDrawStatus: RealDraw['status'];
  drawDate: string;
  dayOffset: number;
  predictionDay: string;
  drawDay: string;
  predictionLabel?: string | null;
  satelliteValue?: number | null;
  combinationIndex?: number | null;
  permutationLabel?: string | null;
  permutationNumbers?: number[];
  permutationCombinationIndexes?: number[];
};

export type ResultatAideSnapshot = {
  version: number;
  countryCode: string;
  programmeDate: string;
  predictions: ProgramPredictionSnapshot[];
  realDraw?: RealDraw | null;
  matches: PredictionMatch[];
  createdAt: string;
};

export type ResultatAideMetric = {
  attempts: number;
  hits: number;
  percentage: number;
};

export type ResultatAideWeeklyStats = {
  countryCode: string;
  weekKey: string;
  programKey: string;
  programName: string;
  drawsEvaluated: number;
  key: ResultatAideMetric;
  order: ResultatAideMetric;
  nap1: ResultatAideMetric;
  nap2: ResultatAideMetric;
  combination: ResultatAideMetric;
  satellite: ResultatAideMetric;
  permutation: ResultatAideMetric;
  overall: ResultatAideMetric;
};

export type ResultatAideDelayStats = {
  countryCode: string;
  dayOffset: number;
  predictionDayOfWeek: number;
  predictionDayName: string;
  drawDayOfWeek: number;
  drawDayName: string;
  programKey: string;
  programName: string;
  drawsEvaluated: number;
  key: ResultatAideMetric;
  order: ResultatAideMetric;
  nap1: ResultatAideMetric;
  nap2: ResultatAideMetric;
  combination: ResultatAideMetric;
  satellite: ResultatAideMetric;
  permutation: ResultatAideMetric;
  overall: ResultatAideMetric;
};

export type ResultatAideAdminRecord = {
  countryCode: string;
  drawDate: string;
  drawTime: string | null;
  dayKey: string;
  weekKey: string;
  monthKey: string;
  dayOfWeek: number;
  programKey: string;
  programName: string;
  match: PredictionMatch;
};

export type ResultatAidePublicSuggestion = {
  countryCode: string;
  weekKey: string;
  programKey: string;
  programName: string;
  percentage: number;
  drawsEvaluated: number;
};

export type ResultatAideDayStats = ResultatAideWeeklyStats & {
  dayOfWeek: number;
  dayName: string;
};

function metric(attempts: number, hits: number): ResultatAideMetric {
  return {
    attempts,
    hits,
    percentage: attempts ? Math.round((hits / attempts) * 1000) / 10 : 0
  };
}

function weekKeyFromDate(value: string): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    (((date.getTime() - yearStart.getTime()) / 86400000) + 1)
      / 7
  );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const DAY_NAMES = [
  'Dimanche', 'Lundi', 'Mardi', 'Mercredi',
  'Jeudi', 'Vendredi', 'Samedi'
];

function dayOfWeekFromDate(value: string): number {
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? -1 : date.getUTCDay();
}

function dayNameFromDate(value: string): string {
  const day = dayOfWeekFromDate(value);
  return day >= 0 ? DAY_NAMES[day] : '';
}

function dateDistance(left: string, right: string): number {
  return Math.round((
    Date.parse(`${right}T12:00:00.000Z`)
    - Date.parse(`${left}T12:00:00.000Z`)
  ) / 86400000);
}

function numberPairs(value: unknown): number[] {
  const digits = String(value ?? '').replace(/\D/g, '');
  const pairs = digits.match(/\d{2}/g) || [];
  // A key and an order are always three two-digit numbers.
  return uniqueNumbers(pairs.map(Number)).slice(0, 3);
}

/*
 * Builds the stable weekly chart rows. Every evaluated prediction is counted,
 * including a miss, so a programme with no victory remains visible at 0%.
 * The returned rows contain percentages only; no key, order or number is
 * exposed to the public/subscriber chart.
 */
export function buildWeeklyStats(
  matches: PredictionMatch[]
): ResultatAideWeeklyStats[] {
  const rows = new Map<string, {
    countryCode: string;
    weekKey: string;
    programKey: string;
    programName: string;
    dates: Set<string>;
    counts: Record<PredictionKind, { attempts: number; hits: number }>;
  }>();
  const kinds: PredictionKind[] = [
    'key', 'order', 'nap1', 'nap2', 'combination', 'satellite', 'permutation'
  ];

  for (const match of matches) {
    // The weekly chart is the direct same-day baseline. Delayed repetitions
    // are kept in the dedicated delay statistics below.
    if (match.dayOffset !== 0) continue;
    if (!kinds.includes(match.kind)) continue;
    const weekKey = weekKeyFromDate(match.programmeDate);
    if (!weekKey) continue;
    const id = [
      match.countryCode,
      weekKey,
      match.programKey
    ].join('|');
    let row = rows.get(id);
    if (!row) {
      row = {
        countryCode: match.countryCode,
        weekKey,
        programKey: match.programKey,
        programName: match.programName,
        dates: new Set(),
        counts: Object.fromEntries(
          kinds.map((kind) => [kind, { attempts: 0, hits: 0 }])
        ) as Record<PredictionKind, { attempts: number; hits: number }>
      };
      rows.set(id, row);
    }
    row.dates.add(match.programmeDate);
    /*
      A key/order contains several two-digit numbers. Their graph percentage
      counts each number separately. NAP1 remains one prediction: one of its
      alternatives is enough. NAP2 and combinations remain complete pairs.
    */
    const attempts = match.kind === 'key' || match.kind === 'order'
      ? match.predictedNumbers.length
      : 1;
    const hits = match.kind === 'key' || match.kind === 'order'
      ? match.matchedNumbers.length
      : (match.hit ? 1 : 0);
    row.counts[match.kind].attempts += attempts;
    row.counts[match.kind].hits += hits;
  }

  return [...rows.values()]
    .map((row) => {
      const make = (kind: PredictionKind) => metric(
        row.counts[kind].attempts,
        row.counts[kind].hits
      );
      const attempts = kinds.reduce(
        (sum, kind) => sum + row.counts[kind].attempts,
        0
      );
      const hits = kinds.reduce(
        (sum, kind) => sum + row.counts[kind].hits,
        0
      );
      return {
        countryCode: row.countryCode,
        weekKey: row.weekKey,
        programKey: row.programKey,
        programName: row.programName,
        drawsEvaluated: row.dates.size,
        key: make('key'),
        order: make('order'),
        nap1: make('nap1'),
        nap2: make('nap2'),
        combination: make('combination'),
        satellite: make('satellite'),
        permutation: make('permutation'),
        overall: metric(attempts, hits)
      };
    })
    .sort((left, right) => (
      left.countryCode.localeCompare(right.countryCode)
      || left.weekKey.localeCompare(right.weekKey)
      || right.overall.percentage - left.overall.percentage
      || left.programName.localeCompare(right.programName)
    ));
}

/*
 * Décalage historique : les statistiques sont indexées sur le jour de la
 * proposition et gardent aussi le jour du tirage. Ainsi dimanche → lundi ne
 * peut jamais être confondu avec une réussite directe du lundi.
 */
export function buildDelayStats(
  matches: PredictionMatch[]
): ResultatAideDelayStats[] {
  const rows = new Map<string, {
    countryCode: string;
    dayOffset: number;
    predictionDayOfWeek: number;
    predictionDayName: string;
    drawDayOfWeek: number;
    drawDayName: string;
    programKey: string;
    programName: string;
    dates: Set<string>;
    counts: Record<PredictionKind, { attempts: number; hits: number }>;
  }>();
  const kinds: PredictionKind[] = [
    'key', 'order', 'nap1', 'nap2', 'combination', 'satellite', 'permutation'
  ];
  for (const match of matches) {
    if (!kinds.includes(match.kind)) continue;
    const predictionDayOfWeek = dayOfWeekFromDate(match.programmeDate);
    const drawDayOfWeek = dayOfWeekFromDate(match.drawDate);
    if (predictionDayOfWeek < 0 || drawDayOfWeek < 0) continue;
    const key = [
      match.countryCode, match.dayOffset, predictionDayOfWeek,
      drawDayOfWeek, match.programKey
    ].join('|');
    let row = rows.get(key);
    if (!row) {
      row = {
        countryCode: match.countryCode,
        dayOffset: match.dayOffset,
        predictionDayOfWeek,
        predictionDayName: DAY_NAMES[predictionDayOfWeek],
        drawDayOfWeek,
        drawDayName: DAY_NAMES[drawDayOfWeek],
        programKey: match.programKey,
        programName: match.programName,
        dates: new Set(),
        counts: Object.fromEntries(
          kinds.map((kind) => [kind, { attempts: 0, hits: 0 }])
        ) as Record<PredictionKind, { attempts: number; hits: number }>
      };
      rows.set(key, row);
    }
    row.dates.add(match.drawDate);
    const attempts = match.kind === 'key' || match.kind === 'order'
      ? match.predictedNumbers.length
      : 1;
    const hits = match.kind === 'key' || match.kind === 'order'
      ? match.matchedNumbers.length
      : (match.hit ? 1 : 0);
    row.counts[match.kind].attempts += attempts;
    row.counts[match.kind].hits += hits;
  }
  return [...rows.values()].map((row) => {
    const make = (kind: PredictionKind) => metric(
      row.counts[kind].attempts,
      row.counts[kind].hits
    );
    const attempts = kinds.reduce(
      (sum, kind) => sum + row.counts[kind].attempts, 0
    );
    const hits = kinds.reduce(
      (sum, kind) => sum + row.counts[kind].hits, 0
    );
    return {
      countryCode: row.countryCode,
      dayOffset: row.dayOffset,
      predictionDayOfWeek: row.predictionDayOfWeek,
      predictionDayName: row.predictionDayName,
      drawDayOfWeek: row.drawDayOfWeek,
      drawDayName: row.drawDayName,
      programKey: row.programKey,
      programName: row.programName,
      drawsEvaluated: row.dates.size,
      key: make('key'),
      order: make('order'),
      nap1: make('nap1'),
      nap2: make('nap2'),
      combination: make('combination'),
      satellite: make('satellite'),
      permutation: make('permutation'),
      overall: metric(attempts, hits)
    };
  }).sort((left, right) => (
    left.countryCode.localeCompare(right.countryCode)
    || left.dayOffset - right.dayOffset
    || left.predictionDayOfWeek - right.predictionDayOfWeek
    || left.drawDayOfWeek - right.drawDayOfWeek
    || left.programName.localeCompare(right.programName)
  ));
}

export function buildAdminRecords(
  predictions: ProgramPredictionSnapshot[],
  draw: RealDraw
): ResultatAideAdminRecord[] {
  const normalizedDraw = normalizeDraw(draw);
  const matches = comparePublishedDraw(predictions, normalizedDraw);
  const date = new Date(`${normalizedDraw.drawDate}T12:00:00.000Z`);
  const dayOfWeek = Number.isNaN(date.getTime())
    ? 0
    : date.getUTCDay();
  const dayKey = normalizedDraw.drawDate;
  const monthKey = normalizedDraw.drawDate.slice(0, 7);
  const weekKey = weekKeyFromDate(normalizedDraw.drawDate);
  return matches.map((match) => ({
    countryCode: normalizedDraw.countryCode,
    drawDate: normalizedDraw.drawDate,
    drawTime: normalizedDraw.drawTime || null,
    dayKey,
    weekKey,
    monthKey,
    dayOfWeek,
    programKey: match.programKey,
    programName: match.programName,
    match: {
      ...match,
      publishedDrawStatus: normalizedDraw.status
    }
  }));
}

/*
 * Public suggestion projection: only the strongest weekly programme is
 * returned. Keys, orders, NAP values and matched numbers never leave the
 * administrator analytics boundary.
 */
export function buildPublicSuggestions(
  stats: ResultatAideWeeklyStats[]
): ResultatAidePublicSuggestion[] {
  const best = new Map<string, ResultatAidePublicSuggestion>();
  for (const row of stats) {
    const suggestion: ResultatAidePublicSuggestion = {
      countryCode: row.countryCode,
      weekKey: row.weekKey,
      programKey: row.programKey,
      programName: row.programName,
      percentage: row.overall.percentage,
      drawsEvaluated: row.drawsEvaluated
    };
    const key = `${row.countryCode}|${row.weekKey}`;
    const previous = best.get(key);
    if (
      !previous
      || suggestion.percentage > previous.percentage
      || (
        suggestion.percentage === previous.percentage
        && suggestion.drawsEvaluated > previous.drawsEvaluated
      )
    ) {
      best.set(key, suggestion);
    }
  }
  return [...best.values()].sort((left, right) => (
    left.countryCode.localeCompare(right.countryCode)
    || left.weekKey.localeCompare(right.weekKey)
  ));
}

export function buildDayOfWeekStats(
  matches: PredictionMatch[]
): ResultatAideDayStats[] {
  const rows = new Map<string, {
    countryCode: string;
    dayOfWeek: number;
    dayName: string;
    programKey: string;
    programName: string;
    dates: Set<string>;
    counts: Record<PredictionKind, { attempts: number; hits: number }>;
  }>();
  const kinds: PredictionKind[] = [
    'key', 'order', 'nap1', 'nap2', 'combination', 'satellite', 'permutation'
  ];
  for (const match of matches) {
    if (match.dayOffset !== 0) continue;
    if (!kinds.includes(match.kind)) continue;
    const date = new Date(`${match.programmeDate}T12:00:00.000Z`);
    if (Number.isNaN(date.getTime())) continue;
    const dayOfWeek = date.getUTCDay();
    const key = [
      match.countryCode, dayOfWeek, match.programKey
    ].join('|');
    let row = rows.get(key);
    if (!row) {
      row = {
        countryCode: match.countryCode,
        dayOfWeek,
        dayName: DAY_NAMES[dayOfWeek],
        programKey: match.programKey,
        programName: match.programName,
        dates: new Set(),
        counts: Object.fromEntries(
          kinds.map((kind) => [kind, { attempts: 0, hits: 0 }])
        ) as Record<PredictionKind, { attempts: number; hits: number }>
      };
      rows.set(key, row);
    }
    row.dates.add(match.programmeDate);
    const attempts = match.kind === 'key' || match.kind === 'order'
      ? match.predictedNumbers.length : 1;
    const hits = match.kind === 'key' || match.kind === 'order'
      ? match.matchedNumbers.length : (match.hit ? 1 : 0);
    row.counts[match.kind].attempts += attempts;
    row.counts[match.kind].hits += hits;
  }
  return [...rows.values()].map((row) => {
    const make = (kind: PredictionKind) => metric(
      row.counts[kind].attempts,
      row.counts[kind].hits
    );
    const attempts = kinds.reduce((sum, kind) => sum + row.counts[kind].attempts, 0);
    const hits = kinds.reduce((sum, kind) => sum + row.counts[kind].hits, 0);
    return {
      countryCode: row.countryCode,
      weekKey: '',
      dayOfWeek: row.dayOfWeek,
      dayName: row.dayName,
      programKey: row.programKey,
      programName: row.programName,
      drawsEvaluated: row.dates.size,
      key: make('key'),
      order: make('order'),
      nap1: make('nap1'),
      nap2: make('nap2'),
      combination: make('combination'),
      satellite: make('satellite'),
      permutation: make('permutation'),
      overall: metric(attempts, hits)
    };
  }).sort((left, right) => (
    left.countryCode.localeCompare(right.countryCode)
    || left.dayOfWeek - right.dayOfWeek
    || right.overall.percentage - left.overall.percentage
    || left.programName.localeCompare(right.programName)
  ));
}

function uniqueNumbers(values: unknown): number[] {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 90)
  )];
}

export function normalizeDraw(draw: RealDraw): RealDraw {
  return {
    ...draw,
    countryCode: String(draw.countryCode || '').trim().toUpperCase(),
    drawDate: String(draw.drawDate || '').trim(),
    first: uniqueNumbers(draw.first),
    machine: uniqueNumbers(draw.machine),
    bonus: uniqueNumbers(draw.bonus)
  };
}

function groupsForNumber(number: number, draw: RealDraw): DrawGroup[] {
  const groups: DrawGroup[] = [];
  if (draw.first.includes(number)) groups.push('first');
  if (draw.machine.includes(number)) groups.push('machine');
  if (draw.bonus?.includes(number)) groups.push('bonus');
  return groups;
}

function levelForMatchedNumbers(
  predictedNumbers: number[],
  matchedNumbers: number[],
  draw: RealDraw,
  minimumHits: number
): MatchLevel {
  if (!matchedNumbers.length) return 'none';
  if (matchedNumbers.length < minimumHits) {
    return 'partial';
  }
  if (matchedNumbers.length === predictedNumbers.length) {
    return 'extraordinary';
  }
  const matchedGroups = matchedNumbers.flatMap((number) => (
    groupsForNumber(number, draw)
  ));
  const allInFirst = matchedNumbers.every((number) =>
    draw.first.includes(number)
  );
  const allInMachine = matchedNumbers.every((number) =>
    draw.machine.includes(number)
  );
  const allInBonus = matchedNumbers.every((number) =>
    draw.bonus?.includes(number)
  );
  if (allInFirst) return 'strong';
  if (allInMachine) return 'secondary';
  if (allInBonus) return 'secondary';
  if (matchedGroups.length) return 'mixed';
  return 'none';
}

function matchNumbers(
  snapshot: ProgramPredictionSnapshot,
  kind: PredictionKind,
  predicted: unknown,
  draw: RealDraw,
  minimumHits: number,
  metadata: Partial<PredictionMatch> = {}
): PredictionMatch {
  const predictedNumbers = uniqueNumbers(predicted);
  const matchedNumbers = predictedNumbers.filter((number) =>
    groupsForNumber(number, draw).length > 0
  );
  const matchedGroups = [...new Set(
    matchedNumbers.flatMap((number) => groupsForNumber(number, draw))
  )];
  const level = levelForMatchedNumbers(
    predictedNumbers,
    matchedNumbers,
    draw,
    minimumHits
  );
  return {
    snapshotId: snapshot.snapshotId,
    countryCode: snapshot.countryCode,
    programmeDate: snapshot.programmeDate,
    programKey: snapshot.programKey,
    programName: snapshot.programName,
    kind,
    predictedNumbers,
    matchedNumbers,
    matchedGroups,
    level,
    hit: predictedNumbers.length >= minimumHits
      && matchedNumbers.length >= minimumHits,
    publishedDrawStatus: draw.status,
    drawDate: draw.drawDate,
    dayOffset: dateDistance(snapshot.programmeDate, draw.drawDate),
    predictionDay: dayNameFromDate(snapshot.programmeDate),
    drawDay: dayNameFromDate(draw.drawDate),
    ...metadata
  };
}

export function comparePrediction(
  snapshot: ProgramPredictionSnapshot,
  drawInput: RealDraw,
  metadata: Partial<PredictionMatch> = {}
): PredictionMatch[] {
  const draw = normalizeDraw(drawInput);
  const matches: PredictionMatch[] = [];
  const addAny = (kind: PredictionKind, values: unknown) => {
    const numbers = uniqueNumbers(values);
    if (numbers.length) {
      matches.push(matchNumbers(snapshot, kind, numbers, draw, 1, metadata));
    }
  };
  const addMinimum = (
    kind: PredictionKind,
    values: unknown,
    minimumHits: number
  ) => {
    const numbers = uniqueNumbers(values);
    if (numbers.length) {
      matches.push(matchNumbers(snapshot, kind, numbers, draw, minimumHits, metadata));
    }
  };
  const addAll = (kind: PredictionKind, values: unknown) => {
    const numbers = uniqueNumbers(values);
    if (numbers.length) {
      matches.push(matchNumbers(snapshot, kind, numbers, draw, numbers.length, metadata));
    }
  };

  // A key and an order contain three numbers: two are a victory, three are
  // extraordinary. One alone remains a partial result.
  addMinimum('key', numberPairs(snapshot.key), 2);
  addMinimum('order', numberPairs(snapshot.order), 2);
  addAny('cross', snapshot.cross);
  if (snapshot.satelliteDetails?.length) {
    // Each satellite remains a separate attempt. Its combinations and its
    // permutation are evaluated below with their parent relationship.
  } else {
    addAny('satellite', snapshot.satellites);
  }

  // NAP1 is OR: one of the announced possibilities is enough.
  addAny('nap1', snapshot.nap1);
  // NAP2 is AND: every number in the pair must be present.
  addAll('nap2', snapshot.nap2);

  if (!snapshot.satelliteDetails?.length) {
    for (const combination of snapshot.combinations || []) {
      // Every combination is evaluated with the NAP2/AND rule.
      addAllWithMetadata('combination', combination.numbers, combination);
    }
  }

  for (const satellite of snapshot.satelliteDetails || []) {
    const satelliteNumbers = uniqueNumbers([satellite.value]);
    if (satelliteNumbers.length) {
      matches.push(matchNumbers(
        snapshot,
        'satellite',
        satelliteNumbers,
        draw,
        1,
        {
          predictionLabel: `Satellite ${satellite.value}`,
          satelliteValue: satellite.value
        }
      ));
    }
    for (const combination of satellite.combinations || []) {
      addAllWithMetadata('combination', combination.numbers, combination);
    }
    const permutationNumbers = uniqueNumbers([
      satellite.value,
      ...(satellite.combinations || []).flatMap((item) => item.numbers)
    ]);
    if (permutationNumbers.length >= 3) {
      matches.push(matchNumbers(
        snapshot,
        'permutation',
        permutationNumbers,
        draw,
        2,
        {
          predictionLabel: `Permutation satellite ${satellite.value}`,
          satelliteValue: satellite.value,
          permutationLabel: `Satellite ${satellite.value} + combinaisons`,
          permutationNumbers,
          permutationCombinationIndexes: (satellite.combinations || [])
            .map((item) => Number(item.combinationIndex))
            .filter(Number.isInteger)
        }
      ));
    }
  }
  return matches;

  function addAllWithMetadata(
    kind: PredictionKind,
    values: unknown,
    combination: PredictionCombination
  ) {
    const numbers = uniqueNumbers(values);
    if (!numbers.length) return;
    matches.push(matchNumbers(snapshot, kind, numbers, draw, numbers.length, {
      predictionLabel: combination.label || null,
      satelliteValue: combination.satelliteValue ?? null,
      combinationIndex: combination.combinationIndex ?? null
    }));
  }
}

export function comparePublishedDraw(
  predictions: ProgramPredictionSnapshot[],
  drawInput: RealDraw
): PredictionMatch[] {
  return comparePublishedDraws(predictions, drawInput, [0]);
}

export function comparePublishedDraws(
  predictions: ProgramPredictionSnapshot[],
  drawInput: RealDraw,
  allowedOffsets: readonly number[] = RESULTAT_AIDE_DELAY_OFFSETS
): PredictionMatch[] {
  const draw = normalizeDraw(drawInput);
  if (draw.status !== 'published') return [];
  return predictions
    .filter((snapshot) => (
      snapshot.countryCode.toUpperCase() === draw.countryCode
      && allowedOffsets.includes(dateDistance(snapshot.programmeDate, draw.drawDate))
    ))
    .flatMap((snapshot) => comparePrediction(snapshot, draw, {
      dayOffset: dateDistance(snapshot.programmeDate, draw.drawDate)
    }));
}

export function buildResultatAideSnapshot(
  predictions: ProgramPredictionSnapshot[],
  draw: RealDraw | null = null,
  createdAt = new Date().toISOString()
): ResultatAideSnapshot {
  const normalizedDraw = draw ? normalizeDraw(draw) : null;
  return {
    version: RESULTAT_AIDE_VERSION,
    countryCode: normalizedDraw?.countryCode
      || predictions[0]?.countryCode
      || '',
    programmeDate: normalizedDraw?.drawDate
      || predictions[0]?.programmeDate
      || '',
    predictions: predictions.map((prediction) => ({
      ...prediction,
      nap1: uniqueNumbers(prediction.nap1),
      nap2: uniqueNumbers(prediction.nap2),
      cross: uniqueNumbers(prediction.cross),
      satellites: uniqueNumbers(prediction.satellites),
      satelliteDetails: (prediction.satelliteDetails || []).map((satellite) => ({
        value: Number(satellite.value),
        combinations: (satellite.combinations || []).map((combination, index) => ({
          ...combination,
          satelliteValue: Number(satellite.value),
          combinationIndex: combination.combinationIndex ?? index + 1,
          numbers: uniqueNumbers(combination.numbers)
        })).filter((combination) => combination.numbers.length >= 2)
      })).filter((satellite) => Number.isInteger(satellite.value)),
      combinations: (prediction.combinations || []).map((combination) => ({
        ...combination,
        numbers: uniqueNumbers(combination.numbers)
      }))
    })),
    realDraw: normalizedDraw,
    matches: normalizedDraw
      ? comparePublishedDraw(predictions, normalizedDraw)
      : [],
    createdAt
  };
}
