/* ============================================================
   sound.js — Web Audio synthesized SFX + Mandarin speech
   ============================================================ */

(function () {

  let ctx = null;
  let enabled = true;

  function getCtx() {
    if (ctx) return ctx;
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    } catch (e) { return null; }
    return ctx;
  }

  // Browsers block audio until a user gesture — resume on the first one.
  function resume() {
    const c = getCtx();
    if (c && c.state === 'suspended') c.resume();
  }
  document.addEventListener('click', resume);
  document.addEventListener('keydown', resume);

  // ---- Primitives -----------------------------------------------------

  function noiseBuffer(durMs) {
    const c = getCtx();
    const sr = c.sampleRate;
    const buf = c.createBuffer(1, Math.max(1, Math.floor(sr * durMs / 1000)), sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Percussive "clack" — band-passed noise burst, good for tile sounds.
  function clack(opts) {
    if (!enabled) return;
    const c = getCtx(); if (!c) return;
    opts = opts || {};
    const dur  = opts.dur  || 80;
    const freq = opts.freq || 2400;
    const Q    = opts.Q    || 6;
    const vol  = opts.vol  || 0.25;

    const src  = c.createBufferSource();
    src.buffer = noiseBuffer(dur);
    const filt = c.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = freq;
    filt.Q.value = Q;
    const gain = c.createGain();
    const t0 = c.currentTime;
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur / 1000);

    src.connect(filt); filt.connect(gain); gain.connect(c.destination);
    src.start(t0);
  }

  // Pitched tone with attack/decay envelope.
  function tone(freq, durMs, opts) {
    if (!enabled) return;
    const c = getCtx(); if (!c) return;
    opts = opts || {};
    const type    = opts.type    || 'sine';
    const vol     = opts.vol     || 0.18;
    const delayMs = opts.delay   || 0;

    const t0  = c.currentTime + delayMs / 1000;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + durMs / 1000);

    osc.connect(gain); gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + durMs / 1000 + 0.05);
  }

  function melody(notes) {
    let t = 0;
    for (const n of notes) {
      tone(n[0], n[1], { vol: n[2] || 0.2, delay: t });
      t += n[1] * 0.85;
    }
  }

  // ---- Mandarin speech (Web Speech API) -------------------------------

  const synth = (typeof window !== 'undefined') ? window.speechSynthesis : null;
  let cachedZhVoice = null;

  function pickZhVoice() {
    if (!synth) return null;
    if (cachedZhVoice) return cachedZhVoice;
    const voices = synth.getVoices();
    // Prefer Mandarin China; fall back to any Chinese voice.
    cachedZhVoice =
      voices.find(v => /zh[-_]CN/i.test(v.lang)) ||
      voices.find(v => /^zh/i.test(v.lang)) ||
      voices.find(v => /chinese|mandarin/i.test(v.name)) ||
      null;
    return cachedZhVoice;
  }
  if (synth) {
    // Voices load async on most browsers.
    synth.addEventListener && synth.addEventListener('voiceschanged', () => {
      cachedZhVoice = null;
      pickZhVoice();
    });
  }

  function speak(text, opts) {
    if (!enabled || !synth || !text) return;
    opts = opts || {};
    try {
      // Latest call wins — interrupt any queued/in-flight speech so the
      // most recent action is what the player actually hears.
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = pickZhVoice();
      if (v) u.voice = v;
      u.lang   = (v && v.lang) || 'zh-CN';
      u.rate   = opts.rate   != null ? opts.rate   : 1.05;
      u.pitch  = opts.pitch  != null ? opts.pitch  : 1.0;
      u.volume = opts.volume != null ? opts.volume : 1.0;
      synth.speak(u);
    } catch (e) { /* no-op */ }
  }

  // Tile → spoken Mandarin name.
  const NUM_CN = ['一','二','三','四','五','六','七','八','九'];
  const WIND_CN_NAMES   = { 1: '东风', 2: '南风', 3: '西风', 4: '北风' };
  const DRAGON_CN_NAMES = { 1: '红中', 2: '发财', 3: '白板' };
  function tileSpeechText(t) {
    if (!t) return '';
    if (t.suit === 'm') return NUM_CN[t.num - 1] + '万';
    if (t.suit === 'p') return NUM_CN[t.num - 1] + '筒';
    if (t.suit === 's') return NUM_CN[t.num - 1] + '索';
    if (t.suit === 'w') return WIND_CN_NAMES[t.num] || '';
    if (t.suit === 'd') return DRAGON_CN_NAMES[t.num] || '';
    return '';
  }
  function sayTile(tile) { speak(tileSpeechText(tile)); }

  // ---- Public API -----------------------------------------------------

  window.Sound = {
    // Discard: clack + (optional) Mandarin tile name.
    discard: (tile) => {
      clack({ freq: 2400, vol: 0.30, dur: 90 });
      if (tile) sayTile(tile);
    },
    draw: () => clack({ freq: 3500, vol: 0.12, dur: 30 }),

    pong: () => {
      tone(330, 220, { type: 'triangle', vol: 0.22 });
      tone(440, 220, { type: 'triangle', vol: 0.18, delay: 60 });
      speak('碰');
    },
    kong: () => {
      tone(262, 260, { type: 'triangle', vol: 0.22 });
      tone(330, 260, { type: 'triangle', vol: 0.20, delay: 70 });
      tone(392, 260, { type: 'triangle', vol: 0.18, delay: 140 });
      speak('杠');
    },
    chi: () => {
      tone(523, 160, { type: 'triangle', vol: 0.20 });
      tone(659, 160, { type: 'triangle', vol: 0.18, delay: 80 });
      speak('吃');
    },
    hu: () => {
      melody([[523, 140], [659, 140], [784, 140], [1047, 350]]);
      speak('胡');
    },
    win: () => melody([
      [523, 180], [659, 180], [784, 180], [1047, 280],
      [784, 180], [1047, 500, 0.25],
    ]),
    wash: () => melody([
      [392, 180], [330, 180], [262, 350],
    ]),

    sayTile,
    speak,
    setEnabled: (e) => {
      enabled = !!e;
      if (!e && synth) { try { synth.cancel(); } catch (_) {} }
    },
    isEnabled:  () => enabled,
  };

})();
