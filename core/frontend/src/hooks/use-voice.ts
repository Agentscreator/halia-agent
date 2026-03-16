import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState = "idle" | "connecting" | "listening" | "speaking" | "error";

interface UseVoiceOptions {
  sessionId: string;
  /** Called when a transcript arrives. isFinal=false means interim/partial. */
  onTranscript?: (text: string, role: "user" | "assistant", isFinal: boolean) => void;
  onError?: (message: string) => void;
}

/** Convert Float32Array PCM to base64 int16 PCM. */
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

/** Decode base64 int16 PCM into a Web Audio AudioBuffer. */
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

  const wsRef = useRef<WebSocket | null>(null);

  // Capture (mic → Gemini)
  const captureCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Playback (Gemini → speaker)
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const nextPlayAtRef = useRef(0);
  const playbackSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  /** Clear the playback queue — called when Gemini is interrupted. */
  const clearPlayback = useCallback(() => {
    playbackSourcesRef.current.forEach((s) => { try { s.stop(); } catch { /* already ended */ } });
    playbackSourcesRef.current = [];
    nextPlayAtRef.current = 0;
    // Close and recreate context so scheduled nodes are discarded immediately
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
        // All audio drained — back to listening
        setState((s) => (s === "speaking" ? "listening" : s));
      }
    };

    const now = ctx.currentTime;
    const startAt = Math.max(now, nextPlayAtRef.current);
    source.start(startAt);
    nextPlayAtRef.current = startAt + buf.duration;
    setState("speaking");
  }, []);

  const cleanup = useCallback(() => {
    clearPlayback();

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
  }, [clearPlayback]);

  /** Returns mic amplitude 0–1 for the visualiser. */
  const getAmplitude = useCallback((): number => {
    const a = analyserRef.current;
    if (!a) return 0;
    const buf = new Uint8Array(a.frequencyBinCount);
    a.getByteFrequencyData(buf);
    return buf.reduce((s, v) => s + v, 0) / (buf.length * 255);
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
          finished?: boolean;
          message?: string;
        };

        if (msg.type === "ready") {
          setState("listening");

        } else if (msg.type === "audio_chunk" && msg.data) {
          // Gemini is speaking — play it back
          playAudioChunk(msg.data);

        } else if (msg.type === "interrupted") {
          // User interrupted Gemini — clear queued audio immediately
          clearPlayback();
          setState("listening");

        } else if (msg.type === "user_transcript" && msg.text) {
          onTranscriptRef.current?.(msg.text, "user", msg.finished ?? false);

        } else if (msg.type === "assistant_transcript" && msg.text) {
          onTranscriptRef.current?.(msg.text, "assistant", msg.finished ?? false);

        } else if (msg.type === "error") {
          onErrorRef.current?.(msg.message ?? "Unknown voice error");
          cleanup();
          setState("error");
        }
      } catch { /* ignore malformed frames */ }
    };

    ws.onclose = () => { cleanup(); setState("idle"); };
    ws.onerror = () => { onErrorRef.current?.("Voice connection failed"); cleanup(); setState("error"); };

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

        const captureCtx = new AudioContext({ sampleRate: 16000 });
        captureCtxRef.current = captureCtx;

        const source = captureCtx.createMediaStreamSource(stream);

        // Analyser for amplitude visualisation
        const analyser = captureCtx.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;
        source.connect(analyser);

        // ScriptProcessor sends PCM chunks to Gemini
        const processor = captureCtx.createScriptProcessor(512, 1, 1);
        processorRef.current = processor;
        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const b64 = float32ToInt16Base64(e.inputBuffer.getChannelData(0));
          ws.send(JSON.stringify({ type: "audio_chunk", data: b64 }));
        };

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
  }, [state, sessionId, cleanup, playAudioChunk, clearPlayback]);

  const stop = useCallback(() => {
    cleanup();
    setState("idle");
  }, [cleanup]);

  useEffect(() => {
    if (state !== "error") return;
    const t = setTimeout(() => setState("idle"), 3000);
    return () => clearTimeout(t);
  }, [state]);

  useEffect(() => () => { cleanup(); }, [cleanup]);

  return { state, start, stop, getAmplitude };
}
