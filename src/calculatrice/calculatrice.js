/*
 * Déchiffrement — client adapter only.
 *
 * Le navigateur détecte les groupes collés et transmet les valeurs au serveur.
 * Le classement des chiffres et des combinaisons est effectué par l’Edge
 * Function autonome ; aucune formule propriétaire n’est calculée ici.
 */
(function secureMatrixCalculator() {
  const openButton = document.getElementById('matrixCalcBtn');
  const panel = document.getElementById('matrixCalculatorPanel');
  const input = document.getElementById('matrixCalcInput');
  const codeInput = document.getElementById('matrixCalcCode');
  const eventInput = document.getElementById('matrixCalcEvent');
  const clearButton = document.getElementById('matrixCalcClear');
  const runButton = document.getElementById('matrixCalcRun');
  const copyButton = document.getElementById('matrixCalcCopy');
  const plusPanel = document.getElementById('matrixCalcPlusPanel');
  const plusButton = document.getElementById('matrixCalcPlus');
  const plusStatus = document.getElementById('matrixCalcPlusStatus');
  const plusOutput = document.getElementById('matrixCalcPlusOutput');
  const plusDescription = document.getElementById('matrixCalcPlusDescription');
  const plusManualNumbers = document.getElementById('matrixCalcPlusManualNumbers');
  const plusManualClear = document.getElementById('matrixCalcPlusManualClear');
  const plusManualHint = document.getElementById('matrixCalcPlusManualHint');
  const plusSuggestions = document.getElementById('matrixCalcPlusSuggestions');
  const initialStep = document.getElementById('matrixCalcInitialStep');
  const backButton = document.getElementById('matrixCalcBack');
  const likeButton = document.getElementById('matrixCalcLike');
  const likeCount = document.getElementById('matrixCalcLikeCount');
  const likeStatus = document.getElementById('matrixCalcLikeStatus');
  const status = document.getElementById('matrixCalcStatus');
  const output = document.getElementById('matrixCalcOutput');
  const list = document.getElementById('matrixCalcList');
  const resultsModal = document.getElementById('matrixCalcResultsModal');
  const resultsModalList = document.getElementById('matrixCalcResultsModalList');
  const resultsModalTitle = document.getElementById('matrixCalcResultsModalTitle');
  const resultsModalClose = document.getElementById('matrixCalcResultsModalClose');
  const resultsModalDone = document.getElementById('matrixCalcResultsModalDone');

  if (!panel || !runButton || !list) return;

  const CALCULATOR_LIKE_KEY = 'calculator:dechiffrement-mt';
  let calculationEpoch = 0;
  let modalReturnFocus = null;
  let likeOperationPending = false;
  let likeRealtimeCleanup = null;
  let latestLikeMetrics = { likes: 0, liked: false };
  /*
   * How many numbers Déchiffrement avancé accepts is decided by the server.
   * The deployed `dechiffrement-mt` function accepts any list of 1 to 90
   * distinct numbers (01–90), typed freely and independently of the Matrice.
   * When it answers "de X à Y numéros" / "entre X et Y numéros", the field
   * and the local validation follow that answer.
   */
  const plusLimits = { min: 1, max: 90 };
  // The ten Matrice numbers, offered as tappable shortcuts for the field.
  let plusSuggestedNumbers = [];
  // True once the field was filled with the Matrice numbers: the shortcuts
  // below would only repeat them, so they stay hidden.
  let plusFilledFromMatrix = false;
  // Matrice / Clavier / Cerveau of the last calculation: the advanced
  // analysis is computed against the official Matrice, not only the numbers.
  let lastProgramSources = null;
  const keyboardFields = [
    input,
    codeInput,
    eventInput,
    plusManualNumbers
  ].filter(Boolean);

  const setKeyboardMode = (active, target = null) => {
    document.body.classList.toggle('matrix-keyboard-open', active);
    panel.classList.toggle('matrix-keyboard-open', active);
    if (!active || !target) return;
    window.setTimeout(() => {
      if (document.activeElement !== target) return;
      target.scrollIntoView?.({
        block: 'center',
        inline: 'nearest',
        behavior: 'smooth'
      });
    }, 140);
  };

  const setStatus = (message, error = false) => {
    if (!status) return;
    status.textContent = message;
    status.style.color = error ? '#D62828' : '#0A1840';
  };

  const setPlusStatus = (message, error = false) => {
    if (!plusStatus) return;
    plusStatus.textContent = message;
    plusStatus.style.color = error ? '#B42318' : '#6B4A1A';
  };

  const formatAccessAmount = (value) => Math.max(
    0,
    Math.trunc(Number(value) || 0)
  ).toLocaleString(window.cidTranslation?.current?.() || 'fr');

  const accessDurationDays = (rule) => Math.max(
    1,
    Math.trunc(Number(rule?.duration_days) || 30)
  );

  const accessEndDateLabel = (days) => {
    const end = new Date();
    end.setDate(end.getDate() + Math.max(1, Number(days) || 30));
    return new Intl.DateTimeFormat(
      window.cidTranslation?.current?.() || 'fr',
      {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Africa/Abidjan'
      }
    ).format(end);
  };

  const plusUnlockExplanation = [
    'Après le déblocage, vous saisissez librement autant de numéros que vous voulez (de 01 à 90), avec ou sans calcul de la Matrice.',
    'Il recherche les correspondances enregistrées dans la base de données et classe les résultats en couples, triplets, quadruplets et autres groupes liés.',
    'Le traitement est effectué par le serveur selon la méthode configurée ; aucun résultat n’est débité avant votre confirmation.'
  ];

  // Balances/costs may arrive formatted ("24 000", incl. non-breaking
  // spaces); Number() would read them as NaN -> 0. Strip separators first.
  const parseAmount = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const digits = String(value ?? '').replace(/[\s\u00a0\u202f'’.,]/g, '');
    const parsed = Number(digits);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const requestPlusUnlockConfirmation = ({ rule, access, trigger }) => {
    const currency = rule?.unlock_currency === 'stars' ? 'stars' : 'tokens';
    const label = currency === 'tokens' ? 'jeton' : 'étoile';
    const plural = currency === 'tokens' ? 'jetons' : 'étoiles';
    const required = Math.max(0, Math.trunc(parseAmount(
      currency === 'tokens' ? rule?.required_tokens : rule?.required_stars
    )));
    const current = Math.max(0, Math.trunc(parseAmount(access?.[currency])));
    const missing = Math.max(0, required - current);
    const enoughBalance = current >= required;
    const remaining = Math.max(0, current - required);
    const durationDays = accessDurationDays(rule);
    const durationLabel = `${durationDays} jour${durationDays === 1 ? '' : 's'}`;
    const activeValidityLabel = () => {
      const expiresAt = window.cidFeatureAccess?.expiresAt?.(
        'tableaux-dechiffrement-plus'
      );
      if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
        return window.cidIsAdmin === true
          ? 'accès administrateur illimité'
          : `validité : ${durationLabel}`;
      }
      const dateLabel = expiresAt.toLocaleDateString(window.cidTranslation?.current?.() || 'fr', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
      return `accès valable jusqu’au ${dateLabel}`;
    };
    const endDateLabel = accessEndDateLabel(durationDays);

    return new Promise((resolve) => {
      let settled = false;
      const modal = document.createElement('div');
      modal.className = [
        'modal-overlay',
        'cid-payment-overlay',
        'cid-unlock-confirmation',
        'cid-plus-unlock-confirmation',
        enoughBalance ? 'is-balance-sufficient' : 'is-balance-insufficient',
        'open'
      ].join(' ');
      modal.setAttribute('role', 'presentation');
      modal.setAttribute(
        'aria-label',
        enoughBalance ? 'Confirmation du déblocage' : 'Solde insuffisant'
      );
      modal.innerHTML = `
        <section class="cid-unlock-confirmation__card"
                 role="dialog"
                 aria-modal="true"
                 aria-labelledby="cidPlusUnlockTitle">
          <span class="cid-unlock-confirmation__eyebrow">${
            enoughBalance ? 'Déblocage sécurisé' : 'Solde insuffisant'
          }</span>
          <h2 id="cidPlusUnlockTitle">${
            enoughBalance ? 'Déchiffrement avancé' : 'Déblocage nécessaire'
          }</h2>
          <p>${
            enoughBalance
              ? 'Votre compte peut débloquer ce service. Vérifiez le coût et confirmez pour continuer.'
              : `Il vous manque ${formatAccessAmount(missing)} ${missing === 1 ? label : plural} pour utiliser ce service.`
          }</p>
          <div class="cid-unlock-confirmation__included">
            <strong>Comment le service fonctionne après déblocage</strong>
            <ul>
              ${plusUnlockExplanation.map((item) => `<li>${item}</li>`).join('')}
            </ul>
            <small>Les numéros à analyser seront demandés seulement après l’activation du service.</small>
            <div class="cid-plus-unlock-validity">
              <span>Validité configurée</span>
              <b>${durationLabel}</b>
              <span>Début</span>
              <b>à partir de la confirmation</b>
              <span>Fin prévue si confirmé aujourd’hui</span>
              <b>${endDateLabel}</b>
            </div>
          </div>
          <dl class="cid-unlock-confirmation__summary">
            <div>
              <dt>Coût du déchiffrement</dt>
              <dd>${formatAccessAmount(required)} ${required === 1 ? label : plural}</dd>
            </div>
            <div>
              <dt>Solde actuel</dt>
              <dd>${formatAccessAmount(current)} ${current === 1 ? label : plural}</dd>
            </div>
            <div class="${enoughBalance ? 'is-total' : 'is-insufficient'}">
              <dt>${enoughBalance ? 'Solde après déblocage' : 'Solde manquant'}</dt>
              <dd>${formatAccessAmount(enoughBalance ? remaining : missing)} ${
                (enoughBalance ? remaining : missing) === 1 ? label : plural
              }</dd>
            </div>
          </dl>
          <div class="cid-unlock-confirmation__actions">
            <button type="button"
                    class="tableaux-button tableaux-button--secondary"
                    data-cid-plus-unlock-cancel>Annuler</button>
            <button type="button"
                    class="tableaux-button tableaux-button--primary cid-buy-button"
                    data-cid-plus-unlock-action>
              ${enoughBalance
                ? 'Confirmer le déblocage'
                : `Acheter ${formatAccessAmount(missing)} ${missing === 1 ? label : plural}`}
            </button>
          </div>
        </section>`;

      const cancelButton = modal.querySelector('[data-cid-plus-unlock-cancel]');
      const actionButton = modal.querySelector('[data-cid-plus-unlock-action]');
      const settle = (result) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKeyDown);
        modal.remove();
        trigger?.focus?.({ preventScroll: true });
        resolve(result);
      };
      const onKeyDown = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        settle({ confirmed: false, cancelled: true });
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
      cancelButton?.focus({ preventScroll: true });
    });
  };

  const setLikeStatus = (message, error = false) => {
    document.querySelectorAll('[data-matrix-like-status]').forEach((element) => {
      element.textContent = message;
      element.style.color = error ? '#B42318' : '#667085';
    });
  };

  const showInitialStep = ({ focus = false } = {}) => {
    if (initialStep) initialStep.hidden = false;
    if (plusPanel) {
      plusPanel.style.display = 'block';
      plusPanel.hidden = false;
    }
    if (output) output.style.display = 'none';
    if (copyButton) copyButton.style.display = 'none';
    panel.classList.remove('matrix-calc-plus-active');
    panel.classList.remove('matrix-calc-plus-dedicated');
    panel.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
    if (focus) {
      window.setTimeout(() => input?.focus({ preventScroll: true }), 0);
    }
  };

  const showPlusStep = ({ focus = false } = {}) => {
    if (initialStep) initialStep.hidden = true;
    if (plusPanel) {
      plusPanel.hidden = false;
      plusPanel.style.display = 'block';
    }
    if (output) output.style.display = 'block';
    if (copyButton) copyButton.style.display = 'inline-flex';
    panel.classList.add('matrix-calc-plus-active');
    panel.classList.add('matrix-calc-plus-dedicated');
    panel.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
    if (focus) {
      window.setTimeout(() => plusButton?.focus({ preventScroll: true }), 0);
    }
  };

  const clearCalculator = () => {
    calculationEpoch += 1;
    [
      input,
      codeInput,
      eventInput,
      plusManualNumbers
    ].forEach((field) => {
      if (field) field.value = '';
    });

    panel.removeAttribute('data-last-results');
    lastProgramSources = null;
    plusSuggestedNumbers = [];
    plusFilledFromMatrix = false;
    applyPlusLimits();
    list.innerHTML = '';
    output.style.display = 'none';
    if (copyButton) copyButton.style.display = 'none';
    if (plusPanel) plusPanel.style.display = 'block';
    if (plusPanel) plusPanel.hidden = false;
    if (initialStep) initialStep.hidden = false;
    panel.classList.remove('matrix-calc-plus-active');
    panel.classList.remove('matrix-calc-plus-dedicated');
    if (plusOutput) {
      plusOutput.innerHTML = '';
      plusOutput.style.display = 'none';
    }
    setStatus('');
    setPlusStatus('');
    closeResultsModal();
  };

  const closeResultsModal = () => {
    if (!resultsModal || resultsModal.hidden) return;
    resultsModal.hidden = true;
    resultsModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('matrix-calc-modal-open');
    window.cidResetScrollLock?.({ resetSurfaces: false });
    const returnTarget = modalReturnFocus;
    modalReturnFocus = null;
    if (returnTarget && document.contains(returnTarget)) {
      window.setTimeout(() => returnTarget.focus({ preventScroll: true }), 0);
    }
  };

  const openResultsModal = (numbers, program = {}) => {
    if (!resultsModal || !resultsModalList) return;
    const formattedNumbers = numbers.map((value) => String(value).padStart(2, '0'));
    resultsModalList.innerHTML = '';
    formattedNumbers.forEach((value, index) => {
      const item = document.createElement('div');
      item.className = 'matrix-calc-results-number';
      item.setAttribute('role', 'listitem');
      const order = document.createElement('span');
      order.className = 'matrix-calc-results-index';
      order.textContent = String(index + 1);
      const number = document.createElement('strong');
      number.textContent = value;
      item.append(order, number);
      resultsModalList.appendChild(item);
    });
    if (resultsModalTitle) {
      resultsModalTitle.textContent = `${program.name || program.country || 'Matrice'} · 10 numéros`;
    }
    modalReturnFocus = document.activeElement;
    resultsModal.hidden = false;
    resultsModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('matrix-calc-modal-open');
    window.requestAnimationFrame(() => resultsModalClose?.focus({ preventScroll: true }));
  };

  const renderLikeMetrics = (metrics = {}) => {
    const likes = Math.max(0, Number(metrics.likes) || 0);
    const label = `${likes} ${likes === 1 ? 'personne aime' : 'personnes aiment'}`;
    const liked = Boolean(metrics.liked);
    latestLikeMetrics = { likes, liked };
    // Only write real changes: the like-surface observer below watches the
    // DOM, and an identical write would wake it up again on every frame.
    document.querySelectorAll('[data-matrix-like-count]').forEach((element) => {
      if (element.textContent !== label) element.textContent = label;
    });
    document.querySelectorAll('[data-matrix-like]').forEach((button) => {
      button.setAttribute('aria-pressed', String(liked));
      button.classList.toggle('is-liked', liked);
    });
  };

  const refreshCalculatorLikes = async () => {
    const repository = window.cidSocialRepository;
    if (!repository?.getPostMetrics) return;
    try {
      const metrics = await repository.getPostMetrics(CALCULATOR_LIKE_KEY);
      renderLikeMetrics(metrics);
      setLikeStatus('');
    } catch (error) {
      console.warn('Compteur de likes de la calculatrice indisponible', error);
      setLikeStatus('Compteur momentanément indisponible.', true);
    }
  };

  const startCalculatorLikeRealtime = async () => {
    if (likeRealtimeCleanup || !window.cidSocialRepository?.subscribeToFeed) return;
    try {
      likeRealtimeCleanup = await window.cidSocialRepository.subscribeToFeed((event) => {
        const payload = event?.payload || {};
        const row = payload.new || payload.old || {};
        if (
          String(row.draw_id || '') !== CALCULATOR_LIKE_KEY
          && payload.eventType !== 'DELETE'
        ) return;
        // Counter already adjusted from the event itself: no read needed.
        if (event?.metrics && String(row.draw_id || '') === CALCULATOR_LIKE_KEY) {
          renderLikeMetrics(event.metrics);
          return;
        }
        refreshCalculatorLikes().catch(() => {});
      });
    } catch (error) {
      // Realtime is an enhancement; refresh on navigation/visibility remains
      // available when an older Supabase deployment has no publication.
      console.warn('Synchronisation temps réel du like indisponible', error);
    }
  };

  const refreshPlusOffer = async (providedAccess = null) => {
    if (!plusButton) return;
    const access = providedAccess
      || await Promise.resolve(window.cidFeatureAccess?.refresh?.()).catch(() => null);
    if (!access || typeof access !== 'object') {
      plusButton.disabled = true;
      plusButton.textContent = 'Déchiffrement avancé indisponible';
      plusButton.classList.remove('is-access-active', 'cid-buy-button');
      if (plusDescription) {
        plusDescription.textContent = 'Configuration des accès indisponible.';
      }
      return null;
    }
    const rule = access?.rules?.find((item) => (
      String(item?.feature_key || item?.featureKey || '').trim().toLowerCase()
        === 'tableaux-dechiffrement-plus'
    ));
    if (!rule || rule.enabled === false) {
      // No active rule means the administrator removed the lock. The feature
      // stays available without an unlock transaction.
      plusButton.disabled = false;
      plusButton.textContent = 'Déchiffrer maintenant';
      plusButton.classList.remove('cid-buy-button', 'is-access-active');
      if (plusDescription) {
        plusDescription.textContent = `Analyse de ${plusCountLabel()} : correspondances, couples, triplets, quadruplets et autres groupes selon la méthode configurée.`;
      }
      return {
        featureIsActive: true,
        balanceIsSufficient: true,
        required: 0,
        current: 0,
        currency: 'tokens'
      };
    }
    const currency = rule.unlock_currency === 'stars' ? 'stars' : 'tokens';
    const required = Math.max(0, Math.trunc(Number(
      currency === 'tokens' ? rule.required_tokens : rule.required_stars
    ) || 0));
    const current = Math.max(0, Math.trunc(parseAmount(access?.[currency])));
    const featureIsActive = window.cidFeatureAccess?.has?.(
      'tableaux-dechiffrement-plus'
    ) === true;
    const balanceIsSufficient = required === 0 || current >= required;
    const durationDays = accessDurationDays(rule);
    const durationLabel = `${durationDays} jour${durationDays === 1 ? '' : 's'}`;
    plusButton.disabled = false;
    if (featureIsActive) {
      plusButton.classList.remove('cid-buy-button');
      plusButton.classList.add('is-access-active');
      plusButton.innerHTML = '<span>Déchiffrer maintenant</span>';
      plusButton.setAttribute(
        'aria-label',
        'Déchiffrer maintenant — accès actif'
      );
    } else if (required > 0 && balanceIsSufficient) {
      plusButton.classList.add('cid-buy-button');
      plusButton.classList.remove('is-access-active');
      plusButton.innerHTML = '<span>Débloquer</span>';
      plusButton.setAttribute(
        'aria-label',
        `Débloquer le déchiffrement avancé — coût ${required} ${
          currency === 'tokens' ? 'jetons' : 'étoiles'
        }`
      );
    } else {
      plusButton.classList.toggle('cid-buy-button', required > 0);
      plusButton.classList.remove('is-access-active');
      plusButton.innerHTML = required > 0
        ? `<span class="cid-token-icon" aria-hidden="true"></span><span>Achat</span><span class="cid-inline-cost" aria-hidden="true">${required}</span>`
        : '<span>Déchiffrement avancé</span>';
      plusButton.setAttribute('aria-label', required > 0
        ? `Achat du déchiffrement avancé — coût ${required}`
        : 'Déchiffrement avancé');
    }
    if (plusDescription) {
      plusDescription.textContent = featureIsActive
        ? `Accès actif : cliquez sur « Déchiffrer maintenant » pour analyser vos numéros — ${activeValidityLabel()}.`
        : required > 0 && balanceIsSufficient
          ? `Votre solde est suffisant. Confirmez le déblocage de l’analyse pour ${required} ${currency === 'tokens' ? 'jetons' : 'étoiles'} — validité : ${durationLabel}.`
          : required > 0
            ? `Débloquez d’abord l’analyse de ${plusCountLabel()} : couples, triplets, quadruplets et autres groupes selon la méthode configurée — coût : ${required} ${currency === 'tokens' ? 'jetons' : 'étoiles'} · validité : ${durationLabel} à partir de la confirmation.`
            : `Analyse de ${plusCountLabel()} : couples, triplets, quadruplets et autres groupes selon la méthode configurée — validité : ${durationLabel}.`;
    }
    return {
      featureIsActive,
      balanceIsSufficient,
      required,
      current,
      currency
    };
  };

  const detectCodeAndEvent = () => {
    const parser = window.parseMatrixProgramme;
    if (typeof parser !== 'function' || !input?.value.trim()) return false;

    let parsed;
    try {
      parsed = parser(input.value);
    } catch (_) {
      return false;
    }

    const records = Array.isArray(parsed?.records)
      ? parsed.records.filter(Boolean)
      : [];
    if (!records.length) return false;

    /*
     * Un programme copié depuis la Matrice contient normalement un seul
     * bloc. Dans le cas de plusieurs blocs, on utilise le premier afin de
     * remplir les champs sans demander une saisie manuelle.
     */
    const record = records[0];
    const detectedCode = String(record.code || '')
      .replace(/\D/g, '')
      .slice(0, 3);
    const detectedEvent = String(record.event || '')
      .replace(/\D/g, '')
      .slice(0, 4);
    let detected = false;

    if (detectedCode && codeInput && codeInput.value.trim() !== detectedCode) {
      codeInput.value = detectedCode;
      detected = true;
    }
    if (detectedEvent && eventInput && eventInput.value.trim() !== detectedEvent) {
      eventInput.value = detectedEvent;
      detected = true;
    }

    if (detected) {
      setStatus('Code et Event détectés automatiquement.');
    }
    return detected;
  };

  const plusCountLabel = () => (plusLimits.min === plusLimits.max
    ? `${plusLimits.min} numéro${plusLimits.min > 1 ? 's' : ''}`
    : `${plusLimits.min} à ${plusLimits.max} numéros`);

  const typedPlusNumbers = () => (String(plusManualNumbers?.value || '').match(/\d{2}/g) || [])
    .map(Number);

  // Hint under the field: how many numbers are typed and what is wrong.
  const updatePlusHint = () => {
    if (!plusManualHint) return;
    const typed = typedPlusNumbers();
    const count = typed.length;
    const repeated = [...new Set(typed.filter((value, index) => typed.indexOf(value) !== index))];
    const outOfRange = typed.filter((value) => value < 1 || value > 90);
    const pad = (value) => String(value).padStart(2, '0');
    if (repeated.length) {
      plusManualHint.textContent = `Numéro${repeated.length > 1 ? 's' : ''} en double : ${repeated.map(pad).join(', ')}. Chaque numéro ne doit apparaître qu’une fois.`;
    } else if (outOfRange.length) {
      plusManualHint.textContent = `Hors limites : ${outOfRange.map(pad).join(', ')}. Les numéros vont de 01 à 90.`;
    } else if (!count) {
      plusManualHint.textContent = 'Saisissez autant de numéros que vous voulez (distincts, de 01 à 90).';
    } else if (count < plusLimits.min) {
      plusManualHint.textContent = `${count} numéro${count > 1 ? 's' : ''} saisi${count > 1 ? 's' : ''} — au moins ${plusLimits.min} requis.`;
    } else {
      plusManualHint.textContent = `${count} numéro${count > 1 ? 's' : ''} saisi${count > 1 ? 's' : ''} — vous pouvez lancer le déchiffrement ou en ajouter d’autres.`;
    }
  };

  // The field is a textarea that grows with its content so every number
  // stays readable, whether it holds the ten Matrice numbers or more.
  const resizePlusManualNumbers = () => {
    if (!plusManualNumbers) return;
    plusManualNumbers.style.height = 'auto';
    plusManualNumbers.style.height = `${plusManualNumbers.scrollHeight + 2}px`;
  };

  const renderPlusSuggestions = () => {
    resizePlusManualNumbers();
    if (!plusSuggestions) return;
    plusSuggestions.innerHTML = '';
    const showSuggestions = plusSuggestedNumbers.length > 0 && !plusFilledFromMatrix;
    plusSuggestions.hidden = !showSuggestions;
    if (!showSuggestions) return;
    const typed = new Set(typedPlusNumbers());
    const title = document.createElement('span');
    title.className = 'matrix-calc-plus-suggestions__label';
    title.textContent = 'Numéros de la Matrice (facultatif — touchez pour ajouter ou retirer)';
    plusSuggestions.appendChild(title);
    const chips = document.createElement('span');
    chips.className = 'matrix-calc-plus-suggestions__chips';
    plusSuggestedNumbers.forEach((value) => {
      const chip = document.createElement('button');
      const isPicked = typed.has(value);
      chip.type = 'button';
      chip.className = 'matrix-calc-plus-suggestion';
      chip.dataset.plusSuggestion = String(value);
      chip.setAttribute('aria-pressed', String(isPicked));
      chip.disabled = !isPicked && typed.size >= plusLimits.max;
      chip.textContent = String(value).padStart(2, '0');
      chips.appendChild(chip);
    });
    plusSuggestions.appendChild(chips);
  };

  const applyPlusLimits = () => {
    const fieldLabel = plusPanel?.querySelector('label[for="matrixCalcPlusManualNumbers"]');
    if (fieldLabel) fieldLabel.textContent = 'Numéros à analyser';
    if (plusManualNumbers) {
      plusManualNumbers.maxLength = plusLimits.max * 3 - 1;
      plusManualNumbers.setAttribute('aria-label', `Numéros à analyser (${plusCountLabel()})`);
    }
    updatePlusHint();
    renderPlusSuggestions();
  };

  // "Saisissez de 1 à 90 numéros distincts." / "entre 2 et 7 numéros" /
  // "exactement 10 numéros"
  const learnPlusLimits = (message) => {
    const text = String(message || '');
    const range = text.match(/(?:entre|de)\s+(\d{1,2})\s+(?:et|à)\s+(\d{1,2})\s+num/i);
    const exact = text.match(/exactement\s+(\d{1,2})\s+num/i);
    const min = Number(range?.[1] || exact?.[1]);
    const max = Number(range?.[2] || exact?.[1]);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > 90) {
      return false;
    }
    if (plusLimits.min === min && plusLimits.max === max) return false;
    plusLimits.min = min;
    plusLimits.max = max;
    applyPlusLimits();
    return true;
  };

  const formatManualPlusNumbers = (value, { completeLastNumber = false } = {}) => {
    let digits = String(value || '').replace(/\D/g, '').slice(0, plusLimits.max * 2);
    if (completeLastNumber && digits.length % 2 === 1) {
      digits = `${digits.slice(0, -1)}0${digits.slice(-1)}`;
    }
    return (digits.match(/\d{1,2}/g) || []).join(' ');
  };

  const caretAfterManualDigits = (formatted, digitCount) => {
    if (digitCount <= 0) return 0;
    let seen = 0;
    for (let index = 0; index < formatted.length; index += 1) {
      if (!/\d/.test(formatted[index])) continue;
      seen += 1;
      if (seen >= digitCount) return index + 1;
    }
    return formatted.length;
  };

  const syncManualPlusNumbers = ({ completeLastNumber = false } = {}) => {
    if (!plusManualNumbers) return;
    const before = String(plusManualNumbers.value || '');
    const selectionStart = Number.isFinite(plusManualNumbers.selectionStart)
      ? plusManualNumbers.selectionStart
      : before.length;
    const digitsBefore = before
      .slice(0, selectionStart)
      .replace(/\D/g, '')
      .length;
    const formatted = formatManualPlusNumbers(before, { completeLastNumber });
    plusManualNumbers.value = formatted;
    const digitCount = Math.min(
      digitsBefore,
      formatted.replace(/\D/g, '').length
    );
    const caret = caretAfterManualDigits(formatted, digitCount);
    try {
      plusManualNumbers.setSelectionRange(caret, caret);
    } catch (_) {}
  };

  const readManualPlusNumbers = () => {
    const raw = String(plusManualNumbers?.value || '').trim();
    if (!raw) return null;

    const parts = raw
      .replace(/[;,|/]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    if (parts.some((part) => !/^\d{2}$/.test(part))) {
      throw new Error('Chaque numéro s’écrit avec deux chiffres, de 01 à 90 (ex. 05).');
    }
    if (parts.length < plusLimits.min || parts.length > plusLimits.max) {
      throw new Error(
        `Saisissez ${plusCountLabel()} distincts (${parts.length} saisi${parts.length > 1 ? 's' : ''}).`
      );
    }

    const numbers = parts.map(Number);
    if (numbers.some((number) => number < 1 || number > 90)) {
      throw new Error('Les numéros doivent être compris entre 01 et 90.');
    }
    if (new Set(numbers).size !== numbers.length) {
      throw new Error('Chaque numéro ne doit apparaître qu’une fois dans la liste.');
    }

    return numbers;
  };

  const renderNumbers = (program) => {
    const numbers = Array.isArray(program?.ten_numbers)
      ? program.ten_numbers.map((value) => String(value)).slice(0, 10)
      : [];

    if (numbers.length !== 10) {
      setStatus('Le serveur n’a pas produit les 10 numéros attendus.', true);
      return;
    }

    list.innerHTML = '';
    const info = document.createElement('div');
    info.style.cssText = 'font-weight:800;margin:6px 0;color:#0A1840;';
    info.textContent = `${program.name || program.country || 'Matrice'} — 10 numéros proposés`;
    list.appendChild(info);

    const grid = document.createElement('div');
    grid.className = 'matrix-calc-number-grid';
    grid.style.cssText = [
      'display:grid',
      'grid-template-columns:repeat(5,1fr)',
      'gap:8px',
      'margin-top:8px',
      'align-items:center',
      'justify-items:center',
      'width:100%'
    ].join(';');

    numbers.forEach((value) => {
      const cell = document.createElement('div');
      cell.className = 'matrix-calc-number';
      cell.style.cssText = [
        'width:64px',
        'height:64px',
        'border-radius:10px',
        'background:#fff',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'border:2px solid #0962D6',
        'font-weight:900',
        'color:#0962D6',
        'font-size:18px',
        'box-sizing:border-box'
      ].join(';');
      cell.textContent = value;
      grid.appendChild(cell);
    });

    list.appendChild(grid);
    output.style.display = 'block';
    if (copyButton) copyButton.style.display = 'inline-flex';
    panel.dataset.lastResults = JSON.stringify(numbers);
    lastProgramSources = {
      matrix: Array.isArray(program.matrix) ? program.matrix : undefined,
      keyboard: Array.isArray(program.keyboard) ? program.keyboard : undefined,
      cerveau: Array.isArray(program.cerveau) ? program.cerveau : undefined
    };
    plusSuggestedNumbers = [...new Set(numbers
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => value >= 1 && value <= 90))];
    plusFilledFromMatrix = false;
    if (plusManualNumbers) plusManualNumbers.value = '';
    applyPlusLimits();
    if (initialStep) initialStep.hidden = false;
    if (plusPanel) {
      plusPanel.style.display = 'block';
      plusPanel.hidden = false;
    }
    panel.classList.remove('matrix-calc-plus-active');
    if (plusOutput) {
      plusOutput.innerHTML = '';
      plusOutput.style.display = 'none';
    }
    setPlusStatus('');
    refreshPlusOffer().catch(() => {});
    setStatus('10 numéros calculés à partir des valeurs saisies.');
    openResultsModal(numbers, program);
  };

  /*
   * Results → matrix input, without reloading the app. The pasted matrix is
   * kept so it can be corrected; the ten numbers and any advanced analysis
   * are discarded, and a pending server answer is ignored (epoch bump).
   */
  const returnToMatrixInput = ({ focus = false } = {}) => {
    calculationEpoch += 1;
    closeResultsModal();
    panel.removeAttribute('data-last-results');
    lastProgramSources = null;
    list.innerHTML = '';
    if (plusManualNumbers) plusManualNumbers.value = '';
    plusSuggestedNumbers = [];
    plusFilledFromMatrix = false;
    applyPlusLimits();
    if (plusOutput) {
      plusOutput.innerHTML = '';
      plusOutput.style.display = 'none';
    }
    setPlusStatus('');
    showInitialStep({ focus });
    setStatus('Vous pouvez refaire un calcul avec une nouvelle matrice.');
  };

  /*
   * "Déchiffrement avancé" in the results dialog: the ten Matrice numbers go
   * straight into the "Numéros à analyser" field so nothing has to be typed.
   */
  const continueToPlusStep = () => {
    closeResultsModal();
    if (plusManualNumbers && plusSuggestedNumbers.length) {
      plusManualNumbers.value = plusSuggestedNumbers
        .slice(0, plusLimits.max)
        .map((number) => String(number).padStart(2, '0'))
        .join(' ');
      plusFilledFromMatrix = true;
      updatePlusHint();
      renderPlusSuggestions();
    }
    showPlusStep({ focus: true });
    requestAnimationFrame(resizePlusManualNumbers);
    setStatus('Les 10 numéros de la Matrice sont prêts pour le déchiffrement avancé.');
  };

  // Same names as the deployed server, used only when its label is missing
  // or no longer matches the group once repeated numbers are removed.
  const GROUP_LABELS = {
    2: 'Couplé',
    3: 'Triplet',
    4: 'Quadruplet',
    5: 'Quintuplet',
    6: 'Sextuplet',
    7: 'Septuplet',
    8: 'Octuplet'
  };

  /*
   * The server computes and names the relations; the browser only guarantees
   * that no number is repeated inside a group (e.g. [14, 14, 28] → [14, 28]).
   * Groups left with a single number carry no relation and identical groups
   * are shown once.
   */
  const cleanPlusGroups = (calls) => {
    const seen = new Set();
    return calls.reduce((groups, call) => {
      const raw = Array.isArray(call?.numbers)
        ? call.numbers
        : Array.isArray(call?.triplet)
          ? call.triplet
          : call?.caller != null && call?.called != null
            ? [call.caller, call.called]
            : [];
      const values = [...new Set(raw
        .map((value) => Number.parseInt(String(value).trim(), 10))
        .filter(Number.isFinite))];
      if (values.length < 2) return groups;
      const key = [...values].sort((a, b) => a - b).join('-');
      if (seen.has(key)) return groups;
      seen.add(key);
      const serverLabel = String(call?.label || '').trim();
      groups.push({
        size: values.length,
        values,
        label: serverLabel && values.length === raw.length
          ? serverLabel
          : GROUP_LABELS[values.length] || `${values.length} numéros liés`
      });
      return groups;
    }, [])
      // Couples first, then triplets, quadruplets… (stable within a size).
      .sort((a, b) => a.size - b.size);
  };

  const renderPlus = (plus) => {
    if (!plusOutput) return;
    const calls = cleanPlusGroups(Array.isArray(plus?.calls) ? plus.calls : []);
    plusOutput.innerHTML = '';
    plusOutput.classList.add('matrix-plus-results');

    const heading = document.createElement('div');
    heading.className = 'matrix-plus-results__heading';
    heading.textContent = calls.length
      ? `Déchiffrement avancé — ${calls.length} groupe${calls.length === 1 ? '' : 's'} trouvé${calls.length === 1 ? '' : 's'}`
      : `Aucun appel trouvé parmi les ${Array.isArray(plus?.inputNumbers) ? `${plus.inputNumbers.length} ` : ''}numéros analysés.`;
    plusOutput.appendChild(heading);

    const appendGroups = (groups) => {
      const rows = document.createElement('div');
      rows.className = 'matrix-plus-results__grid';
      rows.setAttribute('role', 'list');
      groups.forEach(({ values, label }) => {
        const row = document.createElement('div');
        row.className = 'matrix-plus-group';
        row.setAttribute('role', 'listitem');
        row.dataset.size = String(Math.min(values.length, 5));
        const title = document.createElement('span');
        title.className = 'matrix-plus-group__label';
        title.textContent = label;
        row.appendChild(title);
        const balls = document.createElement('span');
        balls.className = 'matrix-plus-group__balls';
        values.forEach((value) => {
          const ball = document.createElement('strong');
          ball.className = 'matrix-plus-group__ball';
          ball.textContent = String(value).padStart(2, '0');
          balls.appendChild(ball);
        });
        row.setAttribute('aria-label', `${label} : ${values.map((value) =>
          String(value).padStart(2, '0')
        ).join(', ')}`);
        row.appendChild(balls);
        rows.appendChild(row);
      });
      plusOutput.appendChild(rows);
    };

    if (calls.length) appendGroups(calls);

    // The server's own pick comes after every group, before "Forte probabilité".
    const selectedRaw = Array.isArray(plus?.selected)
      ? plus.selected
      : Array.isArray(plus?.selected?.numbers) ? plus.selected.numbers : [];
    const selected = [...new Set(selectedRaw
      .map((value) => Number.parseInt(String(value).trim(), 10))
      .filter(Number.isFinite))];
    if (selected.length) {
      const pick = document.createElement('div');
      pick.className = 'matrix-plus-group';
      pick.dataset.size = String(Math.min(selected.length, 5));
      const pickLabel = document.createElement('span');
      pickLabel.className = 'matrix-plus-group__label';
      pickLabel.textContent = String(plus?.selected?.label || 'Sélection');
      pick.appendChild(pickLabel);
      const pickBalls = document.createElement('span');
      pickBalls.className = 'matrix-plus-group__balls';
      selected.forEach((value) => {
        const ball = document.createElement('strong');
        ball.className = 'matrix-plus-group__ball';
        ball.textContent = String(value).padStart(2, '0');
        pickBalls.appendChild(ball);
      });
      pick.appendChild(pickBalls);
      plusOutput.appendChild(pick);
    }

    // Groups the server flags as most likely, listed after the full analysis.
    const likely = cleanPlusGroups(
      Array.isArray(plus?.highProbabilityCalls) ? plus.highProbabilityCalls : []
    );
    if (likely.length) {
      const likelyHeading = document.createElement('div');
      likelyHeading.className = 'matrix-plus-results__heading';
      likelyHeading.textContent = `Forte probabilité — ${likely.length} groupe${likely.length === 1 ? '' : 's'}`;
      plusOutput.appendChild(likelyHeading);
      appendGroups(likely);
    }
    plusOutput.style.display = 'block';
  };

  openButton?.addEventListener('click', () => {
    panel.style.display = 'block';
    if (!panel.dataset.lastResults) showInitialStep();
    panel.scrollTop = 0;
    panel.scrollLeft = 0;
    panel.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
    window.scrollTo(0, 0);
    refreshPlusOffer().catch(() => {});
    refreshCalculatorLikes().catch(() => {});
    startCalculatorLikeRealtime().catch(() => {});
  });

  document.addEventListener('click', async (event) => {
    const clickedLike = event.target.closest?.('[data-matrix-like]');
    if (!clickedLike || likeOperationPending) return;
    const repository = window.cidSocialRepository;
    if (!repository?.togglePostLike) {
      setLikeStatus('Le bouton J’aime est momentanément indisponible.', true);
      return;
    }

    event.preventDefault();
    likeOperationPending = true;
    document.querySelectorAll('[data-matrix-like]').forEach((button) => {
      button.disabled = true;
    });
    setLikeStatus('Enregistrement…');
    const previous = latestLikeMetrics || { likes: 0, liked: false };
    // Count the tap right away; the server answer confirms or reverts it.
    renderLikeMetrics({
      likes: previous.likes + (previous.liked ? -1 : 1),
      liked: !previous.liked
    });
    try {
      const liked = Boolean(await repository.togglePostLike(CALCULATOR_LIKE_KEY));
      renderLikeMetrics({
        likes: previous.likes + (liked === previous.liked ? 0 : (liked ? 1 : -1)),
        liked
      });
      if (liked && !previous.liked) window.cidPlayLikeSound?.();
      await refreshCalculatorLikes();
    } catch (error) {
      renderLikeMetrics(previous);
      setLikeStatus(
        error?.message || 'Connectez-vous pour aimer cette calculatrice.',
        true,
      );
    } finally {
      likeOperationPending = false;
      document.querySelectorAll('[data-matrix-like]').forEach((button) => {
        button.disabled = false;
      });
    }
  });

  input?.addEventListener('input', detectCodeAndEvent);
  input?.addEventListener('paste', () => {
    window.setTimeout(detectCodeAndEvent, 0);
  });

  [
    [codeInput, 3],
    [eventInput, 4]
  ].forEach(([field, maxLength]) => {
    field?.addEventListener('input', () => {
      const normalized = String(field.value || '')
        .replace(/\D/g, '')
        .slice(0, maxLength);
      if (field.value !== normalized) field.value = normalized;
    });
  });

  clearButton?.addEventListener('click', clearCalculator);
  backButton?.addEventListener('click', () => {
    returnToMatrixInput({ focus: true });
  });

  plusManualClear?.addEventListener('click', () => {
    if (!plusManualNumbers) return;
    plusManualNumbers.value = '';
    plusManualNumbers.dispatchEvent(new Event('input', { bubbles: true }));
    plusManualNumbers.focus({ preventScroll: true });
  });
  applyPlusLimits();
  plusManualNumbers?.addEventListener('input', () => {
    syncManualPlusNumbers();
    updatePlusHint();
    renderPlusSuggestions();
  });
  // Numbers are separated by spaces only: Enter must not add a line break.
  plusManualNumbers?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault();
  });
  window.addEventListener('resize', resizePlusManualNumbers);
  plusManualNumbers?.addEventListener('blur', () => {
    syncManualPlusNumbers({ completeLastNumber: true });
    updatePlusHint();
    renderPlusSuggestions();
  });

  plusSuggestions?.addEventListener('click', (event) => {
    const chip = event.target.closest?.('[data-plus-suggestion]');
    if (!chip || !plusManualNumbers) return;
    const value = Number(chip.dataset.plusSuggestion);
    const typed = typedPlusNumbers();
    const next = typed.includes(value)
      ? typed.filter((number) => number !== value)
      : typed.length < plusLimits.max ? [...typed, value] : typed;
    plusManualNumbers.value = next
      .map((number) => String(number).padStart(2, '0'))
      .join(' ');
    updatePlusHint();
    renderPlusSuggestions();
    setPlusStatus('');
    plusSuggestions
      .querySelector(`[data-plus-suggestion="${value}"]`)
      ?.focus({ preventScroll: true });
  });

  resultsModalClose?.addEventListener('click', closeResultsModal);
  resultsModalDone?.addEventListener('click', continueToPlusStep);
  resultsModal?.addEventListener('click', (event) => {
    if (event.target === resultsModal) closeResultsModal();
  });
  document.addEventListener('keydown', (event) => {
    if (!resultsModal || resultsModal.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeResultsModal();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = [resultsModalClose, resultsModalDone].filter(Boolean);
      if (!focusable.length) return;
      const currentIndex = focusable.indexOf(document.activeElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
      event.preventDefault();
      focusable[nextIndex].focus({ preventScroll: true });
    }
  });

  keyboardFields.forEach((field) => {
    field.addEventListener('focus', () => {
      setKeyboardMode(true, field);
    });
    field.addEventListener('blur', () => {
      window.setTimeout(() => {
        // Only another text field keeps the keyboard open. Tapping a button
        // in the panel ("Calculer", "Continuer"…) closes the keyboard, so the
        // keyboard mode must be released too.
        if (!keyboardFields.includes(document.activeElement)) {
          setKeyboardMode(false);
        }
      }, 180);
    });
  });

  runButton.addEventListener('click', async () => {
    const operationEpoch = ++calculationEpoch;
    runButton.disabled = true;
    setStatus('Déchiffrement sécurisé en cours…');

    try {
      const parsed = typeof window.parseMatrixProgramme === 'function'
        ? window.parseMatrixProgramme(input?.value || '')
        : { records: [], errors: [] };
      const record = Array.isArray(parsed.records) ? parsed.records[0] : null;
      const normalizedCode = String(codeInput?.value || '').trim();
      const normalizedEvent = String(eventInput?.value || '').trim();
      const europeanDate = String(record?.date || '').match(
        /^(\d{2})-(\d{2})-(\d{4})$/
      );
      const programmeDate = europeanDate
        ? `${europeanDate[3]}-${europeanDate[2]}-${europeanDate[1]}`
        : undefined;
      const response = await window.invokeDechiffrement?.({
        countryName: record?.name || undefined,
        programmeDate,
        matrix: record?.matrix || undefined,
        keyboard: record?.keyboard || undefined,
        cerveau: record?.brain || undefined,
        code: normalizedCode || record?.code || undefined,
        event: normalizedEvent || record?.event || undefined,
        saveHistory: true
      });
      if (!response?.program) {
        throw new Error('Le serveur de déchiffrement est indisponible.');
      }

      if (operationEpoch !== calculationEpoch) return;
      renderNumbers(response.program);
      if (response.fallback) {
        setStatus(
          'Résultats affichés. La synchronisation de la base serveur est momentanément indisponible.',
          true
        );
      } else if (response.existing) {
        setStatus('Cette Matrice existe déjà : les mêmes résultats ont été réutilisés.');
      } else if (response.history?.saved) {
        setStatus('Résultats validés et enregistrés dans votre historique.');
      }
    } catch (error) {
      console.warn('Lecture du déchiffrement impossible', error);
      setStatus(error?.message || 'Le calcul de la Matrice est indisponible.', true);
    } finally {
      runButton.disabled = false;
    }
  });

  plusButton?.addEventListener('click', async () => {
    const operationEpoch = ++calculationEpoch;
    plusButton.disabled = true;
    setPlusStatus('Vérification du déblocage…');
    try {
      const unlock = window.cidUnlockFeature;
      if (typeof unlock !== 'function') {
        throw new Error('Le service de déblocage est indisponible.');
      }
      const access = await Promise.resolve(
        window.cidFeatureAccess?.refresh?.()
      ).catch(() => null);
      if (!access || typeof access !== 'object') {
        throw new Error('Configuration des accès indisponible.');
      }
      const rule = access?.rules?.find((item) => (
        String(item?.feature_key || item?.featureKey || '').trim().toLowerCase()
          === 'tableaux-dechiffrement-plus'
      ));
      const activeRule = rule?.enabled === false ? null : rule;
      if (activeRule && !window.cidFeatureAccess?.has?.(
        'tableaux-dechiffrement-plus'
      )) {
        const decision = await requestPlusUnlockConfirmation({
          rule: activeRule,
          access,
          trigger: plusButton
        });
        if (decision?.buyTokens) {
          const currency = decision.currency === 'stars' ? 'stars' : 'tokens';
          const missing = Math.max(1, Math.trunc(Number(decision.missing) || 0));
          window.cidOpenBalancePanel?.({
            currency,
            quantity: missing,
            requiredTokens: currency === 'tokens'
              ? parseAmount(activeRule.required_tokens)
              : undefined,
            currentTokens: currency === 'tokens'
              ? parseAmount(access.tokens)
              : undefined,
            requiredStars: currency === 'stars'
              ? parseAmount(activeRule.required_stars)
              : undefined,
            currentStars: currency === 'stars'
              ? parseAmount(access.stars)
              : undefined,
            planSlug: 'tableaux-dechiffrement-plus',
            planName: 'Déchiffrement avancé',
            durationDays: Number(activeRule.duration_days) || 30,
            returnToTableaux: true,
            sectionId: 'dechiffrement-mt',
            notice: `Il vous manque ${formatAccessAmount(missing)} ${
              currency === 'tokens' ? 'jetons' : 'étoiles'
            } pour utiliser le Déchiffrement avancé.`,
            noticeKind: 'error'
          });
          setPlusStatus('Achetez les unités manquantes pour activer le service.', true);
          return;
        }
        if (!decision?.confirmed) {
          setPlusStatus('Déblocage nécessaire pour utiliser cette analyse.', true);
          return;
        }

        const unlocked = await unlock(
          'tableaux-dechiffrement-plus',
          {
            label: 'Déchiffrement avancé',
            requiredTokens: parseAmount(activeRule.required_tokens),
            requiredStars: parseAmount(activeRule.required_stars)
          }
        );
        if (!unlocked?.ok) {
          setPlusStatus(
            unlocked?.error || 'Déblocage impossible.',
            true
          );
          return;
        }
      }

      /*
       * Access is confirmed before reading the manual field. A locked
       * visitor therefore never receives a misleading “saisissez N
       * numéros” error; this validation belongs only to the active service.
       */
      const selectedNumbers = readManualPlusNumbers();
      if (!selectedNumbers) {
        throw new Error(
          'Saisissez au moins un numéro (de 01 à 90) avant de lancer le déchiffrement avancé.'
        );
      }

      const parsed = typeof window.parseMatrixProgramme === 'function'
        ? window.parseMatrixProgramme(input?.value || '')
        : { records: [] };
      const record = Array.isArray(parsed.records) ? parsed.records[0] : null;
      const sourceList = (value) => (Array.isArray(value) && value.length ? value : undefined);
      // The analysis works on the typed numbers alone; the Matrice, when one
      // was pasted or calculated, is only sent along as extra context.
      const matrix = sourceList(record?.matrix) || sourceList(lastProgramSources?.matrix);
      const response = await window.invokeDechiffrement?.({
        action: 'plus',
        numbers: selectedNumbers,
        matrix,
        keyboard: sourceList(record?.keyboard) || sourceList(lastProgramSources?.keyboard),
        cerveau: sourceList(record?.brain) || sourceList(lastProgramSources?.cerveau),
        name: record?.name || 'Matrice manuelle',
        date: record?.date || undefined,
        code: String(codeInput?.value || '').trim() || record?.code || undefined,
        event: String(eventInput?.value || '').trim() || record?.event || undefined,
        saveHistory: true
      });
      if (!response?.plus) {
        throw new Error('Le serveur Déchiffrement avancé n’a pas retourné d’analyse.');
      }
      if (operationEpoch !== calculationEpoch) return;
      renderPlus(response.plus);
      setPlusStatus('Déchiffrement avancé terminé.');
    } catch (error) {
      console.warn('Analyse Déchiffrement avancé impossible', error);
      if (learnPlusLimits(error?.message)) refreshPlusOffer().catch(() => {});
      const message = error?.name === 'DechiffrementTimeoutError'
        ? 'Votre accès est bien actif : aucun nouvel achat n’est nécessaire. Le serveur de calcul avancé ne répond pas actuellement ; réessayez plus tard.'
        : error?.message || 'Déchiffrement avancé indisponible.';
      setPlusStatus(message, true);
    } finally {
      plusButton.disabled = false;
    }
  });

  window.addEventListener('cid:feature-access-changed', (event) => {
    refreshPlusOffer(event.detail || null).catch(() => {});
  });
  /*
   * A Paystack top-up only credits the account; it must never debit the
   * feature automatically. Re-read the authoritative access snapshot so the
   * button changes from "Achat" to "Débloquer" as soon as the new balance is
   * available, or to the active state when the feature was already unlocked.
   */
  window.addEventListener('cid:payment-validated', async () => {
    const access = await Promise.resolve(
      window.cidFeatureAccess?.refresh?.()
    ).catch(() => null);
    const offer = await refreshPlusOffer(access).catch(() => null);
    if (access && plusStatus && offer) {
      if (offer.featureIsActive) {
        setPlusStatus('Accès actif : le déchiffrement avancé est débloqué.', false);
      } else if (offer.balanceIsSufficient) {
        setPlusStatus(
          'Solde actualisé. Cliquez sur « Débloquer » pour confirmer l’activation.',
          false
        );
      } else {
        setPlusStatus(
          `Solde actualisé. Il manque encore ${formatAccessAmount(
            Math.max(0, offer.required - offer.current)
          )} ${offer.currency === 'tokens' ? 'jetons' : 'étoiles'}.`,
          true
        );
      }
    }
  });
  window.addEventListener('cid:home-view-restored', () => {
    if (likeRealtimeCleanup) refreshCalculatorLikes().catch(() => {});
  });
  /*
   * The like counter is read when the calculator is opened (see above) and
   * kept live by realtime from then on. It is no longer read at page load,
   * on every focus or on every visibilitychange for visitors who never open
   * the calculator.
   */
  window.addEventListener('cid:auth-sync', () => {
    // The "liked" flag belongs to the account; only re-read it when the
    // calculator has actually been opened in this tab.
    if (likeRealtimeCleanup) refreshCalculatorLikes().catch(() => {});
  });

  let likeSurfaceFrame = 0;
  const likeSurfaceObserver = new MutationObserver(() => {
    if (likeSurfaceFrame) return;
    likeSurfaceFrame = window.requestAnimationFrame(() => {
      likeSurfaceFrame = 0;
      if (document.querySelector('[data-matrix-like]')) {
        renderLikeMetrics(latestLikeMetrics);
      }
    });
  });
  likeSurfaceObserver.observe(document.body, { childList: true, subtree: true });

  copyButton?.addEventListener('click', async () => {
    const values = panel.dataset.lastResults;
    if (!values) return;
    try {
      await navigator.clipboard.writeText(JSON.parse(values).join('\n'));
      setStatus('Résultats copiés.');
    } catch (_) {
      setStatus('Impossible de copier les résultats.', true);
    }
  });

  // Navigation can leave the calculator while a virtual keyboard or the
  // results dialog is active. The home route calls this hook to release every
  // calculator-owned scroll lock before it restores the feed.
  // The header Back button steps back inside the calculator first: from the
  // advanced step to the matrix input, then out of the section.
  window.cidCalculatorStepBack = () => {
    if (panel.style.display === 'none') return false;
    if (!panel.classList.contains('matrix-calc-plus-dedicated')) return false;
    returnToMatrixInput();
    return true;
  };

  window.__cidReleaseCalculatorScrollLocks = () => {
    closeResultsModal();
    document.body.classList.remove('matrix-keyboard-open', 'matrix-calc-modal-open');
    panel.classList.remove('matrix-keyboard-open');
  };
})();
