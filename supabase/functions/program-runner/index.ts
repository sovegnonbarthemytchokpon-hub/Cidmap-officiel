import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { enforceEarlyAccess } from '../_shared.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};
const TIME_ZONE = 'Africa/Abidjan';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function sumDigits(value: unknown): number {
  return String(Math.abs(Number(value) || 0))
    .split('')
    .reduce((sum, digit) => sum + Number(digit), 0);
}

function pad2(value: unknown): string {
  return String(value ?? '').padStart(2, '0').slice(-2);
}

function extractLuckyNumbersFromDate(date: Date) {
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
  const dateDigits =
    `${String(day).padStart(2, '0')}${String(month).padStart(2, '0')}${year}`;
  const dateDigitSum = sumDigits(dateDigits);
  const calculations: Record<string, unknown>[] = [];
  const lucky = new Set<number>();

  const addLucky = (
    label: string,
    expression: string,
    value: number
  ) => {
    let result = Math.abs(Number(value));
    if (!Number.isFinite(result) || result === 0) return;
    while (result > 90) result = sumDigits(result);
    lucky.add(result);
    calculations.push({
      label,
      expression,
      value: Number(value),
      result
    });
  };

  [
    ['Jour', 'J', day],
    ['Mois', 'M', month],
    [
      'Deux derniers chiffres du compteur',
      `${dayOfYear} → ${counterLastTwo}`,
      counterLastTwo
    ],
    [
      'Somme des chiffres du compteur',
      String(dayOfYear).split('').join(' + '),
      counterDigitSum
    ],
    ['J + M', `${day} + ${month}`, day + month],
    ['J + A', `${day} + ${shortYear}`, day + shortYear],
    ['A − M', `${shortYear} − ${month}`, shortYear - month],
    [
      'J + M + A',
      `${day} + ${month} + ${shortYear}`,
      day + month + shortYear
    ]
  ].forEach(([label, expression, value]) => {
    addLucky(
      String(label),
      String(expression),
      Number(value)
    );
  });

  const grandBlock = day + month + year;
  const grandBlockText = String(grandBlock);
  const firstBlock = Number(grandBlockText.slice(0, 2));
  const secondBlock = Number(grandBlockText.slice(2, 4));

  addLucky(
    'Total global',
    `${day} + ${month} + ${year}`,
    grandBlock
  );

  addLucky(
    'Somme des chiffres du total',
    String(grandBlock).split('').join(' + '),
    sumDigits(grandBlock)
  );

  addLucky(
    'Assemblage des blocs',
    `${firstBlock} + ${secondBlock}`,
    firstBlock + secondBlock
  );

  addLucky(
    'Découpage du bloc',
    `${firstBlock} + ${grandBlockText.slice(2, 3)} + ${grandBlockText.slice(3, 4)}`,
    firstBlock
      + Number(grandBlockText.slice(2, 3))
      + Number(grandBlockText.slice(3, 4))
  );

  addLucky(
    'Somme de tous les chiffres de la date',
    `${dateDigits} → ${dateDigitSum}`,
    dateDigitSum
  );

  const luckyNumbers = [...lucky].sort(
    (left, right) => left - right
  );

  return {
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
      grandBlock
    },
    calculations,
    luckyNumbers,
    odd: luckyNumbers.filter(
      (number) => number % 2 === 1
    ),
    even: luckyNumbers.filter(
      (number) => number % 2 === 0
    )
  };
}

function canonicalFeatureKey(value: unknown): string {
  const aliases: Record<string, string> = {
    universelle: 'tableaux-universelle',
    intuition: 'tableaux-intuition',
    oracle: 'tableaux-oracle',
    lnb: 'tableaux-lnb',
    balsa: 'tableaux-balsa',
    standby: 'tableaux-standby'
  };
  const key = String(value || '').trim().toLowerCase();
  return aliases[key] || key;
}

function planIncludesFeature(plan: any, featureKey: string): boolean {
  const wanted = canonicalFeatureKey(featureKey);
  const features = Array.isArray(plan?.features)
    ? plan.features.map(canonicalFeatureKey)
    : [];
  if (features.includes(wanted) || features.includes('tableaux')) return true;
  return wanted === 'tableaux'
    && features.some((item: string) => item.startsWith('tableaux-'));
}

function missingAccessTables(error: any): boolean {
  return String(error?.code || '') === '42P01'
    || /subscription_plans|feature_access_rules|user_subscriptions|user_feature_unlocks|feature_early_access_rules|relation .* does not exist|column .* does not exist|schema cache/i
      .test(String(error?.message || ''));
}

async function enforceFeatureAccess(
  request: Request,
  featureKey: string
): Promise<Response | null> {
  const client = getAdminClient();
  const wanted = canonicalFeatureKey(featureKey);

  const [plansResult, rulesResult] = await Promise.all([
    client
      .from('subscription_plans')
      .select('slug,features,enabled'),
    client
      .from('feature_access_rules')
      .select('feature_key,plan_slug,required_stars,required_tokens,enabled')
  ]);

  if (
    missingAccessTables(plansResult.error)
    || missingAccessTables(rulesResult.error)
  ) {
    return wanted === 'tableaux' || wanted.startsWith('tableaux-')
      ? json({ error: 'Abonnement actif non vérifiable.' }, 403)
      : null;
  }

  if (plansResult.error) throw plansResult.error;
  if (rulesResult.error) throw rulesResult.error;

  const allPlans = plansResult.data || [];
  const enabledPlans = allPlans.filter(
    (plan: any) => plan.enabled !== false
  );
  const enabledPlanSlugs = new Set(
    enabledPlans.map((plan: any) => plan.slug)
  );
  const isTableauxFeature = wanted === 'tableaux'
    || wanted.startsWith('tableaux-');

  const rule = (rulesResult.data || []).find((item: any) => (
    item.enabled !== false
    && canonicalFeatureKey(item.feature_key) === wanted
    && (
      !item.plan_slug
      || enabledPlanSlugs.has(item.plan_slug)
    )
  ));

  const protectedByOffer = enabledPlans.some(
    (plan: any) => planIncludesFeature(plan, wanted)
  );

  if (!isTableauxFeature && !rule && !protectedByOffer) {
    return null;
  }
  if (
    rule
    && !rule.plan_slug
    && Number(rule.required_stars || 0) <= 0
    && Number(rule.required_tokens || 0) <= 0
    && !protectedByOffer
  ) {
    return null;
  }

  const token = request.headers
    .get('Authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim() || '';

  if (!token) {
    return json({
      error: 'Connexion requise pour accéder à cette section.'
    }, 401);
  }

  const session = await client.auth.getUser(token);

  if (
    session.error
    || !session.data?.user?.id
  ) {
    return json({
      error: 'Session invalide.'
    }, 401);
  }

  const userId = session.data.user.id;

  const adminRole = await client
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .maybeSingle();

  if (
    !adminRole.error
    && adminRole.data?.role === 'admin'
  ) {
    return null;
  }

  const principal = await client
    .from('admin_control_settings')
    .select('principal_user_id')
    .eq('id', true)
    .limit(1)
    .maybeSingle();
  if (!principal.error && principal.data?.principal_user_id === userId) {
    return null;
  }

  const now = new Date().toISOString();

  const unlock = await client
    .from('user_feature_unlocks')
    .select('feature_key,unlocked_at,expires_at')
    .eq('user_id', userId)
    .eq('feature_key', wanted)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .maybeSingle();

  if (unlock.error) {
    if (missingAccessTables(unlock.error)) {
      return isTableauxFeature
        ? json({ error: 'Le déblocage individuel n’est pas encore configuré.' }, 403)
        : null;
    }
    throw unlock.error;
  }

  if (unlock.data) return null;

  const subscription = await client
    .from('user_subscriptions')
    .select('plan_slug,status,started_at,expires_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .lte('started_at', now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .limit(1)
    .maybeSingle();
  if (subscription.error) {
    if (missingAccessTables(subscription.error)) {
      return json({ error: 'Abonnement actif non vérifiable.' }, 403);
    }
    throw subscription.error;
  }
  const plan = allPlans.find(
    (item: any) => item.slug === subscription.data?.plan_slug
  );
  return plan && planIncludesFeature(plan, wanted)
    ? null
    : json({ error: 'Ce schéma n’est pas débloqué pour ce compte.' }, 403);
}

function publicProgramPayload(payload: any) {
  const cross = payload?.cross
    && typeof payload.cross === 'object'
    ? {
        top: String(payload.cross.top ?? ''),
        bottom: String(payload.cross.bottom ?? ''),
        left: String(payload.cross.left ?? ''),
        right: String(payload.cross.right ?? '')
      }
    : null;

  const satellites = Array.isArray(payload?.satellites)
    ? payload.satellites.map((satellite: any) => {
        const combinations = Array.isArray(satellite?.combinations)
          ? satellite.combinations.map((parts: any) => {
              const safeParts = (Array.isArray(parts)
                ? parts.map((part: any) => ({
                    value: Number(part?.value ?? 0),
                    yellow: Boolean(part?.yellow)
                  }))
                : []) as Array<{ value: number; yellow: boolean }> & {
                  operator?: string;
                };
              safeParts.operator = parts?.operator === '−' ? '−' : '+';
              return safeParts;
            })
          : [];
        return {
          value: Number(satellite?.value ?? 0),
          combinations
        };
      })
    : [];

  const output: Record<string, unknown> = {};

  [
    'id',
    'displayName',
    'functionName',
    'theme',
    'sourceTemplate',
    'visualTemplate',
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
    if (payload?.[key] !== undefined) {
      output[key] = payload[key];
    }
  });

  if (cross) {
    output.cross = cross;
  }

  output.satellites = satellites;

  if (
    payload?.nap
    && typeof payload.nap === 'object'
  ) {
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
  if (output.selectedNumber !== undefined) output.selectedNumber = '00';
  if (output.power !== undefined) output.power = '00';
  if (output.result !== undefined) output.result = '00';
  if (output.cross && typeof output.cross === 'object') {
    output.cross = {
      ...(output.cross as Record<string, unknown>),
      top: '0',
      bottom: '0',
      left: '0',
      right: '0'
    };
  }
  output.satellites = [{ value: '00' }];
  if (output.nap && typeof output.nap === 'object') {
    output.nap = {
      nap1: ['00'],
      nap2: ['00']
    };
  }
  return output;
}

function reduceTo90(value: unknown): number {
  let result = Math.abs(Number(value) || 0);
  while (result > 90) {
    result = sumDigits(result);
  }
  return result || 1;
}

function buildKeyFromValues(values: unknown[]): string {
  const normalized = values.map(
    (value) => pad2(reduceTo90(value))
  );

  return `${normalized[0] || '01'}${normalized[1] || '02'}${normalized[2] || pad2(
    sumDigits(
      `${normalized[0] || '01'}${normalized[1] || '02'}`
    )
  )}`.padStart(6, '0').slice(-6);
}

function createCross(
  primaryValue: unknown,
  secondaryValue = 63
) {
  const primary = pad2(primaryValue);
  const secondary = pad2(secondaryValue);

  return {
    top: primary[0],
    bottom: primary[1],
    left: secondary[0],
    right: secondary[1],
    base1: Number(primary) || 0,
    base2: Number(secondary) || 0
  };
}

function decryptCross(cross: any) {
  const digits = [
    cross.top,
    cross.bottom,
    cross.left,
    cross.right
  ];

  const raw: any[] = [];

  for (let i = 0; i < 4; i += 1) {
    for (let j = i + 1; j < 4; j += 1) {
      const rest = [0, 1, 2, 3].filter(
        (index) => index !== i && index !== j
      );

      const left = [
        Number(`${digits[i]}${digits[j]}`),
        Number(`${digits[j]}${digits[i]}`)
      ];

      const right = [
        Number(`${digits[rest[0]]}${digits[rest[1]]}`),
        Number(`${digits[rest[1]]}${digits[rest[0]]}`)
      ];

      [...new Set(left)].forEach((first) => {
        [...new Set(right)].forEach((second) => {
          raw.push({
            sum: first + second,
            pair1: {
              number: first,
              indices: [i, j]
            },
            pair2: {
              number: second,
              indices: rest
            }
          });
        });
      });
    }
  }

  const groups = new Map<number, any[]>();
  const subtractionGroups = new Map<number, any[]>();

  const add = (
    map: Map<number, any[]>,
    value: number,
    item: any
  ) => {
    if (
      !Number.isInteger(value)
      || value < 1
      || value > 90
    ) {
      return;
    }

    const list = map.get(value) || [];
    const signature =
      `${Math.min(item.pair1.number, item.pair2.number)}_`
      + `${Math.max(item.pair1.number, item.pair2.number)}`;

    if (!list.some((entry) => (
      `${Math.min(entry.pair1.number, entry.pair2.number)}_`
      + `${Math.max(entry.pair1.number, entry.pair2.number)}`
      === signature
    ))) {
      list.push(item);
    }

    map.set(value, list);
  };

  raw.forEach((item) => {
    if (item.sum <= 90) {
      add(groups, item.sum, item);
      return;
    }

    const first = item.pair1.number;
    const second = item.pair2.number;

    if (first !== second) {
      add(
        subtractionGroups,
        Math.abs(first - second),
        first >= second
          ? item
          : {
              ...item,
              pair1: item.pair2,
              pair2: item.pair1
            }
      );
    }
  });

  const output = new Map<number, any>();

  const append = (
    map: Map<number, any[]>,
    operation: 'addition' | 'subtraction'
  ) => {
    map.forEach((list, value) => {
      if (
        list.length < 2
        || output.has(value)
      ) {
        return;
      }

      const operator =
        operation === 'subtraction'
          ? '−'
          : '+';

      const makeCombination = (
        item: any
      ) => {
        const result = [
          {
            value: item.pair1.number,
            yellow: item.pair1.indices.some(
              (index: number) =>
                index === 0 || index === 3
            )
          },
          {
            value: item.pair2.number,
            yellow: item.pair2.indices.some(
              (index: number) =>
                index === 0 || index === 3
            )
          }
        ] as any;

        result.operator = operator;
        return result;
      };

      output.set(value, {
        value,
        operation,
        combinations: [
          makeCombination(list[0]),
          makeCombination(list[1])
        ]
      });
    });
  };

  append(groups, 'addition');
  append(subtractionGroups, 'subtraction');

  return [...output.values()].sort(
    (a, b) => a.value - b.value
  );
}

function calculateCrossAndSatellites(
  key: string,
  secondaryBase = 63,
  source: 'code' | 'remainder' | 'magic' = 'code'
) {
  const safeKey = key.padStart(6, '0').slice(-6);

  const primary =
    source === 'remainder'
      ? safeKey.slice(-2)
      : safeKey.slice(0, 2);

  const secondary =
    source === 'magic'
      ? safeKey.slice(2, 4)
      : secondaryBase;

  const cross = createCross(
    primary,
    secondary
  );

  return {
    cross,
    satellites:
      decryptCross(cross).slice(0, 10)
  };
}

function getAdminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Configuration Supabase serveur incomplète.');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function parseDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function programmeDateFromClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const part = (type: string) =>
    Number(parts.find((entry) => entry.type === type)?.value);
  return new Date(Date.UTC(
    part('year'),
    part('month') - 1,
    part('day') + (part('hour') >= 16 ? 1 : 0),
    12
  ));
}

function numberValue(value: unknown, context: Record<string, any>) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  if (typeof value !== 'string') return 0;
  const path = value.split('.');
  let current = context;
  for (const part of path) {
    if (current === null || current === undefined) return 0;
    current = current[part];
  }
  return Number(current) || 0;
}

function chooseNumber(numbers: number[], selection: unknown) {
  const sorted = numbers.slice().sort((left, right) => left - right);
  const mode = String(selection || 'plus_grand_numero');
  const filtered = mode.includes('pair')
    ? sorted.filter((number) => number % 2 === 0)
    : mode.includes('impair')
      ? sorted.filter((number) => number % 2 === 1)
      : sorted;
  if (!filtered.length) return sorted.at(-1) || 1;
  return mode.includes('petit') ? filtered[0] : filtered.at(-1);
}

function calculateUniversalConfiguredProgram(date: Date, catalog: any, control: any) {
  const details = extractLuckyNumbersFromDate(date);
  const luckyNumbers = details.luckyNumbers;
  const rule = control?.rule && typeof control.rule === 'object' ? control.rule : {};
  const operations = Array.isArray(rule.operations)
    ? rule.operations.map(String)
    : ['addition_chiffres', 'multiplication_chiffres'];
  const candidates = luckyNumbers
    .filter((value) => value >= 10 && value <= 90)
    .sort((left, right) => right - left);
  const generator = candidates.find((value) => {
    const tens = Math.floor(value / 10);
    const units = value % 10;
    const sum = tens + units;
    const product = tens * units;
    return (operations.includes('addition_chiffres') && luckyNumbers.includes(sum))
      || (operations.includes('multiplication_chiffres') && luckyNumbers.includes(product));
  });
  const keyParts = generator
    ? (() => {
        const tens = Math.floor(generator / 10);
        const units = generator % 10;
        const sum = tens + units;
        const product = tens * units;
        const sumCalled = operations.includes('addition_chiffres') && luckyNumbers.includes(sum);
        const productCalled = operations.includes('multiplication_chiffres') && luckyNumbers.includes(product);
        const order = Array.isArray(rule.si_deux_appels) && rule.si_deux_appels.length === 3
          ? rule.si_deux_appels.map(String)
          : ['addition', 'multiplication', 'generateur'];
        const values: Record<string, number> = {
          addition: sum, multiplication: product, generateur: generator
        };
        return sumCalled && productCalled
          ? order.map((part) => values[part])
          : productCalled ? [product, generator, product] : [sum, generator, sum];
      })()
    : [];
  const key = keyParts.length === 3 ? keyParts.map((value) => String(value).padStart(2, '0')).join('') : '';
  const base2 = 63;
  const { cross, satellites } = key
    ? calculateCrossAndSatellites(key, base2)
    : { cross: null, satellites: [] };
  const nap1 = generator ? [
    String(keyParts[0] || 0).padStart(2, '0'),
    String(generator).padStart(2, '0')
  ] : [];
  return {
    id: catalog.program_key,
    functionName: catalog.function_name,
    displayName: catalog.display_name,
    theme: catalog.theme || {},
    date: date.toISOString().slice(0, 10),
    sourceTemplate: catalog.source_template,
    visualTemplate: catalog.visual_template || catalog.source_template,
    schedules: catalog.schedules || [],
    controlVersion: control?.version || 0,
    luckyNumbers,
    luckyNumberDetails: details,
    selectedNumber: generator || null,
    key: key || null,
    order: key ? key.split('').sort().join('') : null,
    code: key ? key.slice(0, 2) : null,
    filter: key ? key.slice(2, 4) : null,
    addition: key ? String(sumDigits(key)) : null,
    cross,
    satellites,
    nap: { nap1, nap2: nap1.slice() },
    trace: { source: 'numeros_jaunes_du_jour', operations, generator }
  };
}

function calculateConfiguredProgram(date: Date, catalog: any, control: any) {
  if (catalog.source_template === 'universelle') {
    return calculateUniversalConfiguredProgram(date, catalog, control);
  }
  const details = extractLuckyNumbersFromDate(date);
  const luckyNumbers = details.luckyNumbers;
  const rule = control?.rule && typeof control.rule === 'object' ? control.rule : {};
  const selected = chooseNumber(
    luckyNumbers,
    rule.selection || 'plus_grand_numero'
  );
  const context: Record<string, any> = {
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
    shortYear: date.getUTCFullYear() % 100,
    dayOfYear: details.components.dayOfYear,
    selected,
    luckyNumbers,
    steps: {}
  };

  const steps = Array.isArray(rule.steps) ? rule.steps : [];
  steps.forEach((step: any, index: number) => {
    const id = String(step?.id || `step${index + 1}`);
    const left = numberValue(step?.left, context);
    const right = numberValue(step?.right, context);
    const operation = String(step?.operation || 'add');
    const result = operation === 'multiply'
      ? left * right
      : operation === 'subtract'
        ? left - right
        : operation === 'sum_digits'
          ? sumDigits(left)
          : left + right;
    context.steps[id] = Math.abs(result) || 1;
  });

  const keyParts = Array.isArray(rule.key) && rule.key.length >= 3
    ? rule.key.slice(0, 3).map((value: unknown) => numberValue(value, context))
    : [
        context.steps[Object.keys(context.steps)[0]] || selected,
        context.steps[Object.keys(context.steps)[1]] || date.getUTCMonth() + 1,
        context.steps[Object.keys(context.steps)[2]] || date.getUTCDate()
      ];
  const key = buildKeyFromValues(keyParts);
  const base2 = Number(rule.base2) >= 1 && Number(rule.base2) <= 90
    ? Number(rule.base2)
    : 63;
  const { cross, satellites } = calculateCrossAndSatellites(key, base2);
  const nap1 = Array.isArray(rule.nap1) && rule.nap1.length
    ? rule.nap1.map((value: unknown) => String(numberValue(value, context)).padStart(2, '0'))
    : [key.slice(-2), key.slice(0, 2)];

  return {
    id: catalog.program_key,
    functionName: catalog.function_name,
    displayName: catalog.display_name,
    theme: catalog.theme || {},
    date: date.toISOString().slice(0, 10),
    sourceTemplate: catalog.source_template,
    visualTemplate: catalog.visual_template || catalog.source_template,
    schedules: catalog.schedules || [],
    controlVersion: control?.version || 0,
    luckyNumbers,
    luckyNumberDetails: details,
    selectedNumber: selected,
    key,
    order: key.split('').sort().join(''),
    code: key.slice(0, 2),
    filter: key.slice(2, 4),
    addition: String(sumDigits(key)),
    cross,
    satellites,
    nap: { nap1, nap2: nap1.slice() },
    trace: {
      selection: rule.selection || 'plus_grand_numero',
      steps: context.steps,
      keyParts,
      base2
    }
  };
}

async function loadPublishedPrograms(client: any) {
  const builtInProgramKeys = new Set([
    'universal',
    'universelle',
    'intuition',
    'oracle',
    'lnb',
    'balsa',
    'balsa-plus',
    'standby',
    'stand-by',
    'robot'
  ]);
  const catalog = await client
    .from('program_catalog')
    .select('program_key,display_name,function_name,source_template,visual_template,schedules,theme,enabled')
    .eq('enabled', true)
    .order('updated_at', { ascending: false });
  if (catalog.error) throw catalog.error;
  const output = [];
  for (const program of catalog.data || []) {
    const programKey = String(program.program_key || '').trim().toLowerCase();
    if (builtInProgramKeys.has(programKey.replace(/^tableaux[-_]/, ''))) {
      // Built-in Tableaux have dedicated Edge Functions and are rendered in
      // the official portfolio shell. They must not be returned again as a
      // custom programme.
      continue;
    }
    const control = await client
      .from('program_method_controls')
      .select('version,rule,instructions')
      .eq('program_key', program.program_key)
      .eq('status', 'published')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (control.error || !control.data) continue;
    output.push({ program, control: control.data });
  }
  return output;
}

/*
 * Custom programmes can have their own access/anticipation key. When no
 * specific key has been configured yet, keep the historical aggregate
 * `tableaux-created` rule so existing subscriptions continue to work.
 */
async function resolveProgramFeatureKey(client: any, programKey: string) {
  const specificKey = `tableaux-${String(programKey || '').trim().toLowerCase()}`;
  const [rule, plans] = await Promise.all([
    client.from('feature_access_rules')
      .select('feature_key,enabled')
      .eq('feature_key', specificKey)
      .eq('enabled', true)
      .maybeSingle(),
    client.from('subscription_plans')
      .select('features,enabled')
      .eq('enabled', true)
  ]);
  if (!rule.error && rule.data?.enabled === true) return specificKey;
  if (!plans.error && (plans.data || []).some((plan: any) => (
    Array.isArray(plan.features)
      && plan.features.map((item: unknown) => String(item).toLowerCase()).includes(specificKey)
  ))) {
    return specificKey;
  }

  const earlyRule = await client.from('feature_early_access_rules')
    .select('feature_key,enabled')
    .eq('feature_key', specificKey)
    .eq('enabled', true)
    .maybeSingle();
  return !earlyRule.error && earlyRule.data?.enabled === true
    ? specificKey
    : 'tableaux-created';
}

export async function handler(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);
  let body: any = {};
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: 'Le corps de la requête doit être un JSON valide.' }, 400);
  }
  try {
    const date = parseDate(body.date) || programmeDateFromClock();
    const client = getAdminClient();
    const publishedPrograms = await loadPublishedPrograms(client);
    const selected = body.program
      ? publishedPrograms.filter(({ program }) => program.program_key === String(body.program))
      : publishedPrograms;
    const programs = [];
    for (const { program, control } of selected) {
      const payload = publicProgramPayload(
        calculateConfiguredProgram(date, program, control)
      );
      const featureKey = await resolveProgramFeatureKey(client, program.program_key);
      const denied = await enforceFeatureAccess(request, featureKey);
      const earlyDenied = denied
        ? null
        : await enforceEarlyAccess(
          request,
          featureKey,
          date.toISOString().slice(0, 10)
        );
      if (earlyDenied && earlyDenied.status !== 401 && earlyDenied.status !== 403) {
        return earlyDenied;
      }
      programs.push(
        (denied || earlyDenied) ? maskedProgramPayload(payload) : payload
      );
    }
    return json({
      ok: true,
      date: date.toISOString().slice(0, 10),
      programs
    });
  } catch (error) {
    console.error('program-runner failed', error);
    return json({ error: 'Le moteur des programmes est indisponible.' }, 500);
  }
}

Deno.serve(handler);
