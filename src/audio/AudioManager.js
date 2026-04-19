// ============================================================
//  src/audio/AudioManager.js — Howler.js Audio System
// ============================================================

export class AudioManager {
  constructor (events, logger) {
    this.events      = events;
    this.logger      = logger;
    this._muted      = false;
    this._sounds     = new Map();
    this._initialized = false;
  }

  init () {
    if (this._initialized) return;
    if (typeof Howler !== 'undefined' && typeof Howler.autoUnlock !== 'undefined') {
      Howler.autoUnlock = true;
    }
    this._initSounds();
    this._initialized = true;

    if (typeof Howler !== 'undefined' && Howler.ctx && Howler.ctx.state === 'suspended') {
      Howler.ctx.resume().catch(() => {});
    }
  }

  // ── Sound Library ─────────────────────────────────────────
  _initSounds () {
    /*
     * We synthesize sounds via the Web Audio API since we have
     * no asset files.  Each "Howl" is built from a tiny base64
     * WAV — we generate them procedurally and convert to data-URI.
     * For a real project, swap these for actual files.
     */

    // Ambient drone (looping)
    this._sounds.set('ambient', new Howl({
      src: [this._generateTone(220, 2.0, 'sine', 0.04)],
      loop:   true,
      volume: 0.06,
    }));

    // Spawn pop
    this._sounds.set('spawn', new Howl({
      src: [this._generateTone(880, 0.12, 'square', 0.3)],
      volume: 0.4,
    }));

    // Clear whoosh
    this._sounds.set('clear', new Howl({
      src: [this._generateSweep(800, 200, 0.25, 0.2)],
      volume: 0.35,
    }));

    // Select blip
    this._sounds.set('select', new Howl({
      src: [this._generateTone(1200, 0.07, 'sine', 0.35)],
      volume: 0.3,
    }));

    this.logger.success('Audio system ready (Howler.js)');
  }

  // ── Public API ─────────────────────────────────────────────
  playAmbient () {
    this.init();
    const s = this._sounds.get('ambient');
    if (s && !s.playing()) s.play();
  }

  stopAmbient () {
    if (!this._initialized) return;
    this._sounds.get('ambient')?.stop();
  }

  playSfx (name) {
    this.init();
    const s = this._sounds.get(name);
    if (s) s.play();
  }

  stopAll () {
    for (const s of this._sounds.values()) s.stop();
  }

  toggleMute () {
    this.init();
    this._muted = !this._muted;
    Howler.mute(this._muted);
    return this._muted;
  }

  isMuted () { return this._muted; }

  setVolume (name, vol) {
    this._sounds.get(name)?.volume(vol);
  }

  // ── Procedural Sound Generation ───────────────────────────
  /** Returns a data-URI WAV for a pure tone. */
  _generateTone (freq, duration, waveType = 'sine', amplitude = 0.3) {
    const sampleRate = 22050;
    const samples    = Math.floor(sampleRate * duration);
    const buffer     = new Float32Array(samples);

    for (let i = 0; i < samples; i++) {
      const t     = i / sampleRate;
      const phase = 2 * Math.PI * freq * t;
      const env   = Math.exp(-t * (3 / duration));   // exponential decay

      switch (waveType) {
        case 'square': buffer[i] = Math.sign(Math.sin(phase)) * amplitude * env; break;
        case 'sawtooth': buffer[i] = ((t * freq % 1) - 0.5) * 2 * amplitude * env; break;
        default: buffer[i] = Math.sin(phase) * amplitude * env;
      }
    }
    return this._floatArrayToWavDataURI(buffer, sampleRate);
  }

  /** Returns a data-URI WAV for a frequency sweep. */
  _generateSweep (startFreq, endFreq, duration, amplitude = 0.3) {
    const sampleRate = 22050;
    const samples    = Math.floor(sampleRate * duration);
    const buffer     = new Float32Array(samples);
    let   phase      = 0;

    for (let i = 0; i < samples; i++) {
      const t    = i / samples;
      const freq = startFreq + (endFreq - startFreq) * t;
      const env  = (1 - t) * amplitude;
      phase += (2 * Math.PI * freq) / sampleRate;
      buffer[i] = Math.sin(phase) * env;
    }
    return this._floatArrayToWavDataURI(buffer, sampleRate);
  }

  _floatArrayToWavDataURI (floatBuffer, sampleRate) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataLen = floatBuffer.length * 2;
    const buf = new ArrayBuffer(44 + dataLen);
    const view = new DataView(buf);

    // WAV header
    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataLen, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, 'data');
    view.setUint32(40, dataLen, true);

    // PCM samples
    let off = 44;
    for (let i = 0; i < floatBuffer.length; i++) {
      const s = Math.max(-1, Math.min(1, floatBuffer[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }

    // Convert to base64 data URI
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return 'data:audio/wav;base64,' + btoa(bin);
  }
}