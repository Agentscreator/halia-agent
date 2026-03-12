"""WebSocket endpoint for Gemini Live real-time voice interaction."""

import asyncio
import base64
import json
import logging
import os
from typing import Any

import aiohttp
from aiohttp import web

logger = logging.getLogger(__name__)

# Gemini Live model — supports native audio I/O
_GEMINI_LIVE_MODEL = "gemini-live-2.5-flash-preview"

_SYSTEM_PROMPT = (
    "You are Halia, a voice-first AI assistant. "
    "Keep your responses conversational and concise — they will be spoken aloud. "
    "Avoid markdown, bullet lists, or formatting that doesn't translate to speech."
)


def _get_api_key(request: web.Request) -> str | None:
    """Resolve Google API key from credential store or environment."""
    store = request.app.get("credential_store")
    if store is not None:
        try:
            # Try well-known key names stored via the credentials UI
            for key_name in ("GOOGLE_API_KEY", "GEMINI_API_KEY"):
                creds = store.list_credentials()
                for cid in creds:
                    cred = store.get_credential(cid, refresh_if_needed=False)
                    if cred and key_name in cred.keys:
                        return cred.keys[key_name].get_secret_value()
        except Exception:
            pass
    return os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")


async def _inject_to_queen(session: Any, text: str) -> None:
    """Inject an assistant voice response into the queen agent as context."""
    try:
        queen_executor = session.queen_executor
        if queen_executor is None:
            return
        node = queen_executor.node_registry.get("queen")
        if node is not None and hasattr(node, "inject_event"):
            # inject as non-triggering context so the queen stays aware of the conversation
            await node.inject_event(f"[Voice response]: {text}", is_client_input=False)
    except Exception as exc:
        logger.debug("Voice transcript injection failed: %s", exc)


async def handle_voice(request: web.Request) -> web.WebSocketResponse:
    """WebSocket /api/sessions/{session_id}/voice — Gemini Live audio proxy.

    Protocol (JSON over WebSocket):
      Client → Server:
        {"type": "audio_chunk", "data": "<base64 PCM int16 16kHz mono>"}
        {"type": "end_of_turn"}   # user released mic button

      Server → Client:
        {"type": "ready"}                                           # session open
        {"type": "audio_chunk", "data": "<base64 PCM int16 24kHz mono>"}
        {"type": "transcript", "text": "...", "role": "assistant"}
        {"type": "error",   "message": "..."}
    """
    from framework.server.app import resolve_session

    session, err = resolve_session(request)
    if err:
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        await ws.send_json({"type": "error", "message": "Session not found"})
        await ws.close()
        return ws

    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)

    api_key = _get_api_key(request)
    if not api_key:
        await ws.send_json({
            "type": "error",
            "message": "GOOGLE_API_KEY not configured. Add it via Settings → Credentials.",
        })
        await ws.close()
        return ws

    try:
        from google import genai
        from google.genai import types as gtypes
    except ImportError:
        await ws.send_json({"type": "error", "message": "google-genai not installed on server"})
        await ws.close()
        return ws

    client = genai.Client(api_key=api_key)
    config = gtypes.LiveConnectConfig(
        response_modalities=["AUDIO", "TEXT"],
        system_instruction=_SYSTEM_PROMPT,
        speech_config=gtypes.SpeechConfig(
            voice_config=gtypes.VoiceConfig(
                prebuilt_voice_config=gtypes.PrebuiltVoiceConfig(voice_name="Aoede")
            )
        ),
    )

    try:
        async with client.aio.live.connect(model=_GEMINI_LIVE_MODEL, config=config) as gemini:
            await ws.send_json({"type": "ready"})

            async def browser_to_gemini() -> None:
                """Forward browser audio chunks to Gemini Live."""
                async for msg in ws:
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        try:
                            data = json.loads(msg.data)
                        except json.JSONDecodeError:
                            continue
                        if data.get("type") == "audio_chunk":
                            raw = base64.b64decode(data["data"])
                            await gemini.send(
                                input=gtypes.LiveClientRealtimeInput(
                                    media_chunks=[
                                        gtypes.Blob(data=raw, mime_type="audio/pcm;rate=16000")
                                    ]
                                )
                            )
                        elif data.get("type") == "end_of_turn":
                            await gemini.send(input="", end_of_turn=True)
                    elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.ERROR):
                        break

            async def gemini_to_browser() -> None:
                """Forward Gemini responses (audio + text) to browser."""
                async for response in gemini.receive():
                    if ws.closed:
                        break
                    if response.data:
                        # PCM int16 24kHz mono — send as base64
                        await ws.send_json({
                            "type": "audio_chunk",
                            "data": base64.b64encode(response.data).decode(),
                        })
                    if response.text:
                        await ws.send_json({
                            "type": "transcript",
                            "text": response.text,
                            "role": "assistant",
                        })
                        await _inject_to_queen(session, response.text)

            browser_task = asyncio.ensure_future(browser_to_gemini())
            gemini_task = asyncio.ensure_future(gemini_to_browser())

            _done, pending = await asyncio.wait(
                {browser_task, gemini_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass

    except Exception as exc:
        logger.exception("Gemini Live session error: %s", exc)
        if not ws.closed:
            await ws.send_json({"type": "error", "message": str(exc)})

    if not ws.closed:
        await ws.close()
    return ws


def register_routes(app: web.Application) -> None:
    app.router.add_get("/api/sessions/{session_id}/voice", handle_voice)
