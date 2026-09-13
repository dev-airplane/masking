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
  const manualSurname = document.getElementById('manualSurname');
  const manualGivenName = document.getElementById('manualGivenName');
  const manualAddBtn = document.getElementById('manualAddBtn');

  const sourceInput = document.getElementById('sourceInput');
  const maskBtn = document.getElementById('maskBtn');

  const editMode = document.getElementById('editMode');
  const reviewMode = document.getElementById('reviewMode');
  const editSourceBtn = document.getElementById('editSourceBtn');
  const detectView = document.getElementById('detectView');
  const guessNotice = document.getElementById('guessNotice');
  const selectionMenu = document.getElementById('selectionMenu');
  const markMenu = document.getElementById('markMenu');

  const resultSection = document.getElementById('resultSection');
  const maskedOutput = document.getElementById('maskedOutput');
  const mappingSection = document.getElementById('mappingSection');
  const mappingList = document.getElementById('mappingList');
  const copyMaskedBtn = document.getElementById('copyMaskedBtn');

  const responseInput = document.getElementById('responseInput');

  const restoredSection = document.getElementById('restoredSection');
  const restoredOutput = document.getElementById('restoredOutput');
  const copyRestoredBtn = document.getElementById('copyRestoredBtn');
  const unresolvedWarning = document.getElementById('unresolvedWarning');

  const resetBtn = document.getElementById('resetBtn');
  const resetRosterBtn = document.getElementById('resetRosterBtn');
  const exampleRosterBtn = document.getElementById('exampleRosterBtn');
  const sourceSection = document.getElementById('sourceSection');
  const responseSection = document.getElementById('responseSection');
  const rosterRequiredNotice = document.getElementById('rosterRequiredNotice');
  const maskRequiredNotice = document.getElementById('maskRequiredNotice');

  const ROSTER_STORAGE_KEY = 'masking_roster';
  const GIVEN_NAME_OVERRIDES_KEY = 'masking_given_name_overrides';

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => (p.hidden = true));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).hidden = false;
    });
  });

  const toast = document.getElementById('toast');
  let toastTimer = null;
  function showToast(message, isError = false) {
    toast.textContent = message;
    toast.classList.toggle('error', isError);
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        toast.hidden = true;
      }, 200);
    }, 1600);
  }
  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => showToast('복사되었습니다'));
  }

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
    rosterRequiredNotice.hidden = state.roster.length > 0;
  }

  state.roster = loadRoster();
  state.givenNameOverrides = loadGivenNameOverrides();
  renderRosterChips();

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

    if (parsed.length === 0) {
      showToast('이름을 찾지 못했습니다.', true);
      return;
    }

    if (newNames.length === 0) {
      showToast('새로운 이름을 찾지 못했습니다.', true);
      return;
    }

    if (looksLikeProse(rosterInput.value)) {
      const ok = window.confirm(`명렬표가 맞나요? ${newNames.length}명의 이름이 발견되었습니다.`);
      if (!ok) return;
    }

    newNames.forEach((name) => state.roster.push(name));
    rosterInput.value = '';
    renderRosterChips();
    saveRoster();
  });

  resetRosterBtn.addEventListener('click', () => {
    state.roster = [];
    state.givenNameOverrides = {};
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
    rosterInput.value = Masking.TEST_DATA.roster;
  });

  document.querySelectorAll('.example-source-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      sourceInput.value = Masking.TEST_DATA.sources[Number(btn.dataset.idx)];
      runDetectionAndReview();
    });
  });

  document.getElementById('copyMaskedToResponseBtn').addEventListener('click', () => {
    responseInput.value = maskedOutput.value;
    restoreLive();
  });

  function renderDetectView() {
    const text = state.sourceText;
    const dets = [...state.detections].sort((a, b) => a.start - b.start);
    let html = '';
    let pos = 0;
    for (const d of dets) {
      html += escapeHtml(text.slice(pos, d.start));
      const classes = ['hl', `type-${d.type}`];
      let title = '';
      if (d.type === 'name') {
        classes.push(d.confirmed ? 'src-confirmed' : 'src-guess');
        if (!d.confirmed) title = ' title="명렬표에는 없지만 이름으로 감지되었습니다. 클릭으로 마스킹할지 결정하세요."';
      }
      if (!d.checked) classes.push('off');
      html += `<mark class="${classes.join(' ')}" data-id="${d.id}"${title}>${escapeHtml(text.slice(d.start, d.end))}</mark>`;
      pos = d.end;
    }
    html += escapeHtml(text.slice(pos));
    detectView.innerHTML = html;
    guessNotice.hidden = !dets.some((d) => d.type === 'name' && !d.confirmed);
  }

  // 드래그/클릭으로 하이라이트를 등록·취소할 때마다 토큰 번호가 바뀔 수 있으므로
  // detections가 바뀔 때마다 마스킹 결과를 즉시 다시 계산해 항상 동기화된 상태로 유지한다.
  function refreshMaskedOutput() {
    const { maskedText, mapping } = Masking.applyMask(state.sourceText, state.detections);
    state.mapping = mapping;
    maskedOutput.value = maskedText;
    const mappingHtml = Object.entries(mapping)
      .map(([token, value]) => `<div class="mapping-row"><span class="mapping-token">${escapeHtml(token)}</span><span class="mapping-value">${escapeHtml(value)}</span></div>`)
      .join('');
    mappingList.innerHTML = mappingHtml;
    mappingSection.hidden = Object.keys(mapping).length === 0;
    resultSection.hidden = false;
    responseSection.hidden = false;
    maskRequiredNotice.hidden = true;
    if (responseInput.value) restoreLive();
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
    refreshMaskedOutput();
  });

  markMenu.querySelector('[data-action="remove"]').addEventListener('click', () => {
    if (!state.pendingMarkId) return;
    state.detections = state.detections.filter((d) => d.id !== state.pendingMarkId);
    state.detections = Masking.assignTokens(state.detections);
    markMenu.hidden = true;
    state.pendingMarkId = null;
    renderDetectView();
    refreshMaskedOutput();
  });

  markMenu.querySelector('[data-action="confirm"]').addEventListener('click', () => {
    if (!state.pendingMarkId) return;
    const target = state.detections.find((d) => d.id === state.pendingMarkId);
    if (target) {
      const identity = target.canonical || target.value.trim();
      state.detections.forEach((d) => {
        if (d.type === 'name' && !d.confirmed && (d.canonical || d.value) === identity) {
          d.source = 'roster';
          d.canonical = identity;
          d.checked = true;
        }
      });
      if (!target.canonical && identity && !state.roster.includes(identity)) {
        state.roster.push(identity);
        renderRosterChips();
        saveRoster();
      }
      state.detections = Masking.assignTokens(state.detections);
    }
    markMenu.hidden = true;
    state.pendingMarkId = null;
    renderDetectView();
    refreshMaskedOutput();
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
      refreshMaskedOutput();
    });
  });

  function runDetectionAndReview() {
    state.sourceText = sourceInput.value;
    state.detections = Masking.detectAll(state.sourceText, state.roster, {
      matchGivenName: true,
      givenNameOverrides: state.givenNameOverrides
    });
    renderDetectView();
    editMode.hidden = true;
    reviewMode.hidden = false;
    refreshMaskedOutput();
  }

  maskBtn.addEventListener('click', runDetectionAndReview);

  // 붙여넣기 한 번에 바로 탐지결과로 전환. 타이핑 중 계속 재탐지되지 않도록
  // paste 이벤트에만 반응하고(입력마다 X), 붙여넣은 내용이 실제로 반영된
  // 뒤 읽도록 다음 틱으로 미룬다.
  sourceInput.addEventListener('paste', () => {
    setTimeout(runDetectionAndReview, 0);
  });

  editSourceBtn.addEventListener('click', () => {
    reviewMode.hidden = true;
    editMode.hidden = false;
  });

  copyMaskedBtn.addEventListener('click', () => {
    copyToClipboard(maskedOutput.value);
  });

  function restoreLive() {
    if (!responseInput.value) {
      restoredOutput.value = '';
      unresolvedWarning.hidden = true;
      return;
    }
    const { restoredText, unresolved } = Masking.restoreText(responseInput.value, state.mapping);
    restoredOutput.value = restoredText;
    restoredSection.hidden = false;
    if (unresolved.length > 0) {
      unresolvedWarning.hidden = false;
      unresolvedWarning.textContent = `복원되지 않음: ${unresolved.join(', ')}`;
    } else {
      unresolvedWarning.hidden = true;
    }
  }

  responseInput.addEventListener('input', restoreLive);

  copyRestoredBtn.addEventListener('click', () => {
    copyToClipboard(restoredOutput.value);
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
    reviewMode.hidden = true;
    editMode.hidden = false;
    resultSection.hidden = true;
    mappingSection.hidden = true;
    responseSection.hidden = true;
    maskRequiredNotice.hidden = false;
    restoredSection.hidden = false;
    unresolvedWarning.hidden = true;
  });
})();
