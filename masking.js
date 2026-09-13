const Masking = (() => {
  const SURNAMES = [
    '남궁', '황보', '제갈', '선우', '서문', '독고',
    '김', '이', '박', '최', '정', '강', '조', '윤', '장', '임',
    '한', '오', '서', '신', '권', '황', '안', '송', '류', '전',
    '홍', '고', '문', '양', '손', '배', '백', '허', '유', '남',
    '심', '노', '하', '곽', '성', '차', '주', '우', '구', '민',
    '진', '지', '엄', '채', '원', '천', '방', '공', '현', '함'
  ].sort((a, b) => b.length - a.length);

  const HONORIFIC_LOOKAHEAD = '(?=님|씨|군|양|께|에게|\\s?[가-힣]{0,3}(?:학생(?!회|들|증|부)|선생님|교수님|원장님|교사))';
  const NAME_HEURISTIC_RE = new RegExp(`(${SURNAMES.join('|')})[가-힣]{1,2}${HONORIFIC_LOOKAHEAD}`, 'g');
  // "담임 박지훈"/"담임교사 박지훈"/"교사 김소연"/"작성자: 박지훈"/"이름: 박지훈"처럼 이름 앞에 직함·라벨이 오는 경우
  const TITLE_PREFIX_RE = new RegExp(
    `(?<=담임교사\\s?|담임\\s?|교사\\s?|(?:작성자|이름)\\s?:\\s?)(${SURNAMES.join('|')})[가-힣]{1,2}`,
    'g'
  );
  const PHONE_RE = /\b(01[016789]|02|0[3-6][1-5])[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g;
  const ORG_RE = /[가-힣A-Za-z0-9]{2,20}(초등학교|중학교|고등학교|유치원|대학교|대학|학원|병원|주식회사|㈜|재단|협회|연구소|센터)/g;
  // 숫자 학년·반 ("1학년 3반")과 한글 이름 반 ("해바라기반") 둘 다 잡되, 소속(학교명)과는 별도 카테고리로 취급
  const CLASS_NUMERIC_RE = /\d+\s?학년\s?\d+\s?반/g;
  const CLASS_NAMED_RE = /(?<![가-힣])[가-힣]{1,4}반(?![가-힣])/g;
  const CLASS_NAMED_STOPWORDS = new Set(['일반', '후반', '전반', '초반', '중반']);

  const TOKEN_PREFIX = { name: 'NAME', phone: 'PHONE', org: 'ORG', class: 'CLASS' };
  const CONFIRMED_SOURCES = new Set(['roster', 'roster-given', 'manual']);
  const TOKEN_OPEN = '〔';
  const TOKEN_CLOSE = '〕';

  const ROSTER_STOPWORDS = new Set([
    '번호', '이름', '성명', '학생명', '연락처', '전화', '전화번호', '휴대폰',
    '주소', '소속', '학교', '학년', '학번', '담임', '반명', '보호자',
    '이메일', '메일', '비고', '성별', '나이', '생년월일'
  ]);

  function parseRoster(rawText) {
    if (!rawText) return [];
    const names = new Set();
    const lines = rawText.split(/\r?\n/);
    for (const line of lines) {
      const tokens = line.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
      for (const tok of tokens) {
        if (/^[가-힣]{2,4}$/.test(tok) && !ROSTER_STOPWORDS.has(tok)) names.add(tok);
      }
    }
    return Array.from(names);
  }

  function findAllOccurrences(text, value) {
    const result = [];
    let idx = 0;
    while (true) {
      const found = text.indexOf(value, idx);
      if (found === -1) break;
      result.push({ start: found, end: found + value.length });
      idx = found + value.length;
    }
    return result;
  }

  function overlaps(a, b) {
    return a.start < b.end && b.start < a.end;
  }

  // 성 없이 "단독으로" 쓰인 경우만 잡음. 앞에 다른 한글 음절이 바로 붙어있으면
  // (예: 등록되지 않은 "박지훙" 안의 "지훙") 남의 이름 일부를 잘못 물어오는 것이므로 제외.
  function findStandaloneOccurrences(text, value) {
    const result = [];
    let idx = 0;
    while (true) {
      const found = text.indexOf(value, idx);
      if (found === -1) break;
      const before = found > 0 ? text[found - 1] : '';
      if (!/[가-힣]/.test(before)) {
        result.push({ start: found, end: found + value.length });
      }
      idx = found + value.length;
    }
    return result;
  }

  function hasBatchim(char) {
    const code = char.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) return false;
    return code % 28 !== 0;
  }

  // "하늘" 같이 받침 있는 이름은 실제 명사(하늘=sky)와 겹칠 수 있지만 이건 추후 과제로 미룸.
  // 일단은 받침 있는 이름 뒤에 접미 '이' 또는 호격 '아/야'가 바로 붙으면 이름으로 보고 마스킹함.
  function findStandaloneGivenNameOccurrences(text, given) {
    const occurrences = findStandaloneOccurrences(text, given);
    if (!hasBatchim(given[given.length - 1])) return occurrences;
    return occurrences.filter((occ) => /^[이아야]/.test(text[occ.end] || ''));
  }

  function getGivenName(fullName) {
    const compound = SURNAMES.find((s) => s.length === 2 && fullName.startsWith(s));
    const surnameLen = compound ? 2 : 1;
    const given = fullName.slice(surnameLen);
    return given.length >= 1 ? given : null;
  }

  function detectAll(text, roster = [], options = {}) {
    const detections = [];

    for (const name of roster) {
      for (const occ of findAllOccurrences(text, name)) {
        detections.push({ type: 'name', value: name, canonical: name, start: occ.start, end: occ.end, source: 'roster' });
      }
    }

    if (options.matchGivenName) {
      const overrides = options.givenNameOverrides || {};
      for (const name of roster) {
        const given = overrides[name] || getGivenName(name);
        if (!given) continue;
        for (const occ of findStandaloneGivenNameOccurrences(text, given)) {
          if (!detections.some((d) => d.type === 'name' && overlaps(d, occ))) {
            detections.push({ type: 'name', value: given, canonical: name, start: occ.start, end: occ.end, source: 'roster-given' });
          }
        }
      }
    }

    let match;
    NAME_HEURISTIC_RE.lastIndex = 0;
    while ((match = NAME_HEURISTIC_RE.exec(text)) !== null) {
      // 사람 이름은 앞에 다른 한글 음절 없이 시작하는 경우가 대부분.
      // 경계 없이 허용하면 "생활안전부" 같은 일반 단어 중간이 이름으로 오탐될 수 있음.
      const before = match.index > 0 ? text[match.index - 1] : '';
      if (!/[가-힣]/.test(before)) {
        const cand = { type: 'name', value: match[0], start: match.index, end: match.index + match[0].length, source: 'heuristic' };
        if (!detections.some((d) => d.type === 'name' && overlaps(d, cand))) {
          detections.push(cand);
        }
      }
    }

    TITLE_PREFIX_RE.lastIndex = 0;
    while ((match = TITLE_PREFIX_RE.exec(text)) !== null) {
      const cand = { type: 'name', value: match[0], start: match.index, end: match.index + match[0].length, source: 'heuristic' };
      if (!detections.some((d) => d.type === 'name' && overlaps(d, cand))) {
        detections.push(cand);
      }
    }

    PHONE_RE.lastIndex = 0;
    while ((match = PHONE_RE.exec(text)) !== null) {
      detections.push({ type: 'phone', value: match[0], start: match.index, end: match.index + match[0].length, source: 'regex' });
    }

    ORG_RE.lastIndex = 0;
    while ((match = ORG_RE.exec(text)) !== null) {
      detections.push({ type: 'org', value: match[0], start: match.index, end: match.index + match[0].length, source: 'regex' });
    }

    CLASS_NUMERIC_RE.lastIndex = 0;
    while ((match = CLASS_NUMERIC_RE.exec(text)) !== null) {
      const cand = { type: 'class', value: match[0], start: match.index, end: match.index + match[0].length, source: 'regex' };
      if (!detections.some((d) => d.type === 'class' && overlaps(d, cand))) {
        detections.push(cand);
      }
    }

    CLASS_NAMED_RE.lastIndex = 0;
    while ((match = CLASS_NAMED_RE.exec(text)) !== null) {
      if (CLASS_NAMED_STOPWORDS.has(match[0])) continue;
      const cand = { type: 'class', value: match[0], start: match.index, end: match.index + match[0].length, source: 'regex' };
      if (!detections.some((d) => d.type === 'class' && overlaps(d, cand))) {
        detections.push(cand);
      }
    }

    return assignTokens(detections);
  }

  function assignTokens(detections) {
    detections.sort((a, b) => a.start - b.start);

    // 같은 사람(canonical)은 같은 번호를 공유하되, 성 포함/제외 형태는 서로 다른
    // 토큰으로 분리해야 복원 시 어느 자리가 어떤 표기였는지 정확히 되돌릴 수 있음.
    const nameNumbers = new Map();
    const otherTokens = new Map();
    const counters = { name: 0, phone: 0, org: 0, class: 0 };
    for (const d of detections) {
      if (d.type === 'name') {
        const identityKey = d.canonical || d.value;
        if (!nameNumbers.has(identityKey)) {
          counters.name += 1;
          nameNumbers.set(identityKey, counters.name);
        }
        const base = `${TOKEN_PREFIX.name}_${nameNumbers.get(identityKey)}`;
        d.token = d.source === 'roster-given'
          ? `${TOKEN_OPEN}${base}_이름${TOKEN_CLOSE}`
          : `${TOKEN_OPEN}${base}${TOKEN_CLOSE}`;
      } else {
        const key = `${d.type}:${d.value}`;
        if (!otherTokens.has(key)) {
          counters[d.type] += 1;
          otherTokens.set(key, `${TOKEN_OPEN}${TOKEN_PREFIX[d.type]}_${counters[d.type]}${TOKEN_CLOSE}`);
        }
        d.token = otherTokens.get(key);
      }
      d.id = `${d.type}-${d.start}-${d.end}`;
      if (d.checked === undefined) d.checked = true;
      d.confirmed = CONFIRMED_SOURCES.has(d.source);
    }

    return detections;
  }

  function applyMask(text, detections) {
    const checked = detections.filter((d) => d.checked).sort((a, b) => b.start - a.start);
    let result = text;
    const mapping = {};
    for (const d of checked) {
      result = result.slice(0, d.start) + d.token + result.slice(d.end);
      mapping[d.token] = d.value;
    }
    return { maskedText: result, mapping };
  }

  function restoreText(text, mapping) {
    let result = text;
    const unresolved = [];
    for (const [token, value] of Object.entries(mapping)) {
      if (result.includes(token)) {
        result = result.split(token).join(value);
      } else {
        unresolved.push(token);
      }
    }
    return { restoredText: result, unresolved };
  }

  const TEST_DATA = {
    roster: `번호,이름
1	김하늘
2   이도윤	010-1234-5678
3,박서연

4  최민준   남
5	정유진
6 강현우
7   윤지아
8	조우진	010-9999-0000
9  한예린
10	오지훈
11 서다은
12  임건우
13	신채원
14 문태오
15  배수아
16	권시우
17 송아린
18  황준서
19	노은재
20 장나윤
21  류지호
22	백소율`,
    sources: [
      '안녕하세요, 한빛중학교 1학년 3반 박지훈 담임교사입니다. 민준이가 오늘 수업 태도에서 많이 발전했습니다. 질문에 차분히 답하고 모둠 활동에도 적극적으로 참여해 칭찬해 주었습니다. 가정에서도 격려 부탁드립니다.\n\n안녕하세요. 한빛중학교 1학년 3반 담임 박지훈입니다. 하늘이가 이번 주 금요일까지 제출해야 하는 과학 탐구 보고서를 아직 제출하지 않았습니다. 작성 중 어려움이 있으면 학교에 알려 주시고, 가정에서도 제출 일정을 확인해 주시면 감사하겠습니다.\n\n안녕하세요, 한빛중학교 학생생활안전부 이민석 교사입니다. 우진이와 관련하여 짧은 상담을 진행하고자 합니다. 9월 17일(목) 16시 이후 통화 가능하신 시간을 회신 부탁드립니다. 문의: 010-5831-7462',
      '한빛중학교 학생회가 준비한 가을 별빛축제를 아래와 같이 개최합니다. 학부모님과 재학생 여러분의 많은 참여를 바랍니다.\n\n일시: 2026년 10월 16일(금) 16:00~19:30 / 장소: 한빛중학교 운동장 및 별관 체육관 / 주관: 학생자치회, 담당 교사 김소연(학생생활부)\n\n체험 부스 참여를 희망하는 학생은 9월 25일까지 담임교사에게 신청서를 제출해 주세요. 1학년 3반 부스 문의는 박지훈 담임교사(교내 213, 010-2748-6193)에게 연락 바랍니다. 행사 운영 문의는 학생회 담당 김소연 교사(010-5831-7462)에게 문의해 주세요.',
      '작성자: 박지훈(한빛중학교 1학년 3반 담임)\n\n김하늘: 학급회의에서 친구들의 의견을 차분히 정리하고, 맡은 역할을 기한 내에 완수하는 책임감을 보임. 보호자 상담 기록: 2026.10.08. 김하늘 학생의 보호자(010-9274-5308)와 전화 상담. 최근 독서 활동과 발표 참여가 늘었다고 안내함.\n\n정유진: 미술 및 국어 활동에서 표현력이 풍부하며, 학급 게시판 꾸미기 활동을 주도함. 2026.11.18. 방과후 수업 변경 관련하여 보호자(010-4527-6813)와 통화함.',
      '작성자: 이민석(한빛중학교 학생생활안전부 교사) / 관련 학생: 최민준(1학년 3반, 이하 \'민준이\'), 조우진(1학년 3반)\n\n점심시간 후 민준이와 조우진 학생이 복도에서 서로의 체육복 가방을 두고 말다툼을 벌였음. 민준이가 조우진 학생의 가방을 밀치는 과정에서 물통이 바닥에 떨어졌음.\n\n담임 박지훈 교사가 두 학생과 각각 상담한 뒤 공동 사과 시간을 마련함. 민준이 보호자(010-6391-2750)에게 16:10에, 조우진 학생 보호자(010-3648-7059)에게 16:18에 사안과 지도 내용을 안내함.'
    ]
  };

  return { parseRoster, detectAll, assignTokens, applyMask, restoreText, overlaps, TEST_DATA };
})();
