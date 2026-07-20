// LiTTree PCM output worklet — receives 24kHz mono PCM from the main thread
// via port.postMessage and plays it through the AudioWorkletProcessor output.

class LittPcmOutputProcessor extends AudioWorkletProcessor {
  private buffer: Float32Array[] = [];

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const channel = output[0];
    if (!channel) return true;

    // Fill output from buffered PCM data
    let written = 0;
    while (written < channel.length && this.buffer.length > 0) {
      const chunk = this.buffer[0];
      const remaining = chunk.length;
      const needed = channel.length - written;

      if (remaining <= needed) {
        channel.set(chunk, written);
        written += remaining;
        this.buffer.shift();
      } else {
        channel.set(chunk.subarray(0, needed), written);
        this.buffer[0] = chunk.subarray(needed);
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

// Receive PCM data from main thread
self.addEventListener("message", (e: MessageEvent) => {
  const data = e.data;
  if (data instanceof ArrayBuffer) {
    // Convert 16-bit PCM to Float32
    const pcm16 = new Int16Array(data);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 0x8000;
    }
    // Access the processor's buffer via global scope
    // This is a workaround — the processor instance is in the same scope
    (self as unknown as { __littBuffer?: Float32Array[] }).__littBuffer?.push(float32);
  } else if (data?.type === "clear") {
    (self as unknown as { __littBuffer?: Float32Array[] }).__littBuffer = [];
  }
});

// Initialize buffer on the processor scope
(self as unknown as { __littBuffer: Float32Array[] }).__littBuffer = [];

// Override process to use the global buffer
const origProcess = LittPcmOutputProcessor.prototype.process;
LittPcmOutputProcessor.prototype.process = function (
  _inputs: Float32Array[][],
  outputs: Float32Array[][],
): boolean {
  const output = outputs[0];
  if (!output || output.length === 0) return true;
  const channel = output[0];
  if (!channel) return true;

  const buf = (self as unknown as { __littBuffer: Float32Array[] }).__littBuffer;
  let written = 0;
  while (written < channel.length && buf.length > 0) {
    const chunk = buf[0];
    const remaining = chunk.length;
    const needed = channel.length - written;
    if (remaining <= needed) {
      channel.set(chunk, written);
      written += remaining;
      buf.shift();
    } else {
      channel.set(chunk.subarray(0, needed), written);
      buf[0] = chunk.subarray(needed);
      written = channel.length;
    }
  }
  for (let i = written; i < channel.length; i++) {
    channel[i] = 0;
  }
  return true;
};

registerProcessor("litt-pcm-output", LittPcmOutputProcessor);
