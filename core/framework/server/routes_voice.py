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
_GEMINI_LIVE_MODEL = "gemini-2.5-flash-native-audio-latest"

_SYSTEM_PROMPT = (
    "You are Halia, a voice-first AI assistant powered by Gemini Live. "
    "You help users interact with the Hive agent system — a multi-agent framework "
    "that creates and coordinates worker agents to complete tasks. "
    "Keep responses conversational and concise since they will be spoken aloud. "
    "Avoid markdown or formatting that doesn't translate to speech. "
    "When the user describes a task, acknowledge it and let them know the Hive is on it."
)


def _get_api_key(request: web.Request) -> str | None:
    """Resolve Google API key from credential store or environment."""
    store = request.app.get("credential_store")
    if store is not None:
        try:
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
    """Inject a user voice input into the queen agent as context."""
    try:
        queen_executor = session.queen_executor
        if queen_executor is None:
            return
        node = queen_executor.node_registry.get("queen")
        if node is not None and hasattr(node, "inject_event"):
            await node.inject_event(f"[Voice input]: {text}", is_client_input=True)
    except Exception as exc:
        logger.debug("Voice transcript injection failed: %s", exc)


async def handle_voice(request: web.Request) -> web.WebSocketResponse:
    """WebSocket /api/sessions/{session_id}/voice — full Gemini Live audio proxy.

    Protocol (JSON over WebSocket):
      Client → Server:
        {"type": "audio_chunk", "data": "<base64 PCM int16 16kHz mono>"}

      Server → Client:
        {"type": "ready"}
        {"type": "audio_chunk", "data": "<base64 PCM int16 24kHz mono>"}   # Gemini speaking
        {"type": "user_transcript",      "text": "...", "finished": bool}  # what user said
        {"type": "assistant_transcript", "text": "...", "finished": bool}  # what Gemini said
        {"type": "interrupted"}                                             # user interrupted
        {"type": "error", "message": "..."}
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
        response_modalities=["AUDIO"],
        system_instruction=_SYSTEM_PROMPT,
        speech_config=gtypes.SpeechConfig(
            voice_config=gtypes.VoiceConfig(
                prebuilt_voice_config=gtypes.PrebuiltVoiceConfig(voice_name="Aoede")
            )
        ),
        # Transcribe both user speech and Gemini's audio output
        input_audio_transcription=gtypes.AudioTranscriptionConfig(),
        output_audio_transcription=gtypes.AudioTranscriptionConfig(),
        realtime_input_config=gtypes.RealtimeInputConfig(
            automatic_activity_detection=gtypes.AutomaticActivityDetection(
                # Respond quickly; short silence ends the user's turn
                silence_duration_ms=800,
                start_of_speech_sensitivity=gtypes.StartSensitivity.START_SENSITIVITY_HIGH,
            ),
        ),
    )

    try:
        async with client.aio.live.connect(model=_GEMINI_LIVE_MODEL, config=config) as gemini:
            await ws.send_json({"type": "ready"})

            async def browser_to_gemini() -> None:
                """Stream browser mic audio to Gemini Live."""
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
                    elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.ERROR):
                        break

            async def gemini_to_browser() -> None:
                """Forward Gemini audio, transcripts, and events to the browser."""
                async for response in gemini.receive():
                    if ws.closed:
                        break

                    sc = response.server_content
                    if not sc:
                        continue

                    # Gemini speaking — send raw PCM audio to browser for playback
                    if response.data:
                        await ws.send_json({
                            "type": "audio_chunk",
                            "data": base64.b64encode(response.data).decode(),
                        })

                    # User interrupted Gemini — browser should clear its audio queue
                    if sc.interrupted:
                        await ws.send_json({"type": "interrupted"})

                    # What the user said (input transcription)
                    if sc.input_transcription and sc.input_transcription.text:
                        trans = sc.input_transcription
                        await ws.send_json({
                            "type": "user_transcript",
                            "text": trans.text,
                            "finished": bool(trans.finished),
                        })
                        # Inject final user utterances into the hive agent pipeline
                        if trans.finished:
                            await _inject_to_queen(session, trans.text)

                    # What Gemini said (output transcription)
                    if sc.output_transcription and sc.output_transcription.text:
                        trans = sc.output_transcription
                        await ws.send_json({
                            "type": "assistant_transcript",
                            "text": trans.text,
                            "finished": bool(trans.finished),
                        })

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
