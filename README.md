<p align="center">
  <h1 align="center">Halia</h1>
  <p align="center">
    Voice-first AI agent platform powered by Google Gemini Live
    <br />
    <em>Speak naturally. Get real-time spoken responses. Text always available.</em>
  </p>
  <p align="center">
    <a href="https://github.com/Agentscreator/halia-agent/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License"></a>
    <img src="https://img.shields.io/badge/python-3.11%2B-3776AB?logo=python&logoColor=white" alt="Python 3.11+">
    <img src="https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white" alt="Node 20+">
    <img src="https://img.shields.io/badge/Gemini_Live-4285F4?logo=google&logoColor=white" alt="Gemini Live">
    <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" alt="React 18">
  </p>
</p>

<br />

## Overview

Halia is a voice-first AI agent platform built on the Google Gemini Live API. Instead of typing commands and reading text, you speak — and Halia speaks back in real time. A full text interface is always available alongside voice.

Under the hood, Halia runs a session-based multi-agent framework with a real-time graph executor, encrypted credential management, and live observability via Server-Sent Events.

<br />

## ✨ Features

<table>
  <tr>
    <td>🎙️&nbsp;&nbsp;<strong>Voice-First Interaction</strong></td>
    <td>Click the mic, speak, and hear real-time spoken responses via Gemini Live 2.5 Flash</td>
  </tr>
  <tr>
    <td>⌨️&nbsp;&nbsp;<strong>Text Always Available</strong></td>
    <td>Type in the chat input at any time — voice and text work side by side</td>
  </tr>
  <tr>
    <td>⚡&nbsp;&nbsp;<strong>Low-Latency Streaming</strong></td>
    <td>Bidirectional audio via WebSocket with natural voice output (Aoede voice)</td>
  </tr>
  <tr>
    <td>🤖&nbsp;&nbsp;<strong>Multi-Agent Graphs</strong></td>
    <td>Define goal-driven agents as node graphs; a Queen agent orchestrates workers</td>
  </tr>
  <tr>
    <td>🔄&nbsp;&nbsp;<strong>Self-Improving Agents</strong></td>
    <td>On failure, the framework captures data, evolves the graph, and redeploys</td>
  </tr>
  <tr>
    <td>📡&nbsp;&nbsp;<strong>Real-Time Observability</strong></td>
    <td>Live SSE streaming of agent execution, node states, and decisions</td>
  </tr>
  <tr>
    <td>🧑‍💻&nbsp;&nbsp;<strong>Human-in-the-Loop</strong></td>
    <td>Intervention nodes pause execution for human input with configurable timeouts</td>
  </tr>
  <tr>
    <td>🔐&nbsp;&nbsp;<strong>Credential Management</strong></td>
    <td>Encrypted API key storage — add once, available everywhere</td>
  </tr>
</table>

<br />

## 🛠 Tech Stack

| Layer | Technology |
|:------|:-----------|
| Voice AI | Google Gemini Live API (`gemini-live-2.5-flash`) |
| Agent Runtime | Python 3.11 · aiohttp · async graph executor |
| Frontend | React 18 · TypeScript · Tailwind CSS · Vite |
| Streaming | WebSocket (voice) · Server-Sent Events (agent events) |
| LLM Support | LiteLLM — Gemini, Claude, OpenAI, local models |
| Package Manager | [uv](https://docs.astral.sh/uv/) |

<br />

## 🚀 Quick Start

### Prerequisites

- Python 3.11+
- Node.js 20+
- A Google API key with Gemini Live access — [get one here](https://aistudio.google.com/apikey)

### 1. Clone and install

```bash
git clone https://github.com/Agentscreator/halia-agent.git
cd halia-agent
./quickstart.sh
```

The quickstart script sets up:
- Agent runtime and graph executor (`core/.venv`)
- MCP tools for agent capabilities (`tools/.venv`)
- Encrypted credential store (`~/.hive/credentials`)
- All Python dependencies via `uv`

### 2. Add your API key

Create a `.env` file in the project root:

```bash
echo "GOOGLE_API_KEY=your_key_here" > .env
```

Or add it through the UI after starting: **Settings → Credentials → Add GOOGLE_API_KEY**

### 3. Start the server

```bash
cd core
uv sync
uv run hive server
```

Open [http://localhost:8000](http://localhost:8000) and you're ready to go.

<br />

## 🎙️ Voice

1. Open a session in the workspace
2. Click the mic button next to the text input
3. Speak — the mic pulses red while listening
4. Halia responds with audio; the speaker icon shows while she speaks
5. Click the mic again (or the stop button) to end the voice session

Voice transcripts appear in the chat alongside text messages, so you always have a full written record.

<br />

## 🔧 How It Works

```
User speaks → Browser captures 16 kHz PCM audio
            → WebSocket streams chunks to backend
            → Backend proxies to Gemini Live API
            → Gemini returns audio (24 kHz) + text transcript
            → Audio plays back in real time
            → Transcript shown in chat
            → Response injected into agent context
```

<br />

## 🏗 Architecture

Halia uses a **Queen + Worker** agent pattern:

| Component | Role |
|:----------|:-----|
| Queen | Orchestrates conversation, delegates tasks, monitors worker output |
| Workers | Execute specific goals as node graphs with tools, memory, and LLM access |
| Judge | Evaluates worker output against defined criteria and escalates failures |
| Event Bus | Pub/sub system streaming 25+ event types to the frontend in real time |

<br />

## 📁 Project Structure

```
halia-agent/
├── core/
│   ├── framework/            # Agent runtime, graph executor, API server
│   │   ├── server/           # aiohttp routes (REST + SSE + WebSocket)
│   │   ├── llm/              # LLM provider abstraction (LiteLLM, Gemini, Claude)
│   │   └── runtime/          # Graph executor, event bus, session management
│   └── frontend/             # React + TypeScript UI
│       └── src/
│           ├── components/   # ChatPanel, VoiceButton, AgentGraph, TopBar…
│           ├── hooks/        # useVoice, useSSE, useMultiSSE
│           └── pages/        # Home, Workspace, My Agents
├── tools/                    # MCP tool server
├── exports/                  # Your saved agents
├── examples/                 # Template agents
├── docs/                     # Architecture docs and guides
└── .env                      # Your API keys (gitignored)
```

<br />

## ⚙️ Configuration

| Variable | Required | Description |
|:---------|:---------|:------------|
| `GOOGLE_API_KEY` | Yes | Gemini Live API access for voice |
| `ANTHROPIC_API_KEY` | No | Enables Claude models for agent tasks |
| `OPENAI_API_KEY` | No | Enables GPT models |
| `HIVE_CREDENTIAL_KEY` | Auto | Auto-generated key that encrypts the credential store |

<br />

## 🧩 Building Agents

Agents live in `exports/` as Python packages. Each agent defines a node graph in `graph_spec.py`:

```python
graph = GraphSpec(
    nodes=[
        Node(id="my_node", system_prompt="You are a helpful assistant."),
    ]
)
```

Or describe the agent you want in the home input — the Queen agent generates the graph and wiring automatically.

<br />

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Push and open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

<br />

## 🔒 Security

For security concerns, see [SECURITY.md](SECURITY.md).

> Never commit your `.env` file or API keys. The `.env` file is gitignored by default.

<br />

## 📄 License

Apache License 2.0 — see [LICENSE](LICENSE) for details.
