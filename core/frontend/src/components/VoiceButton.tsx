import { Mic, MicOff, Volume2, Loader2 } from "lucide-react";
import type { VoiceState } from "@/hooks/use-voice";

interface VoiceButtonProps {
  state: VoiceState;
  onStart: () => void;
  onStop: () => void;
  disabled?: boolean;
}

const LABELS: Record<VoiceState, string> = {
  idle: "Click to speak",
  connecting: "Connecting…",
  listening: "Listening — click to stop",
  speaking: "Halia is speaking…",
  error: "Voice error — try again",
};

export default function VoiceButton({ state, onStart, onStop, disabled }: VoiceButtonProps) {
  const isActive = state === "listening" || state === "speaking";

  const handleClick = () => {
    if (isActive) onStop();
    else if (state === "idle") onStart();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || state === "connecting" || state === "error"}
      title={LABELS[state]}
      aria-label={LABELS[state]}
      className={[
        "relative p-2 rounded-lg transition-all duration-200",
        state === "listening"
          ? "bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30"
          : state === "speaking"
          ? "bg-primary/20 text-primary border border-primary/50"
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
      ) : state === "speaking" ? (
        <Volume2 className="w-4 h-4" />
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
