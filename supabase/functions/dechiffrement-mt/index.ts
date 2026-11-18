import { createClient } from "npm:@supabase/supabase-js@2.57.0";

type DecodeBody = {
  action?: unknown;
  numbers?: unknown;
  name?: unknown;
  countryName?: unknown;
  date?: unknown;
  programmeDate?: unknown;
  matrix?: unknown;
  keyboard?: unknown;
  cerveau?: unknown;
  brain?: unknown;
  code?: unknown;
  event?: unknown;
  saveHistory?: unknown;
};

type SourceGroup = {
  key: "matrix" | "keyboard" | "cerveau";
  label: string;
  values: string[];
};

type Candidate = {
  number: number;
  count: number;
  digitSupport: number;
  firstSeen: number;
};

type MultiplicationCall = {
  caller: number;
  called: number;
  tens: number;
  units: number;
  operation: "multiplication";
  expression: string;
  callerParity: "impair" | "pair";
};

type FallbackCall = {
  callers: number[];
  called: number;
  operation: "addition" | "soustraction" | "intervalle";
  expressions: string[];
};

class InputError extends Error {}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EUROPEAN_DATE_PATTERN = /^(\d{2})-(\d{2})-(\d{4})$/;
const TRIPLET_PATTERN = /^\d{3}$/;
const MAX_VALUES = 4;
const TIME_ZONE = "Africa/Abidjan";
const POSITIONS = Object.freeze([
  [0, 1],
  [0, 2],
  [1, 0],
  [1, 2],
  [2, 0],
  [2, 1],
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Configuration Supabase serveur incomplète.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const FEATURE_ALIASES: Record<string, string> = {
  universelle: "tableaux-universelle",
  intuition: "tableaux-intuition",
  oracle: "tableaux-oracle",
  lnb: "tableaux-lnb",
  balsa: "tableaux-balsa",
  standby: "tableaux-standby",
};

function canonicalFeatureKey(value: unknown): string {
  const key = String(value || "")
    .trim()
    .toLowerCase();
  return FEATURE_ALIASES[key] || key;
}

function planIncludesFeature(plan: any, featureKey: string): boolean {
  const wanted = canonicalFeatureKey(featureKey);
  const features = Array.isArray(plan?.features)
    ? plan.features.map(canonicalFeatureKey)
    : [];
  if (features.includes(wanted) || features.includes("tableaux")) return true;
  return (
    wanted === "tableaux" &&
    features.some((item: string) => item.startsWith("tableaux-"))
  );
}

function missingAccessTables(error: any): boolean {
  return (
    String(error?.code || "") === "42P01" ||
    /subscription_plans|feature_access_rules|user_subscriptions|user_feature_unlocks|relation .* does not exist|column .* does not exist|schema cache/i.test(
      String(error?.message || ""),
    )
  );
}

/*
 * Contrôle d’accès embarqué dans ce fichier pour permettre un déploiement
 * réellement autonome depuis un seul index.ts.
 */
async function enforceFeatureAccess(
  request: Request,
  featureKey: string,
): Promise<Response | null> {
  const client = getAdminClient();
  const wanted = canonicalFeatureKey(featureKey);
  const [plansResult, rulesResult] = await Promise.all([
    client.from("subscription_plans").select("slug,features,enabled"),
    client
      .from("feature_access_rules")
      .select("feature_key,plan_slug,required_stars,required_tokens,enabled"),
  ]);

  if (
    missingAccessTables(plansResult.error) ||
    missingAccessTables(rulesResult.error)
  ) {
    return wanted === "tableaux" || wanted.startsWith("tableaux-")
      ? json({ error: "Abonnement actif non vérifiable." }, 403)
      : null;
  }
  if (plansResult.error) throw plansResult.error;
  if (rulesResult.error) throw rulesResult.error;

  const allPlans = plansResult.data || [];
  const enabledPlans = allPlans.filter((plan: any) => plan.enabled !== false);
  const enabledPlanSlugs = new Set(enabledPlans.map((plan: any) => plan.slug));
  const isIndividualFeature = wanted.startsWith("tableaux-");
  const rule = (rulesResult.data || []).find(
    (item: any) =>
      item.enabled !== false &&
      canonicalFeatureKey(item.feature_key) === wanted &&
      (!item.plan_slug || enabledPlanSlugs.has(item.plan_slug)),
  );
  const protectedByOffer = enabledPlans.some((plan: any) =>
    planIncludesFeature(plan, wanted),
  );

  // Déchiffrement avancé is optional: no active rule means no lock.
  if (wanted === "tableaux-dechiffrement-plus" && !rule) {
    return null;
  }
  if (
    isIndividualFeature &&
    rule &&
    Number(rule.required_stars || 0) <= 0 &&
    Number(rule.required_tokens || 0) <= 0
  ) {
    return null;
  }

  const requiresSubscription =
    wanted === "boules-rejetees"
      ? Boolean(rule?.plan_slug) || protectedByOffer
      : Boolean(rule) || protectedByOffer;
  if (!isIndividualFeature && !requiresSubscription) return null;

  const token =
    request.headers
      .get("Authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim() || "";
  if (!token) {
    return json(
      {
        error: "Connexion requise pour accéder à cette section.",
      },
      401,
    );
  }

  const session = await client.auth.getUser(token);
  if (session.error || !session.data?.user?.id) {
    return json({ error: "Session invalide." }, 401);
  }
  const userId = session.data.user.id;

  const adminRole = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!adminRole.error && adminRole.data?.role === "admin") return null;

  const principal = await client
    .from("admin_control_settings")
    .select("principal_user_id")
    .eq("id", true)
    .limit(1)
    .maybeSingle();
  if (!principal.error && principal.data?.principal_user_id === userId) return null;

  if (isIndividualFeature) {
    const unlock = await client
      .from("user_feature_unlocks")
      .select("feature_key,unlocked_at,expires_at")
      .eq("user_id", userId)
      .eq("feature_key", wanted)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .maybeSingle();
    if (unlock.error) {
      if (!missingAccessTables(unlock.error)) throw unlock.error;
    }
    if (unlock.data) return null;
  }

  const subscription = await client
    .from("user_subscriptions")
    .select("plan_slug,status,started_at,expires_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .lte("started_at", new Date().toISOString())
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .maybeSingle();
  if (subscription.error) {
    if (missingAccessTables(subscription.error)) {
      return json({ error: "Abonnement actif non vérifiable." }, 403);
    }
    throw subscription.error;
  }
  const plan = enabledPlans.find(
    (item: any) => item.slug === subscription.data?.plan_slug,
  );
  return Boolean(plan) &&
    (planIncludesFeature(plan, wanted) ||
      Boolean(rule?.plan_slug && rule.plan_slug === plan?.slug))
    ? null
    : json({ error: "Cette section nécessite un abonnement actif." }, 403);
}

function text(value: unknown, maxLength: number, label: string): string {
  const result = String(value ?? "").trim();
  if (result.length > maxLength) {
    throw new Error(
      `${label} est trop long (maximum ${maxLength} caractères).`,
    );
  }
  return result;
}

function normalizeDate(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (ISO_DATE_PATTERN.test(raw)) {
    const date = new Date(`${raw}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) || !date.toISOString().startsWith(raw)
      ? null
      : raw;
  }
  const european = raw.match(EUROPEAN_DATE_PATTERN);
  if (!european) return null;
  const [, day, month, year] = european;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || !date.toISOString().startsWith(iso)
    ? null
    : iso;
}

function currentProgrammeDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) =>
    Number(parts.find((entry) => entry.type === type)?.value);
  const date = new Date(
    Date.UTC(
      part("year"),
      part("month") - 1,
      part("day") + (part("hour") >= 16 ? 1 : 0),
    ),
  );
  return date.toISOString().slice(0, 10);
}

function normalizeTriplets(value: unknown, label: string): string[] {
  let values: unknown[] = [];
  if (Array.isArray(value)) {
    values = value;
  } else if (typeof value === "string" && value.trim()) {
    values = value.match(/\d{3}/g) || [];
  }

  if (values.length > MAX_VALUES) {
    throw new InputError(
      `${label} contient trop de lignes (maximum ${MAX_VALUES}).`,
    );
  }

  return values.map((item) => {
    const normalized = String(item ?? "").trim();
    if (!TRIPLET_PATTERN.test(normalized)) {
      throw new InputError(`${label} contient une valeur invalide.`);
    }
    return normalized;
  });
}

function normalizeNumbers(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== 10) {
    throw new InputError("Déchiffrement avancé attend exactement 10 numéros.");
  }
  const numbers = value.map((item) => Number(String(item).trim()));
  if (
    numbers.some(
      (number) => !Number.isInteger(number) || number < 1 || number > 90,
    )
  ) {
    throw new InputError("Les 10 numéros doivent être compris entre 01 et 90.");
  }
  if (new Set(numbers).size !== numbers.length) {
    throw new InputError("Les 10 numéros doivent être distincts.");
  }
  return numbers;
}

/*
 * Copie locale du moteur d’appelants Balsa Plus.
 *
 * Cette fonction est volontairement embarquée dans `dechiffrement` :
 * aucune importation de calcul-balsa et aucun appel vers une autre Edge
 * Function ne sont nécessaires lorsque l’utilisateur clique sur Plus.
 */
function isRealBalsaNumber(value: unknown): boolean {
  const number = Number(value);
  return Number.isInteger(number) && number >= 10 && number <= 90;
}

function normalizedBalsaNumbers(values: unknown[]): number[] {
  return [
    ...new Set((values || []).map(Number).filter(isRealBalsaNumber)),
  ].sort((left, right) => left - right);
}

function calculateLocalBalsaMultiplicationCalls(
  validNumbers: number[],
  preferredCalledNumbers: number[] = [],
) {
  const valid = normalizedBalsaNumbers(validNumbers);
  const preferred = [
    ...new Set(
      (preferredCalledNumbers || [])
        .map(Number)
        .filter((number) => valid.includes(number)),
    ),
  ];
  const calls: MultiplicationCall[] = [];

  valid.forEach((called) => {
    for (let tens = 1; tens <= 9; tens += 1) {
      for (let units = 1; units <= 9; units += 1) {
        const caller = tens * 10 + units;
        if (
          !isRealBalsaNumber(caller) ||
          !valid.includes(caller) ||
          tens * units !== called
        ) {
          continue;
        }
        calls.push({
          caller,
          called,
          tens,
          units,
          operation: "multiplication",
          expression: `${tens} × ${units} = ${called}`,
          callerParity: caller % 2 === 1 ? "impair" : "pair",
        });
      }
    }
  });

  const preferenceRank = (number: number) => {
    const index = preferred.indexOf(number);
    return index >= 0 ? index : preferred.length + 1;
  };
  const callerRank = (call: MultiplicationCall) =>
    call.tens % 2 === 1 && call.units % 2 === 1
      ? 0
      : call.callerParity === "impair"
        ? 1
        : 2;
  const ordered = calls
    .slice()
    .sort(
      (left, right) =>
        preferenceRank(left.called) - preferenceRank(right.called) ||
        callerRank(left) - callerRank(right) ||
        right.called - left.called ||
        left.caller - right.caller,
    );

  return {
    validNumbers: valid,
    calls: ordered,
    selected: ordered[0] || null,
  };
}

function addLocalBalsaFallbackCall(
  map: Map<number, FallbackCall>,
  called: number,
  callers: number[],
  operation: "addition" | "soustraction" | "intervalle",
  expression: string,
) {
  if (!isRealBalsaNumber(called)) return;
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
    expressions: [expression],
  });
}

function calculateLocalBalsaIntervalCalls(
  validNumbers: number[],
) {
  const valid = normalizedBalsaNumbers(validNumbers);
  const intervalGroups = new Map<number, FallbackCall>();

  valid.forEach((caller) => {
    const tens = Math.floor(caller / 10);
    const units = caller % 10;
    const start = Math.min(tens, units);
    const end = Math.max(tens, units);
    let called = 0;

    for (let digit = start; digit <= end; digit += 1) {
      called += digit;
    }

    if (!valid.includes(called)) {
      return;
    }

    addLocalBalsaFallbackCall(
      intervalGroups,
      called,
      [caller],
      "intervalle",
      `intervalle ${start}-${end} = ${called}`,
    );
  });

  return [...intervalGroups.values()].sort(
    (left, right) =>
      right.called - left.called ||
      left.callers[0] - right.callers[0],
  );
}

function calculateLocalBalsaFallbackCalls(validNumbers: number[]) {
  const valid = normalizedBalsaNumbers(validNumbers);
  const additionGroups = new Map<number, FallbackCall>();
  const subtractionGroups = new Map<number, FallbackCall>();

  valid.forEach((caller) => {
    const tens = Math.floor(caller / 10);
    const units = caller % 10;
    addLocalBalsaFallbackCall(
      additionGroups,
      tens + units,
      [caller],
      "addition",
      `${tens} + ${units} = ${tens + units}`,
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
      if (!isRealBalsaNumber(called)) continue;
      addLocalBalsaFallbackCall(
        subtractionGroups,
        called,
        [first, second],
        "soustraction",
        `${second} − ${first} = ${called}`,
      );
    }
  }

  const additions = [...additionGroups.values()]
    .filter((call) => call.callers.length >= 2)
    .sort(
      (left, right) =>
        right.called - left.called || left.callers[0] - right.callers[0],
    );
  const subtractions = [...subtractionGroups.values()].sort(
    (left, right) =>
      right.called - left.called || left.callers[0] - right.callers[0],
  );
  const intervals = calculateLocalBalsaIntervalCalls(valid);
  const calls = [...additions, ...subtractions, ...intervals];
  return {
    validNumbers: valid,
    calls,
    selected: calls[0] || null,
  };
}

function relationLabel(totalNumbers: number): string {
  const labels: Record<number, string> = {
    2: "Couplé",
    3: "Triplé",
    4: "Quadruplé",
    5: "Quintuplet",
    6: "Sextuplet",
    7: "Septuplet",
    8: "Octuplet",
  };
  return labels[totalNumbers] || `${totalNumbers} numéros liés`;
}

function relationNumbers(callers: number[], called: number): number[] {
  const uniqueCallers = [
    ...new Set(
      (callers || [])
        .map(Number)
        .filter(isRealBalsaNumber),
    ),
  ];
  return uniqueCallers.length
    ? [called, ...uniqueCallers]
    : [called];
}

function groupMultiplicationRelations(calls: MultiplicationCall[]) {
  const byCalled = new Map<number, MultiplicationCall[]>();
  calls.forEach((call) => {
    const current = byCalled.get(call.called) || [];
    current.push(call);
    byCalled.set(call.called, current);
  });

  const grouped: Array<Record<string, unknown>> = [];
  byCalled.forEach((calledCalls, called) => {
    const callers = [
      ...new Set(calledCalls.map((call) => call.caller)),
    ];
    
    /*
     * Public order is intentional:
     * each individual call is shown as a couple first, then the complete
     * group is shown as a triplet/quadruplet when at least two callers exist.
     */
    calledCalls.forEach((call) => {
      grouped.push({
        label: relationLabel(2),
        type: "relation",
        numbers: [called, call.caller],
      });
    });

    if (callers.length >= 2) {
      grouped.push({
        label: relationLabel(callers.length + 1),
        type: "relation",
        numbers: [called, ...callers],
      });
    }
  });
  return grouped;
}

function balsaPlusAnalysis(numbers: number[]) {
  // Only relations between the ten supplied numbers are retained. A
  // calculated product, sum or difference that is absent from the input
  // list is not a new proposal and must never be returned.
  const multiplication = calculateLocalBalsaMultiplicationCalls(numbers);
  const fallback = calculateLocalBalsaFallbackCalls(numbers);
  const available = new Set(numbers);
  const belongsToInput = (call: any) =>
    available.has(Number(call.called)) &&
    (call.caller != null
      ? available.has(Number(call.caller))
      : Array.isArray(call.callers) &&
        call.callers.length > 0 &&
        call.callers.every((caller: number) => available.has(Number(caller))));
  const multiplicationCalls = multiplication.calls.filter(belongsToInput);
  const fallbackCalls = fallback.calls.filter(belongsToInput);
  const useMultiplication = multiplicationCalls.length > 0;
  const calls = useMultiplication
    ? groupMultiplicationRelations(multiplicationCalls)
    : fallbackCalls;

  /*
   * Only the public relation is returned. The calculation method,
   * operation, arithmetic and expressions remain server-side.
   */
  /*
   * A number never appears twice in the same group ([14, 14, 28] becomes
   * [14, 28]); groups reduced to a single number or identical to an
   * earlier group are dropped, and the label follows the unique count.
   */
  const seenRelations = new Set<string>();
  const publicCalls = calls.map((call: any) => {
    const rawNumbers: number[] = Array.isArray(call.numbers)
      ? call.numbers.map(Number).filter(isRealBalsaNumber)
      : relationNumbers(
          Array.isArray(call.callers)
            ? call.callers
            : call.caller != null
              ? [call.caller]
              : [],
          Number(call.called),
        );
    const numbersInRelation = [...new Set(rawNumbers)];
    const key = [...numbersInRelation].sort((a, b) => a - b).join("-");
    if (numbersInRelation.length < 2 || seenRelations.has(key)) return null;
    seenRelations.add(key);

    return {
      label: relationLabel(numbersInRelation.length),
      type: "relation",
      numbers: numbersInRelation.map((number: number) =>
        String(number).padStart(2, "0"),
      ),
    };
  }).filter(Boolean);

  return {
    inputNumbers: numbers.map((number) => String(number).padStart(2, "0")),
    calls: publicCalls,
    selected: publicCalls[0] || null,
  };
}

function digitCounts(groups: SourceGroup[]): number[] {
  const counts = Array.from({ length: 10 }, () => 0);
  groups.forEach((group) => {
    group.values.forEach((row) => {
      [...row].forEach((digit) => {
        counts[Number(digit)] += 1;
      });
    });
  });
  return counts;
}

function buildCandidates(groups: SourceGroup[], counts: number[]): Candidate[] {
  const occurrences = new Map<number, Candidate>();
  let order = 0;

  groups.forEach((group) => {
    group.values.forEach((row) => {
      POSITIONS.forEach(([leftIndex, rightIndex]) => {
        const number = Number(`${row[leftIndex]}${row[rightIndex]}`);
        if (number < 1 || number > 90) return;
        const existing = occurrences.get(number);
        const support =
          counts[Number(row[leftIndex])] + counts[Number(row[rightIndex])];
        if (existing) {
          existing.count += 1;
          existing.digitSupport = Math.max(existing.digitSupport, support);
        } else {
          occurrences.set(number, {
            number,
            count: 1,
            digitSupport: support,
            firstSeen: order,
          });
        }
        order += 1;
      });
    });
  });

  /*
   * A matrix made of repeated digits can produce fewer than ten distinct
   * pairs. The complete 1–90 pass fills the remaining places according to
   * the same digit-frequency principle without adding random numbers.
   */
  for (let number = 1; number <= 90; number += 1) {
    if (occurrences.has(number)) continue;
    const formatted = String(number).padStart(2, "0");
    occurrences.set(number, {
      number,
      count: 0,
      digitSupport: counts[Number(formatted[0])] + counts[Number(formatted[1])],
      firstSeen: order,
    });
    order += 1;
  }

  return [...occurrences.values()].sort(
    (left, right) =>
      right.count - left.count ||
      right.digitSupport - left.digitSupport ||
      left.firstSeen - right.firstSeen ||
      left.number - right.number,
  );
}

function levelAnalysis(groups: SourceGroup[], counts: number[]) {
  const labels = ["centaines", "dizaines", "unités"];
  return groups.map((group) => ({
    source: group.key,
    label: group.label,
    levels: labels.map((label, index) => {
      const values = group.values.map((row) => row[index]);
      const repeated = [...new Set(values)]
        .map((digit) => ({
          digit,
          count: values.filter((value) => value === digit).length,
        }))
        .filter((item) => item.count > 1)
        .sort(
          (left, right) =>
            right.count - left.count ||
            Number(left.digit) - Number(right.digit),
        );
      return { level: label, values, repeated };
    }),
    totalDigitCounts: counts,
  }));
}

function getUserId(
  request: Request,
  client: ReturnType<typeof getAdminClient>,
): Promise<string | null> {
  const token =
    request.headers
      .get("Authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim() || "";
  if (!token) return Promise.resolve(null);
  return client.auth
    .getUser(token)
    .then((session) => (session.error ? null : session.data?.user?.id || null));
}

async function saveHistory(
  client: ReturnType<typeof getAdminClient>,
  userId: string,
  payload: {
    name: string;
    date: string;
  matrix: string[];
  keyboard: string[];
  cerveau: string[];
  code: string;
  event: string;
  result: Record<string, unknown>;
  fingerprint?: string | null;
  },
): Promise<boolean> {
  const rpcPayload = {
    p_user_id: userId,
    p_country_name: payload.name,
    p_programme_date: payload.date,
    p_matrix: payload.matrix,
    p_keyboard: payload.keyboard,
    p_cerveau: payload.cerveau,
    p_code: payload.code,
    p_event: payload.event,
    p_result: payload.result,
    p_status: "completed",
    p_error_message: null,
    p_matrix_fingerprint: payload.fingerprint || null,
  };
  let { error } = await client.rpc(
    "record_matrix_decoding",
    rpcPayload,
  );

  /*
   * Keep history compatible with a database that still has the old
   * twelve-argument RPC. The calculation remains valid while the additive
   * uniqueness migration is being applied.
   */
  if (
    error &&
    (
      String(error.code || "") === "PGRST202" ||
      /schema cache|could not find the function|record_matrix_decoding/i
        .test(String(error.message || ""))
    )
  ) {
    const legacyPayload = { ...rpcPayload };
    delete (legacyPayload as Record<string, unknown>).p_matrix_fingerprint;
    ({ error } = await client.rpc(
      "record_matrix_decoding",
      legacyPayload,
    ));
  }

  if (error) {
    console.warn("matrix decoding history was not saved", error);
    return false;
  }
  return true;
}

async function createMatrixFingerprint(
  matrix: string[],
  keyboard: string[],
  cerveau: string[],
): Promise<string> {
  const canonical = JSON.stringify({
    matrix,
    keyboard,
    cerveau,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function missingProgramTable(error: any): boolean {
  return (
    String(error?.code || "") === "42P01" ||
    /matrix_decoding_programs|relation .* does not exist/i.test(
      String(error?.message || ""),
    )
  );
}

async function findExistingMatrixProgram(
  client: ReturnType<typeof getAdminClient>,
  fingerprint: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await client
    .from("matrix_decoding_programs")
    .select("result")
    .eq("matrix_fingerprint", fingerprint)
    .maybeSingle();

  if (error) {
    if (missingProgramTable(error)) return null;
    throw error;
  }

  return data?.result &&
      typeof data.result === "object" &&
      !Array.isArray(data.result)
    ? data.result as Record<string, unknown>
    : null;
}

async function storeUniqueMatrixProgram(
  client: ReturnType<typeof getAdminClient>,
  fingerprint: string,
  matrix: string[],
  keyboard: string[],
  cerveau: string[],
  result: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const { error } = await client
    .from("matrix_decoding_programs")
    .upsert(
      {
        matrix_fingerprint: fingerprint,
        matrix,
        keyboard,
        cerveau,
        result,
      },
      {
        onConflict: "matrix_fingerprint",
        ignoreDuplicates: true,
      },
    );

  if (error) {
    if (missingProgramTable(error)) return null;
    throw error;
  }

  return findExistingMatrixProgram(client, fingerprint);
}

function reuseExistingProgramResult(
  current: Record<string, unknown>,
  existing: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!existing) return current;

  /*
   * Reuse only the calculated result. Metadata such as name, date, Code and
   * Event belongs to the current request and must not leak from another user.
   */
  return {
    ...current,
    ten_numbers: existing.ten_numbers || current.ten_numbers,
    analysis: existing.analysis || current.analysis,
  };
}

async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "Méthode non autorisée." }, 405);
  }

  try {
    let body: DecodeBody;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json(
          {
            error: "Le corps de la requête doit être un objet JSON.",
          },
          400,
        );
      }
      body = parsed as DecodeBody;
    } catch (_) {
      return json(
        {
          error: "Le corps de la requête doit être un JSON valide.",
        },
        400,
      );
    }

    const requestedAction = String(body.action || "")
      .trim()
      .toLowerCase();
    if (requestedAction === "plus") {
      const plusAccessDenied = await enforceFeatureAccess(
        request,
        "tableaux-dechiffrement-plus",
      );
      if (plusAccessDenied) return plusAccessDenied;

      const numbers = normalizeNumbers(body.numbers);
      const plus = balsaPlusAnalysis(numbers);
      const client = getAdminClient();
      const userId =
        body.saveHistory === false ? null : await getUserId(request, client);
      let historySaved = false;
      if (userId) {
        historySaved = await saveHistory(client, userId, {
          name:
            text(body.name ?? body.countryName, 120, "Nom") ||
            "Matrice manuelle",
          date:
            normalizeDate(body.programmeDate ?? body.date) ||
            currentProgrammeDate(),
          matrix: [],
          keyboard: [],
          cerveau: [],
          code: text(body.code, 64, "Code"),
          event: text(body.event, 64, "Event"),
          result: {
            type: "dechiffrement-plus",
            ...plus,
          },
        });
      }

      return json({
        ok: true,
        plus,
        history: {
          saved: historySaved,
          authenticated: Boolean(userId),
        },
      });
    }

    const accessDenied = await enforceFeatureAccess(
      request,
      "calculatrice-matrice",
    );
    if (accessDenied) return accessDenied;

    const matrix = normalizeTriplets(body.matrix, "Matrice");
    const keyboard = normalizeTriplets(body.keyboard, "Clavier");
    const cerveau = normalizeTriplets(body.cerveau ?? body.brain, "Cerveau");

    if (matrix.length !== 4) {
      return json(
        {
          error:
            "La Matrice doit contenir exactement 4 lignes de trois chiffres.",
        },
        400,
      );
    }

    const requestedDate = normalizeDate(body.programmeDate ?? body.date);
    if ((body.programmeDate != null || body.date != null) && !requestedDate) {
      return json(
        {
          error: "La date doit être au format YYYY-MM-DD ou DD-MM-YYYY.",
        },
        400,
      );
    }

    const groups: SourceGroup[] = [
      { key: "matrix", label: "Matrice", values: matrix },
      ...(keyboard.length
        ? [{ key: "keyboard" as const, label: "Clavier", values: keyboard }]
        : []),
      ...(cerveau.length
        ? [{ key: "cerveau" as const, label: "Cerveau", values: cerveau }]
        : []),
    ];
    const counts = digitCounts(groups);
    const candidates = buildCandidates(groups, counts);
    const tenNumbers = candidates
      .slice(0, 10)
      .map((candidate) => String(candidate.number).padStart(2, "0"));
    const name =
      text(body.name ?? body.countryName, 120, "Nom") || "Matrice manuelle";
    const code = text(body.code, 64, "Code");
    const event = text(body.event, 64, "Event");
    const date = requestedDate || currentProgrammeDate();
    const program = {
      name,
      country: name,
      date,
      matrix,
      keyboard,
      cerveau,
      code,
      event,
      ten_numbers: tenNumbers,
      source: "manual-frequency-analysis",
      analysis: {
        digitCounts: counts,
        levels: levelAnalysis(groups, counts),
        repeatedNumbers: candidates.slice(0, 10).map((candidate) => ({
          number: String(candidate.number).padStart(2, "0"),
          repetitions: candidate.count,
          digitSupport: candidate.digitSupport,
        })),
      },
    };

    const client = getAdminClient();
    const fingerprint = await createMatrixFingerprint(
      matrix,
      keyboard,
      cerveau,
    );
    const existingProgram = await findExistingMatrixProgram(
      client,
      fingerprint,
    );
    const storedProgram = existingProgram ||
      await storeUniqueMatrixProgram(
        client,
        fingerprint,
        matrix,
        keyboard,
        cerveau,
        program,
      );
    const resolvedProgram = reuseExistingProgramResult(
      program,
      storedProgram,
    );
    const userId =
      body.saveHistory === false ? null : await getUserId(request, client);
    const historySaved = userId
      ? await saveHistory(client, userId, {
          name,
          date,
          matrix,
          keyboard,
          cerveau,
          code,
          event,
          result: resolvedProgram,
          fingerprint,
        })
      : false;

    return json({
      ok: true,
      program: resolvedProgram,
      existing: Boolean(existingProgram),
      history: {
        saved: historySaved,
        authenticated: Boolean(userId),
      },
    });
  } catch (error) {
    if (error instanceof InputError) {
      return json({ error: error.message }, 400);
    }
    console.error("dechiffrement failed", error);
    return json(
      {
        error: "Impossible d’exécuter l’analyse autonome de la Matrice.",
      },
      500,
    );
  }
}

Deno.serve(handler);
