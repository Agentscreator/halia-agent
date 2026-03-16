import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState = "idle" | "connecting" | "listening" | "error";

interface UseVoiceOptions {
  sessionId?: string; // unused — STT runs in browser via Web Speech API
  onTranscript?: (text: string, role: "user" | "assistant", isFinal?: boolean) => void;
  onError?: (message: string) => void;
}

export function useVoice({ onTranscript, onError }: UseVoiceOptions) {
  const [state, setState] = useState<VoiceState>("idle");
  const stateRef = useRef<VoiceState>("idle");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const setStateBoth = useCallback((s: VoiceState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  const cleanup = useCallback(() => {
    recognitionRef.current?.abort();
    recognitionRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
  }, []);

  /** Returns mic amplitude 0–1. Call every animation frame. */
  const getAmplitude = useCallback((): number => {
    const analyser = analyserRef.current;
    if (!analyser) return 0;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(buf);
    return buf.reduce((s, v) => s + v, 0) / (buf.length * 255);
  }, []);

  const start = useCallback(async () => {
    if (stateRef.current !== "idle") return;
    setStateBoth("connecting");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) {
      onErrorRef.current?.("Speech recognition not supported — use Chrome or Edge.");
      setStateBoth("error");
      return;
    }

    // Grab mic stream for amplitude visualisation (separate from STT)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      source.connect(analyser);
    } catch {
      // amplitude bars won't work but STT will still run
    }

    const recognition: SpeechRecognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setStateBoth("listening");
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += t;
        else interimText += t;
      }
      if (finalText) {
        onTranscriptRef.current?.(finalText.trim(), "user", true);
      } else if (interimText) {
        onTranscriptRef.current?.(interimText.trim(), "user", false);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // no-speech and aborted are expected — just keep going
      if (event.error === "no-speech" || event.error === "aborted") return;
      onErrorRef.current?.(`Voice error: ${event.error}`);
      setStateBoth("error");
      cleanup();
    };

    recognition.onend = () => {
      // Browser stops after silence — restart to keep always-on
      if (stateRef.current === "listening") {
        try { recognition.start(); } catch { /* already started */ }
      }
    };

    recognition.start();
  }, [cleanup, setStateBoth]);

  const stop = useCallback(() => {
    setStateBoth("idle");
    cleanup();
  }, [cleanup, setStateBoth]);

  // Auto-clear error after 3 s
  useEffect(() => {
    if (state !== "error") return;
    const t = setTimeout(() => setStateBoth("idle"), 3000);
    return () => clearTimeout(t);
  }, [state, setStateBoth]);

  useEffect(() => () => { cleanup(); }, [cleanup]);

  return { state, start, stop, getAmplitude };
}
