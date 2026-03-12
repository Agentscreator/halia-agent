import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState = "idle" | "connecting" | "listening" | "speaking" | "error";

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

/** Decode base64 int16 PCM into a Web Audio AudioBuffer at the given sample rate. */
function int16Base64ToAudioBuffer(b64: string, ctx: AudioContext): AudioBuffer | null {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
    const buffer = ctx.createBuffer(1, float32.length, ctx.sampleRate);
    buffer.copyToChannel(float32, 0);
    return buffer;
  } catch {
    return null;
  }
}

export function useVoice({ sessionId, onTranscript, onError }: UseVoiceOptions) {
  const [state, setState] = useState<VoiceState>("idle");

  const wsRef = useRef<WebSocket | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextPlayAtRef = useRef(0);

  // Stable refs so callbacks never go stale
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const cleanup = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    captureCtxRef.current?.close().catch(() => {});
    captureCtxRef.current = null;

    wsRef.current?.close();
    wsRef.current = null;

    nextPlayAtRef.current = 0;
  }, []);

  const playAudioChunk = useCallback((b64: string) => {
    // Lazy-init a dedicated 24 kHz playback context (Gemini outputs 24 kHz PCM)
    if (!playbackCtxRef.current || playbackCtxRef.current.state === "closed") {
      playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });
    }
    const ctx = playbackCtxRef.current;
    const buffer = int16Base64ToAudioBuffer(b64, ctx);
    if (!buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    // Schedule chunks back-to-back for gapless playback
    const now = ctx.currentTime;
    const startAt = Math.max(now, nextPlayAtRef.current);
    source.start(startAt);
    nextPlayAtRef.current = startAt + buffer.duration;
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
          data?: string;
          text?: string;
          role?: string;
          message?: string;
        };

        if (msg.type === "ready") {
          setState("listening");
        } else if (msg.type === "audio_chunk" && msg.data) {
          setState("speaking");
          playAudioChunk(msg.data);
        } else if (msg.type === "transcript" && msg.text) {
          onTranscriptRef.current?.(msg.text, (msg.role as "user" | "assistant") ?? "assistant");
          // Return to listening after assistant speaks
          if (msg.role === "assistant") {
            // Small delay to avoid flickering if more audio chunks follow
            setTimeout(() => setState((s) => (s === "speaking" ? "listening" : s)), 800);
          }
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

        // ScriptProcessorNode: 512 samples ≈ 32 ms chunks at 16 kHz
        // @ts-expect-error — deprecated but universally supported
        const processor: ScriptProcessorNode = captureCtx.createScriptProcessor(512, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const b64 = float32ToInt16Base64(e.inputBuffer.getChannelData(0));
          ws.send(JSON.stringify({ type: "audio_chunk", data: b64 }));
        };

        // Silent gain node keeps processor alive without mic bleed to speakers
        const silentGain = captureCtx.createGain();
        silentGain.gain.value = 0;
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
  }, [state, sessionId, cleanup, playAudioChunk]);

  const stop = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "end_of_turn" }));
    }
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

  return { state, start, stop };
}
