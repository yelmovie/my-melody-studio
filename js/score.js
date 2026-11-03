// 악보 그리기: 한 줄(4마디)을 SVG 문자열로 만든다. window.Music 이 먼저 로드되어 있어야 한다.
// PNG 저장(SVG → 이미지)에서도 똑같이 보이도록 모든 모양은 인라인 속성으로 지정하고,
// class 는 화면 강조(CSS)용 손잡이로만 붙인다.
window.Score = (() => {
  const M = window.Music;

  // ── 기본 치수 ──────────────────────────────────────────
  const VIEW = { w: 1000, h: 160 };   // 기본(글자 한 줄) 크기. 계이름+가사 두 줄이면 H_BOTH
  const H_BOTH = 184;
  const TOP = 46, SP = 12;            // 오선 맨 윗줄 y, 줄 간격
  const BOT = TOP + 4 * SP;           // 맨 아랫줄(미, E4) y = 94
  const MID = TOP + 2 * SP;           // 가운뎃줄(시, B4) y = 70
  const STAFF_L = 8, STAFF_R = 988;   // 오선 좌우 끝
  const NOTE_PAD_L = 26, NOTE_PAD_SUM = 44;   // 마디 안 음표 여백(왼쪽, 좌우 합)
  const MIN_GAP = 19;                 // 음표 하나가 차지하는 최소 가로 폭(16분음표 머리가 겹치지 않게)
  const LONE16_GAP = 28;              // 빔 없는 16분음표(꼬리 둘)의 최소 폭
  const STEM = 34, STEM_DX = 6.6, BEAM_T = 5;
  const BEAM2_DY = 7, STUB = 10;      // 16분음표 둘째 빔: 첫 빔에서 머리 쪽으로 띄울 거리, 혼자인 16분의 짧은 빔 길이
  const FLAG_GAP = 8;                 // 16분음표 꼬리 두 개 사이
  const LABEL_Y = 150;
  // 가사 줄: 'lyrics' 는 LABEL_Y 에, 'both' 는 가사 150 + 계이름 174(작게)
  const LYRIC = { size: 17, fill: '#3b3355' };
  const BOTH_LABEL_Y = 174, BOTH_LABEL_SIZE = 12;

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
  let barsNow = 16;   // 지금 그리는 작품의 곡 길이(마디) — 마침 겹세로줄 자리
  const ACC = { dx: -19, size: 20, dy: { '♯': 3, '♮': 3, '♭': 1 } };
  const REST_SIZE = 48;
  const RESTS = {                                      // y: 쉼표 글자의 기준선 y
    4:   { ch: '\u{1D13B}', y: TOP + SP + 25 },        // 온쉼표: 넷째 줄(58)에 매달림 (글자 58~65)
    3:   { ch: '\u{1D13C}', y: MID + 11, dot: true },  // 점2분쉼표
    2:   { ch: '\u{1D13C}', y: MID + 11 },             // 2분쉼표: 가운뎃줄(70) 위에 얹힘 (글자 62~70)
    1.5: { ch: '\u{1D13D}', y: MID + 24, dot: true },  // 점4분쉼표
    1:   { ch: '\u{1D13D}', y: MID + 24 },             // 4분쉼표: 오선 가운데 (글자 52~89)
    0.75: { ch: '\u{1D13E}', y: MID + 24, dot: true }, // 점8분쉼표
    0.5: { ch: '\u{1D13E}', y: MID + 24 },             // 8분쉼표: 오선 가운데 (글자 59~81)
    0.25: { ch: '\u{1D13F}', y: MID + 24 },            // 16분쉼표: 8분쉼표와 같은 기준선
  };
  const FLAGS = { 0.75: 1, 0.5: 1, 0.25: 2 };          // 빔 없이 혼자일 때 꼬리 수

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
  // 마디 폭은 내용에 따라: 음표마다 '박 길이 × beatW' 를 차지하되 MIN_GAP 보다 좁지는 않게,
  // 덜 채운 박은 빈칸으로 남긴다. 네 마디 내용을 합쳐 줄 폭에 꼭 맞게 늘이거나 줄인다(좌우 여백은 그대로).
  // 최소 폭이 필요한 음표가 없으면 예전처럼 네 마디 폭이 같고 x 가 시간에 비례한다.
  // 빔 묶음(음표 번호 배열들): 한 박 안에 꼭 들어가는 짧은 음표(8분·점8분·16분)가 쉼표 없이 둘 이상 이어진 것
  function beamGroups(meas) {
    const groups = [];
    let cur = null, off = 0;
    const close = () => { if (cur && cur.ks.length >= 2) groups.push(cur.ks); cur = null; };
    meas.forEach((n, k) => {
      const beat = Math.floor(off), start = off;
      off += n.d;
      if (n.r || n.d >= 1 || start + n.d > beat + 1) { close(); return; }
      if (cur && cur.beat === beat) cur.ks.push(k);
      else { close(); cur = { beat, ks: [k] }; }
    });
    close();
    return groups;
  }

  function layout(work, L) {
    const hasSig = M.key(work.key).sig.length > 0;
    const left = CLEF_W + (hasSig ? KEYSIG.w : 0) + (L === 0 ? TIMESIG_W : 0);
    const room = STAFF_R - left - 4 * NOTE_PAD_SUM;            // 네 마디 음표 자리 합
    const beatW = room / (4 * meterNow);
    // 음표마다 차지할 폭. 빔 없이 혼자인 16분음표는 꼬리 두 개가 다음 음표에 닿지 않게 조금 더
    const slots = meas => {
      const beamed = new Set([].concat(...beamGroups(meas)));
      return meas.map((n, k) => Math.max(n.d * beatW, !n.r && n.d === 0.25 && !beamed.has(k) ? LONE16_GAP : MIN_GAP));
    };
    const sum = a => a.reduce((s, v) => s + v, 0);
    const content = meas => sum(slots(meas)) + Math.max(0, meterNow - M.beats(meas)) * beatW;
    const natural = [0, 1, 2, 3].map(i => content(work.ms[L * 4 + i] || []));
    const scale = room / sum(natural);
    const mws = natural.map(c => NOTE_PAD_SUM + c * scale);
    const mxs = mws.map((_, i) => left + sum(mws.slice(0, i)));
    return { left, hasSig, scale, slots, mx: i => mxs[i], mw: i => mws[i] };
  }

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
  function measureBgSvg(m, x, w, fill, prefix, extra) {
    return tag('rect', { id: `${prefix}mb${m}`, class: 'mb', 'data-m': m, x: x + 2, y: 6, width: w - 4, height: 150 + extra, rx: 10, fill });
  }

  function barlineSvg(m, xEnd) {
    if (m !== barsNow - 1) return line(xEnd, TOP, xEnd, BOT, LINE, 1.4, 'bl');
    return line(xEnd - 7, TOP, xEnd - 7, BOT, LINE, 1.4, 'bl')
      + tag('rect', { class: 'bl', x: xEnd - 4, y: TOP, width: 4, height: 4 * SP, fill: LINE });
  }

  function measureDecorSvg(m, mx, mw, info) {
    const meas = info.meas, b = M.beats(meas);
    let s = text(String(m + 1), { class: 'mn', x: mx + 8, y: 24, 'font-family': UI_FONT, 'font-size': 11, fill: '#999' });
    if (info.reqStart) {
      s += text('⭐ 꼭 넣을 리듬', { class: 'req', x: mx + 24, y: 24, 'font-family': UI_FONT, 'font-size': 12, 'font-weight': 'bold', fill: '#0ca678' });
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
  function placeNotes(meas, keyId, mx, mw, lay) {
    let off = 0, cum = 0;
    const slots = lay.slots(meas);
    // 마디를 통째로 쉬면(쉼표 하나 = 한 마디 박) 온쉼표를 마디 한가운데에 둔다
    const full = meas.length === 1 && meas[0].r && meas[0].d === meterNow;
    return meas.map((n, k) => {
      const ev = { n, k, off, x: full ? mx + mw / 2 : mx + NOTE_PAD_L + cum * lay.scale };
      if (full) ev.full = true;
      off += n.d;
      cum += slots[k];
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

  // 빔 묶음마다 꼬리를 이어 준다. 기둥 방향은 묶음 전체 머리의 평균 높이로, 첫 빔은 가장 바깥 기둥 끝에 수평으로.
  function applyBeams(evs) {
    return beamGroups(evs.map(e => e.n)).map(ks => {
      const g = ks.map(k => evs[k]);
      const up = g.reduce((a, e) => a + e.minStep + e.maxStep, 0) / (2 * g.length) < B4_STEP;
      const end = up ? Math.min(...g.map(e => e.yTop)) - STEM : Math.max(...g.map(e => e.yBot)) + STEM;
      g.forEach(e => { e.up = up; e.stemEnd = end; e.beamed = true; });
      return { evs: g, up, end, color: g.every(e => e.ghost) ? GHOST : INK };
    });
  }

  function beamSvg(bm) {
    const sx = e => e.x + (bm.up ? STEM_DX : -STEM_DX);
    const bar = (x1, x2, y) => tag('rect', { class: 'bm', x: x1 - 0.8, y, width: x2 - x1 + 1.6, height: BEAM_T, fill: bm.color, 'pointer-events': 'none' });
    const g = bm.evs;
    let s = bar(sx(g[0]), sx(g[g.length - 1]), bm.up ? bm.end : bm.end - BEAM_T);
    // 둘째 빔: 이어진 16분음표끼리. 혼자인 16분은 이웃 쪽으로 짧게(맨 끝이면 왼쪽, 아니면 오른쪽)
    const y2 = bm.up ? bm.end + BEAM2_DY : bm.end - BEAM_T - BEAM2_DY;
    for (let i = 0; i < g.length; i++) {
      if (g[i].n.d !== 0.25) continue;
      let j = i;
      while (j + 1 < g.length && g[j + 1].n.d === 0.25) j++;
      if (j > i) s += bar(sx(g[i]), sx(g[j]), y2);
      else if (i === g.length - 1) s += bar(sx(g[i]) - STUB, sx(g[i]), y2);
      else s += bar(sx(g[i]), sx(g[i]) + STUB, y2);
      i = j;
    }
    return s;
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
    const dotted = d === 3 || d === 1.5 || d === 0.75;
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
    const flags = ev.beamed ? 0 : FLAGS[ev.n.d] || 0;
    const len = STEM + (flags - 1 > 0 ? (flags - 1) * FLAG_GAP : 0);   // 꼬리가 둘이면 기둥을 조금 늘인다
    const end = ev.stemEnd != null ? ev.stemEnd : (up ? ev.yTop - len : ev.yBot + len);
    let s = line(sx, from + (up ? -1 : 1), sx, end, ev.color, 1.6, 'st');
    for (let i = 0; i < flags; i++) s += flagSvg(sx, end + (up ? 1 : -1) * i * FLAG_GAP, up, ev.color);
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

  // small: 'both' 모드에서 가사 아래 작은 계이름 줄
  function labelSvg(ev, keyId, small) {
    if (ev.n.r) return '';
    const o = { class: 'lb', x: ev.x, y: small ? BOTH_LABEL_Y : LABEL_Y, 'text-anchor': 'middle', 'font-family': LABEL_FONT, 'font-size': small ? BOTH_LABEL_SIZE : 16, 'font-weight': 'bold' };
    if (ev.ghost) return text('?', Object.assign(o, { fill: GHOST }));
    // '파♯' 처럼 올림표가 붙으면 ♯ 를 작게 써서 8분음표 사이에서도 덜 겹치게 한다
    const name = M.solfa(ev.n.p, keyId), base = name.replace('♯', '');
    // 화음이면 '+' 를 작게 붙여 여러 음이 함께 난다는 것을 알려 준다
    const inner = esc(base) + (base !== name ? `<tspan font-size="${small ? 9 : 11}">♯</tspan>` : '') + (ev.n.c && ev.n.c.length ? `<tspan font-size="${small ? 10 : 12}" fill="#7048e8">+</tspan>` : '');
    return tag('text', Object.assign(o, { fill: labelColor(ev.n.p) }), inner);
  }

  // 가사 한 글자(없으면 아무것도 안 그림). 재생 중 강조(.nt.playing .ly)를 위해 음표 g 안에 넣는다
  function lyricSvg(ev, m, ctx) {
    const syl = ev.n.r ? null : ctx.ly[`${m}_${ev.k}`];
    if (!syl) return '';
    return text(syl, { class: 'ly', x: ev.x, y: LABEL_Y, 'text-anchor': 'middle', 'font-family': LABEL_FONT, 'font-size': LYRIC.size, 'font-weight': 'bold', fill: LYRIC.fill });
  }

  function restSvg(ev) {
    const R = ev.full ? RESTS[4] : RESTS[ev.n.d];
    if (!R) return '';
    let s = text(R.ch, { class: 'rs', x: ev.x, y: R.y, 'text-anchor': 'middle', 'font-family': MUSIC_FONT, 'font-size': REST_SIZE, fill: INK });
    if (R.dot) s += tag('circle', { class: 'rs dt', cx: ev.x + 14, cy: MID - SP / 2, r: 2.2, fill: INK });
    return s;
  }

  function selBoxSvg(ev, keyId, extra) {
    const wide = !ev.n.r && !ev.ghost && M.displayAcc(ev.n.p, keyId);
    const x = ev.x - (wide ? 28 : 14);
    return tag('rect', { class: 'selbox', x, y: 20, width: ev.x + 14 - x, height: 138 + extra, rx: 7, fill: '#c3fae8', stroke: '#12b886', 'stroke-width': 2 });
  }

  function noteSvg(ev, m, ctx) {
    let s = ctx.selK === ev.k ? selBoxSvg(ev, ctx.key, ctx.extra) : '';
    if (ev.n.r) s += restSvg(ev);
    else s += ledgersSvg(ev) + accidentalSvg(ev, ctx.key) + headSvg(ev) + stemSvg(ev);
    if (ctx.labels) {
      if (ctx.text !== 'solfa') s += lyricSvg(ev, m, ctx);
      if (ctx.text !== 'lyrics') s += labelSvg(ev, ctx.key, ctx.text === 'both');
    }
    s += tag('rect', { class: 'hit', x: ev.x - 18, y: 14, width: 36, height: 146 + ctx.extra, fill: 'transparent' });   // 손가락으로 누르기 쉽게 넓게
    return tag('g', { id: `${ctx.prefix}n${m}_${ev.k}`, class: 'nt', 'data-m': m, 'data-k': ev.k }, s);
  }

  // 다음 음표가 들어갈 자리(지금까지 채운 음표 폭 바로 뒤)
  function cursorSvg(meas, mx, lay) {
    const x = mx + NOTE_PAD_L + lay.slots(meas).reduce((a, w) => a + w, 0) * lay.scale;
    return tag('rect', { class: 'cursor', x: x - 3, y: TOP - 12, width: 6, height: 4 * SP + 24, rx: 3, fill: '#12b886', 'pointer-events': 'none' });
  }

  function measureNotesSvg(m, mx, mw, info, ctx, lay) {
    const evs = placeNotes(info.meas, ctx.key, mx, mw, lay);
    const beams = applyBeams(evs);
    let s = beams.map(beamSvg).join('');
    const nctx = Object.assign({}, ctx, { selK: info.selK });
    s += evs.map(ev => noteSvg(ev, m, nctx)).join('');
    if (info.cursorHere && M.beats(info.meas) < meterNow) s += cursorSvg(info.meas, mx, lay);
    return s;
  }

  // ── 공개 함수 ──────────────────────────────────────────
  function measureInfo(work, m, req, o) {
    const sel = o.editable && o.sel ? o.sel : null;
    const meas = work.ms[m] || [];
    return {
      meas,
      editable: !!o.editable,
      inReq: req >= 0 && m >= req && m < req + M.reqFor(meterNow).length,   // 2/4 는 8마디
      reqStart: req >= 0 && m === req,
      selected: !!sel && sel.m === m,
      selK: sel && sel.m === m && sel.k != null ? sel.k : -1,
      cursorHere: !!sel && sel.m === m && sel.k == null,
    };
  }

  function bgFill(info) {
    if (info.inReq) return '#c3fae8';
    if (info.selected) return '#e6fcf5';
    return 'transparent';
  }

  // 글자 줄 종류: 'solfa'(계이름, 기본) · 'lyrics'(가사) · 'both'(가사 + 작은 계이름)
  const textMode = o => (o && (o.text === 'lyrics' || o.text === 'both') ? o.text : 'solfa');
  // 한 줄 SVG 높이. 'both' 이고 글자를 보일 때만 한 줄 더 높다
  const heightFor = opts => (textMode(opts) === 'both' && (!opts || opts.labels !== false) ? H_BOTH : VIEW.h);

  function renderLine(work, L, opts) {
    const o = Object.assign({ prefix: 'e', editable: false, sel: null, labels: true }, opts || {});
    meterNow = M.meterOf(work);   // layout·measureInfo 가 쓰므로 먼저 정한다
    barsNow = M.barsOf(work);
    const lay = layout(work, L);
    const req = M.findReq(work.ms.slice(0, barsNow), meterNow);
    const h = heightFor(o);
    const mode = textMode(o);
    const ctx = {
      key: work.key, prefix: o.prefix, labels: o.labels !== false, text: mode, extra: h - VIEW.h,
      ly: mode !== 'solfa' && o.labels !== false ? M.lyricsFor(work, L).map : {},
    };
    const ms = [0, 1, 2, 3].map(i => {
      const m = L * 4 + i;
      return { m, x: lay.mx(i), w: lay.mw(i), info: measureInfo(work, m, req, o) };
    });
    let body = ms.map(q => measureBgSvg(q.m, q.x, q.w, bgFill(q.info), o.prefix, ctx.extra)).join('');
    body += staffSvg() + clefSvg() + keySigSvg(work.key);
    if (L === 0) body += timeSigSvg(lay.left - TIMESIG_W / 2);
    body += ms.map(q => measureDecorSvg(q.m, q.x, q.w, q.info)).join('');
    body += ms.map(q => measureNotesSvg(q.m, q.x, q.w, q.info, ctx, lay)).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW.w} ${h}" width="${VIEW.w}" height="${h}" class="score-line" data-line="${L}">${body}</svg>`;
  }

  function renderAll(work, opts) {
    return Array.from({ length: M.linesOf(work) }, (_, L) => renderLine(work, L, opts));
  }

  return { VIEW, TOP, SP, heightFor, renderLine, renderAll };
})();
