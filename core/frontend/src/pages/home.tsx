import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Crown, Mail, Briefcase, Shield, Search, Newspaper, ArrowRight, Hexagon, Send, Bot, Radar, Reply, DollarSign, MapPin, Calendar, UserPlus, Twitter } from "lucide-react";
import TopBar from "@/components/TopBar";
import VoiceButton from "@/components/VoiceButton";
import { useVoice } from "@/hooks/use-voice";
import { useTTS } from "@/hooks/use-tts";
import type { LucideIcon } from "lucide-react";
import { agentsApi } from "@/api/agents";

import type { DiscoverEntry } from "@/api/types";

// --- Icon and color maps (backend can't serve icons) ---

const AGENT_ICONS: Record<string, LucideIcon> = {
  email_inbox_management: Mail,
  job_hunter: Briefcase,
  vulnerability_assessment: Shield,
  deep_research_agent: Search,
  tech_news_reporter: Newspaper,
  competitive_intel_agent: Radar,
  email_reply_agent: Reply,
  hubspot_revenue_leak_detector: DollarSign,
  local_business_extractor: MapPin,
  meeting_scheduler: Calendar,
  sdr_agent: UserPlus,
  twitter_news_agent: Twitter,
};

const AGENT_COLORS: Record<string, string> = {
  email_inbox_management: "hsl(210,75%,55%)",
  job_hunter: "hsl(200,75%,50%)",
  vulnerability_assessment: "hsl(15,70%,52%)",
  deep_research_agent: "hsl(220,70%,58%)",
  tech_news_reporter: "hsl(270,60%,55%)",
  competitive_intel_agent: "hsl(190,70%,45%)",
  email_reply_agent: "hsl(215,70%,55%)",
  hubspot_revenue_leak_detector: "hsl(145,60%,42%)",
  local_business_extractor: "hsl(350,65%,55%)",
  meeting_scheduler: "hsl(225,65%,58%)",
  sdr_agent: "hsl(165,55%,45%)",
  twitter_news_agent: "hsl(200,85%,55%)",
};

function agentSlug(path: string): string {
  return path.replace(/\/$/, "").split("/").pop() || path;
}

// --- Generic prompt hints (not tied to specific agents) ---

const promptHints = [
  "Check my inbox for urgent emails",
  "Find senior engineer roles that match my profile",
  "Research the latest trends in AI agents",
  "Run a security scan on my domain",
];

export default function Home() {
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { speak } = useTTS();
  // Speak the greeting once on first user interaction (autoplay policy)
  const greetingSpoken = useRef(false);
  const speakGreeting = useCallback(() => {
    if (greetingSpoken.current) return;
    greetingSpoken.current = true;
    speak("Describe a task for the hive, or click the mic.");
  }, [speak]);

  const [showAgents, setShowAgents] = useState(false);
  const [agents, setAgents] = useState<DiscoverEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [voiceSessionId, setVoiceSessionId] = useState<string | null>(null);
  const [voiceCreating, setVoiceCreating] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const pendingVoiceStart = useRef(false);

  // Accumulates interim transcript deltas within a single utterance.
  // Gemini sends incremental chunks ("build", "an", "agent") not cumulative text,
  // so we concatenate them ourselves and reset when finished=true.
  const voiceAccumRef = useRef("");

  const handleVoiceTranscript = useCallback((text: string, role: "user" | "assistant", isFinal: boolean) => {
    if (role === "user" && text.trim()) {
      if (isFinal) {
        // Gemini's final message contains the complete utterance text.
        voiceAccumRef.current = "";
        setInputValue(text);
      } else {
        // Interim: delta chunk — accumulate with a space separator.
        const sep = voiceAccumRef.current && !voiceAccumRef.current.endsWith(" ") ? " " : "";
        voiceAccumRef.current += sep + text;
        setInputValue(voiceAccumRef.current);
      }
      textareaRef.current?.focus();
    }
  }, []);

  const handleVoiceError = useCallback((message: string) => {
    console.warn("[Voice]", message);
    setVoiceError(message);
    setTimeout(() => setVoiceError(null), 6000);
  }, []);

  const { state: voiceState, start: startVoice, stop: stopVoice, getAmplitude } = useVoice({
    sessionId: voiceSessionId ?? "",
    onTranscript: handleVoiceTranscript,
    onError: handleVoiceError,
  });

  // Auto-start voice once session is ready
  useEffect(() => {
    if (pendingVoiceStart.current && voiceSessionId && voiceState === "idle") {
      pendingVoiceStart.current = false;
      startVoice();
    }
  }, [voiceSessionId, voiceState, startVoice]);

  const handleVoiceClick = useCallback(async () => {
    if (voiceState === "listening" || voiceState === "speaking") {
      stopVoice();
      return;
    }
    speakGreeting();
    voiceAccumRef.current = "";
    setInputValue("");
    if (voiceSessionId) {
      startVoice();
      return;
    }
    setVoiceCreating(true);
    try {
      const { sessionsApi } = await import("@/api/sessions");
      const session = await sessionsApi.create();
      setVoiceSessionId(session.session_id);
      pendingVoiceStart.current = true;
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : "Failed to start voice session");
    } finally {
      setVoiceCreating(false);
    }
  }, [voiceState, voiceSessionId, startVoice, stopVoice, speakGreeting]);

  // Fetch agents on mount so data is ready when user toggles
  useEffect(() => {
    setLoading(true);
    agentsApi
      .discover()
      .then((result) => {
        const examples = result["Examples"] || [];
        setAgents(examples);
      })
      .catch((err) => {
        setError(err.message || "Failed to load agents");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const handleSelect = (agentPath: string) => {
    navigate(`/workspace?agent=${encodeURIComponent(agentPath)}`);
  };

  const handlePromptHint = (text: string) => {
    navigate(`/workspace?agent=new-agent&prompt=${encodeURIComponent(text)}`);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      navigate(`/workspace?agent=new-agent&prompt=${encodeURIComponent(inputValue.trim())}`);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <TopBar />

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-2xl">
          {/* Queen Bee greeting */}
          <div className="text-center mb-8">
            <div
              className="inline-flex w-12 h-12 rounded-2xl items-center justify-center mb-4"
              style={{
                backgroundColor: "hsl(210,85%,55%,0.1)",
                border: "1.5px solid hsl(210,85%,55%,0.25)",
                boxShadow: "0 0 24px hsl(210,85%,55%,0.08)",
              }}
            >
              <Crown className="w-6 h-6 text-primary" />
            </div>
            <h1 className="text-xl font-semibold text-foreground mb-1.5">What can I help you with?</h1>
            <p className="text-sm text-muted-foreground">
              I'm your Queen Bee — I create and coordinate worker agents to handle tasks for you.
            </p>
          </div>

          {/* Voice status banner */}
          {voiceError ? (
            <div className="mb-3 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 bg-destructive/10 text-destructive border border-destructive/20">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-destructive" />
              {voiceError}
            </div>
          ) : (voiceState === "listening" || voiceState === "speaking") && (
            <div className={[
              "mb-3 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2",
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

          {/* Chat input */}
          <form onSubmit={handleSubmit} className="mb-4">
            <div className={[
              "relative border rounded-xl bg-card/50 transition-colors shadow-sm",
              voiceState === "listening"
                ? "border-red-500/40"
                : "border-border/60 hover:border-primary/30 focus-within:border-primary/40",
            ].join(" ")}>
              <textarea
                ref={textareaRef}
                rows={1}
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
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
                    : "Describe a task for the hive… or click the mic"
                }
                className="w-full bg-transparent px-5 py-4 pr-24 text-sm focus:outline-none rounded-xl resize-none overflow-y-auto text-foreground placeholder:text-muted-foreground/60"
              />
              <div className="absolute right-3 bottom-2.5 flex items-center gap-1.5">
                <VoiceButton
                  state={voiceCreating ? "connecting" : voiceState}
                  onStart={handleVoiceClick}
                  onStop={handleVoiceClick}
                  getAmplitude={getAmplitude}
                />
                {/* Send button */}
                <button
                  type="submit"
                  disabled={!inputValue.trim()}
                  className="w-7 h-7 rounded-lg bg-primary/90 hover:bg-primary text-primary-foreground flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </form>

          {/* Action buttons */}
          <div className="flex items-center justify-center gap-3 mb-6">
            <button
              onClick={() => setShowAgents(!showAgents)}
              className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/[0.03] transition-all"
            >
              <Hexagon className="w-4 h-4 text-primary/60" />
              <span>Try a sample agent</span>
              <ArrowRight className={`w-3.5 h-3.5 transition-transform duration-200 ${showAgents ? "rotate-90" : ""}`} />
            </button>
            <button
              onClick={() => navigate("/my-agents")}
              className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/[0.03] transition-all"
            >
              <Bot className="w-4 h-4 text-primary/60" />
              <span>My Agents</span>
            </button>
          </div>

          {/* Prompt hint pills */}
          <div className="flex flex-wrap justify-center gap-2 mb-6">
            {promptHints.map((hint) => (
              <button
                key={hint}
                onClick={() => handlePromptHint(hint)}
                className="text-xs text-muted-foreground hover:text-foreground border border-border/50 hover:border-primary/30 rounded-full px-3.5 py-1.5 transition-all hover:bg-primary/[0.03]"
              >
                {hint}
              </button>
            ))}
          </div>

          {/* Agent cards — revealed on toggle */}
          {showAgents && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              {loading && (
                <div className="text-center py-8 text-sm text-muted-foreground">Loading agents...</div>
              )}
              {error && (
                <div className="text-center py-8 text-sm text-destructive">{error}</div>
              )}
              {!loading && !error && agents.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">No sample agents found.</div>
              )}
              {!loading && !error && agents.length > 0 && (
                <div className="grid grid-cols-3 gap-3">
                  {agents.map((agent) => {
                    const slug = agentSlug(agent.path);
                    const Icon = AGENT_ICONS[slug] || Hexagon;
                    const color = AGENT_COLORS[slug] || "hsl(210,85%,55%)";
                    return (
                      <button
                        key={agent.path}
                        onClick={() => handleSelect(agent.path)}
                        className="text-left rounded-xl border border-border/60 p-4 transition-all duration-200 hover:border-primary/30 hover:bg-primary/[0.03] group relative overflow-hidden h-full flex flex-col"
                      >
                        <div className="flex flex-col flex-1">
                          <div className="flex items-center gap-3 mb-2.5">
                            <div
                              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                              style={{
                                backgroundColor: `${color}15`,
                                border: `1.5px solid ${color}30`,
                              }}
                            >
                              <Icon className="w-4 h-4" style={{ color }} />
                            </div>
                            <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                              {agent.name}
                            </h3>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed mb-3 line-clamp-2">
                            {agent.description}
                          </p>
                          <div className="flex gap-1.5 flex-wrap mt-auto">
                            {agent.tags.length > 0 ? (
                              agent.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground"
                                >
                                  {tag}
                                </span>
                              ))
                            ) : (
                              <>
                                {agent.node_count > 0 && (
                                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground">
                                    {agent.node_count} nodes
                                  </span>
                                )}
                                {agent.tool_count > 0 && (
                                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground">
                                    {agent.tool_count} tools
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
