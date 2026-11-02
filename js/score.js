// 악보 그리기: 한 줄(4마디)을 SVG 문자열로 만든다. window.Music 이 먼저 로드되어 있어야 한다.
// PNG 저장(SVG → 이미지)에서도 똑같이 보이도록 모든 모양은 인라인 속성으로 지정하고,
// class 는 화면 강조(CSS)용 손잡이로만 붙인다.
window.Score = (() => {
  const M = window.Music;

  // ── 기본 치수 ──────────────────────────────────────────
  const VIEW = { w: 1000, h: 160 };
  const TOP = 46, SP = 12;            // 오선 맨 윗줄 y, 줄 간격
  const BOT = TOP + 4 * SP;           // 맨 아랫줄(미, E4) y = 94
  const MID = TOP + 2 * SP;           // 가운뎃줄(시, B4) y = 70
  const STAFF_L = 8, STAFF_R = 988;   // 오선 좌우 끝
  const NOTE_PAD_L = 26, NOTE_PAD_SUM = 44;   // 마디 안 음표 여백(왼쪽, 좌우 합)
  const STEM = 34, STEM_DX = 6.6, BEAM_T = 5;
  const LABEL_Y = 150;

  // ── 글꼴·색 ────────────────────────────────────────────
  const MUSIC_FONT = "'Noto Music','Segoe UI Symbol','Apple Symbols',serif";
  const LABEL_FONT = "'Jua','Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',sans-serif";
  const UI_FONT = LABEL_FONT;
  const INK = '#222', GHOST = '#b9b9c6', LINE = '#555';
  const YELLOW_TEXT = '#d4a106';      // 연노랑(미) 글자는 잘 안 보여서 진하게

  // ── 글리프 위치(눈으로 맞춰 볼 값) ─────────────────────
  // Noto Music(웹폰트)을 canvas measureText 로 실측해 맞춘 값이다. 다른 글꼴로 대체되면 몇 px 어긋날 수 있다.
  const CLEF = { ch: '\u{1D11E}', x: 12, y: TOP + 3 * SP, size: 48 };
  // 조표·임시표 dy: 기호의 '자리'가 줄/칸 중심에 오도록 기준선을 머리 y 에서 얼마나 내릴지
  const KEYSIG = { x: 54, w: 20, size: 24, dy: { '♯': 3, '♭': 2 } };
  const TIMESIG_W = 40;
  const CLEF_W = 60;
  let meterNow = 4;   // 지금 그리는 작품의 한 마디 박 수 (renderLine 에서 정한다)
  const ACC = { dx: -19, size: 20, dy: { '♯': 3, '♮': 3, '♭': 1 } };
  const REST_SIZE = 48;
  const RESTS = {                                      // y: 쉼표 글자의 기준선 y
    4:   { ch: '\u{1D13B}', y: TOP + SP + 25 },        // 온쉼표: 넷째 줄(58)에 매달림 (글자 58~65)
    3:   { ch: '\u{1D13C}', y: MID + 11, dot: true },  // 점2분쉼표
    2:   { ch: '\u{1D13C}', y: MID + 11 },             // 2분쉼표: 가운뎃줄(70) 위에 얹힘 (글자 62~70)
    1.5: { ch: '\u{1D13D}', y: MID + 24, dot: true },  // 점4분쉼표
    1:   { ch: '\u{1D13D}', y: MID + 24 },             // 4분쉼표: 오선 가운데 (글자 52~89)
    0.5: { ch: '\u{1D13E}', y: MID + 24 },             // 8분쉼표: 오선 가운데 (글자 59~81)
  };

  const E4_STEP = M.staffStep(64, 'C');
  const B4_STEP = E4_STEP + 4;

  // ── 작은 도우미 ────────────────────────────────────────
  // 속성은 항상 큰따옴표로 감싸므로 작은따옴표(글꼴 이름)는 그대로 둔다
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const r1 = v => Math.round(v * 10) / 10;
  const attrs = o => Object.keys(o).filter(k => o[k] != null).map(k => ` ${k}="${esc(typeof o[k] === 'number' ? r1(o[k]) : o[k])}"`).join('');
  const tag = (name, o, inner) => (inner == null ? `<${name}${attrs(o)}/>` : `<${name}${attrs(o)}>${inner}</${name}>`);
  const text = (str, o) => tag('text', o, esc(str));
  const line = (x1, y1, x2, y2, stroke, w, cls) => tag('line', { class: cls, x1, y1, x2, y2, stroke, 'stroke-width': w });

  const stepY = step => BOT - (step - E4_STEP) * 6;
  const onLine = step => (step - E4_STEP) % 2 === 0;
  const isEighthNote = n => n && n.d === 0.5 && !n.r;

  function labelColor(midi) {
    const p = M.pc(midi), c = M.COLOR_BY_PC[p];
    if (!c) return M.SHARP_COLOR;
    return c === '#ffd43b' ? YELLOW_TEXT : c;
  }

  function fmtBeats(b) {
    const whole = Math.floor(b), half = b - whole >= 0.5;
    return (whole || !half ? String(whole) : '') + (half ? '½' : '');
  }

  // ── 줄 배치 ────────────────────────────────────────────
  function layout(keyId, L) {
    const hasSig = M.key(keyId).sig.length > 0;
    const left = CLEF_W + (hasSig ? KEYSIG.w : 0) + (L === 0 ? TIMESIG_W : 0);
    const mw = (STAFF_R - left) / 4;
    return { left, mw, hasSig, mx: i => left + i * mw };
  }
  const noteX = (mx, mw, off) => mx + NOTE_PAD_L + off * (mw - NOTE_PAD_SUM) / meterNow;

  // ── 줄 머리: 오선, 높은음자리표, 조표, 박자표 ──────────
  function staffSvg() {
    let s = '';
    for (let i = 0; i < 5; i++) s += line(STAFF_L, TOP + i * SP, STAFF_R, TOP + i * SP, LINE, 1.2, 'sl');
    return s + line(STAFF_L, TOP, STAFF_L, BOT, LINE, 1.4, 'bl');
  }

  function clefSvg() {
    return text(CLEF.ch, { class: 'clef', x: CLEF.x, y: CLEF.y, 'font-family': MUSIC_FONT, 'font-size': CLEF.size, fill: INK });
  }

  function keySigSvg(keyId) {
    const k = M.key(keyId);
    if (!k.sig.length) return '';
    const sharp = k.acc === '#';
    const ch = sharp ? '♯' : '♭';
    const y = (sharp ? TOP : MID) + KEYSIG.dy[ch];  // ♯: 파(F5) 맨 윗줄, ♭: 시(B4) 가운뎃줄
    return text(ch, { class: 'ks', x: KEYSIG.x, y, 'font-family': MUSIC_FONT, 'font-size': KEYSIG.size, fill: INK });
  }

  function timeSigSvg(x) {
    const o = { class: 'ts', x, 'text-anchor': 'middle', 'font-family': 'Georgia,serif', 'font-weight': 'bold', 'font-size': 28, fill: INK };
    return text(String(meterNow), Object.assign({}, o, { y: TOP + 2 * SP - 2 })) + text('4', Object.assign({}, o, { y: TOP + 4 * SP - 2 }));
  }

  // ── 마디 바탕·장식 ─────────────────────────────────────
  function measureBgSvg(m, x, w, fill, prefix) {
    return tag('rect', { id: `${prefix}mb${m}`, class: 'mb', 'data-m': m, x: x + 2, y: 6, width: w - 4, height: 150, rx: 10, fill });
  }

  function barlineSvg(m, xEnd) {
    if (m !== M.NM - 1) return line(xEnd, TOP, xEnd, BOT, LINE, 1.4, 'bl');
    return line(xEnd - 7, TOP, xEnd - 7, BOT, LINE, 1.4, 'bl')
      + tag('rect', { class: 'bl', x: xEnd - 4, y: TOP, width: 4, height: 4 * SP, fill: LINE });
  }

  function measureDecorSvg(m, mx, mw, info) {
    const meas = info.meas, b = M.beats(meas);
    let s = text(String(m + 1), { class: 'mn', x: mx + 8, y: 24, 'font-family': UI_FONT, 'font-size': 11, fill: '#999' });
    if (info.reqStart) {
      s += text('⭐ 꼭 넣을 리듬', { class: 'req', x: mx + 24, y: 24, 'font-family': UI_FONT, 'font-size': 12, 'font-weight': 'bold', fill: '#e67700' });
    }
    if (info.editable && b > 0 && b < meterNow) {
      s += text(`${fmtBeats(b)}/${meterNow}박`, { class: 'cnt', x: mx + mw - 8, y: 24, 'text-anchor': 'end', 'font-family': UI_FONT, 'font-size': 12, 'font-weight': 'bold', fill: '#f03e3e' });
    }
    if (info.editable && meas.length === 0 && !info.cursorHere) {
      s += text('+ 눌러서 채우기', { class: 'hint', x: mx + mw / 2, y: MID + 5, 'text-anchor': 'middle', 'font-family': UI_FONT, 'font-size': 13, fill: '#c5c5d6' });
    }
    return s + barlineSvg(m, mx + mw);
  }

  // ── 음표 위치 계산 ─────────────────────────────────────
  function placeNotes(meas, keyId, mx, mw) {
    let off = 0;
    return meas.map((n, k) => {
      const ev = { n, k, off, x: noteX(mx, mw, off) };
      off += n.d;
      if (!n.r) {
        ev.ghost = n.p == null;
        ev.step = ev.ghost ? B4_STEP : M.staffStep(n.p, keyId);
        ev.y = stepY(ev.step);
        ev.color = ev.ghost ? GHOST : INK;
        // 화음: 같은 기둥에 머리를 여러 개. 아래에서 위로 정렬
        const pitches = ev.ghost ? [] : [n.p, ...(n.c || [])].sort((a, b) => a - b);
        ev.heads = ev.ghost ? [{ step: ev.step, y: ev.y, p: null }] : pitches.map(p => { const st = M.staffStep(p, keyId); return { step: st, y: stepY(st), p }; });
        // 바로 옆 칸(2도)으로 붙은 머리는 겹치지 않게 오른쪽으로 비켜 놓는다
        ev.heads.forEach((h, i) => { const prev = ev.heads[i - 1]; h.dx = prev && !prev.dx && h.step - prev.step === 1 ? 13 : 0; });
        ev.minStep = ev.heads[0].step;
        ev.maxStep = ev.heads[ev.heads.length - 1].step;
        ev.yTop = stepY(ev.maxStep);
        ev.yBot = stepY(ev.minStep);
        ev.up = !ev.ghost && (ev.minStep + ev.maxStep) / 2 < B4_STEP;
      }
      return ev;
    });
  }

  // 정박에서 시작하는 8분음표 두 개는 꼬리를 이어 준다(빔). 방향은 두 음의 평균 높이로.
  function applyBeams(evs) {
    const beams = [];
    for (let i = 0; i + 1 < evs.length; i++) {
      const a = evs[i], b = evs[i + 1];
      if (!isEighthNote(a.n) || !isEighthNote(b.n) || a.off % 1 !== 0) continue;
      const up = (a.minStep + a.maxStep + b.minStep + b.maxStep) / 4 < B4_STEP;
      const end = up ? Math.min(a.yTop, b.yTop) - STEM : Math.max(a.yBot, b.yBot) + STEM;
      a.up = b.up = up;
      a.stemEnd = b.stemEnd = end;
      a.beamed = b.beamed = true;
      beams.push({ a, b, up, end, color: a.ghost && b.ghost ? GHOST : INK });
      i++;
    }
    return beams;
  }

  function beamSvg(bm) {
    const x1 = bm.a.x + (bm.up ? STEM_DX : -STEM_DX), x2 = bm.b.x + (bm.up ? STEM_DX : -STEM_DX);
    return tag('rect', { class: 'bm', x: x1 - 0.8, y: bm.up ? bm.end : bm.end - BEAM_T, width: x2 - x1 + 1.6, height: BEAM_T, fill: bm.color, 'pointer-events': 'none' });
  }

  // ── 음표 한 개 ─────────────────────────────────────────
  function ledgersSvg(ev) {
    let s = '';
    const lo = E4_STEP, hi = E4_STEP + 8;              // 오선 아랫줄 ~ 윗줄
    const wide = ev.heads.some(h => h.dx) ? 13 : 0;
    for (let t = lo - 2; t >= ev.minStep; t -= 2) s += line(ev.x - 12, stepY(t), ev.x + 12 + wide, stepY(t), LINE, 1.4, 'lg');
    for (let t = hi + 2; t <= ev.maxStep; t += 2) s += line(ev.x - 12, stepY(t), ev.x + 12 + wide, stepY(t), LINE, 1.4, 'lg');
    return s;
  }

  function headSvg(ev) {
    const d = ev.n.d, hollow = d >= 2;
    const dotted = d === 3 || d === 1.5;
    const dotX = ev.x + 13 + (ev.heads.some(h => h.dx) ? 13 : 0);
    return ev.heads.map(h => {
      const x = ev.x + h.dx;
      const o = { cx: x, cy: h.y, rx: d === 4 ? 8.6 : 7.6, ry: 5.6, transform: `rotate(-20 ${r1(x)} ${r1(h.y)})` };
      if (hollow) Object.assign(o, { class: 'hh', fill: '#fff', stroke: ev.color, 'stroke-width': 2.2 });
      else Object.assign(o, { class: 'hf', fill: ev.color });
      let s = tag('ellipse', o);
      if (dotted) s += tag('circle', { class: 'dt', cx: dotX, cy: onLine(h.step) ? h.y - SP / 2 : h.y, r: 2.2, fill: ev.color });
      return s;
    }).join('');
  }

  function stemSvg(ev) {
    if (ev.n.d === 4) return '';
    const up = ev.up, sx = ev.x + (up ? STEM_DX : -STEM_DX);
    // 기둥은 끝 반대쪽 머리에서 시작해 화음 전체를 지나간다
    const from = up ? ev.yBot : ev.yTop;
    const end = ev.stemEnd != null ? ev.stemEnd : (up ? ev.yTop - STEM : ev.yBot + STEM);
    let s = line(sx, from + (up ? -1 : 1), sx, end, ev.color, 1.6, 'st');
    if (ev.n.d === 0.5 && !ev.beamed) s += flagSvg(sx, end, up, ev.color);
    return s;
  }

  function flagSvg(sx, ty, up, color) {
    const v = up ? 1 : -1;  // 꼬리는 항상 오른쪽으로, 위/아래만 뒤집는다
    const p = (dx, dy) => `${r1(sx + dx)},${r1(ty + dy * v)}`;
    const d = `M${p(0, 0)} C${p(1, 7)} ${p(11, 10)} ${p(8, 22)} C${p(9, 14)} ${p(4, 10)} ${p(0, 8)} Z`;
    return tag('path', { class: 'fl', d, fill: color });
  }

  function accidentalSvg(ev, keyId) {
    if (ev.ghost) return '';
    return ev.heads.map(h => {
      const a = M.displayAcc(h.p, keyId);
      return a ? text(a, { class: 'ac', x: ev.x + ACC.dx, y: h.y + ACC.dy[a], 'text-anchor': 'middle', 'font-family': MUSIC_FONT, 'font-size': ACC.size, fill: ev.color }) : '';
    }).join('');
  }

  function labelSvg(ev, keyId) {
    if (ev.n.r) return '';
    const o = { class: 'lb', x: ev.x, y: LABEL_Y, 'text-anchor': 'middle', 'font-family': LABEL_FONT, 'font-size': 16, 'font-weight': 'bold' };
    if (ev.ghost) return text('?', Object.assign(o, { fill: GHOST }));
    // '파♯' 처럼 올림표가 붙으면 ♯ 를 작게 써서 8분음표 사이에서도 덜 겹치게 한다
    const name = M.solfa(ev.n.p, keyId), base = name.replace('♯', '');
    // 화음이면 '+' 를 작게 붙여 여러 음이 함께 난다는 것을 알려 준다
    const inner = esc(base) + (base !== name ? '<tspan font-size="11">♯</tspan>' : '') + (ev.n.c && ev.n.c.length ? '<tspan font-size="12" fill="#7048e8">+</tspan>' : '');
    return tag('text', Object.assign(o, { fill: labelColor(ev.n.p) }), inner);
  }

  function restSvg(ev) {
    const R = RESTS[ev.n.d];
    if (!R) return '';
    let s = text(R.ch, { class: 'rs', x: ev.x, y: R.y, 'text-anchor': 'middle', 'font-family': MUSIC_FONT, 'font-size': REST_SIZE, fill: INK });
    if (R.dot) s += tag('circle', { class: 'rs dt', cx: ev.x + 14, cy: MID - SP / 2, r: 2.2, fill: INK });
    return s;
  }

  function selBoxSvg(ev, keyId) {
    const wide = !ev.n.r && !ev.ghost && M.displayAcc(ev.n.p, keyId);
    const x = ev.x - (wide ? 28 : 14);
    return tag('rect', { class: 'selbox', x, y: 20, width: ev.x + 14 - x, height: 138, rx: 7, fill: '#ffd8a8', stroke: '#ff922b', 'stroke-width': 2 });
  }

  function noteSvg(ev, m, ctx) {
    let s = ctx.selK === ev.k ? selBoxSvg(ev, ctx.key) : '';
    if (ev.n.r) s += restSvg(ev);
    else s += ledgersSvg(ev) + accidentalSvg(ev, ctx.key) + headSvg(ev) + stemSvg(ev);
    if (ctx.labels) s += labelSvg(ev, ctx.key);
    s += tag('rect', { class: 'hit', x: ev.x - 18, y: 14, width: 36, height: 146, fill: 'transparent' });   // 손가락으로 누르기 쉽게 넓게
    return tag('g', { id: `${ctx.prefix}n${m}_${ev.k}`, class: 'nt', 'data-m': m, 'data-k': ev.k }, s);
  }

  function cursorSvg(meas, mx, mw) {
    const x = noteX(mx, mw, M.beats(meas));
    return tag('rect', { class: 'cursor', x: x - 3, y: TOP - 12, width: 6, height: 4 * SP + 24, rx: 3, fill: '#ff922b', 'pointer-events': 'none' });
  }

  function measureNotesSvg(m, mx, mw, info, ctx) {
    const evs = placeNotes(info.meas, ctx.key, mx, mw);
    const beams = applyBeams(evs);
    let s = beams.map(beamSvg).join('');
    const nctx = Object.assign({}, ctx, { selK: info.selK });
    s += evs.map(ev => noteSvg(ev, m, nctx)).join('');
    if (info.cursorHere && M.beats(info.meas) < meterNow) s += cursorSvg(info.meas, mx, mw);
    return s;
  }

  // ── 공개 함수 ──────────────────────────────────────────
  function measureInfo(work, m, req, o) {
    const sel = o.editable && o.sel ? o.sel : null;
    const meas = work.ms[m] || [];
    return {
      meas,
      editable: !!o.editable,
      inReq: req >= 0 && m >= req && m < req + M.REQ.length,
      reqStart: req >= 0 && m === req,
      selected: !!sel && sel.m === m,
      selK: sel && sel.m === m && sel.k != null ? sel.k : -1,
      cursorHere: !!sel && sel.m === m && sel.k == null,
    };
  }

  function bgFill(info) {
    if (info.inReq) return '#fff3bf';
    if (info.selected) return '#ffe8cc';
    return 'transparent';
  }

  function renderLine(work, L, opts) {
    const o = Object.assign({ prefix: 'e', editable: false, sel: null, labels: true }, opts || {});
    const lay = layout(work.key, L);
    meterNow = M.meterOf(work);
    const req = M.findReq(work.ms, meterNow);
    const ctx = { key: work.key, prefix: o.prefix, labels: o.labels !== false };
    const ms = [0, 1, 2, 3].map(i => {
      const m = L * 4 + i;
      return { m, x: lay.mx(i), info: measureInfo(work, m, req, o) };
    });
    let body = ms.map(q => measureBgSvg(q.m, q.x, lay.mw, bgFill(q.info), o.prefix)).join('');
    body += staffSvg() + clefSvg() + keySigSvg(work.key);
    if (L === 0) body += timeSigSvg(lay.left - TIMESIG_W / 2);
    body += ms.map(q => measureDecorSvg(q.m, q.x, lay.mw, q.info)).join('');
    body += ms.map(q => measureNotesSvg(q.m, q.x, lay.mw, q.info, ctx)).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW.w} ${VIEW.h}" width="${VIEW.w}" height="${VIEW.h}" class="score-line" data-line="${L}">${body}</svg>`;
  }

  function renderAll(work, opts) {
    return Array.from({ length: M.LINES }, (_, L) => renderLine(work, L, opts));
  }

  return { VIEW, TOP, SP, renderLine, renderAll };
})();
