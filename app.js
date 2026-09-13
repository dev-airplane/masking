(() => {
  const state = {
    roster: [],
    sourceText: '',
    detections: [],
    mapping: {},
    pendingSelection: null
  };

  const rosterInput = document.getElementById('rosterInput');
  const rosterBtn = document.getElementById('rosterBtn');
  const rosterChips = document.getElementById('rosterChips');
  const matchGivenName = document.getElementById('matchGivenName');

  const sourceInput = document.getElementById('sourceInput');
  const maskBtn = document.getElementById('maskBtn');

  const detectSection = document.getElementById('detectSection');
  const detectView = document.getElementById('detectView');
  const selectionMenu = document.getElementById('selectionMenu');
  const confirmMaskBtn = document.getElementById('confirmMaskBtn');

  const resultSection = document.getElementById('resultSection');
  const maskedOutput = document.getElementById('maskedOutput');
  const copyMaskedBtn = document.getElementById('copyMaskedBtn');

  const responseInput = document.getElementById('responseInput');
  const restoreBtn = document.getElementById('restoreBtn');

  const restoredSection = document.getElementById('restoredSection');
  const restoredOutput = document.getElementById('restoredOutput');
  const copyRestoredBtn = document.getElementById('copyRestoredBtn');
  const unresolvedWarning = document.getElementById('unresolvedWarning');

  const resetBtn = document.getElementById('resetBtn');
  const exampleRosterBtn = document.getElementById('exampleRosterBtn');

  const ROSTER_STORAGE_KEY = 'masking_roster';

  function escapeHtml(str) {
    return str.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  function saveRoster() {
    try {
      localStorage.setItem(ROSTER_STORAGE_KEY, JSON.stringify(state.roster));
    } catch (e) {
      /* localStorage 사용 불가 시 조용히 무시 */
    }
  }

  function loadRoster() {
    try {
      const raw = localStorage.getItem(ROSTER_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function renderRosterChips() {
    rosterChips.innerHTML = '';
    state.roster.forEach((name) => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      const label = document.createElement('span');
      label.textContent = name;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        state.roster = state.roster.filter((n) => n !== name);
        renderRosterChips();
        saveRoster();
      });
      chip.appendChild(label);
      chip.appendChild(removeBtn);
      rosterChips.appendChild(chip);
    });
  }

  state.roster = loadRoster();
  renderRosterChips();

  rosterBtn.addEventListener('click', () => {
    Masking.parseRoster(rosterInput.value).forEach((name) => {
      if (!state.roster.includes(name)) state.roster.push(name);
    });
    rosterInput.value = '';
    renderRosterChips();
    saveRoster();
  });

  exampleRosterBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(Masking.TEST_DATA.roster);
  });

  document.querySelectorAll('.example-source-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(Masking.TEST_DATA.sources[Number(btn.dataset.idx)]);
    });
  });

  function renderDetectView() {
    const text = state.sourceText;
    const dets = [...state.detections].sort((a, b) => a.start - b.start);
    let html = '';
    let pos = 0;
    for (const d of dets) {
      html += escapeHtml(text.slice(pos, d.start));
      const classes = ['hl', `type-${d.type}`];
      if (d.type === 'name') classes.push(d.confirmed ? 'src-confirmed' : 'src-guess');
      if (!d.checked) classes.push('off');
      html += `<mark class="${classes.join(' ')}" data-id="${d.id}">${escapeHtml(text.slice(d.start, d.end))}</mark>`;
      pos = d.end;
    }
    html += escapeHtml(text.slice(pos));
    detectView.innerHTML = html;
  }

  detectView.addEventListener('click', (e) => {
    const mark = e.target.closest('mark.hl');
    if (!mark) return;
    const d = state.detections.find((x) => x.id === mark.dataset.id);
    if (!d) return;
    d.checked = !d.checked;
    renderDetectView();
  });

  function getTextOffset(container, node, offset) {
    const range = document.createRange();
    range.selectNodeContents(container);
    range.setEnd(node, offset);
    return range.toString().length;
  }

  detectView.addEventListener('mouseup', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!detectView.contains(range.commonAncestorContainer)) return;

    const start = getTextOffset(detectView, range.startContainer, range.startOffset);
    const end = getTextOffset(detectView, range.endContainer, range.endOffset);
    if (end <= start) return;

    state.pendingSelection = { start, end };
    const rect = range.getBoundingClientRect();
    selectionMenu.style.left = `${rect.left}px`;
    selectionMenu.style.top = `${Math.max(rect.top - 44, 8)}px`;
    selectionMenu.hidden = false;
  });

  document.addEventListener('mousedown', (e) => {
    if (!selectionMenu.contains(e.target)) selectionMenu.hidden = true;
  });

  selectionMenu.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!state.pendingSelection) return;
      const { start, end } = state.pendingSelection;
      const type = btn.dataset.type;
      const value = state.sourceText.slice(start, end);

      state.detections = state.detections.filter((d) => !Masking.overlaps(d, { start, end }));
      state.detections.push({
        type,
        value,
        canonical: type === 'name' ? value : undefined,
        start,
        end,
        source: 'manual',
        checked: true
      });
      state.detections = Masking.assignTokens(state.detections);

      window.getSelection().removeAllRanges();
      selectionMenu.hidden = true;
      state.pendingSelection = null;
      renderDetectView();
    });
  });

  maskBtn.addEventListener('click', () => {
    state.sourceText = sourceInput.value;
    state.detections = Masking.detectAll(state.sourceText, state.roster, {
      matchGivenName: matchGivenName.checked
    });
    renderDetectView();
    detectSection.hidden = false;
    resultSection.hidden = true;
  });

  confirmMaskBtn.addEventListener('click', () => {
    const { maskedText, mapping } = Masking.applyMask(state.sourceText, state.detections);
    state.mapping = mapping;
    maskedOutput.value = maskedText;
    resultSection.hidden = false;
  });

  copyMaskedBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(maskedOutput.value);
  });

  restoreBtn.addEventListener('click', () => {
    const { restoredText, unresolved } = Masking.restoreText(responseInput.value, state.mapping);
    restoredOutput.value = restoredText;
    restoredSection.hidden = false;
    if (unresolved.length > 0) {
      unresolvedWarning.hidden = false;
      unresolvedWarning.textContent = `복원되지 않음: ${unresolved.join(', ')}`;
    } else {
      unresolvedWarning.hidden = true;
    }
  });

  copyRestoredBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(restoredOutput.value);
  });

  resetBtn.addEventListener('click', () => {
    state.roster = [];
    state.sourceText = '';
    state.detections = [];
    state.mapping = {};
    state.pendingSelection = null;
    rosterInput.value = '';
    sourceInput.value = '';
    responseInput.value = '';
    maskedOutput.value = '';
    restoredOutput.value = '';
    renderRosterChips();
    saveRoster();
    detectView.innerHTML = '';
    selectionMenu.hidden = true;
    detectSection.hidden = true;
    resultSection.hidden = true;
    restoredSection.hidden = true;
    unresolvedWarning.hidden = true;
  });
})();
