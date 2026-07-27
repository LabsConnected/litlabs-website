import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// PCM16 → Float32 decoding logic, extracted from useInworldSession.ts.
//
// This test verifies the EXACT conversion that the audio playback pipeline
// performs. The original code had a critical sign-extension bug where
// `bytes[i*2] | (bytes[i*2+1] << 8)` produced an UNSIGNED 0-65535 value,
// causing every negative sample to become a clipped positive — producing
// harsh, robotic, distorted audio.
// ---------------------------------------------------------------------------

const TARGET_SAMPLE_RATE = 24000;

/**
 * Decode a base64 PCM16 little-endian audio chunk to Float32 samples.
 * This mirrors the logic in useInworldSession.ts enqueueAudioChunk().
 */
function decodePcm16ToFloat32(base64Pcm16: string): Float32Array {
  const binary = atob(base64Pcm16);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const sampleCount = bytes.length / 2;
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    // Sign-extend the 16-bit value: `<< 16 >> 16` converts unsigned 0-65535
    // to signed -32768..32767. Without this, negative samples clip.
    const int16 = (bytes[i * 2] | (bytes[i * 2 + 1] << 8)) << 16 >> 16;
    float32[i] = int16 / 32768;
  }
  return float32;
}

/** Encode a Float32 sample array to base64 PCM16 little-endian (matches mic capture). */
function encodeFloat32ToPcm16Base64(samples: Float32Array): string {
  const pcm16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

describe("PCM16 → Float32 decoding", () => {
  it("decodes silence (0x0000) to 0.0", () => {
    const samples = new Float32Array([0, 0, 0, 0]);
    const decoded = decodePcm16ToFloat32(encodeFloat32ToPcm16Base64(samples));
    for (const s of decoded) {
      expect(s).toBe(0);
    }
  });

  it("decodes peak positive (0x7FFF) to ~1.0", () => {
    const samples = new Float32Array([1.0]);
    const decoded = decodePcm16ToFloat32(encodeFloat32ToPcm16Base64(samples));
    expect(decoded[0]).toBeCloseTo(1.0, 4);
  });

  // ---------------------------------------------------------------------------
  // THE CRITICAL REGRESSION TEST: before the fix, 0x8000 (the most negative
  // PCM16 value = -32768) decoded to +1.0 instead of -1.0, and 0xFFFF (-1)
  // decoded to +2.0 (clipping). This is what caused the horrible audio.
  // ---------------------------------------------------------------------------
  it("decodes peak negative (0x8000) to -1.0, NOT +1.0", () => {
    const samples = new Float32Array([-1.0]);
    const decoded = decodePcm16ToFloat32(encodeFloat32ToPcm16Base64(samples));
    expect(decoded[0]).toBeCloseTo(-1.0, 4);
    // Explicitly verify it's NOT the buggy positive value
    expect(decoded[0]).toBeLessThan(0);
  });

  it("decodes -0.5 correctly (not +1.5 or clipped)", () => {
    const samples = new Float32Array([-0.5]);
    const decoded = decodePcm16ToFloat32(encodeFloat32ToPcm16Base64(samples));
    expect(decoded[0]).toBeCloseTo(-0.5, 3);
    expect(decoded[0]).toBeLessThan(0);
  });

  it("decodes a full sine wave without sign inversion", () => {
    // Generate one period of a 440Hz sine wave at 24kHz
    const freq = 440;
    const numSamples = Math.floor(TARGET_SAMPLE_RATE / freq);
    const sine = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      sine[i] = Math.sin((2 * Math.PI * freq * i) / TARGET_SAMPLE_RATE);
    }

    const encoded = encodeFloat32ToPcm16Base64(sine);
    const decoded = decodePcm16ToFloat32(encoded);

    // The decoded wave should match the original within quantization error
    let maxError = 0;
    for (let i = 0; i < numSamples; i++) {
      maxError = Math.max(maxError, Math.abs(decoded[i] - sine[i]));
    }
    // PCM16 quantization error is at most 1/32768 ≈ 0.00003
    expect(maxError).toBeLessThan(0.001);

    // Verify the wave actually goes negative (the bug would have made
    // everything positive)
    const hasNegative = Array.from(decoded).some((s) => s < -0.1);
    const hasPositive = Array.from(decoded).some((s) => s > 0.1);
    expect(hasNegative).toBe(true);
    expect(hasPositive).toBe(true);
  });

  it("round-trips a complex waveform preserving sign", () => {
    const samples = new Float32Array(100);
    for (let i = 0; i < 100; i++) {
      samples[i] = Math.sin(i * 0.3) * 0.8 + Math.sin(i * 0.07) * 0.2;
    }
    const decoded = decodePcm16ToFloat32(encodeFloat32ToPcm16Base64(samples));
    let maxError = 0;
    for (let i = 0; i < 100; i++) {
      maxError = Math.max(maxError, Math.abs(decoded[i] - samples[i]));
    }
    expect(maxError).toBeLessThan(0.001);
  });

  it("does NOT produce values outside [-1.0, 1.0] (no clipping from sign bug)", () => {
    // The bug would produce values up to 2.0 for negative samples
    const samples = new Float32Array([-1.0, -0.99, -0.5, 0, 0.5, 0.99, 1.0]);
    const decoded = decodePcm16ToFloat32(encodeFloat32ToPcm16Base64(samples));
    for (const s of decoded) {
      expect(s).toBeGreaterThanOrEqual(-1.0);
      expect(s).toBeLessThanOrEqual(1.0);
    }
  });

  // ---------------------------------------------------------------------------
  // Direct raw-bytes test: verify the sign extension on known byte patterns
  // without relying on the encoder. This is the most explicit regression test.
  // ---------------------------------------------------------------------------
  it("sign-extends 0xFFFF to -1 (not 65535/32768 = 2.0)", () => {
    // 0xFFFF in little-endian = bytes [255, 255]
    const bytes = new Uint8Array([255, 255]);
    const raw = bytes[0] | (bytes[1] << 8); // 65535 (unsigned)
    const signed = raw << 16 >> 16; // -1 (sign-extended)
    expect(signed).toBe(-1);
    expect(signed / 32768).toBeCloseTo(-1 / 32768, 6);
    // Verify the BUGGY version would have been wrong
    expect(raw / 32768).toBeCloseTo(65535 / 32768, 6); // ~2.0 — the bug
  });

  it("sign-extends 0x8000 to -32768 (not +32768)", () => {
    // 0x8000 in little-endian = bytes [0, 128]
    const bytes = new Uint8Array([0, 128]);
    const raw = bytes[0] | (bytes[1] << 8); // 32768 (unsigned)
    const signed = raw << 16 >> 16; // -32768 (sign-extended)
    expect(signed).toBe(-32768);
    expect(signed / 32768).toBe(-1.0);
  });
});
