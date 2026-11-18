/*
 * Cidmap translation boundary.
 *
 * There is intentionally one client-side translation runtime. Supabase can
 * override these stable browser phrases through site-config, while this
 * catalogue keeps the public site usable when translation_entries is empty.
 * Technical identifiers, programme keys, URLs and numeric results are never
 * passed through this layer.
 */
(function initTranslationBoundary() {
  'use strict';

  const FALLBACK_LOCALE = 'fr';
  const LOCAL_CATALOGS = {
    fr: '/locales/fr.json',
    en: '/locales/en.json',
    es: '/locales/es.json',
    pt: '/locales/pt.json',
    ar: '/locales/ar.json'
  };
  // The five interface languages. Each one has a complete dictionary in
  // /locales/<code>.json that shares the exact same key set.
  const SUPPORTED_LOCALES = Object.freeze(Object.keys(LOCAL_CATALOGS));
  const RTL_LOCALES = new Set(['ar']);
  const LANGUAGE_STORAGE_KEY = 'cid_i18n_locale';
  const LEGACY_LANGUAGE_STORAGE_KEY = 'userLang';
  const AUTO_LOCALE = 'auto';

  /*
   * Dynamic views still contain a few legacy French source phrases because
   * they are rendered after the initial HTML pass. Keep one alias boundary
   * here so the Supabase catalogue can translate those phrases by their
   * stable keys as well. This also lets the MutationObserver translate
   * attributes and fragments created by older modules without each module
   * inventing a second i18n runtime.
   */
  const SOURCE_KEY_ALIASES = Object.freeze({
    'Chargement des publications…': 'feed.loading',
    'Chargement des publications...': 'feed.loading',
    'Aucune publication disponible.': 'feed.empty',
    'J’aime': 'feed.like',
    'Commenter': 'feed.comment',
    'Commentaires': 'feed.comments',
    'Partager': 'feed.share',
    'partages': 'feed.shares',
    'Partager cette publication': 'feed.shareThis',
    'Sur mon profil': 'feed.onProfile',
    'Par message': 'feed.byMessage',
    'Copier le lien': 'feed.copyLink',
    'Les commentaires sont désactivés sur cette publication.': 'feed.commentsDisabled',
    'Chargement des commentaires…': 'feed.loadingComments',
    'Chargement des commentaires...': 'feed.loadingComments',
    'Les commentaires sont indisponibles pour le moment.': 'feed.commentsUnavailable',
    'Tirer pour actualiser': 'feed.pullToRefresh',
    'Actualisation...': 'feed.refreshing',
    'Relâchez pour actualiser': 'feed.releaseToRefresh',
    'Commentez…': 'feed.writeComment',
    'Écrivez un commentaire…': 'feed.writeComment',
    'Publier le commentaire': 'feed.postComment',
    'Aucun commentaire': 'feed.noComments',

    'Chargement des tableaux': 'tableaux.loading',
    'Vos tableaux débloqués': 'tableaux.unlocked',
    'Schémas du jour': 'tableaux.dailySchemes',
    'Masquer les tableaux verrouillés': 'tableaux.hideLocked',
    'Découvrir les autres tableaux': 'tableaux.discoverOther',
    'Programmes personnalisés': 'tableaux.createdPrograms',
    'Modèle visuel': 'tableaux.visualModel',
    'Grille de numéros en cours de configuration par l’administrateur.': 'tableaux.adminConfiguring',
    'Confirmation d’achat': 'tableaux.confirmation',
    'Ce déblocage concerne uniquement ce tableau.': 'tableaux.onlyThisTable',
    'Accès requis': 'tableaux.accessRequired',
    'Débloquer': 'tableaux.unlock',

    'Ouvrir les notifications': 'notifications.open',
    'Toutes': 'notifications.all',
    'Non lues': 'notifications.unread',
    'Tout marquer comme lu': 'notifications.markAllRead',
    'Aucune notification': 'notifications.empty',
    'Vous êtes à jour.': 'notifications.upToDate',
    'À l’instant': 'notifications.justNow',

    'Télécharger la croix': 'croix.download',
    'Copier l’image de la croix': 'croix.copyImage',
    "Copier l'image de la croix": 'croix.copyImage',
    'Couleurs de la Croix (par jour)': 'croix.colorsByDay',
    'Générer la clé': 'croix.generateKey',
    'Copier la clé': 'croix.copyKey',
    'Votre clé du jour': 'croix.dailyKey',
    'CROIX': 'croix.cross',

    'Compte': 'account.title',
    'Connexion': 'account.login',
    'Déconnexion': 'account.logout',
    'Créer un compte': 'account.signup',
    'Compte vérifié': 'account.verified',
    'Pays': 'account.country',
    'Langue': 'account.language',
    'Abonnement': 'account.subscription',
    'Forfait': 'account.plan',
    'Actif': 'account.active',
    'Expiré': 'account.expired',
    'Aucun abonnement actif': 'account.noSubscription',
    'Mode public': 'account.publicMode',
    'Accès privé': 'account.privateAccess',
    'Solde': 'account.balance',
    'Étoiles': 'account.stars',
    'Jetons': 'account.tokens',
    'étoile': 'balance.starSingular',
    'étoiles': 'balance.starPlural',
    'jeton': 'balance.tokenSingular',
    'jetons': 'balance.tokenPlural',
    'Inviter un proche': 'account.invite',
    'Lien personnel': 'account.personalLink',
    'Copié': 'account.copied',

    'Paiement': 'payment.title',
    'Configuration du paiement': 'payment.configuration',
    'Choisir le mode de paiement': 'payment.chooseMethod',
    'Paiement manuel': 'payment.manual',
    'Paiement en ligne': 'payment.online',
    'Paiement par Paystack': 'payment.paystack',
    'Montant': 'payment.amount',
    'Quantité': 'payment.quantity',
    'Total': 'payment.total',
    'Confirmer le paiement': 'payment.confirm',
    'Redirection vers le paiement...': 'payment.redirecting',
    'Paiement en attente de confirmation.': 'payment.pending',
    'Paiement effectué avec succès.': 'payment.success',
    'Le paiement a échoué.': 'payment.failed',
    'Le paiement est momentanément indisponible.': 'payment.unavailable',

    'Tableau administrateur': 'admin.title',
    'Vue d’ensemble': 'admin.overview',
    'Vue d\'ensemble': 'admin.overview',
    'Accès anticipé': 'admin.earlyAccess',
    'Contrôle avancé': 'admin.advancedControl',
    'Promotions': 'admin.promotions',
    'Espace protégé': 'admin.protectedArea',
    'Supabase connecté': 'admin.supabaseConnected'
  });

  const plural = (count, one, many) => (count === '1' ? one : many);
  // Patterns wrapping a variable part (date, number, name). Static phrases
  // live in the JSON dictionaries; only these templates need code.
  const DYNAMIC_PHRASES = Object.freeze({
    en: [
      [/^Terminaison\s+(.+)$/i, (m) => `Terminal ${m[1]}`],
      [/^Croix nationale pour le (.+)$/i, (m) => `National Cross for ${m[1]}`],
      [/^Programme\s+(.+)$/i, (m) => `Programme ${m[1]}`],
      [/^Copier\s+(.+)$/i, (m) => `Copy ${m[1]}`],
      [/^Grille du\s+(.+)\s+chargée\.$/i, (m) => `Grid for ${m[1]} loaded.`],
      [/^Dernière lecture\s*:\s*(.+)$/i, (m) => `Last read: ${m[1]}`],
      [/^(\d+)\s+jetons?$/i, (m) => `${m[1]} ${plural(m[1], 'token', 'tokens')}`],
      [/^Voir\s+(\d+)\s+commentaires?$/i, (m) => `View ${m[1]} ${plural(m[1], 'comment', 'comments')}`]
    ],
    es: [
      [/^Terminaison\s+(.+)$/i, (m) => `Terminación ${m[1]}`],
      [/^Croix nationale pour le (.+)$/i, (m) => `Cruz nacional para el ${m[1]}`],
      [/^Programme\s+(.+)$/i, (m) => `Programa ${m[1]}`],
      [/^Copier\s+(.+)$/i, (m) => `Copiar ${m[1]}`],
      [/^Grille du\s+(.+)\s+chargée\.$/i, (m) => `Cuadrícula del ${m[1]} cargada.`],
      [/^Dernière lecture\s*:\s*(.+)$/i, (m) => `Última lectura: ${m[1]}`],
      [/^(\d+)\s+jetons?$/i, (m) => `${m[1]} ${plural(m[1], 'ficha', 'fichas')}`],
      [/^Voir\s+(\d+)\s+commentaires?$/i, (m) => `Ver ${m[1]} ${plural(m[1], 'comentario', 'comentarios')}`]
    ],
    pt: [
      [/^Terminaison\s+(.+)$/i, (m) => `Terminação ${m[1]}`],
      [/^Croix nationale pour le (.+)$/i, (m) => `Cruz nacional para o ${m[1]}`],
      [/^Programme\s+(.+)$/i, (m) => `Programa ${m[1]}`],
      [/^Copier\s+(.+)$/i, (m) => `Copiar ${m[1]}`],
      [/^Grille du\s+(.+)\s+chargée\.$/i, (m) => `Grelha de ${m[1]} carregada.`],
      [/^Dernière lecture\s*:\s*(.+)$/i, (m) => `Última leitura: ${m[1]}`],
      [/^(\d+)\s+jetons?$/i, (m) => `${m[1]} ${plural(m[1], 'ficha', 'fichas')}`],
      [/^Voir\s+(\d+)\s+commentaires?$/i, (m) => `Ver ${m[1]} ${plural(m[1], 'comentário', 'comentários')}`]
    ],
    ar: [
      [/^Terminaison\s+(.+)$/i, (m) => `النهاية ${m[1]}`],
      [/^Croix nationale pour le (.+)$/i, (m) => `الصليب الوطني ليوم ${m[1]}`],
      [/^Programme\s+(.+)$/i, (m) => `برنامج ${m[1]}`],
      [/^Copier\s+(.+)$/i, (m) => `نسخ ${m[1]}`],
      [/^Grille du\s+(.+)\s+chargée\.$/i, (m) => `تم تحميل شبكة ${m[1]}.`],
      [/^Dernière lecture\s*:\s*(.+)$/i, (m) => `آخر قراءة: ${m[1]}`],
      [/^(\d+)\s+jetons?$/i, (m) => `${m[1]} رمز`],
      [/^Voir\s+(\d+)\s+commentaires?$/i, (m) => `عرض ${m[1]} تعليق`]
    ]
  });

  /*
   * Raw status codes stored in the database (subscriptions, payments,
   * results, moderation…). Modules may print them verbatim; the runtime maps
   * them to a dictionary key so they follow the active language like any
   * other label. `cidTranslation.status(code)` exposes the same mapping.
   */
  const STATUS_KEYS = Object.freeze({
    active: 'status.active',
    actif: 'status.active',
    enabled: 'status.enabled',
    disabled: 'status.disabled',
    inactive: 'status.inactive',
    expired: 'status.expired',
    expire: 'status.expired',
    pending: 'status.pending',
    en_attente: 'status.pending',
    processing: 'status.processing',
    approved: 'status.approved',
    confirmed: 'status.confirmed',
    verified: 'status.verified',
    rejected: 'status.rejected',
    refused: 'status.rejected',
    cancelled: 'status.cancelled',
    canceled: 'status.cancelled',
    paid: 'status.paid',
    unpaid: 'status.unpaid',
    failed: 'status.failed',
    success: 'status.success',
    succeeded: 'status.success',
    completed: 'status.completed',
    published: 'status.published',
    draft: 'status.draft',
    archived: 'status.archived',
    scheduled: 'status.scheduled',
    suspended: 'status.suspended',
    blocked: 'status.blocked',
    trial: 'status.trial',
    free: 'status.free',
    public: 'status.public',
    private: 'status.private',
    individual: 'status.individual',
    collective: 'status.collective',
    manual: 'status.manual',
    online: 'status.online',
    offline: 'status.offline',
    open: 'status.open',
    closed: 'status.closed',
    unlocked: 'status.unlocked',
    locked: 'status.locked',
    purchase: 'status.purchase',
    credit: 'status.credit',
    debit: 'status.debit',
    refund: 'status.refund',
    unknown: 'status.unknown'
  });

  // User-generated content (chat messages, comment authors) is never
  // rewritten, even when it happens to match a dictionary phrase.
  const SKIP_SELECTOR = [
    'script', 'style', 'noscript', 'textarea', 'code', 'pre',
    '[contenteditable=""]', '[contenteditable="true"]',
    '[data-no-translate]', '.cid-no-translate',
    '.support-chat-message.is-user', '.cid-comment-sheet-author', '.cid-fb-comment-author'
  ].join(',');
  // Attributes stay translatable on form fields whose content is skipped
  // (a <textarea> placeholder is interface text, its value is user input).
  const ATTRIBUTE_SKIP_SELECTOR = 'script,style,noscript,[data-no-translate],.cid-no-translate';
  const TRANSLATED_ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'alt'];
  const MAX_TRANSLATABLE_LENGTH = 800;
  const PLACEHOLDER_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;
  const DOTTED_KEY_PATTERN = /^[A-Za-z][\w-]*(\.[\w-]+)+$/;

  // Resolved synchronously so modules that read cidTranslation.current()
  // before the catalogue arrives (site-config, feed) request the right
  // language instead of briefly assuming French.
  let currentLocale = initialLocale();
  let currentCatalog = {};
  let fallbackCatalog = {};
  let languageState = Object.freeze({
    locale: currentLocale,
    catalog: Object.freeze({})
  });
  let languageRequestId = 0;
  let preferredLocaleOverride = '';
  let observer = null;
  let lastAnnounced = '';
  let lastDatabaseTranslations = null;
  let indexRevision = 0;

  // Every dictionary fetched in this tab, by locale. They feed the reverse
  // index so text already rendered in one language can be translated to the
  // next one without reloading the page.
  const loadedCatalogs = new Map();
  const catalogRequests = new Map();
  let reverseIndex = new Map();
  let lowerIndex = new Map();
  let templates = [];
  let phraseCache = new Map();

  // Per-node memory: what the node originally said and what we wrote into
  // it. A node whose value differs from `rendered` was changed by a module,
  // so its new value becomes the source for the next translation.
  const textState = new WeakMap();
  const attributeState = new WeakMap();
  const pendingNodes = new Set();
  let flushScheduled = false;

  function normalizeLocale(value) {
    const raw = String(value || '').trim().replace('_', '-');
    if (!raw) return '';
    return /^[a-z]{2,3}-[A-Z]{2}$/.test(raw) ? raw : raw.split('-')[0].toLowerCase();
  }

  function supportedLocale(value) {
    const base = normalizeLocale(value).split('-')[0].toLowerCase();
    return SUPPORTED_LOCALES.includes(base) ? base : '';
  }

  // First supported entry of the browser preferences, or French.
  function detectBrowserLocale() {
    const candidates = [
      ...(Array.isArray(navigator.languages) ? navigator.languages : []),
      navigator.language,
      navigator.userLanguage
    ];
    for (const candidate of candidates) {
      const locale = supportedLocale(candidate);
      if (locale) return locale;
    }
    return FALLBACK_LOCALE;
  }

  // Only an explicit, supported visitor choice counts as a saved preference.
  // Values written by older builds (for example an unsupported "de") are
  // ignored so they can never force the French fallback.
  function readPersistedLocale() {
    try {
      return supportedLocale(localStorage.getItem(LANGUAGE_STORAGE_KEY))
        || supportedLocale(localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY))
        || '';
    } catch (_) {
      return '';
    }
  }

  function clearPersistedLocale() {
    try {
      localStorage.removeItem(LANGUAGE_STORAGE_KEY);
      localStorage.removeItem(LEGACY_LANGUAGE_STORAGE_KEY);
    } catch (_) {}
  }

  // Priority: saved choice > account preference > browser language > French.
  function initialLocale() {
    return readPersistedLocale()
      || supportedLocale(localizationState()?.userLocaleCode)
      || detectBrowserLocale();
  }

  function persistLocale(locale) {
    const normalized = supportedLocale(locale) || FALLBACK_LOCALE;
    try {
      // Keep the legacy key in sync for older modules, but make the
      // namespaced key the single source of truth for new code.
      localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
      localStorage.setItem(LEGACY_LANGUAGE_STORAGE_KEY, normalized);
    } catch (_) {
      // Private browsing can reject storage writes. The in-memory state still
      // remains authoritative for the current document.
    }
    return normalized;
  }

  function localizationState() {
    return window.cidSiteConfig?.localization?.()
      || window.cidSiteConfig?.state?.()?.localization
      || null;
  }

  function resolveLocale(requested) {
    return supportedLocale(requested) || FALLBACK_LOCALE;
  }

  // Dictionaries are fetched once per tab; switching back and forth between
  // languages is therefore instantaneous after the first visit.
  function loadJsonCatalog(locale) {
    const path = LOCAL_CATALOGS[locale] || LOCAL_CATALOGS[FALLBACK_LOCALE];
    if (catalogRequests.has(path)) return catalogRequests.get(path);
    const request = fetch(path, { cache: 'no-cache' })
      .then((response) => (response.ok ? response.json() : {}))
      .then((json) => (json && typeof json === 'object' ? json : {}))
      .catch(() => {
        catalogRequests.delete(path);
        return {};
      });
    catalogRequests.set(path, request);
    return request;
  }

  function localizedValue(value, fallback = '') {
    const locale = currentLocale || FALLBACK_LOCALE;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return localizedValue(parsed, fallback);
          }
        } catch (_) {
          // Keep the historical text when a legacy field contains invalid
          // JSON instead of turning a harmless label into an exception.
        }
      }
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const baseLocale = locale.split('-')[0];
      return String(
        value[locale]
          ?? value[baseLocale]
          ?? value[FALLBACK_LOCALE]
          ?? Object.values(value).find((item) => item !== null && item !== undefined)
          ?? fallback
      );
    }
    return String(value ?? fallback);
  }

  function localizedField(record, field, fallback = '') {
    const source = record && typeof record === 'object' ? record : {};
    const locale = currentLocale || FALLBACK_LOCALE;
    const baseLocale = locale.split('-')[0];
    const localized = source[`${field}_${locale}`]
      ?? source[`${field}_${baseLocale}`]
      ?? source[`${field}_i18n`];
    const legacy = localizedValue(source[field], fallback);
    const translated = localizedValue(localized, legacy);
    return translated || legacy;
  }

  function databaseTranslations(locale) {
    const state = localizationState();
    return state?.selectedLocale === locale && state.translations && typeof state.translations === 'object'
      ? state.translations
      : {};
  }

  /* ------------------------------------------------------------------ */
  /* Phrase lookup                                                        */
  /* ------------------------------------------------------------------ */

  function normalizeText(value) {
    return String(value ?? '')
      .replace(/[\u00a0\u202f\u2009]/g, ' ')
      .replace(/[\u2018\u2019\u02bc]/g, '\'')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function compileTemplate(template, key) {
    const normalized = normalizeText(template);
    const names = [];
    const literals = [];
    let pattern = '';
    let cursor = 0;
    normalized.replace(PLACEHOLDER_PATTERN, (match, name, offset) => {
      const literal = normalized.slice(cursor, offset);
      literals.push(literal);
      pattern += escapeRegExp(literal).replace(/'/g, '[\'’]').replace(/ /g, '\\s+');
      pattern += '(.+?)';
      names.push(name);
      cursor = offset + match.length;
      return match;
    });
    const tail = normalized.slice(cursor);
    literals.push(tail);
    pattern += escapeRegExp(tail).replace(/'/g, '[\'’]').replace(/ /g, '\\s+');
    // A template made only of placeholders and separators ("{{1}} · {{2}}")
    // would match almost anything, so it is never used for reverse lookups.
    const letters = literals.join('').replace(/[^\p{L}]/gu, '').length;
    if (!names.length || letters < 3) return null;
    const anchor = literals.reduce((longest, part) => (part.trim().length > longest.length ? part.trim() : longest), '');
    try {
      return { key, names, anchor, regex: new RegExp(`^${pattern}$`, 'su') };
    } catch (_) {
      return null;
    }
  }

  // Rebuilt whenever a dictionary is (re)applied. French is indexed first so
  // a French source phrase always wins over an accidental homograph.
  function rebuildIndexes() {
    const nextReverse = new Map();
    const nextLower = new Map();
    const seenTemplates = new Set();
    const nextTemplates = [];
    const order = [FALLBACK_LOCALE, ...[...loadedCatalogs.keys()].filter((locale) => locale !== FALLBACK_LOCALE)];
    order.forEach((locale) => {
      const catalog = loadedCatalogs.get(locale);
      if (!catalog) return;
      Object.entries(catalog).forEach(([key, value]) => {
        if (typeof value !== 'string' || !value) return;
        const entries = DOTTED_KEY_PATTERN.test(key) ? [value] : [key, value];
        entries.forEach((phrase) => {
          const normalized = normalizeText(phrase);
          if (!normalized) return;
          if (phrase.includes('{{')) {
            if (seenTemplates.has(normalized)) return;
            seenTemplates.add(normalized);
            const compiled = compileTemplate(phrase, key);
            if (compiled) nextTemplates.push(compiled);
            return;
          }
          if (!nextReverse.has(normalized)) nextReverse.set(normalized, key);
          const lower = normalized.toLocaleLowerCase();
          if (!nextLower.has(lower)) nextLower.set(lower, key);
        });
      });
    });
    nextTemplates.sort((a, b) => b.anchor.length - a.anchor.length);
    reverseIndex = nextReverse;
    lowerIndex = nextLower;
    templates = nextTemplates;
    phraseCache = new Map();
  }

  function catalogValue(key) {
    const value = currentCatalog[key] ?? fallbackCatalog[key];
    return value === undefined || value === null ? undefined : String(value);
  }

  function matchCase(source, translated) {
    if (!translated) return translated;
    const letters = source.replace(/[^\p{L}]/gu, '');
    if (letters.length > 1 && letters === letters.toLocaleUpperCase() && letters !== letters.toLocaleLowerCase()) {
      return translated.toLocaleUpperCase(currentLocale);
    }
    const first = source.match(/\p{L}/u)?.[0];
    if (first && first === first.toLocaleLowerCase() && first !== first.toLocaleUpperCase()) return translated;
    return translated.charAt(0).toLocaleUpperCase(currentLocale) + translated.slice(1);
  }

  function interpolate(template, values) {
    return String(template).replace(PLACEHOLDER_PATTERN, (match, name) => (
      Object.prototype.hasOwnProperty.call(values, name) ? String(values[name] ?? '') : match
    ));
  }

  function lookupExact(source) {
    const direct = catalogValue(source);
    if (direct !== undefined) return direct;
    const alias = SOURCE_KEY_ALIASES[source];
    if (alias && catalogValue(alias) !== undefined) return catalogValue(alias);
    const normalized = normalizeText(source);
    const key = reverseIndex.get(normalized);
    if (key !== undefined && catalogValue(key) !== undefined) return catalogValue(key);
    const statusKey = STATUS_KEYS[normalized.toLowerCase()];
    if (statusKey && /^[a-z_]+$/i.test(normalized) && catalogValue(statusKey) !== undefined) {
      return catalogValue(statusKey);
    }
    return undefined;
  }

  function lookupTemplate(source, depth) {
    const normalized = normalizeText(source);
    for (const template of templates) {
      if (template.anchor && !normalized.includes(template.anchor)) continue;
      const match = normalized.match(template.regex);
      if (!match) continue;
      const target = catalogValue(template.key);
      if (target === undefined) continue;
      const values = {};
      template.names.forEach((name, index) => {
        values[name] = translatePhrase(match[index + 1], depth + 1);
      });
      return interpolate(target, values);
    }
    return undefined;
  }

  function lookupPhrase(source, depth) {
    const exact = lookupExact(source);
    if (exact !== undefined) return exact;
    if (depth > 3) return undefined;

    // "Accès requis :" / "Chargement…" — translate the core, keep the tail.
    const tail = source.match(/^(.*?\p{L}.*?)(\s*[:：…!?.,;]+)$/u);
    if (tail) {
      const core = lookupExact(tail[1]);
      if (core !== undefined) {
        // French puts a space before ":" and "?"; other languages do not.
        const suffix = currentLocale === FALLBACK_LOCALE ? tail[2] : tail[2].trimStart();
        return core.replace(/[\s:：…!?.,;]+$/u, '') + suffix;
      }
    }
    // "✓ Langue actuelle", "• Offre", "← Retour" — keep leading symbols.
    const lead = source.match(/^([^\p{L}\p{N}]+)(\p{L}.*)$/u);
    if (lead) {
      const rest = lookupPhrase(lead[2], depth + 1);
      if (rest !== undefined) return lead[1] + rest;
    }
    const lower = lowerIndex.get(normalizeText(source).toLocaleLowerCase());
    if (lower !== undefined && catalogValue(lower) !== undefined) {
      return matchCase(source, catalogValue(lower));
    }
    const templated = lookupTemplate(source, depth);
    if (templated !== undefined) return templated;

    // Labels glued together by a separator ("Achat · 12 oct. 2026").
    const segments = source.split(/(\s+[·•|—–]\s+)/);
    if (segments.length > 1) {
      let changed = false;
      const joined = segments.map((segment, index) => {
        if (index % 2 === 1) return segment;
        const translated = translatePhrase(segment, depth + 1);
        if (translated !== segment) changed = true;
        return translated;
      }).join('');
      if (changed) return joined;
    }

    // Legacy dynamic phrases emitted by the feed and result cards.
    const rules = DYNAMIC_PHRASES[String(currentLocale || '').split('-')[0]];
    if (rules) {
      for (const [pattern, render] of rules) {
        const match = source.match(pattern);
        if (match) return render(match);
      }
    }
    return undefined;
  }

  function translatePhrase(source, depth = 0) {
    const text = String(source ?? '');
    if (!text.trim() || text.length > MAX_TRANSLATABLE_LENGTH) return text;
    if (!/\p{L}/u.test(text)) return text;
    const cacheable = depth === 0;
    if (cacheable && phraseCache.has(text)) return phraseCache.get(text);
    const leading = text.match(/^\s*/)[0];
    const trailing = text.slice(leading.length).match(/\s*$/)[0];
    const core = text.slice(leading.length, text.length - trailing.length);
    const found = lookupPhrase(core, depth);
    const result = leading + localizeDates(found === undefined ? core : found) + trailing;
    if (cacheable) {
      if (phraseCache.size > 5000) phraseCache.clear();
      phraseCache.set(text, result);
    }
    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Dates written in another language                                    */
  /* ------------------------------------------------------------------ */

  const DATE_LOCALES = ['fr', 'en', 'es', 'pt'];
  const englishMonthForms = new Set();
  const dateVocabulary = (() => {
    const months = new Map();
    const weekdays = new Set();
    const strip = (value) => value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\.$/, '');
    DATE_LOCALES.forEach((locale) => {
      ['long', 'short'].forEach((width) => {
        for (let month = 0; month < 12; month += 1) {
          try {
            const name = new Intl.DateTimeFormat(locale, { month: width, timeZone: 'UTC' })
              .format(new Date(Date.UTC(2024, month, 15)));
            const entry = months.get(strip(name)) || { month, locales: new Set(), forms: new Set() };
            entry.locales.add(locale);
            entry.forms.add(name.toLocaleLowerCase());
            entry.forms.add(name.toLocaleLowerCase().replace(/\.$/, ''));
            if (locale === 'en') englishMonthForms.add(name.toLocaleLowerCase().replace(/\.$/, ''));
            months.set(strip(name), entry);
          } catch (_) {}
        }
        for (let day = 0; day < 7; day += 1) {
          try {
            const name = new Intl.DateTimeFormat(locale, { weekday: width, timeZone: 'UTC' })
              .format(new Date(Date.UTC(2024, 0, 7 + day)));
            weekdays.add(name.toLocaleLowerCase());
            weekdays.add(name.toLocaleLowerCase().replace(/\.$/, ''));
          } catch (_) {}
        }
      });
    });
    const alternation = (values) => [...values]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|');
    const monthForms = new Set(['sept']);
    const englishMonths = new Set(['sept']);
    months.forEach((entry, stripped) => entry.forms.forEach((form) => {
      monthForms.add(form);
      if (englishMonthForms.has(form)) englishMonths.add(form);
    }));
    const weekdayPattern = alternation(weekdays);
    const time = '(?:,?\\s*(?:à|a las|a la|às|as|at|-)?\\s*(\\d{1,2})[:h](\\d{2}))?';
    return {
      strip,
      months,
      // [weekday] 12 septembre 2026 · 12 de septiembre de 2026 · 12 sept. 2026
      dayFirst: new RegExp(
        `(?<![\\p{L}\\d])(?:(${weekdayPattern})\\.?,?\\s+)?(\\d{1,2})(?:er|º)?\\s+(?:de\\s+)?(${alternation(monthForms)})(\\.)?(?:,?\\s+(?:de\\s+)?(\\d{4}))?${time}(?![\\p{L}\\d])`,
        'giu'
      ),
      // [weekday,] September 12, 2026 — English month names only.
      monthFirst: new RegExp(
        `(?<![\\p{L}\\d])(?:(${weekdayPattern})\\.?,?\\s+)?(${alternation(englishMonths)})(\\.)?\\s+(\\d{1,2}),?(?:\\s+(\\d{4}))?${time}(?![\\p{L}\\d])`,
        'giu'
      )
    };
  })();

  function formatForeignDate(match, parts, order) {
    const { weekday, day, monthName, dot, year, hour, minute } = parts;
    const stripped = dateVocabulary.strip(monthName);
    const entry = dateVocabulary.months.get(stripped);
    if (!entry) return match;
    // Abbreviations such as "oct" are shared by several languages, so the
    // word order also tells whether the date is already in the active style:
    // English writes the month first, the other Latin locales the day first.
    const orderMatches = order === 'monthFirst' ? currentLocale === 'en' : currentLocale !== 'en';
    if (entry.locales.has(currentLocale) && orderMatches) return match;
    // Short month forms ("set", "out", "mar") are ordinary words in some
    // languages: only treat them as dates when written "12 set. 2026".
    const longMonth = stripped.length > 4;
    if (!longMonth && !dot && !year) return match;
    const dayNumber = Number(day);
    if (!(dayNumber >= 1 && dayNumber <= 31)) return match;
    const hasYear = Boolean(year);
    const date = new Date(hasYear ? Number(year) : 2024, entry.month, dayNumber, Number(hour || 12), Number(minute || 0));
    if (Number.isNaN(date.getTime())) return match;
    const options = { day: 'numeric', month: longMonth ? 'long' : 'short' };
    if (hasYear) options.year = 'numeric';
    if (weekday) options.weekday = weekday.replace(/\.$/, '').length > 4 ? 'long' : 'short';
    if (hour !== undefined && minute !== undefined) {
      options.hour = '2-digit';
      options.minute = '2-digit';
    }
    try {
      return new Intl.DateTimeFormat(currentLocale, options).format(date);
    } catch (_) {
      return match;
    }
  }

  function localizeDates(text) {
    if (!text || !/\d/.test(text)) return text;
    const dayFirst = text.replace(dateVocabulary.dayFirst, (match, weekday, day, monthName, dot, year, hour, minute) => (
      formatForeignDate(match, { weekday, day, monthName, dot, year, hour, minute }, 'dayFirst')
    ));
    return dayFirst.replace(dateVocabulary.monthFirst, (match, weekday, monthName, dot, day, year, hour, minute) => (
      formatForeignDate(match, { weekday, day, monthName, dot, year, hour, minute }, 'monthFirst')
    ));
  }

  /* ------------------------------------------------------------------ */
  /* DOM translation                                                      */
  /* ------------------------------------------------------------------ */

  function skipped(element) {
    return !element || Boolean(element.closest?.(SKIP_SELECTOR));
  }

  function translateTextNode(node) {
    const current = node.nodeValue || '';
    const state = textState.get(node);
    if (state && current === state.rendered && state.locale === currentLocale && state.revision === indexRevision) return;
    const source = state && current === state.rendered ? state.source : current;
    if (!source.trim() || skipped(node.parentElement)) return;
    const translated = translatePhrase(source);
    if (translated !== current) node.nodeValue = translated;
    textState.set(node, { source, rendered: translated, locale: currentLocale, revision: indexRevision });
  }

  function translateElementAttributes(element) {
    const attributes = TRANSLATED_ATTRIBUTES.slice();
    if (element.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(element.type)) attributes.push('value');
    let memory = attributeState.get(element);
    attributes.forEach((attribute) => {
      if (!element.hasAttribute(attribute)) return;
      const current = element.getAttribute(attribute) || '';
      if (!memory) {
        memory = {};
        attributeState.set(element, memory);
      }
      const state = memory[attribute];
      if (state && current === state.rendered && state.locale === currentLocale && state.revision === indexRevision) return;
      const source = state && current === state.rendered ? state.source : current;
      const translated = translatePhrase(source);
      if (translated !== current) element.setAttribute(attribute, translated);
      memory[attribute] = { source, rendered: translated, locale: currentLocale, revision: indexRevision };
    });
  }

  // Explicit bindings: data-i18n (text) and data-i18n-<attribute>.
  function translateBindings(element) {
    const key = element.getAttribute('data-i18n');
    if (key) {
      const value = catalogValue(key);
      if (value !== undefined) {
        if (['INPUT', 'TEXTAREA'].includes(element.tagName) && 'value' in element) element.value = value;
        else if (element.textContent !== value) element.textContent = value;
      }
    }
    ['placeholder', 'title', 'aria-label', 'alt'].forEach((attribute) => {
      const attributeKey = element.getAttribute(`data-i18n-${attribute}`);
      const value = attributeKey ? catalogValue(attributeKey) : undefined;
      if (value !== undefined && element.getAttribute(attribute) !== value) element.setAttribute(attribute, value);
    });
  }

  function translateTree(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE && root.closest(ATTRIBUTE_SKIP_SELECTOR)) return;
    const elements = root.nodeType === Node.ELEMENT_NODE ? [root, ...root.querySelectorAll('*')] : [...root.querySelectorAll('*')];
    elements.forEach((element) => {
      if (element.hasAttribute('data-i18n')
        || element.hasAttribute('data-i18n-placeholder')
        || element.hasAttribute('data-i18n-title')
        || element.hasAttribute('data-i18n-aria-label')
        || element.hasAttribute('data-i18n-alt')) translateBindings(element);
      if (!element.closest(ATTRIBUTE_SKIP_SELECTOR)) translateElementAttributes(element);
    });
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (
        skipped(node.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
      )
    });
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    nodes.forEach(translateTextNode);
  }

  const titleState = { source: '', rendered: '' };
  function translateDocumentTitle() {
    const current = document.title || '';
    const source = titleState.rendered && current === titleState.rendered ? titleState.source : current;
    const translated = translatePhrase(source);
    titleState.source = source;
    titleState.rendered = translated;
    if (translated !== current) document.title = translated;
  }

  function translatePage() {
    translateTree(document.body);
    translateDocumentTitle();
  }

  function flushPending() {
    flushScheduled = false;
    const nodes = [...pendingNodes];
    pendingNodes.clear();
    nodes.forEach((node) => {
      if (!node.isConnected) return;
      if (node.nodeType === Node.ELEMENT_NODE && node.__cidAttributesOnly) {
        node.__cidAttributesOnly = false;
        if (!node.closest(ATTRIBUTE_SKIP_SELECTOR)) translateElementAttributes(node);
        return;
      }
      translateTree(node);
    });
  }

  function schedule(node, attributesOnly = false) {
    if (!node) return;
    if (attributesOnly) {
      if (!pendingNodes.has(node)) node.__cidAttributesOnly = true;
    } else {
      node.__cidAttributesOnly = false;
    }
    pendingNodes.add(node);
    if (flushScheduled) return;
    flushScheduled = true;
    // A microtask runs before the browser paints, so freshly rendered
    // French text is replaced before it can flash on screen.
    queueMicrotask(flushPending);
  }

  function installObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver((records) => {
      records.forEach((record) => {
        if (record.type === 'childList') record.addedNodes.forEach((node) => schedule(node));
        else if (record.type === 'characterData') schedule(record.target);
        else if (record.type === 'attributes') schedule(record.target, true);
      });
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...TRANSLATED_ATTRIBUTES, 'value']
    });
    const titleElement = document.querySelector('title');
    if (titleElement) {
      new MutationObserver(() => {
        if (document.title !== titleState.rendered) translateDocumentTitle();
      }).observe(titleElement, { childList: true, characterData: true, subtree: true });
    }
  }

  function setDocumentDirection(locale) {
    const rtl = RTL_LOCALES.has(locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    document.body?.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    document.body?.classList.toggle('cid-rtl', rtl);
  }

  function applyCatalog(catalog, locale, fallback = {}) {
    const database = databaseTranslations(locale);
    lastDatabaseTranslations = database;
    loadedCatalogs.set(locale, { ...catalog, ...database });
    if (locale !== FALLBACK_LOCALE && Object.keys(fallback).length) loadedCatalogs.set(FALLBACK_LOCALE, { ...fallback });
    fallbackCatalog = { ...fallback };
    currentCatalog = {
      ...fallbackCatalog,
      ...catalog,
      ...database
    };
    currentLocale = locale;
    indexRevision += 1;
    rebuildIndexes();
    languageState = Object.freeze({
      locale,
      catalog: Object.freeze({ ...currentCatalog })
    });
    document.documentElement.dataset.cidLocale = locale;
    setDocumentDirection(locale);
    translatePage();
  }

  /*
   * `t(key, fallback, values)` — values fill {{placeholders}} of the
   * dictionary entry, e.g. t('assistant.summaryDate', 'Date : {{date}}', { date }).
   */
  function translate(key, fallback = key, values = null) {
    const source = String(key ?? '');
    let value = catalogValue(source);
    if (value === undefined) {
      const phrase = translatePhrase(source);
      value = phrase === source && fallback !== key ? translatePhrase(String(fallback ?? '')) : phrase;
    }
    return values && typeof values === 'object' ? interpolate(value, values) : value;
  }

  function translateStatus(code, fallback) {
    const raw = String(code ?? '').trim();
    const key = STATUS_KEYS[raw.toLowerCase()];
    const value = key ? catalogValue(key) : undefined;
    if (value !== undefined) return value;
    return fallback !== undefined ? translate(fallback, fallback) : translatePhrase(raw);
  }

  function formatDate(value, options = {}) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime())
      ? String(value || '')
      : new Intl.DateTimeFormat(currentLocale || FALLBACK_LOCALE, options).format(date);
  }

  function formatNumber(value, options = {}) {
    const number = Number(value);
    return Number.isFinite(number)
      ? new Intl.NumberFormat(currentLocale || FALLBACK_LOCALE, options).format(number)
      : String(value ?? '');
  }

  function relativeTime(value, unit = 'second') {
    try {
      return new Intl.RelativeTimeFormat(currentLocale || FALLBACK_LOCALE, { numeric: 'always' }).format(Number(value), unit);
    } catch (_) {
      return String(value ?? '');
    }
  }

  async function persistUserLocale(locale) {
    try {
      const bridge = await Promise.resolve(window.cidSupabaseReady);
      const session = await bridge?.auth?.getSession?.();
      if (!session?.data?.session?.user?.id || !bridge?.client?.functions?.invoke) return;
      await bridge.client.functions.invoke('subscription-access', {
        body: { action: 'set-language', localeCode: locale }
      });
    } catch (_) {
      // A catalog can still be applied for this session when the preference
      // write is unavailable. The next authenticated refresh remains safe.
    }
  }

  /*
   * `requested` may be one of the supported codes or "auto". Choosing "auto"
   * forgets the saved preference and follows the browser language again.
   * Only a manual choice (the default) is written to localStorage; the
   * start-up pass uses { persistRemote: false } and leaves storage untouched
   * so a later browser-language change is still detected.
   *
   * The switch is live: the dictionary is applied to the current DOM, every
   * text node is re-translated from its source, and `cid:language-change`
   * lets dynamic modules re-render. No page reload is needed.
   */
  async function changeLanguage(requested, options = {}) {
    const manual = options.persistRemote !== false;
    const auto = String(requested || '').trim().toLowerCase() === AUTO_LOCALE;
    const locale = auto ? detectBrowserLocale() : resolveLocale(requested);
    if (manual) {
      // A manual choice must remain authoritative while the remote preference
      // is being saved. Otherwise an older account preference can immediately
      // restore the previous language during a catalogue refresh.
      preferredLocaleOverride = locale;
    }
    const requestId = ++languageRequestId;
    // Persist on intent, before the catalog request. A later site-config
    // event or route change can therefore never restore the old locale.
    if (manual && auto) clearPersistedLocale();
    else if (manual) persistLocale(locale);
    const [catalog, fallback] = await Promise.all([
      loadJsonCatalog(locale),
      locale === FALLBACK_LOCALE
        ? Promise.resolve({})
        : loadJsonCatalog(FALLBACK_LOCALE)
    ]);
    // A visitor may click twice before either catalog arrives. Only the most
    // recent request is allowed to mutate the DOM or emit a language event.
    if (requestId !== languageRequestId) return currentLocale;
    const previousLocale = currentLocale;
    const previousDatabase = lastDatabaseTranslations;
    applyCatalog(catalog, locale, fallback);
    // Re-announcing an unchanged language would make every module rebuild
    // (the feed re-hydrates all its cards), so only real changes are sent.
    const signatureChanged = lastAnnounced !== locale
      || previousLocale !== locale
      || previousDatabase !== lastDatabaseTranslations;
    if (signatureChanged || manual) {
      lastAnnounced = locale;
      window.dispatchEvent(new CustomEvent('cid:language-change', {
        detail: {
          locale,
          previousLocale,
          catalog: currentCatalog,
          state: languageState
        }
      }));
    }
    if (manual) {
      await persistUserLocale(locale);
      // Re-read the Supabase catalogue so database-provided labels (offers,
      // banners, translation_entries) arrive in the new language too.
      window.cidSiteConfig?.refresh?.({ force: true })?.catch?.(() => {});
    }
    return locale;
  }

  async function loadSavedLanguage() {
    return changeLanguage(preferredLocaleOverride || initialLocale(), { persistRemote: false });
  }

  function availableLocaleCodes() {
    return SUPPORTED_LOCALES.slice();
  }

  window.changeLanguage = changeLanguage;
  window.loadSavedLanguage = loadSavedLanguage;
  window.cidTranslate = translate;
  window.cidTranslation = Object.freeze({
    current: () => currentLocale,
    catalog: () => ({ ...currentCatalog }),
    state: () => languageState,
    available: availableLocaleCodes,
    browserLocale: detectBrowserLocale,
    savedLocale: readPersistedLocale,
    t: translate,
    phrase: (value) => translatePhrase(value),
    status: translateStatus,
    translateTree,
    localized: localizedValue,
    field: localizedField,
    formatDate,
    formatNumber,
    relativeTime
  });

  // Compatibility surface for modules written against the former runtime.
  window.cidI18n = {
    translatePage: (locale) => changeLanguage(locale || currentLocale),
    translate: (key) => translate(key),
    availableLocales: availableLocaleCodes(),
    currentLocale: () => currentLocale
  };
  window.i18n = window.cidI18n;

  window.addEventListener('cid:site-config-loaded', () => loadSavedLanguage().catch(() => {}));
  window.addEventListener('cid:auth-sync', () => {
    // The authenticated catalogue contains the authoritative
    // user_language_preferences row. Reapply it after login/logout so a
    // previous account's locale can never remain visible in this SPA tab.
    // A language saved in this browser still takes precedence (see
    // initialLocale), so logging in never falls back to French.
    preferredLocaleOverride = '';
    window.cidSiteConfig?.refresh?.().catch?.(() => {});
  });
  // Another tab changed the language: follow it.
  window.addEventListener('storage', (event) => {
    if (event.key !== LANGUAGE_STORAGE_KEY) return;
    const locale = supportedLocale(event.newValue) || detectBrowserLocale();
    if (locale !== currentLocale) changeLanguage(locale, { persistRemote: false }).catch(() => {});
  });

  document.documentElement.lang = currentLocale;
  document.documentElement.dir = RTL_LOCALES.has(currentLocale) ? 'rtl' : 'ltr';

  const start = () => {
    installObserver();
    loadSavedLanguage().catch(() => {});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
