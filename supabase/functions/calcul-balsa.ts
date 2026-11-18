import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  enforceEarlyAccess,
  enforceFeatureAccess,
  NigerResultContext,
  readOptionalNigerResult
} from './_shared.ts';

/*
 * Balsa Plus — serveur autonome.
 *
 * Ce fichier contient tout le moteur Balsa et son handler HTTP. Le point
 * d'entrée `calcul-balsa/index.ts` appelle ce handler ; le moteur peut ainsi
 * aussi être réutilisé par Stand-by et Robot sans lancer un second serveur.
 * Il ne contient plus l'ancien générateur qui réduisait les résultats en 01,
 * 02, 03, 04, 05, etc.
 *
 * Règle de calcul :
 *   - les numéros produits par la date sont conservés uniquement entre 10 et 90 ;
 *   - un appel multiplicatif réel est prioritaire ;
 *   - les appels addition/soustraction servent de repli ;
 *   - la clé et la croix sont construites avec des valeurs réelles ;
 *   - les satellites sont recalculés uniquement à partir des quatre chiffres
 *     de la croix et leurs combinaisons sont persistées.
 */

type CombinationPart = {
  value: number;
  yellow: boolean;
};

type Combination = Array<CombinationPart> & {
  operator?: '+' | '−';
};

type Cross = {
  top: string;
  bottom: string;
  left: string;
  right: string;
  base1: number;
  base2: number;
};

type Satellite = {
  value: number;
  operation: 'addition' | 'subtraction';
  combinations: Combination[];
};

type MultiplicationCall = {
  caller: number;
  called: number;
  tens: number;
  units: number;
  operation: 'multiplication';
  expression: string;
  callerParity: 'impair' | 'pair';
};

type FallbackCall = {
  callers: number[];
  called: number;
  operation: 'addition' | 'soustraction';
  expressions: string[];
};

const TIME_ZONE = 'Africa/Abidjan';
const BALSA_CALCULATION_VERSION = 10;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders
  });
}

function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) {
    throw new Error('Configuration Supabase serveur incomplète.');
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function sumDigits(value: unknown): number {
  return String(value ?? '')
    .replace(/\D/g, '')
    .split('')
    .reduce((sum, digit) => sum + Number(digit), 0);
}

function pad2(value: unknown): string {
  return String(value ?? '').padStart(2, '0').slice(-2);
}

function dateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isRealNumber(value: unknown): boolean {
  const number = Number(value);
  return Number.isInteger(number) && number >= 10 && number <= 90;
}

function realNumber(value: unknown): number | null {
  const number = Number(value);
  return isRealNumber(number) ? number : null;
}

function programmeDateFromClock(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);

  const part = (type: string) => Number(
    parts.find((item) => item.type === type)?.value
  );

  return new Date(Date.UTC(
    part('year'),
    part('month') - 1,
    part('day') + (part('hour') >= 16 ? 1 : 0),
    12
  ));
}

function parseProgrammeDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') {
    return programmeDateFromClock();
  }
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().startsWith(value)
    ? parsed
    : null;
}

function addRealDateNumber(
  numbers: Set<number>,
  calculations: Array<Record<string, unknown>>,
  label: string,
  expression: string,
  value: unknown
) {
  const number = realNumber(value);
  if (number === null) return;

  numbers.add(number);
  calculations.push({
    label,
    expression,
    value: Number(value),
    result: number,
    retained: true,
    reason: 'résultat réel à deux chiffres entre 10 et 90'
  });
}

/*
 * Les seuls numéros chanceux de Balsa sont les résultats réels à deux
 * chiffres issus de la date. Aucune réduction automatique vers 01..09 n'est
 * autorisée.
 */
export function extractBalsaLuckyNumbersFromDate(date: Date) {
  const day = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  const century = Math.floor(year / 100);
  const shortYear = year % 100;
  const yearDigitSum = sumDigits(year);
  const dayOfYear = Math.floor(
    (date.getTime() - Date.UTC(year, 0, 0)) / 86400000
  );
  const counterLastTwo = dayOfYear % 100;
  const counterDigitSum = sumDigits(dayOfYear);
  const dateDigits = `${String(day).padStart(2, '0')}${String(month).padStart(2, '0')}${year}`;
  const dateDigitSum = sumDigits(dateDigits);
  const grandBlock = day + month + year;
  const grandBlockText = String(grandBlock);
  const firstBlock = Number(grandBlockText.slice(0, 2));
  const secondBlock = Number(grandBlockText.slice(2, 4));
  const numbers = new Set<number>();
  const calculations: Array<Record<string, unknown>> = [];

  addRealDateNumber(
    numbers,
    calculations,
    'J + A',
    `${day} + ${shortYear}`,
    day + shortYear
  );
  addRealDateNumber(
    numbers,
    calculations,
    'J + M + A',
    `${day} + ${month} + ${shortYear}`,
    day + month + shortYear
  );
  addRealDateNumber(
    numbers,
    calculations,
    'Somme des chiffres de la date',
    `${dateDigits} → ${dateDigitSum}`,
    dateDigitSum
  );

  /*
   * Exemple 01/09/2026 :
   *   2036 -> 20 + 36 = 56
   *   2036 -> 2 + 036 = 38
   */
  if (grandBlockText.length >= 4) {
    addRealDateNumber(
      numbers,
      calculations,
      'Somme des blocs de date',
      `${firstBlock} + ${secondBlock}`,
      firstBlock + secondBlock
    );

    const firstDigit = Number(grandBlockText.slice(0, 1));
    const remainingBlock = Number(grandBlockText.slice(1));
    addRealDateNumber(
      numbers,
      calculations,
      'Somme du découpage de date',
      `${firstDigit} + ${String(remainingBlock).padStart(3, '0')}`,
      firstDigit + remainingBlock
    );
  }

  const luckyNumbers = [...numbers].sort((left, right) => left - right);
  return {
    date: dateIso(date),
    components: {
      day,
      month,
      century,
      shortYear,
      year,
      yearDigitSum,
      dayOfYear,
      counterLastTwo,
      counterDigitSum,
      dateDigitSum,
      grandBlock,
      firstBlock,
      secondBlock
    },
    calculations,
    luckyNumbers,
    odd: luckyNumbers.filter((number) => number % 2 === 1),
    even: luckyNumbers.filter((number) => number % 2 === 0)
  };
}

function normalizedRealNumbers(values: unknown[]): number[] {
  return [...new Set((values || [])
    .map(Number)
    .filter(isRealNumber))]
    .sort((left, right) => left - right);
}

/*
 * Recherche d'un appelé réel et de son appelant à deux chiffres.
 * Exemple : 36 est appelé par 49, car 4 × 9 = 36.
 */
export function calculateBalsaMultiplicationCalls(
  validNumbers: number[],
  preferredCalledNumbers: number[] = []
) {
  const valid = normalizedRealNumbers(validNumbers);
  const preferred = [...new Set((preferredCalledNumbers || [])
    .map(Number)
    .filter((number) => valid.includes(number)))];
  const calls: MultiplicationCall[] = [];

  valid.forEach((called) => {
    for (let tens = 1; tens <= 9; tens += 1) {
      for (let units = 1; units <= 9; units += 1) {
        const caller = tens * 10 + units;
        if (!isRealNumber(caller) || tens * units !== called) continue;
        calls.push({
          caller,
          called,
          tens,
          units,
          operation: 'multiplication',
          expression: `${tens} × ${units} = ${called}`,
          callerParity: caller % 2 === 1 ? 'impair' : 'pair'
        });
      }
    }
  });

  const preferenceRank = (number: number) => {
    const index = preferred.indexOf(number);
    return index >= 0 ? index : preferred.length + 1;
  };
  const callerRank = (call: MultiplicationCall) => (
    call.tens % 2 === 1 && call.units % 2 === 1
      ? 0
      : call.callerParity === 'impair'
        ? 1
        : 2
  );

  const ordered = calls.slice().sort((left, right) => (
    preferenceRank(left.called) - preferenceRank(right.called)
    || callerRank(left) - callerRank(right)
    || right.called - left.called
    || left.caller - right.caller
  ));

  return {
    validNumbers: valid,
    calls: ordered,
    selected: ordered[0] || null
  };
}

function addFallbackCall(
  map: Map<number, FallbackCall>,
  called: number,
  callers: number[],
  operation: 'addition' | 'soustraction',
  expression: string
) {
  if (!isRealNumber(called)) return;
  const current = map.get(called);
  if (current) {
    current.callers = [...new Set([...current.callers, ...callers])];
    if (!current.expressions.includes(expression)) {
      current.expressions.push(expression);
    }
    return;
  }
  map.set(called, {
    callers: [...new Set(callers)],
    called,
    operation,
    expressions: [expression]
  });
}

/*
 * Repli officiel :
 *   38 -> 3 + 8 = 11
 *   56 -> 5 + 6 = 11
 *
 * Les appelants restent les valeurs réelles 38 et 56 ; le résultat 11 sert
 * seulement à démontrer leur cohérence. Aucun appelant 01..09 n'est créé.
 */
export function calculateBalsaFallbackCalls(validNumbers: number[]) {
  const valid = normalizedRealNumbers(validNumbers);
  const additionGroups = new Map<number, FallbackCall>();
  const subtractionGroups = new Map<number, FallbackCall>();

  valid.forEach((caller) => {
    const tens = Math.floor(caller / 10);
    const units = caller % 10;
    const called = tens + units;
    addFallbackCall(
      additionGroups,
      called,
      [caller],
      'addition',
      `${tens} + ${units} = ${called}`
    );
  });

  for (let firstIndex = 0; firstIndex < valid.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < valid.length;
      secondIndex += 1
    ) {
      const first = valid[firstIndex];
      const second = valid[secondIndex];
      const called = second - first;
      if (!isRealNumber(called)) continue;
      addFallbackCall(
        subtractionGroups,
        called,
        [first, second],
        'soustraction',
        `${second} − ${first} = ${called}`
      );
    }
  }

  const additions = [...additionGroups.values()]
    .filter((call) => call.callers.length >= 2)
    .sort((left, right) => (
      right.called - left.called
      || left.callers[0] - right.callers[0]
    ));
  const subtractions = [...subtractionGroups.values()]
    .sort((left, right) => (
      right.called - left.called
      || left.callers[0] - right.callers[0]
    ));
  const calls = [...additions, ...subtractions];

  return {
    validNumbers: valid,
    calls,
    selected: calls[0] || null
  };
}

function createCross(primaryValue: number, secondaryValue: number): Cross {
  if (!isRealNumber(primaryValue) || !isRealNumber(secondaryValue)) {
    throw new Error('La croix Balsa doit être formée de deux valeurs réelles.');
  }
  const primary = pad2(primaryValue);
  const secondary = pad2(secondaryValue);
  return {
    top: primary[0],
    bottom: primary[1],
    left: secondary[0],
    right: secondary[1],
    base1: primaryValue,
    base2: secondaryValue
  };
}

function makeCombination(
  first: number,
  second: number,
  firstIndices: number[],
  secondIndices: number[],
  operator: '+' | '−'
): Combination {
  const result = [
    {
      value: first,
      yellow: firstIndices.some((index) => index === 0 || index === 3)
    },
    {
      value: second,
      yellow: secondIndices.some((index) => index === 0 || index === 3)
    }
  ] as Combination;
  result.operator = operator;
  return result;
}

type RawCombination = {
  value: number;
  pair1: { number: number; indices: number[] };
  pair2: { number: number; indices: number[] };
};

/*
 * Déchiffrage universel des satellites à partir des quatre chiffres de la
 * croix. Les nombres de combinaison eux-mêmes sont aussi filtrés entre 10
 * et 90 : aucune combinaison 01, 02, 03, etc. ne peut sortir du serveur.
 */
export function decryptCross(cross: Cross): Satellite[] {
  const digits = [cross.top, cross.bottom, cross.left, cross.right];
  const raw: RawCombination[] = [];

  for (let firstIndex = 0; firstIndex < 4; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < 4;
      secondIndex += 1
    ) {
      const rest = [0, 1, 2, 3]
        .filter((index) => index !== firstIndex && index !== secondIndex);
      const leftValues = [
        Number(`${digits[firstIndex]}${digits[secondIndex]}`),
        Number(`${digits[secondIndex]}${digits[firstIndex]}`)
      ].filter(isRealNumber);
      const rightValues = [
        Number(`${digits[rest[0]]}${digits[rest[1]]}`),
        Number(`${digits[rest[1]]}${digits[rest[0]]}`)
      ].filter(isRealNumber);

      for (const first of [...new Set(leftValues)]) {
        for (const second of [...new Set(rightValues)]) {
          raw.push({
            value: first + second,
            pair1: {
              number: first,
              indices: [firstIndex, secondIndex]
            },
            pair2: {
              number: second,
              indices: rest
            }
          });
        }
      }
    }
  }

  const additionGroups = new Map<number, RawCombination[]>();
  const subtractionGroups = new Map<number, RawCombination[]>();
  const add = (
    target: Map<number, RawCombination[]>,
    value: number,
    item: RawCombination
  ) => {
    if (!isRealNumber(value)) return;
    const list = target.get(value) || [];
    const signature = `${Math.min(item.pair1.number, item.pair2.number)}_`
      + `${Math.max(item.pair1.number, item.pair2.number)}`;
    const alreadyPresent = list.some((entry) => (
      `${Math.min(entry.pair1.number, entry.pair2.number)}_`
      + `${Math.max(entry.pair1.number, entry.pair2.number)}`
      === signature
    ));
    if (!alreadyPresent) list.push(item);
    target.set(value, list);
  };

  raw.forEach((item) => {
    if (item.value <= 90) {
      add(additionGroups, item.value, item);
      return;
    }
    const difference = Math.abs(item.pair1.number - item.pair2.number);
    add(
      subtractionGroups,
      difference,
      item.pair1.number >= item.pair2.number
        ? item
        : {
            ...item,
            pair1: item.pair2,
            pair2: item.pair1
          }
    );
  });

  const output = new Map<number, Satellite>();
  const append = (
    source: Map<number, RawCombination[]>,
    operation: 'addition' | 'subtraction'
  ) => {
    source.forEach((list, value) => {
      if (list.length < 2 || output.has(value)) return;
      const operator = operation === 'subtraction' ? '−' : '+';
      output.set(value, {
        value,
        operation,
        combinations: [
          makeCombination(
            list[0].pair1.number,
            list[0].pair2.number,
            list[0].pair1.indices,
            list[0].pair2.indices,
            operator
          ),
          makeCombination(
            list[1].pair1.number,
            list[1].pair2.number,
            list[1].pair1.indices,
            list[1].pair2.indices,
            operator
          )
        ]
      });
    });
  };

  append(additionGroups, 'addition');
  append(subtractionGroups, 'subtraction');
  return [...output.values()].sort((left, right) => left.value - right.value);
}

function buildKey(values: number[]): string {
  const realValues = values.filter(isRealNumber);
  if (realValues.length < 3) {
    throw new Error('Impossible de former une clé avec trois valeurs réelles.');
  }
  return realValues
    .slice(0, 3)
    .map(pad2)
    .join('');
}

function buildNap(values: number[][]): {
  nap1: string[];
  nap2: string[];
} {
  const normalized = values
    .flat()
    .filter(isRealNumber)
    .map(pad2);
  return {
    nap1: normalized.slice(0, 2),
    nap2: normalized.slice(0, 2)
  };
}

export function calculateBalsaRealDateMethod(
  date: Date,
  luckyDetails = extractBalsaLuckyNumbersFromDate(date),
  nigerResult: NigerResultContext | null = null
) {
  const dateNumbers = normalizedRealNumbers(luckyDetails.luckyNumbers);
  const nigerNumbers = nigerResult
    ? normalizedRealNumbers([
        ...nigerResult.directNumbers,
        ...nigerResult.derivedNumbers
      ])
    : [];
  const validNumbers = [...new Set([...dateNumbers, ...nigerNumbers])]
    .sort((left, right) => left - right);
  if (validNumbers.length < 3) {
    throw new Error('La date ne produit pas assez de valeurs réelles Balsa.');
  }

  const dateComposite = Number(
    luckyDetails.components.day
  ) + Number(
    luckyDetails.components.month
  ) + Number(
    luckyDetails.components.shortYear
  );
  const dateMultiplication = calculateBalsaMultiplicationCalls(
    dateNumbers,
    [dateComposite]
  );
  const combinedMultiplication = calculateBalsaMultiplicationCalls(
    validNumbers,
    [dateComposite]
  );
  const dateFallback = calculateBalsaFallbackCalls(dateNumbers);
  const combinedFallback = calculateBalsaFallbackCalls(validNumbers);
  const multiplication = dateMultiplication.selected
    ? dateMultiplication
    : combinedMultiplication;
  const fallback = dateFallback.selected
    ? dateFallback
    : combinedFallback;
  const dateAnchor = realNumber(luckyDetails.components.dateDigitSum)
    || dateNumbers[0]
    || validNumbers[0];
  const selectedCall = multiplication.selected;
  const selectedFallbackCall = selectedCall ? null : fallback.selected;
  const fallbackCallers = selectedFallbackCall?.callers
    .filter(isRealNumber)
    .slice(0, 2) || [];

  let source: number[];
  let cross: Cross;
  let nap: { nap1: string[]; nap2: string[] };

  if (selectedCall) {
    source = [dateAnchor, selectedCall.called, selectedCall.caller];
    cross = createCross(selectedCall.called, selectedCall.caller);
    nap = buildNap([[selectedCall.called, selectedCall.caller]]);
  } else if (selectedFallbackCall && fallbackCallers.length >= 2) {
    const third = validNumbers.find((number) =>
      !fallbackCallers.includes(number)
    ) || dateAnchor;
    source = [third, fallbackCallers[0], fallbackCallers[1]];
    cross = createCross(third, fallbackCallers[1]);
    nap = buildNap([fallbackCallers]);
  } else {
    source = validNumbers.slice(0, 3);
    cross = createCross(source[1], source[2]);
    nap = buildNap([[source[1], source[2]]]);
  }

  const key = buildKey(source);
  const satellites = decryptCross(cross).slice(0, 10);

  return {
    validNumbers,
    dateValidNumbers: dateNumbers,
    nigerValidNumbers: nigerNumbers,
    nigerResultContext: nigerResult,
    multiplicationCallAnalysis: multiplication,
    dateMultiplicationCallAnalysis: dateMultiplication,
    fallbackCallAnalysis: fallback,
    dateFallbackCallAnalysis: dateFallback,
    dateAnchor,
    selectedCall,
    selectedFallbackCall,
    fallbackCallers,
    source,
    key,
    cross,
    satellites,
    nap
  };
}

function keyPayload(
  key: string,
  cross: Cross,
  satellites: Satellite[],
  validNumbers: number[]
) {
  return {
    calculationVersion: BALSA_CALCULATION_VERSION,
    key,
    order: key.split('').sort().join(''),
    code: key.slice(0, 2),
    filter: key.slice(2, 4),
    addition: String(sumDigits(key)),
    cross,
    satellites,
    validNumbers
  };
}

export function calculateBalsa(
  date: Date,
  luckyDetails = extractBalsaLuckyNumbersFromDate(date),
  nigerResult: NigerResultContext | null = null
) {
  const method = calculateBalsaRealDateMethod(date, luckyDetails, nigerResult);
  return {
    ...keyPayload(
      method.key,
      method.cross,
      method.satellites,
      method.validNumbers
    ),
    calculationVersion: BALSA_CALCULATION_VERSION,
    id: 'balsa',
    date: dateIso(date),
    luckyNumbers: method.validNumbers,
    luckyNumberDetails: luckyDetails,
    multiplicationCallAnalysis: method.multiplicationCallAnalysis,
    fallbackCallAnalysis: method.fallbackCallAnalysis,
    selectedFallbackCall: method.selectedFallbackCall,
    nigerResultContext: nigerResult,
    keySource: method.source,
    keySourceType: method.selectedCall
      ? method.nigerValidNumbers?.includes(method.selectedCall.caller)
        || method.nigerValidNumbers?.includes(method.selectedCall.called)
        ? 'résultat Niger + appelé × appelant'
        : 'valeur réelle de date + appelé × appelant'
      : method.selectedFallbackCall
        ? 'appel addition/soustraction entre valeurs réelles'
        : 'valeurs réelles de date',
    nap: method.nap
  };
}

function publicProgramPayload(payload: any) {
  const cross = payload?.cross && typeof payload.cross === 'object'
    ? {
        top: String(payload.cross.top ?? ''),
        bottom: String(payload.cross.bottom ?? ''),
        left: String(payload.cross.left ?? ''),
        right: String(payload.cross.right ?? '')
      }
    : null;

  const satellites = Array.isArray(payload?.satellites)
    ? payload.satellites.map((satellite: any) => ({
        value: Number(satellite?.value ?? 0),
        combinations: Array.isArray(satellite?.combinations)
          ? satellite.combinations.map((parts: any) => {
              const safe = (Array.isArray(parts) ? parts : [])
                .map((part: any) => ({
                  value: Number(part?.value ?? part ?? 0),
                  yellow: Boolean(part?.yellow)
                })) as Combination;
              safe.operator = parts?.operator === '−' ? '−' : '+';
              return safe;
            })
          : []
      }))
    : [];

  const output: Record<string, unknown> = {};
  [
    'id',
    'displayName',
    'functionName',
    'theme',
    'date',
    'weekDate',
    'schedules',
    'calculationVersion',
    'controlVersion',
    'luckyNumbers',
    'selectedNumber',
    'key',
    'order',
    'code',
    'filter',
    'addition',
    'group',
    'nextDate',
    'followingDate',
    'power',
    'result',
    'digitCount',
    'pairs',
    'retained',
    'primes'
  ].forEach((key) => {
    if (payload?.[key] !== undefined) output[key] = payload[key];
  });

  if (cross) output.cross = cross;
  output.satellites = satellites;
  if (payload?.nap && typeof payload.nap === 'object') {
    output.nap = {
      nap1: Array.isArray(payload.nap.nap1)
        ? payload.nap.nap1.map(String)
        : [],
      nap2: Array.isArray(payload.nap.nap2)
        ? payload.nap.nap2.map(String)
        : []
    };
  }
  return output;
}

function maskedProgramPayload(payload: any) {
  const output = publicProgramPayload(payload);
  output.key = '000000';
  output.order = '000000';
  output.code = '00';
  output.filter = '00';
  output.addition = '00';
  output.luckyNumbers = [];

  if (output.cross && typeof output.cross === 'object') {
    output.cross = {
      ...(output.cross as Record<string, unknown>),
      top: '0',
      bottom: '0',
      left: '0',
      right: '0'
    };
  }
  output.satellites = [{ value: '00', combinations: [] }];
  if (output.nap && typeof output.nap === 'object') {
    output.nap = { nap1: ['00'], nap2: ['00'] };
  }
  if (Array.isArray(output.pairs)) output.pairs = [];
  if (Array.isArray(output.retained)) output.retained = [];
  if (Array.isArray(output.primes)) output.primes = [];
  return output;
}

async function readOrCreateBalsaProgram(
  date: Date,
  luckyDetails: ReturnType<typeof extractBalsaLuckyNumbersFromDate>,
  nigerResult?: NigerResultContext | null
) {
  const programmeDate = dateIso(date);
  const admin = serviceClient();
  const existing = await admin
    .from('daily_balsa_programs')
    .select('programme_date,payload,created_at,updated_at')
    .eq('programme_date', programmeDate)
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (
    existing.data?.payload
    && String(existing.data.payload.date || '').slice(0, 10) === programmeDate
    && Number(existing.data.payload.calculationVersion)
      === BALSA_CALCULATION_VERSION
  ) {
    return {
      ...existing.data.payload,
      meta: {
        programmeDate,
        source: 'database',
        persisted: true,
        createdAt: existing.data.created_at,
        updatedAt: existing.data.updated_at
      }
    };
  }

  const contextualNigerResult = nigerResult === undefined
    ? await readOptionalNigerResult(date)
    : nigerResult;
  const payload = calculateBalsa(date, luckyDetails, contextualNigerResult);
  const saved = existing.data?.payload
    ? await admin
        .from('daily_balsa_programs')
        .update({
          payload,
          updated_at: new Date().toISOString()
        })
        .eq('programme_date', programmeDate)
        .select('programme_date,payload,created_at,updated_at')
        .maybeSingle()
    : await admin
        .from('daily_balsa_programs')
        .insert({
          programme_date: programmeDate,
          payload
        })
        .select('programme_date,payload,created_at,updated_at')
        .maybeSingle();

  if (saved.error) {
    const raced = await admin
      .from('daily_balsa_programs')
      .select('programme_date,payload,created_at,updated_at')
      .eq('programme_date', programmeDate)
      .maybeSingle();
    if (raced.error || !raced.data?.payload) throw saved.error;
    return {
      ...raced.data.payload,
      meta: {
        programmeDate,
        source: 'database-after-race',
        persisted: true,
        createdAt: raced.data.created_at,
        updatedAt: raced.data.updated_at
      }
    };
  }

  return {
    ...payload,
    meta: {
      programmeDate,
      source: existing.data?.payload
        ? 'recalculated-and-persisted'
        : 'calculated-and-persisted',
      persisted: true,
      createdAt: saved.data?.created_at
        || existing.data?.created_at
        || null,
      updatedAt: saved.data?.updated_at || null
    }
  };
}

export async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Méthode non autorisée.' }, 405);
  }

  let body: { date?: unknown } = {};
  try {
    body = await request.json() as { date?: unknown };
  } catch (_) {
    return json(
      { error: 'Le corps de la requête doit être un JSON valide.' },
      400
    );
  }

  const date = body.date === undefined
    ? programmeDateFromClock()
    : parseProgrammeDate(body.date);

  if (!date || Number.isNaN(date.getTime())) {
    return json(
      { error: 'date doit être une date ISO valide (YYYY-MM-DD).' },
      400
    );
  }

  try {
    const luckyDetails = extractBalsaLuckyNumbersFromDate(date);
    const result = await readOrCreateBalsaProgram(date, luckyDetails);
    const denied = await enforceFeatureAccess(request, 'tableaux-balsa');
    const earlyDenied = denied
      ? null
      : await enforceEarlyAccess(request, 'tableaux-balsa', dateIso(date));
    const payload = publicProgramPayload(result);

    return (denied || earlyDenied)
      && ((denied || earlyDenied)?.status === 401
        || (denied || earlyDenied)?.status === 403)
      ? json(maskedProgramPayload(payload))
      : earlyDenied || denied || json(payload);
  } catch (error) {
    console.error('calcul-balsa failed', error);
    return json(
      {
        error: error instanceof Error
          ? error.message
          : 'Le résultat Balsa est indisponible.'
      },
      500
    );
  }
}

/*
 * The HTTP entry point intentionally lives in calcul-balsa/index.ts. Keeping
 * Deno.serve out of this module lets Stand-by and Robot reuse the exact same
 * Balsa calculation without opening a second server during their import.
 */
