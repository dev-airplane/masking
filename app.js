(() => {
  const state = {
    roster: [],
    givenNameOverrides: {},
    sourceText: '',
    detections: [],
    mapping: {},
    pendingSelection: null,
    pendingMarkId: null
  };

  const rosterInput = document.getElementById('rosterInput');
  const rosterBtn = document.getElementById('rosterBtn');
  const rosterChips = document.getElementById('rosterChips');
  const rosterFeedback = document.getElementById('rosterFeedback');
  const manualSurname = document.getElementById('manualSurname');
  const manualGivenName = document.getElementById('manualGivenName');
  const manualAddBtn = document.getElementById('manualAddBtn');

  const sourceInput = document.getElementById('sourceInput');
  const maskBtn = document.getElementById('maskBtn');

  const detectSection = document.getElementById('detectSection');
  const detectView = document.getElementById('detectView');
  const selectionMenu = document.getElementById('selectionMenu');
  const markMenu = document.getElementById('markMenu');
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
  const resetRosterBtn = document.getElementById('resetRosterBtn');
  const exampleRosterBtn = document.getElementById('exampleRosterBtn');
  const sourceSection = document.getElementById('sourceSection');
  const responseSection = document.getElementById('responseSection');
  const chatgptLinkRow = document.getElementById('chatgptLinkRow');

  const ROSTER_STORAGE_KEY = 'masking_roster';
  const GIVEN_NAME_OVERRIDES_KEY = 'masking_given_name_overrides';

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

  function saveGivenNameOverrides() {
    try {
      localStorage.setItem(GIVEN_NAME_OVERRIDES_KEY, JSON.stringify(state.givenNameOverrides));
    } catch (e) {
      /* localStorage 사용 불가 시 조용히 무시 */
    }
  }

  function loadGivenNameOverrides() {
    try {
      const raw = localStorage.getItem(GIVEN_NAME_OVERRIDES_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
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
    sourceSection.hidden = state.roster.length === 0;
  }

  state.roster = loadRoster();
  state.givenNameOverrides = loadGivenNameOverrides();
  renderRosterChips();

  function showRosterFeedback(message) {
    rosterFeedback.textContent = message;
    rosterFeedback.hidden = !message;
  }

  // 명렬표가 아니라 원문(문장)을 잘못 붙여넣은 것 같은지 대략 판별.
  // 줄당 평균 글자 수가 길면 표/목록이 아니라 문장일 가능성이 큼.
  function looksLikeProse(rawText) {
    const lines = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return false;
    return rawText.length / lines.length > 40;
  }

  rosterBtn.addEventListener('click', () => {
    const parsed = Masking.parseRoster(rosterInput.value);
    const newNames = parsed.filter((name) => !state.roster.includes(name));

    if (newNames.length === 0) {
      showRosterFeedback('이름을 찾지 못했습니다.');
      return;
    }

    if (looksLikeProse(rosterInput.value)) {
      const ok = window.confirm(`명렬표가 맞나요? ${newNames.length}명의 이름이 발견되었습니다.`);
      if (!ok) return;
    }

    newNames.forEach((name) => state.roster.push(name));
    rosterInput.value = '';
    showRosterFeedback('');
    renderRosterChips();
    saveRoster();
  });

  resetRosterBtn.addEventListener('click', () => {
    state.roster = [];
    state.givenNameOverrides = {};
    showRosterFeedback('');
    renderRosterChips();
    saveRoster();
    saveGivenNameOverrides();
  });

  manualAddBtn.addEventListener('click', () => {
    const surname = manualSurname.value.trim();
    const given = manualGivenName.value.trim();
    const full = `${surname}${given}`;
    if (!full) return;
    if (!state.roster.includes(full)) {
      state.roster.push(full);
      renderRosterChips();
      saveRoster();
    }
    // 성/이름을 따로 입력받았으니 추측하지 않고 그대로 "성 뗀 이름"으로 기억해둠.
    if (surname && given) {
      state.givenNameOverrides[full] = given;
      saveGivenNameOverrides();
    }
    manualSurname.value = '';
    manualGivenName.value = '';
  });

  exampleRosterBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(Masking.TEST_DATA.roster);
  });

  document.querySelectorAll('.example-source-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(Masking.TEST_DATA.sources[Number(btn.dataset.idx)]);
    });
  });

  document.getElementById('copyMaskedToResponseBtn').addEventListener('click', () => {
    responseInput.value = maskedOutput.value;
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

    if (d.type === 'name' && !d.confirmed) {
      state.pendingMarkId = d.id;
      const rect = mark.getBoundingClientRect();
      markMenu.style.left = `${rect.left}px`;
      markMenu.style.top = `${Math.max(rect.top - 44, 8)}px`;
      markMenu.hidden = false;
      return;
    }

    d.checked = !d.checked;
    renderDetectView();
  });

  markMenu.querySelector('[data-action="remove"]').addEventListener('click', () => {
    if (!state.pendingMarkId) return;
    state.detections = state.detections.filter((d) => d.id !== state.pendingMarkId);
    state.detections = Masking.assignTokens(state.detections);
    markMenu.hidden = true;
    state.pendingMarkId = null;
    renderDetectView();
  });

  markMenu.querySelector('[data-action="confirm"]').addEventListener('click', () => {
    if (!state.pendingMarkId) return;
    const target = state.detections.find((d) => d.id === state.pendingMarkId);
    if (target) {
      const trimmed = target.value.trim();
      state.detections.forEach((d) => {
        if (d.type === 'name' && d.value === trimmed && d.source === 'heuristic') {
          d.source = 'roster';
          d.canonical = trimmed;
        }
      });
      if (trimmed && !state.roster.includes(trimmed)) {
        state.roster.push(trimmed);
        renderRosterChips();
        saveRoster();
      }
      state.detections = Masking.assignTokens(state.detections);
    }
    markMenu.hidden = true;
    state.pendingMarkId = null;
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
    if (!markMenu.contains(e.target)) markMenu.hidden = true;
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

      if (type === 'name') {
        const trimmed = value.trim();
        // 같은 이름의 다른 자리(추정 이름)도 이제는 확인된 이름으로 승격
        state.detections.forEach((d) => {
          if (d.type === 'name' && d.value === trimmed && d.source === 'heuristic') {
            d.source = 'roster';
            d.canonical = trimmed;
          }
        });
        if (trimmed && !state.roster.includes(trimmed)) {
          state.roster.push(trimmed);
          renderRosterChips();
          saveRoster();
        }
      }

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
      matchGivenName: true,
      givenNameOverrides: state.givenNameOverrides
    });
    renderDetectView();
    detectSection.hidden = false;
    resultSection.hidden = true;
    responseSection.hidden = true;
    chatgptLinkRow.hidden = true;
  });

  confirmMaskBtn.addEventListener('click', () => {
    const { maskedText, mapping } = Masking.applyMask(state.sourceText, state.detections);
    state.mapping = mapping;
    maskedOutput.value = maskedText;
    resultSection.hidden = false;
    responseSection.hidden = false;
    chatgptLinkRow.hidden = false;
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
    state.givenNameOverrides = {};
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
    saveGivenNameOverrides();
    detectView.innerHTML = '';
    selectionMenu.hidden = true;
    detectSection.hidden = true;
    resultSection.hidden = true;
    responseSection.hidden = true;
    chatgptLinkRow.hidden = true;
    restoredSection.hidden = true;
    unresolvedWarning.hidden = true;
  });
})();
