import { memo, useState, useRef, useEffect, useCallback } from "react";
import { Send, Square, Crown, Cpu, Check, Loader2 } from "lucide-react";
import MarkdownContent from "@/components/MarkdownContent";
import QuestionWidget from "@/components/QuestionWidget";
import VoiceButton from "@/components/VoiceButton";
import { useVoice } from "@/hooks/use-voice";

export interface ChatMessage {
  id: string;
  agent: string;
  agentColor: string;
  content: string;
  timestamp: string;
  type?: "system" | "agent" | "user" | "tool_status" | "worker_input_request";
  role?: "queen" | "worker";
  /** Which worker thread this message belongs to (worker agent name) */
  thread?: string;
  /** Epoch ms when this message was first created — used for ordering queen/worker interleaving */
  createdAt?: number;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (message: string, thread: string) => void;
  isWaiting?: boolean;
  /** When true a worker is thinking (not yet streaming) */
  isWorkerWaiting?: boolean;
  /** When true the queen is busy (typing or streaming) — shows the stop button */
  isBusy?: boolean;
  activeThread: string;
  /** When true, the input is disabled (e.g. during loading) */
  disabled?: boolean;
  /** Called when user clicks the stop button to cancel the queen's current turn */
  onCancel?: () => void;
  /** Pending question from ask_user — replaces textarea when present */
  pendingQuestion?: string | null;
  /** Options for the pending question */
  pendingOptions?: string[] | null;
  /** Called when user submits an answer to the pending question */
  onQuestionSubmit?: (answer: string, isOther: boolean) => void;
  /** Called when user dismisses the pending question without answering */
  onQuestionDismiss?: () => void;
  /** Queen operating phase — shown as a tag on queen messages */
  queenPhase?: "planning" | "building" | "staging" | "running";
  /** Backend session ID — enables the voice button when provided */
  sessionId?: string;
  /** When true, auto-start voice on mount (e.g. navigated from home page mic) */
  autoStartVoice?: boolean;
}

const queenColor = "hsl(210,85%,55%)";
const workerColor = "hsl(200,70%,50%)";

function getColor(_agent: string, role?: "queen" | "worker"): string {
  if (role === "queen") return queenColor;
  return workerColor;
}

// Blue-ocean palette — sky blues, cyans, teals, and indigo accents
const TOOL_HEX = [
  "#2d8ff0", // sky blue
  "#0ea5e9", // light blue
  "#38bdf8", // pale blue
  "#06b6d4", // cyan
  "#14b8a6", // teal
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#8b5cf6", // violet-blue
];

function toolHex(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return TOOL_HEX[Math.abs(hash) % TOOL_HEX.length];
}

function ToolActivityRow({ content }: { content: string }) {
  let tools: { name: string; done: boolean }[] = [];
  try {
    const parsed = JSON.parse(content);
    tools = parsed.tools || [];
  } catch {
    // Legacy plain-text fallback
    return (
      <div className="flex gap-3 pl-10">
        <span className="text-[11px] text-muted-foreground bg-muted/40 px-3 py-1 rounded-full border border-border/40">
          {content}
        </span>
      </div>
    );
  }

  if (tools.length === 0) return null;

  // Group by tool name → count done vs running
  const grouped = new Map<string, { done: number; running: number }>();
  for (const t of tools) {
    const entry = grouped.get(t.name) || { done: 0, running: 0 };
    if (t.done) entry.done++;
    else entry.running++;
    grouped.set(t.name, entry);
  }

  // Build pill list: running first, then done
  const runningPills: { name: string; count: number }[] = [];
  const donePills: { name: string; count: number }[] = [];
  for (const [name, counts] of grouped) {
    if (counts.running > 0) runningPills.push({ name, count: counts.running });
    if (counts.done > 0) donePills.push({ name, count: counts.done });
  }

  return (
    <div className="flex gap-3 pl-10">
      <div className="flex flex-wrap items-center gap-1.5">
        {runningPills.map((p) => {
          const hex = toolHex(p.name);
          return (
            <span
              key={`run-${p.name}`}
              className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full"
              style={{ color: hex, backgroundColor: `${hex}18`, border: `1px solid ${hex}35` }}
            >
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              {p.name}
              {p.count > 1 && (
                <span className="text-[10px] font-medium opacity-70">×{p.count}</span>
              )}
            </span>
          );
        })}
        {donePills.map((p) => {
          const hex = toolHex(p.name);
          return (
            <span
              key={`done-${p.name}`}
              className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full"
              style={{ color: hex, backgroundColor: `${hex}18`, border: `1px solid ${hex}35` }}
            >
              <Check className="w-2.5 h-2.5" />
              {p.name}
              {p.count > 1 && (
                <span className="text-[10px] opacity-80">×{p.count}</span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

const MessageBubble = memo(function MessageBubble({ msg, queenPhase }: { msg: ChatMessage; queenPhase?: "planning" | "building" | "staging" | "running" }) {
  const isUser = msg.type === "user";
  const isQueen = msg.role === "queen";
  const color = getColor(msg.agent, msg.role);

  if (msg.type === "system") {
    return (
      <div className="flex justify-center py-1">
        <span className="text-[11px] text-muted-foreground bg-muted/60 px-3 py-1.5 rounded-full">
          {msg.content}
        </span>
      </div>
    );
  }

  if (msg.type === "tool_status") {
    return <ToolActivityRow content={msg.content} />;
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] bg-primary text-primary-foreground text-sm leading-relaxed rounded-2xl rounded-br-md px-4 py-3">
          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div
        className={`flex-shrink-0 ${isQueen ? "w-9 h-9" : "w-7 h-7"} rounded-xl flex items-center justify-center`}
        style={{
          backgroundColor: `${color}18`,
          border: `1.5px solid ${color}35`,
          boxShadow: isQueen ? `0 0 12px ${color}20` : undefined,
        }}
      >
        {isQueen ? (
          <Crown className="w-4 h-4" style={{ color }} />
        ) : (
          <Cpu className="w-3.5 h-3.5" style={{ color }} />
        )}
      </div>
      <div className={`flex-1 min-w-0 ${isQueen ? "max-w-[85%]" : "max-w-[75%]"}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className={`font-medium ${isQueen ? "text-sm" : "text-xs"}`} style={{ color }}>
            {msg.agent}
          </span>
          <span
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${
              isQueen ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
            }`}
          >
            {isQueen
              ? queenPhase === "running"
                ? "running phase"
                : queenPhase === "staging"
                  ? "staging phase"
                  : queenPhase === "planning"
                    ? "planning phase"
                    : "building phase"
              : "Worker"}
          </span>
        </div>
        <div
          className={`text-sm leading-relaxed rounded-2xl rounded-tl-md px-4 py-3 ${
            isQueen ? "border border-primary/20 bg-primary/5" : "bg-muted/60"
          }`}
        >
          <MarkdownContent content={msg.content} />
        </div>
      </div>
    </div>
  );
}, (prev, next) => prev.msg.id === next.msg.id && prev.msg.content === next.msg.content && prev.queenPhase === next.queenPhase);

export default function ChatPanel({ messages, onSend, isWaiting, isWorkerWaiting, isBusy, activeThread, disabled, onCancel, pendingQuestion, pendingOptions, onQuestionSubmit, onQuestionDismiss, queenPhase, sessionId, autoStartVoice }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [readMap, setReadMap] = useState<Record<string, number>>({});
  const [voiceMessages, setVoiceMessages] = useState<ChatMessage[]>([]);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Voice integration — show both sides of the Gemini Live conversation in chat
  const pendingVoiceMsg = useRef<{ id: string; role: "user" | "assistant" } | null>(null);

  const handleVoiceTranscript = useCallback((text: string, role: "user" | "assistant", isFinal: boolean) => {
    setVoiceMessages((prev) => {
      const pending = pendingVoiceMsg.current;
      if (pending && pending.role === role) {
        const updated = prev.map((m) => m.id === pending.id ? { ...m, content: text } : m);
        if (isFinal) pendingVoiceMsg.current = null;
        return updated;
      }
      const id = `voice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const msg: ChatMessage = {
        id,
        agent: role === "user" ? "You" : "Halia",
        agentColor: role === "user" ? "hsl(200,70%,50%)" : "hsl(210,85%,55%)",
        content: text,
        timestamp: new Date().toISOString(),
        type: role === "user" ? "user" : "agent",
        role: role === "assistant" ? "queen" : undefined,
        thread: activeThread,
        createdAt: Date.now(),
      };
      if (!isFinal) pendingVoiceMsg.current = { id, role };
      else pendingVoiceMsg.current = null;
      return [...prev, msg];
    });

    // Final user speech → mirror into input box AND auto-submit to hive agent
    if (role === "user" && isFinal) {
      setInput(text);
      onSend(text, activeThread);
    }
  }, [activeThread, onSend]);

  const handleVoiceError = useCallback((message: string) => {
    console.warn("[Voice]", message);
    setVoiceError(message);
    setTimeout(() => setVoiceError(null), 6000);
  }, []);

  const { state: voiceState, start: startVoice, stop: stopVoice, getAmplitude, injectText } = useVoice({
    sessionId: sessionId ?? "",
    onTranscript: handleVoiceTranscript,
    onError: handleVoiceError,
  });

  // Auto-start voice when navigated from home page mic button
  const autoStartFired = useRef(false);
  useEffect(() => {
    if (autoStartVoice && sessionId && voiceState === "idle" && !disabled && !autoStartFired.current) {
      autoStartFired.current = true;
      startVoice();
    }
  }, [autoStartVoice, sessionId, voiceState, disabled, startVoice]);

  // Voice mode: when active, hive responses are injected into Gemini Live
  const [voiceMode, setVoiceMode] = useState(false);
  const spokenIdsRef = useRef(new Set<string>());

  // Enter voice mode automatically when voice becomes active
  useEffect(() => {
    if (voiceState === "listening" || voiceState === "speaking") {
      setVoiceMode(true);
    }
  }, [voiceState]);

  // Also enter voice mode if autoStartVoice was requested
  useEffect(() => {
    if (autoStartVoice) setVoiceMode(true);
  }, [autoStartVoice]);

  // When voice mode is on, inject hive agent responses into Gemini Live
  // so Gemini reads them in its own voice (replaces TTS).
  const prevMessageCountRef = useRef(messages.length);
  useEffect(() => {
    if (!voiceMode) {
      prevMessageCountRef.current = messages.length;
      return;
    }

    const newMessages = messages.slice(prevMessageCountRef.current);
    prevMessageCountRef.current = messages.length;

    for (const msg of newMessages) {
      if (msg.type === "user" || msg.type === "system" || msg.type === "tool_status") continue;
      if (!msg.content?.trim()) continue;
      if (spokenIdsRef.current.has(msg.id)) continue;
      spokenIdsRef.current.add(msg.id);
      // Inject into Gemini Live → Gemini reads it aloud and adds "tap or respond" prompt
      injectText(msg.content);
    }
  }, [messages, voiceMode, injectText]);

  // Turn off voice mode handler
  const handleVoiceModeOff = useCallback(() => {
    setVoiceMode(false);
    stopVoice();
  }, [stopVoice]);

  // Clear voice messages when switching threads
  useEffect(() => { setVoiceMessages([]); }, [activeThread]);

  const threadMessages = [
    ...messages.filter((m) => {
      if (m.type === "system" && !m.thread) return false;
      return m.thread === activeThread;
    }),
    ...voiceMessages,
  ].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

  // Mark current thread as read
  useEffect(() => {
    const count = messages.filter((m) => m.thread === activeThread).length;
    setReadMap((prev) => ({ ...prev, [activeThread]: count }));
  }, [activeThread, messages]);

  // Suppress unused var
  void readMap;

  // Autoscroll: only when user is already near the bottom
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = distFromBottom < 80;
  };

  useEffect(() => {
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [threadMessages, pendingQuestion, isWaiting, isWorkerWaiting]);

  // Always start pinned to bottom when switching threads
  useEffect(() => {
    stickToBottom.current = true;
  }, [activeThread]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSend(input.trim(), activeThread);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Compact sub-header */}
      <div className="px-5 pt-4 pb-2 flex items-center gap-2">
        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Conversation</p>
      </div>

      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-auto px-5 py-4 space-y-3">
        {threadMessages.map((msg) => (
          <div key={msg.id}>
            <MessageBubble msg={msg} queenPhase={queenPhase} />
          </div>
        ))}

        {/* Show typing indicator while waiting for first queen response (disabled + empty chat) */}
        {(isWaiting || (disabled && threadMessages.length === 0)) && (
          <div className="flex gap-3">
            <div
              className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
              style={{
                backgroundColor: `${queenColor}18`,
                border: `1.5px solid ${queenColor}35`,
                boxShadow: `0 0 12px ${queenColor}20`,
              }}
            >
              <Crown className="w-4 h-4" style={{ color: queenColor }} />
            </div>
            <div className="border border-primary/20 bg-primary/5 rounded-2xl rounded-tl-md px-4 py-3">
              <div className="flex gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
        {isWorkerWaiting && !isWaiting && (
          <div className="flex gap-3">
            <div
              className="flex-shrink-0 w-7 h-7 rounded-xl flex items-center justify-center"
              style={{
                backgroundColor: `${workerColor}18`,
                border: `1.5px solid ${workerColor}35`,
              }}
            >
              <Cpu className="w-3.5 h-3.5" style={{ color: workerColor }} />
            </div>
            <div className="bg-muted/60 rounded-2xl rounded-tl-md px-4 py-3">
              <div className="flex gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area — question widget replaces textarea when a question is pending */}
      {pendingQuestion && pendingOptions && onQuestionSubmit ? (
        <QuestionWidget
          question={pendingQuestion}
          options={pendingOptions}
          onSubmit={onQuestionSubmit}
          onDismiss={onQuestionDismiss}
        />
      ) : (
        <form onSubmit={handleSubmit} className="p-4">
          {/* Voice mode banner — shows when voice mode is active with option to turn off */}
          {voiceMode && voiceState !== "listening" && voiceState !== "speaking" && !voiceError && (
            <div className="mb-2 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="flex-1">Voice mode on — Gemini is listening</span>
              <button
                type="button"
                onClick={handleVoiceModeOff}
                className="ml-auto px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 transition-colors"
              >
                Turn off
              </button>
            </div>
          )}

          {/* Voice status / error banner */}
          {voiceError ? (
            <div className="mb-2 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 bg-destructive/10 text-destructive border border-destructive/20">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-destructive" />
              {voiceError}
            </div>
          ) : (voiceState === "listening" || voiceState === "speaking") && (
            <div className={[
              "mb-2 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2",
              voiceState === "listening"
                ? "bg-red-500/10 text-red-400 border border-red-500/20"
                : "bg-primary/10 text-primary border border-primary/20",
            ].join(" ")}>
              <span className={[
                "inline-block w-1.5 h-1.5 rounded-full animate-pulse",
                voiceState === "listening" ? "bg-red-400" : "bg-primary",
              ].join(" ")} />
              {voiceState === "listening" ? "Listening… speak naturally" : "Halia is speaking — interrupt any time"}
            </div>
          )}

          <div className={[
            "flex items-center gap-3 bg-muted/40 rounded-xl px-4 py-2.5 border transition-colors",
            voiceState === "listening"
              ? "border-red-500/40"
              : voiceState === "speaking"
              ? "border-primary/40"
              : "border-border focus-within:border-primary/40",
          ].join(" ")}>
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                const ta = e.target;
                ta.style.height = "auto";
                ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder={
                voiceState === "listening"
                  ? "Listening… click stop when done"
                  : disabled
                  ? "Connecting to agent..."
                  : "Message Halia… or click the mic"
              }
              disabled={disabled}
              className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed resize-none overflow-y-auto"
            />

            {/* Voice button — always visible; disabled until a session is active */}
            <VoiceButton
              state={voiceState}
              onStart={startVoice}
              onStop={stopVoice}
              disabled={disabled || !sessionId}
              noSession={!sessionId}
              getAmplitude={getAmplitude}
            />

            {isBusy && onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                className="p-2 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/40 hover:bg-amber-500/25 transition-colors"
              >
                <Square className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() || disabled}
                className="p-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-30 hover:opacity-90 transition-opacity"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
