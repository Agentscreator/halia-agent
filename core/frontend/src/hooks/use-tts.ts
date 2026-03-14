import { useCallback, useRef, useState } from "react";

/**
 * Hook that sends text to the /api/tts endpoint and plays back the audio.
 * Queues requests so overlapping calls play sequentially.
 */
export function useTTS() {
  const [speaking, setSpeaking] = useState(false);
  const queueRef = useRef<string[]>([]);
  const processingRef = useRef(false);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const nextPlayAtRef = useRef(0);

  const playAudio = useCallback((b64: string) => {
    // Lazy-init a 24 kHz playback context (Gemini TTS outputs 24 kHz PCM)
    if (!playbackCtxRef.current || playbackCtxRef.current.state === "closed") {
      playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });
    }
    const ctx = playbackCtxRef.current;

    try {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

      const buffer = ctx.createBuffer(1, float32.length, ctx.sampleRate);
      buffer.copyToChannel(float32, 0);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      const now = ctx.currentTime;
      const startAt = Math.max(now, nextPlayAtRef.current);
      source.start(startAt);
      nextPlayAtRef.current = startAt + buffer.duration;

      return buffer.duration;
    } catch {
      return 0;
    }
  }, []);

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setSpeaking(true);

    while (queueRef.current.length > 0) {
      const text = queueRef.current.shift()!;
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.audio) {
            const duration = playAudio(data.audio);
            // Wait for playback to finish before processing next item
            if (duration > 0) {
              await new Promise((r) => setTimeout(r, duration * 1000 + 100));
            }
          }
        }
      } catch (err) {
        console.warn("[TTS] Failed:", err);
      }
    }

    processingRef.current = false;
    setSpeaking(false);
  }, [playAudio]);

  /** Queue text to be spoken aloud. */
  const speak = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      queueRef.current.push(text);
      processQueue();
    },
    [processQueue],
  );

  /** Clear the queue and stop playback. */
  const cancel = useCallback(() => {
    queueRef.current = [];
    processingRef.current = false;
    setSpeaking(false);
    if (playbackCtxRef.current && playbackCtxRef.current.state !== "closed") {
      playbackCtxRef.current.close().catch(() => {});
      playbackCtxRef.current = null;
    }
    nextPlayAtRef.current = 0;
  }, []);

  return { speak, cancel, speaking };
}
