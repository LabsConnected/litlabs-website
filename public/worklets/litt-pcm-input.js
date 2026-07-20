// LiTTree PCM input worklet — captures raw 16kHz mono PCM from microphone
// and posts it to the AudioWorkletProcessor port for WebSocket streaming.

class LittPcmInputProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelData = input[0];
    if (!channelData || channelData.length === 0) return true;

    // Convert Float32 [-1, 1] to 16-bit PCM
    const pcm16 = new Int16Array(channelData.length);
    for (let i = 0; i < channelData.length; i++) {
      const s = Math.max(-1, Math.min(1, channelData[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    // Post the PCM data to the main thread for WebSocket sending
    this.port.postMessage(pcm16.buffer, [pcm16.buffer]);

    return true;
  }
}

registerProcessor("litt-pcm-input", LittPcmInputProcessor);
