/* ChessTrophies sound system.
   Synthesizes all sounds via Web Audio API — no external audio files needed.
   Exposes window.ChessSounds.{move,capture,check,castle,promotion,gameOver,setMuted,toggle,isMuted}.
*/
(function () {
  'use strict';

  let audioCtx = null;
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

  // Play a single oscillator note with an envelope.
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
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  // Short percussive "thud" using filtered noise.
  function thud(volume = 0.2, duration = 0.06) {
    if (muted) return;
    const c = ctx(); if (!c) return;
    const t0 = c.currentTime;
    const bufferSize = Math.floor(c.sampleRate * duration);
    const buf = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    const gain = c.createGain();
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    src.connect(filter); filter.connect(gain); gain.connect(c.destination);
    src.start(t0);
  }

  const Sounds = {
    move()    { note(220, 0.07, 'triangle', 0.12); thud(0.1, 0.04); },
    capture() { note(140, 0.04, 'square', 0.18); setTimeout(() => thud(0.18, 0.07), 20); },
    check()   {
      note(660, 0.08, 'square', 0.18);
      setTimeout(() => note(880, 0.12, 'square', 0.16), 90);
    },
    castle()  {
      thud(0.15, 0.05);
      setTimeout(() => thud(0.15, 0.05), 90);
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
    trophy() {
      note(587, 0.1, 'sine', 0.2);              // D5
      setTimeout(() => note(880, 0.1, 'sine', 0.22), 100);     // A5
      setTimeout(() => note(1174, 0.25, 'sine', 0.25), 210);   // D6
    },
    setMuted(m) {
      muted = !!m;
      try { localStorage.setItem('ct_sound_muted', muted ? '1' : '0'); } catch (e) {}
    },
    toggle() { Sounds.setMuted(!muted); return muted; },
    isMuted() { return muted; },
  };

  window.ChessSounds = Sounds;
})();
