"""POST /api/tts — text-to-speech via Gemini Live API.

Accepts {"text": "..."} and returns {"audio": "<base64 PCM int16 24kHz mono>"}.
Uses the same API key resolution as the voice WebSocket endpoint.
"""

import base64
import logging
import os

from aiohttp import web

logger = logging.getLogger(__name__)

_GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts"
_VOICE_NAME = "Aoede"


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


async def handle_tts(request: web.Request) -> web.Response:
    """Convert text to speech audio using Gemini TTS."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    text = (body.get("text") or "").strip()
    if not text:
        return web.json_response({"error": "text is required"}, status=400)

    api_key = _get_api_key(request)
    if not api_key:
        return web.json_response(
            {"error": "GOOGLE_API_KEY not configured"},
            status=500,
        )

    try:
        from google import genai
        from google.genai import types as gtypes
    except ImportError:
        return web.json_response(
            {"error": "google-genai not installed on server"},
            status=500,
        )

    client = genai.Client(api_key=api_key)

    try:
        response = await client.aio.models.generate_content(
            model=_GEMINI_TTS_MODEL,
            contents=text,
            config=gtypes.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=gtypes.SpeechConfig(
                    voice_config=gtypes.VoiceConfig(
                        prebuilt_voice_config=gtypes.PrebuiltVoiceConfig(
                            voice_name=_VOICE_NAME,
                        )
                    )
                ),
            ),
        )

        # Extract audio data from the response
        audio_data = b""
        if response.candidates:
            for part in response.candidates[0].content.parts:
                if part.inline_data and part.inline_data.data:
                    audio_data = part.inline_data.data
                    break

        if not audio_data:
            return web.json_response({"error": "No audio in response"}, status=500)

        return web.json_response(
            {
                "audio": base64.b64encode(audio_data).decode(),
                "sample_rate": 24000,
            }
        )

    except Exception as exc:
        logger.exception("TTS generation failed: %s", exc)
        return web.json_response({"error": str(exc)}, status=500)


def register_routes(app: web.Application) -> None:
    app.router.add_post("/api/tts", handle_tts)
