import { loadLNB } from '../../components/tableaux/ViewLNB.js';
import { loadBalsa } from '../../components/tableaux/ViewBalsa.js';
import { loadOracle } from '../../components/tableaux/ViewOracle.js';
import { loadIntuition } from '../../components/tableaux/ViewIntuition.js';
import { loadUniverselle } from '../../components/tableaux/ViewUniverselle.js';
import { loadStandBy } from '../../components/tableaux/ViewStandBy.js';
import { loadCreatedPrograms } from '../../components/tableaux/ViewProgramRunner.js';
import {
  SECURE_DISPLAY
} from '../shared/affichageSecurise.js';
import {
  TABLEAU_DEFINITIONS,
  normalizeTableauFeatureKey,
  normalizeTableauPlanId
} from './tableau-contract.js?tableau-contract-v2';
import {
  publicationDayIso,
  useDailyDataRefresh
} from '../shared/daily-data-refresh.js';

/*
 * Tableaux view
 *
 * DISPLAY FREEZE v1: this controller owns data and mounting only. Do not
 * change the approved key/cross/satellite grid structure here.
 *
 * The imported table screen is mounted here as a native Cidmap view. Its
 * The presentation stays local to this view while the imported calculation
 * modules are isolated under ./calculations.
 */

(() => {
  const VIEW_ID = 'tableauxViewContainer';
  const BUTTON_ID = 'tableauxBtn';
  const VALID_NUMBER_TABLE_SELECTORS = [
    '.valid-numbers-table',
    '.oracle-valid-numbers',
    '.lnb-valid-numbers'
  ];
  const TABLEAUX_LUCKY_NUMBER_CELL_SELECTOR = VALID_NUMBER_TABLE_SELECTORS
    .map((selector) => `#${VIEW_ID} ${selector} td.lucky-number`)
    .join(', ');
  const SHARED_LUCKY_NUMBER_COLOR = '#FFD700';
  const SHARED_LUCKY_NUMBER_BACKGROUND = 'rgba(255, 215, 0, 0.06)';
  // One visual contract for every protected prediction value.
  const LOCKED_KEY_VALUE = SECURE_DISPLAY.format('key');
  const LOCKED_VALUE = SECURE_DISPLAY.format('table');
  const LOCKED_CROSS = SECURE_DISPLAY.cross;
  const PLANS = TABLEAU_DEFINITIONS
    .filter(({ id }) => id !== 'standby')
    .map(({ id }) => ({ id }));
  const PORTFOLIO_ACCESS = {
    universal: 'tableaux-universelle',
    intuition: 'tableaux-intuition',
    oracle: 'tableaux-oracle',
    lnb: 'tableaux-lnb',
    balsa: 'tableaux-balsa',
    standby: 'tableaux-standby',
    created: 'tableaux-created'
  };
  const PORTFOLIO_LABELS = {
    universal: 'Universelle',
    intuition: 'Intuition',
    oracle: 'Oracle',
    lnb: 'LNB',
    balsa: 'Balsa Plus',
    standby: 'Stand-by',
    created: 'Programmes personnalisés'
  };
  const PORTFOLIO_SELECTORS = {
    universal: '.portfolio-universal',
    intuition: '.portfolio-intuition',
    oracle: '.portfolio-oracle',
    lnb: '.portfolio-lnb',
    balsa: '.portfolio-manual',
    standby: '.portfolio-standby',
    created: '#createdProgramPortfolios'
  };
  const TABLEAUX_PROGRAMS = [
    ...TABLEAU_DEFINITIONS,
    { id: 'created', featureKey: 'tableaux-created', label: 'Programmes personnalisés' }
  ];
  const TABLEAUX_CATALOGUE_MODES = Object.freeze({
    INDIVIDUAL: 'individual',
    COLLECTIVE: 'collective'
  });
  /*
   * The subscription surface follows the Tableau currently represented by
   * the collective offer. These are presentation tokens only: the offer,
   * price and entitlement still come exclusively from the database response.
   */
  const TABLEAUX_THEME_PRESETS = Object.freeze({
    blue: Object.freeze({
      key: 'blue',
      accent: '#0066CC',
      accentStrong: '#004A99',
      tint: 'rgba(0, 102, 204, .16)',
      tintStrong: 'rgba(0, 102, 204, .24)',
      ink: '#10233F',
      contrast: '#FFFFFF'
    }),
    yellow: Object.freeze({
      key: 'yellow',
      accent: '#FFD700',
      accentStrong: '#D5A900',
      tint: 'rgba(255, 215, 0, .18)',
      tintStrong: 'rgba(255, 215, 0, .28)',
      ink: '#201B00',
      contrast: '#201B00'
    }),
    violet: Object.freeze({
      key: 'violet',
      accent: '#4A0066',
      accentStrong: '#9932CC',
      tint: 'rgba(74, 0, 102, .16)',
      tintStrong: 'rgba(74, 0, 102, .25)',
      ink: '#321042',
      contrast: '#FFFFFF'
    }),
    dark: Object.freeze({
      key: 'dark',
      accent: '#000000',
      accentStrong: '#000000',
      tint: 'rgba(0, 0, 0, .14)',
      tintStrong: 'rgba(0, 0, 0, .22)',
      ink: '#17171A',
      contrast: '#FFFFFF'
    }),
    burgundy: Object.freeze({
      key: 'burgundy',
      accent: '#4A0000',
      accentStrong: '#2F0000',
      tint: 'rgba(74, 0, 0, .15)',
      tintStrong: 'rgba(74, 0, 0, .23)',
      ink: '#3A1111',
      contrast: '#FFFFFF'
    })
  });
  const TABLEAUX_THEME_BY_FEATURE = Object.freeze({
    'tableaux-universelle': 'burgundy',
    'tableaux-universal': 'burgundy',
    'tableaux-intuition': 'violet',
    'tableaux-oracle': 'dark',
    // LNB keeps its blue programme surface; only its value typography follows
    // the Oracle numeric treatment.
    'tableaux-lnb': 'blue',
    'tableaux-balsa': 'yellow',
    'tableaux-standby': 'yellow'
  });
  const BUILT_IN_PROGRAM_KEYS = new Set([
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
  const ORIGINAL_STYLE_HREFS = [
    '/src/tableaux/styles/original/main.css',
    '/src/tableaux/styles/original/containers.css',
    '/src/tableaux/styles/original/cross.css',
    '/src/tableaux/styles/original/tables.css',
    '/src/tableaux/styles/original/responsive.css',
    '/src/tableaux/styles/cidgroup-bridge.css?tableaux-clone-v3'
  ];
  let tableauxPreloadPromise = null;
  let mountPromise = null;
  let currentDate = new Date();
  let currentPrograms = null;
  // Programme day (16:00 UTC boundary) of the live publication painted in
  // the view, and whether the visitor is browsing an explicit archive date.
  let renderedPublicationDay = '';
  let viewingExplicitDate = false;
  let currentAccessState = null;
  let originalStyleLinks = [];
  let viewportSyncFrame = 0;
  let viewportSyncBound = false;
  let priorityFeatureKey = '';

  const get = (id) => document.getElementById(id);
  /*
   * The role boundary is set only after the current Supabase session has
   * been checked by resolveTableauxAdminAccess(). Account/profile hints are
   * not used to paint one account's private values into another account's
   * view.
   */
  const isVerifiedTableauxAdmin = () => (
    document.body.classList.contains('tableaux-admin')
  );
  const pad = (value) => String(value).padStart(2, '0');
  const dateToIso = (date) => {
    const year = date.getUTCFullYear();
    const month = pad(date.getUTCMonth() + 1);
    const day = pad(date.getUTCDate());
    return `${year}-${month}-${day}`;
  };
  const uiLocale = () => String(
    window.cidTranslation?.current?.()
      || localStorage.getItem('cid_i18n_locale')
      || localStorage.getItem('userLang')
      || 'fr'
  ).replace('_', '-');
  const uiTranslate = (key, fallback = key) => (
    window.cidTranslation?.t?.(key, fallback) || fallback
  );
  const formatDate = (date) => new Intl.DateTimeFormat(uiLocale(), {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'Africa/Abidjan'
  }).format(date);
  const parseDate = (value) => {
    const date = new Date(`${value}T12:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  };
  // Balances/costs may arrive formatted ("24 000", incl. non-breaking
  // spaces); Number() would read them as NaN -> 0. Strip separators first.
  const parseAmount = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const digits = String(value ?? '').replace(/[\s\u00a0\u202f'’.,]/g, '');
    const parsed = Number(digits);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const formatAccessAmount = (value) => Math.max(
    0,
    Math.trunc(parseAmount(value))
  ).toLocaleString(uiLocale());
  const accessCurrencyLabel = (currency, plural = true) => {
    if (currency === 'stars') {
      return uiTranslate(
        plural ? 'balance.starPlural' : 'balance.starSingular',
        plural ? 'étoiles' : 'étoile'
      );
    }
    return uiTranslate(
      plural ? 'balance.tokenPlural' : 'balance.tokenSingular',
      plural ? 'jetons' : 'jeton'
    );
  };
  const valueOrLocked = (value, fallback = LOCKED_VALUE) => (
    value === undefined || value === null || String(value).trim() === ''
      ? fallback
      : String(value)
  );
  const escapeAccessHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  let activeUnlockConfirmation = null;

  /*
   * Server quote for Débloquer / Prolonger: exact cost, balance and the new
   * end date computed by subscription-access from the current end date.
   * Returns null when the quote is unavailable; the dialog then falls back
   * to the same calculation from the freshly read entitlement snapshot.
   */
  async function fetchTableauxUnlockQuote(featureKey) {
    try {
      const bridge = await window.cidSupabaseReady;
      if (!bridge?.client?.functions?.invoke) return null;
      const { data, error } = await bridge.client.functions.invoke(
        'subscription-access',
        { body: { action: 'quote-feature-unlock', featureKey } }
      );
      if (error || !data?.ok || !data.quote) return null;
      return data.quote;
    } catch (_) {
      return null;
    }
  }

  /*
   * Show the debit details before calling the access action. The action that
   * spends the balance is deliberately only invoked after this promise
   * resolves to true.
   */
  function requestTableauxUnlockConfirmation({
    label,
    rule,
    access,
    featureKey,
    trigger,
    quote = null
  }) {
    if (activeUnlockConfirmation) activeUnlockConfirmation(false);

    const currency = quote?.currency
      || (rule?.unlock_currency === 'stars' ? 'stars' : 'tokens');
    const required = Math.max(0, Math.trunc(parseAmount(
      quote ? quote.cost : currency === 'stars' ? rule?.required_stars : rule?.required_tokens
    )));
    const current = Math.max(0, Math.trunc(parseAmount(
      quote ? quote.balance : access?.[currency]
    )));
    const remaining = current - required;
    const renewal = quote?.nextExpiry
      ? {
        durationDays: Math.max(1, Math.trunc(Number(quote.durationDays) || 30)),
        currentExpiry: quote.currentExpiry || null,
        nextExpiry: quote.nextExpiry
      }
      : renewalDates(access, featureKey, rule);
    const isRenewal = Boolean(renewal.currentExpiry);
    const durationDays = renewal.durationDays;
    const currencyText = accessCurrencyLabel(currency, required !== 1);
    const durationText = `${durationDays} jour${durationDays === 1 ? '' : 's'}`;
    const missing = Math.max(0, required - current);
    const enoughBalance = current >= required;
    // An insufficient balance goes straight to the token purchase page; the
    // confirmation dialog is only shown when the debit can actually happen.
    if (!enoughBalance) {
      return Promise.resolve({ buyTokens: true, missing, currency });
    }
    const remainingText = `${formatAccessAmount(Math.max(0, remaining))} ${
      accessCurrencyLabel(currency, remaining !== 1)
    }`;
    const missingText = `${formatAccessAmount(missing)} ${
      accessCurrencyLabel(currency, missing !== 1)
    }`;
    const validityStart = renewal.currentExpiry
      ? accessExpiryLabel(renewal.currentExpiry)
      : 'à partir de la confirmation';
    const validityEnd = accessExpiryLabel(renewal.nextExpiry);
    const actionSelector = enoughBalance
      ? 'data-tableaux-unlock-confirm'
      : 'data-tableaux-unlock-buy';
    const shortageTitle = currency === 'tokens'
      ? 'Jetons insuffisants'
      : 'Solde insuffisant';
    const actionLabel = enoughBalance ? 'Valider' : `Acheter ${missingText}`;
    const debitText = `${formatAccessAmount(required)} ${currencyText}`;
    const confirmationText = isRenewal
      ? `Votre abonnement sera prolongé jusqu’au <b>${escapeAccessHtml(validityEnd)}</b>. Voulez-vous valider le débit de <b>${escapeAccessHtml(debitText)}</b> ?`
      : `Votre accès sera activé jusqu’au <b>${escapeAccessHtml(validityEnd)}</b>. Voulez-vous valider le débit de <b>${escapeAccessHtml(debitText)}</b> ?`;

    return new Promise((resolve) => {
      let settled = false;
      const modal = document.createElement('div');
      modal.className = [
        'modal-overlay',
        'cid-payment-overlay',
        'cid-unlock-confirmation',
        'open',
        enoughBalance ? 'is-balance-sufficient' : 'is-balance-insufficient'
      ].join(' ');
      modal.setAttribute('role', 'presentation');
      modal.setAttribute(
        'aria-label',
        enoughBalance
          ? (isRenewal ? 'Confirmation de la prolongation' : 'Confirmation du déblocage')
          : 'Solde insuffisant'
      );
      const theme = tableauThemeForFeature(access, featureKey);
      modal.dataset.tableauxTheme = theme.key;
      Object.entries({
        '--tableaux-subscription-accent': theme.accent,
        '--tableaux-subscription-accent-strong': theme.accentStrong,
        '--tableaux-subscription-tint': theme.tint,
        '--tableaux-subscription-tint-strong': theme.tintStrong,
        '--tableaux-subscription-ink': theme.ink,
        '--tableaux-subscription-contrast': theme.contrast
      }).forEach(([property, value]) => modal.style.setProperty(property, value));
      modal.innerHTML = `
        <section class="cid-unlock-confirmation__card"
                 role="dialog"
                 aria-modal="true"
                 aria-labelledby="cidUnlockConfirmationTitle">
          <span class="cid-unlock-confirmation__eyebrow">${
            enoughBalance ? 'Sécurité du débit' : shortageTitle
          }</span>
          <h2 id="cidUnlockConfirmationTitle">${
            enoughBalance
              ? (isRenewal ? 'Confirmer la prolongation' : 'Confirmer le déblocage')
              : shortageTitle
          }</h2>
          ${enoughBalance
            ? `<p class="cid-unlock-confirmation__balance-ok">✓ Votre solde est suffisant.</p>
          <p class="cid-unlock-confirmation__warning">${confirmationText}</p>`
            : `<p>Votre solde ne permet pas encore de débloquer ce tableau. Il vous manque ${missingText}. Achetez les jetons nécessaires pour continuer.</p>`}
          <div class="cid-unlock-confirmation__included">
            <strong>Détails de l’accès</strong>
            <ul>
              <li>Tableau : <b>${escapeAccessHtml(label)}</b></li>
              <li>Accès pendant <b>${escapeAccessHtml(durationText)}</b></li>
              ${renewal.currentExpiry
                ? `<li>Accès actuel jusqu’au : <b>${escapeAccessHtml(accessExpiryLabel(renewal.currentExpiry))}</b></li>`
                : ''}
              <li>Début de validité : <b>${escapeAccessHtml(validityStart)}</b></li>
              <li>Fin prévue : <b>${escapeAccessHtml(validityEnd)}</b></li>
            </ul>
            <small>${renewal.currentExpiry
              ? 'Les jours restants sont conservés et la nouvelle durée est ajoutée à la date actuelle.'
              : 'Ce déblocage concerne uniquement ce tableau et commence après votre confirmation.'}</small>
          </div>
          <dl class="cid-unlock-confirmation__summary">
            <div>
              <dt>Montant déduit</dt>
              <dd>${formatAccessAmount(required)} ${currencyText}</dd>
            </div>
            <div>
              <dt>Solde actuel</dt>
              <dd>${formatAccessAmount(current)} ${accessCurrencyLabel(currency, current !== 1)}</dd>
            </div>
            <div class="${enoughBalance ? 'is-total' : 'is-insufficient'}">
              <dt>${enoughBalance ? 'Solde après le débit' : 'Jetons manquants'}</dt>
              <dd>${escapeAccessHtml(enoughBalance ? remainingText : missingText)}</dd>
            </div>
          </dl>
          <div class="cid-unlock-confirmation__actions">
            <button type="button"
                    class="tableaux-button tableaux-button--secondary"
                    data-tableaux-unlock-cancel>Annuler</button>
            <button type="button"
                    class="tableaux-button tableaux-button--primary cid-buy-button"
                    ${actionSelector}>
              ${escapeAccessHtml(actionLabel)}
            </button>
          </div>
        </section>`;

      const cancelButton = modal.querySelector('[data-tableaux-unlock-cancel]');
      const actionButton = modal.querySelector(`[${actionSelector}]`);

      const settle = (result) => {
        if (settled) return;
        settled = true;
        activeUnlockConfirmation = null;
        document.removeEventListener('keydown', onKeyDown);
        modal.remove();
        trigger?.focus?.({ preventScroll: true });
        resolve(result);
      };
      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          settle({ confirmed: false, cancelled: true });
        }
      };

      cancelButton?.addEventListener('click', () => (
        settle({ confirmed: false, cancelled: true })
      ));
      actionButton?.addEventListener('click', () => (
        settle(enoughBalance
          ? { confirmed: true }
          : { buyTokens: true, missing, currency })
      ));
      modal.addEventListener('click', (event) => {
        if (event.target === modal) {
          settle({ confirmed: false, cancelled: true });
        }
      });
      document.addEventListener('keydown', onKeyDown);
      document.body.appendChild(modal);
      activeUnlockConfirmation = settle;
      cancelButton?.focus({ preventScroll: true });
    });
  }

  /*
   * Tableaux is a fixed scroll surface. Calling scrollIntoView() on a fixed
   * element during the first mobile paint makes the browser resolve the
   * document position before the visual viewport is stable; the header can
   * then appear to jump away and an empty strip is left below the page.
   *
   * Keep the surface anchored to the actual visible viewport instead. The
   * inline values deliberately win over the legacy dynamically-loaded
   * Tableaux styles, while the CSS file provides a 100dvh fallback.
   */
  function syncTableauxViewport({ resetScroll = false } = {}) {
    const view = get(VIEW_ID);
    if (!view || view.hidden) return;

    const viewport = window.visualViewport;
    const viewportHeight = Math.max(
      1,
      Math.round(viewport?.height || window.innerHeight || document.documentElement.clientHeight || 1)
    );
    const header = document.querySelector('.site-header');
    const headerBottom = header
      ? Math.max(0, Math.ceil(header.getBoundingClientRect().bottom))
      : 0;
    const top = Math.min(viewportHeight, headerBottom);
    const height = Math.max(1, viewportHeight - top);
    const nextTop = `${top}px`;
    const nextHeight = `${height}px`;
    const unchanged = view.style.getPropertyValue('--cid-tableaux-viewport-top') === nextTop
      && view.style.getPropertyValue('--cid-tableaux-viewport-height') === nextHeight;

    if (unchanged) {
      if (resetScroll) view.scrollTop = 0;
      return;
    }

    view.style.setProperty('--cid-tableaux-viewport-top', nextTop);
    view.style.setProperty('--cid-tableaux-viewport-height', nextHeight);
    view.style.setProperty('top', nextTop, 'important');
    view.style.setProperty('bottom', 'auto', 'important');
    view.style.setProperty('height', nextHeight, 'important');
    view.style.setProperty('min-height', '0px', 'important');
    view.style.setProperty('max-height', nextHeight, 'important');
    view.style.setProperty('overflow-x', 'hidden', 'important');
    view.style.setProperty('overflow-y', 'auto', 'important');

    if (resetScroll) view.scrollTop = 0;
  }

  function scheduleTableauxViewportSync({ resetScroll = false, settle = false } = {}) {
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (callback) => window.setTimeout(callback, 0);
    const cancelRaf = typeof cancelAnimationFrame === 'function'
      ? cancelAnimationFrame
      : clearTimeout;
    if (viewportSyncFrame) cancelRaf(viewportSyncFrame);
    const sync = () => {
      viewportSyncFrame = 0;
      syncTableauxViewport({ resetScroll });
      if (settle) {
        raf(() => syncTableauxViewport({ resetScroll }));
      }
    };
    viewportSyncFrame = raf(sync);
  }

  function bindTableauxViewportSync() {
    if (viewportSyncBound) return;
    viewportSyncBound = true;
    const schedule = () => {
      if (document.body.classList.contains('tableaux-active')) {
        scheduleTableauxViewportSync();
      }
    };
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('orientationchange', schedule, { passive: true });
    window.visualViewport?.addEventListener('resize', schedule, { passive: true });
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(schedule);
      document.querySelector('.site-header') && observer.observe(
        document.querySelector('.site-header')
      );
    }
  }

  function setTableauxAdminAccess(isAdmin) {
    document.body.classList.toggle('tableaux-admin', Boolean(isAdmin));
    if (!isAdmin) {
      const status = get(VIEW_ID)?.querySelector('#tableauxRemoteStatus');
      if (status) {
        status.hidden = true;
        status.textContent = '';
        status.dataset.state = 'ready';
      }
    }
  }

  async function resolveTableauxAdminAccess() {
    const expectedUserId = String(window.cidAuthCurrentUserId || '');
    /*
     * The account administrator is authenticated by Supabase. Confirm the
     * Supabase role through the protected admin function as well; otherwise
     * the server can return the real Balsa payload and this local display
     * boundary can still repaint it as 0-3-2-0.
     */
    try {
      const bridge = await Promise.resolve(window.cidSupabaseReady);
      const client = bridge?.client;
      if (client?.auth?.getUser && client?.functions?.invoke) {
        const { data: userData, error: userError } =
          await client.auth.getUser();
        if (!userError && userData?.user?.id) {
          const { data, error } = await client.functions.invoke(
            'admin-method-control',
            { body: { action: 'list-access' } }
          );
          if (!error && data?.ok === true
            && String(window.cidAuthCurrentUserId || userData.user.id) === String(userData.user.id)
            && String(window.cidAuthCurrentUserId || '') === expectedUserId) {
            window.cidIsAdmin = true;
            setTableauxAdminAccess(true);
            return true;
          }

          // Keep the display boundary compatible while the admin function is
          // being deployed. The RLS policy permits an authenticated user to
          // read their own role, and the Edge Function still performs its
          // authoritative role check before returning protected values.
          const { data: role, error: roleError } = await client
            .from('user_roles')
            .select('role')
            .eq('user_id', userData.user.id)
            .eq('role', 'admin')
            .maybeSingle();
          if (!roleError && role?.role === 'admin'
            && String(window.cidAuthCurrentUserId || userData.user.id) === String(userData.user.id)
            && String(window.cidAuthCurrentUserId || '') === expectedUserId) {
            window.cidIsAdmin = true;
            setTableauxAdminAccess(true);
            return true;
          }
        }
      }
    } catch (error) {
      console.warn('Rôle administrateur Supabase indisponible', error);
    }

    /*
     * Do not use the Websim creator/owner identity as a fallback here.
     * Several Supabase accounts can use the same Build tab; treating the
     * Websim owner as the current administrator would make a test account
     * inherit the previous administrator's private cards and hide its
     * purchase buttons.
     */
    window.cidIsAdmin = false;
    setTableauxAdminAccess(false);
    return false;
  }

  /*
   * Strict network budget for anything the view waits on. Past it the view
   * stops waiting and keeps the painted shell and the daily cached payloads
   * instead of an endless "Calcul en cours" state.
   */
  const NETWORK_BUDGET_MS = 8000;

  function withBudget(promise, ms = NETWORK_BUDGET_MS) {
    const reader = window.cidReadCache;
    if (typeof reader?.withTimeout === 'function') return reader.withTimeout(promise, ms);
    let timer = 0;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('Délai réseau dépassé.')), ms);
      })
    ]).finally(() => window.clearTimeout(timer));
  }

  function ensureOriginalStyles() {
    if (originalStyleLinks.length === ORIGINAL_STYLE_HREFS.length) return Promise.resolve();
    const styleReady = [];
    originalStyleLinks = ORIGINAL_STYLE_HREFS.map((href) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.tableauxOriginalStyle = 'true';
      styleReady.push(new Promise((resolve) => {
        link.addEventListener('load', resolve, { once: true });
        link.addEventListener('error', resolve, { once: true });
      }));
      document.head.appendChild(link);
      return link;
    });
    // Dynamic legacy styles are appended after the initial document styles.
    // Move the frozen contract to the end so its shell geometry remains the
    // final authority without rewriting the internal Tableaux grids.
    const freezeLink = document.querySelector(
      'link[href^="/src/shared/code-freeze.css"]'
    );
    if (freezeLink) document.head.appendChild(freezeLink);
    // A stalled stylesheet must never hold the view on its loading state.
    return withBudget(Promise.all(styleReady), 4000).catch(() => {});
  }

  function removeOriginalStyles() {
    originalStyleLinks.forEach((link) => link.remove());
    originalStyleLinks = [];
  }

  /*
   * The prediction shell is deliberately synchronous. It is the canonical
   * first paint for every visitor; remote data is an optional hydration pass,
   * never a prerequisite for mounting the UI.
   */
  function skeletonCombinationMarkup() {
    return `<div class="satellite-combination">
      <span class="satellite-number">${LOCKED_VALUE}</span>
      <span class="satellite-operator">+</span>
      <span class="satellite-number">${LOCKED_VALUE}</span>
    </div>`;
  }

  function skeletonCrossMarkup(containerClass, title, siteUrl) {
    return `<div class="container${containerClass ? ` ${containerClass}` : ''}">
      <div class="date">${LOCKED_VALUE}</div>
      <div class="title-text">${title}</div>
      <div class="cross">
        <div class="cross-line cross-line-vertical"></div>
        <div class="cross-line cross-line-horizontal"></div>
        <div class="cross-number cross-number-1" data-cross-position="top">${LOCKED_CROSS.top}</div>
        <div class="cross-number cross-number-2" data-cross-position="bottom">${LOCKED_CROSS.bottom}</div>
        <div class="cross-number cross-number-3" data-cross-position="right">${LOCKED_CROSS.right}</div>
        <div class="cross-number cross-number-6" data-cross-position="left">${LOCKED_CROSS.left}</div>
      </div>
      <div class="site-url">${siteUrl}</div>
    </div>`;
  }

  function skeletonSatelliteTableMarkup({
    tableClass,
    tableId = '',
    title,
    keyTitle,
    napIds
  }) {
    const [nap1a, nap1b, nap2] = napIds;
    return `<div class="table-container satellites-table-container">
      <table class="color-table ${tableClass}"${tableId ? ` id="${tableId}"` : ''}>
        <tr><th colspan="3"><div class="table-date">${LOCKED_VALUE}</div>${title}</th></tr>
        <tr><td>Satellite</td><td>Combinaison 1</td><td>Combinaison 2</td></tr>
        <tr>
            <td>${LOCKED_VALUE}</td>
          <td>${skeletonCombinationMarkup()}</td>
          <td>${skeletonCombinationMarkup()}</td>
        </tr>
        <tr><th colspan="3">${keyTitle}</th></tr>
        <tr>
          <td><div class="nap-cell"><div class="nap-label">NAP1</div><div class="nap-value" id="${nap1a}">${LOCKED_VALUE}</div></div></td>
          <td><div class="nap-cell"><div class="nap-label">NAP1</div><div class="nap-value" id="${nap1b}">${LOCKED_VALUE}</div></div></td>
          <td><div class="nap-cell"><div class="nap-label">NAP2</div><div class="nap-value" id="${nap2}">${LOCKED_VALUE}</div></div></td>
        </tr>
      </table>
      <div class="site-url table-signature">www.cidmap.com</div>
    </div>`;
  }

  function skeletonPortfolioMarkup({
    id,
    containerClass = '',
    title,
    siteUrl,
    table
  }) {
    const featureKey = PORTFOLIO_ACCESS[id] || `tableaux-${id}`;
    return `<div id="tableau-${id}"
                 class="portfolio-${id}"
                 data-tableaux-route="${featureKey}"
                 data-tableaux-feature="${featureKey}">
      <div class="container${containerClass ? ` ${containerClass}` : ''}">
        <div class="date">${LOCKED_VALUE}</div>
        <div class="title-text">${title}</div>
        <div class="key-container"><div class="key-label">la clé:</div><div class="numbers">${LOCKED_KEY_VALUE}</div></div>
        <div class="order-container"><div class="order-label">ordre:</div><div class="numbers">${LOCKED_KEY_VALUE}</div></div>
        <div class="key-info"><p><span>Code:</span> <strong>${LOCKED_VALUE}</strong> | <span>Filtre:</span> <strong>${LOCKED_VALUE}</strong> | <span>addition:</span> <strong>${LOCKED_VALUE}</strong></p></div>
        <div class="site-url key-signature">${siteUrl}</div>
      </div>
      ${skeletonCrossMarkup(containerClass, `croix ${title.replace(/^CLÉ /i, '')}`, siteUrl)}
      ${skeletonSatelliteTableMarkup(table)}
    </div>`;
  }

  function buildTableauxSkeletonMarkup() {
    return `
      <div id="tableauxRemoteStatus" class="tableaux-remote-status" role="status" aria-live="polite"></div>
      ${skeletonPortfolioMarkup({
        id: 'universal',
        title: 'CLÉ UNIVERSELLE',
        siteUrl: 'www.cidmap.com',
        table: {
          tableClass: 'universal-satellites',
          tableId: 'universalSatellites',
          title: 'SATELLITES CROIX UNIVERSELLE',
          keyTitle: 'CLÉ UNIVERSELLE',
          napIds: ['universalNap1a', 'universalNap1b', 'universalNap2']
        }
      })}
      ${skeletonPortfolioMarkup({
        id: 'intuition',
        containerClass: 'intuition',
        title: 'CLÉ INTUITION',
        siteUrl: 'www.cidmap.com',
        table: {
          tableClass: 'intuition-cross-satellites',
          tableId: 'intuitionCrossSatellites',
          title: 'SATELLITES CROIX INTUITION',
          keyTitle: 'CLÉ INTUITION',
          napIds: ['intuitionNap1a', 'intuitionNap1b', 'intuitionNap2']
        }
      })}
      ${skeletonPortfolioMarkup({
        id: 'oracle',
        containerClass: 'oracle',
        title: 'CLÉ ORACLE',
        siteUrl: 'www.cidmap.com',
        table: {
          tableClass: 'oracle-satellites',
          title: 'SATELLITES CROIX ORACLE',
          keyTitle: 'CLÉ ORACLE',
          napIds: ['oracleNap1', 'oracleNap1b', 'oracleNap2']
        }
      })}
      ${skeletonPortfolioMarkup({
        id: 'manual',
        containerClass: 'manual',
        title: 'CLÉ BALSA PLUS',
        siteUrl: 'www.cidmap.com',
        table: {
          tableClass: 'manual-satellites',
          tableId: 'manualSatellites',
          title: 'SATELLITES CROIX BALSA PLUS',
          keyTitle: 'CLÉ BALSA PLUS',
          napIds: ['intuitionKeyNap1a', 'intuitionKeyNap1b', 'intuitionKeyNap2']
        }
      })}
      ${skeletonPortfolioMarkup({
        id: 'lnb',
        containerClass: 'lnb',
        title: 'CLÉ LNB',
        siteUrl: 'www.cidmap.com',
        table: {
          tableClass: 'lnb-satellites',
          title: 'SATELLITES CROIX LNB',
          keyTitle: 'CLÉ LNB',
          napIds: ['lnbNap1', 'lnbNap1b', 'lnbNap2']
        }
      })}
      <div id="tableau-standby"
           class="portfolio-standby"
           data-tableaux-route="tableaux-standby"
           data-tableaux-feature="tableaux-standby">
        <div class="table-container" id="standbyContainer">
          <table class="color-table standby-week-table">
            <thead><tr><th colspan="3"><div class="table-date" id="standbyWeekDate">${LOCKED_VALUE}</div>STAND-BY DE LA SEMAINE</th></tr>
            <tr><th>Pays</th><th>NAP2</th><th>Permutation</th></tr></thead>
            <tbody id="standbyRows"><tr><td class="standby-country-cell">Pays</td><td class="nap2-cell">${LOCKED_VALUE}</td><td class="perm-cell">${LOCKED_VALUE}</td></tr></tbody>
            <tfoot><tr><td colspan="3" id="standbyNextCell">Prochain tirage Stand-by : <span id="standbyNextDate">${LOCKED_VALUE}</span></td></tr></tfoot>
          </table>
          <div class="site-url table-signature">www.cidmap.com</div>
        </div>
      </div>`;
  }

  /*
   * Warm the Tableaux styles while the startup loader is still visible.
   * Stylesheets are fetched into the browser cache instead of being attached
   * to the document here: the Tableaux CSS contains global selectors and must
   * only be active while the Tableaux view is selected.
   */
  function preloadTableauxView() {
    if (!tableauxPreloadPromise) {
      const warmStyles = Promise.all(ORIGINAL_STYLE_HREFS.map((href) => (
        fetch(href, { cache: 'force-cache' }).catch(() => null)
      )));
      tableauxPreloadPromise = warmStyles
        .catch((error) => {
          console.warn('Préchargement des tableaux impossible', error);
          return null;
        });
    }
    return tableauxPreloadPromise;
  }

  function setViewVisibility(visible) {
    const view = get(VIEW_ID);
    if (!view) return;
    if (visible && !view.dataset.mounted && !view.firstElementChild) {
      view.innerHTML = `
        <div class="tableaux-loading-state" role="status" aria-live="polite">
          Chargement des tableaux
        </div>
      `;
    }
    view.hidden = !visible;
    view.style.display = visible ? 'block' : 'none';
    view.setAttribute('aria-hidden', String(!visible));
  }

  function hideOtherViews() {
    window.rejectedController?.leave?.();
    window.hideMatriceView?.();
    window.hideAnticipationView?.();
    ['topBanner', 'redCross', 'redCrossClone', 'categoriesView',
      'countryButtons', 'matrixCalculatorPanel', 'results', 'profileViewContainer',
      'croixViewContainer', 'anticipationViewContainer']
      .forEach((id) => {
        const element = get(id);
        if (!element) return;
        element.style.display = 'none';
        element.hidden = true;
        element.setAttribute('aria-hidden', 'true');
      });
    ['currentDateTime', 'nextAvailableTime', 'nextDay', 'drawNumber']
      .forEach((id) => { const element = get(id); if (element) element.style.display = 'none'; });
    window.scrollTo(0, 0);
    get(VIEW_ID)?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
  }

  function markButtonActive() {
    document.querySelectorAll('.category-item.active, .plant-btn.active')
      .forEach((item) => {
        item.classList.remove('active');
        item.removeAttribute('aria-current');
        if (item.closest('.category-bar')) item.setAttribute('aria-pressed', 'false');
      });
    document.querySelectorAll(`#${BUTTON_ID}`).forEach((button) => {
      button.classList.add('active');
      button.setAttribute('aria-current', 'page');
      button.setAttribute('aria-pressed', 'true');
    });
  }

  function getPortfolio(plan) {
    const portfolioId = normalizeTableauPlanId(plan?.id) === 'balsa'
      ? 'manual'
      : normalizeTableauPlanId(plan?.id);
    return get(VIEW_ID)?.querySelector(`.portfolio-${portfolioId}`) || null;
  }

  function removeDuplicateOfficialPortfolios(view) {
    if (!view) return;
    Object.values(PORTFOLIO_SELECTORS).forEach((selector) => {
      const matches = Array.from(view.querySelectorAll(`:scope > ${selector}`));
      matches.slice(1).forEach((duplicate) => duplicate.remove());
    });
  }

  function removeDuplicateOracleKeyRows(view) {
    const oracle = view?.querySelector('.portfolio-oracle');
    const table = oracle?.querySelector('table.oracle-satellites');
    if (!table) return;

    const rows = Array.from(table.querySelectorAll('tr'));
    const keyRows = rows.filter((row) => (
      row.querySelector('th[colspan="3"]')
      && row.textContent.trim().replace(/\s+/g, ' ').toUpperCase() === 'CLÉ ORACLE'
    ));
    keyRows.slice(1).forEach((row) => row.remove());
  }

  function normalizeTableauxFeature(value) {
    const raw = value && typeof value === 'object'
      ? value.feature_key || value.featureKey || value.key || value.slug
      : value;
    return normalizeTableauFeatureKey(raw);
  }

  function tableauxViewUi() {
    const view = get(VIEW_ID);
    if (!view) return null;
    view.querySelector('#tableauxSectionsOverview')?.remove();
    view.querySelector('#tableauxSectionDetail')?.remove();
    removeDuplicateOfficialPortfolios(view);
    removeDuplicateOracleKeyRows(view);

    let header = view.querySelector('#tableauxPageHeader');
    if (!header) {
      header = document.createElement('header');
      header.id = 'tableauxPageHeader';
      header.className = 'tableaux-page-header';
      view.insertBefore(header, view.firstElementChild);
    }
    let stack = view.querySelector('#tableauxProgramStack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'tableauxProgramStack';
      stack.className = 'tableaux-program-stack';
      header.after(stack);
    }

    // Every schema remains mounted in one continuous page. No offer/detail
    // layer is inserted between the fixed shell and the individual cards.
    const portfolios = [];
    const seen = new Set();
    Object.values(PORTFOLIO_SELECTORS).forEach((selector) => {
      // Only the official top-level portfolios belong to this collector.
      // Descendant templates inside “Programmes personnalisés” must not be
      // reparented into the official stack.
      view.querySelectorAll(`:scope > ${selector}`).forEach((portfolio) => {
        if (seen.has(portfolio)) return;
        seen.add(portfolio);
        portfolios.push(portfolio);
      });
    });
    portfolios.forEach((portfolio) => stack.appendChild(portfolio));
    return { view, header, stack };
  }

  function catalogueModeLabel(mode) {
    return mode === TABLEAUX_CATALOGUE_MODES.COLLECTIVE
      ? 'Catalogue collectif'
      : 'Catalogue individuel';
  }

  /*
   * An explicit choice (footer switch, routed link, "Voir les abonnements")
   * is kept across re-renders. Until then the mode follows the account: the
   * active subscription or, failing that, the active individual Tableaux.
   * Visitors without any access land on the collective catalogue.
   */
  function chooseCatalogueMode(view, mode) {
    if (!view || !Object.values(TABLEAUX_CATALOGUE_MODES).includes(mode)) return;
    view.dataset.tableauxCatalogueMode = mode;
    view.dataset.tableauxCatalogueChosen = 'true';
  }

  function hasActiveIndividualTableau(access) {
    return (Array.isArray(access?.featureUnlocks) ? access.featureUnlocks : [])
      .some((unlock) => (
        normalizeTableauxFeature(unlock?.feature_key || unlock?.featureKey)
          .startsWith('tableaux-')
        && (!unlock.expires_at || Date.parse(unlock.expires_at) > Date.now())
      ));
  }

  function defaultCatalogueMode(access, activePlan) {
    if (!activePlan && hasActiveIndividualTableau(access)) {
      return TABLEAUX_CATALOGUE_MODES.INDIVIDUAL;
    }
    return TABLEAUX_CATALOGUE_MODES.COLLECTIVE;
  }

  function activeCollectivePlan(access, collectivePlans) {
    const subscription = activeSubscriptionForAccess(access);
    if (!subscription) return null;
    return collectivePlans.find((plan) => (
      String(plan?.slug || '') === String(subscription.plan_slug || '')
    )) || null;
  }

  function planDisplayName(plan) {
    return String(
      window.cidTranslation?.field?.(plan, 'display_name', '')
      || plan?.display_name
      || plan?.slug
      || ''
    ).trim();
  }

  function setPortfolioCatalogueVisibility(portfolio, visible, mode) {
    if (!portfolio) return;
    portfolio.hidden = !visible;
    portfolio.setAttribute('aria-hidden', String(!visible));
    portfolio.dataset.tableauxCatalogueMode = visible ? mode : '';
    /*
     * The legacy stylesheet has several highly-specific display rules for
     * the portfolio cards. The explicit hidden attribute is reinforced by a
     * data marker so the active catalogue remains unambiguous to both CSS
     * and assistive technology while switching tabs.
     */
    portfolio.toggleAttribute('data-tableaux-catalogue-visible', visible);
  }

  function activeSubscriptionForAccess(access) {
    const subscription = access?.subscription;
    if (!subscription || subscription.status !== 'active') return null;
    if (subscription.started_at
      && Date.parse(subscription.started_at) > Date.now()) return null;
    if (subscription.expires_at) {
      const expiresAt = Date.parse(subscription.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    }
    return subscription;
  }

  function configuredTableauEntries(access) {
    const entries = new Map();
    const add = (featureKey, displayName = '', theme = null) => {
      const key = normalizeTableauxFeature(featureKey);
      if (!key.startsWith('tableaux-')) return;
      const cleanName = String(displayName || '').trim();
      const current = entries.get(key);
      if (!current || (!current.displayName && cleanName)) {
        entries.set(key, {
          featureKey: key,
          displayName: cleanName,
          theme: theme && typeof theme === 'object' ? theme : null
        });
      } else if (current && !current.theme && theme && typeof theme === 'object') {
        current.theme = theme;
      }
    };

    /*
     * The feature rules are the authoritative names for Tableaux. Grid
     * assignments are merged only to cover wildcard offers and installations
     * where a plan was configured before its individual rule was created.
     */
    (Array.isArray(access?.rules) ? access.rules : []).forEach((rule) => {
      add(
        rule?.feature_key || rule?.featureKey,
        rule?.display_name,
        rule?.theme
      );
    });
    (Array.isArray(access?.gridAssignments) ? access.gridAssignments : [])
      .filter((assignment) => assignment?.enabled !== false)
      .forEach((assignment) => {
        const key = String(assignment?.grid_key || '').trim();
        if (key) {
          add(
            key.startsWith('tableaux-') ? key : `tableaux-${key}`,
            assignment.display_name,
            assignment.theme
          );
        }
      });
    (Array.isArray(access?.plans) ? access.plans : []).forEach((plan) => {
      (Array.isArray(plan?.features) ? plan.features : []).forEach((feature) => {
        const normalized = normalizeTableauxFeature(feature);
        if (normalized !== 'tableaux') {
          add(normalized, '', feature?.theme || plan?.theme);
        }
      });
    });
    return Array.from(entries.values()).sort((left, right) => (
      left.displayName.localeCompare(right.displayName, uiLocale(), { sensitivity: 'base' })
      || left.featureKey.localeCompare(right.featureKey)
    ));
  }

  function validThemeColor(value) {
    const color = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : '';
  }

  function themeFromConfiguredEntry(access, featureKey) {
    const normalized = normalizeTableauxFeature(featureKey);
    const entry = configuredTableauEntries(access)
      .find((item) => item.featureKey === normalized);
    const custom = entry?.theme;
    if (!custom || typeof custom !== 'object') return null;
    const accent = validThemeColor(custom.accent || custom.primary || custom.color);
    const background = validThemeColor(custom.background || custom.surface);
    const text = validThemeColor(custom.text || custom.foreground);
    if (!accent && !background && !text) return null;
    const customAccent = accent || background || TABLEAUX_THEME_PRESETS.blue.accent;
    return {
      ...(TABLEAUX_THEME_PRESETS.blue),
      key: 'custom',
      accent: customAccent,
      accentStrong: accent || background || TABLEAUX_THEME_PRESETS.blue.accentStrong,
      tint: `color-mix(in srgb, ${customAccent} 16%, transparent)`,
      tintStrong: `color-mix(in srgb, ${customAccent} 26%, transparent)`,
      ink: text || TABLEAUX_THEME_PRESETS.blue.ink,
      contrast: text || TABLEAUX_THEME_PRESETS.blue.contrast
    };
  }

  function tableauThemeForFeature(access, featureKey) {
    const configured = themeFromConfiguredEntry(access, featureKey);
    if (configured) return configured;
    const key = normalizeTableauxFeature(featureKey);
    return TABLEAUX_THEME_PRESETS[
      TABLEAUX_THEME_BY_FEATURE[key] || 'blue'
    ];
  }

  function applyPortfolioSurfaceTheme(portfolio, access) {
    if (!portfolio) return null;
    const theme = tableauThemeForFeature(access, featureKeyForPortfolio(portfolio));
    portfolio.dataset.tableauxTheme = theme.key;
    Object.entries({
      '--tableaux-panel-color': theme.accent,
      '--tableaux-panel-color-strong': theme.accentStrong,
      '--tableaux-panel-tint': theme.tint,
      '--tableaux-panel-tint-strong': theme.tintStrong,
      '--tableaux-panel-ink': theme.ink,
      '--tableaux-panel-contrast': theme.contrast,
      '--tableaux-action-color': theme.accent,
      '--tableaux-action-color-strong': theme.accentStrong,
      '--tableaux-action-contrast': theme.contrast
    }).forEach(([property, value]) => {
      portfolio.style.setProperty(property, value);
    });
    return theme;
  }

  function isPlanActive(access, plan) {
    const subscription = activeSubscriptionForAccess(access);
    return Boolean(
      subscription
      && String(subscription.plan_slug || '') === String(plan?.slug || '')
    );
  }

  function collectivePlansForAccess(access) {
    const active = activeSubscriptionForAccess(access);
    const plans = (Array.isArray(access?.plans) ? access.plans : []).filter((plan) => (
      (plan?.enabled !== false
        || String(plan?.slug || '') === String(active?.plan_slug || ''))
      &&
      Array.isArray(plan?.features)
      && plan.features.some((feature) => (
        normalizeTableauxFeature(feature) === 'tableaux'
        || normalizeTableauxFeature(feature).startsWith('tableaux-')
      ))
    ));
    return plans.slice().sort((left, right) => (
      Number(isPlanActive(access, right)) - Number(isPlanActive(access, left))
      || (Number(left?.sort_order ?? left?.position ?? 0)
        - Number(right?.sort_order ?? right?.position ?? 0))
      || String(left?.display_name || left?.slug || '').localeCompare(
        String(right?.display_name || right?.slug || ''),
        uiLocale(),
        { sensitivity: 'base' }
      )
    ));
  }

  function portfolioInCatalogue(portfolio, access, mode, selectedPlan = null) {
    const featureKey = featureKeyForPortfolio(portfolio);
    if (!featureKey) return false;
    if (mode === TABLEAUX_CATALOGUE_MODES.COLLECTIVE) {
      return Boolean(
        selectedPlan && tableauxPlanIncludesFeature(selectedPlan, featureKey)
      );
    }
    const source = tableauAccessSource(access, featureKey);
    return source.individualConfigured;
  }

  /*
   * Prices and access modes are public catalogue data. When no entitlement
   * snapshot carries them (signed out, account switch, a request still in
   * flight) the cards are painted from the cached public catalogue, with no
   * grant at all, so a visitor always sees every Tableau with its price and
   * its Débloquer button instead of an empty catalogue.
   */
  function withPublicCatalogue(access) {
    if (Array.isArray(access?.rules) && access.rules.length) return access;
    const config = window.cidSiteConfig?.state?.();
    const publicRules = Array.isArray(config?.accessRules) ? config.accessRules : [];
    const publicPlans = Array.isArray(config?.plans) ? config.plans : [];
    if (!publicRules.length && !publicPlans.length) return access;
    return {
      ...(access || {}),
      plans: Array.isArray(access?.plans) && access.plans.length
        ? access.plans
        : publicPlans,
      rules: publicRules,
      subscription: access?.subscription || null,
      activePlan: access?.activePlan || null,
      featureUnlocks: Array.isArray(access?.featureUnlocks) ? access.featureUnlocks : [],
      tokens: parseAmount(access?.tokens),
      stars: parseAmount(access?.stars)
    };
  }

  function renderTableauxSections(entitlement) {
    const ui = tableauxViewUi();
    if (!ui) return;
    const access = withPublicCatalogue(entitlement);
    currentAccessState = access;
    ui.view.dataset.tableauxMode = 'all';
    const collectivePlans = collectivePlansForAccess(access);
    const configuredModes = {
      individual: Object.values(PORTFOLIO_SELECTORS).some((selector) => (
        Array.from(ui.view.querySelectorAll(selector)).some((portfolio) => (
          portfolioInCatalogue(portfolio, access, 'individual')
        ))
      )),
      collective: collectivePlans.length > 0
    };
    const currentMode = ui.view.dataset.tableauxCatalogueMode;
    const activePlan = activeCollectivePlan(access, collectivePlans);
    /*
     * Once the visitor has chosen a catalogue, keep it even when it is
     * empty. Falling back to the other catalogue would make an individual
     * click appear to show collective content (and vice versa).
     */
    const mode = ui.view.dataset.tableauxCatalogueChosen === 'true'
      && Object.values(TABLEAUX_CATALOGUE_MODES).includes(currentMode)
      ? currentMode
      : defaultCatalogueMode(access, activePlan);
    ui.view.dataset.tableauxCatalogueMode = mode;
    const activeFeature = normalizeTableauxFeature(
      ui.view.dataset.tableauxActiveFeature || ''
    );
    /*
     * A subscriber's active plan is the main scroll flow: only that plan
     * and its Tableaux are shown until the visitor asks for the other
     * formulas from the end of the page.
     */
    const focusActivePlan = Boolean(
      activePlan
      && mode === TABLEAUX_CATALOGUE_MODES.COLLECTIVE
      && ui.view.dataset.tableauxShowAllOffers !== 'true'
    );
    const selectedPlan = focusActivePlan
      ? activePlan
      : mode === TABLEAUX_CATALOGUE_MODES.COLLECTIVE
      ? (
        (activeFeature
          && collectivePlans.find((plan) => (
            tableauxPlanIncludesFeature(plan, activeFeature)
          )))
        || collectivePlans.find((plan) => (
          String(plan.slug) === String(ui.view.dataset.tableauxCollectivePlan || '')
        ))
        || collectivePlans[0]
        || null
      )
      : null;
    const verifiedFeatures = Array.isArray(access?.__serverVerifiedTableaux)
      ? new Set(access.__serverVerifiedTableaux)
      : null;
    const portfolioSelector = [
      '.portfolio-universal',
      '.portfolio-intuition',
      '.portfolio-oracle',
      '.portfolio-manual',
      '.portfolio-lnb',
      '.portfolio-standby',
      '#createdProgramPortfolios'
    ].join(', ');
    const portfolios = Array.from(ui.stack.children)
      .filter((portfolio) => (
        portfolio.matches?.(portfolioSelector)
        && portfolioInCatalogue(portfolio, access, mode, selectedPlan)
      ));
    const allPortfolios = Array.from(ui.stack.children)
      .filter((portfolio) => portfolio.matches?.(portfolioSelector));
    ui.stack.querySelector('.tableaux-catalogue-empty')?.remove();
    allPortfolios.forEach((portfolio) => {
      const visible = portfolioInCatalogue(
        portfolio,
        access,
        mode,
        selectedPlan
      );
      setPortfolioCatalogueVisibility(portfolio, visible, mode);
      applyPortfolioSurfaceTheme(portfolio, access);
    });
    if (!portfolios.length) {
      ui.stack.insertAdjacentHTML(
        'beforeend',
        `<p class="tableaux-catalogue-empty"
            data-tableaux-empty-mode="${mode}"
            role="status">
          Aucun Tableau n’est configuré dans ce catalogue.
        </p>`
      );
    }
    const unlocked = portfolios.filter((portfolio) => (
      canAccessTableauxFeature(
        featureKeyForPortfolio(portfolio),
        access,
        verifiedFeatures
      )
    ));
    const locked = portfolios.filter((portfolio) => !unlocked.includes(portfolio));
    /*
     * Keep every configured Tableau in the document. Hiding locked cards
     * behind a secondary "Découvrir" action makes the purchase control
     * disappear exactly when a visitor changes account or loses an
     * entitlement. Each locked card must remain visible with its current
     * access/purchase state.
     */
    const showAll = true;
    const priority = unlocked.filter((portfolio) => (
      featureKeyForPortfolio(portfolio) === priorityFeatureKey
    ));
    const unlockedWithoutPriority = unlocked.filter((portfolio) => (
      !priority.includes(portfolio)
    ));
    [...priority, ...unlockedWithoutPriority, ...locked].forEach((portfolio) => {
      ui.stack.appendChild(portfolio);
      const isLocked = locked.includes(portfolio);
      setPortfolioCatalogueVisibility(
        portfolio,
        !isLocked || showAll,
        mode
      );
    });
    const activePlanName = planDisplayName(activePlan);
    const eyebrow = focusActivePlan
      ? `Votre abonnement${activePlanName ? ` ${activePlanName}` : ''}`
      : unlocked.length
        ? `Vos tableaux — ${catalogueModeLabel(mode)}`
        : catalogueModeLabel(mode);
    const caption = focusActivePlan
      ? 'Les Tableaux inclus dans votre abonnement sont affichés ci-dessous. Les autres formules restent accessibles en bas de page.'
      : mode === TABLEAUX_CATALOGUE_MODES.INDIVIDUAL
        ? 'Débloquez chaque Tableau au cas par cas. Les accès actifs apparaissent en premier.'
        : unlocked.length
          ? 'Les accès actifs apparaissent en premier. Les autres restent visibles avec leur mode d’accès.'
          : 'Choisissez un abonnement collectif pour accéder à plusieurs Tableaux à la fois.';
    ui.header.innerHTML = `
      <span class="tableaux-sections-eyebrow">${escapeAccessHtml(eyebrow)}</span>
      <h1 id="tableauxSectionsTitle">Tableaux</h1>
      ${mode === TABLEAUX_CATALOGUE_MODES.INDIVIDUAL && collectivePlans.length
        ? `<button type="button"
                  class="tableaux-catalogue-back"
                  data-tableaux-catalogue="${TABLEAUX_CATALOGUE_MODES.COLLECTIVE}">
            ← Catalogue collectif
          </button>`
        : ''}
      ${mode === TABLEAUX_CATALOGUE_MODES.COLLECTIVE
        ? `<div class="tableaux-collective-offers"
                data-tableaux-public-offers
                data-tableaux-catalogue-only="${TABLEAUX_CATALOGUE_MODES.COLLECTIVE}"
                aria-label="Abonnements collectifs"></div>`
        : ''}
      <p class="tableaux-catalogue-caption">${escapeAccessHtml(caption)}</p>`;
    renderCatalogueFooter(ui, {
      mode,
      activePlan,
      activePlanName,
      focusActivePlan,
      hasCollectivePlans: collectivePlans.length > 0,
      hasOtherPlans: collectivePlans.some((plan) => plan !== activePlan)
    });
    const collectiveOffers = ui.header.querySelector('[data-tableaux-public-offers]');
    if (collectiveOffers) {
      const activeFeature = normalizeTableauxFeature(
        ui.view.dataset.tableauxActiveFeature || ''
      );
      collectiveOffers.dataset.tableauxOnly = 'true';
      if (activeFeature) collectiveOffers.dataset.selectedFeature = activeFeature;
      if (typeof window.cidRenderPublicOffersFromAccess === 'function') {
        window.cidRenderPublicOffersFromAccess(access, collectiveOffers, {
          tableauxOnly: true,
          selectedFeature: activeFeature,
          onlyPlanSlug: focusActivePlan ? activePlan.slug : ''
        });
      } else {
        window.cidRenderPublicOffers?.(collectiveOffers, {
          tableauxOnly: true,
          selectedFeature: activeFeature,
          onlyPlanSlug: focusActivePlan ? activePlan.slug : ''
        });
      }
    }
    ui.view.querySelectorAll(
      '#tableauxPageHeader [data-tableaux-catalogue], #tableauxCatalogueFooter [data-tableaux-catalogue]'
    ).forEach((button) => {
      button.addEventListener('click', () => {
        const nextMode = button.dataset.tableauxCatalogue;
        if (!Object.values(TABLEAUX_CATALOGUE_MODES).includes(nextMode)) return;
        chooseCatalogueMode(ui.view, nextMode);
        ui.view.dataset.tableauxActiveFeature = '';
        delete ui.view.dataset.tableauxCollectivePlan;
        if (button.dataset.tableauxOffers === 'all') {
          ui.view.dataset.tableauxShowAllOffers = 'true';
        } else if (button.dataset.tableauxOffers === 'active') {
          delete ui.view.dataset.tableauxShowAllOffers;
        }
        ui.view.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
        renderTableauxSections(currentAccessState);
      });
    });
    allPortfolios.forEach((portfolio) => {
      if (!portfolioInCatalogue(portfolio, access, mode, selectedPlan)) return;
      renderPortfolioAccessBadge(
        portfolio,
        canAccessTableauxFeature(
          featureKeyForPortfolio(portfolio),
          access,
          verifiedFeatures
        ),
        PORTFOLIO_LABELS[
          Object.keys(PORTFOLIO_SELECTORS).find((id) => (
            portfolio.matches(PORTFOLIO_SELECTORS[id])
          ))
        ] || featureKeyForPortfolio(portfolio)
      );
    });
    ui.stack.querySelectorAll(
      '.portfolio-universal, .portfolio-intuition, .portfolio-oracle, ' +
      '.portfolio-manual, .portfolio-lnb, .portfolio-standby, ' +
      '#createdProgramPortfolios'
    ).forEach((portfolio) => {
      portfolio.dataset.tableauxProgram = portfolio.dataset.tableauxProgram
        || featureKeyForPortfolio(portfolio)?.replace('tableaux-', '')
        || '';
    });
  }

  /*
   * End-of-scroll suggestions. The active content is the main flow; the
   * other catalogue and the other formulas are offered here, discreetly,
   * once the visitor has seen what they already have.
   */
  function renderCatalogueFooter(ui, {
    mode,
    activePlan,
    activePlanName,
    focusActivePlan,
    hasCollectivePlans,
    hasOtherPlans
  }) {
    let footer = ui.view.querySelector('#tableauxCatalogueFooter');
    if (!footer) {
      footer = document.createElement('footer');
      footer.id = 'tableauxCatalogueFooter';
      footer.className = 'tableaux-catalogue-footer';
    }
    ui.stack.after(footer);
    const collective = TABLEAUX_CATALOGUE_MODES.COLLECTIVE;
    const individual = TABLEAUX_CATALOGUE_MODES.INDIVIDUAL;
    const suggestion = (label, catalogue, offers = '', primary = false) => `
      <button type="button"
              class="tableaux-footer-button${primary ? ' is-primary' : ''}"
              data-tableaux-catalogue="${catalogue}"
              ${offers ? `data-tableaux-offers="${offers}"` : ''}>
        ${escapeAccessHtml(label)}
      </button>`;
    const suggestions = [];
    let note = '';
    if (mode === collective && focusActivePlan) {
      note = 'Envie d’explorer d’autres options ?';
      if (hasOtherPlans) {
        suggestions.push(suggestion('Débloquer d’autres abonnements', collective, 'all', true));
        suggestions.push(suggestion('Voir les autres formules', collective, 'all'));
      }
    } else if (mode === collective && activePlan) {
      note = 'Toutes les formules sont affichées.';
      suggestions.push(suggestion(
        `Revenir à votre abonnement${activePlanName ? ` ${activePlanName}` : ''}`,
        collective,
        'active',
        true
      ));
    } else if (mode === individual && hasCollectivePlans) {
      note = 'Accédez à plusieurs Tableaux en une seule formule.';
      suggestions.push(suggestion(
        activePlan ? `Revenir à votre abonnement${activePlanName ? ` ${activePlanName}` : ''}` : 'Voir les abonnements collectifs',
        collective,
        activePlan ? 'active' : '',
        true
      ));
    }
    const quickSwitch = mode === collective
      ? `<p class="tableaux-catalogue-switch">
          Vous préférez un déblocage au cas par cas ?
          <button type="button"
                  class="tableaux-catalogue-switch__button"
                  data-tableaux-catalogue="${individual}">
            Voir les tableaux individuels
          </button>
        </p>`
      : '';
    footer.innerHTML = `
      ${suggestions.length
        ? `<div class="tableaux-catalogue-suggestions">
            ${note ? `<p>${escapeAccessHtml(note)}</p>` : ''}
            <div class="tableaux-catalogue-suggestions__actions">${suggestions.join('')}</div>
          </div>`
        : ''}
      ${quickSwitch}`;
    footer.hidden = !footer.innerHTML.trim();
  }

  function setTableauxPortfolioMode(section) {
    const view = get(VIEW_ID);
    if (!view) return;
    const selected = new Set(Object.keys(PORTFOLIO_SELECTORS));
    Object.entries(PORTFOLIO_SELECTORS).forEach(([id, selector]) => {
      const portfolio = view.querySelector(selector);
      if (!portfolio) return;
      portfolio.dataset.tableauxProgram = id;
      portfolio.hidden = !selected.has(id);
      portfolio.setAttribute('aria-hidden', String(portfolio.hidden));
    });
    const created = view.querySelector('#createdProgramPortfolios');
    if (created) {
      created.dataset.tableauxProgram = 'created';
      created.hidden = !selected.has('created');
      created.setAttribute('aria-hidden', String(created.hidden));
    }
  }

  function renderPlans(plans) {
    plans.forEach((plan) => {
      const portfolio = getPortfolio(plan);
      if (!portfolio) return;
      const containers = portfolio.querySelectorAll(':scope > .container');
      const keyCard = containers[0];
      const crossCard = containers[1];
      if (!keyCard) return;

      const date = formatDate(currentDate);
      keyCard.querySelectorAll('.date').forEach((element) => { element.textContent = date; });
      const key = keyCard.querySelector('.key-container .numbers');
      const order = keyCard.querySelector('.order-container .numbers');
      if (key) key.textContent = valueOrLocked(plan.key, LOCKED_KEY_VALUE);
      if (order) order.textContent = valueOrLocked(plan.order, LOCKED_KEY_VALUE);

      const infoValues = keyCard.querySelectorAll('.key-info strong');
      // The public payload intentionally contains no magicRule or calculation
      // trace. The table only renders the validated code returned by the
      // server.
      const universalCode = valueOrLocked(plan.code);
      [universalCode, plan.filter, plan.addition].forEach((value, index) => {
        if (infoValues[index]) {
          infoValues[index].textContent = valueOrLocked(value);
        }
      });

      if (crossCard) {
        crossCard.querySelectorAll('.date').forEach((element) => { element.textContent = date; });
        const cross = crossCard.querySelector('.cross');
        if (!cross) return;
        const values = {
          '.cross-number-1': valueOrLocked(plan.cross?.top, LOCKED_CROSS.top),
          '.cross-number-2': valueOrLocked(plan.cross?.bottom, LOCKED_CROSS.bottom),
          '.cross-number-3': valueOrLocked(plan.cross?.right, LOCKED_CROSS.right),
          '.cross-number-6': valueOrLocked(plan.cross?.left, LOCKED_CROSS.left)
        };
        Object.entries(values).forEach(([selector, value]) => {
          const element = cross.querySelector(selector);
          if (!element) return;
          element.textContent = value;
          element.classList.toggle(
            'balsa-white-digit',
            String(value).trim() === '4'
              || String(value).trim() === '6'
          );
        });
        cross.querySelectorAll('.cross-base-numbers, .cross-base-number')
          .forEach((element) => element.remove());
      }
    });
  }

  function tableauxRule(featureKey, access = currentAccessState) {
    const key = normalizeTableauxFeature(featureKey);
    const configured = access?.rules?.find((rule) => (
      normalizeTableauxFeature(rule?.feature_key || rule?.featureKey) === key
    ));
    if (configured) return configured;
    const program = TABLEAUX_PROGRAMS.find((item) => item.featureKey === key);
    const fallback = window.cidSiteConfig?.lockFor?.({
      type: 'tableaux',
      key: program?.id || key
    });
    return fallback || {
      feature_key: key,
      display_name: program?.label || key.replace(/^tableaux-/, ''),
      unlock_currency: 'tokens',
      required_tokens: 1,
      required_stars: 0,
      enabled: true
    };
  }

  function tableauxPlanIncludesFeature(plan, featureKey) {
    const key = normalizeTableauxFeature(featureKey);
    const features = Array.isArray(plan?.features)
      ? plan.features.map(normalizeTableauxFeature)
      : [];
    return features.includes(key) || (
      features.includes('tableaux')
      && key.startsWith('tableaux-')
    );
  }

  function tableauAccessSource(access, featureKey) {
    const key = normalizeTableauxFeature(featureKey);
    const configuredRule = access?.rules?.find((item) => (
      normalizeTableauxFeature(item?.feature_key || item?.featureKey) === key
    )) || null;
    const rule = configuredRule || tableauxRule(key, access);
    const required = Math.max(
      parseAmount(rule?.required_tokens),
      parseAmount(rule?.required_stars)
    );
    const individualConfigured = Boolean(
      configuredRule && !configuredRule.plan_slug
    );
    const collectiveConfigured = (Array.isArray(access?.plans) ? access.plans : [])
      .some((plan) => tableauxPlanIncludesFeature(plan, key));
    const collectivePlans = (Array.isArray(access?.plans) ? access.plans : [])
      .filter((plan) => tableauxPlanIncludesFeature(plan, key));
    const individualActive = Boolean(
      access?.featureUnlocks?.some((unlock) => (
        normalizeTableauxFeature(unlock?.feature_key || unlock?.featureKey) === key
        && (!unlock.expires_at || Date.parse(unlock.expires_at) > Date.now())
      ))
    );
    const subscription = access?.subscription;
    const subscriptionActive = subscription?.status === 'active'
      && (!subscription.started_at || Date.parse(subscription.started_at) <= Date.now())
      && (!subscription.expires_at || Date.parse(subscription.expires_at) > Date.now());
    const collectiveActive = Boolean(
      subscriptionActive
      && (
        tableauxPlanIncludesFeature(access?.activePlan, key)
        || access?.rules?.some((item) => (
          normalizeTableauxFeature(item?.feature_key || item?.featureKey) === key
          && item.plan_slug === access?.activePlan?.slug
        ))
      )
    );

    let label = 'Accès requis';
    const activePlanName = access?.activePlan?.display_name
      || access?.activePlan?.slug
      || '';
    const configuredPlanNames = collectivePlans
      .map((plan) => plan.display_name || plan.slug)
      .filter(Boolean)
      .join(' · ');
    if (individualActive && collectiveActive) {
      label = 'Individuel + abonnement';
    } else if (individualActive) {
      label = 'Déblocage individuel';
    } else if (collectiveActive) {
      label = 'Abonnement collectif';
    } else if (!individualConfigured && !collectiveConfigured) {
      label = 'Accès libre';
    } else if (individualConfigured && collectiveConfigured) {
      label = 'Individuel ou abonnement';
    } else if (collectiveConfigured) {
      label = 'Abonnement collectif';
    } else if (individualConfigured) {
      label = 'Déblocage individuel';
    }

    return {
      label,
      individualActive,
      collectiveActive,
      individualConfigured,
      collectiveConfigured,
      planName: activePlanName || configuredPlanNames
    };
  }

  function isFreeTableauxFeature(featureKey, access) {
    if (!access) return false;
    const key = normalizeTableauxFeature(featureKey);
    const rule = access?.rules?.find((item) => (
      normalizeTableauxFeature(item?.feature_key || item?.featureKey) === key
    ));
    const plans = Array.isArray(access?.plans) ? access.plans : [];
    const configuredInOffer = plans.some((plan) =>
      tableauxPlanIncludesFeature(plan, key)
    );
    if (!rule && !configuredInOffer) return true;
    return Boolean(
      rule
      && rule.enabled !== false
      && !rule.plan_slug
      && parseAmount(rule.required_stars) <= 0
      && parseAmount(rule.required_tokens) <= 0
      && !configuredInOffer
    );
  }

  function canAccessTableauxFeature(featureKey, access, verifiedFeatures = null) {
    if (isVerifiedTableauxAdmin()) return true;
    const key = normalizeTableauxFeature(featureKey);
    /*
     * The RPC preflight is an extra server check, not a replacement for the
     * freshly loaded entitlement snapshot. During a session refresh Supabase
     * can legitimately answer with an empty set (for example while the RPC
     * schema cache is catching up) even though subscription-access has just
     * confirmed an individual unlock. Treating that transient empty set as a
     * revocation leaves the card active-but-masked and prevents its protected
     * function from ever being called. The Edge Function still performs the
     * authoritative check before returning any values.
     */
    /*
     * Do not hide an explicit local entitlement based on a stale preflight
     * set. The following protected function call is still mandatory and is
     * the final authority; if it rejects the request it returns masked data.
     */
    if (isFreeTableauxFeature(key, access)) return true;
    const individuallyUnlocked = Boolean(access?.featureUnlocks?.some((unlock) => (
      normalizeTableauxFeature(unlock?.feature_key || unlock?.featureKey) === key
      && (!unlock.expires_at || Date.parse(unlock.expires_at) > Date.now())
    )));
    if (individuallyUnlocked) return true;
    // A grant cached today after a verified unlock keeps the card open
    // without waiting for a fresh entitlement read.
    if (hasDailyTableauGrant(key)) return true;
    const subscription = access?.subscription;
    const activeSubscription = subscription?.status === 'active'
      && (
        !subscription.started_at
        || Date.parse(subscription.started_at) <= Date.now()
      )
      && (
        !subscription.expires_at
        || Date.parse(subscription.expires_at) > Date.now()
      );
    return Boolean(
      activeSubscription
      && (
        tableauxPlanIncludesFeature(access?.activePlan, key)
        || access?.rules?.some((rule) => (
          normalizeTableauxFeature(rule?.feature_key || rule?.featureKey) === key
          && rule.plan_slug === access?.activePlan?.slug
        ))
      )
    );
  }

  async function verifyTableauxAccessSet() {
    const keys = TABLEAUX_PROGRAMS.map((program) => program.featureKey);
    const checks = await Promise.all(keys.map(async (key) => (
      [key, await withBudget(window.cidFeatureAccess?.verifyTableauxAccess?.(key)).catch(() => undefined)]
    )));
    return new Set(checks.filter(([, allowed]) => allowed).map(([key]) => key));
  }

  function accessGrantSignature(access) {
    // Locked programmes are never fetched, so both entitlement sources must
    // trigger a re-render: individual grants and the collective subscription.
    const individual = (access?.featureUnlocks || [])
      .map((unlock) => `${unlock.feature_key}:${unlock.expires_at || ''}`)
      .sort()
      .join('|');
    const subscription = access?.subscription;
    const collective = subscription?.status === 'active'
      ? `${subscription.plan_slug || access?.activePlan?.slug || ''}:${subscription.expires_at || ''}`
      : '';
    return `${individual}#${collective}`;
  }

  function tableauAccessExpiry(access, featureKey) {
    if (!access || isVerifiedTableauxAdmin()) return null;
    const key = normalizeTableauxFeature(featureKey);
    const dates = [];
    const grants = (access.featureUnlocks || []).filter((unlock) => (
      normalizeTableauxFeature(unlock?.feature_key || unlock?.featureKey) === key
      && (!unlock.expires_at || Date.parse(unlock.expires_at) > Date.now())
    ));
    if (grants.some((grant) => !grant.expires_at)) return null;
    grants.forEach((grant) => dates.push(grant.expires_at));

    const subscription = access.subscription;
    const planCoversFeature = tableauxPlanIncludesFeature(access.activePlan, key)
      || access.rules?.some((rule) => (
        normalizeTableauxFeature(rule?.feature_key || rule?.featureKey) === key
        && rule.plan_slug === access.activePlan?.slug
      ));
    if (subscription?.status === 'active' && planCoversFeature) {
      if (!subscription.expires_at) return null;
      if (Date.parse(subscription.expires_at) > Date.now()) {
        dates.push(subscription.expires_at);
      }
    }
    return dates
      .filter(Boolean)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;
  }

  function accessExpiryLabel(value) {
    const timestamp = Date.parse(value || '');
    if (!Number.isFinite(timestamp)) return '';
    return new Intl.DateTimeFormat(uiLocale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Africa/Abidjan'
    }).format(new Date(timestamp));
  }

  function remainingAccessDays(value) {
    const timestamp = Date.parse(value || '');
    if (!Number.isFinite(timestamp)) return null;
    return Math.max(0, Math.ceil((timestamp - Date.now()) / 86400000));
  }

  function renewalDates(access, featureKey, rule) {
    const durationDays = Math.max(
      1,
      Math.trunc(Number(rule?.duration_days) || 30)
    );
    const currentExpiry = tableauAccessExpiry(access, featureKey);
    const start = currentExpiry && Date.parse(currentExpiry) > Date.now()
      ? new Date(currentExpiry)
      : new Date();
    start.setUTCDate(start.getUTCDate() + durationDays);
    return {
      durationDays,
      currentExpiry,
      nextExpiry: start.toISOString()
    };
  }

  function markAccessElement(element, allowed, label) {
    if (!element) return;
    element.hidden = false;
    element.setAttribute('aria-hidden', 'false');
    element.setAttribute('aria-disabled', String(!allowed));
    element.classList.toggle('tableaux-access-locked', !allowed);
    element.dataset.tableauxAccessState = allowed ? 'available' : 'locked';
    element.title = allowed
      ? `${label} — schéma débloqué`
      : `${label} — schéma verrouillé`;
  }

  // Same key resolution as the history view, so its archive opens on the
  // nine publications of this exact Tableau.
  function historyFeatureKey(portfolio) {
    const raw = portfolio?.dataset?.tableauxAccess
      || portfolio?.dataset?.tableauxFeature
      || (portfolio?.dataset?.tableauxProgram
        ? `tableaux-${portfolio.dataset.tableauxProgram}`
        : '')
      || (portfolio?.id === 'createdProgramPortfolios' ? 'tableaux-created' : '')
      || featureKeyForPortfolio(portfolio);
    const key = normalizeTableauFeatureKey(raw);
    return key && key !== 'tableaux-' ? key : '';
  }

  /*
   * "Voir l’historique" takes the free column next to the unlock card instead
   * of stacking under the Débloquer/Prolonger button. It is rendered here,
   * with the badge, so it is on screen on the first paint; the history view
   * itself (nine previous publications) is only downloaded on the first tap.
   */
  function appendHistorySlot(container, portfolio) {
    const slot = document.createElement('div');
    slot.className = 'tableaux-access-history';
    container.appendChild(slot);
    const featureKey = historyFeatureKey(portfolio);
    if (!featureKey) return slot;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tableaux-history-button';
    button.textContent = 'Voir l’historique';
    button.setAttribute('aria-label', 'Voir l’historique des 9 dernières publications');
    button.addEventListener('click', () => window.cidShowPublicationHistory?.({
      kind: 'tableaux',
      featureKey,
      returnTo: () => window.showTableauxView?.({ updateHistory: false })
    }));
    slot.appendChild(button);
    return slot;
  }

  /*
   * Origin of a running access, used to decide which controls a card shows:
   * a collective subscription (VIP, Général, Premium…) is managed globally,
   * an individual purchase is managed card by card. An individual grant wins
   * when both exist because its end date and renewal stay unitary.
   */
  const TABLEAUX_ACCESS_TYPES = Object.freeze({
    COLLECTIVE: 'abonnement_collectif',
    INDIVIDUAL: 'achat_individuel'
  });

  function tableauAccessType(accessSource, allowed) {
    if (!allowed) return null;
    if (accessSource?.individualActive) return TABLEAUX_ACCESS_TYPES.INDIVIDUAL;
    if (accessSource?.collectiveActive) return TABLEAUX_ACCESS_TYPES.COLLECTIVE;
    return null;
  }

  /*
   * Collective subscription card: data and "Voir l’historique" only. No
   * expiry, renewal, purchase or offer button is repeated on every card while
   * scrolling; the subscription itself is renewed from the collective offer.
   */
  function renderCollectiveAccessBadge(portfolio, badge, label, accessSource) {
    badge.classList.add('is-collective-access');
    const status = document.createElement('span');
    status.className = 'tableaux-access-status';
    status.innerHTML = `<strong>✓ ${escapeAccessHtml(label)}</strong>
      <small class="tableaux-access-source">Inclus dans votre abonnement${
        accessSource.planName ? ` ${escapeAccessHtml(accessSource.planName)}` : ''
      }</small>`;
    badge.appendChild(status);
    appendHistorySlot(badge, portfolio);
    return portfolio.insertBefore(badge, portfolio.firstElementChild);
  }

  function renderPortfolioAccessBadge(portfolio, allowed, label) {
    let badge = portfolio.querySelector(':scope > .tableaux-access-badge');
    if (!badge) {
      // Keep the status banner out of the div type used by the key/cross
      // cards. The Tableaux layout uses first-of-type/nth-of-type for those
      // two cards, so a div badge would shift their grid positions.
      badge = document.createElement('aside');
      badge.className = 'tableaux-access-badge';
      badge.setAttribute('role', 'status');
    }
    badge.classList.toggle('is-locked', !allowed);
    badge.classList.remove('is-collective-access');
    badge.replaceChildren();
    const featureKey = featureKeyForPortfolio(portfolio);
    const accessSource = tableauAccessSource(currentAccessState, featureKey);
    const accessType = tableauAccessType(accessSource, allowed);
    if (accessType) {
      badge.dataset.tableauxAccessType = accessType;
      portfolio.dataset.tableauxAccessType = accessType;
    } else {
      delete badge.dataset.tableauxAccessType;
      delete portfolio.dataset.tableauxAccessType;
    }
    if (accessType === TABLEAUX_ACCESS_TYPES.COLLECTIVE) {
      return renderCollectiveAccessBadge(portfolio, badge, label, accessSource);
    }
    const status = document.createElement('span');
    const rule = tableauxRule(featureKey);
    const currency = rule?.unlock_currency === 'stars' ? 'étoiles' : 'jetons';
    const required = rule?.unlock_currency === 'stars'
      ? Math.max(0, parseAmount(rule?.required_stars))
      : Math.max(0, parseAmount(rule?.required_tokens));
    const isPaid = required > 0;
    const catalogueMode = get(VIEW_ID)?.dataset.tableauxCatalogueMode || 'individual';
    const collectiveCatalogue = catalogueMode === TABLEAUX_CATALOGUE_MODES.COLLECTIVE;
    const modeAccessLabel = collectiveCatalogue
      ? accessSource.label
      : accessSource.individualActive
        ? 'Déblocage individuel actif'
        : 'Déblocage individuel';
    const individualPurchasePending = Boolean(
      accessSource.individualConfigured && !accessSource.individualActive
    );
    const expiry = allowed
      ? tableauAccessExpiry(currentAccessState, featureKey)
      : null;
    const daysRemaining = remainingAccessDays(expiry);
    status.className = 'tableaux-access-status';
    status.innerHTML = allowed
      ? `<strong>✓ ${escapeAccessHtml(label)} · Actif</strong>
         <small class="tableaux-access-source">Mode d’accès : ${escapeAccessHtml(modeAccessLabel)}</small>
         <small>${expiry
         ? `Expire le ${escapeAccessHtml(accessExpiryLabel(expiry))} · ${daysRemaining} jour${daysRemaining === 1 ? '' : 's'} restant${daysRemaining === 1 ? '' : 's'}`
           : isPaid
             ? 'Accès sans date de fin'
             : individualPurchasePending
               ? `Prix : ${formatAccessAmount(required)} ${escapeAccessHtml(currency)}`
               : 'Accès libre'}</small>`
        : isPaid
        ? `<strong>🔒 ${escapeAccessHtml(label)} · ${required} ${currency}</strong>
           <small class="tableaux-access-source">Mode d’accès : ${escapeAccessHtml(modeAccessLabel)}</small>`
        : individualPurchasePending
        ? `<strong>🔒 ${escapeAccessHtml(label)} · Déblocage individuel</strong>
           <small class="tableaux-access-source">Mode d’accès : ${escapeAccessHtml(modeAccessLabel)} · Prix : ${formatAccessAmount(required)} ${escapeAccessHtml(currency)}</small>`
        : `<strong>🔓 ${escapeAccessHtml(label)} · Accès libre</strong>
           <small class="tableaux-access-source">Mode d’accès : ${escapeAccessHtml(modeAccessLabel)}</small>`;
    badge.appendChild(status);
    const modes = document.createElement('div');
    modes.className = 'tableaux-access-modes';
    const individualMode = document.createElement('div');
    individualMode.className = 'tableaux-access-mode tableaux-access-mode--individual';
    individualMode.innerHTML = `
      <strong>Individuel</strong>
      <small>${accessSource.individualActive
        ? 'Actif pour ce compte'
        : accessSource.individualConfigured
          ? 'Déblocage propre à l’utilisateur'
          : 'Non configuré'}</small>`;
    const collectiveMode = document.createElement('div');
    collectiveMode.className = 'tableaux-access-mode tableaux-access-mode--collective';
    collectiveMode.innerHTML = `
      <strong>Abonnement collectif</strong>
      <small>${accessSource.collectiveActive
        ? `Actif${accessSource.planName ? ` · ${escapeAccessHtml(accessSource.planName)}` : ''}`
        : accessSource.collectiveConfigured
          ? `Disponible${accessSource.planName ? ` · ${escapeAccessHtml(accessSource.planName)}` : ''}`
          : 'Non configuré'}</small>`;
    if (!collectiveCatalogue && (accessSource.individualConfigured || isPaid)) {
      modes.appendChild(individualMode);
    }
    if (collectiveCatalogue && accessSource.collectiveConfigured) {
      modes.appendChild(collectiveMode);
    }
    if (modes.childElementCount) badge.appendChild(modes);

    /*
     * `allowed` can come from a collective subscription while the individual
     * grant is still absent. The action label must follow the exact source
     * being displayed: Débloquer for a missing individual grant, Prolonger
     * when that grant is active. Never turn a collective entitlement into a
     * disabled “Actif” purchase button.
     */
    const individualIsActive = Boolean(accessSource.individualActive);
    /*
     * Any running paid access with an end date (individual grant or
     * collective plan) is extended, not bought again: the server adds the
     * period to the current end date, so the action reads "Prolonger".
     */
    const renewable = individualIsActive || Boolean(expiry);
    /*
     * An individual catalogue card is an individual sales surface. Keep its
     * purchase action present even when the same feature also belongs to a
     * collective plan; the collective offer is intentionally available only
     * from the separate Catalogue collectif tab.
     */
    const showIndividualPurchase = !collectiveCatalogue
      && accessSource.individualConfigured;
    if (collectiveCatalogue) {
      if (accessSource.collectiveConfigured && !accessSource.collectiveActive) {
        const collectiveButton = document.createElement('button');
        collectiveButton.type = 'button';
        collectiveButton.className = 'tableaux-button tableaux-button--secondary tableaux-subscription-button';
        collectiveButton.textContent = 'Voir les abonnements';
        collectiveButton.addEventListener('click', () => {
          const view = get(VIEW_ID);
          if (!view) return;
          chooseCatalogueMode(view, TABLEAUX_CATALOGUE_MODES.COLLECTIVE);
          view.dataset.tableauxShowAllOffers = 'true';
          view.dataset.tableauxActiveFeature = featureKey;
          view.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
          renderTableauxSections(currentAccessState);
        });
        collectiveMode.appendChild(collectiveButton);
      }
      appendHistorySlot(modes.childElementCount ? modes : badge, portfolio);
      return portfolio.insertBefore(badge, portfolio.firstElementChild);
    }
    if (!showIndividualPurchase) {
      appendHistorySlot(modes.childElementCount ? modes : badge, portfolio);
      return portfolio.insertBefore(badge, portfolio.firstElementChild);
    }

    const unlock = document.createElement('button');
    unlock.type = 'button';
    unlock.className = [
      'tableaux-button',
      'tableaux-button--primary',
      'tableaux-schema-unlock',
      'cid-buy-button'
    ].join(' ');
    // Tableaux are unlocked with virtual tokens; "Acheter" is reserved for
    // the token top-up itself.
    const actionLabel = renewable ? 'Prolonger ce tableau' : 'Débloquer';
    unlock.classList.toggle('is-renewal', renewable);
    unlock.innerHTML = renewable
      ? `<span>${actionLabel}</span><span class="cid-inline-cost" aria-hidden="true">${formatAccessAmount(required)} ${escapeAccessHtml(currency)}</span>`
      : `<span class="cid-token-icon" aria-hidden="true"></span><span>${actionLabel}</span><span class="cid-inline-cost" aria-hidden="true">${formatAccessAmount(required)} ${escapeAccessHtml(currency)}</span>`;
    unlock.disabled = false;
    unlock.setAttribute(
      'aria-label',
      `${renewable ? 'Prolonger' : 'Débloquer'} le tableau ${label} — coût ${formatAccessAmount(required)} ${currency}`
    );
    const actions = document.createElement('div');
    actions.className = 'tableaux-access-actions';
    const currentEnd = renewable
      ? tableauAccessExpiry(currentAccessState, featureKey)
      : null;
    if (currentEnd) {
      const expiryNote = document.createElement('p');
      expiryNote.className = 'tableaux-access-expiry';
      expiryNote.textContent = `Votre abonnement prend fin le ${accessExpiryLabel(currentEnd)}`;
      actions.appendChild(expiryNote);
    }
    unlock.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (unlock.dataset.confirming === 'true') return;
      unlock.dataset.confirming = 'true';
      unlock.disabled = true;
      unlock.setAttribute('aria-busy', 'true');

      try {
        // Visitors without an account see the price but must create one
        // before any balance can be checked or debited.
        const sessionUser = await Promise.resolve(
          window.cidCurrentSessionUser?.()
        ).catch(() => null);
        if (!sessionUser?.id) {
          await window.cidPromptAccountCreation?.({
            label,
            price: `${formatAccessAmount(required)} ${currency}`,
            trigger: unlock
          });
          return;
        }
        /*
         * Read the balance immediately before displaying the confirmation so
         * the numbers shown to the visitor are not an old page snapshot.
         * This is read-only; no debit happens in this step. The read is
         * forced so the balance comes from the database, not a cached copy.
         */
        const [refreshedAccess, quote] = await Promise.all([
          Promise.resolve(
            window.cidFeatureAccess?.refresh?.({ force: true })
          ).catch(() => null),
          fetchTableauxUnlockQuote(featureKey)
        ]);
        const access = refreshedAccess && typeof refreshedAccess === 'object'
          ? refreshedAccess
          : currentAccessState || {};
        if (refreshedAccess && typeof refreshedAccess === 'object') {
          currentAccessState = refreshedAccess;
        }
        const liveRule = tableauxRule(featureKey, access);
        const decision = await requestTableauxUnlockConfirmation({
          label,
          rule: liveRule,
          access,
          featureKey,
          trigger: unlock,
          quote
        });
        if (decision?.buyTokens) {
          const currency = liveRule?.unlock_currency === 'stars'
            ? 'stars'
            : 'tokens';
          const missing = Math.max(
            1,
            Math.trunc(Number(decision.missing) || 0)
          );
          window.cidOpenBalancePanel?.({
            currency,
            quantity: missing,
            requiredTokens: currency === 'tokens'
              ? parseAmount(liveRule?.required_tokens)
              : undefined,
            currentTokens: currency === 'tokens'
              ? parseAmount(access?.tokens)
              : undefined,
            requiredStars: currency === 'stars'
              ? parseAmount(liveRule?.required_stars)
              : undefined,
            currentStars: currency === 'stars'
              ? parseAmount(access?.stars)
              : undefined,
            planSlug: featureKey,
            planName: label,
            durationDays: Number(liveRule?.duration_days) || 30,
            returnToTableaux: true,
            sectionId: featureKey,
            notice: `Il vous manque ${formatAccessAmount(missing)} ${
              accessCurrencyLabel(currency, missing !== 1)
            } pour débloquer ce tableau.`,
            noticeKind: 'error'
          });
          return;
        }
        if (!decision?.confirmed) return;

        const result = await Promise.resolve(window.cidUnlockFeature?.(featureKey, {
          label,
          requiredStars: parseAmount(liveRule?.required_stars),
          requiredTokens: parseAmount(liveRule?.required_tokens)
        }));
        if (!result?.ok) return;
        /*
         * The Tableau itself is now unlocked. Do not immediately open a
         * second debit/confirmation for anticipation: that makes a successful
         * purchase look like it failed and leaves the visitor unsure which
         * access was granted. The success card now offers anticipation as an
         * explicit, secondary action.
         */
      } finally {
        unlock.disabled = false;
        unlock.removeAttribute('aria-busy');
        delete unlock.dataset.confirming;
      }
    });
    actions.appendChild(unlock);
    individualMode.appendChild(actions);
    appendHistorySlot(modes, portfolio);
    // Keep the access status before the programme cards. It belongs to the
    // section header, not on top of a key/cross card where it can hide the
    // date and the programme title.
    portfolio.insertBefore(badge, portfolio.firstElementChild);
  }

  function featureKeyForPortfolio(portfolio) {
    const owner = portfolio?.closest?.(
      '.portfolio-universal, .portfolio-intuition, .portfolio-oracle, ' +
      '.portfolio-manual, .portfolio-lnb, .portfolio-standby, ' +
      '.created-program-portfolios'
    ) || portfolio;
    const match = Object.entries(PORTFOLIO_SELECTORS)
      .find(([, selector]) => owner?.matches?.(selector));
    return match ? PORTFOLIO_ACCESS[match[0]] : owner?.dataset?.tableauxAccess;
  }

  function protectedPortfolioElements(portfolio) {
    if (!portfolio) return [];
    if (portfolio.matches('.created-program-portfolios')) {
      return Array.from(portfolio.querySelectorAll(':scope > .created-program-grid > .created-program-card'));
    }
    if (portfolio.matches('.portfolio-standby')) {
      return Array.from(portfolio.querySelectorAll(':scope > .table-container'));
    }
    const keyAndCross = Array.from(portfolio.querySelectorAll(':scope > .container'))
      .slice(0, 2);
    const resultTables = Array.from(
      portfolio.querySelectorAll(':scope > .table-container')
    );
    return [...keyAndCross, ...resultTables];
  }

  function maskValue(element, replacement = LOCKED_VALUE) {
    if (!element) return;
    // Only the sensitive value is replaced with a fixed-format mask (keys,
    // branches, satellites and NAP values never expose a numeric placeholder).
    // The component keeps its original colour
    // theme and formatting classes, so a locked card looks exactly like its
    // unlocked twin (yellow digits on a black cross, etc.) without revealing
    // the real values.
    const nextText = replacement || LOCKED_VALUE;
    if (element.textContent !== nextText) element.textContent = nextText;
    if (!element.classList.contains('cid-tableaux-masked-value')) {
      element.classList.add('cid-tableaux-masked-value');
    }
    if (element.hasAttribute('data-number')) element.removeAttribute('data-number');
  }

  function crossPositionFor(element) {
    if (element?.dataset?.crossPosition) return element.dataset.crossPosition;
    if (element?.classList?.contains('cross-number-1')) return 'top';
    if (element?.classList?.contains('cross-number-2')) return 'bottom';
    if (element?.classList?.contains('cross-number-3')) return 'right';
    if (element?.classList?.contains('cross-number-6')) return 'left';
    return '';
  }

  const MASKED_SATELLITE_ROW_CLASS = 'cid-tableaux-masked-row';

  function maskedCombinationCell() {
    return '<td><div class="satellite-combination">'
      + `<span class="satellite-number cid-tableaux-masked-value">${LOCKED_VALUE}</span>`
      + '<span class="satellite-operator">+</span>'
      + `<span class="satellite-number cid-tableaux-masked-value">${LOCKED_VALUE}</span>`
      + '</div></td>';
  }

  /*
   * For a locked subscription card the satellite table holds no server data,
   * so it would otherwise stay bare. Generate masked preview rows
   * (masked values in the satellite column and combinations) so the
   * visitor sees exactly the grid structure they will get after subscribing,
   * in the active theme's colours. Rows are marked for later removal.
   */
  function ensureMaskedSatelliteRows(portfolio) {
    if (!portfolio) return;
    const tables = portfolio.querySelectorAll(
      'table.universal-satellites, table.intuition-cross-satellites, ' +
      'table.oracle-satellites, table.manual-satellites, table.lnb-satellites'
    );
    tables.forEach((table) => {
      const rows = Array.from(table.querySelectorAll('tr'));
      const footerIndex = rows.findIndex((row, i) =>
        i >= 2 && row.querySelector('th[colspan]')
      );
      const end = footerIndex === -1 ? rows.length : footerIndex;
      const dataRows = rows.slice(2, end)
        .filter((row) => !row.classList.contains(MASKED_SATELLITE_ROW_CLASS));
      // A locked satellite surface is intentionally condensed to exactly one
      // stable preview row. Never retain legacy template rows or append a
      // second layer over them.
      dataRows.forEach((row) => row.remove());
      if (table.querySelector(`.${MASKED_SATELLITE_ROW_CLASS}`)) return;
      const row = table.insertRow(2);
      row.className = MASKED_SATELLITE_ROW_CLASS;
      row.innerHTML = [
        `<td class="cid-tableaux-masked-value">${LOCKED_VALUE}</td>`,
        maskedCombinationCell(),
        maskedCombinationCell()
      ].join('');
    });
  }

  function ensureMaskedStandbyRow(portfolio) {
    const table = portfolio?.querySelector?.('table.standby-week-table');
    const tbody = table?.querySelector('tbody');
    if (!tbody) return;
    if (tbody.querySelector(`tr.${MASKED_SATELLITE_ROW_CLASS}`)
      && tbody.children.length === 1) return;
    tbody.replaceChildren();
    const row = document.createElement('tr');
    row.className = MASKED_SATELLITE_ROW_CLASS;
    row.innerHTML = `
      <td class="standby-country-cell">Pays</td>
      <td class="nap2-cell cid-tableaux-masked-value">${LOCKED_VALUE}</td>
      <td class="perm-cell cid-tableaux-masked-value">${LOCKED_VALUE}</td>`;
    tbody.appendChild(row);
  }

  function restorePortfolioValues(portfolio) {
    if (!portfolio) return;
    portfolio.querySelectorAll(`.${MASKED_SATELLITE_ROW_CLASS}`).forEach((row) => row.remove());
    // Never restore values from a browser-side cache. An unlock is followed
    // by a fresh verified database render; until then only the zero shell is
    // allowed to remain visible.
    portfolio.querySelectorAll('.cid-tableaux-masked-value').forEach((element) => {
      element.classList.remove('cid-tableaux-masked-value');
    });
    portfolio.querySelectorAll('[data-cid-locked-extra]').forEach((element) => {
      element.hidden = false;
      element.removeAttribute('data-cid-locked-extra');
    });
  }

  /*
   * Keep labels, dates and the card mould visible. Only programme results are
   * replaced by stable zero placeholders, so a locked card stays perfectly
   * readable and keeps the same dimensions as the unlocked card.
   */
  function maskPortfolioValues(portfolio) {
    if (!portfolio) return;
    portfolio.querySelectorAll('.key-container .numbers, .order-container .numbers')
      .forEach((element) => maskValue(element, LOCKED_KEY_VALUE));
    portfolio.querySelectorAll('.key-info strong').forEach((element) => maskValue(element, LOCKED_VALUE));
    // The four cross branches are fixed positions, each with one and only one
    // zero placeholder. This keeps the total number of visible zero glyphs at
    // four per cross.
    portfolio.querySelectorAll('.cross-number').forEach((element) => {
      maskValue(element, LOCKED_CROSS[crossPositionFor(element)] || '0');
    });
    // A cross has exactly four visible branches. Remove legacy base overlays
    // so their zeros cannot duplicate or overlap a branch.
    portfolio.querySelectorAll('.cross-base-numbers, .cross-base-number')
      .forEach((element) => element.remove());
    portfolio.querySelectorAll('.satellite-number').forEach((element) => maskValue(element, LOCKED_VALUE));
    portfolio.querySelectorAll('.created-program-key')
      .forEach((element) => maskValue(element, LOCKED_VALUE));
    portfolio.querySelectorAll('.created-program-cross b')
      .forEach((element) => maskValue(element, LOCKED_CROSS.top));
    portfolio.querySelectorAll('.satellite-combination').forEach((combination) => {
      const row = combination.closest('tr');
      const firstCell = row?.querySelector('td:first-child');
      if (firstCell) maskValue(firstCell, LOCKED_VALUE);
      combination.querySelectorAll('.satellite-number')
        .forEach((element) => maskValue(element, LOCKED_VALUE));
    });
    portfolio.querySelectorAll('.nap-value').forEach((element) => {
      maskValue(element, LOCKED_VALUE);
    });
    // A locked satellite table must never stay empty. If the plan
    // data was never loaded, generate masked preview rows so the visitor sees
    // the exact schema structure it will get.
    ensureMaskedSatelliteRows(portfolio);
    // A locked programme keeps the complete 1..90 grid visible as a stable
    // card, but its date-selected values must not reveal the real result
    // before the visitor unlocks the containing offer.
    portfolio.querySelectorAll('.valid-numbers-table tr.numbers-row td')
      .forEach((element) => maskValue(element, LOCKED_VALUE));
    portfolio.querySelectorAll('.standby-week-table tbody td').forEach((element) => {
      if (!element.classList.contains('standby-country-cell')) {
        maskValue(element, LOCKED_VALUE);
      }
    });
    if (portfolio.matches('.portfolio-standby') || portfolio.querySelector('.standby-week-table')) {
      ensureMaskedStandbyRow(portfolio);
    }
    portfolio.querySelectorAll('.created-program-satellites').forEach((satellites) => {
      // Custom programmes use one stable satellite preview while locked. The
      // complete list is rebuilt by renderCreatedPrograms after unlocking.
      const values = Array.from(satellites.querySelectorAll('.satellite-number'));
      values.forEach((element, index) => {
        if (index === 0) maskValue(element, LOCKED_VALUE);
        else {
          element.hidden = true;
          element.dataset.cidLockedExtra = 'true';
        }
      });
      if (!values.length) {
        const value = document.createElement('span');
        value.className = 'satellite-number cid-tableaux-masked-value';
        value.textContent = LOCKED_VALUE;
        satellites.appendChild(value);
      }
    });
  }

  function applyTableauxAccess(access, verifiedFeatures = null) {
    const view = get(VIEW_ID);
    if (!view) return;
    currentAccessState = access;
    Object.entries(PORTFOLIO_ACCESS).forEach(([portfolioId, featureKey]) => {
      const portfolio = view.querySelector(PORTFOLIO_SELECTORS[portfolioId]);
      if (!portfolio) return;
      const allowed = canAccessTableauxFeature(featureKey, access, verifiedFeatures);
      portfolio.classList.remove('tableaux-access-locked');
      portfolio.removeAttribute('aria-disabled');
      portfolio.dataset.tableauxAccessState = allowed ? 'available' : 'locked';
      protectedPortfolioElements(portfolio).forEach((surface) => {
        restorePortfolioValues(surface);
        markAccessElement(surface, allowed, PORTFOLIO_LABELS[portfolioId]);
        if (!allowed) maskPortfolioValues(surface);
      });
    });
    view.querySelectorAll('[data-tableaux-access]').forEach((element) => {
      const allowed = canAccessTableauxFeature(
        element.dataset.tableauxAccess,
        access,
        verifiedFeatures
      );
      const label = element.dataset.tableauxLabel || element.textContent.trim();
      markAccessElement(element, allowed, label);
      restorePortfolioValues(element);
      if (!allowed) maskPortfolioValues(element);
    });
    renderTableauxSections(access);
  }

  function maskVisiblePortfolioValues() {
    const view = get(VIEW_ID);
    if (!view) return;
    Object.values(PORTFOLIO_SELECTORS).forEach((selector) => {
      const portfolio = view.querySelector(selector);
      if (!portfolio || portfolio.hidden) return;
      protectedPortfolioElements(portfolio).forEach(maskPortfolioValues);
    });
    const created = view.querySelector('#createdProgramPortfolios');
    if (created && !created.hidden) {
      protectedPortfolioElements(created).forEach(maskPortfolioValues);
    }
  }

  /*
   * The observer is the last display boundary for late legacy renderers.
   * It keeps the locked shell authoritative after a focus change, hydration
   * response, or in-document tab transition.
   */
  function enforceLockedDisplayContract() {
    const view = get(VIEW_ID);
    if (!view) return;
    view.querySelectorAll('.cross-base-numbers, .cross-base-number')
      .forEach((element) => element.remove());
    Object.entries(PORTFOLIO_SELECTORS).forEach(([portfolioId, selector]) => {
      const portfolio = view.querySelector(selector);
      if (!portfolio) return;
      if (!canAccessTableauxFeature(PORTFOLIO_ACCESS[portfolioId], currentAccessState)) {
        protectedPortfolioElements(portfolio).forEach(maskPortfolioValues);
      }
    });
  }

  let lockedContractObserver = null;
  let lockedContractCheckQueued = false;
  function installLockedDisplayGuard() {
    const view = get(VIEW_ID);
    if (!view || lockedContractObserver) return;
    lockedContractObserver = new MutationObserver(() => {
      if (lockedContractCheckQueued) return;
      lockedContractCheckQueued = true;
      Promise.resolve().then(() => {
        lockedContractCheckQueued = false;
        enforceLockedDisplayContract();
      });
    });
    lockedContractObserver.observe(view, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  function lockUntilDatabaseVerification() {
    currentAccessState = null;
    applyTableauxAccess(null);
  }

  /*
   * A protected function can legitimately return 401/403, so a failed
   * programme response must never leave the previous day's real values in the
   * DOM. Reapply the current entitlement after every remote batch; if the
   * catalogue says the feature is protected, the visible card is always a
   * sharp `00` preview.
   */
  function maskUnavailablePrograms(programs) {
    const view = get(VIEW_ID);
    if (!view || !programs) return;
    ['universal', 'intuition', 'oracle', 'balsa', 'lnb'].forEach((planId) => {
      if (programs.plans?.[planId]) return;
      const portfolio = getPortfolio({ id: planId });
      protectedPortfolioElements(portfolio).forEach(maskPortfolioValues);
    });
    if (programs.standby) return;
    const standby = view.querySelector('.portfolio-standby');
    protectedPortfolioElements(standby).forEach(maskPortfolioValues);
  }

  function renderSatellites(plan) {
    renderSatelliteTable('#universalSatellites', plan);
    renderNap(plan, ['universalNap1a', 'universalNap1b'], 'universalNap2');
  }

  function renderNap(plan, nap1Ids = [], nap2Id) {
    const nap = plan?.nap;
    const nap1 = Array.isArray(nap?.nap1) ? nap.nap1 : [];
    nap1Ids.forEach((id, index) => {
      const element = get(id);
      if (element) {
        const value = nap1[index];
        element.textContent = valueOrLocked(value);
      }
    });
    const nap2 = get(nap2Id);
    const nap2Values = Array.isArray(nap?.nap2) ? nap.nap2 : [];
    if (nap2) {
      const value = (nap2Values || [])
        .filter((entry) => entry !== undefined && entry !== null && String(entry).trim())
        .join(' ');
      nap2.textContent = valueOrLocked(value);
    }
  }

  function renderSatelliteTable(selector, plan) {
    const table = get(VIEW_ID)?.querySelector(selector);
    if (!table) return;
    const rows = Array.from(table.querySelectorAll('tr'));
    const footerIndex = rows.findIndex((row, index) =>
      index >= 2 && row.querySelector('th[colspan]')
    );
    rows.slice(2, footerIndex === -1 ? rows.length : footerIndex)
      .forEach((row) => row.remove());
    (plan?.satellites || []).forEach((satellite, index) => {
      const row = table.insertRow(2 + index);
      row.innerHTML = `
        <td>${pad(satellite.value ?? 0)}</td>
        <td>${formatCombination(satellite.combinations?.[0])}</td>
        <td>${formatCombination(satellite.combinations?.[1])}</td>
      `;
    });
    if (!plan || !(plan.satellites || []).length) {
      const row = table.insertRow(2);
      row.innerHTML = `
        <td>${LOCKED_VALUE}</td>
        <td>${formatCombination(null)}</td>
        <td>${formatCombination(null)}</td>`;
    }
  }

  function formatCombination(combination) {
    if (!Array.isArray(combination) || !combination.length) {
      return `<div class="satellite-combination">
        <span class="satellite-number">${LOCKED_VALUE}</span>
        <span class="satellite-operator">+</span>
        <span class="satellite-number">${LOCKED_VALUE}</span>
      </div>`;
    }
    const operator = combination.operator || '+';
    const numbers = combination.map((part) => (
      `<span class="satellite-number${part?.yellow ? ' yellow-text' : ''}">${pad(part?.value ?? part)}</span>`
    ));
    return `<div class="satellite-combination">${numbers.join(`<span class="satellite-operator">${operator}</span>`)}</div>`;
  }

  function setSharedLuckyNumberCell(cell, number, luckyNumbers, palette = {}) {
    cell.textContent = String(number);
    cell.dataset.number = String(number);
    cell.classList.remove(
      'lucky-number',
      'highlighted',
      'method-1',
      'method-2',
      'method-3',
      'method-4',
      'method-5',
      'trend-27',
      'trend-51',
      'invalid',
      'valid'
    );
    cell.style.removeProperty('color');
    cell.style.removeProperty('background');
    cell.style.removeProperty('font-weight');
    cell.style.removeProperty('transform');
    cell.style.removeProperty('transition');

    const isLucky = luckyNumbers.has(number);
    cell.classList.toggle('lucky-number', isLucky);
    cell.toggleAttribute('data-lucky-number', isLucky);
    // The date protocol is shared by every grid. Balsa Plus is intentionally
    // kept separate from the common valid-number grids used by the other
    // Tableaux programmes.
    if (isLucky) {
      cell.style.setProperty(
        'color',
        palette.color || SHARED_LUCKY_NUMBER_COLOR,
        'important'
      );
      cell.style.setProperty(
        'background',
        palette.background || SHARED_LUCKY_NUMBER_BACKGROUND,
        'important'
      );
      cell.style.setProperty('font-weight', '800', 'important');
    }
  }

  /*
   * The valid-number grid is administrator-managed configuration stored in
   * the secure database (module "tableaux"). When the database carries no
   * row, the grid renders its administrator-managed empty state instead of a
   * hardcoded 1..90 list.
   */
  function validNumberGrid() {
    return window.cidSiteConfig?.grid?.('tableaux') || null;
  }

  function ensureValidNumbersGrid(table) {
    const header = table.querySelector('tr:first-child');
    if (!header) return [];

    table.querySelectorAll('tr.numbers-row').forEach((row) => row.remove());
    table.querySelectorAll('tr.cid-grid-empty-row').forEach((row) => row.remove());

    const grid = validNumberGrid();
    if (!grid) {
      const emptyRow = document.createElement('tr');
      emptyRow.className = 'cid-grid-empty-row';
      const cell = document.createElement('td');
      cell.colSpan = 10;
      cell.textContent = 'Grille de numéros en cours de configuration par l’administrateur.';
      emptyRow.appendChild(cell);
      header.after(emptyRow);
      table.dataset.gridManaged = 'false';
      return [];
    }
    table.dataset.gridManaged = 'true';
    table.dataset.gridMin = String(grid.min);
    table.dataset.gridMax = String(grid.max);

    const fragment = document.createDocumentFragment();
    const width = 10;
    const first = Math.max(1, grid.min);
    const last = Math.max(first, grid.max);
    let number = first;
    while (number <= last) {
      const row = document.createElement('tr');
      row.className = 'numbers-row';
      for (let column = 0; column < width && number <= last; column += 1, number += 1) {
        const cell = document.createElement('td');
        cell.textContent = String(number);
        row.appendChild(cell);
      }
      fragment.appendChild(row);
    }
    if (!fragment.childNodes.length) {
      const emptyRow = document.createElement('tr');
      emptyRow.className = 'cid-grid-empty-row';
      const cell = document.createElement('td');
      cell.colSpan = 10;
      cell.textContent = 'Grille de numéros en cours de configuration par l’administrateur.';
      emptyRow.appendChild(cell);
      fragment.appendChild(emptyRow);
    }
    header.after(fragment);
    return Array.from(table.querySelectorAll('tr.numbers-row td'));
  }

  /*
   * Each 1..90 grid is painted from the common lucky-number phase.
   * `validNumbers` remains separate: it is an input for the key calculation,
   * while the common `luckyNumbers` from the date are shown in every grid.
   */
  /*
   * Keep every configured grid mounted. Locked values are masked by the
   * server response and the access pass below; the renderer must never
   * remove a table as a substitute for access control.
   */
  function renderLuckyNumberTables() {}

  function renderProgramDetails(programs) {
    const view = get(VIEW_ID);
    // Values may have been masked during the previous render. Restore the
    // writeable nodes before painting a fresh server response so the
    // WeakMap never restores an obsolete value after an unlock.
    view?.querySelectorAll(
      '.portfolio-universal, .portfolio-intuition, .portfolio-oracle, ' +
      '.portfolio-manual, .portfolio-lnb, .portfolio-standby, [data-tableaux-access]'
    ).forEach(restorePortfolioValues);
    currentPrograms = programs;
    const plans = PLANS.map(({ id }) => programs.plans[id]).filter(Boolean);
    renderPlans(plans);
    renderSatellites(programs.plans.universal);
    renderSatelliteTable('.intuition-cross-satellites', programs.plans.intuition);
    renderSatelliteTable('.oracle-satellites', programs.plans.oracle);
    renderSatelliteTable('#manualSatellites', programs.plans.balsa);
    renderSatelliteTable('.lnb-satellites', programs.plans.lnb);
    renderNap(programs.plans.intuition, ['intuitionNap1a', 'intuitionNap1b'], 'intuitionNap2');
    renderNap(programs.plans.oracle, ['oracleNap1'], 'oracleNap2');
    renderNap(programs.plans.balsa, ['intuitionKeyNap1a', 'intuitionKeyNap1b'], 'intuitionKeyNap2');
    renderNap(programs.plans.lnb, ['lnbNap1'], 'lnbNap2');

    renderLuckyNumberTables(programs);
    renderManualProgram(programs.plans.balsa);
    renderStandby(programs.standby);
    renderCreatedPrograms(programs.createdPrograms);
    // A programme refresh can replace masked nodes with fresh server data.
    // Apply the last known access synchronously before the network refresh
    // below, then reconcile it with the newest catalogue response.
    /*
     * Keep the entitlement that was verified immediately before this
     * response. Clearing it here used to make the MutationObserver re-mask
     * the freshly rendered payload while the second access read was pending.
     */
    if (window.cidFeatureAccess?.has && currentAccessState) {
      applyTableauxAccess(currentAccessState);
    }
    (window.cidFeatureAccess?.load?.() || Promise.resolve(null))
      .then((access) => {
        applyTableauxAccess(access);
        maskUnavailablePrograms(programs);
      })
      .catch(() => {});
  }

  function renderManualProgram(program) {
    const view = get(VIEW_ID);
    if (!view || !program) return;
    const portfolio = view.querySelector('.portfolio-manual');
    if (!portfolio) return;
    const values = {
      manualKey: valueOrLocked(program.key, LOCKED_KEY_VALUE),
      manualOrder: valueOrLocked(program.order, LOCKED_KEY_VALUE)
    };
    const key = portfolio.querySelector('.key-container .numbers');
    const order = portfolio.querySelector('.order-container .numbers');
    if (key) key.textContent = values.manualKey;
    if (order) order.textContent = values.manualOrder;
    const infoValues = portfolio.querySelectorAll('.key-info strong');
    [program.code, program.filter, program.addition].forEach((value, index) => {
      if (infoValues[index]) infoValues[index].textContent = valueOrLocked(value);
    });
    const cross = view.querySelector('.portfolio-manual .container.manual .cross');
    if (cross) {
      const crossValues = {
        '.cross-number-1': valueOrLocked(program.cross?.top, LOCKED_CROSS.top),
        '.cross-number-2': valueOrLocked(program.cross?.bottom, LOCKED_CROSS.bottom),
        '.cross-number-3': valueOrLocked(program.cross?.right, LOCKED_CROSS.right),
        '.cross-number-6': valueOrLocked(program.cross?.left, LOCKED_CROSS.left)
      };
      Object.entries(crossValues).forEach(([selector, value]) => {
        const element = cross.querySelector(selector);
        if (!element) return;
        element.textContent = value;
        element.classList.toggle(
          'balsa-white-digit',
          String(value).trim() === '4'
            || String(value).trim() === '6'
        );
      });
      cross.querySelectorAll('.cross-base-numbers, .cross-base-number')
        .forEach((element) => element.remove());
    }
  }

  function renderStandby(standby) {
    const table = get(VIEW_ID)?.querySelector('#standbyContainer table');
    if (!table || !standby) return;
    const tbody = table.querySelector('#standbyRows');
    if (tbody) {
      tbody.innerHTML = '';
      standby.rows.forEach((rowData) => {
        const row = document.createElement('tr');
        [
          rowData.countryDisplay || rowData.country,
          rowData.nap2,
          rowData.permutation
        ]
          .forEach((value, index) => {
            const cell = document.createElement('td');
            cell.className = [
              'standby-country-cell',
              'nap2-cell',
              'perm-cell'
            ][index];
            cell.textContent = valueOrLocked(value);
            row.appendChild(cell);
          });
        tbody.appendChild(row);
      });
    }
    const next = get('standbyNextDate');
    if (next) next.textContent = standby.nextDate
      ? new Date(standby.nextDate).toLocaleDateString(uiLocale(), {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      })
      : LOCKED_VALUE;
  }

  function createdVisualTemplate(program) {
    const raw = String(program?.visualTemplate || program?.sourceTemplate || 'universelle')
      .trim().toLowerCase();
    return raw === 'balsa' ? 'manual' : ({
      universelle: 'universal',
      intuition: 'intuition',
      oracle: 'oracle',
      lnb: 'lnb',
      standby: 'standby',
      'stand-by': 'standby',
      robot: 'universal'
    }[raw] || (raw === 'balsa-plus' ? 'manual' : 'universal'));
  }

  function renderCreatedProgramTemplateLegacy(card, program) {
    const template = createdVisualTemplate(program);
    const titleMap = {
      universal: 'CLÉ UNIVERSELLE',
      intuition: 'CLÉ INTUITION',
      oracle: 'CLÉ ORACLE',
      lnb: 'CLÉ LNB',
      manual: 'CLÉ BALSA PLUS',
      standby: 'STAND-BY'
    };
    const tableMap = {
      universal: ['universal-satellites', 'SATELLITES CROIX UNIVERSELLE'],
      intuition: ['intuition-cross-satellites', 'SATELLITES CROIX INTUITION'],
      oracle: ['oracle-satellites', 'SATELLITES CROIX ORACLE'],
      lnb: ['lnb-satellites', 'SATELLITES CROIX LNB'],
      manual: ['manual-satellites', 'SATELLITES CROIX BALSA PLUS']
    };
    const configuredName = String(
      program?.displayName || program?.name || program?.id || ''
    ).trim();
    const templateName = titleMap[template] || titleMap.universal;
    const customName = configuredName
      .replace(/^satellites?\s+croix\s+/i, '')
      .replace(/^croix\s+/i, '')
      .replace(/^clé\s+/i, '')
      .trim();
    const label = customName
      ? customName.toLocaleUpperCase(uiLocale())
      : templateName.replace(/^CLÉ\s+/i, '');
    const title = `CLÉ ${label}`;
    const [tableClass, defaultTableTitle] = tableMap[template] || tableMap.universal;
    const tableTitle = customName
      ? `SATELLITES CROIX ${label}`
      : defaultTableTitle;
    const dateText = formatDate(currentDate);
    const cross = program.cross || {};
    const nap = program.nap || {};

    const shell = document.createElement('div');
    // Never reuse the official `.portfolio-*` classes here. The official
    // portfolios are mounted once in the fixed Tableaux shell; reusing
    // `.portfolio-oracle` (or another built-in class) makes the section
    // collector mistake a custom card for the official Tableau and mount it
    // a second time.
    shell.className = `created-program-template created-template-${template}`;
    shell.dataset.createdTemplate = template;

    const keyContainer = document.createElement('div');
    keyContainer.className = 'container created-program-template-key';
    if (template === 'manual') keyContainer.classList.add('manual');
    keyContainer.innerHTML = `
      <div class="date"></div>
      <div class="title-text"></div>
      <div class="key-container"><div class="key-label">la clé:</div><div class="numbers created-program-key"></div></div>
      <div class="order-container"><div class="order-label">ordre:</div><div class="numbers created-program-order"></div></div>
      <div class="key-info"><p><span>Code:</span> <strong></strong> | <span>Filtre:</span> <strong></strong> | <span>addition:</span> <strong></strong></p></div>
      <div class="site-url key-signature">www.cidmap.com</div>`;
    keyContainer.querySelector('.date').textContent = dateText;
    keyContainer.querySelector('.title-text').textContent = title;
    keyContainer.querySelector('.created-program-key').textContent = valueOrLocked(
      program.key,
      LOCKED_KEY_VALUE
    );
    keyContainer.querySelector('.created-program-order').textContent = valueOrLocked(
      program.order,
      LOCKED_KEY_VALUE
    );
    [program.code, program.filter, program.addition].forEach((value, index) => {
      const target = keyContainer.querySelectorAll('.key-info strong')[index];
      if (target) target.textContent = valueOrLocked(value);
    });
    shell.appendChild(keyContainer);

    const crossContainer = document.createElement('div');
    crossContainer.className = 'container created-program-template-cross';
    if (template === 'manual') crossContainer.classList.add('manual');
    crossContainer.innerHTML = `
      <div class="date"></div>
      <div class="title-text"></div>
      <div class="cross">
        <div class="cross-line cross-line-vertical"></div>
        <div class="cross-line cross-line-horizontal"></div>
        <div class="cross-number cross-number-1"></div>
        <div class="cross-number cross-number-2"></div>
        <div class="cross-number cross-number-3"></div>
        <div class="cross-number cross-number-6"></div>
      </div>
      <div class="site-url">www.cidmap.com</div>`;
    crossContainer.querySelector('.date').textContent = dateText;
    crossContainer.querySelector('.title-text').textContent = `CROIX ${title.replace(/^CLÉ /, '')}`;
    [
      ['.cross-number-1', valueOrLocked(cross.top, LOCKED_CROSS.top)],
      ['.cross-number-2', valueOrLocked(cross.bottom, LOCKED_CROSS.bottom)],
      ['.cross-number-3', valueOrLocked(cross.right, LOCKED_CROSS.right)],
      ['.cross-number-6', valueOrLocked(cross.left, LOCKED_CROSS.left)]
    ].forEach(([selector, value]) => {
      const target = crossContainer.querySelector(selector);
      if (target) target.textContent = value;
    });
    shell.appendChild(crossContainer);

    const tableContainer = document.createElement('div');
    tableContainer.className = 'table-container satellites-table-container created-program-template-satellites';
    const table = document.createElement('table');
    table.className = `color-table ${tableClass}`;
    table.innerHTML = `
      <tr><th colspan="3"><div class="table-date"></div>${tableTitle}</th></tr>
      <tr><td>Satellite</td><td>Combinaison 1</td><td>Combinaison 2</td></tr>
      <tr class="created-program-satellite-row"></tr>
      <tr><th colspan="3">${title}</th></tr>
      <tr class="created-program-nap-row">
        <td><div class="nap-cell"><div class="nap-label">NAP1</div><div class="nap-value"></div></div></td>
        <td><div class="nap-cell"><div class="nap-label">NAP1</div><div class="nap-value"></div></div></td>
        <td><div class="nap-cell"><div class="nap-label">NAP2</div><div class="nap-value"></div></div></td>
      </tr>`;
    table.querySelector('.table-date').textContent = dateText;
    /*
     * Custom programmes use the same satellite table contract as the
     * built-in Tableaux. The former renderer only copied the first satellite,
     * which made administrator-created programmes look different from their
     * source Tableau and made the archive impossible to hydrate completely.
     */
    const templateRow = table.querySelector('.created-program-satellite-row');
    const footerRow = Array.from(table.querySelectorAll('tr'))
      .find((candidate, index) => (
        index >= 2 && candidate.querySelector('th[colspan]')
      ));
    templateRow?.remove();
    const satellites = Array.isArray(program.satellites) && program.satellites.length
      ? program.satellites
      : [null];
    satellites.forEach((satellite) => {
      const row = document.createElement('tr');
      row.className = 'created-program-satellite-row';
      const satelliteCell = document.createElement('td');
      satelliteCell.className = 'satellite-number';
      satelliteCell.textContent = pad(satellite?.value ?? 0);
      row.appendChild(satelliteCell);
      const combinations = Array.isArray(satellite?.combinations)
        ? satellite.combinations
        : [];
      for (let index = 0; index < 2; index += 1) {
        const cell = document.createElement('td');
        cell.innerHTML = formatCombination(combinations[index]);
        row.appendChild(cell);
      }
      table.tBodies[0]?.insertBefore(row, footerRow || null);
    });
    const napValues = [
      Array.isArray(nap.nap1) ? nap.nap1[0] : null,
      Array.isArray(nap.nap1) ? nap.nap1[1] : null,
      Array.isArray(nap.nap2) ? nap.nap2.join(' ') : null
    ];
    table.querySelectorAll('.created-program-nap-row .nap-value').forEach((element, index) => {
      element.textContent = valueOrLocked(napValues[index]);
    });
    tableContainer.appendChild(table);
    const tableSignature = document.createElement('div');
    tableSignature.className = 'site-url table-signature';
    tableSignature.textContent = 'www.cidmap.com';
    tableContainer.appendChild(tableSignature);
    shell.appendChild(tableContainer);
    card.appendChild(shell);
  }

  function createdProgramLabel(program) {
    const configuredName = String(
      program?.displayName || program?.name || program?.id || ''
    ).trim();
    return configuredName
      .replace(/^satellites?\s+croix\s+/i, '')
      .replace(/^croix\s+/i, '')
      .replace(/^clé\s+/i, '')
      .trim()
      .toLocaleUpperCase(uiLocale()) || 'PROGRAMME';
  }

  /*
   * Administrator-created programmes are true visual duplicates of the
   * selected official Tableau. Only their name, palette and server payload
   * differ. Keeping the official DOM here prevents the live view and the
   * historical clone from developing separate typography or table layouts.
   */
  function renderCreatedSatelliteTable(table, program) {
    if (!table || table.classList.contains('standby-week-table')) return;
    const rows = Array.from(table.querySelectorAll('tr'));
    const footerIndex = rows.findIndex((row, index) => (
      index >= 2 && row.querySelector('th[colspan]')
    ));
    const template = rows[2]?.cloneNode(true);
    if (!template) return;
    rows.slice(2, footerIndex === -1 ? rows.length : footerIndex)
      .forEach((row) => row.remove());
    const satellites = Array.isArray(program?.satellites) && program.satellites.length
      ? program.satellites
      : [null];
    const footer = Array.from(table.querySelectorAll('tr'))
      .find((row, index) => index >= 2 && row.querySelector('th[colspan]'));
    satellites.forEach((satellite) => {
      const row = template.cloneNode(true);
      const cells = row.children;
      if (cells[0]) cells[0].textContent = pad(satellite?.value ?? 0);
      if (cells[1]) cells[1].innerHTML = formatCombination(
        satellite?.combinations?.[0]
      );
      if (cells[2]) cells[2].innerHTML = formatCombination(
        satellite?.combinations?.[1]
      );
      table.tBodies[0]?.insertBefore(row, footer || null);
    });
    const nap = program?.nap || {};
    const napValues = [
      Array.isArray(nap.nap1) ? nap.nap1[0] : null,
      Array.isArray(nap.nap1) ? nap.nap1[1] : null,
      Array.isArray(nap.nap2) ? nap.nap2.join(' ') : null
    ];
    table.querySelectorAll('.nap-value').forEach((element, index) => {
      element.textContent = valueOrLocked(napValues[index]);
    });
  }

  function renderCreatedStandbyTable(table, program) {
    if (!table?.classList.contains('standby-week-table')) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    const template = tbody.querySelector('tr')?.cloneNode(true);
    if (!template) return;
    tbody.replaceChildren();
    const rows = Array.isArray(program?.rows) && program.rows.length
      ? program.rows
      : [null];
    rows.forEach((item) => {
      const row = template.cloneNode(true);
      const cells = row.children;
      if (cells[0]) cells[0].textContent = item?.countryDisplay
        || item?.country
        || 'Pays';
      if (cells[1]) cells[1].textContent = valueOrLocked(item?.nap2);
      if (cells[2]) cells[2].textContent = valueOrLocked(item?.permutation);
      tbody.appendChild(row);
    });
  }

  function renderCreatedProgramTemplate(card, program) {
    const template = createdVisualTemplate(program);
    const sourceSelector = PORTFOLIO_SELECTORS[template]
      || PORTFOLIO_SELECTORS.universal;
    const source = get(VIEW_ID)?.querySelector(`:scope > ${sourceSelector}`);
    if (!source) return;

    const clone = source.cloneNode(true);
    clone.hidden = false;
    clone.removeAttribute('hidden');
    clone.removeAttribute('id');
    clone.classList.remove('tableaux-access-locked');
    clone.removeAttribute('aria-disabled');
    clone.classList.add(
      'created-program-template',
      `created-template-${template}`
    );
    clone.dataset.createdTemplate = template;
    clone.dataset.createdPortfolioClone = 'true';
    clone.removeAttribute('data-tableaux-route');
    clone.removeAttribute('data-tableaux-feature');
    clone.removeAttribute('data-tableaux-access');
    clone.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
    clone.querySelectorAll(
      '.tableaux-access-badge, .tableaux-history-button, [data-tableaux-access]'
    ).forEach((element) => element.remove());
    clone.querySelectorAll('.tableaux-access-locked').forEach((element) => {
      element.classList.remove('tableaux-access-locked');
      element.removeAttribute('aria-disabled');
    });

    const label = createdProgramLabel(program);
    const title = `CLÉ ${label}`;
    clone.querySelectorAll('.date, .table-date').forEach((element) => {
      element.textContent = formatDate(currentDate);
    });
    clone.querySelectorAll('.title-text').forEach((element, index) => {
      element.textContent = index === 1
        ? `CROIX ${title.replace(/^CLÉ /, '')}`
        : title;
    });
    clone.querySelectorAll('.key-container .numbers').forEach((element) => {
      element.textContent = valueOrLocked(program.key, LOCKED_KEY_VALUE);
    });
    clone.querySelectorAll('.order-container .numbers').forEach((element) => {
      element.textContent = valueOrLocked(program.order, LOCKED_KEY_VALUE);
    });
    clone.querySelectorAll('.key-info strong').forEach((element, index) => {
      element.textContent = valueOrLocked([
        program.code,
        program.filter,
        program.addition
      ][index]);
    });
    const cross = program.cross || {};
    [
      ['.cross-number-1', cross.top, LOCKED_CROSS.top],
      ['.cross-number-2', cross.bottom, LOCKED_CROSS.bottom],
      ['.cross-number-3', cross.right, LOCKED_CROSS.right],
      ['.cross-number-6', cross.left, LOCKED_CROSS.left]
    ].forEach(([selector, value, fallback]) => {
      clone.querySelectorAll(selector).forEach((element) => {
        element.textContent = valueOrLocked(value, fallback);
      });
    });
    clone.querySelectorAll('.cross-base-numbers, .cross-base-number')
      .forEach((element) => element.remove());
    clone.querySelectorAll(
      '.universal-satellites, .intuition-cross-satellites, ' +
      '.oracle-satellites, .manual-satellites, .lnb-satellites'
    ).forEach((table) => renderCreatedSatelliteTable(table, program));
    clone.querySelectorAll('.standby-week-table').forEach((table) => {
      renderCreatedStandbyTable(table, program);
    });
    clone.querySelectorAll('th[colspan]').forEach((header, index) => {
      const date = header.querySelector('.table-date');
      const text = template === 'standby'
        ? `STAND-BY ${label}`
        : index === 0
        ? `SATELLITES CROIX ${label}`
        : title;
      header.replaceChildren(
        ...(date ? [date] : []),
        document.createTextNode(text)
      );
    });
    card.appendChild(clone);
  }

  function renderCreatedPrograms(programs = []) {
    const view = get(VIEW_ID);
    if (!view) return;
    const seenProgramKeys = new Set();
    const customPrograms = (Array.isArray(programs) ? programs : []).filter((program) => {
      const key = String(program?.id || program?.programKey || program?.program_key || '')
        .trim()
        .toLowerCase()
        .replace(/^tableaux[-_]/, '');
      const displayName = String(program?.displayName || program?.name || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-');
      const displayBaseName = displayName.replace(
        /^(?:clé|croix|satellites-croix)-/,
        ''
      );
      const builtInName = BUILT_IN_PROGRAM_KEYS.has(displayName)
        || BUILT_IN_PROGRAM_KEYS.has(displayBaseName);
      if (
        !key
        || BUILT_IN_PROGRAM_KEYS.has(key)
        || builtInName
        || seenProgramKeys.has(key)
      ) return false;
      seenProgramKeys.add(key);
      return true;
    });
    let container = view.querySelector('#createdProgramPortfolios');
    if (!customPrograms.length) {
      container?.remove();
      return;
    }
    if (!container) {
      container = document.createElement('section');
      container.id = 'createdProgramPortfolios';
      container.className = 'created-program-portfolios';
      view.appendChild(container);
    }
    container.dataset.tableauxAccess = 'tableaux-created';
    container.dataset.tableauxLabel = 'Programmes créés';
    container.replaceChildren();
    const title = document.createElement('h2');
    title.textContent = 'Programmes créés';
    container.appendChild(title);
    const grid = document.createElement('div');
    grid.className = 'created-program-grid';
    customPrograms.forEach((program) => {
      const card = document.createElement('article');
      card.id = `created-program-${program.id}`;
      card.className = 'created-program-card';
      card.dataset.cidFeatureKey = `tableaux-${String(program.id || '').toLowerCase()}`;
      const theme = program.theme || {};
      const color = /^#[0-9a-f]{6}$/i.test(String(theme.background || ''))
        ? theme.background
        : '#0F3B29';
      const accent = /^#[0-9a-f]{6}$/i.test(String(theme.accent || ''))
        ? theme.accent
        : '#FFD700';
      const text = /^#[0-9a-f]{6}$/i.test(String(theme.text || ''))
        ? theme.text
        : '#FFFFFF';
      card.style.setProperty('--created-program-bg', color);
      card.style.setProperty('--created-program-accent', accent);
      card.style.setProperty('--created-program-text', text);

      /*
       * A created programme is a clone of a Tableau, not a second admin
       * dashboard. Its selected name is painted into the cloned Tableau
       * headings below; function names, schedules and control versions stay
       * out of the visitor-facing component.
       */
      renderCreatedProgramTemplate(card, program);
      grid.appendChild(card);
    });
    container.appendChild(grid);
    window.cidEarlyAccessUi?.refresh?.();
  }

  /*
   * Keep the public view limited to display data.  The Edge Functions may
   * carry diagnostic fields for the administrator, but none of those fields
   * belong in the visitor's in-memory state or the rendered DOM.
   */
  function publicPlanPayload(plan) {
    if (!plan || typeof plan !== 'object') return null;
    return {
      id: normalizeTableauPlanId(plan.id),
      date: plan.date,
      key: plan.key,
      order: plan.order,
      code: plan.code,
      filter: plan.filter,
      addition: plan.addition,
      cross: plan.cross,
      satellites: Array.isArray(plan.satellites) ? plan.satellites : [],
      nap: plan.nap,
      luckyNumbers: Array.isArray(plan.luckyNumbers) ? plan.luckyNumbers : []
    };
  }

  function publicCreatedProgramPayload(program) {
    if (!program || typeof program !== 'object') return null;
    return {
      id: program.id,
      displayName: program.displayName,
      theme: program.theme,
      sourceTemplate: program.sourceTemplate,
      visualTemplate: program.visualTemplate || program.sourceTemplate,
      key: program.key,
      order: program.order,
      code: program.code,
      filter: program.filter,
      addition: program.addition,
      cross: program.cross,
      satellites: Array.isArray(program.satellites) ? program.satellites : [],
      nap: program.nap,
      rows: Array.isArray(program.rows) ? program.rows : [],
      luckyNumbers: Array.isArray(program.luckyNumbers) ? program.luckyNumbers : []
    };
  }

  function publicProgramsPayload(date, values) {
    const standby = values.standby && typeof values.standby === 'object'
      ? {
          date: values.standby.date,
          weekDate: values.standby.weekDate,
          rows: Array.isArray(values.standby.rows)
            ? values.standby.rows.map((row) => ({
                country: row.country,
                countryDisplay: row.countryDisplay,
                sourcePrograms: Array.isArray(row.sourcePrograms)
                  ? row.sourcePrograms.map(String)
                  : [],
                nap2: row.nap2,
                permutation: row.permutation
              }))
            : [],
          nextDate: values.standby.nextDate,
          followingDate: values.standby.followingDate
        }
      : null;
    const plans = Object.fromEntries(
      Object.entries(values.plans || {})
        .map(([id, plan]) => {
          const publicPlan = publicPlanPayload({
            ...(plan || {}),
            id: plan?.id || id
          });
          return [normalizeTableauPlanId(id), publicPlan];
        })
        .filter(([, plan]) => plan)
    );
    const firstPlanWithLuckyNumbers = Object.values(plans)
      .find((plan) => Array.isArray(plan?.luckyNumbers) && plan.luckyNumbers.length);
    return {
      date,
      plans,
      luckyNumbers: plans.universal?.luckyNumbers
        || firstPlanWithLuckyNumbers?.luckyNumbers
        || [],
      standby,
      createdPrograms: (Array.isArray(values.createdPrograms) ? values.createdPrograms : [])
        .map(publicCreatedProgramPayload)
        .filter(Boolean),
      errors: Array.isArray(values.errors)
        ? values.errors.map(({ key, label, message }) => ({ key, label, message }))
        : []
    };
  }

  function setRemoteStatus(message, state = 'loading') {
    const status = get(VIEW_ID)?.querySelector('#tableauxRemoteStatus');
    if (!status) return;
    if (!isVerifiedTableauxAdmin()) {
      status.hidden = true;
      status.textContent = '';
      status.dataset.state = state;
      return;
    }
    status.textContent = message;
    status.dataset.state = state;
    status.hidden = false;
  }

  const REMOTE_REQUESTS = [
    { key: 'universal', label: 'Universelle', load: loadUniverselle },
    { key: 'intuition', label: 'Intuition', load: loadIntuition },
    { key: 'oracle', label: 'Oracle', load: loadOracle },
    { key: 'lnb', label: 'LNB', load: loadLNB },
    { key: 'balsa', label: 'Balsa Plus', load: loadBalsa },
    { key: 'standby', label: 'Stand-by', load: loadStandBy },
    { key: 'createdPrograms', label: 'Programmes personnalisés', load: loadCreatedPrograms }
  ];

  function remoteErrorMessage(error) {
    const message = error?.message || error?.name || 'réponse indisponible';
    return String(message).replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  function isRateLimitError(error) {
    return /rate\s*limit|too many requests|retry after|\b429\b/i
      .test(remoteErrorMessage(error));
  }

  /*
   * Daily local cache of unlocked Tableaux.
   *
   * Once a Tableau has been unlocked and its verified payload received, the
   * payload and the grant that authorised it are stored in localStorage.
   * Later views are painted straight from this cache without querying the
   * database again. Entries are scoped to the signed-in account.
   *
   *  - The live ("current") publication is keyed by its programme day, which
   *    changes at the 16:00 UTC boundary — not at the calendar midnight. The
   *    old calendar-day key kept serving Thursday's Tableaux until midnight
   *    after Friday's publication had been released at 16:00.
   *  - An archived publication (explicit date) never changes once published,
   *    so it is kept across days and always re-read locally.
   */
  const DAILY_TABLEAU_CACHE_PREFIX = 'cidmap:tableaux-daily:v1:';
  const ARCHIVE_CACHE_DAY = 'archive';
  const MAX_ARCHIVED_TABLEAUX = 60;

  function tableauCacheDay() {
    return publicationDayIso();
  }

  function tableauEntryDay(selectedDate) {
    return selectedDate ? ARCHIVE_CACHE_DAY : tableauCacheDay();
  }

  function tableauCacheUser() {
    return String(window.cidAuthCurrentUserId || '').trim();
  }

  function tableauCacheKey(featureKey, selectedDate, userId = tableauCacheUser()) {
    return `${DAILY_TABLEAU_CACHE_PREFIX}${userId}:${tableauEntryDay(selectedDate)}:`
      + `${normalizeTableauxFeature(featureKey)}:${selectedDate || 'current'}`;
  }

  // `keepUser`: null keeps every account (day purge only); '' drops all.
  function purgeDailyTableauCache({ keepUser = null, onlyCurrent = false } = {}) {
    const today = tableauCacheDay();
    try {
      const archived = [];
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith(DAILY_TABLEAU_CACHE_PREFIX)) continue;
        const [userId, day] = key.slice(DAILY_TABLEAU_CACHE_PREFIX.length).split(':');
        const stale = (day !== today && day !== ARCHIVE_CACHE_DAY)
          || (keepUser !== null && (!keepUser || userId !== keepUser));
        if (stale || (onlyCurrent && key.endsWith(':current'))) {
          localStorage.removeItem(key);
        } else if (day === ARCHIVE_CACHE_DAY) {
          archived.push(key);
        }
      }
      // Bound storage: keep the most recent archived dates only.
      archived
        .sort((left, right) => right.slice(right.lastIndexOf(':'))
          .localeCompare(left.slice(left.lastIndexOf(':'))))
        .slice(MAX_ARCHIVED_TABLEAUX)
        .forEach((key) => localStorage.removeItem(key));
    } catch (_) {}
  }

  function readDailyTableau(featureKey, selectedDate) {
    const userId = tableauCacheUser();
    if (!userId) return null;
    try {
      const raw = localStorage.getItem(tableauCacheKey(featureKey, selectedDate, userId));
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (!entry || entry.userId !== userId
        || entry.day !== tableauEntryDay(selectedDate)) return null;
      if (entry.grant?.expires_at && Date.parse(entry.grant.expires_at) <= Date.now()) {
        return null;
      }
      return entry;
    } catch (_) {
      return null;
    }
  }

  function isMaskedTableauPayload(payload) {
    try {
      return /"key"\s*:\s*"0{6}"/.test(JSON.stringify(payload));
    } catch (_) {
      return true;
    }
  }

  function writeDailyTableau(featureKey, selectedDate, payload, access = currentAccessState) {
    const userId = tableauCacheUser();
    if (!userId || payload == null || isMaskedTableauPayload(payload)) return;
    const key = normalizeTableauxFeature(featureKey);
    const grant = (access?.featureUnlocks || []).find((unlock) => (
      normalizeTableauxFeature(unlock?.feature_key || unlock?.featureKey) === key
      && (!unlock.expires_at || Date.parse(unlock.expires_at) > Date.now())
    )) || null;
    const subscription = access?.subscription?.status === 'active'
      ? access.subscription
      : null;
    try {
      localStorage.setItem(tableauCacheKey(key, selectedDate, userId), JSON.stringify({
        userId,
        day: tableauEntryDay(selectedDate),
        featureKey: key,
        selectedDate: selectedDate || null,
        savedAt: Date.now(),
        grant: grant
          ? { feature_key: key, expires_at: grant.expires_at || null }
          : subscription
            ? { plan: access.activePlan?.slug || null, expires_at: subscription.expires_at || null }
            : null,
        payload
      }));
    } catch (_) {
      // Quota or private browsing: the live request already succeeded.
    }
  }

  function hasDailyTableauGrant(featureKey) {
    const userId = tableauCacheUser();
    if (!userId) return false;
    const prefix = `${DAILY_TABLEAU_CACHE_PREFIX}${userId}:${tableauCacheDay()}:`
      + `${normalizeTableauxFeature(featureKey)}:`;
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith(prefix)) continue;
        const entry = JSON.parse(localStorage.getItem(key) || 'null');
        if (entry?.grant && (!entry.grant.expires_at
          || Date.parse(entry.grant.expires_at) > Date.now())) return true;
      }
    } catch (_) {}
    return false;
  }

  async function loadWithRetry(load, selectedDate) {
    try {
      return await load(selectedDate);
    } catch (firstError) {
      // A rate-limited Edge Function explicitly asks the caller to wait.
      // Retrying immediately would extend the lockout and create more
      // incomplete cards.
      if (isRateLimitError(firstError)) throw firstError;
      // Edge Functions can fail briefly while a daily row is being created.
      // One bounded retry avoids presenting a transient failure as missing
      // programme data while keeping the page responsive.
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      try {
        return await load(selectedDate);
      } catch (secondError) {
        secondError.firstError = firstError;
        throw secondError;
      }
    }
  }

  async function loadRemotePrograms(
    date = null,
    access = currentAccessState,
    verifiedFeatures = null
  ) {
    const selectedDate = date ? dateToIso(date) : undefined;
    const allowedProgramIds = new Set(
      TABLEAUX_PROGRAMS
        .filter((program) => canAccessTableauxFeature(program.featureKey, access, verifiedFeatures)
          || isVerifiedTableauxAdmin())
        .map((program) => program.id)
    );
    const requests = REMOTE_REQUESTS.filter((request) => (
      request.key === 'createdPrograms'
        ? allowedProgramIds.has('created')
        : allowedProgramIds.has(request.key)
    ));
    const authorizedLoad = async (request) => {
      const featureKey = request.key === 'createdPrograms'
        ? 'tableaux-created'
        : `tableaux-${request.key}`;
      if (isVerifiedTableauxAdmin()) {
        return withBudget(loadWithRetry(request.load, selectedDate));
      }
      // Same-day revisit of an unlocked Tableau: serve the local copy and
      // skip both the entitlement preflight and the programme request.
      const cached = readDailyTableau(featureKey, selectedDate);
      if (cached) return cached.payload;
      const verified = await withBudget(
        window.cidFeatureAccess?.verifyTableauxAccess?.(featureKey)
      ).catch(() => undefined);
      /*
       * Do not turn a failed/empty browser preflight into a false "no data"
       * state. A current individual unlock is enough to make the request; the
       * protected Edge Function checks the same entitlement again and will
       * return a masked payload if it is no longer valid.
       */
      const locallyAllowed = canAccessTableauxFeature(featureKey, access);
      if (verified !== true && !locallyAllowed) {
        throw new Error(`Accès serveur refusé pour ${featureKey}.`);
      }
      // A late answer is still stored for the next visit; this view simply
      // stops waiting for it once the budget is spent.
      const payload = await withBudget(
        loadWithRetry(request.load, selectedDate).then((value) => {
          writeDailyTableau(featureKey, selectedDate, value, access);
          return value;
        })
      );
      return payload;
    };
    // Each programme computes the same date method at the start of its own
    // server execution. There is no extra browser request or programme-to-
    // programme call; only the resulting payloads are rendered here.
    const results = await Promise.allSettled(
      requests.map((request) => authorizedLoad(request))
    );
    const values = new Map();
    const errors = [];
    results.forEach((result, index) => {
      const request = requests[index];
      if (result.status === 'rejected') {
        errors.push({
          key: request.key,
          label: request.label,
          message: remoteErrorMessage(result.reason)
        });
        console.warn(`Programme distant indisponible (${request.label})`, result.reason);
      } else {
        values.set(request.key, result.value);
      }
    });
    const valueAt = (key) => values.get(key) || null;
    const plans = {
      universal: valueAt('universal'),
      intuition: valueAt('intuition'),
      oracle: valueAt('oracle'),
      lnb: valueAt('lnb'),
      balsa: valueAt('balsa')
    };
    const serverDate = Object.values(plans)
      .map((plan) => plan?.date)
      .find((value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')))
      || valueAt('standby')?.weekDate
      || (selectedDate || publicationDayIso());
    return publicProgramsPayload(parseDate(serverDate), {
      plans,
      standby: valueAt('standby'),
      createdPrograms: valueAt('createdPrograms') || [],
      errors
    });
  }

  async function render(date = null) {
    // An explicit date is reserved for the historical date picker. For the
    // current programme, leave the field absent so every Edge Function uses
    // its server-side Africa/Abidjan 16:00 boundary.
    if (date) currentDate = date;
    viewingExplicitDate = Boolean(date);
    // Captured before any await so a render that straddles 16:00 UTC is
    // never recorded as the newer publication.
    const liveDay = date ? '' : publicationDayIso();
    setRemoteStatus('Calcul en cours', 'loading');
    // Refresh the entitlement before requesting programme data. This closes
    // the window where an administrator changes an offer while an old result
    // is still painted in the mounted Tableaux DOM.
    try {
      // On a slow network keep the last known entitlement instead of
      // re-locking cards that the daily cache can already paint.
      const access = await withBudget(window.cidFeatureAccess?.refresh?.())
        .catch(() => currentAccessState);
      currentAccessState = access || null;
      const verifiedFeatures = await verifyTableauxAccessSet();
      applyTableauxAccess(currentAccessState, verifiedFeatures);
      currentAccessState = {
        ...(currentAccessState || {}),
        __serverVerifiedTableaux: [...verifiedFeatures]
      };
      renderTableauxSections(currentAccessState);
    } catch (_) {
      currentAccessState = null;
      applyTableauxAccess(null);
    }
    // Do not briefly reveal values from the previously selected offer while
    // the newly authorised programme payload is being fetched.
    maskVisiblePortfolioValues();
    let programs = null;
    try {
      const verifiedFeatures = new Set(currentAccessState?.__serverVerifiedTableaux || []);
      programs = await loadRemotePrograms(date, currentAccessState, verifiedFeatures);
      if (programs?.date instanceof Date && !Number.isNaN(programs.date.getTime())) {
        currentDate = programs.date;
      }
      renderProgramDetails(programs);
      maskUnavailablePrograms(programs);
      if (programs.errors?.length) {
        const labels = programs.errors.map((error) => error.label).join(', ');
        setRemoteStatus(
          `Données indisponibles pour : ${labels}. Vérifiez la connexion Supabase.`,
          'error'
        );
      }
    } catch (error) {
      setRemoteStatus('Calcul indisponible. Vérifiez la connexion Supabase.', 'error');
      console.warn('Calcul serveur des tableaux impossible', error);
      return;
    }
    if (!programs?.errors?.length) {
      if (liveDay && !viewingExplicitDate) renderedPublicationDay = liveDay;
      setRemoteStatus('', 'ready');
      const status = get(VIEW_ID)?.querySelector('#tableauxRemoteStatus');
      if (status) status.hidden = true;
    }
    get(VIEW_ID)?.querySelectorAll('.date, .table-date').forEach((element) => {
      element.textContent = formatDate(currentDate);
    });
    const picker = get('datePicker');
    if (picker && picker.value !== dateToIso(currentDate)) {
      picker.value = dateToIso(currentDate);
    }
  }

  function mount() {
    const view = get(VIEW_ID);
    if (!view || view.dataset.mounted === 'true') {
      if (!view) return Promise.resolve();
      return withBudget(window.cidFeatureAccess?.refresh?.() || Promise.resolve(null))
        .catch(() => currentAccessState)
        .then((access) => {
          applyTableauxAccess(access);
          return render();
        });
    }
    view.dataset.layoutFreeze = 'v1';
    if (mountPromise) return mountPromise;
    // Paint the complete zero-valued shell synchronously. Authentication and
    // remote calculations can only hydrate this DOM; they can never replace
    // it with a blank or error screen.
    view.innerHTML = buildTableauxSkeletonMarkup();
    view.dataset.mounted = 'true';
    view.dataset.tableauxMountState = 'ready';
    installLockedDisplayGuard();
    tableauxViewUi();
    renderTableauxSections(null);
    applyTableauxAccess(null);
    view.querySelectorAll(
      '.portfolio-universal, .portfolio-intuition, .portfolio-oracle, ' +
      '.portfolio-manual, .portfolio-lnb, .portfolio-standby'
    ).forEach((element) => {
      element.dataset.layoutFreeze = 'v1';
    });
    view.querySelectorAll('.date, .table-date').forEach((element) => {
      element.textContent = formatDate(currentDate);
    });
    view.style.visibility = 'visible';
    if (!view.dataset.dateHandlerBound) {
      get('datePicker')?.addEventListener('change', (event) => {
        const nextDate = parseDate(event.target.value);
        render(nextDate);
      });
      view.dataset.dateHandlerBound = 'true';
    }
    mountPromise = Promise.all([
      withBudget(resolveTableauxAdminAccess()).catch(() => null),
      withBudget(window.cidFeatureAccess?.refresh?.() || Promise.resolve(null)).catch(() => null)
    ]).then(([, access]) => {
      applyTableauxAccess(access);
      return render();
    }).catch((error) => {
      // The stable shell remains visible even if authentication or hydration
      // is unavailable; inaccessible values stay at 00.
      applyTableauxAccess(null);
      console.warn('Hydratation serveur des tableaux indisponible', error);
    }).finally(() => {
      mountPromise = null;
    });
    return mountPromise;
  }

  function focusTableauFeature(featureKey, { priority = false } = {}) {
    const view = get(VIEW_ID);
    const key = normalizeTableauxFeature(featureKey);
    if (!view || !key) return;
    const portfolio = Array.from(view.querySelectorAll('[data-tableaux-route]'))
      .find((candidate) => candidate.dataset.tableauxRoute === key)
      || Object.values(PORTFOLIO_SELECTORS)
        .map((selector) => view.querySelector(selector))
        .find((candidate) => (
          candidate && featureKeyForPortfolio(candidate) === key
        ));
    if (!portfolio || portfolio.hidden) return;
    /*
     * The Tableaux host is the scroll owner. `scrollIntoView()` also walks
     * the document ancestors and can move the fixed application shell on
     * mobile, so keep the navigation inside this one surface.
     */
    const top = priority
      ? 0
      : Math.max(0, portfolio.offsetTop - 12);
    view.scrollTo({ top, left: 0, behavior: 'smooth' });
    const purchase = portfolio.querySelector(
      '.tableaux-schema-unlock, [data-tableaux-purchase]'
    );
    purchase?.focus?.({ preventScroll: true });
  }

  async function showTableauxView({
    updateHistory = true,
    catalogueMode = '',
    activeFeature = ''
  } = {}) {
    const currentSection = new URLSearchParams(window.location.search).get('section');
    const routedFeature = normalizeTableauxFeature(
      activeFeature
      || (currentSection === 'tableaux'
        ? new URLSearchParams(window.location.search).get('tableau')
        : '')
    );
    window.cidResetScrollLock?.({ closeModals: true, resetSurfaces: true });
    try { window.cidStartViewTransition?.('Tableaux'); } catch (_) {}
    window.cidNotifications?.close?.({ fromHistory: true });
    window.cidShowDedicatedView?.({
      id: 'tableaux',
      title: 'Tableaux',
      onBack: () => window.showCategoriesView?.()
    });
    hideOtherViews();
    markButtonActive();
    document.body.classList.remove('accueil-active', 'categories-active', 'calculator-active',
      'rejected-active', 'matrice-active', 'archive-active', 'croix-active');
    document.body.classList.add('tableaux-active');
    window.__activeTab = 'tableaux';
    window.__currentCategory = 'tableaux';
    window.cidRoutePersistence?.remember('tableaux');
    const targetView = get(VIEW_ID);
    if (targetView) {
      chooseCatalogueMode(targetView, catalogueMode);
      if (routedFeature) {
        targetView.dataset.tableauxActiveFeature = routedFeature;
      } else {
        delete targetView.dataset.tableauxActiveFeature;
      }
    }
    setViewVisibility(true);
    bindTableauxViewportSync();
    syncTableauxViewport({ resetScroll: true });
    if (updateHistory) {
      const url = new URL(window.location.href);
      url.searchParams.set('section', 'tableaux');
      if (routedFeature) {
        url.searchParams.set('tableau', routedFeature.replace(/^tableaux-/, ''));
      } else {
        url.searchParams.delete('tableau');
      }
      history.pushState({ view: 'tableaux' }, '', url.toString());
    }
    return ensureOriginalStyles().then(() => {
      // Dynamic legacy styles can change the header metrics. Re-read after
      // they are attached, then settle once more after the first DOM paint.
      syncTableauxViewport({ resetScroll: true });
      return mount();
    }).then(() => {
      if (routedFeature) {
        window.requestAnimationFrame(() => focusTableauFeature(routedFeature));
      }
    }).finally(() => {
      scheduleTableauxViewportSync({
        resetScroll: !routedFeature,
        settle: true
      });
      if (!routedFeature) {
        get(VIEW_ID)?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      }
      window.cidEarlyAccessUi?.refresh?.();
      try { window.cidFinishViewTransition?.(); } catch (_) {}
    });
  }

  function leaveTableauxView() {
    const view = get(VIEW_ID);
    if (!view || view.hidden) return;
    setViewVisibility(false);
    document.body.classList.remove('tableaux-active');
    if (document.body.dataset.cidDedicatedView === 'tableaux') {
      window.cidHideDedicatedView?.();
    }
    document.querySelectorAll(`#${BUTTON_ID}`).forEach((button) => {
      button.classList.remove('active');
      button.removeAttribute('aria-current');
      button.setAttribute('aria-pressed', 'false');
    });
    // Keep the legacy Tableaux CSS scoped to its section. The files were
    // warmed during startup, so adding them again on a later visit is
    // synchronous from the visitor's point of view and never shows a loader.
    removeOriginalStyles();
  }

  function init() {
    if (window.__tableauxViewInitialized) return;
    window.__tableauxViewInitialized = true;
    window.addEventListener('cid:admin-access', (event) => {
      setTableauxAdminAccess(event.detail?.isAdmin === true);
    });
    /*
     * A Tableaux view can stay mounted while the visitor changes account.
     * Clear both admin and entitlement state immediately, then revalidate the
     * new identity before allowing any protected values or buttons to return.
     */
    window.addEventListener('cid:auth-sync', (event) => {
      // Only the newly signed-in account may keep its daily Tableaux cache.
      purgeDailyTableauCache({ keepUser: String(event.detail?.id || '') });
      window.cidIsAdmin = false;
      setTableauxAdminAccess(false);
      const catalogueSnapshot = currentAccessState
        || window.cidSiteConfig?.state?.()
        || null;
      const publicCatalogue = catalogueSnapshot
        ? {
          ...catalogueSnapshot,
          subscription: null,
          activePlan: null,
          expiresAt: null,
          featureUnlocks: [],
          earlyAccessUnlocks: [],
          earlyAccessGrants: [],
          stars: 0,
          tokens: 0
        }
        : null;
      currentAccessState = publicCatalogue;
      const tableauxView = get(VIEW_ID);
      if (tableauxView) {
        delete tableauxView.dataset.tableauxCollectivePlan;
        delete tableauxView.dataset.tableauxActiveFeature;
        // A new account starts again from its own default catalogue.
        delete tableauxView.dataset.tableauxCatalogueChosen;
        delete tableauxView.dataset.tableauxShowAllOffers;
      }
      applyTableauxAccess(null);
      maskVisiblePortfolioValues();
      if (document.body.classList.contains('tableaux-active') && publicCatalogue) {
        renderTableauxSections(publicCatalogue);
      }
      if (!document.body.classList.contains('tableaux-active')) return;
      const userId = String(event.detail?.id || '');
      Promise.resolve(resolveTableauxAdminAccess())
        .catch(() => false)
        .then(() => {
          if (String(window.cidAuthCurrentUserId || '') !== userId) return;
          return render();
        })
        .catch(() => {});
    });
    // Returning to the foreground starts from the locked shell, then
    // re-applies the entitlement snapshot. feature-access answers from its
    // cache inside its freshness window and only reaches the database once
    // that window has lapsed, so switching apps no longer costs a request.
    // Protected values are still gated server-side by the Edge Functions.
    const revalidateBeforePaint = () => {
      if (document.visibilityState === 'hidden') return;
      if (!document.body.classList.contains('tableaux-active')) return;
      lockUntilDatabaseVerification();
      Promise.resolve(window.cidFeatureAccess?.load?.())
        .then((access) => {
          if (!access || !document.body.classList.contains('tableaux-active')) return;
          applyTableauxAccess(access);
        })
        .catch(() => {});
    };
    document.addEventListener('visibilitychange', revalidateBeforePaint);
    // The public catalogue can arrive after the first paint (signed-out
    // visitor, cold cache). Repaint the price cards as soon as it lands.
    window.addEventListener('cid:site-config-loaded', () => {
      if (!document.body.classList.contains('tableaux-active')) return;
      if (Array.isArray(currentAccessState?.rules) && currentAccessState.rules.length) return;
      renderTableauxSections(currentAccessState);
    });
    window.addEventListener('cid:feature-access-changed', (event) => {
      const access = event.detail || null;
      const grantChanged = accessGrantSignature(currentAccessState)
        !== accessGrantSignature(access);
      applyTableauxAccess(access);
      // An entitlement refresh can unlock a card while an older payload is
      // still in memory. Keep that payload masked until the fresh, authorised
      // response has been painted.
      if (grantChanged && access && currentPrograms
        && document.body.classList.contains('tableaux-active')) {
        maskVisiblePortfolioValues();
        render().catch(() => {});
      }
    });
    window.addEventListener('cid:subscription-unlocked', (event) => {
      const access = event.detail?.access || null;
      if (!access) return;
      const selectedFeature = normalizeTableauxFeature(
        get(VIEW_ID)?.dataset.tableauxActiveFeature || ''
      );
      if (selectedFeature) priorityFeatureKey = selectedFeature;
      currentAccessState = access;
      applyTableauxAccess(access);
      maskVisiblePortfolioValues();
      renderTableauxSections(access);
      // Locked programmes are intentionally not fetched. Once the purchase
      // succeeds, fetch the newly authorised result set so the dedicated
      // section shows real values instead of an empty masked preview.
      if (document.body.classList.contains('tableaux-active')) {
        render()
          .then(() => {
            if (selectedFeature) {
              window.requestAnimationFrame(() => {
                focusTableauFeature(selectedFeature, { priority: true });
              });
            }
          })
          .catch(() => {});
      }
    });
    window.addEventListener('cid:feature-unlocked', (event) => {
      const access = event.detail?.access || null;
      if (!access || !document.body.classList.contains('tableaux-active')) return;
      const unlockedFeature = normalizeTableauxFeature(
        event.detail?.featureKey || ''
      );
      if (unlockedFeature) priorityFeatureKey = unlockedFeature;
      currentAccessState = access;
      applyTableauxAccess(access);
      // Only the newly unlocked function is requested on the next render;
      // every other card stays masked and keeps its own unlock button.
      render()
        .then(() => {
          if (unlockedFeature) {
            window.requestAnimationFrame(() => {
              focusTableauFeature(unlockedFeature, { priority: true });
            });
          }
        })
        .catch(() => {});
    });
    /*
     * Early access changes the requested programme date, not the underlying
     * schema entitlement. Refresh explicitly so Universelle switches to the
     * following day's canonical row immediately after the token debit.
     */
    window.cidRefreshTableaux = () => {
      if (document.body.classList.contains('tableaux-active')) {
        render().catch(() => {});
      }
    };
    /*
     * Anticipé reads only after the entitlement layer has confirmed the
     * matching early-access grant. The remote loaders still enforce their
     * own server-side access rules and return validated public payloads.
     */
    window.cidFetchTableauxForDate = async (value) => {
      const dateKey = String(value || '').slice(0, 10);
      const currentDateKey = currentPrograms?.date instanceof Date
        ? dateToIso(currentPrograms.date)
        : String(currentPrograms?.date || '').slice(0, 10);
      /*
       * The first history card is today's publication. Reuse the exact
       * payload that is already painted in Tableaux when its date matches,
       * so the archive cannot show a second Balsa/jaune calculation for the
       * same day after a refresh or a cache race.
       */
      if (
        currentPrograms
        && dateKey
        && dateKey === currentDateKey
        && !document.body.classList.contains('anticipation-active')
      ) {
        return currentPrograms;
      }
      const date = parseDate(dateKey);
      const access = await window.cidFeatureAccess?.refresh?.();
      const verifiedFeatures = await verifyTableauxAccessSet();
      return loadRemotePrograms(date, access || null, verifiedFeatures);
    };
    window.addEventListener('cid:early-access-unlocked', (event) => {
      // The "current" programme may now be the anticipated one.
      purgeDailyTableauCache({ onlyCurrent: true });
      if (event.detail?.featureKey !== 'tableaux-universelle'
        || !document.body.classList.contains('tableaux-active')) return;
      window.cidRefreshTableaux();
    });
    window.addEventListener('cid:admin-access-updated', () => {
      if (!document.body.classList.contains('tableaux-active')) return;
      render();
    });
    window.addEventListener('cid:site-config-loaded', () => {
      if (!document.body.classList.contains('tableaux-active')) return;
      render();
    });
    window.addEventListener('cid:language-change', () => {
      if (!document.body.classList.contains('tableaux-active')) return;
      render();
    });
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest(`#${BUTTON_ID}`);
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (document.body.classList.contains('tableaux-active') &&
          !get(VIEW_ID)?.hidden) {
        scheduleTableauxViewportSync({ resetScroll: true, settle: true });
        get(VIEW_ID)?.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
        return;
      }
      showTableauxView();
    }, true);
    document.addEventListener('dateChanged', (event) => {
      const date = event.detail instanceof Date ? event.detail : null;
      if (date && !get(VIEW_ID)?.hidden) render(date);
    });
    document.addEventListener('click', (event) => {
      const target = event.target;
      const numberButton = target instanceof Element
        ? target.closest(TABLEAUX_LUCKY_NUMBER_CELL_SELECTOR)
        : null;
      if (!numberButton) return;
      const number = Number(numberButton.dataset.number || numberButton.textContent);
      if (!Number.isInteger(number) || number < 1 || number > 90) return;
      document.dispatchEvent(new CustomEvent('validNumberClicked', {
        detail: { number, date: currentDate }
      }));
      numberButton.classList.add('highlighted');
      window.setTimeout(() => numberButton.classList.remove('highlighted'), 800);
    });
    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const portfolio = target.closest(
        '#tableauxViewContainer .tableaux-access-locked'
      );
      if (!portfolio || target.closest('.tableaux-access-badge')) return;
      const featureKey = featureKeyForPortfolio(portfolio);
      if (!featureKey) return;
      event.preventDefault();
      event.stopPropagation();
      window.cidFeatureAccess?.require(featureKey);
    }, true);
    window.addEventListener('popstate', (event) => {
      if (event.state?.view === 'tableaux' ||
          new URLSearchParams(window.location.search).get('section') === 'tableaux') {
        showTableauxView({ updateHistory: false });
      }
    });
    window.showTableauxView = showTableauxView;
    window.hideTableauxView = leaveTableauxView;
    /*
     * Anticipé uses the same server-backed interpretation of Tableau
     * entitlements. Exposing this read-only classifier prevents the two
     * routes from disagreeing about individual versus collective access.
     */
    window.cidTableauxAccessSource = tableauAccessSource;
    // Anticipé reuses the exact same Tableaux DOM mould. Prepare the hidden
    // shell on demand when a visitor opens an anticipated Tableau directly,
    // without navigating away from the Anticipé route.
    window.cidEnsureTableauxStyles = ensureOriginalStyles;
    window.cidReleaseTableauxStyles = removeOriginalStyles;
    window.cidEnsureTableauxAdminAccess = resolveTableauxAdminAccess;
    window.cidEnsureTableauxMounted = () => ensureOriginalStyles().then(() => {
      // `mount()` paints the canonical shell synchronously before starting
      // remote hydration. Anticipé only needs that DOM/CSS mould in order to
      // render its own validated payload. Return the mount promise so the
      // verified role boundary is ready before an anticipated request is
      // authorized; the request itself still carries its explicit date.
      return mount();
    });
    window.preloadTableauxView = preloadTableauxView;
    // Drop Tableaux cached on a previous day or for another account.
    purgeDailyTableauCache();
    /*
     * Same 16:00 UTC mechanism as Accueil / Croix nationale: when the app is
     * open at the boundary, or brought back to the foreground after it, and
     * the new publication is not what is painted, render() runs once. It
     * paints every Tableau already stored for the new programme day from
     * localStorage and requests only the missing ones (network, no-store).
     */
    useDailyDataRefresh({
      name: 'Tableaux',
      isActive: () => document.body.classList.contains('tableaux-active')
        && !document.body.classList.contains('anticipation-active')
        && get(VIEW_ID)?.dataset.mounted === 'true'
        && !viewingExplicitDate,
      hasPublication: (day) => renderedPublicationDay === day,
      refresh: () => {
        // The previous programme day's entries are no longer needed.
        purgeDailyTableauCache();
        return render();
      }
    });
    bindTableauxViewportSync();
    const selectedDate = get('datePicker')?.value;
    if (selectedDate) currentDate = parseDate(selectedDate);
    // Warm the static Tableaux resources during startup. The remote
    // calculations start only when the visitor opens this view.
    preloadTableauxView();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
