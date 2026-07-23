"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseMicrophoneOptions {
  sampleRate?: number;
  onAudioLevel?: (level: number) => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  silenceThreshold?: number;
  silenceDurationMs?: number;
}

interface UseMicrophoneReturn {
  isListening: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  getStream: () => MediaStream | null;
}

export function useMicrophone(options: UseMicrophoneOptions = {}): UseMicrophoneReturn {
  const {
    sampleRate = 48000,
    onAudioLevel,
    onSpeechStart,
    onSpeechEnd,
    silenceThreshold = 0.01,
    silenceDurationMs = 1500,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const isSpeakingRef = useRef(false);
  const silenceStartRef = useRef<number | null>(null);
  const callbacksRef = useRef({ onAudioLevel, onSpeechStart, onSpeechEnd });

  // Keep callbacks ref updated
  useEffect(() => {
    callbacksRef.current = { onAudioLevel, onSpeechStart, onSpeechEnd };
  }, [onAudioLevel, onSpeechStart, onSpeechEnd]);

  const stop = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    isSpeakingRef.current = false;
    silenceStartRef.current = null;
    setIsListening(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate,
        },
      });

      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      analyserRef.current = analyser;

      // MediaRecorder for capturing audio chunks
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };
      recorder.start(100);
      mediaRecorderRef.current = recorder;

      setIsListening(true);

      // Audio level monitoring + silence detection
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const checkLevel = () => {
        if (!analyserRef.current) return;

        analyserRef.current.getByteTimeDomainData(dataArray);

        // Calculate RMS
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const val = (dataArray[i] - 128) / 128;
          sum += val * val;
        }
        const rms = Math.sqrt(sum / dataArray.length);

        callbacksRef.current.onAudioLevel?.(rms);

        // Speech detection
        if (rms > silenceThreshold) {
          if (!isSpeakingRef.current) {
            isSpeakingRef.current = true;
            callbacksRef.current.onSpeechStart?.();
          }
          silenceStartRef.current = null;
        } else {
          if (isSpeakingRef.current) {
            if (silenceStartRef.current === null) {
              silenceStartRef.current = Date.now();
            } else if (Date.now() - silenceStartRef.current > silenceDurationMs) {
              isSpeakingRef.current = false;
              silenceStartRef.current = null;
              callbacksRef.current.onSpeechEnd?.();
            }
          }
        }

        animationFrameRef.current = requestAnimationFrame(checkLevel);
      };

      animationFrameRef.current = requestAnimationFrame(checkLevel);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to access microphone";
      if (message.includes("Permission") || message.includes("NotAllowed")) {
        setError("Microphone permission denied. Please allow microphone access in your browser settings.");
      } else if (message.includes("NotFound") || message.includes("DevicesNotFoundError")) {
        setError("No microphone found. Please connect a microphone and try again.");
      } else {
        setError(`Microphone error: ${message}`);
      }
      stop();
    }
  }, [sampleRate, silenceThreshold, silenceDurationMs, stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  const getStream = useCallback(() => streamRef.current, []);

  return {
    isListening,
    error,
    start,
    stop,
    getStream,
  };
}
