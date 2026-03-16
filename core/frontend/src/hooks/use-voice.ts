import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState = "idle" | "connecting" | "listening" | "error";

interface UseVoiceOptions {
  sessionId: string;
  onTranscript?: (text: string, role: "user" | "assistant") => void;
  onError?: (message: string) => void;
}

/** Convert Float32Array PCM samples to base64-encoded int16 PCM. */
function float32ToInt16Base64(samples: Float32Array): string {
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    int16[i] = Math.max(-32768, Math.min(32767, samples[i] * 32768));
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function useVoice({ sessionId, onTranscript, onError }: UseVoiceOptions) {
  const [state, setState] = useState<VoiceState>("idle");

  const wsRef = useRef<WebSocket | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Stable refs so callbacks never go stale
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const cleanup = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;

    analyserRef.current?.disconnect();
    analyserRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    captureCtxRef.current?.close().catch(() => {});
    captureCtxRef.current = null;

    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  /** Returns current mic amplitude 0–1 for visualisation. Call every animation frame. */
  const getAmplitude = useCallback((): number => {
    const analyser = analyserRef.current;
    if (!analyser) return 0;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(buf);
    const sum = buf.reduce((s, v) => s + v, 0);
    return sum / (buf.length * 255);
  }, []);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    setState("connecting");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/sessions/${sessionId}/voice`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type: string;
          text?: string;
          role?: string;
          message?: string;
        };

        if (msg.type === "ready") {
          setState("listening");
        } else if (msg.type === "transcript" && msg.text) {
          // Stay in listening state — transcript just populates the input box
          onTranscriptRef.current?.(msg.text, (msg.role as "user" | "assistant") ?? "user");
        } else if (msg.type === "error") {
          onErrorRef.current?.(msg.message ?? "Unknown voice error");
          cleanup();
          setState("error");
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      cleanup();
      setState("idle");
    };

    ws.onerror = () => {
      onErrorRef.current?.("Voice connection failed");
      cleanup();
      setState("error");
    };

    ws.onopen = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        streamRef.current = stream;

        // AudioContext at 16 kHz — what Gemini Live expects
        const captureCtx = new AudioContext({ sampleRate: 16000 });
        captureCtxRef.current = captureCtx;

        const source = captureCtx.createMediaStreamSource(stream);

        // AnalyserNode for amplitude visualisation
        const analyser = captureCtx.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;

        // ScriptProcessorNode: 512 samples ≈ 32 ms chunks at 16 kHz
        const processor: ScriptProcessorNode = captureCtx.createScriptProcessor(512, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const b64 = float32ToInt16Base64(e.inputBuffer.getChannelData(0));
          ws.send(JSON.stringify({ type: "audio_chunk", data: b64 }));
        };

        // Silent gain keeps processor alive without mic bleed to speakers
        const silentGain = captureCtx.createGain();
        silentGain.gain.value = 0;
        source.connect(analyser);
        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(captureCtx.destination);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Microphone access denied";
        onErrorRef.current?.(message);
        ws.close();
        setState("error");
      }
    };
  }, [state, sessionId, cleanup]);

  /** Stop recording and close the session. */
  const stop = useCallback(() => {
    cleanup();
    setState("idle");
  }, [cleanup]);

  // Auto-clear error state after 3 s so the button becomes clickable again
  useEffect(() => {
    if (state !== "error") return;
    const t = setTimeout(() => setState("idle"), 3000);
    return () => clearTimeout(t);
  }, [state]);

  // Cleanup on unmount
  useEffect(() => () => { cleanup(); }, [cleanup]);

  return { state, start, stop, getAmplitude };
}
