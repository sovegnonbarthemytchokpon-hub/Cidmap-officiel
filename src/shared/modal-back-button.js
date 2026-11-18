/*
 * Universal back control for dialogs.
 *
 * Secondary pages already share the header back button (#cidSectionBack,
 * see dedicated-view-shell.js). Dialogs did not: some only offered a small
 * "×" in a corner, others only a Cancel button at the very bottom. Every
 * modal dialog now gets an explicit "Retour" button in its top-left corner
 * that runs the dialog's own close action, so nobody depends on the browser
 * back button to get out.
 */

(() => {
  const DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"], dialog';
  const CLOSE_SELECTOR = [
    '[data-cid-plus-unlock-cancel]',
    '[data-cid-account-cancel]',
    '[data-cid-early-cancel]',
    '[data-tableaux-unlock-cancel]',
    '[data-comments-close]',
    '[data-cid-modal-close]',
    '[data-close]',
    '[data-dismiss]',
    '.modal-close',
    '[class*="-close"]',
    '[class*="close-"]',
    'button[aria-label^="Fermer"]',
    'button[aria-label^="Close"]',
    'button[aria-label^="Annuler"]'
  ].join(',');
  const CLOSE_LABEL = /^(annuler|fermer|plus tard|close|cancel|retour|×|✕)$/i;

  const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function findCloseControl(dialog, back) {
    const candidates = Array.from(dialog.querySelectorAll(CLOSE_SELECTOR))
      .filter((element) => element !== back && !element.closest('[data-cid-modal-back]'));
    if (candidates.length) return candidates[0];
    return Array.from(dialog.querySelectorAll('button')).find((button) => (
      button !== back && CLOSE_LABEL.test(String(button.textContent || '').trim())
    )) || null;
  }

  function closeDialog(dialog, back) {
    const control = findCloseControl(dialog, back);
    if (control) {
      control.click();
      return;
    }
    if (dialog.tagName === 'DIALOG' && typeof dialog.close === 'function') {
      dialog.close();
      return;
    }
    // Last resort: every dialog of the app listens to Escape.
    const escape = { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true };
    dialog.dispatchEvent(new KeyboardEvent('keydown', escape));
    document.dispatchEvent(new KeyboardEvent('keydown', escape));
  }

  /*
   * Full-screen overlays that carry the dialog role put the button inside
   * their visible card rather than on the dimmed backdrop.
   */
  function hostFor(dialog) {
    const first = dialog.firstElementChild;
    if (!first || dialog.children.length !== 1) return dialog;
    const position = window.getComputedStyle(dialog).position;
    return position === 'fixed' || position === 'absolute' ? first : dialog;
  }

  function enhance(dialog) {
    if (!(dialog instanceof HTMLElement)) return;
    if (dialog.dataset.cidModalBackReady === 'true') return;
    // Dialogs that already expose their own back control keep it.
    if (dialog.querySelector('[data-cid-modal-back], button[aria-label="Retour"]')) {
      dialog.dataset.cidModalBackReady = 'true';
      return;
    }
    const host = hostFor(dialog);
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'cid-modal-back cid-back-button';
    back.setAttribute('data-cid-modal-back', 'true');
    back.setAttribute('data-cid-back-button', 'true');
    back.setAttribute('aria-label', 'Retour');
    back.innerHTML = `${ICON}<span>Retour</span>`;
    back.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeDialog(dialog, back);
    });
    host.insertBefore(back, host.firstChild);
    dialog.dataset.cidModalBackReady = 'true';
  }

  function scan(root) {
    if (!(root instanceof Element)) return;
    if (root.matches(DIALOG_SELECTOR)) enhance(root);
    root.querySelectorAll?.(DIALOG_SELECTOR).forEach(enhance);
  }

  function start() {
    scan(document.body);
    new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach(scan);
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
