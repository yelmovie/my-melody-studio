// 제출용 파일 만들기: MP3(작품 정보 태그 포함), 제출 활동지 PNG, 파일 이름, 다운로드, 복사
window.Exporter = (() => {
  const TAG_DESC = 'MELODY-STUDIO-WORK';
  const KFONT = "'Jua','Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',sans-serif";
  const MUSIC_GLYPHS = '𝄞𝄽𝄼𝄻𝄾♯♭♮';
  const tick = () => new Promise(r => setTimeout(r, 0));
  const str = v => String(v == null ? '' : v);

  // ───────── ID3v2.3 쓰기 ─────────
  function utf16(s, bom = true) {
    const out = new Uint8Array((bom ? 2 : 0) + s.length * 2);
    let o = 0;
    if (bom) { out[o++] = 0xff; out[o++] = 0xfe; }
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[o++] = c & 0xff; out[o++] = c >> 8; }
    return out;
  }
  const concat = arrs => {
    const out = new Uint8Array(arrs.reduce((a, b) => a + b.length, 0));
    let o = 0; arrs.forEach(a => { out.set(a, o); o += a.length; });
    return out;
  };
  const latin = s => Uint8Array.from(s, c => c.charCodeAt(0) & 0xff);
  const Z2 = new Uint8Array(2);
  function frame(id, body) {
    const h = new Uint8Array(10), n = body.length;
    h.set(latin(id), 0);
    h[4] = (n >>> 24) & 0xff; h[5] = (n >>> 16) & 0xff; h[6] = (n >>> 8) & 0xff; h[7] = n & 0xff;
    return concat([h, body]);
  }
  const textFrame = (id, text) => frame(id, concat([Uint8Array.of(1), utf16(text)]));

  function buildId3(work) {
    const w = work || {};
    const frames = [
      textFrame('TIT2', str(w.title).trim() || '나만의 가락'),
      textFrame('TPE1', `${str(w.num)} ${str(w.name)}`.trim()),
      textFrame('TALB', '나만의 가락 만들기'),
      frame('COMM', concat([Uint8Array.of(1), latin('kor'), utf16(''), Z2, utf16(str(w.intent))])),
      frame('TXXX', concat([Uint8Array.of(1), utf16(TAG_DESC), Z2, utf16(JSON.stringify(w))])),
    ];
    const body = concat(frames), n = body.length;
    const h = Uint8Array.of(0x49, 0x44, 0x33, 3, 0, 0, (n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f);
    return concat([h, body]);
  }

  // ───────── MP3 만들기 ─────────
  function toInt16(f) {
    const out = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const s = f[i] > 1 ? 1 : f[i] < -1 ? -1 : (f[i] || 0);
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  async function encodeMp3(audioBuffer, work, onProgress) {
    const lame = window.lamejs;
    if (!lame || typeof lame.Mp3Encoder !== 'function') {
      throw new Error('MP3로 바꿔 주는 도구를 불러오지 못했어요. 인터넷이 연결됐는지 확인하고 새로고침(F5)한 뒤 다시 해 보세요.');
    }
    if (!audioBuffer || !audioBuffer.length) throw new Error('저장할 소리가 없어요. 가락을 먼저 만들어 주세요.');
    const report = p => { try { if (onProgress) onProgress(p); } catch (e) { /* 진행 표시 오류는 무시 */ } };
    const ch = Math.min(2, audioBuffer.numberOfChannels || 1);
    let enc;
    try { enc = new lame.Mp3Encoder(ch, audioBuffer.sampleRate, 160); }
    catch (e) { throw new Error('MP3를 만들 준비를 하지 못했어요. 다시 한 번 눌러 보세요.'); }
    const L = toInt16(audioBuffer.getChannelData(0));
    const R = ch > 1 ? toInt16(audioBuffer.getChannelData(1)) : null;
    const BLOCK = 1152, total = Math.ceil(L.length / BLOCK), parts = [];
    const keep = b => { if (b && b.length) parts.push(new Uint8Array(b.buffer, b.byteOffset, b.length).slice()); };
    report(0);
    for (let i = 0, k = 0; i < L.length; i += BLOCK, k++) {
      keep(R ? enc.encodeBuffer(L.subarray(i, i + BLOCK), R.subarray(i, i + BLOCK)) : enc.encodeBuffer(L.subarray(i, i + BLOCK)));
      if (k % 50 === 49) { report(k / total); await tick(); }
    }
    keep(enc.flush());
    report(1);
    return new Blob([buildId3(work), ...parts], { type: 'audio/mpeg' });
  }

  // ───────── MP3에서 작품 다시 읽기 ─────────
  function decodeText(b, enc) {
    if (enc === 0) { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; }
    if (enc === 3) return new TextDecoder('utf-8').decode(b);
    let i = 0, le = enc === 1;
    if (enc === 1 && b.length >= 2) {
      if (b[0] === 0xff && b[1] === 0xfe) i = 2;
      else if (b[0] === 0xfe && b[1] === 0xff) { i = 2; le = false; }
    }
    const codes = [];
    for (; i + 1 < b.length; i += 2) codes.push(le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
    let s = '';
    for (let j = 0; j < codes.length; j += 0x2000) s += String.fromCharCode.apply(null, codes.slice(j, j + 0x2000));
    return s;
  }
  // 글자 끝 표시(0 또는 00 00) 위치
  function termAt(b, from, enc) {
    if (enc === 0 || enc === 3) { const i = b.indexOf(0, from); return i < 0 ? b.length : i; }
    for (let i = from; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
    return b.length;
  }
  const unsync = b => {
    const out = []; for (let i = 0; i < b.length; i++) { out.push(b[i]); if (b[i] === 0xff && b[i + 1] === 0) i++; }
    return Uint8Array.from(out);
  };
  const syncsafe = (b, i) => ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
  const be32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

  function findWorkJson(all) {
    if (all.length < 10 || all[0] !== 0x49 || all[1] !== 0x44 || all[2] !== 0x33) return null;
    const ver = all[3], flags = all[5];
    if (ver !== 3 && ver !== 4) return null;
    let tag = all.subarray(10, Math.min(all.length, 10 + syncsafe(all, 6)));
    if (ver === 3 && (flags & 0x80)) tag = unsync(tag);
    let pos = 0;
    if (flags & 0x40) pos = ver === 3 ? 4 + be32(tag, 0) : syncsafe(tag, 0);
    while (pos + 10 <= tag.length) {
      if (tag[pos] === 0) break;
      const id = String.fromCharCode(tag[pos], tag[pos + 1], tag[pos + 2], tag[pos + 3]);
      const size = ver === 4 ? syncsafe(tag, pos + 4) : be32(tag, pos + 4);
      const fmt = tag[pos + 9];
      let data = tag.subarray(pos + 10, pos + 10 + size);
      pos += 10 + size;
      if (id !== 'TXXX') continue;
      if (ver === 3 && (fmt & 0xc0)) continue;          // 압축·암호화는 건너뜀
      if (ver === 4) {
        if (fmt & 0x0c) continue;
        if (fmt & 0x01) data = data.subarray(4);
        if (fmt & 0x02) data = unsync(data);
      }
      const enc = data[0];
      if (enc > 3) continue;
      const end = termAt(data, 1, enc);
      if (decodeText(data.subarray(1, end), enc) !== TAG_DESC) continue;
      const value = decodeText(data.subarray(end + (enc === 1 || enc === 2 ? 2 : 1)), enc);
      return value.replace(/\0+$/, '');
    }
    return null;
  }

  async function toBytes(src) {
    if (src instanceof ArrayBuffer) return new Uint8Array(src);
    if (ArrayBuffer.isView(src)) return new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
    if (src && typeof src.arrayBuffer === 'function') return new Uint8Array(await src.arrayBuffer());
    if (src && typeof Blob !== 'undefined' && src instanceof Blob) {
      return new Uint8Array(await new Promise((res, rej) => {
        const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsArrayBuffer(src);
      }));
    }
    return null;
  }

  async function readWorkFromMp3(src) {
    try {
      const bytes = await toBytes(src);
      if (!bytes) return null;
      const json = findWorkJson(bytes);
      if (!json) return null;
      const M = window.Music;
      return M && typeof M.normWork === 'function' ? M.normWork(JSON.parse(json)) || null : null;
    } catch (e) {
      return null;
    }
  }

  // ───────── 파일 이름·다운로드·복사 ─────────
  const clean = s => str(s).replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '').replace(/\s+/g, '');
  function baseName(work, suffix = '') {
    const w = work || {};
    const base = [w.num, w.name, w.title].map(clean).filter(Boolean).join('_') || '나만의가락';
    const suf = clean(suffix).replace(/^_+/, '');
    return (base + (suf ? '_' + suf : '')).replace(/^\.+/, '').slice(0, 100) || '나만의가락';
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'download'; a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 60000);
  }

  async function copyText(text) {
    const t = str(text);
    try {
      if (navigator.clipboard && window.isSecureContext !== false) { await navigator.clipboard.writeText(t); return true; }
    } catch (e) { /* 아래 방법으로 다시 시도 */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = t; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select(); ta.setSelectionRange(0, t.length);
      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  // ───────── 악보 그림용 글꼴 ─────────
  function withTimeout(p, ms) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  }
  async function fetchOk(url) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => ctl && ctl.abort(), 8000);
    try {
      const res = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res;
    } finally { clearTimeout(t); }
  }
  function base64(buf) {
    const u8 = new Uint8Array(buf); let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  let fontCssPromise = null;
  function musicFontCss() {
    if (!fontCssPromise) {
      fontCssPromise = (async () => {
        const css = await (await fetchOk('https://fonts.googleapis.com/css2?family=Noto+Music&text=' + encodeURIComponent(MUSIC_GLYPHS))).text();
        const m = /url\(\s*(['"]?)([^'")]+)\1\s*\)(?:\s*format\(\s*['"]?([\w-]+)['"]?\s*\))?/.exec(css);
        if (!m) return '';
        const fmt = (m[3] || 'woff2').toLowerCase();
        const mime = { woff2: 'font/woff2', woff: 'font/woff', truetype: 'font/ttf', opentype: 'font/otf' }[fmt] || 'font/woff2';
        const buf = await (await fetchOk(m[2])).arrayBuffer();
        return `@font-face{font-family:'Noto Music';src:url(data:${mime};base64,${base64(buf)}) format('${fmt}');}`;
      })().catch(() => { fontCssPromise = null; return ''; });   // 실패하면 다음에 다시 시도
    }
    return fontCssPromise;
  }

  function prepSvg(svg, w, h, css) {
    const m = /<svg\b[^>]*>/i.exec(svg);
    if (!m) return svg;
    let tag = m[0].replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '');
    if (!/\sxmlns\s*=/.test(tag)) tag = tag.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    if (/xlink:/.test(svg) && !/xmlns:xlink/.test(tag)) tag = tag.replace(/^<svg/i, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
    tag = tag.replace(/\s*\/?>$/, ` width="${w}" height="${h}">`);
    return svg.slice(0, m.index) + tag + (css ? `<style>${css}</style>` : '') + svg.slice(m.index + m[0].length);
  }
  function loadSvg(svg) {
    return withTimeout(new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => setTimeout(() => res(img), 40);   // 글꼴이 그려질 틈을 조금 준다
      img.onerror = () => rej(new Error('svg'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }), 10000);
  }

  async function prepFonts(text) {
    try {
      if (!document.fonts) return false;
      await withTimeout(document.fonts.ready, 3000);
      await withTimeout(document.fonts.load('48px Jua', text || '가'), 4000);
    } catch (e) { /* 없으면 시스템 글꼴로 */ }
    try {
      return Array.from(document.fonts).some(f => /jua/i.test(f.family) && f.status === 'loaded');
    } catch (e) { return false; }
  }

  // ───────── 제출 활동지 PNG ─────────
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function card(ctx, x, y, w, h, fill, border) {
    ctx.save();
    ctx.shadowColor = 'rgba(176,130,70,0.18)'; ctx.shadowBlur = 26; ctx.shadowOffsetY = 6;
    rr(ctx, x, y, w, h, 34); ctx.fillStyle = fill; ctx.fill();
    ctx.restore();
    if (border) {
      ctx.save(); rr(ctx, x, y, w, h, 34);
      ctx.lineWidth = 3; ctx.strokeStyle = border; ctx.setLineDash([14, 10]); ctx.stroke();
      ctx.restore();
    }
  }
  function wrap(ctx, text, maxW) {
    const out = [];
    str(text).replace(/\r/g, '').split('\n').forEach(para => {
      let line = '';
      para.split(/(\s+)/).filter(Boolean).forEach(word => {
        if (ctx.measureText(line + word).width <= maxW) { line += word; return; }
        if (/^\s+$/.test(word)) { if (line) out.push(line); line = ''; return; }
        if (line.trim()) out.push(line.trimEnd());
        line = '';
        if (ctx.measureText(word).width <= maxW) { line = word; return; }
        Array.from(word).forEach(c => {   // 띄어쓰기 없이 긴 낱말은 글자 단위로 자른다
          if (line && ctx.measureText(line + c).width > maxW) { out.push(line); line = ''; }
          line += c;
        });
      });
      out.push(line.trimEnd());
    });
    while (out.length > 1 && !out[out.length - 1]) out.pop();
    return out;
  }
  function today() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}. ${p(d.getMonth() + 1)}. ${p(d.getDate())}.`;
  }

  async function renderSheetPng(work) {
    const w = work || {};
    const M = window.Music || {};
    const keyName = M.key ? M.key(w.key).name : str(w.key);
    const instName = M.instById ? M.instById(w.inst).name : str(w.inst);
    const lines = M.LINES || 6;
    const title = str(w.title).trim() || '나만의 가락';
    const author = `${str(w.num)} ${str(w.name)}`.trim();
    const intent = str(w.intent).trim();
    const chips = [
      ['조성', keyName, '#ffe3e3', '#c92a2a'],
      ['악기', instName, '#e7f5ff', '#1864ab'],
      ['빠르기', '♩ = ' + str(w.bpm || 90), '#ebfbee', '#2b8a3e'],
      ['', `${M.NM || 16}마디 · ${M.meterOf ? M.meterOf(w) : 4}/4박자`, '#fff3bf', '#a15c00'],
    ];
    const tagText = '🎼 가락 만들기 제출용';
    const scoreHead = '🎶 악보', scoreNote = `한 줄에 4마디 · 모두 ${M.NM || 16}마디`;
    const intentHead = '🎵 작곡 의도와 느낌', intentEmpty = '(작곡 의도를 아직 쓰지 않았어요)';
    const footer = '나만의 가락 만들기 ♪';
    const allText = [tagText, title, '지은이: ' + author, chips.flat().join(''), scoreHead, scoreNote, intentHead, intentEmpty, intent, footer, today(), '악보를 그리지 못했어요'].join('');

    const hasJua = await prepFonts(allText);
    const F = (px, strong) => `${strong && !hasJua ? 'bold ' : ''}${px}px ${KFONT}`;

    // 악보 6줄을 그림으로
    const W = 1600, MG = 56, CW = W - MG * 2, P = 44, SW = CW - P * 2, SH = Math.round(SW * 160 / 1000), GAP = 8;
    let svgs = [];
    try {
      if (window.Score && typeof window.Score.renderAll === 'function') {
        svgs = window.Score.renderAll(w, { prefix: 'x', editable: false, labels: true }) || [];
      }
    } catch (e) { svgs = []; }
    const css = svgs.length ? await musicFontCss() : '';
    const imgs = await Promise.all(Array.from({ length: lines }, (_, i) =>
      typeof svgs[i] === 'string' ? loadSvg(prepSvg(svgs[i], SW, SH, css)).catch(() => null) : Promise.resolve(null)));

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('이 브라우저에서는 그림 파일을 만들 수 없어요. 크롬이나 엣지에서 다시 해 보세요.');
    canvas.width = W;

    // 작곡 의도 줄 나누기(높이 계산용)
    const TFS = 32, LH = 52;
    ctx.font = F(TFS);
    const textLines = intent ? wrap(ctx, intent, SW - 20).slice(0, 40) : [intentEmpty];
    const HH = 340;
    const SCH = P + 56 + lines * SH + (lines - 1) * GAP + P;
    const ICH = P + 60 + textLines.length * LH + P - 6;
    const H = MG + HH + 28 + SCH + 28 + ICH + 24 + 70;
    canvas.height = H;   // 크기를 바꾸면 그리기 설정이 초기화된다

    ctx.fillStyle = '#fff9ec'; ctx.fillRect(0, 0, W, H);
    // 바탕 장식 점
    [[30, 40, 10, '#ffd8a8'], [W - 28, 90, 8, '#a5d8ff'], [24, H * 0.45, 9, '#b2f2bb'], [W - 26, H * 0.62, 10, '#ffc9c9'],
      [30, H - 60, 8, '#d0bfff'], [W - 32, H - 34, 9, '#ffec99']].forEach(([x, y, r, c]) => {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill();
    });
    ctx.textBaseline = 'middle';

    // 머리 카드
    let y = MG;
    card(ctx, MG, y, CW, HH, '#ffffff');
    ctx.save(); rr(ctx, MG, y, CW, HH, 34); ctx.clip();
    ctx.fillStyle = '#ffe8cc'; ctx.fillRect(MG, y, CW, 14);
    ctx.restore();
    ctx.font = F(58);
    [['♪', MG + 80, y + 130, '#ffc9c9'], ['♫', MG + CW - 90, y + 120, '#a5d8ff'], ['♪', MG + CW - 170, y + 250, '#b2f2bb'], ['♬', MG + 150, y + 260, '#ffe066']]
      .forEach(([g, x, yy, c]) => { ctx.fillStyle = c; ctx.textAlign = 'center'; ctx.fillText(g, x, yy); });

    ctx.textAlign = 'center';
    ctx.font = F(26);
    const tagW = ctx.measureText(tagText).width + 44;
    rr(ctx, W / 2 - tagW / 2, y + 34, tagW, 46, 23); ctx.fillStyle = '#fff4e6'; ctx.fill();
    ctx.fillStyle = '#d9480f'; ctx.fillText(tagText, W / 2, y + 58);

    let tfs = 78;
    ctx.font = F(tfs, true);
    while (tfs > 40 && ctx.measureText(title).width > CW - 360) { tfs -= 2; ctx.font = F(tfs, true); }
    ctx.fillStyle = '#5c3d2e'; ctx.fillText(title, W / 2, y + 140);

    ctx.font = F(36); ctx.fillStyle = '#7c6a58';
    ctx.fillText('지은이: ' + (author || '—'), W / 2, y + 212);

    // 정보 칩
    const CHH = 56, CPAD = 26, CGAP = 18;
    const sizes = chips.map(([lab, val]) => {
      ctx.font = F(24); const lw = lab ? ctx.measureText(lab).width + 12 : 0;
      ctx.font = F(29, true); const vw = ctx.measureText(val).width;
      return { lw, vw, w: CPAD * 2 + lw + vw };
    });
    let cx = W / 2 - (sizes.reduce((a, s) => a + s.w, 0) + CGAP * (chips.length - 1)) / 2;
    const cy = y + 262;
    ctx.textAlign = 'left';
    chips.forEach(([lab, val, bg, fg], i) => {
      const s = sizes[i];
      rr(ctx, cx, cy, s.w, CHH, CHH / 2); ctx.fillStyle = bg; ctx.fill();
      if (lab) { ctx.font = F(24); ctx.fillStyle = fg; ctx.globalAlpha = 0.65; ctx.fillText(lab, cx + CPAD, cy + CHH / 2 + 1); ctx.globalAlpha = 1; }
      ctx.font = F(29, true); ctx.fillStyle = fg; ctx.fillText(val, cx + CPAD + s.lw, cy + CHH / 2 + 1);
      cx += s.w + CGAP;
    });
    y += HH + 28;

    // 악보 카드
    card(ctx, MG, y, CW, SCH, '#ffffff');
    ctx.textAlign = 'left'; ctx.font = F(36, true); ctx.fillStyle = '#5c3d2e';
    ctx.fillText(scoreHead, MG + P, y + P + 18);
    ctx.textAlign = 'right'; ctx.font = F(24); ctx.fillStyle = '#a08c78';
    ctx.fillText(scoreNote, MG + P + SW, y + P + 20);
    imgs.forEach((img, i) => {
      const sy = y + P + 56 + i * (SH + GAP);
      if (img) { ctx.drawImage(img, MG + P, sy, SW, SH); return; }
      rr(ctx, MG + P, sy + 8, SW, SH - 16, 20); ctx.fillStyle = '#faf6ef'; ctx.fill();
      ctx.textAlign = 'center'; ctx.font = F(28); ctx.fillStyle = '#b8a48e';
      ctx.fillText(`${i + 1}줄 · 악보를 그리지 못했어요`, W / 2, sy + SH / 2);
    });
    y += SCH + 28;

    // 작곡 의도 카드
    card(ctx, MG, y, CW, ICH, '#fffdf6', '#f6c177');
    ctx.textAlign = 'left'; ctx.font = F(36, true); ctx.fillStyle = '#5c3d2e';
    ctx.fillText(intentHead, MG + P, y + P + 18);
    const ty = y + P + 60;
    ctx.strokeStyle = '#f3e3c3'; ctx.lineWidth = 2;
    textLines.forEach((_, i) => {
      const ly = ty + (i + 1) * LH - 4;
      ctx.beginPath(); ctx.moveTo(MG + P, ly); ctx.lineTo(MG + P + SW, ly); ctx.stroke();
    });
    ctx.font = F(TFS); ctx.fillStyle = intent ? '#4a3f35' : '#b8a48e';
    textLines.forEach((t, i) => ctx.fillText(t, MG + P + 10, ty + i * LH + LH / 2));
    y += ICH + 24;

    // 바닥글
    ctx.font = F(26); ctx.fillStyle = '#a08c78';
    ctx.textAlign = 'left'; ctx.fillText(today(), MG + 12, y + 30);
    ctx.textAlign = 'right'; ctx.fillText(footer, W - MG - 12, y + 30);

    const blob = await new Promise(res => {
      try { canvas.toBlob(res, 'image/png'); } catch (e) { res(null); }
    });
    if (!blob) throw new Error('제출용 그림 파일을 만들지 못했어요. 다시 한 번 눌러 보세요.');
    return blob;
  }

  return { encodeMp3, readWorkFromMp3, download, baseName, renderSheetPng, copyText };
})();
