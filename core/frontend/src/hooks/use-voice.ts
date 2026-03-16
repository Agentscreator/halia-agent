import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState = "idle" | "connecting" | "listening" | "speaking" | "error";

interface UseVoiceOptions {
  sessionId: string;
  onTranscript?: (text: string, role: "user" | "assistant", isFinal: boolean) => void;
  onError?: (message: string) => void;
}

function float32ToInt16Base64(samples: Float32Array): string {
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    int16[i] = Math.max(-32768, Math.min(32767, samples[i] * 32768));
  }
  const bytes = new Uint8Array(int16.buffer);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function decodeAudioChunk(b64: string, ctx: AudioContext): AudioBuffer | null {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const int16 = new Int16Array(bytes.buffer);
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;
    const buf = ctx.createBuffer(1, f32.length, ctx.sampleRate);
    buf.copyToChannel(f32, 0);
    return buf;
  } catch {
    return null;
  }
}

export function useVoice({ sessionId, onTranscript, onError }: UseVoiceOptions) {
  const [state, setState] = useState<VoiceState>("idle");
  // Use a ref so callbacks always see the latest state without re-creating closures
  const stateRef = useRef<VoiceState>("idle");

  const wsRef = useRef<WebSocket | null>(null);
  const captureCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const nextPlayAtRef = useRef(0);
  const playbackSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  // When true, ws.onclose will attempt reconnect instead of going idle
  const shouldReconnectRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const setStateBoth = useCallback((s: VoiceState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  const clearPlayback = useCallback(() => {
    playbackSourcesRef.current.forEach((s) => { try { s.stop(); } catch { /* ended */ } });
    playbackSourcesRef.current = [];
    nextPlayAtRef.current = 0;
    if (playbackCtxRef.current && playbackCtxRef.current.state !== "closed") {
      playbackCtxRef.current.close().catch(() => {});
      playbackCtxRef.current = null;
    }
  }, []);

  const playAudioChunk = useCallback((b64: string) => {
    if (!playbackCtxRef.current || playbackCtxRef.current.state === "closed") {
      playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });
    }
    const ctx = playbackCtxRef.current;
    const buf = decodeAudioChunk(b64, ctx);
    if (!buf) return;

    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.connect(ctx.destination);
    playbackSourcesRef.current.push(source);
    source.onended = () => {
      playbackSourcesRef.current = playbackSourcesRef.current.filter((s) => s !== source);
      if (playbackSourcesRef.current.length === 0) {
        setState((s) => (s === "speaking" ? "listening" : s));
        stateRef.current = stateRef.current === "speaking" ? "listening" : stateRef.current;
      }
    };

    const now = ctx.currentTime;
    const startAt = Math.max(now, nextPlayAtRef.current);
    source.start(startAt);
    nextPlayAtRef.current = startAt + buf.duration;
    setStateBoth("speaking");
  }, [setStateBoth]);

  // Forward reference so connect() can reference itself for reconnect
  const connectRef = useRef<(() => void) | null>(null);

  const cleanupConnection = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    captureCtxRef.current?.close().catch(() => {});
    captureCtxRef.current = null;
    clearPlayback();
    wsRef.current?.close();
    wsRef.current = null;
  }, [clearPlayback]);

  /** Returns mic amplitude 0–1. */
  const getAmplitude = useCallback((): number => {
    const a = analyserRef.current;
    if (!a) return 0;
    const buf = new Uint8Array(a.frequencyBinCount);
    a.getByteFrequencyData(buf);
    return buf.reduce((s, v) => s + v, 0) / (buf.length * 255);
  }, []);

  const connect = useCallback(() => {
    if (!sessionId) return;
    setStateBoth("connecting");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/sessions/${sessionId}/voice`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type: string;
          data?: string;
          text?: string;
          finished?: boolean;
          message?: string;
        };

        if (msg.type === "ready") {
          setStateBoth("listening");
        } else if (msg.type === "audio_chunk" && msg.data) {
          playAudioChunk(msg.data);
        } else if (msg.type === "interrupted") {
          clearPlayback();
          setStateBoth("listening");
        } else if (msg.type === "user_transcript" && msg.text) {
          onTranscriptRef.current?.(msg.text, "user", msg.finished ?? false);
        } else if (msg.type === "assistant_transcript" && msg.text) {
          onTranscriptRef.current?.(msg.text, "assistant", msg.finished ?? false);
        } else if (msg.type === "error") {
          onErrorRef.current?.(msg.message ?? "Unknown voice error");
          shouldReconnectRef.current = false;
          cleanupConnection();
          setStateBoth("error");
        }
      } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      cleanupConnection();
      if (shouldReconnectRef.current && sessionId) {
        // Session closed unexpectedly — reconnect after a brief pause
        setStateBoth("connecting");
        reconnectTimerRef.current = setTimeout(() => {
          if (shouldReconnectRef.current) connectRef.current?.();
        }, 300);
      } else {
        setStateBoth("idle");
      }
    };

    ws.onerror = () => {
      // Don't stop reconnect here — ws.onclose always fires after onerror
      // and the reconnect logic there will handle retrying.
      // Only fatal server-level errors (received as JSON messages) disable reconnect.
      onErrorRef.current?.("Voice connection lost — reconnecting…");
    };

    ws.onopen = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        streamRef.current = stream;

        const captureCtx = new AudioContext({ sampleRate: 16000 });
        captureCtxRef.current = captureCtx;

        const source = captureCtx.createMediaStreamSource(stream);

        const analyser = captureCtx.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;
        source.connect(analyser);

        const processor = captureCtx.createScriptProcessor(512, 1, 1);
        processorRef.current = processor;
        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(JSON.stringify({ type: "audio_chunk", data: float32ToInt16Base64(e.inputBuffer.getChannelData(0)) }));
        };

        const silentGain = captureCtx.createGain();
        silentGain.gain.value = 0;
        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(captureCtx.destination);
      } catch (err) {
        onErrorRef.current?.(err instanceof Error ? err.message : "Microphone access denied");
        shouldReconnectRef.current = false;
        ws.close();
        setStateBoth("error");
      }
    };
  }, [sessionId, setStateBoth, playAudioChunk, clearPlayback, cleanupConnection]);

  // Keep connectRef current
  useEffect(() => { connectRef.current = connect; }, [connect]);

  const start = useCallback(() => {
    if (stateRef.current !== "idle") return;
    shouldReconnectRef.current = true;
    connect();
  }, [connect]);

  const stop = useCallback(() => {
    shouldReconnectRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    cleanupConnection();
    setStateBoth("idle");
  }, [cleanupConnection, setStateBoth]);

  /** Send a hive agent text response into Gemini Live so it reads it aloud. */
  const injectText = useCallback((text: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "inject_text", text }));
    }
  }, []);

  useEffect(() => {
    if (state !== "error") return;
    const t = setTimeout(() => setStateBoth("idle"), 3000);
    return () => clearTimeout(t);
  }, [state, setStateBoth]);

  useEffect(() => () => {
    shouldReconnectRef.current = false;
    cleanupConnection();
  }, [cleanupConnection]);

  return { state, start, stop, getAmplitude, injectText };
}
