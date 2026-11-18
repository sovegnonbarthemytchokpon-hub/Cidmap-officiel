/*
 * Supabase Edge Function: smart-processor
 *
 * Programme public de la Croix nationale.
 *
 * Le calcul reste côté serveur : la clé service_role n'est jamais envoyée au
 * navigateur. Une ligne déjà enregistrée pour la date est toujours renvoyée
 * telle quelle.
 *
 * La publication normale est disponible à 16:00, heure Africa/Abidjan.
 * L'accès anticipé ouvre la fenêtre de dates configurée par l'administration,
 * après paiement et déblocage de chaque publication par l'utilisateur.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  baseEntitlementEndDate,
  hasActiveLegacyEarlyAccess,
  hasEarlyAccessGrant,
  readEarlyAccessRule
} from '../_shared.ts';

type CrossAlignment = {
  slots: number[];
  values: number[];
  sum: number;
  finishingDigit: number;
};

type CrossRecordRow = {
  id: number;
  programme_date: string;
  generated_year: number;
  generated_month: number;
  scope_key: string;
  term: string;
  removed_digits: string[];
  visible_terminaison: string;
  date_sum: number;
  date_digit_sum: number;
  date_finishing_digit: number;
  assignment: string[];
  alignments: CrossAlignment[];
  signature: string;
  created_at: string;
};

type RequestBody = {
  date?: unknown;
  scope?: unknown;
};

const TIME_ZONE = 'Africa/Abidjan';
const PROGRAM_RELEASE_HOUR = 16;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const LINE_GROUPS = [
  [1, 2, 4],
  [3, 2, 8],
  [4, 6, 7]
];

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

function getAdminClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Les variables SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont absentes.'
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

/* ---------------- Contrôle d'accès serveur ---------------- */

function canonicalFeatureKey(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function planIncludesFeature(plan: any, featureKey: string): boolean {
  const wanted = canonicalFeatureKey(featureKey);
  const features = Array.isArray(plan?.features)
    ? plan.features.map(canonicalFeatureKey)
    : [];
  return features.includes(wanted) || features.includes('tableaux');
}

function missingAccessTables(error: any): boolean {
  return String(error?.code || '') === '42P01'
    || /subscription_plans|feature_access_rules|user_subscriptions|user_feature_unlocks|user_feature_early_access|feature_early_access_rules|relation .* does not exist|column .* does not exist|schema cache/i
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

  /*
   * Si le catalogue n'est pas encore installé, la Croix reste publique.
   * La migration d'anticipation, elle, est traitée séparément et ne doit
   * jamais empêcher la publication gratuite normale.
   */
  if (
    missingAccessTables(plansResult.error)
    || missingAccessTables(rulesResult.error)
  ) {
    return null;
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

  if (
    rule
    && !rule.plan_slug
    && Number(rule.required_stars || 0) <= 0
    && Number(rule.required_tokens || 0) <= 0
    && !protectedByOffer
  ) {
    return null;
  }

  if (!rule && !protectedByOffer) {
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
    .in('role', ['admin', 'moderator'])
    .limit(1)
    .maybeSingle();

  if (
    !adminRole.error
    && ['admin', 'moderator'].includes(String(adminRole.data?.role))
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
  const individualUnlock = await client
    .from('user_feature_unlocks')
    .select('feature_key,expires_at')
    .eq('user_id', userId)
    .eq('feature_key', wanted)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .limit(1)
    .maybeSingle();
  if (individualUnlock.error) {
    if (!missingAccessTables(individualUnlock.error)) {
      throw individualUnlock.error;
    }
  } else if (individualUnlock.data) {
    // An individual programme unlock is independent from the collective
    // offer. Disabling or expiring that offer must not close this feature.
    return null;
  }

  const subscription = await client
    .from('user_subscriptions')
    .select('plan_slug,status,started_at,expires_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .lte('started_at', now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .maybeSingle();

  if (subscription.error) {
    if (missingAccessTables(subscription.error)) {
      return null;
    }
    throw subscription.error;
  }

  const plan = allPlans.find(
    (item: any) => item.slug === subscription.data?.plan_slug
  );

  const allowed = Boolean(plan)
    && (
      planIncludesFeature(plan, wanted)
      || Boolean(
        rule?.plan_slug
        && rule.plan_slug === plan.slug
      )
    );

  return allowed
    ? null
    : json({
        error: 'Cette section nécessite un abonnement actif.'
      }, 403);
}

/*
 * Contrôle de publication :
 * - la date normale conserve le comportement de la version fonctionnelle ;
 * - à partir de 16:00, la date suivante est disponible uniquement pour un
 *   utilisateur qui a débloqué l'anticipation ;
 * - si aucune règle n'est activée, aucun accès anticipé n'est accordé.
 */
async function enforceEarlyAccess(
  request: Request,
  featureKey: string,
  programmeDate: string
): Promise<Response | null> {
  const wanted = canonicalFeatureKey(featureKey);
  if (wanted !== 'croix') return null;

  const client = getAdminClient();
  const ruleResult = await readEarlyAccessRule(client, wanted);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());
  const part = (type: string) =>
    Number(parts.find((item) => item.type === type)?.value);
  const year = part('year');
  const month = part('month');
  const day = part('day');
  const currentHour = part('hour');
  const normalDateObject = new Date(Date.UTC(
    year,
    month - 1,
    day + (currentHour >= PROGRAM_RELEASE_HOUR ? 1 : 0),
    12
  ));
  const normalDate = isoDate(normalDateObject);
  const requestedDateObject = new Date(`${programmeDate}T12:00:00.000Z`);
  const dayOffset = Number.isNaN(requestedDateObject.getTime())
    ? 0
    : Math.floor(
      (requestedDateObject.getTime() - normalDateObject.getTime()) / 86400000
    );
  const isFutureDate = dayOffset > 0;

  if (isFutureDate) {
    const previewToken = request.headers
      .get('Authorization')
      ?.replace(/^Bearer\s+/i, '')
      .trim() || '';
    if (previewToken) {
      const previewSession = await client.auth.getUser(previewToken);
      if (!previewSession.error && previewSession.data?.user?.id) {
        const previewRole = await client
          .from('user_roles')
          .select('role')
          .eq('user_id', previewSession.data.user.id)
          .in('role', ['admin', 'moderator'])
          .limit(1)
          .maybeSingle();
        if (!previewRole.error
            && ['admin', 'moderator'].includes(String(previewRole.data?.role))) {
          return null;
        }
      }
    }
  }

  if (ruleResult.error) {
    if (missingAccessTables(ruleResult.error)) {
      return isFutureDate && currentHour < PROGRAM_RELEASE_HOUR
        ? json({
            error: 'Cette publication sera disponible à 16h.',
            code: 'PUBLIC_RELEASE_NOT_AVAILABLE',
            featureKey: wanted,
            programmeDate,
            releaseHour: PROGRAM_RELEASE_HOUR
          }, 425)
        : isFutureDate
          ? json({
              error: 'Cette publication anticipée n’est pas configurée.',
              code: 'EARLY_ACCESS_DISABLED',
              featureKey: wanted,
              programmeDate
            }, 403)
          : null;
    }
    throw ruleResult.error;
  }

  const isNormalLiveProgramme = programmeDate === normalDate;
  /*
   * Une date historique reste disponible pour les vérifications et l'archive.
   */
  if (!isNormalLiveProgramme && !isFutureDate) {
    return null;
  }

  // Preserve the working normal programme path. Early access only gates the
  // additional future previews and must never hide the normal Croix result.
  if (isNormalLiveProgramme) return null;

  const rule = ruleResult.data;
  if (!rule || rule.enabled !== true) {
    return json({
      error: 'Cette publication anticipée n’est pas activée.',
      code: 'EARLY_ACCESS_DISABLED',
      featureKey: wanted,
      programmeDate
    }, 403);
  }
  const previewDays = Math.max(
    1,
    Math.min(30, Number(rule.preview_days) || 1)
  );
  if (dayOffset > previewDays) {
    return json({
      error: `Cette date dépasse la fenêtre de ${previewDays} jour(s) configurée par l’administration.`,
      code: 'EARLY_ACCESS_OUT_OF_RANGE',
      featureKey: wanted,
      programmeDate,
      previewDays
    }, 403);
  }

  const token = request.headers
    .get('Authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim() || '';
  if (!token) {
    return json({
      error: 'Connectez-vous pour utiliser l’anticipation.',
      code: 'EARLY_ACCESS_REQUIRED',
      featureKey: wanted,
      programmeDate,
      releaseHour: PROGRAM_RELEASE_HOUR,
      requiredTokens: Math.max(1, Number(rule.required_tokens) || 1)
    }, 403);
  }

  const session = await client.auth.getUser(token);
  if (session.error || !session.data?.user?.id) {
    return json({ error: 'Session invalide.' }, 401);
  }

  const role = await client
    .from('user_roles')
    .select('role')
    .eq('user_id', session.data.user.id)
    .in('role', ['admin', 'moderator'])
    .limit(1)
    .maybeSingle();
  if (!role.error && ['admin', 'moderator'].includes(String(role.data?.role))) {
    return null;
  }

  const entitlementEndDate = await baseEntitlementEndDate(
    client,
    session.data.user.id,
    wanted
  );
  if (entitlementEndDate && programmeDate > entitlementEndDate) {
    return json({
      error: 'Votre droit d’accès au programme expire avant cette publication.',
      code: 'BASE_ACCESS_EXPIRES_BEFORE_PROGRAM',
      featureKey: wanted,
      programmeDate,
      entitlementEndDate
    }, 403);
  }

  if (await hasEarlyAccessGrant(
    client,
    session.data.user.id,
    wanted,
    dayOffset
  )) {
    return null;
  }

  if (await hasActiveLegacyEarlyAccess(
    client,
    session.data.user.id,
    wanted,
    normalDate,
    rule
  )) {
    return null;
  }

  const unlock = await client
    .from('user_feature_early_access')
    .select('id')
    .eq('user_id', session.data.user.id)
    .eq('feature_key', wanted)
    .eq('programme_date', programmeDate)
    .maybeSingle();
  if (unlock.error) {
    if (missingAccessTables(unlock.error)) {
      return json({
        error: 'L’accès anticipé n’est pas encore configuré.',
        code: 'EARLY_ACCESS_NOT_CONFIGURED',
        featureKey: wanted,
        programmeDate
      }, 403);
    }
    throw unlock.error;
  }
  if (currentHour < PROGRAM_RELEASE_HOUR && !unlock.data) {
    return json({
      error: 'Cette publication sera disponible à 16h, sauf pour un accès anticipé déjà activé.',
      code: 'PUBLIC_RELEASE_NOT_AVAILABLE',
      featureKey: wanted,
      programmeDate,
      releaseHour: PROGRAM_RELEASE_HOUR
    }, 425);
  }

  return unlock.data
    ? null
    : json({
        error: 'Débloquez cette publication pour la recevoir dès maintenant.',
        code: 'EARLY_ACCESS_REQUIRED',
        featureKey: wanted,
        programmeDate,
        releaseHour: PROGRAM_RELEASE_HOUR,
        requiredTokens: Math.max(1, Number(rule.required_tokens) || 1)
      }, 403);
}

/* ---------------- Génération de la Croix nationale ---------------- */

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function parseDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour')
  };
}

function getProgrammeDate(now = new Date()): string {
  const parts = parseDateParts(now);

  const date = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day + (parts.hour >= PROGRAM_RELEASE_HOUR ? 1 : 0)
  ));

  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate())
  ].join('-');
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    return null;
  }

  const date = new Date(`${value}T12:00:00.000Z`);

  if (Number.isNaN(date.getTime())) return null;
  if (date.toISOString().slice(0, 10) !== value) return null;

  return date;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function digitalRoot(value: number): number {
  let result = Math.abs(Number(value) || 0);

  while (result >= 10) {
    result = String(result)
      .split('')
      .reduce((sum, digit) => sum + Number(digit), 0);
  }

  return result;
}

function dateSignature(date: Date) {
  const day = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();

  const dateText = [
    String(day).padStart(2, '0'),
    String(month).padStart(2, '0'),
    String(year)
  ].join('');

  const dateSum = day + month + String(year)
    .split('')
    .reduce((sum, digit) => sum + Number(digit), 0);

  const dateDigitSum = dateText
    .split('')
    .reduce((sum, digit) => sum + Number(digit), 0);

  return {
    day,
    month,
    year,
    dateSum,
    dateDigitSum,
    dateFinishingDigit: digitalRoot(dateSum),
    serial: Math.floor(date.getTime() / 86400000)
  };
}

function parenthesizedMethod(date: Date) {
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);

  const current = Date.UTC(
    year,
    date.getUTCMonth(),
    date.getUTCDate()
  );

  const dayOfYear = Math.floor((current - start) / 86400000) + 1;
  const counter = ((dayOfYear - 1) % 90) + 1;
  const digits = String(counter).padStart(2, '0').split('');

  if (digits[0] === digits[1] && digits[0] !== '9') {
    const summed = String(
      Number(digits[0]) + Number(digits[1])
    ).padStart(2, '0');

    return {
      term: `(${summed})`,
      removedDigits: [summed[0], summed[1]],
      terminaison: digits[1]
    };
  }

  return {
    term: `(${digits.join('')})`,
    removedDigits: digits,
    terminaison: digits[1]
  };
}

function lineData(assignment: number[]): CrossAlignment[] {
  return LINE_GROUPS.map((slots) => {
    const values = slots.map((slot) => assignment[slot - 1]);
    const sum = values.reduce((total, value) => total + value, 0);

    return {
      slots,
      values,
      sum,
      finishingDigit: digitalRoot(sum)
    };
  });
}

function alignmentSignature(alignments: CrossAlignment[]): string {
  return alignments
    .map((alignment) =>
      alignment.values.slice().sort((a, b) => a - b).join('')
    )
    .join('|');
}

function generateCandidates(
  availableDigits: number[],
  seed: number,
  targetFinishing: number,
  preferredSum: number
) {
  const sorted = availableDigits.slice().sort((a, b) => a - b);

  const offset = (
    (Math.trunc(seed) % sorted.length) + sorted.length
  ) % sorted.length;

  const ordered = sorted
    .slice(offset)
    .concat(sorted.slice(0, offset));

  const slots: number[] = Array(8).fill(0);
  const used = new Set<number>();

  const candidates: Array<{
    assignment: number[];
    alignments: CrossAlignment[];
    signature: string;
    targetScore: number;
    preferredScore: number;
  }> = [];

  function visit(position: number) {
    if (position === slots.length) {
      const alignments = lineData(slots);

      const targetScore = alignments.reduce(
        (score, alignment) =>
          score + (
            alignment.finishingDigit === targetFinishing ? 1 : 0
          ),
        0
      );

      const preferredScore = alignments.reduce(
        (score, alignment) =>
          score + (alignment.sum === preferredSum ? 1 : 0),
        0
      );

      candidates.push({
        assignment: slots.slice(),
        alignments,
        signature: alignmentSignature(alignments),
        targetScore,
        preferredScore
      });

      return;
    }

    for (const digit of ordered) {
      if (used.has(digit)) continue;

      used.add(digit);
      slots[position] = digit;
      visit(position + 1);
      used.delete(digit);
    }
  }

  visit(0);

  candidates.sort((a, b) =>
    b.targetScore - a.targetScore ||
    b.preferredScore - a.preferredScore ||
    a.signature.localeCompare(b.signature)
  );

  return candidates;
}

function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [];
}

function recordFromRow(row: CrossRecordRow) {
  return {
    id: row.id,
    programmeDate: row.programme_date,
    year: row.generated_year,
    month: row.generated_month,
    scope: row.scope_key,
    term: row.term,
    removedDigits: normalizeArray(row.removed_digits),
    dateSum: row.date_sum,
    dateDigitSum: row.date_digit_sum,
    dateFinishingDigit: row.date_finishing_digit,
    dateFinishing: pad(row.date_finishing_digit),
    terminaison: row.visible_terminaison,
    assignment: normalizeArray(row.assignment),
    alignments: row.alignments || [],
    signature: row.signature,
    createdAt: row.created_at
  };
}

async function readByDate(
  admin: ReturnType<typeof getAdminClient>,
  programmeDate: string
) {
  const result = await admin
    .from('croix_nationale_generations')
    .select('*')
    .eq('programme_date', programmeDate)
    .maybeSingle();

  if (result.error) throw result.error;

  return result.data as CrossRecordRow | null;
}

async function generateProgramme(
  admin: ReturnType<typeof getAdminClient>,
  date: Date,
  scope: 'year' | 'month'
) {
  const info = dateSignature(date);
  const programmeDate = isoDate(date);
  const method = parenthesizedMethod(date);

  const scopeKey = scope === 'month'
    ? `M${info.year}-${pad(info.month)}`
    : `Y${info.year}`;

  const existingDate = await readByDate(admin, programmeDate);

  if (existingDate) {
    return {
      reused: true,
      record: recordFromRow(existingDate)
    };
  }

  const signatures = await admin
    .from('croix_nationale_generations')
    .select('signature')
    .eq('scope_key', scopeKey);

  if (signatures.error) throw signatures.error;

  const usedSignatures = new Set(
    (signatures.data || [])
      .map((row: { signature: string }) => row.signature)
  );

  const removed = method.removedDigits.map(Number);
  const available = DIGITS.filter((digit) => !removed.includes(digit));

  const candidates = generateCandidates(
    available,
    info.serial +
      info.dateSum +
      info.dateDigitSum +
      info.dateFinishingDigit,
    info.dateFinishingDigit,
    info.day
  );

  const selected = candidates.find(
    (candidate) => !usedSignatures.has(candidate.signature)
  );

  if (!selected) {
    return {
      reused: false,
      conflict: true
    };
  }

  const inserted = await admin
    .from('croix_nationale_generations')
    .insert({
      programme_date: programmeDate,
      generated_year: info.year,
      generated_month: info.month,
      scope_key: scopeKey,
      term: method.term,
      removed_digits: method.removedDigits,
      visible_terminaison: method.terminaison,
      date_sum: info.dateSum,
      date_digit_sum: info.dateDigitSum,
      date_finishing_digit: info.dateFinishingDigit,
      assignment: selected.assignment.map(String),
      alignments: selected.alignments,
      signature: selected.signature
    })
    .select('*')
    .single();

  if (inserted.error?.code === '23505') {
    const raced = await readByDate(admin, programmeDate);

    if (raced) {
      return {
        reused: true,
        record: recordFromRow(raced)
      };
    }
  }

  if (inserted.error) throw inserted.error;

  return {
    reused: false,
    record: recordFromRow(inserted.data as CrossRecordRow)
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }

  if (request.method !== 'POST') {
    return json({
      error: 'Méthode non autorisée.'
    }, 405);
  }

  try {
    let body: RequestBody = {};

    try {
      body = await request.json() as RequestBody;
    } catch (_) {
      return json({
        error: 'Le corps de la requête doit être un JSON valide.'
      }, 400);
    }

    const requestedDate = body.date == null
      ? getProgrammeDate()
      : String(body.date);

    const date = parseDate(requestedDate);

    if (!date) {
      return json({
        error: 'date doit être une date ISO valide (YYYY-MM-DD).'
      }, 400);
    }

    const denied = await enforceFeatureAccess(request, 'croix');
    if (denied) return denied;

    const earlyDenied = await enforceEarlyAccess(
      request,
      'croix',
      requestedDate
    );
    if (earlyDenied) return earlyDenied;

    const scope = body.scope === 'month' ? 'month' : 'year';
    const admin = getAdminClient();
    const result = await generateProgramme(admin, date, scope);

    if (result.conflict) {
      return json({
        error: 'Aucune combinaison nouvelle disponible pour cette période.',
        programmeDate: isoDate(date),
        scope
      }, 409);
    }

    return json({
      ok: true,
      reused: result.reused,
      record: result.record
    });
  } catch (error) {
    console.error('smart-processor failed', error);

    return json({
      error: 'Impossible de lire ou de générer la Croix nationale.'
    }, 500);
  }
});
