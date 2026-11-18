// /src/croix/draggableCross.js
// Disable any manual modification of the cross: make all numbers and texts non-interactive.
// This file intentionally avoids attaching pointer/mouse/touch listeners or persisting positions.

(function(){
  const root = document.getElementById('redCross');
  if (!root) return;

  // Make entire cross non-interactive so users cannot move or edit any elements.
  // allow pointer events on the cross container so long-press / taps can be detected,
  // while still preventing interaction on the internal number elements below
  root.style.pointerEvents = 'auto';

  // Re-enable pointer events only for true interactive controls (buttons/links) so they still work.
  Array.from(root.querySelectorAll('button, a')).forEach(el => {
    el.style.pointerEvents = 'auto';
  });

  // Force numbers and textual overlays to be non-interactive and static.
  Array.from(root.querySelectorAll('.cross-numbers .num, .termination, .term-paren, .term-title, #redCrossDate, .right-label, .redCrossFooter')).forEach(el => {
    el.style.pointerEvents = 'none';
    el.style.userSelect = 'none';
    el.style.touchAction = 'none';
    el.style.cursor = 'default';
  });

  // Apply black shadow + clear stroke for specific digits: 0,1,3,4,6,7,8,9
  (function applyDigitShadows() {
    const target = new Set(['0','1','3','4','5','6','7','8']); // updated per request: include 5 and exclude 9
    Array.from(root.querySelectorAll('.cross-numbers .num')).forEach(el => {
      const t = (el.textContent || '').trim();
      if (target.has(t)) {
        // strong black outer shadow and an extra thin black stroke for clarity
        el.style.textShadow = '0 6px 18px rgba(0,0,0,0.95), 0 2px 6px rgba(0,0,0,0.88)';
        el.style.webkitTextStroke = '2px #000';
        el.style.textStroke = '2px #000';
        // ensure the digit fill is white
        el.style.color = '#ffffff';
        el.style.webkitTextFillColor = '#ffffff';

        // Slightly enlarge these specific digits by computing their current computed font-size
        // and applying a modest scale-up as an inline !important override so it takes effect.
        try {
          const cs = window.getComputedStyle(el);
          const currentFs = parseFloat(cs.fontSize || '0');
          if (currentFs && !Number.isNaN(currentFs)) {
            // If the cross background is yellow (Accueil), enlarge more noticeably.
            const rootBg = window.getComputedStyle(root).backgroundColor || '';
            // detect yellow background approximately by checking for the hex token or rgb(255,215,0)
            const isYellow = /rgb\(\s*255,\s*215,\s*0\)|#ffd700/i.test(rootBg) || /ffd700/i.test(rootBg);
            const scale = isYellow ? 1.30 : 1.08; // larger scale when yellow
            const newFs = Math.round(currentFs * scale);
            el.style.setProperty('font-size', newFs + 'px', 'important');
            // keep line-height tight to avoid layout shifts
            el.style.setProperty('line-height', '1', 'important');
          }
        } catch (e) {
          // fallback: apply a small fixed increase if computed style not available
          try { 
            const rootBg = window.getComputedStyle(root).backgroundColor || '';
            const isYellow = /rgb\(\s*255,\s*215,\s*0\)|#ffd700/i.test(rootBg) || /ffd700/i.test(rootBg);
            el.style.setProperty('font-size', isYellow ? '96px' : '72px', 'important'); 
            el.style.setProperty('line-height', '1', 'important'); 
          } catch(_) {}
        }
      }
    });
  })();

  // Prevent any programmatic or user attempts to change numbers: block input/keyboard/drag/context and auto-revert changes.
  Array.from(root.querySelectorAll('.cross-numbers .num')).forEach(num => {
    num.setAttribute('aria-hidden','true');
    num.setAttribute('role','img');
    num.setAttribute('contenteditable','false');
    num.addEventListener('pointerdown', e => e.stopImmediatePropagation(), {capture:true});
    num.addEventListener('keydown', e => { e.preventDefault(); e.stopImmediatePropagation(); }, {capture:true});
    num.addEventListener('paste', e => { e.preventDefault(); e.stopImmediatePropagation(); }, {capture:true});
    num.addEventListener('contextmenu', e => e.preventDefault(), {capture:true});
    num.addEventListener('dragstart', e => e.preventDefault(), {capture:true});
  });

  // Explicit canonical percent positions for each slot (left%, top%)
  // These positions are enforced every load to keep the cross static and consistent.
  const CANONICAL_POS = {
    n1: { left: 34.0, top: 26.0 },
    n2: { left: 50.0, top: 38.0 },
    n3: { left: 66.0, top: 26.0 },
    n4: { left: 64.0, top: 50.0 },
    n5: { left: 66.0, top: 72.0 },
    n6: { left: 50.0, top: 64.0 },
    n7: { left: 34.0, top: 72.0 },
    n8: { left: 36.0, top: 50.0 }
  };

  // Enforce top-row and bottom-row identical vertical alignment and other micro-adjusts,
  // mirror 9/0 horizontally, micro-raise 0 by 1mm, and persist final positions.
  (function enforceFixedPositionsAndRows(){
    try {
      const nums = Array.from(root.querySelectorAll('.cross-numbers .num')).slice(0,8);
      if (nums.length < 8) return;
      // map by class n1..n8 fallback by index
      const getEl = (n) => nums.find(x => x.classList.contains(`n${n}`)) || nums[n-1] || null;

      // Apply canonical left/top first
      for (let i = 1; i <= 8; i++) {
        const el = getEl(i);
        const key = `n${i}`;
        if (!el) continue;
        const pos = CANONICAL_POS[key];
        if (pos) {
          el.style.setProperty('left', pos.left.toFixed(2) + '%', 'important');
          el.style.setProperty('top', pos.top.toFixed(2) + '%', 'important');
          el.style.setProperty('transform', 'translate(-50%,-50%)', 'important');
          el.style.setProperty('pointer-events','none','important');
          el.style.setProperty('user-select','none','important');
        }
      }

      // Ensure top row (n1,n2,n3) share same top (use median of their tops)
      const topEls = [getEl(1), getEl(2), getEl(3)].filter(Boolean);
      if (topEls.length) {
        const tops = topEls.map(el => parseFloat(String(el.style.top || getComputedStyle(el).top || '').replace('%','')) || null).filter(v => v !== null);
        if (tops.length) {
          tops.sort((a,b)=>a-b);
          const medianTop = tops[Math.floor(tops.length/2)];
          topEls.forEach(el => el.style.setProperty('top', medianTop.toFixed(2) + '%', 'important'));
        }
      }

      // Ensure bottom row (n5,n6,n7) share same top (median)
      const bottomEls = [getEl(5), getEl(6), getEl(7)].filter(Boolean);
      if (bottomEls.length) {
        const bTops = bottomEls.map(el => parseFloat(String(el.style.top || getComputedStyle(el).top || '').replace('%','')) || null).filter(v => v !== null);
        if (bTops.length) {
          bTops.sort((a,b)=>a-b);
          const medianBottom = bTops[Math.floor(bTops.length/2)];
          bottomEls.forEach(el => el.style.setProperty('top', medianBottom.toFixed(2) + '%', 'important'));
        }
      }

      // Mirror 9 and 0 symmetrically around center and bias 0 near right-button
      const el9 = nums.find(n => (n.textContent||'').trim() === '9') || getEl(3) || null; // try to locate 9
      const el0 = nums.find(n => (n.textContent||'').trim() === '0') || getEl(5) || null; // try to locate 0
      const rcRect = root.getBoundingClientRect();
      const centerX = 50;
      if (el9 && el0) {
        // compute percent left of 9
        const left9 = parseFloat(String(el9.style.left || getComputedStyle(el9).left || '').replace('%','')) || CANONICAL_POS.n3.left;
        const dist = Math.abs(left9 - centerX);
        // mirror position
        let mirrored = centerX - (left9 - centerX);
        // bias 0 toward right-button; estimate right button percent
        let rightBtnPercent = 88;
        try {
          const btn = root.querySelector('.black-square-btn');
          if (btn) {
            const btnRect = btn.getBoundingClientRect();
            rightBtnPercent = ((btnRect.left + btnRect.width/2 - rcRect.left) / rcRect.width) * 100;
          }
        } catch(e){}
        // nudge mirrored toward right button by up to 8% but not past it
        const nudged = Math.min(rightBtnPercent - 6, mirrored + 8);
        const finalLeft0 = Math.max(6, Math.min(94, nudged));
        el0.style.setProperty('left', finalLeft0.toFixed(2) + '%', 'important');
        // set vertical same as 9
        const top9 = parseFloat(String(el9.style.top || getComputedStyle(el9).top || '').replace('%','')) || CANONICAL_POS.n3.top;
        el0.style.setProperty('top', top9.toFixed(2) + '%', 'important');
        // micro-raise 0 by 1mm
        el0.style.setProperty('transform', 'translate(-50%,-50%) translateY(-1mm)', 'important');
      }

      // Ensure zero font-size matches five if present
      const el5 = nums.find(n => (n.textContent||'').trim() === '5');
      if (el0 && el5) {
        try {
          const fs5 = window.getComputedStyle(el5).fontSize;
          if (fs5) el0.style.setProperty('font-size', fs5, 'important');
        } catch(e){}
      }

      // NEW: Prevent bottom '1' and '3' from overlapping the white cross lines:
      // If slot n5 or n7 contains '1' or '3', nudge them upward (negative translateY) and ensure top percent sits above the canonical bottom row by at least 2%
      try {
        const bottomSlots = [{ slot:5, el: getEl(5) }, { slot:7, el: getEl(7) }];
        bottomSlots.forEach(s => {
          if (!s.el) return;
          const txt = (s.el.textContent || '').trim();
          if (txt === '1' || txt === '3') {
            // read current top percent, move it up by 2 percentage points if it's too low
            const curTopRaw = String(s.el.style.top || getComputedStyle(s.el).top || '');
            const curTop = parseFloat(curTopRaw.replace('%','')) || CANONICAL_POS[`n${s.slot}`].top;
            const minAllowedTop = CANONICAL_POS.n6.top + 2.0; // ensure above center row (n6) by +2%
            const newTop = Math.max( Math.min( curTop, 98 ), Math.min(curTop - 2.0, curTop) );
            // if current top would overlap the white cross line region (approx center ~50%), push upward to be safely above it
            const safeTop = Math.min(curTop, Math.max( curTop - 2.0, minAllowedTop ));
            s.el.style.setProperty('top', safeTop.toFixed(2) + '%', 'important');
            // apply an upward micro-raise via transform (stronger than others)
            // move DOWN by 1mm so digits sit away from the line ends
            s.el.style.setProperty('transform', 'translate(-50%,-50%) translateY(1mm)', 'important');
            // reduce pointer events if any
            s.el.style.setProperty('pointer-events','none','important');
            s.el.style.setProperty('user-select','none','important');
          }
        });
      } catch(e){ console.warn('bottom 1/3 safeguard failed', e); }

      // NEW: Shift '1' and '3' horizontally ~1mm away from the line to avoid touching it.
      try {
        const allNums = Array.from(root.querySelectorAll('.cross-numbers .num')).slice(0,8);
        allNums.forEach(el => {
          const t = (el.textContent || '').trim();
          if (t === '1' || t === '3') {
            const leftRaw = el.style.left || getComputedStyle(el).left || '';
            const leftPct = parseFloat(String(leftRaw).replace('%','')) || 50;
            const center = 50;
            const shiftPct = 1.0; // ≈1mm on ~100%->380px cross (~3.8px)
            let newLeft = leftPct;
            if (leftPct < center) newLeft = Math.max(2, leftPct - shiftPct);
            else if (leftPct > center) newLeft = Math.min(98, leftPct + shiftPct);
            else newLeft = leftPct - shiftPct; // if exactly center, nudge left
            el.style.setProperty('left', newLeft.toFixed(2) + '%', 'important');
            // small upward micro-adjust so digits don't overlap the cross stroke
            // move DOWN by 1mm to keep consistent offset from the cross line
            el.style.setProperty('transform', 'translate(-50%,-50%) translateY(1mm)', 'important');
          }
        });
      } catch(e){}

      // NEW: Nudge any digit '2' slightly upward by ~1mm so it doesn't touch the cross lines
      try {
        const allNums2 = Array.from(root.querySelectorAll('.cross-numbers .num')).slice(0,8);
        allNums2.forEach(el => {
          if (el.classList.contains('n2')) {
            // Keep the position-2 slot clear of the upper diagonal.
            const prevTransform = el.style.transform || getComputedStyle(el).transform || '';
            // ensure the base translate(-50%,-50%) is present then add the micro nudge
            // use an explicit override to avoid accumulating duplicates
            el.style.setProperty('transform', 'translate(-50%,-50%) translateY(calc(-10px * var(--cross-scale, 1)))', 'important');
            // make sure pointer-events remain disabled and persist style
            el.style.setProperty('pointer-events','none','important');
            el.style.setProperty('user-select','none','important');
          }
        });
      } catch(e){ console.warn('nudge for digit 2 failed', e); }
      
      // Persist final positions to localStorage under a deterministic key for this date
      try {
        const rcDate = document.getElementById('redCrossDate');
        const dateKey = rcDate && rcDate.textContent ? rcDate.textContent.replace(/\s+/g,'_').slice(0,30) : (new Date()).toISOString().slice(0,10);
        const numsEls = Array.from(root.querySelectorAll('.cross-numbers .num')).slice(0,8);
        const positions = numsEls.map(el => ({
          text: (el.textContent||'').trim(),
          left: parseFloat(String(el.style.left || getComputedStyle(el).left || '50%').replace('%','')) || 50,
          top: parseFloat(String(el.style.top || getComputedStyle(el).top || '50%').replace('%','')) || 50,
          fontSize: (el.style.fontSize || getComputedStyle(el).fontSize || null)
        }));
        window.cidProgrammeState = window.cidProgrammeState || { selectedDate: null, removedDigits: [], positions: Object.create(null), canonical: Object.create(null) };
        window.cidProgrammeState.positions[dateKey] = { positions, savedAt: new Date().toISOString() };
        window.cidProgrammeState.positions.latest = { positions, savedAt: new Date().toISOString(), date: dateKey };
      } catch(e){ console.warn('Failed to persist redCross positions', e); }

    } catch (err) {
      console.warn('enforceFixedPositionsAndRows failed', err);
    }
  })();

  // Remove any previously saved non-canonical positions to avoid accidental application of old edits.
  try { delete window.cidProgrammeState?.positions?.redCrossPositions; } catch(e){}

  // Ensure numbers are positioned by CSS only (if inline styles present, keep them but prevent runtime changes).
  Array.from(root.querySelectorAll('.cross-numbers .num')).forEach(el => {
    el.style.position = el.style.position || 'absolute';
  });
  // enforce a slightly larger minimum font-size for clarity
  Array.from(root.querySelectorAll('.cross-numbers .num')).forEach(el => {
    try {
      const cs = window.getComputedStyle(el);
      const currentFs = parseFloat(cs.fontSize || '0');
      if (currentFs && currentFs < 20) {
        el.style.setProperty('font-size', '20px', 'important');
      } else if (!currentFs) {
        el.style.setProperty('font-size', '20px', 'important');
      }
    } catch(_) {}
  });

  // No pointer/mouse/touch listeners attached — cross stays visually static.
})();
