// 소리 엔진: FluidR3_GM 샘플(MIT) + Web Audio. file:// 에서도 돌도록 모듈 대신 전역 window.Engine 하나만 내보낸다
window.Engine = (() => {
  const M = window.Music;
  const AC = window.AudioContext || window.webkitAudioContext;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const BASE = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/';
  const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const VOICE = 0.5;          // 음 하나의 기본 크기 (4~5음이 겹쳐도 컴프레서가 받아냄)
  const WET = 0.18;           // 잔향 양
  const RENDER_LEVEL = 0.8;   // 파일 저장용 고정 음량
  const MAX_FETCH = 6;

  const noteName = m => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const safeCall = (f, ...a) => { try { f(...a); } catch (e) { /* UI 콜백 오류가 로딩을 멈추지 않게 */ } };

  let ctx = null, live = null, volume = 0.8, decodeCtx = null;
  let applause = null, applauseLoading = null;
  const insts = {};                       // id -> { bufs: Map(소리 MIDI -> AudioBuffer), promise, done, ... }
  const noiseCache = new WeakMap();       // context -> 1초 백색잡음
  const loopCache = new WeakMap();        // AudioBuffer -> [loopStart, loopEnd] | null

  // ---------- 출력 체인 ----------
  function makeImpulse(c, sec) {
    const sr = c.sampleRate, len = Math.floor(sr * sec), pre = Math.floor(sr * 0.012);
    const b = c.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = pre; i < len; i++) {
        const x = (i - pre) / (len - pre);
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - x, 2.2) * Math.exp(-3 * x);
      }
    }
    return b;
  }

  // input → (dry + 잔향) → master(음량) → compressor → destination
  function buildChain(c, level) {
    const input = c.createGain();
    const master = c.createGain();
    master.gain.value = level;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.2;
    const verb = c.createConvolver();
    verb.buffer = makeImpulse(c, 1.6);
    const tone = c.createBiquadFilter();
    tone.type = 'lowpass'; tone.frequency.value = 5500;   // 잔향을 살짝 어둡게
    const wet = c.createGain();
    wet.gain.value = WET;
    input.connect(master);
    input.connect(verb); verb.connect(tone); tone.connect(wet); wet.connect(master);
    master.connect(comp); comp.connect(c.destination);
    return { input, master };
  }

  function ensure() {
    if (!ctx) {
      if (!AC) return null;
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) {
        try { ctx = new AC(); } catch (e2) { return null; }
      }
      live = buildChain(ctx, volume);
      setTimeout(loadApplause, 1500);
    }
    if (ctx.state !== 'running' && ctx.state !== 'closed') {
      const p = ctx.resume();
      if (p && p.catch) p.catch(() => {});
    }
    return ctx;
  }

  function setVolume(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    volume = clamp(n, 0, 1);
    if (live) live.master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
  }

  function noiseBuf(c) {
    let b = noiseCache.get(c);
    if (!b) {
      b = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noiseCache.set(c, b);
    }
    return b;
  }

  // 소스가 모두 끝나면 관련 노드를 끊는다 (누수 방지)
  function track(srcs, nodes, onEnd) {
    let left = srcs.length;
    srcs.forEach(s => {
      s.onended = () => {
        s.disconnect();
        if (--left === 0) {
          nodes.forEach(n => n.disconnect());
          if (onEnd) onEnd();
        }
      };
    });
  }

  // ---------- 샘플 불러오기 ----------
  // 사용자 동작 전에는 AudioContext 대신 작은 OfflineAudioContext 로만 디코딩한다
  function getDecoder() {
    if (ctx) return ctx;
    if (!decodeCtx && OAC) { try { decodeCtx = new OAC(2, 1, 44100); } catch (e) { decodeCtx = null; } }
    return decodeCtx;
  }

  function decode(ab) {
    const c = getDecoder();
    if (!c) return Promise.reject(new Error('no audio'));
    return new Promise((res, rej) => {
      const p = c.decodeAudioData(ab, res, rej);
      if (p && p.then) p.then(res, rej);   // 프라미스형 거부도 여기서 처리
    });
  }

  function fetchBuffer(url) {
    const ctl = window.AbortController ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 15000) : 0;
    return fetch(url, ctl ? { signal: ctl.signal } : undefined)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(decode)
      .then(b => { clearTimeout(timer); return b; }, e => { clearTimeout(timer); throw e; });
  }

  // 동시에 n개까지만 실행 (task 는 절대 거부되지 않는다고 가정)
  function pool(tasks, n) {
    let next = 0;
    const run = () => (next < tasks.length ? tasks[next++]().then(run, run) : Promise.resolve());
    return Promise.all(Array.from({ length: Math.min(n, tasks.length) }, run));
  }

  function loadInstrument(id, onProgress) {
    const it = M.instById(id);
    let st = insts[it.id];
    // 진행 중이거나 성공한 로딩은 같은 프라미스를 돌려준다. 하나도 못 받은 경우만 다시 시도
    if (st && !(st.done && st.bufs.size === 0)) {
      if (onProgress) {
        if (st.done) Promise.resolve().then(() => safeCall(onProgress, st.total, st.total));
        else st.listeners.push(onProgress);
      }
      return st.promise;
    }
    const notes = [];
    for (let w = M.MIN_MIDI; w <= M.MAX_MIDI; w++) notes.push(w + it.shift);
    st = insts[it.id] = {
      bufs: new Map(), done: false, finished: 0, total: notes.length,
      listeners: onProgress ? [onProgress] : [], promise: null,
    };
    const cur = st;
    const tasks = notes.map(m => () =>
      fetchBuffer(`${BASE}${it.gm}-mp3/${noteName(m)}.mp3`)
        .then(b => { cur.bufs.set(m, b); addPeak(cur, b); }, () => { /* 못 받은 음은 이웃 음으로 대신 */ })
        .then(() => {
          cur.finished++;
          cur.listeners.forEach(f => safeCall(f, cur.finished, cur.total));
        }));
    st.promise = pool(tasks, MAX_FETCH).then(() => {
      cur.done = true;
      cur.listeners = [];
      return cur.bufs.size >= Math.ceil(cur.total * 0.8);
    });
    return st.promise;
  }

  // 사운드폰트 녹음 크기가 악기마다 달라(피크 0.02~0.08) 불러온 샘플 크기로 음량을 맞춘다
  function addPeak(st, b) {
    const d = b.getChannelData(0);
    let p = 0;
    for (let i = 0; i < d.length; i += 4) { const v = Math.abs(d[i]); if (v > p) p = v; }
    st.peakSum = (st.peakSum || 0) + p;
    st.peakN = (st.peakN || 0) + 1;
    st.norm = Math.max(1, Math.min(16, 0.7 / (st.peakSum / st.peakN || 1)));
  }

  function isReady(id) {
    const st = insts[M.instById(id).id];
    return !!(st && st.done && st.bufs.size > 0);
  }

  // 가장 가까운 샘플 + 재생 속도. 로딩 중에는 너무 먼 음으로 대신하지 않는다
  function sampleFor(id, snd) {
    const st = insts[id];
    if (!st || !st.bufs.size) return null;
    let best = 0, bd = Infinity;
    st.bufs.forEach((b, m) => { const d = Math.abs(m - snd); if (d < bd) { bd = d; best = m; } });
    if (bd > (st.done ? 12 : 4)) return null;
    return { buf: st.bufs.get(best), rate: Math.pow(2, (snd - best) / 12) };
  }

  // 길게 끄는 음용 반복 구간: 40% 근처 상승 영점에서 시작, 85% 근처에서 파형이 가장 비슷한 영점에서 끝.
  // (FluidR3 mp3 는 약 1.6초로 잘려 있어 끝부분이 줄어들 수 있으므로, 소리가 30% 넘게 작아지기 전에서 끝낸다)
  function loopPts(buf) {
    if (loopCache.has(buf)) return loopCache.get(buf);
    const d = buf.getChannelData(0), sr = buf.sampleRate, n = d.length, W = 64;
    const up = i => i > 0 && i < n && d[i - 1] < 0 && d[i] >= 0;
    const win = Math.max(1, Math.floor(sr * 0.02));
    const rms = i0 => {
      let e = 0, k = 0;
      for (let i = Math.max(0, i0); i < Math.min(n, i0 + win); i++, k++) e += d[i] * d[i];
      return k ? Math.sqrt(e / k) : 0;
    };
    let s = Math.floor(n * 0.4);
    for (let o = 0; o < sr * 0.02; o++) if (up(s + o)) { s += o; break; }
    const ref = rms(s);
    let target = Math.floor(n * 0.85);
    while (target > s + sr * 0.15 && rms(target - win) < ref * 0.7) target -= win;
    let best = target, err = Infinity;
    const lo = Math.max(s + Math.floor(sr * 0.1), Math.floor(target - sr * 0.03));
    const hi = Math.min(n - W - 1, Math.floor(target + sr * 0.03));
    for (let i = lo; i < hi; i++) {
      if (!up(i)) continue;
      let e = 0;
      for (let j = 0; j < W; j++) { const x = d[i + j] - d[s + j]; e += x * x; }
      if (e < err) { err = e; best = i; }
    }
    const r = best > s + sr * 0.05 && s + W < n ? [s / sr, best / sr] : null;
    loopCache.set(buf, r);
    return r;
  }

  // ---------- 목소리(음 하나) ----------
  // 실제 시각 t 에 written 음을 낸다. 반환값: when 에 멈추는 함수
  function voice(c, dest, it, written, t, dur, onEnd) {
    const snd = written + it.shift;
    const s = sampleFor(it.id, snd);
    if (!s) return synthVoice(c, dest, snd, t, onEnd);
    dur = Math.max(0.05, +dur || 0.6);
    const src = c.createBufferSource(), g = c.createGain(), p = g.gain;
    src.buffer = s.buf;
    src.playbackRate.value = s.rate;
    src.connect(g); g.connect(dest);
    let G = VOICE * ((insts[it.id] && insts[it.id].norm) || 1), end;
    if (it.kind === 'mallet') {
      // 음판은 손으로 막을 수 없으니 dur 무시, 다만 2.5초 뒤엔 정리
      G *= 0.9 + Math.random() * 0.1;
      const off = t + Math.max(dur, 2.5);
      p.setValueAtTime(G, t); p.setValueAtTime(G, off); p.linearRampToValueAtTime(0, off + 0.3);
      end = off + 0.32;
    } else if (it.kind === 'piano') {
      const off = t + dur;                 // 건반에서 손을 떼는 순간
      p.setValueAtTime(G, t); p.setValueAtTime(G, off); p.setTargetAtTime(0, off, 0.35 / 4);
      end = off + 0.4;
    } else if (it.kind === 'pluck') {
      const off = t + dur + 0.6;           // 줄이 조금 더 울리게
      p.setValueAtTime(G, t); p.setValueAtTime(G, off); p.setTargetAtTime(0, off, 0.4 / 4);
      end = off + 0.45;
    } else {
      // sustain: 부드러운 시작, dur 동안 유지(살짝 겹쳐 레가토), 짧은 끝맺음
      const off = t + Math.max(dur, 0.06) + 0.03;
      p.setValueAtTime(0, t); p.linearRampToValueAtTime(G, t + 0.04);
      p.setValueAtTime(G, off); p.setTargetAtTime(0, off, 0.15 / 4);
      end = off + 0.17;
      if (end - t > (s.buf.duration - 0.15) / s.rate) {
        const lp = loopPts(s.buf);
        if (lp) { src.loop = true; src.loopStart = lp[0]; src.loopEnd = lp[1]; }
      }
    }
    src.start(t);
    src.stop(end);
    track([src], [g], onEnd);
    return when => { try { src.stop(Math.max(when, t)); } catch (e) { /* 옛 Safari: stop 두 번 금지 */ } };
  }

  // 샘플이 없을 때: 모달 실로폰 (배음 1 : 3 : 6.3 + 채 타격 잡음)
  function synthVoice(c, dest, snd, t, onEnd) {
    const f = hz(snd), k = clamp(Math.pow(2, -(snd - 72) / 24), 0.35, 1.4);   // 높은 음일수록 짧게
    const out = c.createGain();
    out.gain.value = VOICE * 0.6;
    out.connect(dest);
    const srcs = [], nodes = [out];
    [[1, 1, 0.9], [3.0, 0.32, 0.25], [6.3, 0.12, 0.08]].forEach(([r, a, d]) => {
      if (f * r > c.sampleRate * 0.45) return;
      const o = c.createOscillator(), g = c.createGain(), tau = (d * k) / 3;
      o.frequency.value = f * r;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.002);
      g.gain.setTargetAtTime(0, t + 0.002, tau);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.002 + tau * 7);
      srcs.push(o); nodes.push(g);
    });
    const n = c.createBufferSource(), bp = c.createBiquadFilter(), ng = c.createGain();
    n.buffer = noiseBuf(c);
    bp.type = 'bandpass'; bp.frequency.value = Math.min(f * 2.5, 8000); bp.Q.value = 1.2;
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
    n.connect(bp); bp.connect(ng); ng.connect(out);
    n.start(t, Math.random() * 0.5); n.stop(t + 0.02);
    srcs.push(n); nodes.push(bp, ng);
    track(srcs, nodes, onEnd);
    return when => srcs.forEach(x => { try { x.stop(Math.max(when, t)); } catch (e) { /* 무시 */ } });
  }

  // ---------- 재생 ----------
  function play(id, midi, durSec = 0.6) {
    const c = ensure();
    if (!c || !Number.isFinite(midi)) return;
    const it = M.instById(id);
    if (!insts[it.id]) loadInstrument(it.id);
    voice(c, live.input, it, midi, c.currentTime + 0.005, durSec);
  }

  function playSequence(events, id) {
    const c = ensure();
    if (!c) return { t0: 0, end: 0, stop() {} };
    const it = M.instById(id);
    if (!insts[it.id]) loadInstrument(it.id);
    const bus = c.createGain();
    bus.connect(live.input);
    const t0 = c.currentTime + 0.15;
    const stops = [];
    let pending = 0, stopped = false, end = t0;
    const finished = () => { if (--pending === 0) bus.disconnect(); };
    (events || []).forEach(e => {
      if (!e || !Number.isFinite(e.midi)) return;
      const t = t0 + Math.max(0, +e.t || 0), dur = +e.dur || 0.5;
      pending++;
      stops.push(voice(c, bus, it, e.midi, t, dur, finished));
      end = Math.max(end, t + dur);
    });
    if (!pending) bus.disconnect();
    return {
      t0,
      end,   // 마지막 음이 끝나는 context 시각(참고용)
      stop() {
        if (stopped) return;
        stopped = true;
        const now = c.currentTime, g = bus.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0, now + 0.05);
        stops.forEach(s => s(now + 0.06));
        setTimeout(() => bus.disconnect(), 120);
      },
    };
  }

  function renderOffline(events, id, totalSec) {
    const it = M.instById(id);
    return loadInstrument(it.id).then(() => {
      if (!OAC) throw new Error('OfflineAudioContext not supported');
      const sr = 44100, sec = Math.max(0.5, +totalSec || 0);
      const oc = new OAC(2, Math.ceil(sec * sr), sr);
      const ch = buildChain(oc, RENDER_LEVEL);
      (events || []).forEach(e => {
        if (e && Number.isFinite(e.midi)) voice(oc, ch.input, it, e.midi, Math.max(0, +e.t || 0), +e.dur || 0.5);
      });
      if (sec > 1) {   // 끝에서 뚝 끊기지 않게
        ch.master.gain.setValueAtTime(RENDER_LEVEL, sec - 0.25);
        ch.master.gain.linearRampToValueAtTime(0, sec);
      }
      return new Promise((res, rej) => {
        oc.oncomplete = ev => res(ev.renderedBuffer);
        const p = oc.startRendering();
        if (p && p.then) p.then(res, rej);
      });
    });
  }

  // ---------- 메트로놈 ----------
  function click(c, t, acc) {
    const out = live.master;
    const n = c.createBufferSource(), bp = c.createBiquadFilter(), ng = c.createGain();
    n.buffer = noiseBuf(c);
    bp.type = 'bandpass'; bp.frequency.value = acc ? 2600 : 1900; bp.Q.value = 4;
    ng.gain.setValueAtTime(acc ? 0.9 : 0.55, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    n.connect(bp); bp.connect(ng); ng.connect(out);
    n.start(t, Math.random() * 0.5); n.stop(t + 0.04);
    const o = c.createOscillator(), og = c.createGain();
    o.frequency.value = acc ? 1500 : 1000;
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(acc ? 0.35 : 0.2, t + 0.001);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(og); og.connect(out);
    o.start(t); o.stop(t + 0.06);
    track([n, o], [bp, ng, og]);
  }

  const metronome = (() => {
    let timer = 0, bpm = 90, next = 0, beat = 0;
    function tick() {
      if (!ctx) return;
      const now = ctx.currentTime, spb = 60 / bpm;
      if (next < now - 0.2) while (next < now) { next += spb; beat++; }   // 탭이 잠들었다 깨면 밀린 박은 건너뜀
      while (next < now + 0.1) { click(ctx, next, beat % 4 === 0); next += 60 / bpm; beat++; }
    }
    function stop() { if (timer) clearInterval(timer); timer = 0; }
    // at(선택): 첫 박을 칠 context 시각 (예: playSequence 핸들의 t0)
    function start(b, at) {
      const c = ensure();
      if (!c) return;
      stop();
      bpm = M.clampBpm(b || bpm);
      next = Math.max(c.currentTime + 0.05, +at || 0);
      beat = 0;
      tick();
      timer = setInterval(tick, 25);
    }
    function setBpm(b) { bpm = M.clampBpm(b); }
    return { start, stop, setBpm, get running() { return !!timer; } };
  })();

  // ---------- 효과음 ----------
  // 짧은 합성음: f 에서 path 대로 미끄러지고 decay 동안 사라짐
  function blip(c, dest, o) {
    const osc = c.createOscillator(), g = c.createGain(), t = o.t, at = o.attack || 0.004;
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    (o.path || []).forEach(([f, dt]) => osc.frequency.exponentialRampToValueAtTime(f, t + dt));
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.peak, t + at);
    g.gain.setTargetAtTime(0, t + at, o.decay / 4.6);
    osc.connect(g); g.connect(dest);
    osc.start(t); osc.stop(t + at + o.decay + 0.02);
    track([osc], [g]);
  }

  function bell(c, dest, f, t, amp, len) {
    [[1, 1, 1], [2, 0.35, 0.55], [3.01, 0.16, 0.3], [5.4, 0.06, 0.15]].forEach(([r, a, d]) => {
      if (f * r < c.sampleRate * 0.45) blip(c, dest, { f: f * r, t, peak: amp * a, attack: 0.003, decay: d * len });
    });
  }

  function loadApplause() {
    if (applause || applauseLoading) return applauseLoading;
    applauseLoading = fetchBuffer(BASE + 'applause-mp3/C4.mp3')
      .then(b => { applause = b; }, () => { applauseLoading = null; });
    return applauseLoading;
  }

  function playApplause(c, out, t) {
    const L = 2.2;
    if (applause) {
      const src = c.createBufferSource(), g = c.createGain(), D = applause.duration;
      src.buffer = applause;
      if (D < L + 0.1) { src.loop = true; src.loopStart = D * 0.3; src.loopEnd = D * 0.9; }
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.06);
      g.gain.setValueAtTime(0.5, t + L - 0.6);
      g.gain.linearRampToValueAtTime(0, t + L);
      src.connect(g); g.connect(out);
      src.start(t); src.stop(t + L + 0.02);
      track([src], [g]);
      return;
    }
    loadApplause();
    // 샘플이 아직 없으면 잡음으로 박수
    for (let i = 0; i < 46; i++) {
      const tt = t + Math.pow(Math.random(), 1.4) * 1.9, fade = 1 - (tt - t) / 2.1;
      const n = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
      n.buffer = noiseBuf(c);
      bp.type = 'bandpass'; bp.frequency.value = 900 + Math.random() * 1800; bp.Q.value = 1.4;
      g.gain.setValueAtTime(0.5 * fade * (0.6 + Math.random() * 0.4), tt);
      g.gain.exponentialRampToValueAtTime(0.001, tt + 0.03 + Math.random() * 0.04);
      n.connect(bp); bp.connect(g); g.connect(out);
      n.start(tt, Math.random() * 0.8); n.stop(tt + 0.08);
      track([n], [bp, g]);
    }
  }

  function sfx(name) {
    const c = ensure();
    if (!c) return;
    const out = live.master, t = c.currentTime + 0.01;
    switch (name) {
      case 'pop':
        blip(c, out, { f: 700, path: [[260, 0.09]], t, peak: 0.28, decay: 0.12 });
        break;
      case 'card':
        blip(c, out, { type: 'triangle', f: 2400, path: [[2000, 0.03]], t, peak: 0.12, attack: 0.002, decay: 0.05 });
        break;
      case 'success':
        [84, 88, 91, 96].forEach((m, i) => bell(c, out, hz(m), t + i * 0.085, 0.14, i === 3 ? 1.8 : 1));
        break;
      case 'oops':
        [[294, 0], [220, 0.2]].forEach(([f, dt]) => blip(c, out, {
          type: 'triangle', f: f * 0.75, path: [[f * 1.03, 0.05], [f * 0.93, 0.35]],
          t: t + dt, peak: 0.3, attack: 0.01, decay: 0.4,
        }));
        break;
      case 'applause':
        playApplause(c, out, t);
        break;
      default:
        break;
    }
  }

  return {
    get ctx() { return ctx; },
    get volume() { return volume; },
    ensure, setVolume, loadInstrument, preload: loadInstrument, isReady,
    play, playSequence, renderOffline, metronome, sfx,
  };
})();
