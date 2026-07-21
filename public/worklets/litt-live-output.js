// LiTTree Live output worklet — receives 24 kHz signed Int16 PCM from
// the main thread, queues samples, plays continuously without gaps,
// and clears immediately during interruption.

class LittLiveOutputProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._maxBufferChunks = 50; // prevent unbounded memory

    this.port.onmessage = (e) => {
      const data = e.data;
      if (data instanceof ArrayBuffer) {
        // Convert 16-bit PCM to Float32
        const pcm16 = new Int16Array(data);
        const float32 = new Float32Array(pcm16.length);
        for (let i = 0; i < pcm16.length; i++) {
          float32[i] = pcm16[i] / 0x8000;
        }
        this._buffer.push(float32);
        if (this._buffer.length > this._maxBufferChunks) {
          this._buffer.shift();
        }
      } else if (data && data.type === "clear") {
        this._buffer = [];
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const channel = output[0];
    if (!channel) return true;

    let written = 0;
    while (written < channel.length && this._buffer.length > 0) {
      const chunk = this._buffer[0];
      const remaining = chunk.length;
      const needed = channel.length - written;

      if (remaining <= needed) {
        channel.set(chunk, written);
        written += remaining;
        this._buffer.shift();
      } else {
        channel.set(chunk.subarray(0, needed), written);
        this._buffer[0] = chunk.subarray(needed);
        written = channel.length;
      }
    }

    // Zero-fill any remaining samples
    for (let i = written; i < channel.length; i++) {
      channel[i] = 0;
    }

    return true;
  }
}

registerProcessor("litt-live-output", LittLiveOutputProcessor);
