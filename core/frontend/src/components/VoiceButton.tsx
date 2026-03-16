import { useEffect, useRef } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import type { VoiceState } from "@/hooks/use-voice";

interface VoiceButtonProps {
  state: VoiceState;
  onStart: () => void;
  onStop: () => void;
  disabled?: boolean;
  noSession?: boolean;
  /** Called every animation frame while listening — returns 0–1 amplitude */
  getAmplitude?: () => number;
}

const LABELS: Record<VoiceState, string> = {
  idle: "Click to speak",
  connecting: "Connecting…",
  listening: "Listening — click to stop",
  error: "Voice error — try again",
};

/** Three animated bars that scale with mic amplitude. */
function AmplitudeBars({ getAmplitude }: { getAmplitude: () => number }) {
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const offsets = [0, 150, 300]; // ms phase offset per bar
    const start = performance.now();

    const tick = () => {
      const amp = Math.min(1, getAmplitude() * 3); // boost low signals
      const t = performance.now() - start;
      barsRef.current.forEach((bar, i) => {
        if (!bar) return;
        // Combine real amplitude with a gentle idle oscillation
        const idle = 0.3 + 0.2 * Math.sin((t + offsets[i]) / 200);
        const scale = amp > 0.05 ? 0.4 + amp * 0.6 : idle;
        bar.style.transform = `scaleY(${scale.toFixed(3)})`;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [getAmplitude]);

  return (
    <span className="flex items-center gap-[2px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          ref={(el) => { barsRef.current[i] = el; }}
          className="inline-block w-[3px] h-[14px] rounded-full bg-red-400 origin-center"
          style={{ transform: "scaleY(0.4)" }}
        />
      ))}
    </span>
  );
}

export default function VoiceButton({ state, onStart, onStop, disabled, noSession, getAmplitude }: VoiceButtonProps) {
  const isActive = state === "listening";

  const handleClick = () => {
    if (isActive) onStop();
    else if (state === "idle") onStart();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || state === "connecting" || state === "error"}
      title={noSession ? "Start a conversation to enable voice" : LABELS[state]}
      aria-label={noSession ? "Voice unavailable — start a conversation first" : LABELS[state]}
      className={[
        "relative p-2 rounded-lg transition-all duration-200 flex items-center justify-center",
        state === "listening"
          ? "bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30"
          : state === "error"
          ? "bg-destructive/20 text-destructive border border-destructive/40 opacity-60"
          : state === "connecting"
          ? "bg-muted/60 text-muted-foreground border border-border opacity-60 cursor-wait"
          : "bg-muted/60 text-muted-foreground border border-border hover:text-foreground hover:bg-muted",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {state === "connecting" ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : state === "listening" && getAmplitude ? (
        <AmplitudeBars getAmplitude={getAmplitude} />
      ) : state === "error" ? (
        <MicOff className="w-4 h-4" />
      ) : (
        <Mic className="w-4 h-4" />
      )}

      {/* Pulse ring when actively listening */}
      {state === "listening" && (
        <span className="absolute inset-0 rounded-lg animate-ping bg-red-500/20 pointer-events-none" />
      )}
    </button>
  );
}
