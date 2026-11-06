// FIFTY-EIGHTH follow-up: minimal react-native-audio-api stand-in for test14.mjs.
// Every node/param accepts any call; gain values are real so tests can read them.
const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
const node = () => new Proxy({ gain: param(), frequency: param(), detune: param(), pan: param(), Q: param(), playbackRate: param(), semitones: param(), connect() {}, disconnect() {}, start() {}, stop() {}, buffer: null, loop: false }, {
  get(t, k) { if (!(k in t)) t[k] = typeof k === 'string' && /^[a-z]/.test(k) ? (() => {}) : undefined; return t[k]; },
});
export class AudioContext {
  constructor() { this.currentTime = 0; this.sampleRate = 48000; this.destination = node(); this.state = 'running'; globalThis.__ctx = this; }
  createGain() { const n = node(); (globalThis.__gains = globalThis.__gains || []).push(n); return n; }
  createOscillator() { return node(); } createStereoPanner() { return node(); } createBiquadFilter() { return node(); }
  createBufferSource() { return node(); } createStretcher() { return node(); } createPeriodicWave() { return {}; }
  decodeAudioDataSource() { return Promise.resolve({ duration: 1, sampleRate: 48000, length: 48000, numberOfChannels: 1 }); }
  suspend() { return Promise.resolve(); } resume() { return Promise.resolve(); } close() { return Promise.resolve(); }
}
