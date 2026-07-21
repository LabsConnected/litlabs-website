// LiTTree Live input worklet — captures browser mic float samples,
// resamples to 16 kHz, converts to signed little-endian Int16 PCM,
// and sends chunks every 20–40 ms via transferred ArrayBuffer.

class LittLiveInputProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Input sample rate is the AudioContext sampleRate (typically 44100 or 48000).
    // We need to resample to 16000 Hz.
    this._inputSampleRate = sampleRate; // global in AudioWorkletGlobalScope
    this._targetSampleRate = 16000;
    this._ratio = this._inputSampleRate / this._targetSampleRate;
    this._resamplePhase = 0;
    this._chunkAccumulator = [];
    this._chunkIntervalMs = 30;
    this._samplesPerChunk = Math.floor(this._targetSampleRate * (this._chunkIntervalMs / 1000));
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelData = input[0];
    if (!channelData || channelData.length === 0) return true;

    // Linear interpolation resampling from inputRate to 16kHz
    const resampled = [];
    while (this._resamplePhase < channelData.length) {
      const idx = Math.floor(this._resamplePhase);
      const frac = this._resamplePhase - idx;
      const s0 = channelData[idx] || 0;
      const s1 = channelData[idx + 1] || s0;
      const sample = s0 + (s1 - s0) * frac;
      resampled.push(sample);
      this._resamplePhase += this._ratio;
    }
    this._resamplePhase -= channelData.length;

    // Convert Float32 [-1, 1] to 16-bit PCM
    const pcm16 = new Int16Array(resampled.length);
    for (let i = 0; i < resampled.length; i++) {
      const s = Math.max(-1, Math.min(1, resampled[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    this._chunkAccumulator.push(pcm16);
    const totalSamples = this._chunkAccumulator.reduce((a, c) => a + c.length, 0);

    if (totalSamples >= this._samplesPerChunk) {
      const merged = new Int16Array(totalSamples);
      let offset = 0;
      for (const chunk of this._chunkAccumulator) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      this._chunkAccumulator = [];

      const buffer = merged.buffer;
      this.port.postMessage(buffer, [buffer]);
    }

    return true;
  }
}

registerProcessor("litt-live-input", LittLiveInputProcessor);
