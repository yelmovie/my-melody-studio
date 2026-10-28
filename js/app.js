// 화면과 편집: Music(규칙) · Engine(소리) · Score(악보) · Exporter(저장)를 묶는다
(() => {
  const M = Music;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const STORE = 'melody-studio.work.v3';
  const HELP_SEEN = 'melody-studio.help-seen.v3';
  const icon = (id, cls = '') => `<svg class="ic ${cls}"><use href="#i-${id}"/></svg>`;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));

  // ---------- 화면 높이 (주소창 있는 태블릿·QR 브라우저 대응) ----------
  function syncHeight() {
    const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-height', h + 'px');
  }
  syncHeight();
  window.addEventListener('resize', syncHeight);
  window.addEventListener('orientationchange', syncHeight);
  window.visualViewport && window.visualViewport.addEventListener('resize', syncHeight);
  document.addEventListener('visibilitychange', syncHeight);

  // ---------- 저장 ----------
  function readSaved() {
    try { return M.normWork(JSON.parse(localStorage.getItem(STORE) || 'null')); } catch (e) { return null; }
  }
  let saveTimer = 0;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE, JSON.stringify(work)); } catch (e) { toast('브라우저에 저장하지 못했어요. 내기 전에 MP3로 저장해 두세요.'); }
    }, 250);
  }

  let work = readSaved() || M.newWork();
  let sel = { m: 0, k: work.ms[0].length ? 0 : null };
  let pen = 1;
  let inputOn = true;
  let labelMode = 'solfa';
  let scaleHelp = true;
  const hist = [];
  const beatSec = () => 60 / work.bpm;
  const MB = () => M.meterOf(work);          // 한 마디 박 수 (2·3·4)
  const REQ = () => M.reqFor(MB());          // 고른 박자에 맞춘 꼭 넣을 리듬
  // 받침에 따라 을/를 고르기 (실로폰을 / 피아노를)
  const josa = (w, a, b) => { const c = w.charCodeAt(w.length - 1) - 0xAC00; return w + (c >= 0 && c <= 11171 && c % 28 ? a : b); };

  // ---------- 작은 도구들 ----------
  let toastT = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('is-show'), 2600);
  }
  function sfx(name) { try { Engine.sfx(name); } catch (e) {} }
  function confetti() {
    const box = $('#confetti');
    const colors = ['#6741d9', '#ffd43b', '#9775fa', '#69db7c', '#4dabf7', '#ff8787'];
    for (let i = 0; i < 46; i++) {
      const el = document.createElement('i');
      if (i % 5 === 0) { el.className = 'note'; el.textContent = i % 10 ? '♪' : '♫'; }
      el.style.left = Math.random() * 100 + 'vw';
      el.style.background = colors[i % colors.length];
      el.style.animationDuration = (1.8 + Math.random() * 1.6) + 's';
      el.style.animationDelay = Math.random() * .4 + 's';
      box.appendChild(el);
      setTimeout(() => el.remove(), 4200);
    }
  }
  // 누르는 순간 눌린 느낌 (터치에서 :active 가 늦게 붙는 문제)
  document.addEventListener('pointerdown', e => {
    const b = e.target.closest('.btn, .tool');
    if (!b) return;
    b.classList.add('is-pressed');
    setTimeout(() => b.classList.remove('is-pressed'), 160);
  });

  // ---------- 모달: 한 번에 하나, Esc·닫기 단추, 포커스 되돌리기 ----------
  let openModalEl = null, lastFocus = null;
  function openModal(id) {
    if (openModalEl) closeModal();
    lastFocus = document.activeElement;
    openModalEl = $(id);
    openModalEl.hidden = false;
    const f = openModalEl.querySelector('textarea, .mclose, button');
    f && f.focus();
  }
  function closeModal() {
    if (!openModalEl) return;
    const el = openModalEl;
    openModalEl = null;
    el.hidden = true;
    el.dispatchEvent(new Event('closed'));
    lastFocus && lastFocus.focus && lastFocus.focus();
  }
  $$('.modal').forEach(m => {
    m.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) closeModal();
      else if (e.target === m && m.id !== 'mConfirm') closeModal();
    });
  });
  // window.confirm 대신 쓰는 확인 창
  function ask(msg, yes = '네, 바꿀게요') {
    return new Promise(res => {
      $('#confirmMsg').textContent = msg;
      $('#confirmYes').textContent = yes;
      openModal('#mConfirm');
      const done = v => { $('#confirmYes').onclick = $('#confirmNo').onclick = null; closeModal(); res(v); };
      $('#confirmYes').onclick = () => done(true);
      $('#confirmNo').onclick = () => done(false);
    });
  }

  // ---------- 악기 탭 ----------
  const KIND_ICON = { mallet: 'bars', piano: 'key', sustain: 'wind', pluck: 'pluck' };
  const STRINGS = new Set(['violin', 'viola', 'cello', 'contrabass']);
  const instIcon = inst => inst.id === 'trumpet' ? 'brass' : STRINGS.has(inst.id) ? 'strings' : KIND_ICON[inst.kind] || 'music';
  const loadPct = {};

  function renderTabs() {
    $('#instTabs').innerHTML = M.INSTRUMENTS.map(i => `
      <button class="inst-tab ${i.id === work.inst ? 'is-on' : ''}" data-inst="${i.id}" aria-pressed="${i.id === work.inst}">
        ${icon(instIcon(i))}<span>${i.name}</span>
        ${loadPct[i.id] != null && loadPct[i.id] < 100 ? `<span class="inst-tab__pct">${loadPct[i.id]}%</span>` : ''}
      </button>`).join('');
  }
  $('#instTabs').addEventListener('click', e => {
    const b = e.target.closest('[data-inst]');
    if (!b) return;
    setInstrument(b.dataset.inst, true);
  });
  function loadInst(id) {
    if (Engine.isReady && Engine.isReady(id)) return Promise.resolve(true);
    loadPct[id] = 0;
    return Engine.loadInstrument(id, (a, b) => {
      loadPct[id] = Math.round(a / b * 100);
      if (id === work.inst) $('#instLoad').textContent = loadPct[id] < 100 ? `소리 불러오는 중 ${loadPct[id]}%` : '';
      renderTabs();
    }).then(ok => {
      loadPct[id] = 100;
      renderTabs();
      if (id === work.inst) $('#instLoad').textContent = ok ? '' : '진짜 악기 소리를 못 불러와서 비슷한 소리로 연주해요.';
      return ok;
    });
  }
  function setInstrument(id, demo) {
    const before = M.instById(work.inst).input;
    work.inst = M.instById(id).id;
    persist();
    renderTabs();
    const inst = M.instById(work.inst);
    $('#instNow').innerHTML = `${icon(instIcon(inst))}${inst.name}`;
    if (inst.input !== before || !stageBuilt) buildStage();
    loadInst(work.inst).then(() => {
      if (!demo) return;
      Engine.ensure();
      const d = doMidi();
      playNotes([[d, .5], [d + 4, .5], [d + 7, 1]], work.inst);
    });
  }

  // ---------- 악기 그리기 (실로폰 음판 / 건반) ----------
  const WHITE = [55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81];
  const BLACK = [56, 58, 61, 63, 66, 68, 70, 73, 75, 78, 80];
  const BPOS = [0, 1, 3, 4, 6, 7, 8, 10, 11, 13, 14];
  const WCODES = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight'];
  const WLABEL = ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'U', 'I', 'O', 'P', '[', ']'];
  const BCODES = ['KeyS', 'KeyD', 'KeyG', 'KeyH', 'KeyK', 'KeyL', 'Semicolon', 'Digit8', 'Digit9', 'Minus', 'Equal'];
  const BLABEL = ['S', 'D', 'G', 'H', 'K', 'L', ';', '8', '9', '-', '='];
  const KO = { C: '다', D: '라', E: '마', F: '바', G: '사', A: '가', B: '나' };
  const codeMap = {}, kbdLabel = {};
  WCODES.forEach((c, i) => { codeMap[c] = WHITE[i]; kbdLabel[WHITE[i]] = WLABEL[i]; });
  BCODES.forEach((c, i) => { codeMap[c] = BLACK[i]; kbdLabel[BLACK[i]] = BLABEL[i]; });
  const els = new Map();
  let stageBuilt = false;

  function labelFor(midi) {
    if (labelMode === 'none') return '';
    if (labelMode === 'kbd') return kbdLabel[midi];
    if (labelMode === 'letter') {
      const s = M.spell(midi, work.key);
      return KO[s.letter] + (s.acc === '#' ? '♯' : s.acc === 'b' ? '♭' : '');
    }
    return M.solfa(midi, work.key);
  }
  function buildStage() {
    stageBuilt = true;
    const stage = $('#stage');
    const bars = M.instById(work.inst).input === 'bars';
    els.clear();
    stage.innerHTML = bars ? `<svg class="rails" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <g stroke="#6b5f7a" stroke-width="1.6" stroke-linecap="round">
        <line x1=".5" y1="12" x2="99.5" y2="15" vector-effect="non-scaling-stroke"/><line x1=".5" y1="41" x2="99.5" y2="43" vector-effect="non-scaling-stroke"/>
        <line x1=".5" y1="53" x2="99.5" y2="53" vector-effect="non-scaling-stroke"/><line x1=".5" y1="89" x2="99.5" y2="72" vector-effect="non-scaling-stroke"/></g></svg>` : '';
    WHITE.forEach((midi, i) => {
      const el = document.createElement('button');
      const pc = M.pc(midi);
      el.style.setProperty('--c', M.COLOR_BY_PC[pc]);
      if (bars) {
        el.className = 'bar' + (pc === 9 || pc === 11 ? ' bar--dark' : '');
        Object.assign(el.style, { left: (1 + i * 6.15) + '%', width: '5.5%', top: '47%', height: (46 - i * 16 / 15) + '%' });
      } else {
        el.className = 'key key--white';
        Object.assign(el.style, { left: (i * 100 / 16) + '%', width: (100 / 16) + '%', top: '0', height: '100%' });
      }
      addKey(el, midi, stage);
    });
    BLACK.forEach((midi, i) => {
      const el = document.createElement('button');
      const p = BPOS[i];
      if (bars) {
        el.className = 'bar bar--black';
        Object.assign(el.style, { left: (1 + p * 6.15 + 3.08) + '%', width: '5.5%', top: (3 + p * .2) + '%', height: '44%' });
      } else {
        el.className = 'key key--black';
        Object.assign(el.style, { left: ((p + 1) * 100 / 16 - 1.95) + '%', width: '3.9%', top: '0', height: '62%' });
      }
      addKey(el, midi, stage);
    });
    refreshKeys();
  }
  function addKey(el, midi, stage) {
    el.type = 'button';
    el.tabIndex = -1;
    el.addEventListener('pointerdown', e => { e.preventDefault(); hit(midi); });
    stage.appendChild(el);
    els.set(midi, el);
  }
  // 글자·음계 도우미·으뜸음 별을 다시 그린다
  function refreshKeys() {
    els.forEach((el, midi) => {
      const lb = labelFor(midi);
      const tonic = scaleHelp && M.isTonic(midi, work.key);
      el.innerHTML = (tonic ? `<svg class="star-badge"><use href="#i-star"/></svg>` : '') + (lb ? `<span class="lb">${esc(lb)}</span>` : '');
      el.classList.toggle('is-off', scaleHelp && !M.inScale(midi, work.key));
      el.setAttribute('aria-label', M.solfa(midi, work.key) + (tonic ? ' (으뜸음)' : ''));
    });
  }
  function flash(midi) {
    const el = els.get(midi);
    if (!el) return;
    el.classList.add('is-hit');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('is-hit'), 140);
  }
  $('#labelSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    labelMode = b.dataset.mode;
    $$('#labelSeg button').forEach(x => x.classList.toggle('is-on', x === b));
    refreshKeys();
  });
  $('#btnScale').addEventListener('click', () => {
    scaleHelp = !scaleHelp;
    $('#btnScale').classList.toggle('is-on', scaleHelp);
    $('#btnScale').setAttribute('aria-pressed', scaleHelp);
    refreshKeys();
  });

  // 악기를 치면: 소리 + (악보에 넣기가 켜져 있으면) 음표 넣기
  function hit(midi) {
    Engine.ensure();
    const note = sel && sel.k !== null ? work.ms[sel.m][sel.k] : null;
    const dur = inputOn && !showOpen() ? (note ? note.d : pen) * beatSec() : .6;
    Engine.play(work.inst, midi, Math.min(dur, 2.4));
    flash(midi);
    if (inputOn && !showOpen() && !openModalEl) editHit(midi);
  }
  const showOpen = () => !$('#show').hidden;

  // ---------- 키보드 ----------
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && openModalEl && openModalEl.id !== 'mConfirm') { closeModal(); return; }
    if (e.key === 'Escape' && instFull && !openModalEl) { setInstFull(false); return; }
    const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
    if (typing || openModalEl) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const midi = codeMap[e.code];
    if (midi !== undefined) { e.preventDefault(); if (!e.repeat) hit(midi); return; }
    if (showOpen()) { if (e.code === 'Space') { e.preventDefault(); $('#sPlay').click(); } return; }
    if (e.code === 'Space') { e.preventDefault(); $('#btnPlayAll').click(); }
    else if (e.code === 'Backspace' || e.code === 'Delete') { e.preventDefault(); del(); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); select(nextTarget(sel)); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); select(prevTarget(sel)); }
    else if (e.code === 'ArrowUp') { e.preventDefault(); stepPitch(1); }
    else if (e.code === 'ArrowDown') { e.preventDefault(); stepPitch(-1); }
  });

  // ---------- 선택 이동 ----------
  const firstTarget = m => work.ms[m].length ? { m, k: 0 } : { m, k: null };
  const lastTarget = m => M.beats(work.ms[m]) < MB() ? { m, k: null } : { m, k: work.ms[m].length - 1 };
  function nextTarget(s) {
    const meas = work.ms[s.m];
    if (s.k !== null && s.k + 1 < meas.length) return { m: s.m, k: s.k + 1 };
    if (s.k !== null && M.beats(meas) < MB()) return { m: s.m, k: null };
    if (s.m + 1 < M.NM) return firstTarget(s.m + 1);
    return s;
  }
  function prevTarget(s) {
    if (s.k === null && work.ms[s.m].length) return { m: s.m, k: work.ms[s.m].length - 1 };
    if (s.k > 0) return { m: s.m, k: s.k - 1 };
    if (s.m > 0) return lastTarget(s.m - 1);
    return s;
  }
  function fixSel() {
    sel.m = Math.max(0, Math.min(M.NM - 1, sel.m));
    const meas = work.ms[sel.m];
    if (sel.k !== null && sel.k >= meas.length) sel.k = M.beats(meas) < MB() ? null : meas.length - 1;
    if (sel.k === null && M.beats(meas) >= MB()) sel.k = meas.length - 1;
  }
  function select(s) { sel = s; render(); }

  // ---------- 편집 ----------
  function snapshot() { hist.push(JSON.stringify(work.ms)); if (hist.length > 80) hist.shift(); }
  function changed() { persist(); render(); }
  const beatWord = b => { const w = Math.floor(b), h = b % 1; return w ? `${w}박${h ? ' 반' : ''}` : '반 박'; };
  function afterFill(m) {
    const meas = work.ms[m];
    if (M.beats(meas) < MB()) return { m, k: null };
    if (m + 1 < M.NM) { sfx('pop'); return firstTarget(m + 1); }
    return { m, k: meas.length - 1 };
  }
  function editHit(midi) {
    const meas = work.ms[sel.m];
    if (sel.k !== null) {
      snapshot();
      meas[sel.k] = { d: meas[sel.k].d, p: midi };
      sel = nextTarget(sel);
      changed();
      return;
    }
    const left = MB() - M.beats(meas);
    if (pen > left) {
      sfx('oops');
      toast(`이 마디에는 ${beatWord(left)}만 남았어요. 더 짧은 리듬 카드를 골라요.`);
      return;
    }
    snapshot();
    meas.push({ d: pen, p: midi });
    sel = afterFill(sel.m);
    changed();
  }
  function del() {
    const meas = work.ms[sel.m];
    if (sel.k !== null) { snapshot(); meas.splice(sel.k, 1); fixSel(); changed(); }
    else if (meas.length) { snapshot(); meas.pop(); changed(); }
    else if (sel.m > 0) select(lastTarget(sel.m - 1));
  }
  function undo() {
    if (!hist.length) { toast('더 되돌릴 것이 없어요.'); return; }
    work.ms = JSON.parse(hist.pop());
    fixSel();
    changed();
  }

  // 리듬 카드
  const CARDS = [
    { d: 1, word: '타', beat: '1박', draw: 'q' },
    { d: .5, word: '티', beat: '반 박', draw: 'e' },
    { d: 2, word: '타-아', beat: '2박', draw: 'h' },
    { d: 3, word: '타-아-아', beat: '3박', draw: 'dh' },
    { d: 4, word: '타-아-아-아', beat: '4박', draw: 'w' },
    { rest: true, d: 1, word: '쉼', beat: '1박 쉬기', draw: 'r' },
  ];
  function noteIcon(t) {
    const head = hollow => `<ellipse cx="12" cy="30" rx="6.4" ry="4.6" transform="rotate(-20 12 30)" fill="${hollow ? '#fff' : '#2b2541'}" stroke="#2b2541" stroke-width="${hollow ? 2.2 : 1}"/>`;
    const stem = '<line x1="17.8" y1="29" x2="17.8" y2="5" stroke="#2b2541" stroke-width="2"/>';
    if (t === 'q') return head(false) + stem;
    if (t === 'e') return head(false) + stem + '<path d="M17.8 5c1 6 9 8 7 16 0-5-4-8-7-9z" fill="#2b2541"/>';
    if (t === 'h') return head(true) + stem;
    if (t === 'dh') return head(true) + stem + '<circle cx="25" cy="30" r="2" fill="#2b2541"/>';
    if (t === 'w') return '<ellipse cx="15" cy="22" rx="8" ry="5.4" fill="#fff" stroke="#2b2541" stroke-width="2.6"/>';
    return `<text x="15" y="31" text-anchor="middle" font-size="30" font-family="'Noto Music','Segoe UI Symbol',serif" fill="#2b2541">𝄽</text>`;
  }
  function renderCards() {
    if (pen > MB()) pen = 1;
    $('#cards').innerHTML = CARDS.map((c, i) => `
      <button class="rcard ${c.rest ? 'rcard--rest' : ''} ${!c.rest && c.d === pen ? 'is-on' : ''} ${c.d > MB() ? 'is-locked' : ''}" data-i="${i}" aria-label="${c.word} ${c.beat}${c.d > MB() ? ' (이 박자에서는 못 써요)' : ''}">
        <svg viewBox="0 0 30 40" aria-hidden="true">${noteIcon(c.draw)}</svg>
        <span class="rcard__word">${c.word}</span><span class="rcard__beat">${c.beat}</span>
      </button>`).join('');
  }
  $('#cards').addEventListener('click', e => {
    const b = e.target.closest('.rcard');
    if (!b) return;
    const c = CARDS[+b.dataset.i];
    Engine.ensure();
    if (c.d > MB()) { sfx('oops'); toast(`${MB()}/4박자는 한 마디가 ${MB()}박이라 '${c.word}' 카드는 못 써요.`); return; }
    const meas = work.ms[sel.m];
    if (c.rest) {
      if (sel.k !== null) {
        snapshot();
        meas[sel.k] = { d: meas[sel.k].d, r: 1 };
        sel = nextTarget(sel);
        sfx('card');
        changed();
        return;
      }
      if (MB() - M.beats(meas) < 1) { sfx('oops'); toast('이 마디에는 쉼표가 들어갈 자리가 없어요.'); return; }
      snapshot();
      meas.push({ d: 1, r: 1 });
      sel = afterFill(sel.m);
      sfx('card');
      changed();
      return;
    }
    pen = c.d;
    renderCards();
    if (sel.k !== null) {
      const n = meas[sel.k];
      if (n.d !== c.d) {
        if (M.beats(meas) - n.d + c.d > MB()) { sfx('oops'); toast('이 마디에 들어가기엔 너무 길어요.'); return; }
        snapshot();
        meas[sel.k] = n.r ? { d: c.d, r: 1 } : { d: c.d, p: n.p };
        changed();
        toast(`음표 길이를 '${c.word}'(${c.beat})로 바꿨어요.`);
      }
      if (!n.r && n.p != null) Engine.play(work.inst, n.p, c.d * beatSec());
      return;
    }
    // 고른 리듬을 들려준다
    playNotes([[doMidi(), c.d]], work.inst);
    say(`'${c.word}' 카드를 골랐어요. 이제 ${M.instById(work.inst).name}을(를) 쳐 봐요!`);
  });

  // 도구
  // 꼭 넣을 리듬: 지금 고른 줄에 한 번에 넣는다 (2/4 는 8마디라 두 줄)
  $('#btnReq').addEventListener('click', async () => {
    const req = REQ(), span = req.length;
    const start = Math.min(Math.floor(sel.m / 4) * 4, M.NM - span);
    const old = M.findReq(work.ms, MB());
    if (old === start) { toast('이 줄에는 벌써 꼭 넣을 리듬이 있어요.'); showGuide(nextStep()); return; }
    const hasPitch = ms => ms.some(m => m.some(n => !n.r && n.p != null));
    if (hasPitch(work.ms.slice(start, start + span)) && !(await ask(`${start + 1}~${start + span}마디에 있던 음표가 꼭 넣을 리듬으로 바뀌어요. 바꿀까요?`))) return;
    snapshot();
    // 음을 하나도 안 넣은 예전 자리는 비워서 '옮긴' 것처럼 한다
    if (old >= 0 && !hasPitch(work.ms.slice(old, old + span))) {
      for (let j = 0; j < span; j++) if (old + j < start || old + j >= start + span) work.ms[old + j] = [];
    }
    req.forEach((r, j) => { work.ms[start + j] = r.map(d => ({ d, p: null })); });
    sel = { m: start, k: 0 };
    changed();
    sfx('success');
    showGuide({ text: '꼭 넣을 리듬이 들어갔어요! 이제 악기를 쳐서 회색 음표에 음을 넣어요.', target: $('#stage'), extra: [$(`#en${start}_0`)] });
  });
  $('#btnCopyM').addEventListener('click', () => {
    if (sel.m === 0) { toast('첫 마디는 따라 할 앞 마디가 없어요.'); return; }
    snapshot();
    work.ms[sel.m] = clone(work.ms[sel.m - 1]);
    sel = afterFill(sel.m);
    changed();
    say('앞 마디를 따라 했어요. 한 음만 바꿔 보면 더 멋져요!');
  });
  $('#btnCopyL').addEventListener('click', async () => {
    const L = Math.floor(sel.m / 4);
    if (L === 0) { toast('첫째 줄은 따라 할 앞 줄이 없어요.'); return; }
    const targets = [0, 1, 2, 3].map(j => work.ms[L * 4 + j]);
    if (targets.some(m => m.length) && !(await ask(`${L + 1}번째 줄이 ${L}번째 줄과 똑같이 바뀌어요. 바꿀까요?`))) return;
    snapshot();
    for (let j = 0; j < 4; j++) work.ms[L * 4 + j] = clone(work.ms[(L - 1) * 4 + j]);
    sel = { m: L * 4 + 3, k: work.ms[L * 4 + 3].length ? work.ms[L * 4 + 3].length - 1 : null };
    changed();
    say('앞 줄을 따라 했어요. 끝부분만 살짝 바꾸면 반복과 변화가 생겨요!');
  });
  $('#btnDel').addEventListener('click', del);
  $('#btnUndo').addEventListener('click', undo);

  // 고른 음표 높이 바꾸기: 음계 도우미가 켜져 있으면 조성에 맞는 음으로만 한 칸씩
  const ALL_KEYS = [...WHITE, ...BLACK].sort((a, b) => a - b);
  function stepPitch(dir) {
    if (sel.k === null) { toast('먼저 악보에서 바꿀 음표를 눌러 골라요.'); return; }
    const n = work.ms[sel.m][sel.k];
    if (n.r) { toast('쉼표는 높이가 없어요. 리듬 카드를 누르면 음표로 바꿀 수 있어요.'); return; }
    const pool = scaleHelp ? ALL_KEYS.filter(m => M.inScale(m, work.key)) : ALL_KEYS;
    let p;
    if (n.p == null) p = doMidi();
    else {
      p = dir > 0 ? pool.find(m => m > n.p) : [...pool].reverse().find(m => m < n.p);
      if (p == null) { sfx('oops'); toast(dir > 0 ? '이보다 높은 음은 없어요.' : '이보다 낮은 음은 없어요.'); return; }
    }
    snapshot();
    work.ms[sel.m][sel.k] = { d: n.d, p };
    changed();
    Engine.ensure();
    Engine.play(work.inst, p, Math.min(n.d * beatSec(), 1.2));
    flash(p);
  }
  $('#btnUp').addEventListener('click', () => stepPitch(1));
  $('#btnLow').addEventListener('click', () => stepPitch(-1));
  function renderSelEdit() {
    const n = sel.k !== null ? work.ms[sel.m][sel.k] : null;
    $('#selLabel').textContent = !n ? `${sel.m + 1}마디 끝` : n.r ? '고른 쉼표' : n.p == null ? '고른 음표: ?' : `고른 음표: ${M.solfa(n.p, work.key)}`;
    $('#btnUp').disabled = $('#btnLow').disabled = !n || !!n.r;
    $('#btnDel').disabled = !n && !work.ms[sel.m].length && sel.m === 0;
  }

  // 새로 만들기: 악보만 비운다. 되돌리기로 바로 돌아올 수 있다
  $('#btnNew').addEventListener('click', async () => {
    if (!(await ask('악보를 처음부터 새로 만들까요? 제목·학번·이름은 그대로 남아요. 실수로 눌렀다면 되돌리기로 돌아올 수 있어요.', '네, 새로 만들게요'))) return;
    stopPlay();
    snapshot();
    work.ms = M.newWork(MB()).ms;
    sel = { m: 0, k: 0 };
    listened = false;
    changed();
    sfx('success');
    showGuide({ text: '새 악보예요! 노란 칸 회색 음표에 음을 넣어 시작해요.', target: $('#stage'), extra: [$('#en0_0')] });
  });
  $('#btnInput').addEventListener('click', () => {
    inputOn = !inputOn;
    $('#btnInput').classList.toggle('is-on', inputOn);
    $('#btnInput').setAttribute('aria-pressed', inputOn);
    say(inputOn ? '이제 악기를 치면 악보에 음표가 들어가요.' : '자유롭게 연주해 봐요. 악보는 바뀌지 않아요.');
    render();
  });

  // ---------- 악보 ----------
  const scoreBox = $('#scoreBox');
  function renderScore(root, w, opts) {
    root.innerHTML = Score.renderAll(w, opts).map((s, L) => `<div class="line" data-l="${L}">${s}</div>`).join('');
  }
  function scrollLineIntoView(root, m) {
    // 크게 보기에서는 이 줄만 보이므로 표시만 바꾼다
    root.querySelectorAll('.line').forEach(l => l.classList.toggle('is-cur', +l.dataset.l === Math.floor(m / 4)));
    const line = root.querySelector(`.line[data-l="${Math.floor(m / 4)}"]`);
    if (!line) return;
    const top = line.offsetTop - root.offsetTop, bottom = top + line.offsetHeight;
    if (top < root.scrollTop) root.scrollTop = top;
    else if (bottom > root.scrollTop + root.clientHeight) root.scrollTop = bottom - root.clientHeight;
  }
  scoreBox.addEventListener('click', e => {
    const n = e.target.closest('[data-k]');
    if (n) {
      const m = +n.dataset.m, k = +n.dataset.k;
      const note = work.ms[m][k];
      Engine.ensure();
      if (!note.r && note.p != null) { Engine.play(work.inst, note.p, note.d * beatSec()); flash(note.p); }
      select({ m, k });
      return;
    }
    const mb = e.target.closest('[data-m]');
    if (!mb) return;
    const m = +mb.dataset.m;
    sfx('pop');
    select(M.beats(work.ms[m]) < MB() ? { m, k: null } : { m, k: work.ms[m].length - 1 });
  });

  // ---------- 진행률·도담이 ----------
  const TIPS = [
    '같은 리듬을 두 번 쓰면 노래가 기억하기 쉬워져요.',
    '이웃한 음으로 차례로 가면 부드럽고, 멀리 뛰면 신나요.',
    '쉼표는 노래가 숨 쉬는 곳이에요. 줄 끝에 넣어 봐요.',
    '곡의 가운데쯤에 가장 높은 음을 두면 멋진 절정이 돼요.',
    '앞 줄을 따라 한 뒤 끝 두 마디만 바꿔 봐요.',
  ];
  let tipI = 0, lastHint = '', listened = false;
  function say(text) {
    const b = $('#bubble');
    // 말풍선이 접혀 있으면(작은 화면 크게 보기) 알림으로 보여 준다
    if (!b.getClientRects().length && document.body.classList.contains('is-inst-full')) toast(text);
    b.textContent = text;
    b.classList.remove('is-new');
    void b.offsetWidth;
    b.classList.add('is-new');
  }
  // 지금 해야 할 일 한 가지: { text, target(가리킬 곳), extra(같이 반짝일 곳) }
  function nextStep() {
    const c = M.checks(work);
    const inst = M.instById(work.inst).name;
    const stage = $('#stage');
    const noteEl = (m, k) => $(`#en${m}_${k}`);
    const isSel = (m, k) => sel.m === m && sel.k === k;
    const blankIn = (from, to) => {
      for (let m = from; m < to; m++) { const k = work.ms[m].findIndex(n => !n.r && n.p == null); if (k >= 0) return { m, k }; }
      return null;
    };
    const fillBlank = b => isSel(b.m, b.k)
      ? { text: `좋아요! 이제 ${josa(inst, '을', '를')} 쳐서 반짝이는 음표에 음을 넣어요.`, target: stage, extra: [noteEl(b.m, b.k)] }
      : { text: '반짝이는 회색 음표를 눌러요. 그다음 악기를 쳐요.', target: noteEl(b.m, b.k) };
    if (c.reqAt < 0) return { text: '먼저 ⭐ 꼭 넣을 리듬 단추를 눌러 노란 칸을 만들어요.', target: $('#btnReq') };
    const reqBlank = blankIn(c.reqAt, c.reqAt + REQ().length);
    if (reqBlank) return fillBlank(reqBlank);
    const m = work.ms.findIndex(x => M.beats(x) < MB());
    if (m >= 0) {
      if (sel.m === m && sel.k === null) {
        const left = MB() - M.beats(work.ms[m]);
        return { text: `리듬 카드를 하나 고르고 악기를 쳐요. 이 마디는 ${beatWord(left)} 남았어요.`, target: $('#cards'), extra: [stage] };
      }
      return { text: `${m + 1}번째 마디를 채울 차례예요. 반짝이는 마디를 눌러요.`, target: $(`#emb${m}`) };
    }
    const b = blankIn(0, M.NM);
    if (b) return fillBlank(b);
    if (!c.endsOnTonic) {
      let last = null;
      work.ms.forEach((meas, mm) => meas.forEach((n, k) => { if (!n.r && n.p != null) last = { m: mm, k }; }));
      const tonic = M.tonicSolfa(work.key);
      if (last && isSel(last.m, last.k)) return { text: `별 표시가 있는 '${tonic}'를 쳐서 마지막 음을 바꿔 봐요.`, target: stage };
      if (last) return { text: `마지막 음을 '${tonic}'로 끝내면 끝난 느낌이 나요. 마지막 음표를 눌러요.`, target: noteEl(last.m, last.k) };
    }
    if (!work.title.trim()) return { text: '멋진 곡 제목을 지어 줘요.', target: $('#inTitle'), focus: true };
    if (!work.num.trim()) return { text: '학번을 써 줘요.', target: $('#inNum'), focus: true };
    if (!work.name.trim()) return { text: '이름을 써 줘요.', target: $('#inName'), focus: true };
    if (c.intent < 10) return { text: '어떤 느낌을 표현했는지 작곡 의도를 써 줘요.', target: $('#btnIntent') };
    if (!listened) return { text: '처음부터 들어 보며 고칠 곳이 있는지 찾아봐요.', target: $('#btnPlayAll') };
    return { text: '완성했어요! 노란 완성하고 내기 단추를 눌러요.', target: $('#btnSubmit') };
  }

  // 가리키기: 반짝이는 테두리 + '여기!' 화살표 (몇 초 뒤 또는 다음 터치에 사라진다)
  let guideEls = [], guideT = 0;
  function clearGuide() {
    clearTimeout(guideT);
    guideEls.forEach(e => e.remove());
    guideEls = [];
  }
  function ring(el, main) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const pad = 6;
    const d = document.createElement('div');
    d.className = 'guide-ring' + (main ? '' : ' guide-ring--soft');
    Object.assign(d.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    document.body.appendChild(d);
    guideEls.push(d);
    if (!main) return;
    const a = document.createElement('div');
    const below = r.top < 90;
    a.className = 'guide-arrow' + (below ? ' guide-arrow--up' : '');
    a.innerHTML = `<span>여기!</span><svg viewBox="0 0 24 24"><path d="M12 3v15M5 12l7 7 7-7"/></svg>`;
    document.body.appendChild(a);
    const aw = a.offsetWidth, ah = a.offsetHeight;
    a.style.left = Math.max(8, Math.min(innerWidth - aw - 8, r.left + r.width / 2 - aw / 2)) + 'px';
    a.style.top = (below ? r.bottom + 8 : r.top - ah - 8) + 'px';
    guideEls.push(a);
  }
  function showGuide(step) {
    clearGuide();
    say(step.text);
    if (!step.target) return;
    // 크게 보기에서 숨은 곳을 가리켜야 하면 먼저 원래 화면으로
    if (instFull && !step.target.getClientRects().length) setInstFull(false);
    const go = () => {
      if (scoreBox.contains(step.target)) scrollLineIntoView(scoreBox, +(step.target.dataset.m || sel.m));
      else step.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      setTimeout(() => {
        ring(step.target, true);
        (step.extra || []).filter(Boolean).forEach(e => ring(e, false));
        if (step.focus) step.target.focus();
        guideT = setTimeout(clearGuide, 5000);
      }, 220);
    };
    requestAnimationFrame(go);
  }
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#mascot')) clearGuide(); }, true);
  window.addEventListener('resize', clearGuide);
  scoreBox.addEventListener('scroll', clearGuide);
  function progressPct(c) {
    const notes = work.ms.reduce((a, m) => a + m.filter(n => !n.r).length, 0);
    const filled = notes - c.blanks;
    return Math.round(Math.min(100,
      (c.req ? 10 : 0) + c.full / M.NM * 50 + (notes ? filled / notes * 15 : 0) * (c.full / M.NM) + (c.named ? 10 : 0) + Math.min(c.intent, 30) / 30 * 10 + (c.endsOnTonic ? 5 : 0)));
  }
  let wasDone = false;
  function updateStatus() {
    const c = M.checks(work);
    const pct = c.done && c.named && c.intent >= 10 ? 100 : Math.min(99, progressPct(c));
    $('#meterFill').style.width = pct + '%';
    $('#meter').setAttribute('aria-valuenow', pct);
    $('#progressText').textContent = pct === 100 ? '완성! 낼 수 있어요' : `완성까지 ${pct}% · 마디 ${c.full}/${M.NM}`;
    const h = nextStep().text;
    if (h !== lastHint) { lastHint = h; say(h); }
    if (pct === 100 && !wasDone) { confetti(); sfx('success'); }
    wasDone = pct === 100;
  }
  // 도담이를 누르면: 지금 할 일을 말하고 그곳을 가리킨다. 같은 안내를 또 누르면 꿀팁도 하나
  let lastGuideText = '';
  $('#mascot').addEventListener('click', () => {
    sfx('pop');
    $('#mascot').classList.remove('is-calling');
    const step = nextStep();
    if (step.text === lastGuideText) step.text += ' 꿀팁: ' + TIPS[tipI++ % TIPS.length];
    lastGuideText = nextStep().text;
    showGuide(step);
  });
  // 한동안 아무것도 안 누르면 도담이가 먼저 손짓한다
  let lastInput = Date.now(), calling = false;
  ['pointerdown', 'keydown'].forEach(t => document.addEventListener(t, () => {
    lastInput = Date.now();
    if (calling) { calling = false; $('#mascot').classList.remove('is-calling'); }
  }, true));
  setInterval(() => {
    if (calling || openModalEl || showOpen() || player || Date.now() - lastInput < 15000) return;
    calling = true;
    $('#mascot').classList.add('is-calling');
    say('어디를 눌러야 할지 모르겠으면 나를 눌러요!');
    lastHint = '';
  }, 1000);

  function render() {
    fixSel();
    renderScore(scoreBox, work, { prefix: 'e', editable: inputOn, sel, labels: true });
    scrollLineIntoView(scoreBox, sel.m);
    renderRec();
    renderSelEdit();
    updateStatus();
  }

  // ---------- 재생 (만들기 화면·감상실 공통) ----------
  let player = null;
  function playWork(w, o) {
    stopPlay();
    Engine.ensure();
    const from = o.from || 0, to = o.to || M.NM;
    const bs = 60 / w.bpm;
    const tl = M.timeline(w, from, to);
    const ev = tl.filter(x => x.p != null).map(x => ({ t: x.beat * bs, midi: x.p, dur: x.d * bs }));
    const handle = Engine.playSequence(ev, w.inst);
    const total = (to - from) * MB() * bs;
    const p = { handle, tl, bs, idx: -1, o, total, raf: 0 };
    player = p;
    const loop = () => {
      if (player !== p) return;
      const t = Engine.ctx.currentTime - handle.t0;
      let i = p.idx;
      while (i + 1 < tl.length && tl[i + 1].beat * bs <= t) i++;
      if (i !== p.idx && i >= 0) { p.idx = i; highlight(o.root, o.prefix, tl[i], o.flash); }
      setBeatDot(t >= 0 ? Math.floor(t / bs) % M.meterOf(w) : -1);
      if (t > total + .5) { stopPlay(); o.onEnd && o.onEnd(); return; }
      p.raf = requestAnimationFrame(loop);
    };
    p.raf = requestAnimationFrame(loop);
  }
  function stopPlay() {
    if (!player) return;
    const p = player;
    player = null;
    cancelAnimationFrame(p.raf);
    p.handle.stop();
    p.o.root.querySelectorAll('.playing').forEach(x => x.classList.remove('playing'));
    if (p.o.root === scoreBox) scrollLineIntoView(scoreBox, sel.m);
    setBeatDot(-1);
    p.o.onStop && p.o.onStop();
  }
  function highlight(root, prefix, x, flashOn) {
    root.querySelectorAll('.playing').forEach(e => e.classList.remove('playing'));
    const n = root.querySelector(`#${prefix}n${x.m}_${x.k}`);
    const mb = root.querySelector(`#${prefix}mb${x.m}`);
    n && n.classList.add('playing');
    mb && mb.classList.add('playing');
    if (root === scoreBox) scrollLineIntoView(scoreBox, x.m);
    else {
      const line = root.querySelector(`.line[data-l="${Math.floor(x.m / 4)}"]`);
      line && line.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    if (flashOn && x.p != null) flash(x.p);
  }
  function setBeatDot(i) { $$('#beatDots i').forEach((d, j) => d.classList.toggle('is-on', j === i)); }
  // 짧은 예시 가락: [[midi, 박], ...]
  function playNotes(notes, inst, bpm = 100, onEnd) {
    Engine.ensure();
    const bs = 60 / bpm;
    let t = 0;
    const ev = notes.map(([midi, d]) => { const e = { t, midi, dur: d * bs }; t += d * bs; return e; });
    const h = Engine.playSequence(ev, inst);
    if (onEnd) setTimeout(onEnd, (t + .4) * 1000);
    return h;
  }
  function doMidi() { const d = 60 + M.key(work.key).doPc; return d > 67 ? d - 12 : d; }

  function setPlayBtn(btn, playing, label) {
    btn.classList.toggle('is-playing', playing);
    btn.querySelector('use').setAttribute('href', playing ? '#i-stop' : btn.dataset.icon);
    btn.querySelector('span').textContent = playing ? '멈추기' : label;
  }
  $('#btnPlayAll').dataset.icon = '#i-play';
  $('#btnPlayLine').dataset.icon = '#i-line';
  $('#btnPlayAll').addEventListener('click', () => {
    if (player && player.o.btn === 'all') { stopPlay(); return; }
    playWork(work, {
      root: scoreBox, prefix: 'e', flash: true, btn: 'all',
      onStop: () => setPlayBtn($('#btnPlayAll'), false, '처음부터 듣기'),
      onEnd: () => { listened = true; lastHint = ''; updateStatus(); if (M.checks(work).done) { sfx('applause'); confetti(); } },
    });
    setPlayBtn($('#btnPlayAll'), true, '처음부터 듣기');
    setPlayBtn($('#btnPlayLine'), false, '이 줄만');
  });
  $('#btnPlayLine').addEventListener('click', () => {
    if (player && player.o.btn === 'line') { stopPlay(); return; }
    const L = Math.floor(sel.m / 4);
    playWork(work, {
      root: scoreBox, prefix: 'e', flash: true, btn: 'line', from: L * 4, to: L * 4 + 4,
      onStop: () => setPlayBtn($('#btnPlayLine'), false, '이 줄만'),
    });
    setPlayBtn($('#btnPlayLine'), true, '이 줄만');
    setPlayBtn($('#btnPlayAll'), false, '처음부터 듣기');
  });

  // 박자(메트로놈) + 박자점
  let metroT0 = 0, metroRaf = 0;
  $('#btnMetro').addEventListener('click', () => {
    Engine.ensure();
    const on = !Engine.metronome.running;
    if (on) {
      metroT0 = Engine.ctx.currentTime + .1;
      Engine.metronome.start(work.bpm, metroT0);
      const loop = () => {
        if (!Engine.metronome.running) { setBeatDot(-1); return; }
        if (!player) setBeatDot(Math.floor(Math.max(0, Engine.ctx.currentTime - metroT0) / beatSec()) % MB());
        metroRaf = requestAnimationFrame(loop);
      };
      metroRaf = requestAnimationFrame(loop);
    } else {
      Engine.metronome.stop();
      cancelAnimationFrame(metroRaf);
      setBeatDot(-1);
    }
    $('#btnMetro').classList.toggle('is-on', on);
    $('#btnMetro').setAttribute('aria-pressed', on);
  });

  // ---------- 곡 정보 ----------
  const TEMPO_WORDS = [[66, '느리게'], [84, '조금 느리게'], [100, '보통 빠르게'], [120, '조금 빠르게'], [999, '빠르게']];
  function renderInfo() {
    $('#inTitle').value = work.title;
    $('#inNum').value = work.num;
    $('#inName').value = work.name;
    $('#inIntent').value = work.intent;
    $('#keyName').textContent = M.key(work.key).name;
    const tw = TEMPO_WORDS.find(([v]) => work.bpm <= v)[1];
    $('#bpmVal').textContent = work.bpm;
    $('#tempoWord').textContent = tw;
    $('#beatName').textContent = `${MB()}/4 · ${tw}`;
    $('#reqSub').textContent = MB() === 2 ? '지금 줄부터 두 줄(8마디)에 한 번에' : '지금 줄(4마디)에 한 번에';
    const cnt = `${work.intent.length}/500`;
    $('#intentCount').textContent = cnt;
    $('#intentCount2').textContent = cnt;
  }
  [['#inTitle', 'title'], ['#inNum', 'num'], ['#inName', 'name'], ['#inIntent', 'intent']].forEach(([id, f]) => {
    $(id).addEventListener('input', e => { work[f] = e.target.value; persist(); renderInfo(); updateStatus(); });
  });
  function setBpm(v) {
    work.bpm = M.clampBpm(v);
    if (Engine.metronome.running) Engine.metronome.setBpm(work.bpm);
    persist();
    renderInfo();
  }
  $('#bpmDown').addEventListener('click', () => { setBpm(work.bpm - 4); renderBeatModal(); });
  $('#bpmUp').addEventListener('click', () => { setBpm(work.bpm + 4); renderBeatModal(); });

  // ---------- 박자·빠르기: 들어 보고 고르기 ----------
  const METER_INFO = {
    2: { count: '하나 둘', feel: '강 약 · 씩씩한 행진 느낌' },
    3: { count: '하나 둘 셋', feel: '강 약 약 · 빙글빙글 왈츠 느낌' },
    4: { count: '하나 둘 셋 넷', feel: '강 약 중강 약 · 가장 많이 쓰는 박자' },
  };
  const TEMPOS = [
    { bpm: 72, name: '느리게', feel: '천천히 걷듯이' },
    { bpm: 90, name: '보통 빠르게', feel: '산책하듯이' },
    { bpm: 116, name: '빠르게', feel: '신나게 뛰듯이' },
  ];
  // 센박은 높게, 여린박은 낮게 쳐서 박자를 귀로 느끼게 한다
  function meterPattern(m) {
    const d = doMidi(), out = [];
    for (let bar = 0; bar < 3; bar++) for (let j = 0; j < m; j++) out.push([j === 0 ? d + 12 : m === 4 && j === 2 ? d + 7 : d, 1]);
    return out;
  }
  function reqDemo(meter = MB()) {
    const mel = [60, 64, 62, 64, 65, 67, 67, 65, 64, 62, 64, 62, 60, 62, 60];
    const ds = M.reqFor(meter).flat();
    const shift = doMidi() - 60;
    return ds.map((d, i) => [(i === ds.length - 1 ? 60 : mel[i % mel.length]) + shift, d]);
  }
  function renderBeatModal() {
    $('#meterCards').innerHTML = M.METERS.map(m => `
      <div class="meter-card ${m === MB() ? 'is-on' : ''}">
        <div class="meter-card__sig">${m}<span>4</span></div>
        <div class="meter-card__txt"><b>${m}/4박자</b><small>${METER_INFO[m].count} · ${METER_INFO[m].feel}</small></div>
        <button class="btn" data-listen="${m}">${icon('play')}<span>들어 보기</span></button>
        <button class="btn ${m === MB() ? 'is-on' : 'btn--primary'}" data-meter="${m}">${m === MB() ? '고른 박자' : '이걸로 할래요'}</button>
      </div>`).join('');
    $('#tempoCards').innerHTML = TEMPOS.map(t => `
      <button class="tempo-card ${Math.abs(work.bpm - t.bpm) < 9 ? 'is-on' : ''}" data-bpm="${t.bpm}">${icon('play')}<span><b>${t.name}</b><small>${t.feel} · ♩=${t.bpm}</small></span></button>`).join('');
  }
  $('#btnBeat').addEventListener('click', () => { renderBeatModal(); openModal('#mBeat'); });
  $('#mBeat').addEventListener('click', async e => {
    const l = e.target.closest('[data-listen]'), p = e.target.closest('[data-meter]'), t = e.target.closest('[data-bpm]');
    if (l) { playNotes(meterPattern(+l.dataset.listen), work.inst, work.bpm); return; }
    if (t) { setBpm(+t.dataset.bpm); renderBeatModal(); playNotes(reqDemo(), work.inst, work.bpm); return; }
    if (!p) return;
    const m = +p.dataset.meter;
    if (m === MB()) return;
    const req = M.findReq(work.ms, MB()), span = REQ().length;
    const busy = work.ms.some((meas, i) => meas.some(n => !n.r && n.p != null) || (meas.length && !(req >= 0 && i >= req && i < req + span)));
    if (busy && !(await ask(`${m}/4박자로 바꾸면 악보를 새로 시작해요. 지금 넣은 음표는 지워져요. 바꿀까요?`))) { openModal('#mBeat'); return; }
    work.meter = m;
    work.ms = M.newWork(m).ms;
    hist.length = 0;
    sel = { m: 0, k: 0 };
    persist();
    renderCards();
    renderBeatDots();
    renderInfo();
    render();
    if (!openModalEl) { renderBeatModal(); openModal('#mBeat'); } else renderBeatModal();
    playNotes(meterPattern(m), work.inst, work.bpm);
    toast(`${m}/4박자로 바꿨어요. 꼭 넣을 리듬도 ${m}/4박자에 맞췄어요.`);
  });
  function renderBeatDots() { $('#beatDots').innerHTML = '<i></i>'.repeat(MB()); }

  // ---------- 리듬 추천: 고른 마디에 맞는 리듬 3가지 ----------
  const POOL = {
    4: [[1, 1, 1, 1], [1, 1, 2], [2, 1, 1], [2, 2], [.5, .5, 1, .5, .5, 1], [1, .5, .5, 2], [.5, .5, .5, .5, 2], [3, 1], [1, 1, 1, -1], [4], [1, -1, 1, 1]],
    3: [[1, 1, 1], [2, 1], [1, 2], [3], [.5, .5, 1, 1], [1, .5, .5, 1], [1, 1, -1], [.5, .5, 2]],
    2: [[1, 1], [2], [.5, .5, 1], [1, .5, .5], [.5, .5, .5, .5], [1, -1]],
  };
  const WORD = { .5: '티', 1: '타', 2: '타-아', 3: '타-아-아', 4: '타-아-아-아' };
  const patWord = p => p.map(d => d < 0 ? '쉼' : WORD[d]).join(' ');
  const patOf = meas => meas.map(n => n.r ? -n.d : n.d);
  let recSeed = 0;
  function recommend(m) {
    const meter = MB(), pool = POOL[meter];
    const lineEnd = m % 4 === 3;
    const ends = pool.filter(p => p[p.length - 1] >= 2 || p[p.length - 1] < 0);
    const list = [];
    const add = (p, label) => { if (p && p.length && !list.some(x => x.p.join() === p.join())) list.push({ p, label }); };
    if (m > 0 && M.beats(work.ms[m - 1]) === meter) add(patOf(work.ms[m - 1]), '앞 마디처럼');
    const reqBars = M.reqFor(meter);
    add(reqBars[(m + recSeed) % reqBars.length], '꼭 넣을 리듬에서');
    const src = lineEnd ? ends : pool;
    for (let i = 0; list.length < 3 && i < src.length; i++) add(src[(m * 3 + recSeed * 2 + i) % src.length], lineEnd ? '줄을 마무리' : '새 리듬');
    return list.slice(0, 3);
  }
  function renderRec() {
    const m = sel.m;
    $('#rec').innerHTML = `<div class="rec__head"><b>${m + 1}번째 마디 리듬 추천</b><button class="rec__dice" id="recDice" aria-label="다른 리듬 추천">${icon('dice')}<span>다른 추천</span></button></div>
      <div class="rec__list">${recommend(m).map((r, i) => `<button class="rec-chip" data-rec="${i}"><span class="rec-chip__label">${r.label}</span><span class="rec-chip__notes">${r.p.map(d => `<svg viewBox="0 0 30 40" aria-hidden="true">${noteIcon(d < 0 ? 'r' : { .5: 'e', 1: 'q', 2: 'h', 3: 'dh', 4: 'w' }[d])}</svg>`).join('')}</span><span class="rec-chip__word">${patWord(r.p)}</span></button>`).join('')}</div>`;
  }
  $('#rec').addEventListener('click', e => {
    if (e.target.closest('#recDice')) { recSeed++; sfx('card'); renderRec(); return; }
    const b = e.target.closest('[data-rec]');
    if (!b) return;
    const r = recommend(sel.m)[+b.dataset.rec];
    const m = sel.m;
    // 이미 넣은 음은 순서대로 살린다
    const oldP = work.ms[m].filter(n => !n.r && n.p != null).map(n => n.p);
    snapshot();
    let i = 0;
    work.ms[m] = r.p.map(d => d < 0 ? { d: -d, r: 1 } : { d, p: oldP[i++] ?? null });
    const k = work.ms[m].findIndex(n => !n.r && n.p == null);
    sel = k >= 0 ? { m, k } : afterFill(m);
    changed();
    Engine.ensure();
    playNotes(r.p.map((d, j) => [d < 0 ? null : (work.ms[m][j].p ?? doMidi()), Math.abs(d)]).filter(x => x[0] != null), work.inst, work.bpm);
    if (k >= 0) showGuide({ text: `'${patWord(r.p)}' 리듬이 들어갔어요! 악기를 쳐서 음을 넣어요.`, target: $('#stage'), extra: [$(`#en${m}_${k}`)] });
  });

  // ---------- 내 곡 받기 (오른쪽 위) ----------
  const downMenu = $('#downMenu');
  function setDownMenu(open) {
    downMenu.hidden = !open;
    $('#btnDown').setAttribute('aria-expanded', open);
    if (open) {
      const c = M.checks(work);
      $('#downNote').textContent = c.done && c.named ? '완성된 곡이에요. 받은 파일을 그대로 내면 돼요.' : '아직 완성 전이라 파일 이름에 ‘연습’이 붙어요.';
    }
  }
  $('#btnDown').addEventListener('click', e => { e.stopPropagation(); setDownMenu(downMenu.hidden); });
  document.addEventListener('click', e => { if (!downMenu.hidden && !e.target.closest('.down-wrap')) setDownMenu(false); });
  async function quickDownload(kind) {
    setDownMenu(false);
    const c = M.checks(work);
    const suffix = c.done && c.named ? '' : '연습';
    toast(kind === 'mp3' ? '소리 파일을 만들고 있어요… 잠깐만 기다려요.' : '악보 그림을 그리고 있어요…');
    try {
      let blob, name;
      if (kind === 'mp3') {
        const bs = beatSec();
        const ev = M.timeline(work).filter(x => x.p != null).map(x => ({ t: .3 + x.beat * bs, midi: x.p, dur: x.d * bs }));
        const buf = await Engine.renderOffline(ev, work.inst, .3 + M.NM * MB() * bs + 2.5);
        blob = await Exporter.encodeMp3(buf, work);
        name = Exporter.baseName(work, suffix) + '.mp3';
      } else {
        blob = await Exporter.renderSheetPng(work);
        name = Exporter.baseName(work, suffix) + '.png';
      }
      Exporter.download(blob, name);
      sfx('success');
      toast(`'${name}' 저장했어요!`);
    } catch (err) {
      console.error(err);
      sfx('oops');
      toast(err && err.message ? err.message : '저장하지 못했어요. 다시 눌러 주세요.');
    }
  }
  $('#downMp3').addEventListener('click', () => quickDownload('mp3'));
  $('#downPng').addEventListener('click', () => quickDownload('png'));

  // 조성 고르기: 누르면 그 조성의 느낌을 들려준다
  function keyArp(k) {
    const kk = M.key(k);
    let d = 60 + kk.doPc; if (d > 67) d -= 12;
    if (kk.mode === 'major') return [[d, .5], [d + 4, .5], [d + 7, .5], [d + 12, 1], [d + 7, .5], [d + 4, .5], [d, 1.5]];
    const la = d - 3;
    return [[la, .5], [la + 3, .5], [la + 7, .5], [la + 12, 1], [la + 7, .5], [la + 3, .5], [la, 1.5]];
  }
  function renderKeyBtns() {
    const btn = k => { const kk = M.key(k); return `<button class="key-btn ${work.key === k ? 'is-on' : ''}" data-key="${k}">${kk.name}<small>${kk.sig.length ? `조표 ${kk.acc === '#' ? '♯' : '♭'} 1개` : '조표 없음'}</small></button>`; };
    $('#keysMajor').innerHTML = M.KEY_ORDER.filter(k => M.key(k).mode === 'major').map(btn).join('');
    $('#keysMinor').innerHTML = M.KEY_ORDER.filter(k => M.key(k).mode === 'minor').map(btn).join('');
  }
  $('#btnKey').addEventListener('click', () => { renderKeyBtns(); openModal('#mKey'); });
  $('#mKey').addEventListener('click', e => {
    const b = e.target.closest('[data-key]');
    if (!b) return;
    work.key = b.dataset.key;
    persist();
    renderKeyBtns();
    renderInfo();
    refreshKeys();
    render();
    playNotes(keyArp(work.key), work.inst, 120);
  });

  // 작곡 의도
  const PROMPTS = ['어떤 장면이 떠올랐나요?', '어떤 기분을 표현했나요?', '왜 이 조성을 골랐나요?', '왜 이 악기를 골랐나요?', '가장 마음에 드는 부분은 어디인가요?', '누구에게 들려주고 싶나요?'];
  $('#prompts').innerHTML = PROMPTS.map(p => `<button type="button">${p}</button>`).join('');
  $('#prompts').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const ta = $('#inIntent');
    const add = (ta.value && !ta.value.endsWith('\n') ? '\n' : '') + `• ${b.textContent} `;
    if (ta.value.length + add.length > 500) { toast('500자를 넘을 수 없어요.'); return; }
    ta.value += add;
    ta.dispatchEvent(new Event('input'));
    ta.focus();
  });
  $('#btnIntent').addEventListener('click', () => openModal('#mIntent'));

  // ---------- 내기 ----------
  function renderChecklist() {
    const c = M.checks(work);
    const tonic = M.tonicSolfa(work.key);
    const items = [
      [c.req, '꼭 넣을 리듬 4마디가 들어 있어요', '꼭 넣을 리듬 4마디를 넣어야 해요'],
      [c.full === M.NM, `${M.NM}마디를 모두 ${MB()}박으로 채웠어요`, `${M.NM - c.full}마디를 더 채워야 해요 (${c.full}/${M.NM})`],
      [c.blanks === 0, '모든 음표에 음을 넣었어요', `회색 ? 음표 ${c.blanks}개에 음을 넣어야 해요`],
      [c.named, '제목·학번·이름을 썼어요', '제목·학번·이름을 모두 써야 해요'],
      [c.intent >= 10, `작곡 의도를 썼어요 (${c.intent}자)`, '작곡 의도를 10자 이상 써야 해요'],
    ];
    const ok = items.every(i => i[0]);
    $('#ckList').innerHTML = items.map(([pass, y, n]) => `<li class="${pass ? 'is-ok' : 'is-no'}"><span class="mark">${pass ? '✓' : '!'}</span>${pass ? y : n}</li>`).join('')
      + `<li class="is-tip"><span class="mark">★</span>${c.endsOnTonic ? `마지막 음이 '${tonic}'라서 끝난 느낌이 나요` : `추천: 마지막 음을 '${tonic}'로 끝내 보세요`}</li>`;
    $('#btnMp3').disabled = !ok;
    $('#btnPng').disabled = !ok;
    const left = items.filter(i => !i[0]).length;
    $('#submitNote').textContent = ok ? 'MP3 파일과 악보 그림을 모두 저장해서 선생님이 알려 준 곳에 올려요.' : `빨간 항목 ${left}개를 마치면 저장할 수 있어요.`;
  }
  $('#btnSubmit').addEventListener('click', () => { renderChecklist(); $('#saveProg').hidden = true; openModal('#mSubmit'); });

  async function saveMp3(suffix) {
    const prog = $('#saveProg'), fill = $('#saveFill'), text = $('#saveText');
    const btns = ['#btnMp3', '#btnPng', '#btnPractice'].map($);
    btns.forEach(b => b.disabled = true);
    prog.hidden = false;
    fill.style.width = '5%';
    text.textContent = '연주를 녹음하는 중…';
    try {
      const bs = beatSec();
      const ev = M.timeline(work).filter(x => x.p != null).map(x => ({ t: .3 + x.beat * bs, midi: x.p, dur: x.d * bs }));
      const buf = await Engine.renderOffline(ev, work.inst, .3 + M.NM * MB() * bs + 2.5);
      text.textContent = 'MP3로 바꾸는 중…';
      const blob = await Exporter.encodeMp3(buf, work, p => { fill.style.width = (10 + p * 90) + '%'; });
      const name = Exporter.baseName(work, suffix) + '.mp3';
      Exporter.download(blob, name);
      fill.style.width = '100%';
      text.textContent = `'${name}' 저장했어요!`;
      sfx('success');
      if (!suffix) confetti();
    } catch (e) {
      console.error(e);
      text.textContent = e && e.message ? e.message : '저장하지 못했어요. 다시 눌러 주세요.';
      sfx('oops');
    } finally {
      renderChecklist();
      $('#btnPractice').disabled = false;
    }
  }
  $('#btnMp3').addEventListener('click', () => saveMp3(''));
  $('#btnPractice').addEventListener('click', () => saveMp3('연습'));
  $('#btnPng').addEventListener('click', async () => {
    const prog = $('#saveProg'), fill = $('#saveFill'), text = $('#saveText');
    prog.hidden = false;
    fill.style.width = '40%';
    text.textContent = '악보 그림을 그리는 중…';
    $('#btnPng').disabled = true;
    try {
      const blob = await Exporter.renderSheetPng(work);
      const name = Exporter.baseName(work) + '.png';
      Exporter.download(blob, name);
      fill.style.width = '100%';
      text.textContent = `'${name}' 저장했어요!`;
      sfx('success');
    } catch (e) {
      console.error(e);
      text.textContent = e && e.message ? e.message : '그림을 저장하지 못했어요. 다시 눌러 주세요.';
      sfx('oops');
    } finally {
      renderChecklist();
    }
  });

  // 내가 저장한 MP3 를 불러와 이어 하기
  $('#btnLoad').addEventListener('click', () => $('#fileOne').click());
  $('#fileOne').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const w = await Exporter.readWorkFromMp3(f);
    if (!w) { toast('이 파일에는 악보 정보가 없어요. 이 페이지에서 저장한 MP3만 불러올 수 있어요.'); return; }
    if (!(await ask(`'${w.title || '나만의 가락'}'을(를) 불러오면 지금 악보가 바뀌어요. 불러올까요?`, '네, 불러올게요'))) return;
    snapshot();
    work = w;
    hist.length = 0;
    sel = { m: 0, k: work.ms[0].length ? 0 : null };
    persist();
    renderInfo();
    setInstrument(work.inst, false);
    refreshKeys();
    render();
    toast('불러왔어요. 이어서 만들어 봐요!');
  });

  // ---------- 감상실 ----------
  const gallery = [];
  let showI = 0, showInst = null;
  const workKey = w => `${w.num}|${w.name}|${w.title}`;
  function showItems() { return [{ work: clone(work), mine: true }, ...gallery]; }
  function renderShow() {
    const items = showItems();
    showI = Math.min(showI, items.length - 1);
    const w = items[showI].work;
    const inst = M.instById(showInst || w.inst);
    $('#sTitle').textContent = w.title || '나만의 가락';
    $('#sBy').innerHTML = `<span>지은이 ${esc(w.num)} ${esc(w.name)}</span><span class="tag">${M.key(w.key).name}</span><span class="tag">${inst.name}</span><span class="tag">♩ = ${w.bpm}</span>`;
    $('#sList').innerHTML = items.map((it, i) => `<button class="work-chip ${i === showI ? 'is-on' : ''}" data-i="${i}">${esc(it.work.title || '나만의 가락')}<small>${it.mine ? '지금 만드는 내 작품' : esc(`${it.work.num} ${it.work.name}`)}</small></button>`).join('');
    $('#sInst').innerHTML = M.INSTRUMENTS.map(i => `<button data-inst="${i.id}" class="${i.id === inst.id ? 'is-on' : ''}">${i.name}</button>`).join('');
    $('#sIntent').textContent = w.intent || '작곡가가 아직 이야기를 쓰지 않았어요.';
    renderScore($('#sScore'), w, { prefix: 's', editable: false, labels: true });
  }
  function showPlay() {
    const items = showItems();
    const w = clone(items[showI].work);
    w.inst = showInst || w.inst;
    loadInst(w.inst).then(() => {
      playWork(w, {
        root: $('#sScore'), prefix: 's', flash: false, btn: 'show',
        onStop: () => setPlayBtn($('#sPlay'), false, '감상하기'),
        onEnd: () => {
          sfx('applause');
          confetti();
          if ($('#sAuto').checked && showI + 1 < showItems().length) {
            setTimeout(() => { showI++; showInst = null; renderShow(); showPlay(); }, 2500);
          }
        },
      });
      setPlayBtn($('#sPlay'), true, '감상하기');
    });
  }
  $('#sPlay').dataset.icon = '#i-play';
  $('#btnShow').addEventListener('click', () => {
    stopPlay();
    showI = 0; showInst = null;
    $('#show').hidden = false;
    renderShow();
  });
  $('#sClose').addEventListener('click', () => { stopPlay(); $('#show').hidden = true; render(); });
  $('#sPlay').addEventListener('click', () => { if (player && player.o.btn === 'show') stopPlay(); else showPlay(); });
  $('#sList').addEventListener('click', e => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    stopPlay();
    showI = +b.dataset.i; showInst = null;
    renderShow();
  });
  $('#sInst').addEventListener('click', e => {
    const b = e.target.closest('[data-inst]');
    if (!b) return;
    const playing = player && player.o.btn === 'show';
    stopPlay();
    showInst = b.dataset.inst;
    renderShow();
    loadInst(showInst);
    if (playing) showPlay();
  });
  $('#sLoad').addEventListener('click', () => $('#fileMany').click());
  async function addFiles(files) {
    let added = 0, bad = 0;
    for (const f of files) {
      const w = await Exporter.readWorkFromMp3(f);
      if (!w) { bad++; continue; }
      const i = gallery.findIndex(g => workKey(g.work) === workKey(w));
      if (i >= 0) gallery[i] = { work: w }; else gallery.push({ work: w });
      added++;
    }
    renderShow();
    toast(added ? `작품 ${added}개를 불러왔어요.${bad ? ` (${bad}개는 악보 정보가 없어요)` : ''}` : '악보 정보가 있는 MP3를 찾지 못했어요.');
  }
  $('#fileMany').addEventListener('change', e => { const fs = [...e.target.files]; e.target.value = ''; addFiles(fs); });
  const show = $('#show');
  show.addEventListener('dragover', e => { e.preventDefault(); show.classList.add('is-drag'); });
  show.addEventListener('dragleave', e => { if (e.target === show) show.classList.remove('is-drag'); });
  show.addEventListener('drop', e => { e.preventDefault(); show.classList.remove('is-drag'); addFiles([...e.dataTransfer.files]); });

  // ---------- 작곡 도우미 (듣고 해 보는 체험) ----------
  const DEMOS = {
    major: [[60, 1], [64, 1], [67, 1], [72, 1], [71, .5], [69, .5], [67, 1], [64, 1], [60, 2]],
    minor: [[57, 1], [60, 1], [64, 1], [69, 1], [68, .5], [66, .5], [64, 1], [60, 1], [57, 2]],
    step: [[60, 1], [62, 1], [64, 1], [65, 1], [67, 2], [65, 1], [64, 1]],
    leap: [[60, 1], [67, 1], [64, 1], [72, 1], [67, 2], [60, 2]],
    endDo: [[64, 1], [65, 1], [62, 1], [71, 1], [60, 4]],
    endRe: [[64, 1], [65, 1], [62, 1], [71, 1], [62, 4]],
    repeat: [[60, 1], [62, 1], [64, 2], [60, 1], [62, 1], [64, 2], [65, 1], [64, 1], [62, 1], [60, 1]],
  };
  const demoBtn = (key, title, sub) => `<button class="demo" data-demo="${key}">${icon('play')}<span>${title}<small>${sub}</small></span></button>`;
  const PAGES = [
    { tab: '작곡이 뭐예요?', html: () => `<h3>작곡은 리듬과 가락을 엮는 일이에요</h3>
      <p><span class="eq">리듬(길고 짧음) + 가락(높고 낮음) = 나만의 노래</span></p>
      <p>이 페이지에서는 <b>16마디</b> 노래를 만들어요. 한 줄에 4마디씩, 모두 4줄이에요.</p>
      <p>꼭 들어가야 하는 <b>노란 칸 리듬</b>이 있어요. ⭐ 단추 하나로 지금 줄에 쏙 들어가요. 먼저 들어 봐요!</p>
      <div class="demo-row">${demoBtn('req', '꼭 넣을 리듬 듣기', M.reqFor(MB()).map(b => patWord(b)).join(' | '))}</div>` },
    { tab: '박자와 마디', html: () => `<h3>박자는 한 마디에 몇 박을 셀지 정해요</h3>
      <p>2/4박자는 한 마디에 2박, 3/4박자는 3박, 4/4박자는 4박이에요. <b>박자·빠르기</b> 단추에서 들어 보고 골라요.</p>
      <div class="demo-row">${M.METERS.map(m => `<button class="demo" data-meter-demo="${m}">${icon('play')}<span>${m}/4박자<small>${METER_INFO[m].feel}</small></span></button>`).join('')}</div>
      <p>리듬 카드의 박을 더해서 한 마디를 채워요. 예: <span class="eq">타(1) + 타(1) + 타-아(2) = 4박</span></p>
      <p>마디가 덜 차면 악보 위에 빨간 숫자(예: 3/4박)가 보여요. 어떤 리듬을 넣을지 모르겠으면 <b>리듬 추천</b>을 눌러 봐요.</p>
      <div class="demo-row">${CARDS.map((c, i) => `<button class="demo" data-card="${i}">${icon('play')}<span>${c.word}<small>${c.beat}</small></span></button>`).join('')}</div>` },
    { tab: '장조와 단조', html: () => `<h3>장조는 밝고, 단조는 슬프거나 신비로워요</h3>
      <p>같은 리듬이라도 조성에 따라 느낌이 달라져요. 두 가락을 비교해서 들어 봐요.</p>
      <div class="demo-row">${demoBtn('major', '장조 가락', '밝고 씩씩한 느낌 · 도로 끝나요')}${demoBtn('minor', '단조 가락', '슬프거나 신비로운 느낌 · 라로 끝나요')}</div>
      <p>위쪽 <b>조성 고르기</b>에서 마음에 드는 조성을 골라요. 음계 도우미를 켜면 그 조성에 어울리는 음판만 밝게 보이고, 으뜸음에는 별이 붙어요.</p>` },
    { tab: '가락 꿀팁', html: () => `<h3>가락을 멋지게 만드는 비법</h3>
      <p><b>차례가기와 뛰어가기:</b> 이웃 음으로 가면 부드럽고, 멀리 뛰면 신나요.</p>
      <div class="demo-row">${demoBtn('step', '차례가기', '도 레 미 파 솔')}${demoBtn('leap', '뛰어가기', '도 솔 미 높은 도')}</div>
      <p><b>반복:</b> 같은 가락을 한 번 더 쓰면 기억하기 쉬워요. '앞 줄 따라' 단추를 써 봐요.</p>
      <div class="demo-row">${demoBtn('repeat', '반복하는 가락', '도 레 미 | 도 레 미 | 파 미 레 도')}</div>
      <p><b>끝맺음:</b> 마지막 음을 으뜸음으로 끝내면 끝난 느낌이 나요.</p>
      <div class="demo-row">${demoBtn('endDo', '도로 끝나기', '끝났다! 하는 느낌')}${demoBtn('endRe', '레로 끝나기', '아직 안 끝난 느낌')}</div>` },
    { tab: '만드는 순서', html: () => `<h3>이렇게 만들어요</h3>
      <ol class="steps">
        <li>위쪽 탭에서 <b>악기</b>를, 단추에서 <b>장조·단조</b>와 <b>박자·빠르기</b>를 들어 보고 골라요.</li>
        <li>노란 칸의 <b>회색 음표</b>를 누르고 악기를 쳐서 음을 넣어요.</li>
        <li>빈 마디를 누르고 <b>리듬 추천</b>이나 <b>리듬 카드</b>를 고른 다음 악기를 치면 음표가 들어가요.</li>
        <li>무엇을 할지 모르겠으면 <b>도담이</b>를 눌러요. 눌러야 할 곳을 반짝이며 알려줘요.</li>
        <li>음표를 누르고 악기를 다시 치면 음이 바뀌어요. 틀리면 <b>되돌리기</b>를 눌러요.</li>
        <li><b>처음부터 듣기</b>로 감상하고, 마음에 안 드는 곳을 고쳐요.</li>
        <li>제목·학번·이름과 <b>작곡 의도</b>를 쓰고, 노란 <b>완성하고 내기</b> 단추로 MP3와 악보 그림을 저장해요.</li>
      </ol>` },
  ];
  let helpI = 0;
  function renderHelp() {
    $('#helpTabs').innerHTML = PAGES.map((p, i) => `<button role="tab" aria-selected="${i === helpI}" class="${i === helpI ? 'is-on' : ''}" data-i="${i}">${i + 1}. ${p.tab}</button>`).join('');
    $('#helpPage').innerHTML = PAGES[helpI].html();
    $('#helpPrev').disabled = helpI === 0;
    $('#helpNext').disabled = helpI === PAGES.length - 1;
  }
  $('#helpTabs').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) { helpI = +b.dataset.i; renderHelp(); } });
  $('#helpPrev').addEventListener('click', () => { helpI = Math.max(0, helpI - 1); renderHelp(); });
  $('#helpNext').addEventListener('click', () => { helpI = Math.min(PAGES.length - 1, helpI + 1); renderHelp(); });
  $('#helpPage').addEventListener('click', e => {
    const b = e.target.closest('.demo');
    if (!b) return;
    $$('.demo.is-playing').forEach(x => x.classList.remove('is-playing'));
    b.classList.add('is-playing');
    const notes = b.dataset.card != null ? [[60, CARDS[+b.dataset.card].d]]
      : b.dataset.meterDemo ? meterPattern(+b.dataset.meterDemo)
      : b.dataset.demo === 'req' ? reqDemo() : DEMOS[b.dataset.demo];
    const bpm = b.dataset.demo === 'req' || b.dataset.meterDemo ? work.bpm : 100;
    const total = notes.reduce((a, n) => a + n[1], 0);
    playNotes(notes, work.inst, bpm);
    setTimeout(() => b.classList.remove('is-playing'), total * 60000 / bpm + 400);
  });
  $('#btnHelp').addEventListener('click', () => { renderHelp(); openModal('#mHelp'); });
  $('#mHelp').addEventListener('closed', () => { try { localStorage.setItem(HELP_SEEN, '1'); } catch (e) {} });

  // ---------- 기타 ----------
  $('#vol').addEventListener('input', e => Engine.setVolume(e.target.value / 100));
  const full = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
  $('#btnFull').addEventListener('click', full);
  $('#sFull').addEventListener('click', full);

  // 악기 크게 보기: 악기를 넓게 펴고, 악보는 지금 줄만 보여 준다 (가능하면 전체 화면까지)
  let instFull = false;
  function setInstFull(on) {
    instFull = on;
    document.body.classList.toggle('is-inst-full', on);
    const b = $('#btnInstFull');
    b.setAttribute('aria-pressed', on);
    b.querySelector('use').setAttribute('href', on ? '#i-shrink' : '#i-full');
    b.querySelector('span').textContent = on ? '작게 보기' : '크게 보기';
    if (on && !document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    requestAnimationFrame(() => { syncHeight(); scrollLineIntoView(scoreBox, sel.m); });
    if (on) say('악기를 크게 펼쳤어요. 악보는 지금 만드는 줄만 보여요.');
  }
  $('#btnInstFull').addEventListener('click', () => setInstFull(!instFull));
  // 브라우저 전체 화면을 Esc 로 빠져나오면 크게 보기도 같이 끈다
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && instFull) setInstFull(false); });
  // 첫 터치에서 오디오를 깨운다 (학교 태블릿 자동재생 정책)
  document.addEventListener('pointerdown', () => { try { Engine.ensure(); } catch (e) {} }, { once: true });

  // ---------- 시작 ----------
  renderCards();
  renderBeatDots();
  renderInfo();
  setInstrument(work.inst, false);
  render();
  let seen = false;
  try { seen = !!localStorage.getItem(HELP_SEEN); } catch (e) {}
  if (!seen) { renderHelp(); openModal('#mHelp'); }
})();
