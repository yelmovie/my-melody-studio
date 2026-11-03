// 사용방법 보기: 손가락이 진짜 화면을 눌러 가며 만드는 순서를 보여 주는 자동 시연
// 쓰는 법: Tour.start() / Tour.start({ record: true }) (영상 녹화용) / Tour.stop()
// 시연 중에는 App.useTempWork 로 연습 악보를 쓰고, 끝나거나 건너뛰면 App.restoreWork 로 학생 작품을 돌려놓는다
(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  // ---------- 시간 (ms) ----------
  const MOVE = 400;      // 손가락이 다음 곳으로 가는 시간
  const FAST_MOVE = 150; // 빠르게 채울 때 이동 시간
  const TAP = 300;       // 누르기 + 물결
  const READ = 1200;     // 문장을 다 쓴 뒤 읽을 시간
  const HOLD = 900;      // 가리키기만 할 때 머무는 시간
  const TYPE = 40;       // 한 글자 쓰는 시간

  // 실로폰 흰 음판(아래 줄) 순서: 낮은 솔 라 시 | 도 레 미 파 솔 라 시 | 높은 도 …
  const BAR = { 솔_: 0, 라_: 1, 시_: 2, 도: 3, 레: 4, 미: 5, 파: 6, 솔: 7, 라: 8, 시: 9, 도2: 10 };

  // 손가락 그림 (끝: 26,3)
  const HAND_SVG = `<svg class="tour-finger__hand" viewBox="0 0 70 80" aria-hidden="true">
    <path d="M20 30V9a6 6 0 0 1 12 0v22a5.5 5.5 0 0 1 11 0v2a5.5 5.5 0 0 1 11 0v3a5 5 0 0 1 10 0v16c0 14-10 24-24 24h-4c-9 0-14-4-18-11L6 50a5.5 5.5 0 0 1 8-7.5L20 48z"
      fill="#fff" stroke="#6741d9" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M32 31v8M43 33v7M54 36v6" fill="none" stroke="#6741d9" stroke-width="3" stroke-linecap="round"/>
    <path d="M22.5 8.5a3.5 3.5 0 0 1 7 0" fill="none" stroke="#c5b5ff" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`;
  const HAND_W = 56, HAND_H = 64, TIP_X = 26 * 0.8, TIP_Y = 3 * 0.8;

  let runId = 0, active = null;   // active: 지금 시연의 화면 요소·상태
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  class Abort extends Error {}
  const check = id => { if (id !== runId || !active) throw new Abort('tour stopped'); };
  const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));

  // ---------- 보이는지 ----------
  function shown(el) {
    if (!el || !el.isConnected || !el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }
  function inView(el) {
    const r = el.getBoundingClientRect(), m = 6;
    if (r.top < m || r.left < m || r.bottom > innerHeight - m || r.right > innerWidth - m) return false;
    // 악보 칸·악기 탭처럼 안쪽에서 스크롤되는 곳 안에서도 보여야 한다
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (!/(auto|scroll|hidden)/.test(cs.overflow + cs.overflowX + cs.overflowY)) continue;
      const q = p.getBoundingClientRect();
      if (r.top < q.top - 1 || r.bottom > q.bottom + 1 || r.left < q.left - 1 || r.right > q.right + 1) return false;
    }
    return true;
  }
  function bringIntoView(el) {
    if (inView(el)) return;
    try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); }
    catch (e) { el.scrollIntoView({ block: 'center', inline: 'nearest' }); }
  }

  // ---------- 화면 요소 만들기 ----------
  function build(record) {
    const root = document.createElement('div');
    root.className = 'tour' + (record ? ' tour--record' : '');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '사용방법 보기');
    root.innerHTML = `
      <div class="tour-ring" aria-hidden="true"></div>
      <div class="tour-ripple" aria-hidden="true"></div>
      <div class="tour-finger" aria-hidden="true"><div class="tour-finger__flip">${HAND_SVG}</div></div>
      <div class="tour-caption" aria-hidden="true">
        <span class="tour-caption__num"></span>
        <span class="tour-caption__text"><span class="tour-caption__ghost"></span><span class="tour-caption__typed"></span></span>
      </div>
      <p class="tour-live" aria-live="polite"></p>
      <div class="tour-ctrl">
        <span class="tour-count" aria-label=""></span>
        ${record ? '' : '<button type="button" class="tour-skip">건너뛰기 <span aria-hidden="true">✕</span></button>'}
      </div>`;
    document.body.appendChild(root);
    const q = s => root.querySelector(s);
    return {
      root, ring: q('.tour-ring'), ripple: q('.tour-ripple'), finger: q('.tour-finger'), flip: q('.tour-finger__flip'),
      caption: q('.tour-caption'), num: q('.tour-caption__num'), ghost: q('.tour-caption__ghost'), typed: q('.tour-caption__typed'),
      live: q('.tour-live'), ctrl: q('.tour-ctrl'), count: q('.tour-count'), skip: q('.tour-skip'),
    };
  }

  // ---------- 손가락·테두리 ----------
  const fingerAt = { x: innerWidth / 2, y: innerHeight / 2 };
  function placeFinger(x, y, dur) {
    const a = active;
    if (!a) return;
    const vw = innerWidth, vh = innerHeight;
    x = Math.max(4, Math.min(vw - 4, x));
    y = Math.max(4, Math.min(vh - 4, y));
    // 손이 화면 밖으로 나가면 뒤집어서 위·왼쪽에서 가리킨다
    const flipY = y + HAND_H - TIP_Y > vh - 4;
    const flipX = x + HAND_W - TIP_X > vw - 4;
    const hx = flipX ? HAND_W - TIP_X : TIP_X, hy = flipY ? HAND_H - TIP_Y : TIP_Y;
    a.ui.flip.style.transform = `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`;
    a.ui.finger.style.transitionDuration = dur + 'ms';
    a.ui.finger.style.transform = `translate(${Math.round(x - hx)}px, ${Math.round(y - hy)}px)`;
    a.ui.finger.classList.add('is-on');
    fingerAt.x = x; fingerAt.y = y;
  }
  function ringRect(el) {
    const r = el.getBoundingClientRect(), pad = 6;
    return { left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2, right: r.right + pad, bottom: r.bottom + pad };
  }
  function placeRing(el) {
    const a = active;
    if (!a) return;
    const r = ringRect(el);
    Object.assign(a.ui.ring.style, { width: r.width + 'px', height: r.height + 'px', transform: `translate(${Math.round(r.left)}px, ${Math.round(r.top)}px)` });
    a.ui.ring.classList.add('is-on');
    a.ui.root.classList.add('has-ring');
    dodge(r);
  }
  const M = 14;   // 겹침 판정 여유
  const overlaps = (a, b) => a.left - M < b.right && a.right + M > b.left && a.top - M < b.bottom && a.bottom + M > b.top;
  const area = (a, b) => Math.max(0, Math.min(a.right + M, b.right) - Math.max(a.left - M, b.left)) * Math.max(0, Math.min(a.bottom + M, b.bottom) - Math.max(a.top - M, b.top));
  // 글자 띠와 건너뛰기 단추가 가리키는 곳을 덮지 않게 자리를 옮긴다
  function dodge(r) {
    const a = active;
    if (!a) return;
    r = r || a.lastRing;
    if (!r) return;
    a.lastRing = r;
    const tip = { left: fingerAt.x - HAND_W, right: fingerAt.x + HAND_W, top: fingerAt.y - HAND_H, bottom: fingerAt.y + HAND_H };
    // 아래·위 중 덜 가리는 쪽 (둘 다 괜찮으면 아래)
    const cap = a.ui.caption;
    const cost = () => { const cr = cap.getBoundingClientRect(); return area(cr, r) + area(cr, tip); };
    cap.classList.remove('is-top');
    const below = cost();
    if (below > 0) {
      cap.classList.add('is-top');
      if (cost() >= below) cap.classList.remove('is-top');
    }
    const ctrl = a.ui.ctrl;
    ctrl.classList.remove('is-left');
    const tr = ctrl.getBoundingClientRect();
    if (overlaps(tr, r) || overlaps(tr, tip)) ctrl.classList.add('is-left');
  }
  function clearRing() {
    const a = active;
    if (!a) return;
    a.ui.ring.classList.remove('is-on');
    a.ui.root.classList.remove('has-ring');
  }

  // ---------- 글자 띠 (한 글자씩) ----------
  function caption(n, total, text) {
    const a = active;
    clearInterval(a.typeT);
    a.ui.num.textContent = n;
    a.ui.count.textContent = `${n} / ${total}`;
    a.ui.count.setAttribute('aria-label', `${total}단계 중 ${n}단계`);
    a.ui.caption.setAttribute('aria-label', text);
    a.ui.ghost.textContent = text;
    a.ui.live.textContent = text;
    a.ui.caption.classList.add('is-on');
    dodge();   // 글자 띠 너비가 바뀌었으니 다시 자리 확인
    const chars = Array.from(text);
    if (reduced()) { a.ui.typed.textContent = text; return Promise.resolve(); }
    let i = 0;
    a.ui.typed.textContent = '';
    return new Promise(res => {
      a.typeT = setInterval(() => {
        if (!active) { res(); return; }
        a.ui.typed.textContent = chars.slice(0, ++i).join('');
        if (i >= chars.length) { clearInterval(a.typeT); res(); }
      }, TYPE);
    });
  }

  // ---------- 진짜 누르기 ----------
  function press(el, kind) {
    const opt = { bubbles: true, cancelable: true, composed: true, clientX: fingerAt.x, clientY: fingerAt.y, button: 0, buttons: 1 };
    const down = typeof PointerEvent === 'function'
      ? new PointerEvent('pointerdown', Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, opt))
      : new MouseEvent('pointerdown', opt);
    el.dispatchEvent(down);
    if (kind === 'bar') return;                       // 음판·건반은 pointerdown 으로 소리를 낸다
    if (kind === 'svg') el.dispatchEvent(new MouseEvent('click', Object.assign({}, opt, { buttons: 0 })));  // 악보는 #scoreBox 에서 click 을 받는다
    else el.click();
  }

  // 손가락을 el 로 옮기고(tap 이면 눌러서 진짜 동작까지). 안 보이면 false
  // get: 요소를 찾는 함수. 앱이 단추를 다시 그려도(악기 탭 불러오기 % 등) 누르기 직전에 다시 찾는다
  async function go(id, get, o = {}) {
    check(id);
    let el = get();
    if (!shown(el)) return false;
    const a = active;
    bringIntoView(el);
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height * (o.kind === 'bar' ? 0.62 : 0.5);
    const move = reduced() ? 0 : Math.round((o.fast ? FAST_MOVE : MOVE) * a.pace);
    placeFinger(x, y, move);
    placeRing(el);
    a.cur = el;
    await sleep(move + (reduced() ? 60 : 30));
    check(id);
    if (!o.tap) { await sleep((o.hold ?? HOLD) * a.pace); check(id); return true; }
    if (!el.isConnected) { el = get(); if (!shown(el)) return false; }
    tapFx(x, y);
    press(el, o.kind);
    await sleep((o.after ?? TAP) * a.pace);
    check(id);
    return true;
  }
  function tapFx(x, y) {
    const a = active;
    const hand = a.ui.finger.querySelector('.tour-finger__hand');
    hand.classList.remove('is-tap');
    void hand.getBoundingClientRect();
    hand.classList.add('is-tap');
    if (reduced()) return;
    const rp = a.ui.ripple;
    rp.style.left = x + 'px';
    rp.style.top = y + 'px';
    rp.classList.remove('is-on');
    void rp.offsetWidth;
    rp.classList.add('is-on');
  }

  // ---------- 찾기 ----------
  const whiteBars = () => $$('#stage .bar:not(.bar--black), #stage .key--white');
  const bar = name => whiteBars()[BAR[name]] || null;
  const card = word => $$('#cards .rcard').find(b => (b.querySelector('.rcard__word') || {}).textContent === word) || null;
  const work = () => (window.App && App.getWork ? App.getWork() : null);
  const blanksIn = (from, to) => {
    const w = work();
    if (!w) return 0;
    let c = 0;
    for (let m = from; m <= to; m++) c += w.ms[m].filter(n => !n.r && n.p == null).length;
    return c;
  };
  const measFull = m => { const w = work(); return !!w && w.ms[m].reduce((s, n) => s + n.d, 0) >= Music.meterOf(w); };

  // 고른 칸부터 빈 음표를 차례로 채운다 (tune 을 돌려 쓰며)
  async function fillBlanks(id, from, to, tune, o = {}) {
    let i = 0, guard = 0;
    while (blanksIn(from, to) > 0 && guard++ < 24) {
      if (o.max != null && i >= o.max) break;
      const name = tune[i % tune.length];
      if (!(await go(id, () => bar(name), { tap: true, kind: 'bar', fast: o.fast, after: o.gap }))) return;
      i++;
    }
  }

  // ---------- 단계 ----------
  const STEPS = [
    { text: '또롱이와 함께 노래를 만들어 봐요!', main: () => $('#mascot'),
      run: async id => { await go(id, () => $('#mascot'), { hold: 1500 }); } },

    { text: '위에서 악기를 골라요', main: () => $('#instTabs'),
      run: async id => {
        await go(id, () => $('#instTabs'), { hold: 600 });
        await go(id, () => $('#instTabs [data-inst="piano"]'), { tap: true, after: 1100 });
        await go(id, () => $('#instTabs [data-inst="xylophone"]'), { tap: true, after: 900 });
      } },

    { text: '장조·단조와 박자도 들어 보고 골라요', main: () => $('#btnKey'),
      run: async id => {
        await go(id, () => $('#btnKey'));
        await go(id, () => $('#btnBeat'));
      } },

    { text: '⭐ 칸은 꼭 넣을 리듬이에요', main: () => $('#emb0'),
      run: async id => { await go(id, () => $('#emb0'), { hold: 1300 }); } },

    { text: '회색 음표를 누르고 실로폰을 쳐요', main: () => $('#en0_0'),
      run: async id => {
        await go(id, () => $('#en0_0'), { tap: true, kind: 'svg', after: 500 });
        await fillBlanks(id, 0, 0, ['도', '레', '미', '파'], { gap: 450, max: 4 });
      } },

    { text: '나머지 칸도 차례로 채워요', main: () => bar('도'),
      run: async id => {
        await fillBlanks(id, 0, 3, ['솔', '미', '솔', '라', '솔', '파', '미', '레', '미', '레', '도'], { fast: true, gap: 180 });
      } },

    { text: '빈 마디는 리듬 추천을 눌러요', main: () => $('#emb4'),
      run: async id => {
        if (!(await go(id, () => $('#emb4'), { tap: true, kind: 'svg', after: 600 }))) return;
        if (!(await go(id, () => $('#rec [data-rec="0"]'), { tap: true, after: 900 }))) return;
        await fillBlanks(id, 4, 4, ['미', '파', '솔', '미'], { gap: 380 });
      } },

    { text: '리듬 카드를 고르고 실로폰을 쳐요', main: () => $('#emb5'),
      run: async id => {
        if (!(await go(id, () => $('#emb5'), { tap: true, kind: 'svg', after: 500 }))) return;
        if (!(await go(id, () => card('타-아'), { tap: true, after: 700 }))) return;
        await go(id, () => bar('라'), { tap: true, kind: 'bar', after: 600 });
        if (measFull(5)) return;
        if (!(await go(id, () => card('타'), { tap: true, after: 600 }))) return;
        const tune = ['솔', '파', '미', '레'];
        for (let i = 0; i < 4 && !measFull(5); i++) await go(id, () => bar(tune[i]), { tap: true, kind: 'bar', after: 420 });
      } },

    { text: '음표를 누르고 높게·낮게로 고쳐요', main: () => $('#en0_1'),
      run: async id => {
        if (!(await go(id, () => $('#en0_1'), { tap: true, kind: 'svg', after: 700 }))) return;
        await go(id, () => $('#btnUp'), { tap: true, after: 800 });
      } },

    { text: '이 줄만 들어 보며 고쳐요', main: () => $('#btnPlayLine'),
      run: async id => {
        if (!(await go(id, () => $('#btnPlayLine'), { tap: true, after: 4000 }))) return;
        const b = $('#btnPlayLine');
        if (b.classList.contains('is-playing')) await go(id, () => b, { tap: true, after: 400 });
      } },

    { text: '가사와 제목도 써 봐요', main: () => $('#btnLyrics'),
      run: async id => {
        await go(id, () => $('#btnLyrics'));
        await go(id, () => $('#inTitle'));
      } },

    { text: '다 만들면 완성하고 내기!', main: () => $('#btnSubmit'),
      run: async id => {
        await go(id, () => $('#btnSubmit'));
        await go(id, () => $('#btnDown'));
      } },

    { text: '막히면 또롱이 힌트를 눌러요!', main: () => $('#mascot'),
      run: async id => { await go(id, () => $('#mascot'), { hold: 1400 }); } },
  ];

  // ---------- 막기: 진짜 손·키보드 입력 ----------
  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); e.stopImmediatePropagation(); stop(); return; }
    // 건너뛰기 단추에서 Enter·Space·Tab 은 그대로 둔다
    if (active.ui.skip && e.target === active.ui.skip && /^(Enter| |Tab)$/.test(e.key)) { e.stopPropagation(); return; }
    if (e.key === 'Tab') { e.preventDefault(); active.ui.skip && active.ui.skip.focus({ preventScroll: true }); }
    else e.preventDefault();
    e.stopImmediatePropagation();
  }
  const block = e => { if (e.cancelable) e.preventDefault(); };
  let rafRe = 0;
  function onReflow() {
    if (!active) return;
    cancelAnimationFrame(rafRe);
    rafRe = requestAnimationFrame(() => {
      const a = active;
      if (!a || !a.cur || !shown(a.cur)) return;
      const r = a.cur.getBoundingClientRect();
      placeFinger(r.left + r.width / 2, r.top + r.height / 2, 0);
      placeRing(a.cur);
    });
  }

  // ---------- 시작·끝 ----------
  async function start(opts = {}) {
    if (active) stop();
    if (!window.App || !window.Music) return;
    const id = ++runId;
    const record = !!opts.record;
    window.__tourDone = false;
    const ui = build(record);
    active = { ui, record, pace: record ? 1.3 : 1, cur: null, typeT: 0, focus: document.activeElement, sx: scrollX, sy: scrollY };
    if (ui.skip) ui.skip.addEventListener('click', e => { e.stopPropagation(); stop(); });
    ui.root.addEventListener('wheel', block, { passive: false });
    ui.root.addEventListener('touchmove', block, { passive: false });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);

    let finished = false;
    try {
      App.stop && App.stop();
      // 크게 보기면 원래 화면으로 (가릴 곳이 많아서)
      if (document.body.classList.contains('is-inst-full') && shown($('#btnInstFull'))) $('#btnInstFull').click();
      App.useTempWork(Music.newWork(4));
      // '악보에 넣기'가 꺼져 있으면 시연 동안만 켠다
      const inputBtn = $('#btnInput');
      if (inputBtn && inputBtn.getAttribute('aria-pressed') === 'false') { inputBtn.click(); active.inputWasOff = true; }
      if (ui.skip) ui.skip.focus({ preventScroll: true });
      else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

      requestAnimationFrame(() => ui.root.classList.add('is-in'));
      placeFinger(innerWidth / 2, innerHeight / 2, 0);
      await sleep(250);

      for (let i = 0; i < STEPS.length; i++) {
        check(id);
        const st = STEPS[i];
        const main = st.main();
        if (!shown(main)) continue;           // 좁은 화면·크게 보기에서 안 보이면 조용히 건너뛴다
        const typed = caption(i + 1, STEPS.length, st.text);
        try { await st.run(id); }
        catch (e) { if (e instanceof Abort) throw e; console.warn('[tour] step', i + 1, e); }
        check(id);
        await typed;
        await sleep(READ * active.pace);
      }
      check(id);
      finished = true;
      // 끝: 천천히 사라진다
      clearRing();
      ui.root.classList.remove('is-in');
      await sleep(reduced() ? 0 : 450);
    } catch (e) {
      if (!(e instanceof Abort)) console.warn('[tour]', e);
    } finally {
      if (id === runId && active && active.ui === ui) {
        cleanup();
        if (finished && record) window.__tourDone = true;
      }
    }
  }

  function cleanup() {
    const a = active;
    if (!a) return;
    active = null;
    clearInterval(a.typeT);
    cancelAnimationFrame(rafRe);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onReflow);
    window.removeEventListener('scroll', onReflow, true);
    a.ui.root.remove();
    try {
      if (a.inputWasOff) { const b = $('#btnInput'); b && b.getAttribute('aria-pressed') === 'true' && b.click(); }
    } catch (e) {}
    try { App.restoreWork(); } catch (e) { console.warn('[tour] restore', e); }
    try { a.focus && a.focus.focus && a.focus.focus({ preventScroll: true }); } catch (e) {}
    try { window.scrollTo(a.sx, a.sy); } catch (e) {}   // 시연 전 스크롤 자리로
  }

  function stop() {
    if (!active) return;
    runId++;
    cleanup();
  }

  window.Tour = {
    start,
    stop,
    get running() { return !!active; },
  };
})();
