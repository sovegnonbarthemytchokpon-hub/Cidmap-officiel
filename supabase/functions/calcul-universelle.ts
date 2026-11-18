import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  calculateCrossAndSatellites,
  CALCULATION_VERSION,
  calculateLuckyNumber,
  dateIso,
  extractLuckyNumbersFromDate,
  deriveNap,
  json,
  keyPayload,
  publicProgramPayload,
  maskedProgramPayload,
  programmeDateFromClock,
  parseProgrammeDate,
  corsHeaders,
  sumDigits,
  resolveLuckyNumberDetails,
  enforceFeatureAccess,
  enforceEarlyAccess,
  LuckyNumberDetails,
  NigerResultContext,
  readOptionalNigerResult
} from './_shared.ts';

// Keep this version local to Universelle so changing this method invalidates
// only the daily universal programme, not the other calculation engines.
const UNIVERSAL_CALCULATION_VERSION = 8;

function calculateSatelliteNumber(base: number, valid: number[]) {
  if (base + 63 <= 90) return base + 63;
  return valid.slice().sort((a, b) => a - b)
    .find((number) => number !== base && number + 63 <= 90) || Math.min(90, base);
}

function calculateSatellites(base: number, valid: number[]) {
  const satellite1 = calculateSatelliteNumber(base, valid);
  const satellite2 = Math.abs(base - 63);
  const digitSum = sumDigits(base);
  return {
    satellite1: Math.min(90, satellite1),
    satellite2: Math.min(90, satellite2),
    satellite3: Math.min(90, calculateSatelliteNumber(digitSum, valid))
  };
}

function detectMagicRule(
  luckyNumbers: number[],
  configuredRule: Record<string, unknown> = {},
  candidateNumbers: number[] = luckyNumbers
) {
  const lucky = new Set(luckyNumbers);
  // The highest two-digit yellow number has priority. No fixed number is
  // embedded here: on another date the generator can be 57, 74, 86, etc.
  const candidates = [...new Set(candidateNumbers)]
    .filter((value) => value >= 10 && value <= 90)
    .sort((left, right) => right - left);

  for (const generator of candidates) {
    const tens = Math.floor(generator / 10);
    const units = generator % 10;
    const sum = tens + units;
    const product = tens * units;
    const configuredOperations = Array.isArray(configuredRule.operations)
      ? configuredRule.operations.map(String)
      : ['addition_chiffres', 'multiplication_chiffres'];
    const sumCalled = configuredOperations.includes('addition_chiffres')
      && sum >= 1 && sum <= 90 && lucky.has(sum);
    const productCalled = configuredOperations.includes('multiplication_chiffres')
      && product >= 1 && product <= 90 && lucky.has(product);
    if (!sumCalled && !productCalled) continue;

    const calls = [
      sumCalled
        ? {
            operation: 'addition',
            expression: `${tens} + ${units}`,
            value: sum
          }
        : null,
      productCalled
        ? {
            operation: 'multiplication',
            expression: `${tens} × ${units}`,
            value: product
          }
        : null
    ].filter(Boolean);

    // With two calls the key is exactly [sum, product, generator], e.g.
    // 14 · 49 · 77. With one call, keep every key part tied to the yellow
    // relation and let the ordinary method remain the fallback only when
    // there is no caller at all.
    const configuredKeyOrder = Array.isArray(configuredRule.si_deux_appels)
      ? configuredRule.si_deux_appels.map(String)
      : ['addition', 'multiplication', 'generateur'];
    const validConfiguredKeyOrder = configuredKeyOrder.length === 3
      && new Set(configuredKeyOrder).size === 3
      && configuredKeyOrder.every((part) => (
        part === 'addition'
        || part === 'multiplication'
        || part === 'generateur'
      ));
    const keyOrder = validConfiguredKeyOrder
      ? configuredKeyOrder
      : ['addition', 'multiplication', 'generateur'];
    const keyValues: Record<string, number> = {
      addition: sum,
      multiplication: product,
      generateur: generator
    };
    const keyParts = sumCalled && productCalled
      ? keyOrder.map((part) => keyValues[part])
      : productCalled
        ? [product, generator, product]
        : [sum, generator, sum];
    const primary = keyParts[0];
    const secondary = keyParts[1];

    return {
      key: keyParts.map((value) => String(value).padStart(2, '0')).join(''),
      generator,
      keyNumber: generator,
      tens,
      units,
      sum,
      product,
      sumCalled,
      productCalled,
      calls,
      keyParts,
      primary,
      secondary,
      // Legacy labels are retained for any older display adapter.
      callingDigit: units,
      productExpression: `${tens} × ${units}`,
      sumExpression: `${tens} + ${units}`,
      triangularExpression: ''
    };
  }
  return null;
}

export function calculateUniverselle(
  date: Date,
  luckyDetails: LuckyNumberDetails = extractLuckyNumbersFromDate(date),
  configuredRule: Record<string, unknown> = {},
  controlVersion = 0,
  nigerResult: NigerResultContext | null = null
) {
  const dateNumbers = luckyDetails.luckyNumbers;
  const nigerNumbers = nigerResult
    ? [...new Set([
        ...nigerResult.directNumbers,
        ...nigerResult.derivedNumbers
      ])]
    : [];
  const validNumbers = [...new Set([...dateNumbers, ...nigerNumbers])];

  /*
   * Preserve the date method's priority. Niger is consulted only when no
   * date number makes an addition/multiplication call. Once consulted, its
   * direct numbers and the two aggregate reductions can call either a date
   * number or another Niger-derived number.
   */
  const dateCaller = detectMagicRule(validNumbers, configuredRule, dateNumbers);
  const nigerCaller = dateCaller || !nigerResult
    ? null
    : detectMagicRule(validNumbers, configuredRule, nigerNumbers);
  const caller = dateCaller || nigerCaller;
  const luckyNumber = caller?.generator || calculateLuckyNumber(date, luckyDetails);
  const base = luckyNumber + 63 > 90 ? sumDigits(luckyNumber) : luckyNumber;
  const provisional = calculateSatellites(base, validNumbers);
  const magicRule = caller;
  const key = magicRule?.key || `${String(provisional.satellite1).padStart(2, '0')}${String(provisional.satellite2).padStart(2, '0')}${String(provisional.satellite3).padStart(2, '0')}`;
  const { cross, satellites } = magicRule
    ? calculateCrossAndSatellites(key, 63, 'magic')
    : calculateCrossAndSatellites(key, 63, 'code');
  const magicNapValue = magicRule
    ? magicRule.productCalled
      ? magicRule.product
      : magicRule.sum
    : null;
  const nap = magicRule
    ? {
        keyRemainder: String(magicRule.generator).padStart(2, '0'),
        repeated: String(magicNapValue).padStart(2, '0'),
        firstNap1: String(magicNapValue).padStart(2, '0'),
        secondNap1: String(magicRule.generator).padStart(2, '0'),
        nap1: [
          String(magicNapValue).padStart(2, '0'),
          String(magicRule.generator).padStart(2, '0')
        ],
        nap2: [
          String(magicNapValue).padStart(2, '0'),
          String(magicRule.generator).padStart(2, '0')
        ]
      }
    : deriveNap(key, satellites, {
        code: String(provisional.satellite2).padStart(2, '0'),
        filter: String(provisional.satellite3).padStart(2, '0'),
        cross
      });
  const payload = {
    ...keyPayload(key, cross, satellites, validNumbers),
    calculationVersion: UNIVERSAL_CALCULATION_VERSION,
    controlVersion,
    id: 'universal',
    date: dateIso(date),
    luckyNumbers: validNumbers,
    luckyNumberDetails: {
      ...luckyDetails,
      methodLuckyNumbers: validNumbers
    },
    selectedNumber: luckyNumber,
    magicRule,
    nigerResultContext: nigerResult,
    serverTrace: {
      luckyCandidates: dateNumbers.filter((number) => number >= 10 && number <= 90)
        .slice().sort((left, right) => right - left),
      nigerCandidates: nigerNumbers.filter((number) => number >= 10 && number <= 90)
        .slice().sort((left, right) => right - left),
      selectedGenerator: magicRule?.generator || null,
      selectedGeneratorSource: dateCaller ? 'date' : nigerCaller ? 'niger-result' : 'date-fallback',
      base,
      provisionalSatellites: provisional,
      keyParts: key.match(/.{1,2}/g) || [],
      crossSource: magicRule ? 'première et deuxième partie de la clé' : 'code et base secondaire 63'
    },
    nap
  };
  return payload;
}

function getAdminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) {
    throw new Error('Configuration Supabase serveur incomplète.');
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function readPublishedUniversalControl() {
  try {
    const admin = getAdminClient();
    const result = await admin
      .from('program_method_controls')
      .select('version, rule, instructions')
      .eq('program_key', 'universelle')
      .eq('status', 'published')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (result.error || !result.data) return null;
    return result.data;
  } catch (_) {
    // The control table is optional until the administrator installs it.
    return null;
  }
}

async function readOrCreateUniversalProgram(
  date: Date,
  luckyDetails: LuckyNumberDetails,
  control: { version?: number; rule?: Record<string, unknown>; instructions?: string } | null = null,
  nigerResult?: NigerResultContext | null
) {
  const programmeDate = dateIso(date);
  const controlVersion = Number(control?.version || 0);
  const admin = getAdminClient();
  const existing = await admin
    .from('daily_universal_programs')
    .select('programme_date, payload, created_at, updated_at')
    .eq('programme_date', programmeDate)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.payload
      && (existing.data.payload.calculationVersion !== UNIVERSAL_CALCULATION_VERSION
        || Number(existing.data.payload.controlVersion || 0) !== controlVersion)) {
    const contextualNigerResult = nigerResult === undefined
      ? await readOptionalNigerResult(date)
      : nigerResult;
    const payload = calculateUniverselle(
      date,
      luckyDetails,
      control?.rule || {},
      controlVersion,
      contextualNigerResult
    );
    const refreshed = await admin
      .from('daily_universal_programs')
      .update({ payload })
      .eq('programme_date', programmeDate)
      .select('programme_date, payload, created_at, updated_at')
      .maybeSingle();
    if (refreshed.error) throw refreshed.error;
    return {
      ...payload,
      meta: {
        programmeDate,
        source: 'recalculated-and-persisted',
        persisted: true,
        createdAt: refreshed.data?.created_at || existing.data.created_at,
        updatedAt: refreshed.data?.updated_at || null
      }
    };
  }
  if (existing.data?.payload) {
    return {
      ...existing.data.payload,
      luckyNumbers: Array.isArray(existing.data.payload.luckyNumbers)
        ? existing.data.payload.luckyNumbers
        : luckyDetails.luckyNumbers,
      luckyNumberDetails: existing.data.payload.luckyNumberDetails
        || luckyDetails,
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
  const payload = calculateUniverselle(
    date,
    luckyDetails,
    control?.rule || {},
    controlVersion,
    contextualNigerResult
  );
  const inserted = await admin
    .from('daily_universal_programs')
    .insert({ programme_date: programmeDate, payload })
    .select('programme_date, payload, created_at, updated_at')
    .maybeSingle();

  if (inserted.error) {
    // Two visitors can request the same new date at the same time. The first
    // write wins; the second request returns the committed canonical row.
    const raced = await admin
      .from('daily_universal_programs')
      .select('programme_date, payload, created_at, updated_at')
      .eq('programme_date', programmeDate)
      .maybeSingle();
    if (raced.error || !raced.data?.payload) throw inserted.error;
    return {
      ...raced.data.payload,
      meta: {
        programmeDate,
        source: 'database',
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
      source: 'calculated-and-persisted',
      persisted: true,
      createdAt: inserted.data?.created_at || null,
      updatedAt: inserted.data?.updated_at || null
    }
  };
}

export async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);
  let body: { date?: unknown; luckyNumbers?: unknown } = {};
  try {
    body = await request.json() as { date?: unknown; luckyNumbers?: unknown };
  } catch (_) {
    return json({ error: 'Le corps de la requête doit être un JSON valide.' }, 400);
  }
  const date = body.date === undefined
    ? programmeDateFromClock()
    : typeof body.date === 'string' && body.date !== ''
      ? parseProgrammeDate(body.date)
      : null;
  if (!date || Number.isNaN(date.getTime())) {
    return json({ error: 'date doit être une date ISO valide (YYYY-MM-DD).' }, 400);
  }
  let luckyDetails: LuckyNumberDetails;
  try {
    luckyDetails = resolveLuckyNumberDetails(date, body.luckyNumbers);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Numéros chanceux invalides.' }, 400);
  }
  try {
    const control = await readPublishedUniversalControl();
    const result = await readOrCreateUniversalProgram(date, luckyDetails, control);
    const denied = await enforceFeatureAccess(request, 'tableaux-universelle');
    const earlyDenied = denied
      ? null
      : await enforceEarlyAccess(request, 'tableaux-universelle', dateIso(date));
    const payload = publicProgramPayload(result);
    if (denied && (denied.status === 401 || denied.status === 403)) {
      return json(maskedProgramPayload(payload));
    }
    if (earlyDenied) {
      return earlyDenied.status === 401 || earlyDenied.status === 403
        ? json(maskedProgramPayload(payload))
        : earlyDenied;
    }
    return denied || json(payload);
  } catch (error) {
    console.error('calcul-universelle failed', error);
    return json({
      error: 'La table daily_universal_programs est absente ou indisponible. Exécutez le script SQL fourni.'
    }, 500);
  }
}
