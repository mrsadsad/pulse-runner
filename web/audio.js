(function (root) {
  'use strict';
  // All sounds are synthesized locally. Nothing is downloaded or streamed.
  class Soundscape {
    constructor() { this.context = null; this.enabled = true; this.musicEnabled = true; this.voices = new Set(); this.nextBeat = null; }
    unlock() {
      try {
        if (!this.context) {
          const Audio = window.AudioContext || window.webkitAudioContext;
          if (!Audio) return;
          this.context = new Audio();
          this.master = this.context.createGain(); this.master.gain.value = .65;
          this.compressor = this.context.createDynamicsCompressor();
          this.compressor.threshold.value = -16; this.compressor.ratio.value = 4;
          this.master.connect(this.compressor); this.compressor.connect(this.context.destination);
          this.noiseBuffer = this.context.createBuffer(1, this.context.sampleRate * .4, this.context.sampleRate);
          const data = this.noiseBuffer.getChannelData(0);
          for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        }
        if (this.context.state === 'suspended') this.context.resume().catch(() => {});
      } catch (_) { /* Unsupported audio remains optional. */ }
    }
    configure(enabled, music) {
      this.enabled = enabled; this.musicEnabled = music;
      if (!enabled) this.silence();
      this.nextBeat = null;
    }
    silence() {
      for (const voice of this.voices) { try { voice.stop(); } catch (_) {} }
      this.voices.clear(); this.nextBeat = null;
    }
    suspend() {
      this.silence();
      if (this.context && this.context.state === 'running') this.context.suspend().catch(() => {});
    }
    remember(source, nodes) {
      this.voices.add(source);
      source.onended = () => { this.voices.delete(source); for (const node of nodes) { try { node.disconnect(); } catch (_) {} } };
    }
    tone(frequency, duration, type, volume, delay, endFrequency, pan) {
      const a = this.context;
      if (!this.enabled || !a || a.state !== 'running' || this.voices.size > 48) return;
      try {
        const at = a.currentTime + (delay || 0), source = a.createOscillator(), gain = a.createGain();
        source.type = type || 'sine'; source.frequency.setValueAtTime(frequency, at);
        if (endFrequency) source.frequency.exponentialRampToValueAtTime(endFrequency, at + duration);
        gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(Math.max(.001, volume || .05), at + .008);
        gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
        source.connect(gain);
        const nodes = [source, gain];
        if (a.createStereoPanner && pan) { const panner = a.createStereoPanner(); panner.pan.value = pan; gain.connect(panner); panner.connect(this.master); nodes.push(panner); }
        else gain.connect(this.master);
        this.remember(source, nodes); source.start(at); source.stop(at + duration + .025);
      } catch (_) {}
    }
    noise(duration, volume, cutoff, delay) {
      const a = this.context;
      if (!this.enabled || !a || a.state !== 'running' || this.voices.size > 48) return;
      try {
        const at = a.currentTime + (delay || 0), source = a.createBufferSource(), filter = a.createBiquadFilter(), gain = a.createGain();
        source.buffer = this.noiseBuffer; filter.type = 'lowpass'; filter.frequency.value = cutoff;
        gain.gain.setValueAtTime(volume, at); gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
        source.connect(filter); filter.connect(gain); gain.connect(this.master);
        this.remember(source, [source, filter, gain]); source.start(at); source.stop(at + duration);
      } catch (_) {}
    }
    play(kind, detail) {
      const n = detail || 0;
      if (kind === 'left' || kind === 'right') {
        this.tone(kind === 'left' ? 210 : 260, .075, 'sine', .06, 0, 150, kind === 'left' ? -.5 : .5);
        this.noise(.04, .025, 1800);
      } else if (kind === 'jump') {
        this.tone(180, .20, 'triangle', .11, 0, 650);
        this.tone(440, .18, 'sine', .035, .04, 880); this.noise(.08, .045, 1700);
      } else if (kind === 'land') {
        this.tone(105, .12, 'sine', .105, 0, 38); this.noise(.07, .06, 850);
      } else if (kind === 'gem') {
        const notes = [659, 784, 880, 1047, 1175]; const note = notes[Math.max(0, n - 1) % notes.length];
        this.tone(note, .12, 'sine', .065); this.tone(note * 2, .15, 'sine', .018, .02);
        if (n > 0 && n % 5 === 0) { this.tone(523, .18, 'triangle', .045, .04); this.tone(1047, .24, 'sine', .04, .1); }
      } else if (kind === 'crash') {
        this.noise(.28, .18, 1400); this.tone(125, .34, 'sawtooth', .11, 0, 30); this.tone(52, .30, 'sine', .16);
      } else if (kind === 'win') {
        [523, 659, 784, 1047].forEach((note, i) => this.tone(note, .45, 'sine', .08, i * .12));
        this.tone(131, .65, 'triangle', .07, .15);
      } else if (kind === 'perfect') {
        this.tone(1568, .15, 'sine', .035); this.tone(2093, .20, 'sine', .025, .06);
      } else if (kind === 'count') this.tone(330, .1, 'sine', .045);
      else if (kind === 'go') { this.tone(660, .22, 'sine', .08); this.tone(1320, .12, 'sine', .025, .03); }
    }
    tick(time, chapter, combo) {
      if (!this.enabled || !this.musicEnabled || !this.context || this.context.state !== 'running') return;
      const beatLength = 60 / [104, 116, 128][chapter - 1] / 2;
      const beat = Math.floor(time / beatLength);
      if (this.nextBeat === null || beat < this.nextBeat - 2 || beat > this.nextBeat + 2) this.nextBeat = beat;
      if (beat < this.nextBeat) return;
      this.nextBeat = beat + 1;
      const bass = [[55, 55, 65.4, 49], [65.4, 73.4, 55, 65.4], [73.4, 65.4, 55, 49]][chapter - 1];
      const rootNote = bass[Math.floor(beat / 8) % 4];
      if (beat % 2 === 0) { this.tone(100, .16, 'sine', .105, 0, 36); this.tone(rootNote, .24, 'triangle', .045); }
      if (beat % 4 === 2) this.noise(.075, .042, 2400);
      if (beat % 2) this.noise(.032, .020, 6500);
      const scale = [4, 6, 8, 6, 5, 6, 10, 8];
      this.tone(rootNote * scale[beat % 8], .20, chapter === 2 ? 'sine' : 'triangle', .018 + Math.min(combo, 15) * .0005);
      if (beat % 8 === 0) { this.tone(rootNote * 4, .8, 'sine', .018); this.tone(rootNote * 6, .8, 'sine', .014); }
    }
  }
  root.PulseAudio = Soundscape;
})(window);
