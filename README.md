# Halia

**Voice-first AI assistant powered by Google Gemini Live.**

Speak naturally, get real-time spoken responses. Text is always available too.

---

## Overview

Halia is a voice-first AI agent platform built on Google Gemini Live API. Instead of typing commands and reading text responses, you speak — and Halia speaks back in real time. The interface is built around natural, conversational audio interaction, with a full text fallback for when you prefer to type.

Under the hood, Halia runs a session-based multi-agent framework with a real-time graph executor, credential management, and live observability. Agents are defined as goal-driven node graphs that can self-improve on failure.

## Key Features

- **Voice-First Interaction** — Click the mic, speak your command or question, and hear a real-time spoken response via Gemini Live 2.5 Flash
- **Text Always Available** — Type in the chat input at any time; voice and text work side by side
- **Gemini Live API** — Low-latency bidirectional audio streaming with natural voice output (Aoede voice)
- **Multi-Agent Graphs** — Define goal-driven agents as node graphs; a Queen agent orchestrates worker agents
- **Self-Improving Agents** — On failure, the framework captures failure data, evolves the agent graph, and redeploys
- **Real-Time Observability** — Live SSE streaming of agent execution, node states, and decisions
- **Human-in-the-Loop** — Intervention nodes pause execution for human input with configurable timeouts
- **Credential Management** — Encrypted API key storage; add your Google API key once and it's available everywhere
- **Google Cloud Ready** — Designed for deployment on Google Cloud infrastructure

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Voice AI | Google Gemini Live API (gemini-live-2.5-flash) |
| Agent Runtime | Python + aiohttp, async graph executor |
| Frontend | React 18, TypeScript, Tailwind CSS, Vite |
| Streaming | WebSocket (voice), Server-Sent Events (agent events) |
| LLM Support | LiteLLM — Gemini, Claude, OpenAI, local models |
| Package Manager | uv |

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 20+
- A Google API key with Gemini Live access — [get one at aistudio.google.com](https://aistudio.google.com/apikey)

### Installation

```bash
# Clone the repository
git clone https://github.com/Agentscreator/halia-agent.git
cd halia-agent

# Run quickstart setup
./quickstart.sh
```

This sets up:
- Agent runtime and graph executor (`core/.venv`)
- MCP tools for agent capabilities (`tools/.venv`)
- Encrypted credential store (`~/.hive/credentials`)
- All Python dependencies via `uv`

### Add Your Google API Key

Create a `.env` file in the project root:

```bash
echo "GOOGLE_API_KEY=your_key_here" > .env
```

Or add it through the UI after starting the server: **Settings → Credentials → Add GOOGLE_API_KEY**.

### Start the Server

```bash
cd core
uv sync
uv run hive server
```

Then open [http://localhost:8000](http://localhost:8000) in your browser.

## Using Voice

1. Open a session in the workspace
2. Click the **mic button** next to the text input
3. Speak — the mic pulses red while listening
4. Halia responds with audio; the speaker icon shows while she speaks
5. Click the mic again (or the stop button) to end the session

Voice transcripts appear in the chat alongside any text messages, so you always have a full written record of the conversation.

## Using Text

The text input works exactly as you'd expect — type a message and press Enter or click Send. Text and voice can be used interchangeably within the same session.

## How It Works

```
User speaks → Browser captures 16 kHz PCM audio
            → WebSocket streams chunks to backend
            → Backend proxies to Gemini Live API
            → Gemini returns audio (24 kHz) + text transcript
            → Audio plays back in real time
            → Transcript shown in chat
            → Response injected into agent context
```

## Agent Architecture

Halia's agent system uses a Queen + Worker pattern:

- **Queen** — orchestrates the conversation, delegates tasks, monitors worker output
- **Workers** — execute specific goals as node graphs with tools, memory, and LLM access
- **Judge** — evaluates worker output against defined criteria and escalates failures
- **Event Bus** — pub/sub system that streams 25+ event types to the frontend in real time

## Project Structure

```
halia-agent/
├── core/
│   ├── framework/          # Agent runtime, graph executor, API server
│   │   ├── server/         # aiohttp routes (REST + SSE + WebSocket voice)
│   │   ├── llm/            # LLM provider abstraction (LiteLLM, Gemini, Claude)
│   │   └── runtime/        # Graph executor, event bus, session management
│   └── frontend/           # React + TypeScript UI
│       └── src/
│           ├── components/  # ChatPanel, VoiceButton, AgentGraph, TopBar…
│           ├── hooks/       # useVoice, useSSE, useMultiSSE
│           └── pages/       # Home, Workspace, My Agents
├── exports/                # Your saved agents
├── examples/               # Template agents
├── tools/                  # MCP tool server
└── .env                    # Your API keys (gitignored)
```

## Configuration

| Environment Variable | Description |
|---------------------|-------------|
| `GOOGLE_API_KEY` | Required for voice — Gemini Live API access |
| `ANTHROPIC_API_KEY` | Optional — enables Claude models for agent tasks |
| `OPENAI_API_KEY` | Optional — enables GPT models |
| `HIVE_CREDENTIAL_KEY` | Auto-generated — encrypts the credential store |

## Building Agents

Agents live in `exports/` as Python packages. Each agent defines a node graph in `graph_spec.py`:

```python
# Minimal agent structure
graph = GraphSpec(
    nodes=[
        Node(id="my_node", system_prompt="You are a helpful assistant."),
    ]
)
```

Type a description of the agent you want to build in the home input — the Queen agent generates the graph and connection code automatically.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Push and open a Pull Request

## Security

For security concerns, please see [SECURITY.md](SECURITY.md).

Never commit your `.env` file or API keys. The `.env` file is gitignored by default.

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.
