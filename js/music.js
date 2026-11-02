// 공통 음악 규칙: 모든 스크립트가 window.Music 을 함께 쓴다 (file:// 에서도 돌도록 모듈 대신 전역)
window.Music = (() => {
  const NM = 16;                 // 곡 길이(마디)
  const LINES = 4;               // 한 줄에 4마디씩 4줄
  const BEATS = 4;               // 기본 박자(4/4). 작품마다 work.meter 로 2·3·4 중 고른다
  const METERS = [2, 3, 4];
  const MIN_MIDI = 55, MAX_MIDI = 81;   // 낮은 솔(G3) ~ 높은 라(A5)
  const DURS = [0.5, 1, 1.5, 2, 3, 4];
  // 활동지의 꼭 넣을 리듬(4/4 4마디)을 고른 박자에 맞게 옮긴 것
  //  2/4: 같은 리듬을 반으로 나눠 8마디 / 3/4: 마디마다 한 박씩 줄여 4마디
  const REQS = {
    4: [[1, 1, 1, 1], [1, 1, 2], [1, 1, 0.5, 0.5, 1], [1, 1, 2]],
    3: [[1, 1, 1], [1, 2], [1, 0.5, 0.5, 1], [1, 2]],
    2: [[1, 1], [1, 1], [1, 1], [2], [1, 1], [0.5, 0.5, 1], [1, 1], [2]],
  };
  const REQ = REQS[4];
  const meterOf = w => (w && METERS.includes(w.meter) ? w.meter : BEATS);
  const reqFor = meter => REQS[meter] || REQS[BEATS];
  const dursFor = meter => DURS.filter(d => d <= meter);

  // 조성: doPc = 계이름 '도'의 음, tonicPc = 으뜸음, acc = 검은 음판 표기(#/b), sig = 조표 글자
  const KEYS = {
    C:  { id: 'C',  name: '다장조', mode: 'major', doPc: 0, tonicPc: 0, acc: '#', sig: [] },
    G:  { id: 'G',  name: '사장조', mode: 'major', doPc: 7, tonicPc: 7, acc: '#', sig: ['F'] },
    F:  { id: 'F',  name: '바장조', mode: 'major', doPc: 5, tonicPc: 5, acc: 'b', sig: ['B'] },
    Am: { id: 'Am', name: '가단조', mode: 'minor', doPc: 0, tonicPc: 9, acc: '#', sig: [] },
    Em: { id: 'Em', name: '마단조', mode: 'minor', doPc: 7, tonicPc: 4, acc: '#', sig: ['F'] },
    Dm: { id: 'Dm', name: '라단조', mode: 'minor', doPc: 5, tonicPc: 2, acc: 'b', sig: ['B'] },
  };
  const KEY_ORDER = ['C', 'G', 'F', 'Am', 'Em', 'Dm'];

  // 악기: gm = 사운드폰트 폴더 이름, shift = 실제로 소리 나는 높이(반음), kind = 소리 성격, input = 연주 화면
  const INSTRUMENTS = [
    { id: 'xylophone',  name: '실로폰',     emoji: '🎼', gm: 'xylophone',             shift: 12,  kind: 'mallet',  input: 'bars' },
    { id: 'glock',      name: '철금',       emoji: '🔔', gm: 'glockenspiel',          shift: 12,  kind: 'mallet',  input: 'bars' },
    { id: 'piano',      name: '피아노',     emoji: '🎹', gm: 'acoustic_grand_piano',  shift: 0,   kind: 'piano',   input: 'keys' },
    { id: 'violin',     name: '바이올린',   emoji: '🎻', gm: 'violin',                shift: 0,   kind: 'sustain', input: 'keys' },
    { id: 'viola',      name: '비올라',     emoji: '🎻', gm: 'viola',                 shift: 0,   kind: 'sustain', input: 'keys' },
    { id: 'cello',      name: '첼로',       emoji: '🎻', gm: 'cello',                 shift: -12, kind: 'sustain', input: 'keys' },
    { id: 'contrabass', name: '콘트라베이스', emoji: '🎻', gm: 'contrabass',          shift: -24, kind: 'sustain', input: 'keys' },
    { id: 'flute',      name: '플루트',     emoji: '🪈', gm: 'flute',                 shift: 12,  kind: 'sustain', input: 'keys' },
    { id: 'oboe',       name: '오보에',     emoji: '🎷', gm: 'oboe',                  shift: 0,   kind: 'sustain', input: 'keys' },
    { id: 'clarinet',   name: '클라리넷',   emoji: '🎷', gm: 'clarinet',              shift: 0,   kind: 'sustain', input: 'keys' },
    { id: 'recorder',   name: '리코더',     emoji: '🪈', gm: 'recorder',              shift: 12,  kind: 'sustain', input: 'keys' },
    { id: 'trumpet',    name: '트럼펫',     emoji: '🎺', gm: 'trumpet',               shift: 0,   kind: 'sustain', input: 'keys' },
    { id: 'guitar',     name: '기타',       emoji: '🎸', gm: 'acoustic_guitar_nylon', shift: -12, kind: 'pluck',   input: 'keys' },
    { id: 'harp',       name: '하프',       emoji: '🪕', gm: 'orchestral_harp',       shift: 0,   kind: 'pluck',   input: 'keys' },
  ];
  const instById = id => INSTRUMENTS.find(i => i.id === id) || INSTRUMENTS[0];

  const SOLFA = ['도', '도♯', '레', '레♯', '미', '파', '파♯', '솔', '솔♯', '라', '라♯', '시'];
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const NAT_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  // 악기 음판 색(절대음 기준): 도 빨강 … 시 보라
  const COLOR_BY_PC = { 0: '#ff6b6b', 2: '#ffa94d', 4: '#ffd43b', 5: '#69db7c', 7: '#4dabf7', 9: '#4263eb', 11: '#9775fa' };
  const SHARP_COLOR = '#5c7cfa';

  const pc = m => ((m % 12) + 12) % 12;
  const key = id => KEYS[id] || KEYS.C;
  const degree = (midi, k) => (pc(midi) - key(k).doPc + 12) % 12;
  // 한국 학교 계이름(이동도법): 조가 바뀌면 '도'의 자리도 바뀐다
  const solfa = (midi, k) => SOLFA[degree(midi, k)];
  // 장조는 도레미파솔라시, 단조(라로 시작)는 같은 음 + 이끈음 솔♯
  const SCALE = new Set([0, 2, 4, 5, 7, 9, 11]);
  const inScale = (midi, k) => { const d = degree(midi, k); return SCALE.has(d) || (key(k).mode === 'minor' && d === 8); };
  const isTonic = (midi, k) => pc(midi) === key(k).tonicPc;
  const tonicSolfa = k => (key(k).mode === 'major' ? '도' : '라');

  // 악보 표기: 음이름 글자와 올림/내림. 검은 음판은 조의 acc(#/b)를 따라 읽는다
  function spell(midi, k) {
    const p = pc(midi), oct = Math.floor(midi / 12) - 1;
    const nat = LETTERS.find(L => NAT_PC[L] === p);
    if (nat) return { letter: nat, acc: '', octave: oct };
    if (key(k).acc === 'b') {
      const L = LETTERS.find(L => NAT_PC[L] === p + 1);
      return { letter: L, acc: 'b', octave: oct };
    }
    const L = LETTERS.find(L => NAT_PC[L] === p - 1);
    return { letter: L, acc: '#', octave: oct };
  }
  const sigAcc = (letter, k) => (key(k).sig.includes(letter) ? key(k).acc : '');
  // 실제 악보에 붙일 임시표 기호 ('' 이면 안 붙임)
  function displayAcc(midi, k) {
    const s = spell(midi, k), want = s.acc, has = sigAcc(s.letter, k);
    if (want === has) return '';
    if (want === '#') return '♯';
    if (want === 'b') return '♭';
    return '♮';
  }
  // 오선 위치(낮을수록 작다): 옥타브*7 + 글자 순서
  const staffStep = (midi, k) => { const s = spell(midi, k); return s.octave * 7 + LETTERS.indexOf(s.letter); };

  const beats = meas => meas.reduce((a, n) => a + n.d, 0);
  const sameRhythm = (meas, r) => meas.length === r.length && meas.every((n, i) => !n.r && n.d === r[i]);
  // 꼭 넣을 리듬이 시작하는 마디 번호(0부터), 없으면 -1
  function findReq(ms, meter = BEATS) {
    const req = reqFor(meter);
    for (let i = 0; i + req.length <= ms.length; i++) {
      if (req.every((r, j) => sameRhythm(ms[i + j], r))) return i;
    }
    return -1;
  }

  function newWork(meter = BEATS) {
    const ms = Array.from({ length: NM }, () => []);
    reqFor(meter).forEach((r, j) => { ms[j] = r.map(d => ({ d, p: null })); });
    return { v: 4, title: '', num: '', name: '', intent: '', bpm: 90, meter, key: 'C', inst: 'xylophone', ms };
  }
  const clampBpm = v => Math.max(40, Math.min(200, Math.round(+v) || 90));
  // 저장된 값이나 불러온 파일을 안전한 모양으로 다듬는다
  function normWork(o) {
    if (!o || !Array.isArray(o.ms) || o.ms.length !== NM) return null;
    const meter = meterOf(o);
    const ms = o.ms.map(meas => {
      const out = []; let b = 0;
      (Array.isArray(meas) ? meas : []).forEach(n => {
        if (!n || !DURS.includes(n.d) || b + n.d > meter) return;
        const okMidi = v => Number.isInteger(v) && v >= MIN_MIDI && v <= MAX_MIDI;
        if (n.r) out.push({ d: n.d, r: 1 });
        else {
          const p = okMidi(n.p) ? n.p : null;
          const note = { d: n.d, p };
          // 화음 음: 주음과 다른 음만, 최대 3개
          const c = p == null || !Array.isArray(n.c) ? [] : [...new Set(n.c.filter(v => okMidi(v) && v !== p))].slice(0, 3);
          if (c.length) note.c = c;
          out.push(note);
        }
        b += n.d;
      });
      return out;
    });
    return {
      v: 4,
      meter,
      title: String(o.title || '').slice(0, 40),
      num: String(o.num || '').slice(0, 12),
      name: String(o.name || '').slice(0, 12),
      intent: String(o.intent || '').slice(0, 500),
      bpm: clampBpm(o.bpm),
      key: KEYS[o.key] ? o.key : 'C',
      inst: instById(o.inst).id,
      ms,
    };
  }

  // 재생용 시간표: beat = 시작 마디(from)부터 센 박, p = 소리 낼 음(쉼표·빈 음은 null)
  function timeline(work, from = 0, to = NM) {
    const out = [], meter = meterOf(work);
    for (let m = from; m < to; m++) {
      let off = 0;
      work.ms[m].forEach((n, k) => {
        out.push({ m, k, beat: (m - from) * meter + off, d: n.d, p: n.r ? null : n.p, c: n.r || n.p == null ? [] : (n.c || []) });
        off += n.d;
      });
    }
    return out;
  }

  // 완성 점검
  function checks(work) {
    const meter = meterOf(work);
    const reqAt = findReq(work.ms, meter);
    const full = work.ms.filter(m => beats(m) === meter).length;
    const blanks = work.ms.reduce((a, m) => a + m.filter(n => !n.r && n.p == null).length, 0);
    let last = null;
    for (let m = NM - 1; m >= 0 && last === null; m--) {
      for (let k = work.ms[m].length - 1; k >= 0; k--) { const n = work.ms[m][k]; if (!n.r && n.p != null) { last = n.p; break; } }
    }
    return {
      req: reqAt >= 0, reqAt, full, blanks,
      endsOnTonic: last !== null && isTonic(last, work.key),
      named: !!(work.title.trim() && work.num.trim() && work.name.trim()),
      intent: work.intent.trim().length,
      done: reqAt >= 0 && full === NM && blanks === 0,
    };
  }

  return {
    NM, LINES, BEATS, METERS, MIN_MIDI, MAX_MIDI, DURS, REQ, REQS, KEYS, KEY_ORDER, INSTRUMENTS, SOLFA, COLOR_BY_PC, SHARP_COLOR,
    meterOf, reqFor, dursFor,
    instById, key, pc, degree, solfa, inScale, isTonic, tonicSolfa, spell, sigAcc, displayAcc, staffStep,
    beats, findReq, newWork, normWork, clampBpm, timeline, checks,
  };
})();
