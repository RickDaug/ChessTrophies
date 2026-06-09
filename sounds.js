/* ChessTrophies sound system.
   Synthesizes all sounds via Web Audio API — no external audio files needed.
   Exposes window.ChessSounds.{move,capture,check,castle,promotion,gameOver,
   trophy,trophyOops,streakMilestone,note,thud,setMuted,toggle,isMuted}.

   Piece sounds (move/capture/castle) are modeled as a wooden "knock": a short
   filtered-noise transient (the tap) layered with a fast-decaying pitched body
   (the wood resonance), with a touch of per-move pitch variation so repeated
   moves don't sound mechanically identical. Everything routes through a shared
   limiter so layered cues (e.g. a trophy fanfare) never clip or get harsh.
*/
(function () {
  'use strict';

  let audioCtx = null;
  let masterNode = null;
  let muted = (() => {
    try { return localStorage.getItem('ct_sound_muted') === '1'; } catch (e) { return false; }
  })();

  function ctx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    // Resume if suspended (browsers suspend audio until first user gesture)
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  // Shared output bus: a gentle limiter (compressor) + makeup gain so layering
  // several voices stays clean. Lazily built on the live AudioContext.
  function master(c) {
    if (masterNode && masterNode.context === c) return masterNode;
    const comp = c.createDynamicsCompressor();
    try {
      comp.threshold.setValueAtTime(-10, c.currentTime);
      comp.knee.setValueAtTime(22, c.currentTime);
      comp.ratio.setValueAtTime(6, c.currentTime);
      comp.attack.setValueAtTime(0.002, c.currentTime);
      comp.release.setValueAtTime(0.18, c.currentTime);
    } catch (e) {}
    const g = c.createGain();
    g.gain.value = 0.92;
    comp.connect(g);
    g.connect(c.destination);
    masterNode = comp;
    return masterNode;
  }

  // Play a single oscillator note with an envelope (musical cues).
  function note(freq, duration, type = 'sine', volume = 0.18, attack = 0.01) {
    if (muted) return;
    const c = ctx(); if (!c) return;
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(master(c));
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  // Wooden piece "knock": filtered-noise tap + a fast-decaying pitched body.
  //   opts: { vol, dur, bright (bandpass center Hz), q, bodyFreq }
  function knock(opts) {
    if (muted) return;
    const c = ctx(); if (!c) return;
    opts = opts || {};
    const t0 = c.currentTime;
    const out = master(c);
    const dur = opts.dur || 0.07;
    const vol = opts.vol != null ? opts.vol : 0.22;

    // 1) Noise transient — the percussive tap. Decays fast (pow shapes the body).
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.2);
    const src = c.createBufferSource(); src.buffer = buf;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = opts.bright || 1400; bp.Q.value = opts.q || 1.2;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(out);
    src.start(t0);

    // 2) Pitched body — the low "thunk" of wood, a quick downward chirp.
    const bf = opts.bodyFreq || 190;
    const osc = c.createOscillator(); osc.type = 'triangle';
    osc.frequency.setValueAtTime(bf * 1.6, t0);
    osc.frequency.exponentialRampToValueAtTime(bf, t0 + 0.05);
    const og = c.createGain();
    og.gain.setValueAtTime(vol * 0.5, t0);
    og.gain.exponentialRampToValueAtTime(0.0008, t0 + Math.min(0.13, dur + 0.06));
    osc.connect(og); og.connect(out);
    osc.start(t0); osc.stop(t0 + 0.16);
  }

  // Short percussive "thud" (legacy helper; kept for direct callers). Routed
  // through the limiter now.
  function thud(volume = 0.2, duration = 0.06) {
    if (muted) return;
    const c = ctx(); if (!c) return;
    const t0 = c.currentTime;
    const bufferSize = Math.max(1, Math.floor(c.sampleRate * duration));
    const buf = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    const gain = c.createGain();
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    src.connect(filter); filter.connect(gain); gain.connect(master(c));
    src.start(t0);
  }

  // Slight pitch wobble per move so the same sound doesn't repeat mechanically.
  function vary(span) { return 1 + (Math.random() * span * 2 - span); }

  const Sounds = {
    move() {
      const r = vary(0.06);
      knock({ vol: 0.20, dur: 0.065, bright: 1200 * r, bodyFreq: 175 * r, q: 1.1 });
    },
    capture() {
      // A light slide into a sharper, brighter clack (two impacts).
      knock({ vol: 0.15, dur: 0.05, bright: 880, bodyFreq: 150, q: 1.0 });
      setTimeout(() => knock({ vol: 0.28, dur: 0.085, bright: 1900 * vary(0.05), bodyFreq: 225, q: 1.6 }), 36);
    },
    check() {
      note(660, 0.08, 'square', 0.18);
      setTimeout(() => note(880, 0.12, 'square', 0.16), 90);
    },
    castle() {
      // King then rook — two wooden placements.
      knock({ vol: 0.20, dur: 0.06, bright: 1300, bodyFreq: 180, q: 1.1 });
      setTimeout(() => knock({ vol: 0.22, dur: 0.07, bright: 1500, bodyFreq: 205, q: 1.2 }), 110);
    },
    promotion() {
      note(330, 0.08, 'sine', 0.18);
      setTimeout(() => note(440, 0.08, 'sine', 0.18), 100);
      setTimeout(() => note(660, 0.18, 'sine', 0.22), 200);
    },
    gameOver(won) {
      if (won) {
        // Major triad ascending
        note(523, 0.12, 'sine', 0.22);          // C5
        setTimeout(() => note(659, 0.12, 'sine', 0.22), 130);  // E5
        setTimeout(() => note(784, 0.25, 'sine', 0.26), 260);  // G5
        setTimeout(() => note(1047, 0.4, 'sine', 0.3), 420);   // C6
      } else {
        // Descending minor
        note(440, 0.15, 'sine', 0.22);          // A4
        setTimeout(() => note(349, 0.25, 'sine', 0.2), 170);   // F4
      }
    },
    // Triumphant ascending fanfare for earning a (good) trophy.
    trophy() {
      note(523, 0.12, 'triangle', 0.22);            // C5
      setTimeout(() => note(659, 0.12, 'triangle', 0.22), 90);   // E5
      setTimeout(() => note(784, 0.12, 'triangle', 0.24), 180);  // G5
      setTimeout(() => note(1047, 0.30, 'triangle', 0.28), 270); // C6
      setTimeout(() => note(1319, 0.40, 'sine', 0.26), 430);     // E6 shimmer
    },
    // Comedic "not so triumphant" cue for an embarrassing (Oops) trophy.
    trophyOops() {
      note(415, 0.18, 'sawtooth', 0.16);           // Ab4
      setTimeout(() => note(392, 0.20, 'sawtooth', 0.16), 170);  // G4
      setTimeout(() => note(370, 0.22, 'sawtooth', 0.16), 360);  // Gb4
      setTimeout(() => note(294, 0.42, 'sawtooth', 0.18), 560);  // D4 (wah-wah drop)
    },
    // Distinct, grander cue for completing a 7-win streak trophy.
    streakMilestone() {
      note(523, 0.12, 'triangle', 0.22);            // C5
      setTimeout(() => note(659, 0.12, 'triangle', 0.22), 80);   // E5
      setTimeout(() => note(784, 0.12, 'triangle', 0.24), 160);  // G5
      setTimeout(() => note(1047, 0.14, 'triangle', 0.26), 240); // C6
      setTimeout(() => note(1319, 0.16, 'square', 0.20), 340);   // E6
      setTimeout(() => note(1568, 0.45, 'sine', 0.30), 460);     // G6 big finish
      setTimeout(() => knock({ vol: 0.22, dur: 0.12, bright: 700, bodyFreq: 120, q: 0.9 }), 470); // soft boom
    },
    // Low-level voices, exposed for direct callers (e.g. a draw chime).
    note,
    thud,
    knock,
    setMuted(m) {
      muted = !!m;
      try { localStorage.setItem('ct_sound_muted', muted ? '1' : '0'); } catch (e) {}
    },
    toggle() { Sounds.setMuted(!muted); return muted; },
    isMuted() { return muted; },
  };

  window.ChessSounds = Sounds;
})();
