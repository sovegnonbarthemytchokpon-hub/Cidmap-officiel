import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/*
 * The programme generation boundary is global. A country's draw time is
 * content metadata (for example 08:00), never a second generation schedule.
 * Keep this invariant in the protected function as well as in SQL.
 */
const PROGRAM_GENERATION_TIME = '16:00';
const PROGRAM_GENERATION_TIME_ZONE = 'Africa/Abidjan';
const PROGRAM_GENERATION_HOUR = Number(PROGRAM_GENERATION_TIME.slice(0, 2));

/*
 * This function is intentionally self-contained.
 * Supabase's dashboard often receives only source/index.ts when a function
 * is pasted manually, so an import from ../_shared.ts would fail there.
 */
function sumDigits(value: unknown): number {
  return String(Math.abs(Number(value) || 0))
    .split('')
    .reduce((sum, digit) => sum + Number(digit), 0);
}

function dateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function programmeDateFromClock(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PROGRAM_GENERATION_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const part = (type: string) =>
    Number(parts.find((item) => item.type === type)?.value);
  return new Date(Date.UTC(
    part('year'),
    part('month') - 1,
    part('day') + (part('hour') >= PROGRAM_GENERATION_HOUR ? 1 : 0),
    12
  ));
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
  const dateDigits = `${String(day).padStart(2, '0')}${String(month).padStart(2, '0')}${year}`;
  const dateDigitSum = sumDigits(dateDigits);
  const calculations: Array<Record<string, unknown>> = [];
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
      label, expression, value: Number(value), result
    });
  };

  [
    ['Jour', 'J', day],
    ['Mois', 'M', month],
    ['Deux derniers chiffres du compteur', `${dayOfYear} → ${counterLastTwo}`, counterLastTwo],
    ['Somme des chiffres du compteur', String(dayOfYear).split('').join(' + '), counterDigitSum],
    ['J + M', `${day} + ${month}`, day + month],
    ['J + A', `${day} + ${shortYear}`, day + shortYear],
    ['A − M', `${shortYear} − ${month}`, shortYear - month],
    ['J + M + A', `${day} + ${month} + ${shortYear}`, day + month + shortYear]
  ].forEach(([label, expression, value]) =>
    addLucky(String(label), String(expression), Number(value))
  );

  const grandBlock = day + month + year;
  const grandBlockText = String(grandBlock);
  const firstBlock = Number(grandBlockText.slice(0, 2));
  const secondBlock = Number(grandBlockText.slice(2, 4));
  addLucky('Total global', `${day} + ${month} + ${year}`, grandBlock);
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
  const blockDecomposition = firstBlock
    + Number(grandBlockText.slice(2, 3))
    + Number(grandBlockText.slice(3, 4));
  addLucky(
    'Découpage du bloc',
    `${firstBlock} + ${grandBlockText.slice(2, 3)} + ${grandBlockText.slice(3, 4)}`,
    blockDecomposition
  );
  addLucky(
    'Somme de tous les chiffres de la date',
    `${dateDigits} → ${dateDigitSum}`,
    dateDigitSum
  );

  const luckyNumbers = [...lucky].sort((a, b) => a - b);
  return {
    date: dateIso(date),
    components: {
      day, month, century, shortYear, year, yearDigitSum, dayOfYear,
      counterLastTwo, counterDigitSum, dateDigitSum, grandBlock
    },
    calculations,
    luckyNumbers,
    odd: luckyNumbers.filter((number) => number % 2 === 1),
    even: luckyNumbers.filter((number) => number % 2 === 0)
  };
}

function pad2(value: unknown): string {
  return String(value ?? '').padStart(2, '0').slice(-2);
}

function createCross(primaryValue: unknown, secondaryValue = 63) {
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
  const digits = [cross.top, cross.bottom, cross.left, cross.right];
  const raw: any[] = [];
  for (let i = 0; i < 4; i += 1) {
    for (let j = i + 1; j < 4; j += 1) {
      const rest = [0, 1, 2, 3].filter((index) => index !== i && index !== j);
      const left = [
        Number(`${digits[i]}${digits[j]}`),
        Number(`${digits[j]}${digits[i]}`)
      ];
      const right = [
        Number(`${digits[rest[0]]}${digits[rest[1]]}`),
        Number(`${digits[rest[1]]}${digits[rest[0]]}`)
      ];
      [...new Set(left)].forEach((first) =>
        [...new Set(right)].forEach((second) => {
          raw.push({
            sum: first + second,
            pair1: { number: first, indices: [i, j] },
            pair2: { number: second, indices: rest }
          });
        })
      );
    }
  }

  const groups = new Map<number, any[]>();
  const subtractionGroups = new Map<number, any[]>();
  const add = (map: Map<number, any[]>, value: number, item: any) => {
    if (!Number.isInteger(value) || value < 1 || value > 90) return;
    const list = map.get(value) || [];
    const signature = `${Math.min(item.pair1.number, item.pair2.number)}_${Math.max(item.pair1.number, item.pair2.number)}`;
    if (!list.some((entry) =>
      `${Math.min(entry.pair1.number, entry.pair2.number)}_${Math.max(entry.pair1.number, entry.pair2.number)}` === signature
    )) list.push(item);
    map.set(value, list);
  };

  raw.forEach((item) => {
    if (item.sum <= 90) {
      add(groups, item.sum, item);
    } else if (item.pair1.number !== item.pair2.number) {
      const first = item.pair1.number;
      const second = item.pair2.number;
      add(
        subtractionGroups,
        Math.abs(first - second),
        first >= second
          ? item
          : { ...item, pair1: item.pair2, pair2: item.pair1 }
      );
    }
  });

  const output = new Map<number, any>();
  const append = (map: Map<number, any[]>, operation: 'addition' | 'subtraction') => {
    map.forEach((list, value) => {
      if (list.length < 2 || output.has(value)) return;
      const operator = operation === 'subtraction' ? '−' : '+';
      const combination = (item: any) => {
        const result: any = [
          {
            value: item.pair1.number,
            yellow: item.pair1.indices.some((index: number) => index === 0 || index === 3)
          },
          {
            value: item.pair2.number,
            yellow: item.pair2.indices.some((index: number) => index === 0 || index === 3)
          }
        ];
        result.operator = operator;
        return result;
      };
      output.set(value, {
        value,
        operation,
        combinations: [combination(list[0]), combination(list[1])]
      });
    });
  };
  append(groups, 'addition');
  append(subtractionGroups, 'subtraction');
  return [...output.values()].sort((a, b) => a.value - b.value);
}

function calculateCrossAndSatellites(key: string, secondaryBase = 63) {
  const safeKey = key.padStart(6, '0').slice(-6);
  const cross = createCross(safeKey.slice(0, 2), secondaryBase);
  return { cross, satellites: decryptCross(cross).slice(0, 10) };
}

type Client = any;
type RecordJson = Record<string, unknown>;
type User = { id: string; email?: string | null };
type Auth = {
  client: Client | null;
  user: User | null;
  error: string | null;
  role: string | null;
  principal: boolean;
  permissions: string[] | null;
};

const BUILT_IN_PROGRAMS = new Set([
  'universelle', 'oracle', 'lnb', 'intuition', 'balsa', 'standby', 'robot'
]);
const ALLOWED_SELECTIONS = new Set([
  'plus_grand_numero', 'plus_petit_numero', 'plus_grand_pair',
  'plus_petit_pair', 'plus_grand_impair', 'plus_petit_impair',
  'plus_grand_appelant'
]);
const ALLOWED_STEPS = new Set(['add', 'subtract', 'multiply', 'sum_digits']);
const UNIVERSAL_SOURCES = new Set(['numeros_jaunes_du_jour']);
const UNIVERSAL_OPERATIONS = new Set([
  'addition_chiffres', 'multiplication_chiffres'
]);
const UNIVERSAL_KEY_PARTS = new Set([
  'addition', 'multiplication', 'generateur'
]);
const ADMIN_ACTION_PERMISSIONS: Record<string, string> = {
  // These are the protected dashboard bootstrap reads. Every authenticated
  // admin/moderator may load the shell; sensitive mutations and specialist
  // reads remain permission-gated below.
  'list': '',
  'list-dashboard-modules': '',
  'list-balsa-program': 'programs.read',
  'list-valid-numbers': 'programs.read',
  'list-access': '',
  'list-promo-banners': 'subscriptions.read',
  'save-promo-banner': 'subscriptions.write',
  'delete-promo-banner': 'subscriptions.write',
  'list-referral-settings': 'subscriptions.read',
  'save-referral-settings': 'subscriptions.write',
  'search-users': 'balances.read',
  'test': 'programs.read',
  'save-access-plan': 'subscriptions.write',
  'delete-access-plan': 'subscriptions.write',
  'save-access-rule': 'subscriptions.write',
  'delete-access-rule': 'subscriptions.write',
  'delete-early-access-rule': 'subscriptions.write',
  'save-early-access-rule': 'subscriptions.write',
  'save-payment-settings': 'subscriptions.write',
  'save-star-price': 'subscriptions.write',
  'delete-star-price': 'subscriptions.write',
  'save-token-price': 'subscriptions.write',
  'delete-token-price': 'subscriptions.write',
  'grant-balance': 'balances.write',
  'grant-stars': 'balances.write',
  'grant-subscription': 'subscriptions.write',
  'create-program': 'programs.write',
  'save-draft': 'programs.write',
  'publish': 'programs.publish',
  'delete-program': 'programs.write',
  'duplicate-program': 'programs.write',
  'preview-program': 'programs.read',
  'save-draw-source': 'draws.write',
  'delete-draw-source': 'draws.write',
  'generate-draw-source': 'draws.write',
  'list-cross-generations': 'draws.read',
  'delete-cross-generation': 'draws.write',
  'list-admin-config': 'admins.read',
  'save-admin': 'admins.write',
  'delete-admin': 'admins.write',
  'list-comment-settings': 'comments.read',
  'set-comments-enabled': 'comments.write',
  'save-comment-rule': 'comments.write',
  'delete-comment-rule': 'comments.write',
  'save-content-lock': 'subscriptions.write',
  'delete-content-lock': 'subscriptions.write'
};

// This catalogue is returned only after authenticateAdmin(). It is the
// administrator's organized view of the protected calculation contract; the
// public calculation functions deliberately return no rule trace.
const METHOD_CATALOG = [
  {
    id: 'lucky-numbers',
    group: 'Socle commun',
    label: 'Numéros chanceux du jour',
    endpoint: 'calcule-universelle / moteurs Tableaux',
    source: 'extractLuckyNumbersFromDate',
    inputSchema: { date: 'YYYY-MM-DD' },
    outputSchema: { luckyNumbers: 'number[]', odd: 'number[]', even: 'number[]' },
    stages: ['Composantes de la date', 'Expressions validées', 'Réduction 1–90', 'Déduplication et tri'],
    note: 'Cette phase est exécutée côté serveur avant chaque moteur.'
  },
  {
    id: 'universal',
    group: 'Méthodes des tableaux',
    label: 'Clé Universelle',
    endpoint: 'calcule-universelle',
    source: 'daily_universal_programs',
    inputSchema: { date: 'YYYY-MM-DD', luckyNumbers: 'optionnel, vérifié côté serveur' },
    outputSchema: { key: 'string', cross: 'Cross', satellites: 'Satellite[]', nap: 'NAP' },
    stages: ['Sélection des candidats', 'Règle jaune', 'Construction de la clé', 'Croix et satellites', 'Archivage par date'],
    note: 'Les opérations et l’ordre configurés sont validés par le serveur.'
  },
  {
    id: 'intuition',
    group: 'Méthodes des tableaux',
    label: 'Clé Intuition',
    endpoint: 'calcul-intuition',
    source: 'daily_intuition_programs',
    inputSchema: { date: 'YYYY-MM-DD' },
    outputSchema: { key: 'string', group: 'number', cross: 'Cross', satellites: 'Satellite[]' },
    stages: ['Filtrage des groupes', 'Base du groupe', 'Clé', 'Croix Intuition', 'NAP et archivage'],
    note: 'Les groupes et bases ne sont jamais calculés par le navigateur.'
  },
  {
    id: 'oracle',
    group: 'Méthodes des tableaux',
    label: 'Méthode Oracle',
    endpoint: 'calcul-oracle',
    source: 'daily_oracle_programs',
    inputSchema: { date: 'YYYY-MM-DD' },
    outputSchema: { key: 'string', cross: 'Cross', satellites: 'Satellite[]', nap: 'NAP' },
    stages: ['Sélection Oracle', 'Application serveur', 'Clé et croix', 'Satellites et NAP', 'Archivage'],
    note: 'Les applications et correspondances restent côté serveur.'
  },
  {
    id: 'lnb',
    group: 'Méthodes des tableaux',
    label: 'Méthode LNB',
    endpoint: 'calcul-lnb',
    source: 'daily_lnb_programs',
    inputSchema: { date: 'YYYY-MM-DD' },
    outputSchema: { key: 'string', cross: 'Cross', satellites: 'Satellite[]', nap: 'NAP' },
    stages: ['Filtrage LNB', 'Sélection du numéro', 'Construction de la clé', 'Croix et satellites', 'Archivage'],
    note: 'La liste LNB et les opérations intermédiaires ne sont pas envoyées au client.'
  },
  {
    id: 'balsa',
    group: 'Méthodes des tableaux',
    label: 'Méthode Balsa Plus',
    endpoint: 'calcul-balsa',
    source: 'daily_balsa_programs',
    inputSchema: { date: 'YYYY-MM-DD' },
    outputSchema: { key: 'string', cross: 'Cross', satellites: 'Satellite[]', nap: 'NAP' },
    stages: ['Appels miroir', 'Relais et terminus', 'Source de clé', 'Croix et satellites', 'Archivage'],
    note: 'Les chaînes, rôles et numéros appelés sont réservés à cette fiche admin.'
  },
  {
    id: 'satellites',
    group: 'Moteurs dérivés',
    label: 'Croix, satellites et NAP',
    endpoint: 'moteurs Tableaux',
    source: 'daily_*_programs',
    inputSchema: { key: 'clé serveur', cross: 'croix serveur' },
    outputSchema: { cross: 'Cross', satellites: 'valeurs confirmées', nap: 'NAP' },
    stages: ['Paires de la croix', 'Combinaisons contrôlées', 'Confirmation', 'NAP', 'Rendu public minimal'],
    note: 'Le détail des combinaisons reste dans l’archive et n’est pas exposé au visiteur.'
  },
  {
    id: 'standby',
    group: 'Moteurs dérivés',
    label: 'Méthode Stand-by',
    endpoint: 'calcul-standby',
    source: 'daily_standby_programs',
    inputSchema: { date: 'YYYY-MM-DD' },
    outputSchema: { rows: 'StandbyRow[]', nextDate: 'ISO date' },
    stages: ['Fenêtre de dates', 'Moteurs par pays', 'Comptage', 'Classement', 'Archivage'],
    note: 'La sélection des moteurs par pays n’est pas une donnée publique.'
  },
  {
    id: 'robot',
    group: 'Moteurs dérivés',
    label: 'Programme Robot',
    endpoint: 'calcul-robot',
    source: 'daily_robot_programs',
    inputSchema: { date: 'YYYY-MM-DD' },
    outputSchema: { result: 'string', retained: 'string', primes: 'string' },
    stages: ['Collecte des moteurs', 'Déduplication', 'Classement', 'Résultat et archivage'],
    note: 'Le détail des moteurs sources reste côté serveur.'
  },
];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function adminClient(): Client {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Configuration Supabase serveur incomplète.');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function authenticateAdmin(request: Request): Promise<Auth> {
  const token = request.headers.get('Authorization')
    ?.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return {
      client: null, user: null, error: 'Connexion administrateur requise.',
      role: null,
      principal: false, permissions: null
    };
  }

  const client = adminClient();
  const session = await client.auth.getUser(token);
  if (session.error || !session.data?.user?.id) {
    return {
      client, user: null, error: 'Session administrateur invalide.',
      role: null,
      principal: false, permissions: null
    };
  }

  const role = await client
    .from('user_roles')
    .select('role')
    .eq('user_id', session.data.user.id)
    .in('role', ['admin', 'moderator'])
    .order('role', { ascending: true })
    .limit(1)
    .maybeSingle();
  let resolvedRole = role.data?.role || null;
  let principal = false;
  /*
    During the migration, some projects have the principal account recorded
    in admin_control_settings before its duplicate user_roles row exists.
    Treat that protected principal identity as an administrator as well.
    This remains fail-closed: the account must still match a server-side row.
  */
  if (!['admin', 'moderator'].includes(resolvedRole)) {
    try {
      const principalRow = await client.from('admin_control_settings')
        .select('principal_user_id').eq('id', true).maybeSingle();
      principal = !principalRow.error
        && principalRow.data?.principal_user_id === session.data.user.id;
      if (principal) resolvedRole = 'admin';
    } catch (_) { /* old schema: user_roles remains authoritative */ }
  }
  if (!['admin', 'moderator'].includes(resolvedRole)) {
    return {
      client, user: null, error: 'Accès administrateur refusé.',
      role: null,
      principal: false, permissions: null
    };
  }

  let permissions: string[] | null = null;
  /*
    These two reads are deliberately optional for old installations. Until
    SUPABASE_ADMIN_FACTORY.sql is run, every existing admin keeps the legacy
    full access; once a permissions row exists, it becomes restrictive.
  */
  try {
    const settings = await client.from('admin_control_settings')
      .select('principal_user_id').eq('id', true).maybeSingle();
    if (!settings.error && settings.data?.principal_user_id) {
      principal = settings.data.principal_user_id === session.data.user.id;
    }
  } catch (_) { /* old schema */ }
  try {
    const permissionRow = await client.from('admin_user_permissions')
      .select('permissions,enabled').eq('user_id', session.data.user.id).maybeSingle();
    if (!permissionRow.error && permissionRow.data) {
      permissions = permissionRow.data.enabled === false
        ? []
        : (Array.isArray(permissionRow.data.permissions)
          ? permissionRow.data.permissions.map(String)
          : []);
    }
  } catch (_) { /* old schema */ }

  return {
    client,
    user: { id: session.data.user.id, email: session.data.user.email || null },
    error: null,
    role: resolvedRole,
    principal,
    permissions
  };
}

function canRunAction(auth: Auth, action: string) {
  if (auth.principal || (auth.role === 'admin' && auth.permissions === null)) return true;
  if (auth.permissions === null) return false;
  const permission = ADMIN_ACTION_PERMISSIONS[action];
  return permission === ''
    || (Boolean(permission)
      && (auth.permissions.includes(permission) || auth.permissions.includes('*')));
}

function readProgram(value: unknown) {
  const program = String(value || '').trim().toLowerCase();
  return /^[a-z][a-z0-9_-]{2,40}$/.test(program) ? program : '';
}

function readSlug(value: unknown, maxLength = 40) {
  const slug = String(value || '').trim().toLowerCase();
  return new RegExp(`^[a-z][a-z0-9_-]{1,${maxLength - 1}}$`).test(slug)
    ? slug : '';
}

function readText(value: unknown, maxLength: number) {
  return String(value || '').trim().slice(0, maxLength);
}

function readSocialLinks(value: unknown) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(/\r?\n/);
  const links: Array<{ name: string; url: string }> = [];
  for (const item of source) {
    const name = Array.isArray(item)
      ? readText(item[0], 80)
      : readText(item && typeof item === 'object' ? (item as any).name : String(item).split('|')[0], 80);
    const urlText = Array.isArray(item)
      ? readText(item[1], 500)
      : readText(item && typeof item === 'object' ? (item as any).url : String(item).split('|').slice(1).join('|'), 500);
    if (!name && !urlText) continue;
    if (!name || !urlText) throw new Error('Chaque réseau doit avoir un nom et un lien.');
    let parsed: URL;
    try {
      parsed = new URL(urlText);
    } catch (_) {
      throw new Error(`Le lien du réseau « ${name} » est invalide.`);
    }
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw new Error(`Le lien du réseau « ${name} » doit commencer par http:// ou https://.`);
    }
    links.push({ name, url: parsed.toString() });
    if (links.length >= 12) break;
  }
  return links;
}

function readDrawId(value: unknown) {
  const drawId = String(value || '').trim();
  // Publication keys look like "cross:2026-08-17" or "matrix:2026-08-31".
  return /^[a-z][a-z0-9_-]{1,30}:\d{4}-\d{2}-\d{2}$/i.test(drawId)
    ? drawId : '';
}

function readInstructions(value: unknown) {
  return String(value || '').replace(/\r\n/g, '\n').trim().slice(0, 60000);
}

function readStars(value: unknown) {
  const stars = Number(value);
  return Number.isInteger(stars) && stars >= 0 && stars <= 1_000_000
    ? stars : null;
}

function readMoney(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount <= 100_000_000
    ? Math.round(amount * 100) / 100 : null;
}

function readWholeMoney(value: unknown) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 100_000_000_000
    ? amount : null;
}

function readTokens(value: unknown) {
  const tokens = Number(value);
  return Number.isInteger(tokens) && tokens >= 0 && tokens <= 1_000_000
    ? tokens : null;
}

function readOptionalReward(
  value: unknown,
  reader: (raw: unknown) => number | null
) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  const parsed = reader(value);
  return parsed === null ? undefined : parsed;
}

function readDurationDays(value: unknown, fallback = 30) {
  const days = Number(value ?? fallback);
  return Number.isInteger(days) && days >= 1 && days <= 3650
    ? days : null;
}

function readPreviewDays(value: unknown, fallback = 1) {
  const days = Number(value ?? fallback);
  return Number.isInteger(days) && days >= 1 && days <= 30
    ? days : null;
}

function readUnlockCurrency(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return 'stars';
  }
  const currency = String(value || '').trim().toLowerCase();
  return currency === 'stars' || currency === 'tokens' ? currency : '';
}

function readCountryCode(value: unknown) {
  const code = String(value || '').trim().toUpperCase();
  return /^(DEFAULT|[A-Z]{2,3})$/.test(code) ? code : '';
}

function readTokenPackId(value: unknown) {
  const packId = String(value || '').trim().toLowerCase();
  return /^[a-z][a-z0-9_-]{2,59}$/.test(packId) ? packId : '';
}

function readCurrencyCode(value: unknown) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : '';
}

function readUserId(value: unknown) {
  const id = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)
    ? id : '';
}

function readRule(value: unknown): RecordJson | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordJson : null;
}

function readTests(value: unknown): RecordJson[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  if (value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    return null;
  }
  return value as RecordJson[];
}

function readTheme(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const output: Record<string, string> = {};
  for (const key of ['background', 'accent', 'text', 'font']) {
    const item = (value as RecordJson)[key];
    if (item !== undefined) output[key] = String(item).trim().slice(0, 120);
  }
  for (const key of ['background', 'accent', 'text']) {
    if (output[key] && !/^#[0-9a-f]{6}$/i.test(output[key])) return null;
  }
  return output;
}

function readStringList(value: unknown, maxItems = 40, maxLength = 60) {
  if (!Array.isArray(value)) return null;
  return value.map((item) => String(item || '').trim().toLowerCase().slice(0, maxLength))
    .filter(Boolean).slice(0, maxItems);
}

function validateRule(program: string, rule: RecordJson) {
  const errors: string[] = [];
  if (rule.selection !== undefined
      && !ALLOWED_SELECTIONS.has(String(rule.selection))) {
    errors.push('sélection non autorisée.');
  }
  if (rule.steps !== undefined) {
    if (!Array.isArray(rule.steps) || rule.steps.length > 30) {
      errors.push('steps doit contenir au maximum 30 étapes.');
    } else if (rule.steps.some((step: any) => (
      !step || typeof step !== 'object'
      || !ALLOWED_STEPS.has(String(step.operation || 'add'))
    ))) {
      errors.push('opération de step non autorisée.');
    }
  }
  if (rule.key !== undefined
      && (!Array.isArray(rule.key) || rule.key.length !== 3)) {
    errors.push('key doit contenir exactement trois éléments.');
  }
  if (program === 'universelle'
      && rule.source !== undefined
      && !UNIVERSAL_SOURCES.has(String(rule.source))) {
    errors.push('source Universelle non autorisée.');
  }
  if (program === 'universelle' && rule.operations !== undefined
      && (!Array.isArray(rule.operations)
        || rule.operations.some((item) => !UNIVERSAL_OPERATIONS.has(String(item))))) {
    errors.push('operations Universelle non autorisées.');
  }
  if (rule.si_deux_appels !== undefined
      && (!Array.isArray(rule.si_deux_appels)
        || rule.si_deux_appels.length !== 3
        || new Set(rule.si_deux_appels.map(String)).size !== 3
        || rule.si_deux_appels.some((item) => !UNIVERSAL_KEY_PARTS.has(String(item))))) {
    errors.push('si_deux_appels doit contenir une permutation des trois éléments autorisés.');
  }
  return errors;
}

function universalPreview(numbers: unknown[], rule: RecordJson) {
  const lucky = new Set(numbers.map(Number).filter(Number.isInteger));
  const operations = Array.isArray(rule.operations)
    ? rule.operations.map(String)
    : [...UNIVERSAL_OPERATIONS];
  const candidates = [...lucky]
    .filter((value) => value >= 10 && value <= 90)
    .sort((left, right) => right - left);
  const generator = candidates.find((value) => {
    const sum = Math.floor(value / 10) + value % 10;
    const product = Math.floor(value / 10) * (value % 10);
    return (operations.includes('addition_chiffres') && lucky.has(sum))
      || (operations.includes('multiplication_chiffres') && lucky.has(product));
  });
  if (!generator) return { generator: null, calls: [], key: null };

  const tens = Math.floor(generator / 10);
  const units = generator % 10;
  const sum = tens + units;
  const product = tens * units;
  const sumCalled = operations.includes('addition_chiffres') && lucky.has(sum);
  const productCalled = operations.includes('multiplication_chiffres') && lucky.has(product);
  const configuredKeyOrder = Array.isArray(rule.si_deux_appels)
    ? rule.si_deux_appels.map(String)
    : ['addition', 'multiplication', 'generateur'];
  const validConfiguredKeyOrder = configuredKeyOrder.length === 3
    && new Set(configuredKeyOrder).size === 3
    && configuredKeyOrder.every((part) => UNIVERSAL_KEY_PARTS.has(part));
  const keyOrder = validConfiguredKeyOrder
    ? configuredKeyOrder
    : ['addition', 'multiplication', 'generateur'];
  const keyValues: RecordJson = {
    addition: sum,
    multiplication: product,
    generateur: generator
  };
  const keyParts = sumCalled && productCalled
    ? keyOrder.map((part) => Number(keyValues[part]))
    : productCalled ? [product, generator, product] : [sum, generator, sum];

  return {
    generator,
    addition: sumCalled ? sum : null,
    multiplication: productCalled ? product : null,
    calls: [
      ...(sumCalled ? [sum] : []),
      ...(productCalled ? [product] : [])
    ],
    key: keyParts.map((item) => String(item).padStart(2, '0')).join(''),
    nap1: [
      String(productCalled ? product : sum).padStart(2, '0'),
      String(generator).padStart(2, '0')
    ],
    croix: [
      String(keyParts[0]).padStart(2, '0'),
      String(keyParts[1]).padStart(2, '0')
    ]
  };
}

function genericPreview(numbers: number[], rule: RecordJson, date: Date) {
  const sorted = numbers.slice().sort((left, right) => left - right);
  const selection = String(rule.selection || 'plus_grand_numero');
  const filtered = selection.includes('pair')
    ? sorted.filter((number) => number % 2 === 0)
    : selection.includes('impair')
      ? sorted.filter((number) => number % 2 === 1)
      : sorted;
  const selected = filtered.length
    ? selection.includes('petit') ? filtered[0] : filtered[filtered.length - 1]
    : (sorted[sorted.length - 1] || 1);
  const context: Record<string, any> = {
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
    shortYear: date.getUTCFullYear() % 100,
    selected,
    luckyNumbers: sorted,
    steps: {}
  };
  const numberFrom = (value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value);
    }
    if (typeof value !== 'string') return 0;
    return value.split('.').reduce((current: any, part: string) => current?.[part], context) || 0;
  };
  const steps = Array.isArray(rule.steps) ? rule.steps : [];
  steps.slice(0, 30).forEach((step: any, index) => {
    const operation = String(step?.operation || 'add');
    const left = numberFrom(step?.left);
    const right = numberFrom(step?.right);
    const value = operation === 'multiply'
      ? left * right
      : operation === 'subtract'
        ? left - right
        : operation === 'sum_digits'
          ? sumDigits(left)
          : left + right;
    context.steps[String(step?.id || `step${index + 1}`)] = Math.abs(value) || 1;
  });
  const values = Array.isArray(rule.key) && rule.key.length >= 3
    ? rule.key.slice(0, 3).map(numberFrom)
    : [
        context.steps.step1 || selected,
        context.steps.step2 || context.month,
        context.steps.step3 || context.day
      ];
  const key = values.map((value: number) => String(Math.abs(Math.round(value)) % 100).padStart(2, '0')).join('');
  const { cross, satellites } = calculateCrossAndSatellites(key, Number(rule.base2) || 63);
  const nap1 = Array.isArray(rule.nap1) && rule.nap1.length
    ? rule.nap1.map((value) => String(Math.abs(Math.round(numberFrom(value))) % 100).padStart(2, '0'))
    : [key.slice(-2), key.slice(0, 2)];
  return {
    selected,
    key,
    order: key.split('').sort().join(''),
    code: key.slice(0, 2),
    filter: key.slice(2, 4),
    addition: String(sumDigits(key)),
    cross,
    satellites,
    nap: { nap1, nap2: nap1.slice() }
  };
}

function readPreviewDate(value: unknown) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Date();
  const parsed = new Date(`${date}T12:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function previewProgram(client: Client, input: RecordJson) {
  const program = readProgram(input.program);
  if (!program) return json({ error: 'Programme invalide.' }, 400);
  const catalogResult = await client.from('program_catalog')
    .select('program_key,display_name,source_template,visual_template,theme').eq('program_key', program)
    .maybeSingle();
  if (catalogResult.error) throw catalogResult.error;
  const catalog = catalogResult.data || (BUILT_IN_PROGRAMS.has(program)
    ? {
        program_key: program,
        display_name: program === 'universelle' ? 'Clé Universelle' : program,
        source_template: program,
        visual_template: program,
        theme: { background: '#3b0000', accent: '#ffd400', text: '#ffffff' }
      }
    : null);
  if (!catalog) return json({ error: 'Programme introuvable.' }, 404);
  const controlResult = await client.from('program_method_controls')
    .select('version,rule').eq('program_key', program)
    .order('version', { ascending: false }).limit(1).maybeSingle();
  if (controlResult.error) throw controlResult.error;
  const date = readPreviewDate(input.date);
  const details = extractLuckyNumbersFromDate(date);
  const rule = readRule(input.rule) || controlResult.data?.rule || {};
  const sample: any = catalog.source_template === 'universelle'
    ? universalPreview(details.luckyNumbers, rule)
    : genericPreview(details.luckyNumbers, rule, date);
  if (!sample.key) {
    return json({
      ok: true, action: 'program-previewed',
      preview: {
        date: date.toISOString().slice(0, 10),
        displayName: catalog.display_name,
        visualTemplate: catalog.visual_template || catalog.source_template,
        theme: catalog.theme || {},
        luckyNumbers: details.luckyNumbers,
        components: details.components,
        key: null, order: null, cross: null, satellites: [], nap: null,
        message: 'Aucun candidat ne correspond à la règle pour cette date.'
      }
    });
  }
  const { cross, satellites } = calculateCrossAndSatellites(sample.key, 63);
  const nap = { nap1: sample.nap1 || [], nap2: sample.nap1 || [] };
  return json({
    ok: true, action: 'program-previewed',
    preview: {
      date: date.toISOString().slice(0, 10),
      displayName: catalog.display_name,
      visualTemplate: catalog.visual_template || catalog.source_template,
      theme: catalog.theme || {},
      luckyNumbers: details.luckyNumbers,
      components: details.components,
      key: sample.key,
      order: sample.key.split('').sort().join(''),
      code: sample.key.slice(0, 2),
      filter: sample.key.slice(2, 4),
      addition: String(sumDigits(sample.key)),
      cross, satellites, nap,
      controlVersion: controlResult.data?.version || 0
    }
  });
}

async function duplicateProgram(client: Client, user: User, input: RecordJson) {
  const sourceProgram = readProgram(input.sourceProgram || input.source);
  const program = readProgram(input.program || input.newProgram);
  const displayName = readText(input.displayName || input.name, 80);
  if (!sourceProgram || !program || !displayName
      || BUILT_IN_PROGRAMS.has(program) || sourceProgram === program) {
    return json({ error: 'Programme source, nouvel identifiant ou nom invalide.' }, 400);
  }
  const sourceResult = await client.from('program_catalog')
    .select('program_key,display_name,function_name,source_template,visual_template,schedules,theme')
    .eq('program_key', sourceProgram).maybeSingle();
  if (sourceResult.error) throw sourceResult.error;
  const source = sourceResult.data || (BUILT_IN_PROGRAMS.has(sourceProgram)
    ? {
        program_key: sourceProgram,
        display_name: sourceProgram === 'universelle'
          ? 'Clé Universelle' : sourceProgram,
        source_template: sourceProgram,
        visual_template: sourceProgram,
        schedules: [],
        theme: { background: '#3b0000', accent: '#ffd400', text: '#ffffff' }
      }
    : null);
  if (!source) return json({ error: 'Programme source introuvable.' }, 404);
  const existing = await client.from('program_catalog')
    .select('program_key').eq('program_key', program).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return json({ error: 'Ce nouvel identifiant existe déjà.' }, 409);
  const schedules = Array.isArray(input.schedules)
    ? input.schedules.map((item) => String(item || '').trim())
      .filter((item) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item)).slice(0, 24)
    : null;
  if (input.schedules !== undefined && !schedules) {
    return json({ error: 'Les horaires du programme sont invalides.' }, 400);
  }
  const control = await client.from('program_method_controls')
    .select('rule,tests,instructions').eq('program_key', sourceProgram)
    .in('status', ['published', 'draft']).order('version', { ascending: false }).limit(1).maybeSingle();
  if (control.error) throw control.error;
  const defaultRule = sourceProgram === 'universelle'
    ? {
        source: 'numeros_jaunes_du_jour',
        operations: ['addition_chiffres', 'multiplication_chiffres'],
        si_deux_appels: ['addition', 'multiplication', 'generateur']
      }
    : {};
  const sourceTemplate = source.source_template || 'universelle';
  const requestedVisualTemplate = readProgram(input.visualTemplate || input.visual_template);
  const visualTemplate = BUILT_IN_PROGRAMS.has(requestedVisualTemplate)
    ? requestedVisualTemplate
    : (source.visual_template || sourceTemplate);
  const rule = readRule(input.rule) || control.data?.rule || defaultRule;
  const tests = readTests(input.tests) || control.data?.tests || [];
  const instructions = input.instructions !== undefined
    ? readInstructions(input.instructions)
    : (control.data?.instructions || '');
  if (!rule || !tests) {
    return json({ error: 'La règle ou les tests de la copie sont invalides.' }, 400);
  }
  const ruleErrors = [
    ...validateRule(sourceTemplate, rule),
    ...validateTests(sourceTemplate, rule, tests),
    ...executeRuleTests(sourceTemplate, rule, tests)
  ];
  if (ruleErrors.length) return json({ error: ruleErrors.join(' ') }, 400);
  const now = new Date().toISOString();
  const catalog = await client.from('program_catalog').insert({
    program_key: program, display_name: displayName,
    function_name: `calcul-${program}`,
    source_template: sourceTemplate,
    visual_template: visualTemplate,
    schedules: schedules || (source.schedules || []),
    theme: readTheme(input.theme) || source.theme || {},
    enabled: false, created_by: user.id, created_at: now, updated_at: now
  }).select(
    'program_key,display_name,function_name,source_template,visual_template,schedules,theme,enabled,created_by,created_at,updated_at,published_at'
  ).single();
  if (catalog.error) throw catalog.error;
  let createdControl;
  try {
    createdControl = await client.from('program_method_controls').insert({
      program_key: program, version: 1, status: 'draft',
      instructions,
      rule, tests,
      updated_by: user.id, created_at: now, updated_at: now
    }).select(
      'id,program_key,version,status,instructions,rule,tests,updated_by,created_at,updated_at,published_at'
    ).single();
    if (createdControl.error) throw createdControl.error;
  } catch (error) {
    const rollback = await client.from('program_catalog')
      .delete().eq('program_key', program);
    if (rollback.error) {
      console.error('admin-method-control duplicate rollback failed', rollback.error);
    }
    throw error;
  }
  return json({
    ok: true, action: 'program-duplicated',
    program: catalog.data, control: createdControl.data,
    message: 'Programme dupliqué en brouillon. La clé, la croix, les satellites et les numéros valides seront générés par le moteur serveur après publication.'
  }, 201);
}

function compareExpected(actual: RecordJson, expected: RecordJson) {
  const aliases: Record<string, string> = {
    generateur: 'generator',
    cle: 'key'
  };
  return Object.entries(expected).flatMap(([key, wanted]) => {
    const actualValue = actual[aliases[key] || key];
    const same = JSON.stringify(actualValue) === JSON.stringify(wanted)
      || String(actualValue) === String(wanted);
    return same ? [] : [
      `${key}: attendu ${String(wanted)}, obtenu ${String(actualValue)}`
    ];
  });
}

function validateTests(program: string, rule: RecordJson, tests: RecordJson[]) {
  return tests.flatMap((test, index) => {
    const errors: string[] = [];
    const label = `test ${index + 1}`;
    if (test.program !== undefined && readProgram(test.program) !== program) {
      errors.push(`${label}: programme différent.`);
    }
    if (test.date !== undefined
        && !/^\d{4}-\d{2}-\d{2}$/.test(String(test.date))) {
      errors.push(`${label}: date ISO invalide.`);
    }

    const expected = test.attendu ?? test.expected;
    if (expected !== undefined
        && (!expected || typeof expected !== 'object' || Array.isArray(expected))) {
      errors.push(`${label}: attendu doit être un objet.`);
    }
    if (program !== 'universelle') return errors;

    const numbers = test.numerosChanceux ?? test.luckyNumbers;
    if (numbers !== undefined && !Array.isArray(numbers)) {
      errors.push(`${label}: numerosChanceux doit être un tableau.`);
    } else if (Array.isArray(numbers)
        && expected && typeof expected === 'object' && !Array.isArray(expected)) {
      errors.push(...compareExpected(
        universalPreview(numbers, rule),
        expected as RecordJson
      ).map((error) => `${label}: ${error}`));
    }
    return errors;
  });
}

function executeRuleTests(template: string, rule: RecordJson, tests: RecordJson[]) {
  return tests.flatMap((test, index) => {
    const date = readPreviewDate(test.date);
    const details = extractLuckyNumbersFromDate(date);
    const sample = template === 'universelle'
      ? universalPreview(details.luckyNumbers, rule)
      : genericPreview(details.luckyNumbers, rule, date);
    if (!sample.key) {
      return [`test ${index + 1}: la règle ne produit aucune clé pour la date testée.`];
    }
    const expected = test.attendu ?? test.expected;
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      return compareExpected(sample, expected as RecordJson)
        .map((error) => `test ${index + 1}: ${error}`);
    }
    return [];
  });
}

async function listControls(client: Client) {
  const result = await client.from('program_method_controls')
    .select('id,program_key,version,status,instructions,rule,tests,updated_by,created_at,updated_at,published_at')
    .order('program_key', { ascending: true })
    .order('version', { ascending: false }).limit(250);
  if (result.error) throw result.error;
  return result.data || [];
}

async function listPrograms(client: Client) {
  const result = await client.from('program_catalog')
    .select('program_key,display_name,function_name,source_template,visual_template,schedules,theme,enabled,created_by,created_at,updated_at,published_at')
    .order('updated_at', { ascending: false }).limit(200);
  if (result.error) throw result.error;
  return result.data || [];
}

function readProgrammeDate(value: unknown) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const parsed = new Date(`${date}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date)
    ? date
    : '';
}

async function readBalsaProgram(client: Client, input: RecordJson) {
  const programmeDate = readProgrammeDate(input.date);
  if (!programmeDate) {
    return json({ error: 'date doit être une date ISO valide (YYYY-MM-DD).' }, 400);
  }
  const result = await client
    .from('daily_balsa_programs')
    .select('programme_date, payload, created_at, updated_at')
    .eq('programme_date', programmeDate)
    .maybeSingle();
  if (result.error) throw result.error;
  return json({
    ok: true,
    programmeDate,
    balsaProgram: result.data
      ? {
          date: result.data.programme_date,
          payload: result.data.payload,
          createdAt: result.data.created_at,
          updatedAt: result.data.updated_at
        }
      : null
  });
}

const VALID_NUMBER_SOURCES = [
  { program: 'universelle', label: 'Universelle', table: 'daily_universal_programs' },
  { program: 'intuition', label: 'Intuition', table: 'daily_intuition_programs' },
  { program: 'oracle', label: 'Oracle', table: 'daily_oracle_programs' },
  { program: 'lnb', label: 'LNB', table: 'daily_lnb_programs' },
  { program: 'balsa', label: 'Balsa Plus', table: 'daily_balsa_programs' },
  { program: 'robot', label: 'Robot', table: 'daily_robot_programs' }
];

function normalizeNumberList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number))]
    .filter((number) => Number.isInteger(number) && number >= 1 && number <= 90)
    .sort((left, right) => left - right);
}

function validNumbersFromPayload(payload: any) {
  if (!payload || typeof payload !== 'object') return [];
  const candidates = [
    payload.validNumbers,
    payload.valid_numbers,
    payload.methodLuckyNumbers,
    payload.luckyNumbers,
    payload.lucky_numbers,
    payload.luckyNumberDetails?.methodLuckyNumbers,
    payload.luckyNumberDetails?.luckyNumbers,
    payload.luckyNumberDetails?.components?.luckyNumbers
  ];
  for (const candidate of candidates) {
    const numbers = normalizeNumberList(candidate);
    if (numbers.length) return numbers;
  }
  return [];
}

function validNumberError(error: any) {
  const message = String(error?.message || '');
  if (/relation .* does not exist|undefined table|42P01/i.test(message)) {
    return 'La table serveur n’est pas installée.';
  }
  return 'Résultat serveur indisponible.';
}

async function requestDailyRegeneration(client: Client, programmeDate: string) {
  const secret = await client
    .from('scheduler_secrets')
    .select('regen_secret')
    .eq('id', 1)
    .maybeSingle();
  if (secret.error || !secret.data?.regen_secret) {
    throw new Error('Le planificateur serveur n’est pas configuré.');
  }

  const baseUrl = String(Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Configuration Supabase serveur incomplète.');
  const response = await fetch(`${baseUrl}/functions/v1/regen-daily`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret.data.regen_secret}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ date: programmeDate })
  });
  if (!response.ok) {
    let message = '';
    try {
      const body = await response.json();
      message = String(body?.error || body?.errors?.join?.(' ') || '');
    } catch (_) {}
    throw new Error(message || 'La génération serveur est indisponible.');
  }
}

async function readValidNumberArchive(client: Client, source: any, programmeDate: string) {
  const result = await client
    .from(source.table)
    .select('programme_date,payload,created_at,updated_at')
    .eq('programme_date', programmeDate)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data || null;
}

async function readCustomValidNumbers(client: Client, programmeDate: string) {
  const catalog = await client.from('program_catalog')
    .select('program_key,display_name,source_template,theme,enabled')
    .eq('enabled', true)
    .not('program_key', 'in', '(universelle,intuition,oracle,lnb,balsa,standby,robot)')
    .order('display_name', { ascending: true });
  if (catalog.error) throw catalog.error;
  const output: Record<string, any> = {};
  for (const program of catalog.data || []) {
    const control = await client.from('program_method_controls')
      .select('version,rule')
      .eq('program_key', program.program_key)
      .eq('status', 'published')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (control.error || !control.data) continue;
    const date = new Date(`${programmeDate}T12:00:00.000Z`);
    const details = extractLuckyNumbersFromDate(date);
    const sample: any = program.source_template === 'universelle'
      ? universalPreview(details.luckyNumbers, readRule(control.data.rule) || {})
      : genericPreview(details.luckyNumbers, readRule(control.data.rule) || {}, date);
    const validNumbers = [...new Set([
      ...(Array.isArray(sample.calls) ? sample.calls : []),
      Number(sample.selected || 0),
      ...(String(sample.key || '').match(/\d{2}/g) || []).map(Number)
    ])].filter((value) => Number.isInteger(value) && value >= 1 && value <= 90);
    output[program.program_key] = {
      program: program.program_key,
      label: program.display_name || program.program_key,
      date: programmeDate,
      status: sample.key ? 'ready' : 'missing',
      key: sample.key || null,
      luckyNumbers: details.luckyNumbers,
      validNumbers: validNumbers.sort((left, right) => left - right),
      updatedAt: null,
      source: 'program-runner',
      sourceTable: 'program_catalog',
      theme: program.theme || {},
      custom: true
    };
  }
  return output;
}

function expectedPublicationInstant(programmeDate: string) {
  const date = new Date(`${programmeDate}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return NaN;
  date.setUTCDate(date.getUTCDate() - 1);
  date.setUTCHours(PROGRAM_GENERATION_HOUR, 0, 0, 0);
  return date.getTime();
}

function archiveIsStaleForCurrentProgramme(
  archive: any,
  programmeDate: string,
  currentProgramme: boolean
) {
  if (!currentProgramme) return false;
  const expected = expectedPublicationInstant(programmeDate);
  const updated = Date.parse(String(archive?.updated_at || archive?.created_at || ''));
  return Number.isFinite(expected)
    && (!Number.isFinite(updated) || updated < expected);
}

/*
 * Private admin read of the daily archives. Do not route this through the
 * public calculation functions: their contract intentionally exposes only
 * the values needed by subscribed visitors. This action is reached only
 * after authenticateAdmin() and returns a narrow projection, never the
 * calculation trace or the complete payload.
 */
async function readValidNumbers(client: Client, input: RecordJson) {
  const programmeDate = input.date === undefined
    ? dateIso(programmeDateFromClock())
    : readProgrammeDate(input.date);
  if (!programmeDate) {
    return json({ error: 'date doit être une date ISO valide (YYYY-MM-DD).' }, 400);
  }

  let settled = await Promise.allSettled(
    VALID_NUMBER_SOURCES.map((source) => readValidNumberArchive(client, source, programmeDate))
  );
  let regenerationError = '';
  const currentProgramme = input.date === undefined;
  const hasMissingArchive = settled.some((result) => (
    result.status === 'fulfilled' && !result.value?.payload
  ));
  const hasStaleArchive = settled.some((result) => (
    result.status === 'fulfilled'
      && archiveIsStaleForCurrentProgramme(result.value, programmeDate, currentProgramme)
  ));
  const needsRegeneration = hasMissingArchive || hasStaleArchive;
  if (needsRegeneration) {
    try {
      await requestDailyRegeneration(client, programmeDate);
      settled = await Promise.allSettled(
        VALID_NUMBER_SOURCES.map((source) => readValidNumberArchive(client, source, programmeDate))
      );
    } catch (error) {
      regenerationError = String((error as any)?.message || 'La génération serveur est indisponible.');
    }
  }

  const programs: Record<string, unknown> = {};
  const errors: Array<{ program: string; label: string; message: string }> = [];
  settled.forEach((result, index) => {
    const source = VALID_NUMBER_SOURCES[index];
    if (result.status === 'fulfilled') {
      const archive = result.value;
      const payload = archive?.payload;
      programs[source.program] = payload && typeof payload === 'object'
        ? {
            program: source.program,
            label: source.label,
            date: programmeDate,
            status: 'ready',
            key: typeof payload.key === 'string'
              ? payload.key
              : typeof payload.result === 'string'
                ? payload.result
                : null,
            luckyNumbers: normalizeNumberList(
              payload.luckyNumbers
              || payload.luckyNumberDetails?.luckyNumbers
            ),
            validNumbers: validNumbersFromPayload(payload),
            updatedAt: archive.updated_at || archive.created_at || null,
            source: regenerationError
              ? 'database'
              : needsRegeneration
                ? 'generated-and-persisted'
                : 'database',
            sourceTable: source.table
          }
        : {
            program: source.program,
            label: source.label,
            date: programmeDate,
            status: 'missing',
            luckyNumbers: [],
            validNumbers: [],
            key: null,
            updatedAt: null,
            sourceTable: source.table
          };
      if (!payload && regenerationError) {
        errors.push({
          program: source.program,
          label: source.label,
          message: regenerationError
        });
      }
    } else {
      errors.push({
        program: source.program,
        label: source.label,
        message: validNumberError(result.reason)
      });
    }
  });
  try {
    Object.assign(programs, await readCustomValidNumbers(client, programmeDate));
  } catch (error) {
    errors.push({
      program: 'custom',
      label: 'Clés personnalisées',
      message: validNumberError(error)
    });
  }

  return json({
    ok: true,
    date: programmeDate,
    programs,
    errors
  });
}

function listMethods() {
  return METHOD_CATALOG;
}

async function listModules(client: Client) {
  try {
    const result = await client.from('admin_dashboard_modules')
      .select('module_key,display_name,category,edge_function,program_key,is_visual,tables,read_actions,write_actions,status,notes,updated_at')
      .order('category', { ascending: true })
      .order('display_name', { ascending: true }).limit(100);
    return result.error ? [] : result.data || [];
  } catch (_) {
    return [];
  }
}

const ADMIN_PERMISSION_OPTIONS = [
  'subscriptions.read', 'subscriptions.write',
  'balances.read', 'balances.write',
  'programs.read', 'programs.write', 'programs.publish',
  'draws.read', 'draws.write',
  'admins.read', 'admins.write',
  'comments.read', 'comments.write'
];

async function listAdminConfig(client: Client) {
  const usersResult = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersResult.error) throw usersResult.error;
  const [rolesResult, permissionsResult, principalResult, sourcesResult, generationResult] =
    await Promise.all([
      client.from('user_roles').select('user_id,role,created_at').order('created_at'),
      client.from('admin_user_permissions')
        .select('user_id,permissions,enabled,created_by,updated_at'),
      client.from('admin_control_settings')
        .select('principal_user_id').eq('id', true).maybeSingle(),
      client.from('admin_draw_sources')
        .select('id,module_key,country_code,country_name,draw_name,draw_time,matrix,keyboard,cerveau,code,event,settings,enabled,created_by,created_at,updated_at')
        .order('module_key').order('country_name').order('draw_time')
      ,
      client.from('program_generation_settings')
        .select('generation_time,time_zone,enabled')
        .eq('id', true)
        .maybeSingle()
    ]);
  if (rolesResult.error) throw rolesResult.error;
  /*
    The factory migration is optional during a rolling deployment. Keep the
    existing dashboard readable while displaying an empty configuration until
    the new tables are installed.
  */
  const optionalError = (result: any) => result.error
    && !/relation .* does not exist|admin_control_settings|admin_user_permissions|admin_draw_sources|program_generation_settings/i
      .test(String(result.error.message || ''));
  if (optionalError(permissionsResult) || optionalError(principalResult)
      || optionalError(sourcesResult) || optionalError(generationResult)) {
    throw permissionsResult.error || principalResult.error || sourcesResult.error
      || generationResult.error;
  }
  const roles = rolesResult.data || [];
  const permissionRows = permissionsResult.error ? [] : (permissionsResult.data || []);
  const principalId = principalResult.error ? null : principalResult.data?.principal_user_id || null;
  const users = (usersResult.data?.users || []).map((item: any) => {
    const userRoles = roles.filter((role: any) => role.user_id === item.id)
      .map((role: any) => role.role);
    const permission = permissionRows.find((row: any) => row.user_id === item.id);
    return {
      id: item.id,
      email: item.email || '',
      name: item.user_metadata?.full_name || item.user_metadata?.name || '',
      roles: userRoles,
      role: userRoles.includes('admin') ? 'admin'
        : userRoles.includes('moderator') ? 'moderator' : 'user',
      permissions: Array.isArray(permission?.permissions)
        ? permission.permissions : [],
      permissionsEnabled: permission?.enabled !== false,
      principal: item.id === principalId,
      createdAt: item.created_at || null
    };
  }).filter((item: any) => item.role === 'admin' || item.role === 'moderator');
  return {
    admins: users,
    principalUserId: principalId,
    permissionOptions: ADMIN_PERMISSION_OPTIONS,
    drawSources: sourcesResult.error ? [] : (sourcesResult.data || []),
    /*
     * The SQL check keeps this value immutable at 16:00. The fallback keeps
     * older installations coherent while the migration is being deployed.
     */
    generationPolicy: {
      generationTime: generationResult.error
        ? PROGRAM_GENERATION_TIME
        : String(generationResult.data?.generation_time || PROGRAM_GENERATION_TIME).slice(0, 5),
      timeZone: generationResult.error
        ? PROGRAM_GENERATION_TIME_ZONE
        : String(generationResult.data?.time_zone || PROGRAM_GENERATION_TIME_ZONE),
      scope: 'global',
      enabled: generationResult.error ? true : generationResult.data?.enabled !== false
    }
  };
}

async function listCrossGenerations(client: Client) {
  const result = await client.from('croix_nationale_generations')
    .select('id,programme_date,generated_year,generated_month,scope_key,term,visible_terminaison,signature,created_at')
    .order('programme_date', { ascending: false })
    .limit(250);
  if (result.error) {
    if (/croix_nationale_generations|relation .* does not exist|schema cache/i
      .test(String(result.error.message || ''))) {
      return json({ ok: true, action: 'cross-generations-listed', crossGenerations: [] });
    }
    throw result.error;
  }
  return json({
    ok: true,
    action: 'cross-generations-listed',
    crossGenerations: result.data || []
  });
}

async function deleteCrossGeneration(client: Client, user: User, input: RecordJson) {
  const requestedId = Number(input.id);
  const requestedDate = readProgrammeDate(input.programmeDate || input.date);
  if ((!Number.isSafeInteger(requestedId) || requestedId < 1) && !requestedDate) {
    return json({ error: 'Indiquez l’identifiant ou la date de la Croix à supprimer.' }, 400);
  }

  let existingQuery = client.from('croix_nationale_generations')
    .select('id,programme_date,signature')
    .limit(1);
  existingQuery = Number.isSafeInteger(requestedId) && requestedId > 0
    ? existingQuery.eq('id', requestedId)
    : existingQuery.eq('programme_date', requestedDate);
  const existing = await existingQuery.maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) return json({ error: 'Cette Croix nationale n’existe plus.' }, 404);

  /*
   * Keep the current official programme intact. The maintenance action is
   * intentionally limited to historical rows; the generator can recreate an
   * old row only when an administrator explicitly requests it elsewhere.
   */
  const currentProgrammeDate = dateIso(programmeDateFromClock());
  if (String(existing.data.programme_date || '') === currentProgrammeDate) {
    return json({ error: 'La Croix du programme courant ne peut pas être supprimée.' }, 400);
  }

  const deleted = await client.from('croix_nationale_generations')
    .delete()
    .eq('id', existing.data.id)
    .select('id,programme_date')
    .maybeSingle();
  if (deleted.error) throw deleted.error;
  await client.from('admin_audit_events').insert({
    actor_user_id: user.id,
    action: 'delete-cross-generation',
    payload: {
      id: existing.data.id,
      programmeDate: existing.data.programme_date,
      signature: existing.data.signature
    }
  }).catch(() => {});
  return json({
    ok: true,
    action: 'cross-generation-deleted',
    deleted: deleted.data || existing.data
  });
}

function readPermissionList(value: unknown) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map((item) => String(item || '').trim())
    .filter((item) => ADMIN_PERMISSION_OPTIONS.includes(item) || item === '*'))]
    .slice(0, 40);
}

async function saveAdminUser(client: Client, actor: User, input: RecordJson) {
  const email = readText(input.email, 160).toLowerCase();
  const role = String(input.role || 'moderator').trim().toLowerCase();
  const permissions = readPermissionList(input.permissions);
  if (!email.includes('@') || !['admin', 'moderator'].includes(role) || !permissions) {
    return json({ error: 'E-mail, rôle ou permissions invalides.' }, 400);
  }
  const target = await findUserByEmail(client, email);
  if (!target?.id) return json({ error: 'Aucun compte ne correspond à cet e-mail.' }, 404);
  const principal = await client.from('admin_control_settings')
    .select('principal_user_id').eq('id', true).maybeSingle();
  if (!principal.error && principal.data?.principal_user_id === target.id) {
    return json({ error: 'L’administrateur principal est protégé.' }, 403);
  }

  /*
   * Changing an administrator touches two tables. Keep a snapshot first so
   * a failed insert/update cannot silently remove the target's access.
   * Supabase does not provide a transaction boundary through the REST client,
   * so this is a compensating rollback for installations without a dedicated
   * SQL RPC.
   */
  const previousRoles = await client.from('user_roles')
    .select('role')
    .eq('user_id', target.id)
    .in('role', ['admin', 'moderator']);
  if (previousRoles.error) throw previousRoles.error;
  const previousPermission = await client.from('admin_user_permissions')
    .select('user_id,permissions,enabled,created_by')
    .eq('user_id', target.id)
    .maybeSingle();
  const permissionTableMissing = previousPermission.error
    && /relation .* does not exist|admin_user_permissions/i
      .test(String(previousPermission.error.message || ''));
  if (previousPermission.error && !permissionTableMissing) {
    throw previousPermission.error;
  }

  const now = new Date().toISOString();
  const restore = async () => {
    await client.from('user_roles')
      .delete().eq('user_id', target.id).in('role', ['admin', 'moderator']);
    const roles = previousRoles.data || [];
    if (roles.length) {
      await client.from('user_roles').insert(
        roles.map((item: any) => ({ user_id: target.id, role: item.role }))
      );
    }
    if (!permissionTableMissing) {
      if (previousPermission.data) {
        await client.from('admin_user_permissions').upsert({
          user_id: target.id,
          permissions: previousPermission.data.permissions,
          enabled: previousPermission.data.enabled !== false,
          created_by: previousPermission.data.created_by,
          updated_at: now
        }, { onConflict: 'user_id' });
      } else {
        await client.from('admin_user_permissions').delete()
          .eq('user_id', target.id);
      }
    }
  };

  try {
    const removed = await client.from('user_roles')
      .delete().eq('user_id', target.id).in('role', ['admin', 'moderator']);
    if (removed.error) throw removed.error;
    const inserted = await client.from('user_roles')
      .insert({ user_id: target.id, role });
    if (inserted.error) throw inserted.error;
    const permissionRow = await client.from('admin_user_permissions').upsert({
      user_id: target.id, permissions, enabled: true,
      created_by: actor.id, updated_at: now
    }, { onConflict: 'user_id' });
    if (permissionRow.error && !permissionTableMissing) {
      throw permissionRow.error;
    }
    await client.from('admin_audit_events').insert({
      actor_user_id: actor.id, action: 'save-admin',
      target_user_id: target.id, payload: { role, permissions }
    });
    return json({
      ok: true, action: 'admin-saved',
      admin: { id: target.id, email: target.email || email, role, permissions }
    });
  } catch (error) {
    try {
      await restore();
    } catch (rollbackError) {
      console.error('admin-method-control admin rollback failed', rollbackError);
    }
    throw error;
  }
}

async function deleteAdminUser(client: Client, actor: User, input: RecordJson) {
  const targetUserId = readUserId(input.userId);
  if (!targetUserId || targetUserId === actor.id) {
    return json({ error: 'Utilisateur administrateur invalide.' }, 400);
  }
  const principal = await client.from('admin_control_settings')
    .select('principal_user_id').eq('id', true).maybeSingle();
  if (!principal.error && principal.data?.principal_user_id === targetUserId) {
    return json({ error: 'L’administrateur principal ne peut pas être supprimé.' }, 403);
  }
  const removed = await client.from('user_roles')
    .delete().eq('user_id', targetUserId).in('role', ['admin', 'moderator']);
  if (removed.error) throw removed.error;
  await client.from('admin_user_permissions').delete().eq('user_id', targetUserId);
  await client.from('admin_audit_events').insert({
    actor_user_id: actor.id, action: 'delete-admin',
    target_user_id: targetUserId, payload: {}
  });
  return json({ ok: true, action: 'admin-deleted', userId: targetUserId });
}

function readJsonObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function readBoolean(value: unknown, fallback = false) {
  return value === undefined ? fallback : value === true || String(value).toLowerCase() === 'true';
}

const ALL_GENERATION_DAYS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);

function readGenerationDays(value: unknown): number[] {
  // Existing sources predate the weekday setting and therefore mean every
  // day. An explicitly supplied empty array is invalid and is rejected by
  // the admin action instead of silently generating an unintended schedule.
  if (value === undefined || value === null) return [...ALL_GENERATION_DAYS];
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number))]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((left, right) => left - right);
}

function createSeededGenerator(seedText: string) {
  let seed = 2166136261;
  for (const character of seedText) {
    seed ^= character.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function generatedNumberList(random: () => number, count: number, min: number, max: number) {
  const values = new Set<number>();
  while (values.size < count) {
    values.add(min + Math.floor(random() * (max - min + 1)));
  }
  return [...values];
}

function generatedDigitString(random: () => number, count: number) {
  return Array.from({ length: count }, () => Math.floor(random() * 10)).join('');
}

function deriveMatrixEvent(code: string): string {
  const codeDigits = String(code || '').replace(/\D/g, '').slice(0, 3);
  if (codeDigits.length !== 3) return '';
  const digits = ['1', ...codeDigits.split('')];
  let best = '';
  let bestDifference = Number.POSITIVE_INFINITY;
  const seen = new Set<string>();

  for (let first = 0; first < digits.length; first += 1) {
    for (let second = 0; second < digits.length; second += 1) {
      if (second === first) continue;
      for (let third = 0; third < digits.length; third += 1) {
        if (third === first || third === second) continue;
        for (let fourth = 0; fourth < digits.length; fourth += 1) {
          if (fourth === first || fourth === second || fourth === third) continue;
          const candidate = `${digits[first]}${digits[second]}${digits[third]}${digits[fourth]}`;
          if (seen.has(candidate)) continue;
          seen.add(candidate);
          const difference = Math.abs(
            Number(candidate[0]) + Number(candidate[1])
              - Number(candidate[2]) - Number(candidate[3])
          );
          if (
            difference < bestDifference
            || (difference === bestDifference && (!best || candidate < best))
          ) {
            best = candidate;
            bestDifference = difference;
          }
        }
      }
    }
  }
  return best;
}

function canonicalMatrixCountry(value: unknown): string {
  const raw = String(value || '').trim();
  const key = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const aliases: Record<string, string> = {
    benin: 'Bénin',
    'cote d ivoire': "Côte d'Ivoire",
    'ivory coast': "Côte d'Ivoire",
    ghana: 'Ghana',
    niger: 'Niger',
    senegal: 'Sénégal',
    togo: 'Togo'
  };
  return aliases[key] || raw;
}

function generatedMatrixSource(input: RecordJson) {
  const moduleKey = String(input.moduleKey || 'matrice').trim().toLowerCase();
  const countryCode = String(input.countryCode || '').trim().toUpperCase();
  const countryName = canonicalMatrixCountry(readText(input.countryName, 80));
  const drawTime = String(input.drawTime || input.time || '').trim();
  const drawName = readText(
    input.drawName || input.name || `${countryName} ${drawTime}`,
    100
  );
  if (
    !/^[A-Z]{2,3}$/.test(countryCode)
    || countryName.length < 2
    || drawName.length < 2
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(drawTime)
  ) {
    return { error: 'Pays, nom du tirage et horaire valides sont obligatoires.' };
  }

  const hasKeyboard = readBoolean(input.hasKeyboard, true);
  const hasCerveau = readBoolean(input.hasCerveau, false);
  const hasCode = readBoolean(input.hasCode, true);
  const hasEvent = readBoolean(input.hasEvent, true);
  const providedSettings = readJsonObject(input.settings) as Record<string, any>;
  const generationDays = readGenerationDays(
    input.generationDays ?? providedSettings.generationDays
  );
  if (!generationDays.length) {
    return { error: 'Sélectionnez au moins un jour de génération.' };
  }
  const seed = `${countryCode}|${countryName}|${drawName}|${drawTime}`;
  const random = createSeededGenerator(seed);
  const matrix = generatedNumberList(random, 4, 100, 999);
  const keyboard = hasKeyboard
    ? generatedNumberList(random, 4, 100, 999)
    : [];
  const cerveau = hasCerveau
    ? generatedNumberList(random, 4, 100, 999)
    : [];
  const tenNumbers = generatedNumberList(random, 10, 1, 90)
    .sort((left, right) => left - right)
    .map((value) => String(value).padStart(2, '0'));
  const code = hasCode
    ? generatedDigitString(random, 3)
    : '';
  // Keep the seeded stream stable; the event itself is now derived from code.
  if (hasEvent) generatedDigitString(random, 4);
  const event = hasEvent
    ? deriveMatrixEvent(code)
    : '';

  return {
    moduleKey: ['matrice', 'boules-rejetees'].includes(moduleKey)
      ? moduleKey
      : 'matrice',
    countryCode,
    countryName,
    drawName,
    drawTime,
    matrix: { numbers: matrix },
    keyboard: hasKeyboard ? { numbers: keyboard } : {},
    cerveau: hasCerveau ? { numbers: cerveau } : {},
    code,
    event,
    settings: {
      generation: 'universal-matrix-v1',
      generationTime: PROGRAM_GENERATION_TIME,
      generationTimeZone: PROGRAM_GENERATION_TIME_ZONE,
      generationScope: 'global',
      hasKeyboard,
      hasCerveau,
      hasCode,
      hasEvent,
      generationDays,
      components: {
        keyboard: hasKeyboard,
        cerveau: hasCerveau,
        code: hasCode,
        event: hasEvent
      },
      ten_numbers: tenNumbers
    },
    enabled: input.enabled !== false
  };
}

async function generateDrawSource(client: Client, user: User, input: RecordJson) {
  const generated = generatedMatrixSource(input);
  if (generated.error) return json({ error: generated.error }, 400);

  const now = new Date().toISOString();
  const row = {
    module_key: generated.moduleKey,
    country_code: generated.countryCode,
    country_name: generated.countryName,
    draw_name: generated.drawName,
    draw_time: generated.drawTime,
    matrix: generated.matrix,
    keyboard: generated.keyboard,
    cerveau: generated.cerveau,
    code: generated.code,
    event: generated.event,
    settings: generated.settings,
    enabled: generated.enabled,
    created_by: user.id,
    updated_at: now
  };
  const result = await client.from('admin_draw_sources').upsert(row, {
    onConflict: 'module_key,country_code,draw_time'
  }).select(
    'id,module_key,country_code,country_name,draw_name,draw_time,matrix,keyboard,cerveau,code,event,settings,enabled,created_by,created_at,updated_at'
  ).single();
  if (result.error) throw result.error;

  await client.from('admin_audit_events').insert({
    actor_user_id: user.id,
    action: 'generate-draw-source',
    payload: {
      moduleKey: generated.moduleKey,
      countryCode: generated.countryCode,
      drawTime: generated.drawTime,
      generation: (generated.settings as Record<string, any> | undefined)?.generation
    }
  });

  return json({
    ok: true,
    action: 'draw-source-generated',
    drawSource: result.data,
    message: 'La matrice a été générée et enregistrée automatiquement.'
  });
}

async function saveDrawSource(client: Client, user: User, input: RecordJson) {
  const moduleKey = String(input.moduleKey || '').trim().toLowerCase();
  const countryCode = String(input.countryCode || '').trim().toUpperCase();
  const countryName = canonicalMatrixCountry(readText(input.countryName, 80));
  const drawName = readText(input.drawName || input.name, 100);
  const drawTime = String(input.drawTime || input.time || '').trim();
  if (!['matrice', 'croix', 'boules-rejetees'].includes(moduleKey)
      || !/^[A-Z]{2,3}$/.test(countryCode)
      || countryName.length < 2 || drawName.length < 2
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(drawTime)) {
    return json({ error: 'Pays, module, nom et horaire de tirage sont obligatoires.' }, 400);
  }
  const providedSettings = readJsonObject(input.settings) as Record<string, any>;
  const generationDays = readGenerationDays(
    input.generationDays ?? providedSettings.generationDays
  );
  if (!generationDays.length) {
    return json({ error: 'Sélectionnez au moins un jour de génération.' }, 400);
  }
  const settings = {
    ...providedSettings,
    generationDays,
    generation: String(providedSettings.generation || 'universal-matrix-v1'),
    generationTime: PROGRAM_GENERATION_TIME,
    generationTimeZone: PROGRAM_GENERATION_TIME_ZONE,
    generationScope: 'global'
  };
  const row = {
    module_key: moduleKey, country_code: countryCode, country_name: countryName,
    draw_name: drawName, draw_time: drawTime,
    matrix: readJsonObject(input.matrix),
    keyboard: readJsonObject(input.keyboard),
    cerveau: readJsonObject(input.cerveau),
    code: readText(input.code, 120), event: readText(input.event, 120),
    settings, enabled: input.enabled !== false,
    created_by: user.id, updated_at: new Date().toISOString()
  };
  const query = client.from('admin_draw_sources').upsert(row, {
    onConflict: 'module_key,country_code,draw_time'
  }).select(
    'id,module_key,country_code,country_name,draw_name,draw_time,matrix,keyboard,cerveau,code,event,settings,enabled,created_by,created_at,updated_at'
  ).single();
  const result = await query;
  if (result.error) throw result.error;
  await client.from('admin_audit_events').insert({
    actor_user_id: user.id, action: 'save-draw-source',
    payload: { moduleKey, countryCode, drawTime }
  });
  return json({ ok: true, action: 'draw-source-saved', drawSource: result.data });
}

async function deleteDrawSource(client: Client, user: User, input: RecordJson) {
  const id = String(input.id || '').trim();
  if (!/^[0-9a-f-]{20,}$/i.test(id)) return json({ error: 'Source de tirage invalide.' }, 400);
  const result = await client.from('admin_draw_sources').delete().eq('id', id)
    .select('id').maybeSingle();
  if (result.error) throw result.error;
  await client.from('admin_audit_events').insert({
    actor_user_id: user.id, action: 'delete-draw-source', payload: { id }
  });
  return json({ ok: true, action: 'draw-source-deleted', id, deleted: Boolean(result.data) });
}

const ACCESS_RULE_COLUMNS = [
  'feature_key',
  'display_name',
  'required_stars',
  'unlock_currency',
  'required_tokens',
  'duration_days',
  'history_free_days',
  'plan_slug',
  'referral_reward_stars',
  'referral_reward_tokens',
  'enabled',
  'updated_by',
  'created_at',
  'updated_at'
].join(',');

const LEGACY_ACCESS_RULE_COLUMNS = [
  'feature_key',
  'display_name',
  'required_stars',
  'unlock_currency',
  'required_tokens',
  'duration_days',
  'history_free_days',
  'plan_slug',
  'enabled',
  'updated_by',
  'created_at',
  'updated_at'
].join(',');

function accessRewardColumnsMissing(error: any) {
  return /referral_reward_(stars|tokens)|column .* does not exist|schema cache/i
    .test(String(error?.message || ''));
}

async function readAccessRules(client: Client) {
  const current = await client
    .from('feature_access_rules')
    .select(ACCESS_RULE_COLUMNS)
    .order('display_name', { ascending: true })
    .limit(250);
  if (!current.error || !accessRewardColumnsMissing(current.error)) {
    return current;
  }
  const legacy = await client
    .from('feature_access_rules')
    .select(LEGACY_ACCESS_RULE_COLUMNS)
    .order('display_name', { ascending: true })
    .limit(250);
  if (legacy.error) return legacy;
  return {
    ...legacy,
    data: (legacy.data || []).map((row: any) => ({
      ...row,
      referral_reward_stars: null,
      referral_reward_tokens: null
    }))
  };
}

const EARLY_ACCESS_RULE_COLUMNS = [
  'feature_key',
  'display_name',
  'enabled',
  'early_hour',
  'required_tokens',
  'duration_days',
  'preview_days',
  'token_cost_1_day',
  'token_cost_2_days',
  'token_cost_3_days',
  'referral_reward_stars',
  'referral_reward_tokens',
  'updated_by',
  'created_at',
  'updated_at'
].join(',');

/*
 * A rolling-window installation can exist before the optional referral
 * columns are added. Keep that intermediate schema distinct from the
 * original legacy schema so a fallback does not discard the configured
 * costs for one, two and three days.
 */
const HORIZON_EARLY_ACCESS_RULE_COLUMNS = [
  'feature_key',
  'display_name',
  'enabled',
  'early_hour',
  'required_tokens',
  'duration_days',
  'preview_days',
  'token_cost_1_day',
  'token_cost_2_days',
  'token_cost_3_days',
  'updated_by',
  'created_at',
  'updated_at'
].join(',');

const LEGACY_EARLY_ACCESS_RULE_COLUMNS = [
  'feature_key',
  'display_name',
  'enabled',
  'early_hour',
  'required_tokens',
  'duration_days',
  'updated_by',
  'created_at',
  'updated_at'
].join(',');

function earlyAccessColumnsMissing(error: any) {
  return /preview_days|token_cost_[123]_day|referral_reward_(stars|tokens)|column .* does not exist|schema cache/i
    .test(String(error?.message || ''));
}

function normalizeLegacyEarlyRules(rows: any[]) {
  return (rows || []).map((row: any) => {
    const one = Math.max(0, Number(row.required_tokens) || 0);
    return {
      ...row,
      preview_days: 1,
      token_cost_1_day: one,
      token_cost_2_days: one * 2,
      token_cost_3_days: one * 3,
      referral_reward_stars: null,
      referral_reward_tokens: null
    };
  });
}

function normalizeHorizonEarlyRules(rows: any[]) {
  return (rows || []).map((row: any) => ({
    ...row,
    referral_reward_stars: null,
    referral_reward_tokens: null
  }));
}

async function readEarlyAccessRules(client: Client) {
  const current = await client
    .from('feature_early_access_rules')
    .select(EARLY_ACCESS_RULE_COLUMNS)
    .order('feature_key', { ascending: true });
  if (!current.error || !earlyAccessColumnsMissing(current.error)) {
    return current;
  }
  const horizon = await client
    .from('feature_early_access_rules')
    .select(HORIZON_EARLY_ACCESS_RULE_COLUMNS)
    .order('feature_key', { ascending: true });
  if (!horizon.error || !earlyAccessColumnsMissing(horizon.error)) {
    return {
      ...horizon,
      data: normalizeHorizonEarlyRules(horizon.data || [])
    };
  }
  const legacy = await client
    .from('feature_early_access_rules')
    .select(LEGACY_EARLY_ACCESS_RULE_COLUMNS)
    .order('feature_key', { ascending: true });
  if (legacy.error) return legacy;
  return {
    data: normalizeLegacyEarlyRules(legacy.data || []),
    error: null
  };
}

async function readAdminPaymentSettings(client: Client) {
  const defaults = {
    payment_mode: 'manual',
    online_provider: '',
    online_payment_link: '',
    physical_instructions: '',
    contact_label: '',
    manual_enabled: true,
    currency_mode: 'both',
    contact_channel: 'chat',
    whatsapp_number: '',
    chat_label: 'Contacter l’équipe',
    social_links: []
  };
  const columnSets = [
    'id,payment_mode,online_provider,online_payment_link,physical_instructions,contact_label,manual_enabled,currency_mode,contact_channel,whatsapp_number,chat_label,social_links,updated_by,updated_at',
    'id,payment_mode,online_provider,online_payment_link,physical_instructions,contact_label,manual_enabled,currency_mode,contact_channel,whatsapp_number,chat_label,updated_by,updated_at',
    'id,payment_mode,online_provider,online_payment_link,physical_instructions,contact_label,manual_enabled,updated_by,updated_at'
  ];
  let lastResult: any = null;
  for (const columns of columnSets) {
    const result = await client
      .from('payment_settings')
      .select(columns)
      .eq('id', 1)
      .maybeSingle();
    if (!result.error) {
      return {
        ...result,
        data: result.data ? { ...defaults, ...result.data } : null
      };
    }
    lastResult = result;
    if (!/column .* does not exist|schema cache|payment_settings/i
      .test(String(result.error.message || ''))) {
      return result;
    }
  }
  if (lastResult?.error && /payment_settings|relation .* does not exist/i
    .test(String(lastResult.error.message || ''))) {
    return { data: null, error: null };
  }
  return lastResult || { data: null, error: null };
}

const ADMIN_PLAN_COLUMNS = 'slug,display_name,required_stars,unlock_currency,required_tokens,regular_tokens,promotion_enabled,promotion_label,promotion_ends_at,duration_days,referral_reward_stars,referral_reward_tokens,payment_mode,price_label,features,enabled,created_by,created_at,updated_at';
const LEGACY_ADMIN_PLAN_COLUMNS = 'slug,display_name,required_stars,unlock_currency,required_tokens,promotion_enabled,promotion_label,promotion_ends_at,duration_days,referral_reward_stars,payment_mode,price_label,features,enabled,created_by,created_at,updated_at';

async function readAdminPlans(client: Client) {
  const current = await client
    .from('subscription_plans')
    .select(ADMIN_PLAN_COLUMNS)
    .order('required_stars', { ascending: true })
    .limit(100);
  if (!current.error) return current;
  if (!/regular_tokens|referral_reward_tokens|column .* does not exist|schema cache/i
    .test(String(current.error.message || ''))) {
    return current;
  }
  const legacy = await client
    .from('subscription_plans')
    .select(LEGACY_ADMIN_PLAN_COLUMNS)
    .order('required_stars', { ascending: true })
    .limit(100);
  if (legacy.error) return legacy;
  return {
    ...legacy,
    data: (legacy.data || []).map((plan: any) => ({
      ...plan,
      regular_tokens: Number(plan.regular_tokens ?? plan.required_tokens) || 0,
      referral_reward_tokens: Number(plan.referral_reward_tokens) || 0
    }))
  };
}

async function listAccess(client: Client) {
  const [plans, rules, subscriptions, settings, requests, prices, tokenPrices, commentRules, locks, earlyAccessRules, drawSources] = await Promise.all([
    readAdminPlans(client),
    readAccessRules(client),
    client.from('user_subscriptions')
      .select('id,user_id,plan_slug,cancelled_plan_slug,cancelled_plan_name,status,started_at,expires_at,created_at,updated_at')
      .order('created_at', { ascending: false }).limit(500),
    readAdminPaymentSettings(client),
    client.from('payment_requests')
      .select('id,user_id,plan_slug,payment_method,stars_requested,country_code,currency_code,unit_price,total_price,proof_reference,status,admin_note,reviewed_by,reviewed_at,created_at,updated_at')
      .order('created_at', { ascending: false }).limit(200),
    client.from('star_prices')
      .select('country_code,country_name,currency_code,currency_symbol,price_per_star,enabled,updated_by,updated_at')
      .order('country_name', { ascending: true }).limit(100),
    client.from('token_prices')
      .select('pack_id,name,quantity,price_xof')
      .order('pack_id', { ascending: true }).limit(100),
    client.from('publication_comment_settings')
      .select('draw_id,comments_enabled,updated_at')
      .order('updated_at', { ascending: false }).limit(200),
    client.from('content_locks')
      .select('id,target_type,target_key,country_code,unlock_currency,required_stars,required_tokens,plan_slug,enabled,updated_at')
      .order('created_at', { ascending: true }).limit(200),
    readEarlyAccessRules(client),
    client.from('admin_draw_sources')
      .select('id,module_key,country_code,country_name,draw_name,draw_time,matrix,keyboard,cerveau,code,event,settings,enabled,created_by,created_at,updated_at')
      .order('module_key', { ascending: true })
      .order('country_name', { ascending: true })
      .order('draw_time', { ascending: true })
  ]);
  // Keep the rest of the admin dashboard usable while an older database is
  // waiting for the universal token-pack migration. Saving a token price
  // still returns a precise schema error below instead of breaking the whole
  // dashboard.
  const tokenTableMissing = tokenPrices.error
    && (String(tokenPrices.error.code || '') === '42P01'
      || /token_prices|relation .* does not exist|column .* does not exist|schema cache/i
        .test(String(tokenPrices.error.message || '')));
  // New superpower tables are optional during rolling deploys: any missing
  // table returns an empty list instead of failing the whole dashboard.
  const commentRulesMissing = commentRules.error
    && /relation .* does not exist|publication_comment_settings|content_locks/i
      .test(String(commentRules.error.message || ''));
  const locksMissing = locks.error
    && /relation .* does not exist|content_locks/i
      .test(String(locks.error.message || ''));
  const earlyAccessRulesMissing = earlyAccessRules.error
    && /relation .* does not exist|feature_early_access_rules/i
      .test(String(earlyAccessRules.error.message || ''));
  const drawSourcesMissing = drawSources.error
    && /relation .* does not exist|admin_draw_sources/i
      .test(String(drawSources.error.message || ''));
  // Payment settings are optional during the first deployment. An empty
  // table is already represented by `data: null`; an absent/older table must
  // likewise return a safe in-memory default instead of aborting list-access.
  const paymentSettingsMissing = settings.error
    && /payment_settings|relation .* does not exist|column .* does not exist/i
      .test(String(settings.error.message || ''));
  for (const result of [plans, rules, subscriptions, requests, prices]) {
    if (result.error) throw result.error;
  }
  if (settings.error && !paymentSettingsMissing) throw settings.error;
  if (tokenPrices.error && !tokenTableMissing) throw tokenPrices.error;
  if (commentRules.error && !commentRulesMissing) throw commentRules.error;
  if (locks.error && !locksMissing) throw locks.error;
  if (earlyAccessRules.error && !earlyAccessRulesMissing) {
    throw earlyAccessRules.error;
  }
  if (drawSources.error && !drawSourcesMissing) {
    throw drawSources.error;
  }
  const commentRuleList = commentRulesMissing ? [] : (commentRules.data || []);
  const commentRuleMap: Record<string, { key: string; comments_enabled: boolean }> = {};
  commentRuleList.forEach((row: any) => {
    commentRuleMap[String(row.draw_id || '')] = {
      key: String(row.draw_id || ''),
      comments_enabled: row.comments_enabled !== false
    };
  });
  return {
    plans: plans.data || [],
    rules: rules.data || [],
    subscriptions: subscriptions.data || [],
    settings: paymentSettingsMissing
      ? { payment_mode: 'manual', paystack_enabled: false }
      : {
        ...(settings.data || {}),
        payment_mode: ['manual', 'online', 'both'].includes(String(settings.data?.payment_mode || ''))
          ? settings.data.payment_mode
          : 'manual',
        paystack_enabled: settings.data?.paystack_enabled === true
          || settings.data?.payment_mode === 'online'
          || settings.data?.payment_mode === 'both',
      },
    requests: requests.data || [],
    starPrices: prices.data || [],
    tokenPrices: tokenTableMissing ? [] : (tokenPrices.data || []),
    commentRules: commentRuleMap,
    locks: locksMissing ? [] : (locks.data || []),
    earlyAccessRules: earlyAccessRulesMissing ? [] : (earlyAccessRules.data || []),
    drawSources: drawSourcesMissing ? [] : (drawSources.data || [])
  };
}

const DEFAULT_REFERRAL_SETTINGS = {
  id: true,
  enabled: true,
  share_reward_stars: 0,
  share_reward_tokens: 0,
  signup_reward_stars: 0,
  signup_reward_tokens: 0,
  unlock_reward_stars: 0,
  unlock_reward_tokens: 0,
  max_share_rewards_per_day: 10,
  updated_by: null,
  updated_at: null
};

async function readReferralSettings(client: Client) {
  const result = await client.from('referral_reward_settings')
    .select('id,enabled,share_reward_stars,share_reward_tokens,signup_reward_stars,signup_reward_tokens,unlock_reward_stars,unlock_reward_tokens,max_share_rewards_per_day,updated_by,updated_at')
    .eq('id', true)
    .maybeSingle();
  if (result.error && /referral_reward_settings|relation .* does not exist|schema cache/i
    .test(String(result.error.message || ''))) {
    return { ...DEFAULT_REFERRAL_SETTINGS };
  }
  if (result.error) throw result.error;
  return { ...DEFAULT_REFERRAL_SETTINGS, ...(result.data || {}) };
}

async function saveReferralSettings(client: Client, user: User, input: RecordJson) {
  const readAmount = (value: unknown) => {
    const amount = Number(value);
    return Number.isInteger(amount) && amount >= 0 && amount <= 1_000_000
      ? amount : null;
  };
  const readLimit = (value: unknown) => {
    const limit = Number(value);
    return Number.isInteger(limit) && limit >= 0 && limit <= 1000
      ? limit : null;
  };
  const shareStars = readAmount(input.shareRewardStars ?? input.share_reward_stars);
  const shareTokens = readAmount(input.shareRewardTokens ?? input.share_reward_tokens);
  const signupStars = readAmount(input.signupRewardStars ?? input.signup_reward_stars);
  const signupTokens = readAmount(input.signupRewardTokens ?? input.signup_reward_tokens);
  const unlockStars = readAmount(input.unlockRewardStars ?? input.unlock_reward_stars);
  const unlockTokens = readAmount(input.unlockRewardTokens ?? input.unlock_reward_tokens);
  const maxShares = readLimit(input.maxShareRewardsPerDay ?? input.max_share_rewards_per_day);
  if (shareStars === null || shareTokens === null
      || signupStars === null || signupTokens === null
      || unlockStars === null || unlockTokens === null || maxShares === null) {
    return json({ error: 'Réglage de récompense invalide.' }, 400);
  }
  const result = await client.from('referral_reward_settings').upsert({
    id: true,
    enabled: input.enabled !== false,
    share_reward_stars: shareStars,
    share_reward_tokens: shareTokens,
    signup_reward_stars: signupStars,
    signup_reward_tokens: signupTokens,
    unlock_reward_stars: unlockStars,
    unlock_reward_tokens: unlockTokens,
    max_share_rewards_per_day: maxShares,
    updated_by: user.id,
    updated_at: new Date().toISOString()
  }, { onConflict: 'id' }).select(
    'id,enabled,share_reward_stars,share_reward_tokens,signup_reward_stars,signup_reward_tokens,unlock_reward_stars,unlock_reward_tokens,max_share_rewards_per_day,updated_by,updated_at'
  ).single();
  if (result.error) {
    if (/referral_reward_settings|relation .* does not exist|schema cache/i
      .test(String(result.error.message || ''))) {
      return json({
        error: 'La configuration des récompenses manque. Exécutez SUPABASE_REFERRAL_REWARDS.sql puis redéployez admin-method-control.'
      }, 503);
    }
    throw result.error;
  }
  return json({ ok: true, action: 'referral-settings-saved', settings: result.data });
}

async function listPromoBanners(client: Client) {
  let result = await client.from('promo_banners')
    .select('id,country_code,placement,title,description,title_i18n,description_i18n,feature_key,key_value,image_url,target_url,action_label,action_label_i18n,sort_order,starts_at,ends_at,enabled,created_by,created_at,updated_at')
    .order('sort_order', { ascending: true });
  if (result.error && /column .* does not exist|schema cache/i.test(String(result.error.message || ''))) {
    result = await client.from('promo_banners')
      .select('id,country_code,placement,title,description,feature_key,key_value,image_url,target_url,action_label,sort_order,starts_at,ends_at,enabled,created_by,created_at,updated_at')
      .order('sort_order', { ascending: true });
  }
  if (result.error && /relation .* does not exist|promo_banners/i
    .test(String(result.error.message || ''))) return [];
  if (result.error) throw result.error;
  return result.data || [];
}

async function savePromoBanner(client: Client, user: User, input: RecordJson) {
  const rawId = String(input.id || '').trim();
  const id = rawId ? readUserId(rawId) : '';
  const placement = String(input.placement || 'homepage').trim().toLowerCase();
  const countryCode = String(input.countryCode || input.country_code || 'ALL')
    .trim().toUpperCase();
  const title = readText(input.title, 160);
  const description = readText(input.description, 1000);
  const featureKey = String(input.featureKey || input.feature_key || '').trim().toLowerCase();
  const keyValue = readText(input.keyValue || input.key_value, 160);
  const imageUrl = readText(input.imageUrl || input.image_url, 2000);
  const targetUrl = readText(input.targetUrl || input.target_url, 2000);
  const actionLabel = readText(input.actionLabel || input.action_label, 120);
  const localizedObject = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([locale, text]) => [
          String(locale).trim().toLowerCase().slice(0, 12),
          readText(text, 2000)
        ])
        .filter(([locale, text]) => /^[a-z]{2,3}(?:-[a-z]{2})?$/.test(locale) && text)
    );
  };
  const titleI18n = localizedObject(input.titleI18n || input.title_i18n);
  const descriptionI18n = localizedObject(
    input.descriptionI18n || input.description_i18n
  );
  const actionLabelI18n = localizedObject(
    input.actionLabelI18n || input.action_label_i18n
  );
  const sortOrder = Number(input.sortOrder ?? input.sort_order ?? 0);
  const startsAtRaw = String(input.startsAt || input.starts_at || '').trim();
  const endsAtRaw = String(input.endsAt || input.ends_at || '').trim();
  const startsAt = startsAtRaw ? new Date(startsAtRaw) : null;
  const endsAt = endsAtRaw ? new Date(endsAtRaw) : null;
  if ((rawId && !id)
      || !/^(ALL|[A-Z]{2,3})$/.test(countryCode)
      || !['homepage', 'tableaux', 'account', 'all'].includes(placement)
      || title.length < 2
      || (featureKey && !/^[a-z][a-z0-9_-]{1,59}$/.test(featureKey))
      || !Number.isInteger(sortOrder)
      || (startsAtRaw && Number.isNaN(startsAt?.getTime()))
      || (endsAtRaw && Number.isNaN(endsAt?.getTime()))
      || (startsAt && endsAt && endsAt <= startsAt)) {
    return json({ error: 'Bannière invalide.' }, 400);
  }
  const now = new Date().toISOString();
  const values = {
    country_code: countryCode,
    placement, title, description,
    title_i18n: titleI18n,
    description_i18n: descriptionI18n,
    feature_key: featureKey || null,
    key_value: keyValue, image_url: imageUrl, target_url: targetUrl,
    action_label: actionLabel,
    action_label_i18n: actionLabelI18n,
    sort_order: sortOrder,
    starts_at: startsAt ? startsAt.toISOString() : null,
    ends_at: endsAt ? endsAt.toISOString() : null,
    enabled: input.enabled !== false,
    updated_by: user.id, updated_at: now
  };
  let result = id
    ? await client.from('promo_banners').update(values).eq('id', id)
      .select('id,country_code,placement,title,description,title_i18n,description_i18n,feature_key,key_value,image_url,target_url,action_label,action_label_i18n,sort_order,starts_at,ends_at,enabled,created_by,created_at,updated_at')
      .single()
    : await client.from('promo_banners').insert({
      ...values, created_by: user.id
    }).select('id,country_code,placement,title,description,title_i18n,description_i18n,feature_key,key_value,image_url,target_url,action_label,action_label_i18n,sort_order,starts_at,ends_at,enabled,created_by,created_at,updated_at')
      .single();
  if (result.error && /column .* does not exist|schema cache/i.test(String(result.error.message || ''))) {
    const {
      title_i18n: _titleI18n,
      description_i18n: _descriptionI18n,
      action_label_i18n: _actionLabelI18n,
      ...legacyValues
    } = values;
    result = id
      ? await client.from('promo_banners').update(legacyValues).eq('id', id)
        .select('id,country_code,placement,title,description,feature_key,key_value,image_url,target_url,action_label,sort_order,starts_at,ends_at,enabled,created_by,created_at,updated_at')
        .single()
      : await client.from('promo_banners').insert({
        ...legacyValues, created_by: user.id
      }).select('id,country_code,placement,title,description,feature_key,key_value,image_url,target_url,action_label,sort_order,starts_at,ends_at,enabled,created_by,created_at,updated_at')
        .single();
  }
  if (result.error) throw result.error;
  if (!id) {
    try {
      const profiles = await client.from('profiles').select('id,country');
      const countryAliases: Record<string, string[]> = {
        CI: ['CI', 'Côte d’Ivoire', "Côte d'Ivoire", 'Cote d Ivoire'],
        BJ: ['BJ', 'Bénin', 'Benin'],
        NE: ['NE', 'Niger'],
        GH: ['GH', 'Ghana'],
        SN: ['SN', 'Sénégal', 'Senegal'],
        TG: ['TG', 'Togo']
      };
      const accepted = countryCode === 'ALL'
        ? null
        : new Set(countryAliases[countryCode] || [countryCode]);
      const recipients = (profiles.data || [])
        .filter((profile: any) => !accepted || accepted.has(String(profile.country || '').trim()))
        .map((profile: any) => ({
          user_id: profile.id,
          actor_id: user.id,
          type: 'PROMO',
          title: 'Nouvelle offre disponible',
          message: `${title}${featureKey ? ` — ${featureKey}` : ''} est maintenant disponible dans les offres.`
        }));
      if (recipients.length) await client.from('notifications').insert(recipients);
    } catch (_) {
      // The banner remains published even on older installations without
      // profiles/notifications or with country labels instead of ISO codes.
    }
  }
  return json({ ok: true, action: 'promo-banner-saved', banner: result.data });
}

async function deletePromoBanner(client: Client, input: RecordJson) {
  const id = readUserId(input.id);
  if (!id) return json({ error: 'Identifiant de bannière invalide.' }, 400);
  const result = await client.from('promo_banners').delete().eq('id', id);
  if (result.error) throw result.error;
  return json({ ok: true, action: 'promo-banner-deleted', id });
}

async function saveEarlyAccessRule(client: Client, user: User, input: RecordJson) {
  const featureKey = String(input.featureKey || '').trim().toLowerCase();
  const displayName = readText(input.displayName || input.name, 100);
  const requiredTokens = readTokens(input.requiredTokens ?? input.required_tokens);
  const durationDays = readDurationDays(input.durationDays ?? input.duration_days);
  const previewDays = readPreviewDays(input.previewDays ?? input.preview_days);
  const tokenCost1Day = readTokens(input.tokenCost1Day ?? input.token_cost_1_day);
  const tokenCost2Days = readTokens(input.tokenCost2Days ?? input.token_cost_2_days);
  const tokenCost3Days = readTokens(input.tokenCost3Days ?? input.token_cost_3_days);
  const referralRewardStars = readOptionalReward(
    input.referralRewardStars !== undefined
      ? input.referralRewardStars : input.referral_reward_stars,
    readStars
  );
  const referralRewardTokens = readOptionalReward(
    input.referralRewardTokens !== undefined
      ? input.referralRewardTokens : input.referral_reward_tokens,
    readTokens
  );
  const enabled = input.enabled === true;
  if (!/^[a-z][a-z0-9_-]{1,59}$/.test(featureKey)
      || displayName.length < 2
      || requiredTokens === null || requiredTokens < 1
      || durationDays === null
      || previewDays === null
      || tokenCost1Day === null
      || tokenCost1Day < 1
      || tokenCost2Days === null
      || tokenCost2Days < 2
      || tokenCost3Days === null
      || tokenCost3Days < 3
      || referralRewardStars === undefined
      || referralRewardTokens === undefined) {
    return json({ error: 'Configuration d’accès anticipé invalide.' }, 400);
  }
  let result = await client.from('feature_early_access_rules').upsert({
    feature_key: featureKey,
    display_name: displayName,
    enabled,
    // Anticipation follows the same global 16:00 publication boundary.
    early_hour: PROGRAM_GENERATION_HOUR,
    required_tokens: requiredTokens,
    duration_days: durationDays,
    preview_days: previewDays,
    token_cost_1_day: tokenCost1Day,
    token_cost_2_days: tokenCost2Days,
    token_cost_3_days: tokenCost3Days,
    referral_reward_stars: referralRewardStars,
    referral_reward_tokens: referralRewardTokens,
    updated_by: user.id,
    updated_at: new Date().toISOString()
  }, { onConflict: 'feature_key' }).select(
    EARLY_ACCESS_RULE_COLUMNS
  ).single();
  if (result.error && earlyAccessColumnsMissing(result.error)) {
    /*
     * The rolling-window columns may exist even when the optional referral
     * columns do not. Retry with that schema first; falling directly back to
     * the original table shape used to discard token_cost_2_days and
     * token_cost_3_days, making the dashboard show 1/2/3 after every save.
     */
    const horizon = await client.from('feature_early_access_rules').upsert({
      feature_key: featureKey,
      display_name: displayName,
      enabled,
      early_hour: PROGRAM_GENERATION_HOUR,
      required_tokens: requiredTokens,
      duration_days: durationDays,
      preview_days: previewDays,
      token_cost_1_day: tokenCost1Day,
      token_cost_2_days: tokenCost2Days,
      token_cost_3_days: tokenCost3Days,
      updated_by: user.id,
      updated_at: new Date().toISOString()
    }, { onConflict: 'feature_key' }).select(
      HORIZON_EARLY_ACCESS_RULE_COLUMNS
    ).single();
    if (!horizon.error) {
      result = {
        ...horizon,
        data: normalizeHorizonEarlyRules(horizon.data ? [horizon.data] : [])[0] || null
      };
    } else if (earlyAccessColumnsMissing(horizon.error)) {
      const legacy = await client.from('feature_early_access_rules').upsert({
        feature_key: featureKey,
        display_name: displayName,
        enabled,
        early_hour: PROGRAM_GENERATION_HOUR,
        required_tokens: requiredTokens,
        duration_days: durationDays,
        updated_by: user.id,
        updated_at: new Date().toISOString()
      }, { onConflict: 'feature_key' }).select(
        LEGACY_EARLY_ACCESS_RULE_COLUMNS
      ).single();
      if (!legacy.error) {
        result = {
          ...legacy,
          data: normalizeLegacyEarlyRules(legacy.data ? [legacy.data] : [])[0] || null
        };
      } else {
        result = legacy;
      }
    } else {
      result = horizon;
    }
  }
  if (result.error) throw result.error;
  return json({
    ok: true,
    action: 'early-access-rule-saved',
    earlyAccessRule: result.data
  });
}

async function saveStarPrice(client: Client, user: User, input: RecordJson) {
  const countryCode = readCountryCode(input.countryCode);
  const countryName = readText(input.countryName, 80);
  const currencyCode = readCurrencyCode(input.currencyCode);
  const currencySymbol = readText(input.currencySymbol, 8);
  const pricePerStar = readMoney(input.pricePerStar);
  if (!countryCode || countryName.length < 2 || !currencyCode
      || !currencySymbol || pricePerStar === null) {
    return json({ error: 'Tarif invalide : pays, devise, symbole et prix positif sont obligatoires.' }, 400);
  }
  const result = await client.from('star_prices').upsert({
    country_code: countryCode,
    country_name: countryName,
    currency_code: currencyCode,
    currency_symbol: currencySymbol,
    price_per_star: pricePerStar,
    enabled: input.enabled !== false,
    updated_by: user.id,
    updated_at: new Date().toISOString()
  }, { onConflict: 'country_code' }).select(
    'country_code,country_name,currency_code,currency_symbol,price_per_star,enabled,updated_by,updated_at'
  ).single();
  if (result.error) throw result.error;
  return json({ ok: true, action: 'star-price-saved', starPrice: result.data });
}

async function deleteStarPrice(client: Client, input: RecordJson) {
  const countryCode = readCountryCode(input.countryCode);
  if (!countryCode) return json({ error: 'Pays invalide.' }, 400);
  const result = await client.from('star_prices')
    .delete()
    .eq('country_code', countryCode)
    .select('country_code')
    .maybeSingle();
  if (result.error) throw result.error;
  return json({
    ok: true,
    action: 'star-price-deleted',
    countryCode,
    deleted: Boolean(result.data)
  });
}

async function saveTokenPrice(client: Client, user: User, input: RecordJson) {
  const packId = readTokenPackId(input.packId);
  const name = readText(input.name, 80);
  const quantity = readTokens(input.quantity);
  const priceXof = readWholeMoney(input.priceXof ?? input.price);
  if (!packId || name.length < 2 || quantity === null || quantity < 1 || priceXof === null) {
    return json({ error: 'Pack invalide : identifiant, nom, quantité et prix XOF positif sont obligatoires.' }, 400);
  }
  // Keep the legacy USD column populated for existing installations where it
  // remains NOT NULL. It is never used to initialize a Paystack checkout.
  const priceUsd = Math.round((priceXof / 600) * 100) / 100;
  const result = await client.from('token_prices').upsert({
    pack_id: packId,
    name,
    quantity,
    price_usd: priceUsd,
    price_xof: priceXof
  }, { onConflict: 'pack_id' }).select(
    'pack_id,name,quantity,price_xof'
  ).single();
  if (result.error) {
    if (String(result.error.code || '') === '42P01'
        || /token_prices|relation .* does not exist|column .* does not exist|schema cache/i.test(String(result.error.message || ''))) {
      return json({
        error: 'La table token_prices n’utilise pas encore le schéma XOF des packs (pack_id, name, quantity, price_xof). Appliquez la migration Supabase, puis redéployez admin-method-control.'
      }, 503);
    }
    throw result.error;
  }
  return json({ ok: true, action: 'token-price-saved', tokenPrice: result.data });
}

async function deleteTokenPrice(client: Client, input: RecordJson) {
  const packId = readTokenPackId(input.packId);
  if (!packId) return json({ error: 'Pack invalide.' }, 400);
  const result = await client.from('token_prices')
    .delete()
    .eq('pack_id', packId)
    .select('pack_id')
    .maybeSingle();
  if (result.error) {
    if (String(result.error.code || '') === '42P01'
        || /token_prices|relation .* does not exist|column .* does not exist|schema cache/i.test(String(result.error.message || ''))) {
      return json({
        error: 'La table token_prices n’utilise pas encore le schéma XOF des packs (pack_id, name, quantity, price_xof). Appliquez la migration Supabase, puis redéployez admin-method-control.'
      }, 503);
    }
    throw result.error;
  }
  return json({
    ok: true,
    action: 'token-price-deleted',
    packId,
    deleted: Boolean(result.data)
  });
}

async function searchUsers(client: Client, input: RecordJson) {
  const query = readText(input.email, 160).toLowerCase();
  if (query.length < 3) {
    return json({ error: 'Saisissez au moins 3 caractères de l’adresse e-mail.' }, 400);
  }
  const result = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (result.error) throw result.error;
  const users = (result.data?.users || [])
    .filter((item: any) => String(item.email || '').toLowerCase().includes(query))
    .slice(0, 20)
    .map((item: any) => ({
      id: item.id,
      email: item.email || '',
      name: item.user_metadata?.full_name
        || item.user_metadata?.name
        || '',
      createdAt: item.created_at || null
    }));
  return json({ ok: true, action: 'users-found', users });
}

async function grantBalance(client: Client, user: User, input: RecordJson) {
  const targetUserId = readUserId(input.userId);
  const stars = readStars(input.stars ?? 0);
  const tokens = readTokens(input.tokens ?? 0);
  const note = readText(input.note, 1000);
  const proofReference = readText(input.proofReference || input.proof, 500);
  if (!targetUserId || stars === null || tokens === null
      || (stars === 0 && tokens === 0)) {
    return json({
      error: 'Utilisateur ou montant invalide : indiquez au moins une étoile ou un jeton.'
    }, 400);
  }

  const target = await client.auth.admin.getUserById(targetUserId);
  if (target.error || !target.data?.user?.id) {
    return json({ error: 'Aucun compte ne correspond à cet utilisateur.' }, 404);
  }

  const result = await client.rpc('admin_grant_user_balance_with_audit', {
    target_user_id: targetUserId,
    stars_amount: stars,
    tokens_amount: tokens,
    source: 'manual',
    grant_note: note,
    proof: proofReference,
    granted_by_user_id: user.id
  });
  if (result.error) throw result.error;
  return json({
    ok: true,
    action: 'balance-granted',
    user: {
      id: target.data.user.id,
      email: target.data.user.email || input.email || ''
    },
    balance: result.data
  });
}

async function grantSubscription(client: Client, user: User, input: RecordJson) {
  const targetUserId = readUserId(input.userId);
  const planSlug = readSlug(input.planSlug || input.plan);
  const note = readText(input.note, 1000);
  if (!targetUserId || !planSlug) {
    return json({ error: 'Utilisateur et offre valides obligatoires.' }, 400);
  }

  const target = await client.auth.admin.getUserById(targetUserId);
  if (target.error || !target.data?.user?.id) {
    return json({ error: 'Aucun compte ne correspond à cet utilisateur.' }, 404);
  }
  const plan = await client.from('subscription_plans')
    .select('slug,display_name,duration_days')
    .eq('slug', planSlug)
    .eq('enabled', true)
    .maybeSingle();
  if (plan.error) throw plan.error;
  if (!plan.data) return json({ error: 'L’offre indiquée n’existe pas ou est inactive.' }, 404);

  const requestedDuration = input.durationDays ?? input.duration;
  const durationDays = requestedDuration === undefined
    ? Number(plan.data.duration_days) || 30
    : readDurationDays(requestedDuration);
  if (durationDays === null) {
    return json({ error: 'La durée doit être comprise entre 1 et 3650 jours.' }, 400);
  }

  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + durationDays * 86400000);
  const cancelled = await client.from('user_subscriptions')
    .update({ status: 'cancelled', updated_at: startedAt.toISOString() })
    .eq('user_id', targetUserId)
    .eq('status', 'active');
  if (cancelled.error) throw cancelled.error;
  const created = await client.from('user_subscriptions').insert({
    user_id: targetUserId,
    plan_slug: planSlug,
    status: 'active',
    started_at: startedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    updated_at: startedAt.toISOString()
  }).select(
    'id,user_id,plan_slug,status,started_at,expires_at,created_at,updated_at'
  ).single();
  if (created.error) throw created.error;
  await client.from('admin_audit_events').insert({
    actor_user_id: user.id,
    action: 'grant-subscription',
    payload: {
      targetUserId,
      targetEmail: target.data.user.email || '',
      planSlug,
      planName: plan.data.display_name || planSlug,
      durationDays,
      startedAt: startedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      note
    }
  }).catch(() => {});
  return json({
    ok: true,
    action: 'subscription-granted',
    user: { id: target.data.user.id, email: target.data.user.email || '' },
    plan: { slug: plan.data.slug, displayName: plan.data.display_name || planSlug },
    durationDays,
    subscription: created.data
  });
}

async function savePaymentSettings(client: Client, user: User, input: RecordJson) {
  let paymentMode = ['manual', 'online', 'both'].includes(String(input.paymentMode))
    ? String(input.paymentMode) : '';
  const paystackEnabled = input.paystackEnabled === true
    || paymentMode === 'online'
    || paymentMode === 'both';
  // The checkbox is the source of truth when the caller sends it. This also
  // makes the "En ligne Paystack" choice work when all secondary fields are
  // still empty.
  if (paystackEnabled && paymentMode === 'manual') paymentMode = 'online';
  const onlineProvider = readText(input.onlineProvider, 80)
    || (paystackEnabled ? 'Paystack' : '');
  const onlinePaymentLink = readText(input.onlinePaymentLink, 500);
  const physicalInstructions = readText(input.physicalInstructions, 2000);
  const contactLabel = readText(input.contactLabel, 160);
  const manualEnabled = input.manualEnabled !== false;
  const currencyMode = ['stars', 'tokens', 'both'].includes(String(input.currencyMode))
    ? String(input.currencyMode) : 'both';
  const contactChannel = ['chat', 'whatsapp'].includes(String(input.contactChannel))
    ? String(input.contactChannel) : 'chat';
  const whatsappNumber = readText(input.whatsappNumber, 40);
  const chatLabel = readText(input.chatLabel, 120) || 'Contacter l’équipe';
  const socialLinks = readSocialLinks(input.socialLinks);
  if (!paymentMode) return json({ error: 'Mode de paiement invalide.' }, 400);
  const now = new Date().toISOString();
  let result = await client.from('payment_settings').upsert({
    id: 1, payment_mode: paymentMode, online_provider: onlineProvider,
    online_payment_link: onlinePaymentLink,
    physical_instructions: physicalInstructions, contact_label: contactLabel,
    manual_enabled: manualEnabled, currency_mode: currencyMode,
    contact_channel: contactChannel, whatsapp_number: whatsappNumber,
    chat_label: chatLabel, social_links: socialLinks,
    updated_by: user.id, updated_at: now
  }, { onConflict: 'id' }).select(
    'id,payment_mode,online_provider,online_payment_link,physical_instructions,contact_label,manual_enabled,currency_mode,contact_channel,whatsapp_number,chat_label,social_links,updated_by,updated_at'
  ).single();
  if (result.error && /social_links|column .* does not exist|schema cache/i
    .test(String(result.error.message || ''))) {
    const legacy = await client.from('payment_settings').upsert({
      id: 1, payment_mode: paymentMode, online_provider: onlineProvider,
      online_payment_link: onlinePaymentLink,
      physical_instructions: physicalInstructions, contact_label: contactLabel,
      manual_enabled: manualEnabled, currency_mode: currencyMode,
      contact_channel: contactChannel, whatsapp_number: whatsappNumber,
      chat_label: chatLabel, updated_by: user.id, updated_at: now
    }, { onConflict: 'id' }).select(
      'id,payment_mode,online_provider,online_payment_link,physical_instructions,contact_label,manual_enabled,currency_mode,contact_channel,whatsapp_number,chat_label,updated_by,updated_at'
    ).single();
    if (!legacy.error) {
      result = {
        ...legacy,
        data: { ...(legacy.data || {}), social_links: socialLinks }
      };
    }
  }
  if (result.error) throw result.error;
  // `payment_mode` is the canonical field in the existing schema. Persist
  // the explicit flag too when a newer installation has added the optional
  // column, while remaining compatible with older Supabase databases.
  const paystackFlag = await client.from('payment_settings')
    .update({ paystack_enabled: paystackEnabled })
    .eq('id', 1);
  if (paystackFlag.error && !/column .* does not exist|paystack_enabled/i
    .test(String(paystackFlag.error.message || ''))) {
    throw paystackFlag.error;
  }
  return json({
    ok: true,
    action: 'payment-settings-saved',
    settings: {
      ...(result.data || {}),
      payment_mode: paymentMode,
      paystack_enabled: paystackEnabled
    }
  });
}

async function findUserByEmail(client: Client, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const result = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (result.error) throw result.error;
  return (result.data?.users || []).find((item: any) =>
    String(item.email || '').trim().toLowerCase() === normalized) || null;
}

async function grantStars(client: Client, user: User, input: RecordJson) {
  const email = readText(input.email, 160).toLowerCase();
  const amount = readStars(input.amount ?? input.stars);
  const requestedPlan = String(input.planSlug || '').trim();
  const planSlug = requestedPlan ? readSlug(requestedPlan) : '';
  const proofReference = readText(input.proofReference || input.proof, 500);
  const note = readText(input.note, 1000);
  const paymentMethod = ['manual', 'online', 'adjustment'].includes(String(input.paymentMethod))
    ? String(input.paymentMethod) : 'manual';
  if (!email || !email.includes('@') || amount === null || amount < 1) {
    return json({ error: 'E-mail ou nombre d’étoiles invalide.' }, 400);
  }
  if (requestedPlan && !planSlug) {
    return json({ error: 'Le niveau indiqué est invalide.' }, 400);
  }

  const target = await findUserByEmail(client, email);
  if (!target?.id) return json({ error: 'Aucun compte ne correspond à cet e-mail.' }, 404);

  let plan: any = null;
  if (planSlug) {
    plan = await client.from('subscription_plans')
      .select('slug,duration_days').eq('slug', planSlug).maybeSingle();
    if (plan.error) throw plan.error;
    if (!plan.data) return json({ error: 'Le niveau indiqué n’existe pas encore.' }, 404);
  }

  /*
   * Prefer the SQL command that increments the balance and writes the audit
   * grant in one database transaction. Older installations only have the
   * balance RPC, so retain a narrowly scoped fallback for those deployments.
   */
  const atomicGrant = await client.rpc('admin_grant_user_balance_with_audit', {
    target_user_id: target.id,
    stars_amount: amount,
    tokens_amount: 0,
    source: paymentMethod,
    grant_note: note,
    proof: proofReference,
    granted_by_user_id: user.id
  });
  let stars: any = atomicGrant;
  let grant: any = null;
  const atomicRpcMissing = atomicGrant.error
    && /admin_grant_user_balance_with_audit|function .* does not exist|could not find|PGRST202/i
      .test(String(atomicGrant.error.message || ''));
  if (atomicGrant.error && !atomicRpcMissing) throw atomicGrant.error;
  if (atomicRpcMissing) {
    stars = await client.rpc('admin_grant_user_stars', {
      target_user_id: target.id, amount
    });
    if (stars.error) throw stars.error;
    const legacyGrant = await client.from('star_grants').insert({
      user_id: target.id, amount, payment_method: paymentMethod,
      proof_reference: proofReference, note, granted_by: user.id
    }).select(
      'id,user_id,amount,payment_method,proof_reference,note,granted_by,created_at'
    ).single();
    if (legacyGrant.error) throw legacyGrant.error;
    grant = legacyGrant.data;
  }

  let subscription = null;
  if (planSlug) {
    const durationDays = Number(plan.data.duration_days) || 30;
    const currentSubscription = await client.from('user_subscriptions')
      .select('id,plan_slug,status,started_at,expires_at')
      .eq('user_id', target.id)
      .eq('status', 'active')
      .order('expires_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (currentSubscription.error) throw currentSubscription.error;
    const renewingSamePlan = currentSubscription.data?.plan_slug === planSlug
      && currentSubscription.data?.expires_at
      && Date.parse(currentSubscription.data.expires_at) > Date.now();
    const startedAt = renewingSamePlan
      ? new Date(currentSubscription.data.expires_at)
      : new Date();
    const expiresAt = new Date(startedAt.getTime() + durationDays * 86400000);
    if (renewingSamePlan) {
      const extended = await client.from('user_subscriptions')
        .update({
          expires_at: expiresAt.toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', currentSubscription.data.id)
        .select(
          'id,user_id,plan_slug,status,started_at,expires_at,created_at,updated_at'
        )
        .single();
      if (extended.error) throw extended.error;
      subscription = {
        ...extended.data,
        renewal_started_at: startedAt.toISOString(),
        is_renewal: true
      };
    } else {
      const cancelled = await client.from('user_subscriptions')
        .update({ status: 'cancelled', updated_at: startedAt.toISOString() })
        .eq('user_id', target.id).eq('status', 'active');
      if (cancelled.error) throw cancelled.error;
      const created = await client.from('user_subscriptions').insert({
        user_id: target.id, plan_slug: planSlug, status: 'active',
        started_at: startedAt.toISOString(), expires_at: expiresAt.toISOString(),
        updated_at: startedAt.toISOString()
      }).select(
        'id,user_id,plan_slug,status,started_at,expires_at,created_at,updated_at'
      ).single();
      if (created.error) throw created.error;
      subscription = created.data;
    }
  }

  return json({
    ok: true, action: 'stars-granted',
    user: { id: target.id, email: target.email || email },
    stars: stars.data, grant, subscription
  });
}

async function saveAccessPlan(client: Client, user: User, input: RecordJson) {
  const slug = readSlug(input.slug || input.planKey);
  const displayName = readText(input.displayName || input.name, 80);
  const requiredStars = readStars(input.requiredStars ?? input.stars);
  const unlockCurrency = readUnlockCurrency(input.unlockCurrency);
  const requiredTokens = readTokens(input.requiredTokens ?? input.tokens);
  const regularTokens = readTokens(
    input.regularTokens ?? input.regular_tokens ?? requiredTokens
  );
  const promotionLabel = readText(
    input.promotionLabel ?? input.promotion_label,
    120
  );
  const promotionEndsAtRaw = String(
    input.promotionEndsAt ?? input.promotion_ends_at ?? ''
  ).trim();
  const promotionEndsAt = promotionEndsAtRaw
    ? new Date(promotionEndsAtRaw)
    : null;
  const promotionEnabled = input.promotionEnabled === true
    && Number(regularTokens) > Number(requiredTokens);
  const referralRewardStars = readStars(
    input.referralRewardStars ?? input.referralStars ?? 1
  );
  const referralRewardTokens = readTokens(
    input.referralRewardTokens ?? input.referral_reward_tokens ?? 0
  );
  const paymentMode = ['manual', 'online', 'both'].includes(String(input.paymentMode))
    ? String(input.paymentMode) : 'manual';
  const priceLabel = readText(input.priceLabel || input.price, 120);
  const durationDays = Number(input.durationDays ?? input.duration ?? 30);
  const features = readStringList(input.features);
  if (!slug || displayName.length < 2 || !unlockCurrency
      || requiredStars === null
      || requiredTokens === null || regularTokens === null
      || regularTokens < requiredTokens
      || referralRewardStars === null
      || referralRewardTokens === null
      || (promotionEndsAtRaw && Number.isNaN(promotionEndsAt?.getTime()))
      || !Number.isInteger(durationDays)
      || durationDays < 1 || durationDays > 3650 || !features?.length) {
    return json({
      error: 'Niveau invalide : identifiant, nom, devise de déblocage, coût et sections sont obligatoires.'
    }, 400);
  }
  const now = new Date().toISOString();
  const result = await client.from('subscription_plans').upsert({
    slug, display_name: displayName, required_stars: requiredStars,
    unlock_currency: unlockCurrency, required_tokens: requiredTokens,
    regular_tokens: regularTokens,
    promotion_enabled: promotionEnabled,
    promotion_label: promotionLabel,
    promotion_ends_at: promotionEndsAt
      ? promotionEndsAt.toISOString()
      : null,
    duration_days: durationDays, referral_reward_stars: referralRewardStars,
    referral_reward_tokens: referralRewardTokens,
    payment_mode: paymentMode, price_label: priceLabel, features,
    enabled: input.enabled !== false, created_by: user.id, updated_at: now
  }, { onConflict: 'slug' }).select(
    'slug,display_name,required_stars,unlock_currency,required_tokens,regular_tokens,promotion_enabled,promotion_label,promotion_ends_at,duration_days,referral_reward_stars,referral_reward_tokens,payment_mode,price_label,features,enabled,created_by,created_at,updated_at'
  ).single();
  if (result.error) {
    if (/referral_reward_tokens|column .* does not exist|schema cache/i
      .test(String(result.error.message || ''))) {
      /*
       * Keep the old admin-method-control contract usable while the additive
       * token-reward migration is rolling out. Stars were the original
       * referral reward and remain authoritative when the optional token
       * column is not installed yet; the dashboard can still save the plan
       * instead of hiding all access/reward configuration behind a 503.
       */
      const legacy = await client.from('subscription_plans').upsert({
        slug, display_name: displayName, required_stars: requiredStars,
        unlock_currency: unlockCurrency, required_tokens: requiredTokens,
        duration_days: durationDays,
        referral_reward_stars: referralRewardStars,
        payment_mode: paymentMode, price_label: priceLabel, features,
        enabled: input.enabled !== false, created_by: user.id, updated_at: now
      }, { onConflict: 'slug' }).select(
        'slug,display_name,required_stars,unlock_currency,required_tokens,duration_days,referral_reward_stars,payment_mode,price_label,features,enabled,created_by,created_at,updated_at'
      ).single();
      if (legacy.error) throw legacy.error;
      return json({
        ok: true,
        action: 'access-plan-saved',
        warning: 'Le plan a été enregistré avec la récompense en étoiles. Exécutez SUPABASE_REFERRAL_TOKENS.sql pour activer aussi les jetons.',
        plan: { ...legacy.data, referral_reward_tokens: 0 }
      });
    }
    throw result.error;
  }
  return json({ ok: true, action: 'access-plan-saved', plan: result.data });
}

async function deleteAccessPlan(client: Client, user: User, input: RecordJson) {
  const slug = readSlug(input.slug);
  if (!slug) return json({ error: 'Identifiant de niveau invalide.' }, 400);

  const compensation = Array.isArray(input.compensation)
    ? input.compensation.slice(0, 100).map((item: any) => ({
      userId: readUserId(item?.userId || item?.user_id),
      stars: Number(item?.stars || 0),
      tokens: Number(item?.tokens || 0)
    }))
    : [];
  if (input.compensation !== undefined && !Array.isArray(input.compensation)) {
    return json({ error: 'La liste de compensations est invalide.' }, 400);
  }

  const result = await client.rpc('admin_delete_access_plan_with_compensation', {
    target_slug: slug,
    compensation,
    acting_admin_id: user.id
  });
  if (!result.error) {
    return json({ ok: true, action: 'access-plan-deleted', ...result.data });
  }

  // Some projects already installed SUPABASE_ADMIN_DELETE.sql before the
  // compensation patch. Keep deletion functional there instead of exposing
  // Supabase's generic "Failed to send a request..." message. The legacy
  // function still detaches every subscription reference and deletes the
  // catalogue offer; only the optional compensation list requires the newer
  // function.
  const missingCompensationRpc = String(result.error.code || '') === '42883'
    || /admin_delete_access_plan_with_compensation|function .* does not exist|could not find/i
      .test(String(result.error.message || ''));
  if (!missingCompensationRpc || compensation.length) throw result.error;

  const legacy = await client.rpc('admin_delete_access_plan', {
    target_slug: slug
  });
  if (legacy.error) throw legacy.error;
  return json({ ok: true, action: 'access-plan-deleted', ...legacy.data });
}

async function saveFeatureRule(client: Client, user: User, input: RecordJson) {
  const featureKey = readSlug(input.featureKey || input.key, 60);
  const displayName = readText(input.displayName || input.name, 100);
  const requestedStars = readStars(input.requiredStars ?? input.stars);
  const requestedCurrency = readUnlockCurrency(input.unlockCurrency);
  const requestedTokens = readTokens(input.requiredTokens ?? input.tokens);
  const durationDays = readDurationDays(input.durationDays ?? input.duration_days);
  const rawHistoryFreeDays = Number(
    input.historyFreeDays ?? input.history_free_days ?? 0
  );
  const historyFreeDays = Number.isInteger(rawHistoryFreeDays)
    && rawHistoryFreeDays >= 0 && rawHistoryFreeDays <= 3650
    ? rawHistoryFreeDays
    : null;
  const requestedPlan = String(input.planSlug || '').trim();
  const planSlug = requestedPlan ? readSlug(requestedPlan) : null;
  const referralRewardStars = readOptionalReward(
    input.referralRewardStars !== undefined
      ? input.referralRewardStars : input.referral_reward_stars,
    readStars
  );
  const referralRewardTokens = readOptionalReward(
    input.referralRewardTokens !== undefined
      ? input.referralRewardTokens : input.referral_reward_tokens,
    readTokens
  );
  if (!featureKey || displayName.length < 2 || requestedStars === null
      || !requestedCurrency || requestedTokens === null || durationDays === null
      || historyFreeDays === null
      || referralRewardStars === undefined
      || referralRewardTokens === undefined) {
    return json({ error: 'Règle d’accès invalide.' }, 400);
  }
  if (requestedPlan && !planSlug) {
    return json({ error: 'Le niveau associé à la règle est invalide.' }, 400);
  }
  // Individual Tableaux are a token-only entitlement. Normalize legacy admin
  // input here as well as in the purchase RPC, so the dashboard cannot
  // accidentally publish a second (stars/Paystack) unlock path.
  const isTableaux = featureKey.startsWith('tableaux-')
    && featureKey !== 'tableaux-dechiffrement-plus';
  const requiredStars = isTableaux ? 0 : requestedStars;
  const unlockCurrency = isTableaux ? 'tokens' : requestedCurrency;
  const requiredTokens = isTableaux
    ? Math.max(0, requestedTokens, requestedStars)
    : requestedTokens;
  const result = await client.from('feature_access_rules').upsert({
    feature_key: featureKey, display_name: displayName,
    required_stars: requiredStars, unlock_currency: unlockCurrency,
    required_tokens: requiredTokens, plan_slug: planSlug || null,
    duration_days: durationDays,
    history_free_days: historyFreeDays,
    referral_reward_stars: referralRewardStars,
    referral_reward_tokens: referralRewardTokens,
    enabled: input.enabled !== false, updated_by: user.id,
    updated_at: new Date().toISOString()
  }, { onConflict: 'feature_key' }).select(
    ACCESS_RULE_COLUMNS
  ).single();
  if (result.error && accessRewardColumnsMissing(result.error)) {
    const legacy = await client.from('feature_access_rules').upsert({
      feature_key: featureKey, display_name: displayName,
      required_stars: requiredStars, unlock_currency: unlockCurrency,
      required_tokens: requiredTokens, plan_slug: planSlug || null,
      duration_days: durationDays, history_free_days: historyFreeDays,
      enabled: input.enabled !== false, updated_by: user.id,
      updated_at: new Date().toISOString()
    }, { onConflict: 'feature_key' }).select(
      LEGACY_ACCESS_RULE_COLUMNS
    ).single();
    if (!legacy.error) {
      return json({
        ok: true,
        action: 'access-rule-saved',
        warning: 'La règle est enregistrée, mais la récompense par règle nécessite SUPABASE_AFFILIATE_REWARDS_BY_ACCESS.sql.',
        rule: {
          ...legacy.data,
          referral_reward_stars: null,
          referral_reward_tokens: null
        }
      });
    }
  }
  if (result.error) throw result.error;
  return json({ ok: true, action: 'access-rule-saved', rule: result.data });
}

async function deleteFeatureRule(client: Client, user: User, input: RecordJson) {
  const featureKey = readSlug(input.featureKey || input.key, 60);
  if (!featureKey) return json({ error: 'Identifiant de règle invalide.' }, 400);
  const result = await client
    .from('feature_access_rules')
    .delete()
    .eq('feature_key', featureKey)
    .select('feature_key')
    .maybeSingle();
  if (result.error) throw result.error;
  await client.from('admin_audit_events').insert({
    actor_user_id: user.id,
    action: 'delete-access-rule',
    payload: { featureKey, deleted: Boolean(result.data) }
  });
  return json({
    ok: true,
    action: 'access-rule-deleted',
    featureKey,
    deleted: Boolean(result.data)
  });
}

async function deleteEarlyAccessRule(client: Client, user: User, input: RecordJson) {
  const featureKey = readSlug(input.featureKey || input.key, 60);
  if (!featureKey) return json({ error: 'Identifiant de règle anticipée invalide.' }, 400);
  const result = await client
    .from('feature_early_access_rules')
    .delete()
    .eq('feature_key', featureKey)
    .select('feature_key')
    .maybeSingle();
  if (result.error) throw result.error;
  await client.from('admin_audit_events').insert({
    actor_user_id: user.id,
    action: 'delete-early-access-rule',
    payload: { featureKey, deleted: Boolean(result.data) }
  });
  return json({
    ok: true,
    action: 'early-access-rule-deleted',
    featureKey,
    deleted: Boolean(result.data)
  });
}

async function createProgram(client: Client, user: User, input: RecordJson) {
  const program = readProgram(input.program);
  const displayName = readText(input.displayName || input.nom, 80);
  const sourceTemplate = readProgram(
    input.sourceTemplate || input.modele || 'universelle'
  );
  const visualTemplate = readProgram(
    input.visualTemplate || input.visual_template || sourceTemplate
  );
  const schedules = Array.isArray(input.schedules)
    ? input.schedules.map((item) => String(item).trim())
      .filter((item) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item)).slice(0, 24)
    : [];
  const theme = readTheme(input.theme || {
    background: input.background, accent: input.accent, text: input.text
  });
  const rule = readRule(input.rule);
  const tests = readTests(input.tests);
  if (!program || BUILT_IN_PROGRAMS.has(program)) {
    return json({ error: 'Identifiant de nouveau programme invalide ou déjà réservé.' }, 400);
  }
  if (displayName.length < 2) {
    return json({ error: 'Le nom du nouveau programme est obligatoire.' }, 400);
  }
  if (!BUILT_IN_PROGRAMS.has(sourceTemplate)) {
    return json({ error: 'Le modèle de programme est invalide.' }, 400);
  }
  if (!BUILT_IN_PROGRAMS.has(visualTemplate)) {
    return json({ error: 'Le modèle visuel du programme est invalide.' }, 400);
  }
  if (!theme) {
    return json({ error: 'Les couleurs doivent être au format hexadécimal (#RRGGBB).' }, 400);
  }
  if (!rule || !tests) {
    return json({ error: 'La règle doit être un objet JSON et les tests un tableau JSON.' }, 400);
  }
  const errors = [
    ...validateRule(sourceTemplate, rule),
    ...validateTests(sourceTemplate, rule, tests),
    ...executeRuleTests(sourceTemplate, rule, tests)
  ];
  if (errors.length) return json({ error: errors.join(' ') }, 400);

  const existing = await client.from('program_catalog')
    .select('program_key').eq('program_key', program).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return json({ error: 'Ce programme existe déjà.' }, 409);

  const now = new Date().toISOString();
  const catalog = await client.from('program_catalog').insert({
    program_key: program, display_name: displayName,
    function_name: `calcul-${program}`, source_template: sourceTemplate,
    visual_template: visualTemplate,
    schedules, theme, enabled: false, created_by: user.id,
    created_at: now, updated_at: now
  }).select(
    'program_key,display_name,function_name,source_template,visual_template,schedules,theme,enabled,created_by,created_at,updated_at,published_at'
  ).single();
  if (catalog.error) throw catalog.error;

  let control;
  try {
    control = await client.from('program_method_controls').insert({
      program_key: program, version: 1, status: 'draft',
      instructions: readInstructions(input.instructions), rule, tests,
      updated_by: user.id, created_at: now, updated_at: now
    }).select(
      'id,program_key,version,status,instructions,rule,tests,updated_by,created_at,updated_at,published_at'
    ).single();
    if (control.error) throw control.error;
  } catch (error) {
    // Do not leave an unusable catalogue row when version 1 could not be
    // created. This is the most common failure during a partial migration.
    const rollback = await client.from('program_catalog')
      .delete().eq('program_key', program);
    if (rollback.error) {
      console.error('admin-method-control program rollback failed', rollback.error);
    }
    throw error;
  }
  return json({
    ok: true, action: 'program-created', program: catalog.data, control: control.data,
    message: 'Nouveau programme créé en brouillon. Testez-le avant publication.'
  }, 201);
}

async function saveDraft(client: Client, user: User, input: RecordJson) {
  const program = readProgram(input.program);
  const rule = readRule(input.rule);
  const tests = readTests(input.tests);
  if (!program) return json({ error: 'Programme invalide.' }, 400);
  if (!rule) return json({ error: 'La règle doit être un objet JSON.' }, 400);
  if (!tests) return json({ error: 'Les tests doivent être un tableau JSON de 100 éléments maximum.' }, 400);
  const catalog = await client.from('program_catalog')
    .select('source_template').eq('program_key', program).maybeSingle();
  if (catalog.error) throw catalog.error;
  const template = catalog.data?.source_template || program;
  const errors = [
    ...validateRule(template, rule),
    ...validateTests(template, rule, tests),
    ...executeRuleTests(template, rule, tests)
  ];
  if (errors.length) return json({ error: errors.join(' ') }, 400);

  const latest = await client.from('program_method_controls')
    .select('version').eq('program_key', program)
    .order('version', { ascending: false }).limit(1).maybeSingle();
  if (latest.error) throw latest.error;
  const version = Number(latest.data?.version || 0) + 1;
  const inserted = await client.from('program_method_controls').insert({
    program_key: program, version, status: 'draft',
    instructions: readInstructions(input.instructions), rule, tests,
    updated_by: user.id
  }).select(
    'id,program_key,version,status,instructions,rule,tests,updated_by,created_at,updated_at,published_at'
  ).single();
  if (inserted.error) throw inserted.error;
  return json({ ok: true, action: 'draft-saved', control: inserted.data }, 201);
}

async function testDraft(client: Client, input: RecordJson) {
  const program = readProgram(input.program);
  const rule = readRule(input.rule);
  const tests = readTests(input.tests);
  if (!program) return json({ error: 'Programme invalide.' }, 400);
  if (!rule) return json({ error: 'La règle doit être un objet JSON.' }, 400);
  if (!tests) return json({ error: 'Les tests doivent être un tableau JSON de 100 éléments maximum.' }, 400);
  const catalog = await client.from('program_catalog')
    .select('source_template').eq('program_key', program).maybeSingle();
  if (catalog.error) throw catalog.error;
  const template = catalog.data?.source_template || program;
  const errors = [
    ...validateRule(template, rule),
    ...validateTests(template, rule, tests),
    ...executeRuleTests(template, rule, tests)
  ];
  return json({
    ok: !errors.length, action: 'test', programme: program,
    testsRecus: tests.length, testsValides: errors.length ? 0 : tests.length,
    erreurs: errors, pretPourPublication: !errors.length
  }, errors.length ? 400 : 200);
}

async function publish(client: Client, user: User, input: RecordJson) {
  const program = readProgram(input.program);
  const version = Number(input.version);
  if (!program || !Number.isInteger(version) || version < 1) {
    return json({ error: 'Programme ou version invalide.' }, 400);
  }
  const target = await client.from('program_method_controls')
    .select('id,program_key,version,status,instructions,rule,tests,updated_by,created_at,updated_at,published_at')
    .eq('program_key', program).eq('version', version).maybeSingle();
  if (target.error) throw target.error;
  if (!target.data) return json({ error: 'Version introuvable.' }, 404);

  const rule = readRule(target.data.rule);
  const tests = readTests(target.data.tests);
  if (!rule || !tests) return json({ error: 'La version enregistrée est invalide.' }, 400);
  const catalogForValidation = await client.from('program_catalog')
    .select('source_template').eq('program_key', program).maybeSingle();
  if (catalogForValidation.error) throw catalogForValidation.error;
  const template = catalogForValidation.data?.source_template || program;
  const errors = [
    ...validateRule(template, rule),
    ...validateTests(template, rule, tests),
    ...executeRuleTests(template, rule, tests)
  ];
  if (errors.length) return json({ error: errors.join(' ') }, 400);

  const now = new Date().toISOString();
  const previousPublished = await client.from('program_method_controls')
    .select('id,status,published_at,updated_by')
    .eq('program_key', program).eq('status', 'published');
  if (previousPublished.error) throw previousPublished.error;

  const restorePublishedState = async () => {
    const targetRestore = await client.from('program_method_controls')
      .update({
        status: target.data.status,
        published_at: target.data.published_at || null,
        updated_by: target.data.updated_by,
        updated_at: now
      }).eq('id', target.data.id);
    if (targetRestore.error) {
      console.error('admin-method-control publish target rollback failed', targetRestore.error);
    }
    for (const previous of previousPublished.data || []) {
      const restore = await client.from('program_method_controls')
        .update({
          status: 'published',
          published_at: previous.published_at || null,
          updated_by: previous.updated_by,
          updated_at: now
        }).eq('id', previous.id);
      if (restore.error) {
        console.error('admin-method-control published version rollback failed', restore.error);
      }
    }
  };

  const archived = await client.from('program_method_controls')
    .update({ status: 'archived', updated_at: now })
    .eq('program_key', program).eq('status', 'published');
  if (archived.error) throw archived.error;
  let published;
  try {
    published = await client.from('program_method_controls').update({
      status: 'published', updated_by: user.id, updated_at: now, published_at: now
    }).eq('id', target.data.id).select(
      'id,program_key,version,status,instructions,rule,tests,updated_by,created_at,updated_at,published_at'
    ).single();
    if (published.error) throw published.error;

    const catalog = await client.from('program_catalog').update({
      enabled: true, updated_at: now, published_at: now
    }).eq('program_key', program);
    if (catalog.error) throw catalog.error;
  } catch (error) {
    await restorePublishedState();
    throw error;
  }

  return json({
    ok: true, action: 'published', control: published.data,
    message: 'La règle est publiée. Les fonctions serveur peuvent maintenant la lire.'
  });
}

async function deleteProgram(client: Client, user: User, input: RecordJson) {
  const program = readProgram(input.program);
  if (!program || BUILT_IN_PROGRAMS.has(program)) {
    return json({
      error: 'Seules les clés personnalisées peuvent être supprimées.'
    }, 400);
  }

  const existing = await client.from('program_catalog')
    .select('program_key,display_name,function_name,source_template,schedules,theme,enabled,created_by,created_at,updated_at,published_at')
    .eq('program_key', program)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) return json({ error: 'Programme introuvable.' }, 404);

  const controls = await client.from('program_method_controls')
    .delete()
    .eq('program_key', program);
  if (controls.error) throw controls.error;

  const deleted = await client.from('program_catalog')
    .delete()
    .eq('program_key', program)
    .select('program_key,display_name')
    .single();
  if (deleted.error) throw deleted.error;

  await client.from('admin_audit_events').insert({
    actor_user_id: user.id,
    action: 'delete-program',
    payload: {
      program,
      displayName: existing.data.display_name,
      historicalArchivesKept: true
    }
  });

  return json({
    ok: true,
    action: 'program-deleted',
    program: deleted.data,
    message: 'La clé personnalisée et ses versions de règles ont été supprimées. Les archives historiques sont conservées.'
  });
}

function normalizeCommentSetting(row: any) {
  return {
    draw_id: String(row.draw_id || ''),
    comments_enabled: row.comments_enabled !== false,
    updated_at: row.updated_at || null
  };
}

async function listCommentSettings(client: Client) {
  const result = await client.from('publication_comment_settings')
    .select('draw_id,comments_enabled,updated_at')
    .order('updated_at', { ascending: false })
    .limit(200);
  // The table only exists after SUPABASE_COMMENT_CONTROL.sql. Keep every
  // other admin action usable during a rolling deployment.
  if (result.error
      && !/relation .* does not exist|publication_comment_settings/i
        .test(String(result.error.message || ''))) {
    throw result.error;
  }
  return (result.error ? [] : (result.data || [])).map(normalizeCommentSetting);
}

async function setCommentCommentsEnabled(client: Client, user: User, input: RecordJson) {
  const drawId = readDrawId(input.drawId);
  if (!drawId) {
    return json({
      error: 'Identifiant de publication invalide (ex. "cross:2026-08-17").'
    }, 400);
  }
  const enabled = input.enabled !== false;
  const now = new Date().toISOString();
  const result = await client.from('publication_comment_settings')
    .upsert({
      draw_id: drawId,
      comments_enabled: enabled,
      updated_by: user.id,
      updated_at: now
    }, { onConflict: 'draw_id' })
    .select('draw_id,comments_enabled,updated_at')
    .single();
  if (result.error) throw result.error;
  await client.from('admin_audit_events').insert({
    actor_user_id: user.id,
    action: 'set-comments-enabled',
    payload: { drawId, comments_enabled: enabled }
  });
  return json({
    ok: true,
    action: 'comments-enabled-set',
    setting: normalizeCommentSetting(result.data),
    message: enabled
      ? 'Les commentaires sont réactivés pour cette publication.'
      : 'Les commentaires sont désactivés pour cette publication.'
  });
}

// Clé de règle de commentaire : 'global', une catégorie ('cross', 'matrix',
// 'rejected', 'tableaux', 'schedule') ou une publication précise
// ('cross:2026-08-17').
function readCommentRuleKey(value: unknown) {
  const key = String(value || '').trim();
  if (key === 'global') return 'global';
  if (/^[a-z][a-z0-9_-]{1,30}$/i.test(key)) return key.toLowerCase();
  if (/^[a-z][a-z0-9_-]{1,30}:\d{4}-\d{2}-\d{2}$/i.test(key)) return key;
  return '';
}

function normalizeCommentRule(row: any) {
  return {
    key: String(row.draw_id || ''),
    comments_enabled: row.comments_enabled !== false,
    updated_at: row.updated_at || null
  };
}

// Enregistre une règle de commentaire global, par catégorie ou par publication.
// Une publication précise prime sur sa catégorie, qui prime sur le global.
async function saveCommentRule(client: Client, user: User, input: RecordJson) {
  const key = readCommentRuleKey(input.key ?? input.drawId);
  if (!key) {
    return json({ error: 'Clé invalide : "global", une catégorie ou "type:AAAA-MM-JJ".' }, 400);
  }
  const enabled = input.enabled !== false;
  const now = new Date().toISOString();
  const result = await client.from('publication_comment_settings')
    .upsert({ draw_id: key, comments_enabled: enabled, updated_by: user.id, updated_at: now },
      { onConflict: 'draw_id' })
    .select('draw_id,comments_enabled,updated_at')
    .single();
  if (result.error) throw result.error;
  await client.from('admin_audit_events').insert({
    actor_user_id: user.id, action: 'save-comment-rule',
    payload: { key, comments_enabled: enabled }
  }).catch(() => {});
  return json({
    ok: true, action: 'comment-rule-saved', rule: normalizeCommentRule(result.data),
    message: enabled
      ? `Commentaires activés (${key}).`
      : `Commentaires désactivés (${key}).`
  });
}

// Supprime une règle : la publication, la catégorie ou le global revient au
// comportement par défaut (priorité dégradée vers le niveau moins précis).
async function deleteCommentRule(client: Client, user: User, input: RecordJson) {
  const key = readCommentRuleKey(input.key ?? input.drawId);
  if (!key) return json({ error: 'Clé de règle invalide.' }, 400);
  const result = await client.from('publication_comment_settings')
    .delete().eq('draw_id', key)
    .select('draw_id,comments_enabled,updated_at')
    .single();
  if (result.error && !/PGRST116|results in 0 rows/i.test(String(result.error.code || '') + String(result.error.message || ''))) {
    throw result.error;
  }
  await client.from('admin_audit_events').insert({
    actor_user_id: user.id, action: 'delete-comment-rule', payload: { key }
  }).catch(() => {});
  return json({ ok: true, action: 'comment-rule-deleted', key });
}

function normalizeContentLock(row: any) {
  return {
    id: Number(row.id),
    target_type: String(row.target_type || 'cross'),
    target_key: String(row.target_key || ''),
    country_code: String(row.country_code || ''),
    unlock_currency: String(row.unlock_currency || 'stars'),
    required_stars: Number(row.required_stars) || 0,
    required_tokens: Number(row.required_tokens) || 0,
    plan_slug: String(row.plan_slug || ''),
    enabled: row.enabled !== false,
    updated_at: row.updated_at || null
  };
}

// Place un contenu (croix, matrice, rejetés, tableaux ou catégorie) sous
// restriction d'abonnement ou de jetons, éventuellement filtré par pays.
async function saveContentLock(client: Client, user: User, input: RecordJson) {
  const id = Number(input.id) || 0;
  const targetType = String(input.targetType ?? input.target_type ?? '').trim().toLowerCase();
  if (!['cross', 'matrix', 'rejected', 'tableaux', 'category'].includes(targetType)) {
    return json({ error: 'Type de cible invalide (cross, matrix, rejected, tableaux, category).' }, 400);
  }
  const requestedCurrency = String(
    input.unlockCurrency ?? input.unlock_currency ?? 'stars'
  ).trim().toLowerCase();
  const unlockCurrency = ['stars', 'tokens'].includes(requestedCurrency)
    ? requestedCurrency : '';
  const targetKey = readText(input.targetKey ?? input.target_key, 40);
  const rawCountryCode = input.countryCode ?? input.country_code;
  const countryCode = rawCountryCode === undefined
    ? ''
    : readCountryCode(rawCountryCode);
  const rawPlanSlug = input.planSlug ?? input.plan_slug;
  const requestedPlanSlug = String(rawPlanSlug ?? '').trim();
  const planSlug = requestedPlanSlug ? readSlug(requestedPlanSlug) : '';
  const rawStars = input.requiredStars ?? input.required_stars;
  const rawTokens = input.requiredTokens ?? input.required_tokens;
  const requiredStars = rawStars === undefined ? 0 : readStars(rawStars);
  const requiredTokens = rawTokens === undefined ? 0 : readTokens(rawTokens);
  const enabled = input.enabled !== false;
  if (!unlockCurrency || requiredStars === null || requiredTokens === null
      || (rawCountryCode !== undefined && rawCountryCode !== '' && !countryCode)
      || (requestedPlanSlug && !planSlug)
      || (requiredStars === 0 && requiredTokens === 0 && !planSlug)) {
    return json({
      error: 'Verrou invalide : devise, montant ou niveau d’abonnement valide requis.'
    }, 400);
  }
  const now = new Date().toISOString();
  let result;
  if (id > 0) {
    result = await client.from('content_locks')
      .update({
        target_type: targetType, target_key: targetKey, country_code: countryCode,
        unlock_currency: unlockCurrency, required_stars: requiredStars,
        required_tokens: requiredTokens, plan_slug: planSlug, enabled,
        updated_by: user.id, updated_at: now
      }).eq('id', id)
      .select('id,target_type,target_key,country_code,unlock_currency,required_stars,required_tokens,plan_slug,enabled,updated_at')
      .single();
  } else {
    result = await client.from('content_locks')
      .insert({
        target_type: targetType, target_key: targetKey, country_code: countryCode,
        unlock_currency: unlockCurrency, required_stars: requiredStars,
        required_tokens: requiredTokens, plan_slug: planSlug, enabled,
        created_by: user.id, updated_by: user.id, updated_at: now
      })
      .select('id,target_type,target_key,country_code,unlock_currency,required_stars,required_tokens,plan_slug,enabled,updated_at')
      .single();
  }
  if (result.error) throw result.error;
  await client.from('admin_audit_events').insert({
    actor_user_id: user.id, action: 'save-content-lock',
    payload: { id: Number(result.data.id), targetType, targetKey, countryCode }
  }).catch(() => {});
  return json({ ok: true, action: 'content-lock-saved', lock: normalizeContentLock(result.data) });
}

async function deleteContentLock(client: Client, user: User, input: RecordJson) {
  const id = Number(input.id) || 0;
  if (!id) return json({ error: 'Identifiant de verrou requis.' }, 400);
  const result = await client.from('content_locks')
    .delete().eq('id', id)
    .select('id,updated_at').single();
  if (result.error && !/PGRST116|results in 0 rows/i.test(String(result.error.code || '') + String(result.error.message || ''))) {
    throw result.error;
  }
  await client.from('admin_audit_events').insert({
    actor_user_id: user.id, action: 'delete-content-lock', payload: { id }
  }).catch(() => {});
  return json({ ok: true, action: 'content-lock-deleted', id });
}

async function handler(request: Request) {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);

  let input: RecordJson;
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json({ error: 'Le corps doit être un objet JSON.' }, 400);
    }
    input = body as RecordJson;
  } catch (_) {
    return json({ error: 'Le corps de la requête doit être un JSON valide.' }, 400);
  }

  try {
    const auth = await authenticateAdmin(request);
    if (auth.error || !auth.client || !auth.user) {
      return json({ error: auth.error || 'Accès administrateur refusé.' }, 403);
    }
    const action = String(input.action || 'list').trim().toLowerCase();
    if (!canRunAction(auth, action)) {
      return json({ error: 'Cette action n’est pas incluse dans vos permissions administrateur.' }, 403);
    }
    if (action === 'list') {
      return json({
        ok: true,
        controls: await listControls(auth.client),
        programs: await listPrograms(auth.client),
        modules: await listModules(auth.client),
        methods: listMethods()
      });
    }
    if (action === 'list-dashboard-modules') {
      return json({ ok: true, modules: await listModules(auth.client) });
    }
    if (action === 'list-admin-config') {
      return json({ ok: true, ...(await listAdminConfig(auth.client)) });
    }
    if (action === 'list-balsa-program') {
      return readBalsaProgram(auth.client, input);
    }
    if (action === 'list-valid-numbers') {
      return readValidNumbers(auth.client, input);
    }
    if (action === 'list-access') {
      return json({ ok: true, access: await listAccess(auth.client) });
    }
    if (action === 'list-promo-banners') {
      return json({ ok: true, banners: await listPromoBanners(auth.client) });
    }
    if (action === 'list-referral-settings') {
      return json({ ok: true, settings: await readReferralSettings(auth.client) });
    }
    if (action === 'save-referral-settings') {
      return saveReferralSettings(auth.client, auth.user, input);
    }
    if (action === 'save-access-plan') return saveAccessPlan(auth.client, auth.user, input);
    if (action === 'delete-access-plan') return deleteAccessPlan(auth.client, auth.user, input);
    if (action === 'save-promo-banner') {
      return savePromoBanner(auth.client, auth.user, input);
    }
    if (action === 'delete-promo-banner') {
      return deletePromoBanner(auth.client, input);
    }
    if (action === 'save-access-rule') return saveFeatureRule(auth.client, auth.user, input);
    if (action === 'delete-access-rule') return deleteFeatureRule(auth.client, auth.user, input);
    if (action === 'save-early-access-rule') {
      return saveEarlyAccessRule(auth.client, auth.user, input);
    }
    if (action === 'delete-early-access-rule') {
      return deleteEarlyAccessRule(auth.client, auth.user, input);
    }
    if (action === 'save-payment-settings') return savePaymentSettings(auth.client, auth.user, input);
    if (action === 'save-star-price') return saveStarPrice(auth.client, auth.user, input);
    if (action === 'delete-star-price') return deleteStarPrice(auth.client, input);
    if (action === 'save-token-price') return saveTokenPrice(auth.client, auth.user, input);
    if (action === 'delete-token-price') return deleteTokenPrice(auth.client, input);
    if (action === 'search-users') return searchUsers(auth.client, input);
    if (action === 'grant-balance') return grantBalance(auth.client, auth.user, input);
    if (action === 'grant-stars') return grantStars(auth.client, auth.user, input);
    if (action === 'grant-subscription') return grantSubscription(auth.client, auth.user, input);
    if (action === 'create-program') return createProgram(auth.client, auth.user, input);
    if (action === 'save-draft') return saveDraft(auth.client, auth.user, input);
    if (action === 'test') return testDraft(auth.client, input);
    if (action === 'publish') return publish(auth.client, auth.user, input);
    if (action === 'delete-program') return deleteProgram(auth.client, auth.user, input);
    if (action === 'preview-program') return previewProgram(auth.client, input);
    if (action === 'duplicate-program') return duplicateProgram(auth.client, auth.user, input);
    if (action === 'save-admin') return saveAdminUser(auth.client, auth.user, input);
    if (action === 'delete-admin') return deleteAdminUser(auth.client, auth.user, input);
    if (action === 'save-draw-source') return saveDrawSource(auth.client, auth.user, input);
    if (action === 'delete-draw-source') return deleteDrawSource(auth.client, auth.user, input);
    if (action === 'generate-draw-source') return generateDrawSource(auth.client, auth.user, input);
    if (action === 'list-cross-generations') return listCrossGenerations(auth.client);
    if (action === 'delete-cross-generation') {
      return deleteCrossGeneration(auth.client, auth.user, input);
    }
    if (action === 'list-comment-settings') {
      return json({ ok: true, settings: await listCommentSettings(auth.client) });
    }
    if (action === 'set-comments-enabled') {
      return setCommentCommentsEnabled(auth.client, auth.user, input);
    }
    if (action === 'save-comment-rule') {
      return saveCommentRule(auth.client, auth.user, input);
    }
    if (action === 'delete-comment-rule') {
      return deleteCommentRule(auth.client, auth.user, input);
    }
    if (action === 'save-content-lock') {
      return saveContentLock(auth.client, auth.user, input);
    }
    if (action === 'delete-content-lock') {
      return deleteContentLock(auth.client, auth.user, input);
    }
    return json({ error: 'Action inconnue.' }, 400);
  } catch (error) {
    console.error('admin-method-control failed', error);
    const message = String((error as any)?.message || '').trim();
    return json({
      error: message && message.length <= 320
        ? message
        : 'Le contrôle administrateur est indisponible.'
    }, 500);
  }
}

Deno.serve(handler);
