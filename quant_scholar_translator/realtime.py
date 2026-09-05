"""
Quant Scholar Translator — local Whisper + professional translation backend.

WebSocket protocol:
  client -> server (text JSON):
    { "type": "config",
      "sampleRate": 16000,
      "sourceLang": "auto" | "en" | "es" | ...,
      "targetLang": "ar",
      "task": "transcribe" | "translate" }
  client -> server (binary): raw little-endian Int16 PCM, mono, sampleRate Hz

  server -> client (text JSON):
    { "type": "transcript", "text": "...", "isFinal": true }
    { "type": "error", "message": "..." }
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import secrets
import sys
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path

# Make pip-installed NVIDIA libs discoverable by ctranslate2 on Windows.
# Without this, faster-whisper crashes with "cublas64_12.dll not found"
# even though the package is installed.
def _register_nvidia_dll_dirs() -> None:
    if sys.platform != "win32":
        return
    # `nvidia.cublas` etc are themselves PEP-420 namespace packages — they have
    # no __init__.py, so __file__ is None. Use __path__ (which IS populated for
    # namespace packages) to locate the install root.
    nvidia_root: Path | None = None
    for mod_name in ("nvidia.cublas", "nvidia.cudnn", "nvidia.cuda_nvrtc"):
        try:
            mod = __import__(mod_name, fromlist=["__path__"])
        except ImportError:
            continue
        paths = list(getattr(mod, "__path__", []) or [])
        if paths:
            nvidia_root = Path(paths[0]).resolve().parent
            break
    if nvidia_root is None:
        print("[kami-subs] nvidia packages not installed; running on CPU only")
        return
    print(f"[kami-subs] nvidia root: {nvidia_root}")

    bin_dirs = [nvidia_root / sub for sub in (
        "cuda_runtime/bin", "cublas/bin", "cudnn/bin", "cuda_nvrtc/bin",
    )]
    bin_dirs = [d for d in bin_dirs if d.exists()]

    for d in bin_dirs:
        try:
            os.add_dll_directory(str(d))
        except (AttributeError, OSError):
            pass
        os.environ["PATH"] = str(d) + os.pathsep + os.environ.get("PATH", "")

    # Preload the critical DLLs explicitly. `os.add_dll_directory` doesn't
    # always reach the threads ctranslate2 spawns for GPU work, so we force
    # them into the process address space here. Once loaded, the OS resolves
    # the same name to the in-memory module from any thread.
    import ctypes
    # ORDER MATTERS: load CUDA runtime first since cuBLAS/cuDNN depend on it.
    preload = [
        ("cuda_runtime/bin", "cudart64_12.dll"),
        ("cublas/bin",       "cublas64_12.dll"),
        ("cublas/bin",       "cublasLt64_12.dll"),
        ("cuda_nvrtc/bin",   "nvrtc64_120_0.dll"),
        ("cudnn/bin",        "cudnn64_9.dll"),
        ("cudnn/bin",        "cudnn_cnn64_9.dll"),
        ("cudnn/bin",        "cudnn_ops64_9.dll"),
        ("cudnn/bin",        "cudnn_engines_precompiled64_9.dll"),
        ("cudnn/bin",        "cudnn_engines_runtime_compiled64_9.dll"),
        ("cudnn/bin",        "cudnn_graph64_9.dll"),
        ("cudnn/bin",        "cudnn_heuristic64_9.dll"),
        ("cudnn/bin",        "cudnn_adv64_9.dll"),
    ]
    for sub, name in preload:
        full = nvidia_root / sub / name
        if not full.exists():
            continue
        try:
            ctypes.WinDLL(str(full))
        except OSError as e:
            print(f"[kami-subs] failed to preload {name}: {e}")

_register_nvidia_dll_dirs()

import numpy as np
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from . import __version__
from .config import (
    MODEL_SIZE, DEVICE, COMPUTE_TYPE, TRANSLATOR, NLLB_MODEL,
    HOST, PORT, MOBILE_ACCESS_TOKEN, SAMPLE_RATE, VAD_FILTER,
    SENTENCE_MAX_CHARS, LLM_API_BASE, LLM_API_KEY, LLM_MODEL,
    WHISPER_CACHE, LOCAL_WHISPER_TURBO, NLLB_CT2_CACHE,
)
from .codex_bridge import CODEX_MODEL, CODEX_DEFAULT_EFFORT, CodexBridgeError, codex_status, run_codex_completion
from .kimi_bridge import KimiBridgeError, kimi_status, run_kimi_completion
from .nllb_glossary import protect_terms, restore_terms
from .translation import (
    hotwords_for_domain,
    protect,
    restore_checked,
    translate_codex_subscription,
    translate_kimi_subscription,
    translate_openai_compatible,
)

log = logging.getLogger("quant-scholar-translator")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

# ----- model load (lazy, once per process) ----------------------------------
_model = None
_resolved_device = None   # the device whisper actually loaded on ("cuda"/"cpu")

def get_model(offline: bool = False):
    global _model, _resolved_device
    if _model is not None:
        return _model
    from faster_whisper import WhisperModel
    model_source = (
        str(LOCAL_WHISPER_TURBO)
        if MODEL_SIZE == "large-v3-turbo" and (LOCAL_WHISPER_TURBO / "model.bin").exists()
        else MODEL_SIZE
    )

    # Build an attempt list. "cuda"/"auto" try the GPU first then fall back to
    # CPU so a missing CUDA lib (or a stale "cpu" setting that should've been
    # GPU) can't silently leave turbo crawling at 7s/chunk on the CPU. Explicit
    # "cpu" stays CPU. CRITICAL: large-v3-turbo on CPU is not real-time — the
    # warning below is the single most useful line when captions lag.
    cuda_compute = "float16" if COMPUTE_TYPE in ("int8", "") else COMPUTE_TYPE
    if DEVICE == "cpu":
        attempts = [("cpu", "int8")]
    else:  # "cuda" or "auto"
        attempts = [("cuda", cuda_compute), ("cpu", "int8")]

    last_err = None
    for dev, comp in attempts:
        try:
            log.info("loading whisper model=%s device=%s compute=%s", MODEL_SIZE, dev, comp)
            WHISPER_CACHE.mkdir(parents=True, exist_ok=True)
            _model = WhisperModel(
                model_source,
                device=dev,
                compute_type=comp,
                download_root=str(WHISPER_CACHE),
                local_files_only=offline,
            )
            _resolved_device = dev
            if dev == "cpu" and MODEL_SIZE.startswith("large"):
                log.warning("running %s on CPU — this is NOT real-time and "
                            "captions WILL lag. Use a GPU or a smaller model.",
                            MODEL_SIZE)
            log.info("whisper model ready on %s", dev)
            return _model
        except Exception as e:
            last_err = e
            log.warning("whisper load failed on %s (%s); trying next device", dev, e)
    raise RuntimeError(f"could not load whisper on any device: {last_err}")


# ----- hallucination filter -------------------------------------------------
#
# Whisper was trained on millions of fansub files that ended with translator
# credits. On uncertain audio (intro music, accents, silence the gate missed)
# it "completes" by generating those credits — most commonly:
#   "ترجمة موقع xxxx.com" / "ترجمة وتعديل ..." / "Subtitles by ..."
#   "Amara.org community" / "addic7ed.com" / "opensubtitles..."
#   "Thanks for watching" / "Please subscribe" / "شكرا للمشاهدة"
#
# Strategy: only drop the chunk if the ENTIRE transcript looks like a credit
# line. Don't filter on substring match — real video content might genuinely
# reference a website (e.g. a news clip saying "from cnn.com").

_HALLUCINATION_PATTERNS = [
    # Arabic subtitle credits — the dominant hallucination in the user's case.
    # ترجمة (sing), ترجمات (plural), ترجم (verb), ترجمها (he translated it) —
    # all valid lead-ins to a credit. \S* covers the suffix variants.
    re.compile(r"^\s*ترجم\S*\s+(?:موقع|من|بواسطة|وتعديل|تعديل|وعدل|عدل|"
               r"ورفع|وتوقيت|وتدقيق|وإنتاج|فيلم|الفيلم|الحلقة|للعربية)",
               re.IGNORECASE),
    re.compile(r"^\s*ترجم\S*\s+\S+\s*$", re.IGNORECASE),
    re.compile(r"^\s*شكر[ا]?\s+(?:للمشاهدة|على المشاهدة)\s*[!.\s]*$", re.IGNORECASE),
    # English subtitle credits
    re.compile(r"^\s*(?:subtitles?|captions?)\s+(?:by|provided\s+by|from)\b", re.IGNORECASE),
    re.compile(r"^\s*subtitled\s+by\b", re.IGNORECASE),
    re.compile(r"^\s*(?:transcript|translation)\s+by\b", re.IGNORECASE),
    re.compile(r"^\s*(?:thank\s+you|thanks)\s+for\s+watching[!.\s]*$", re.IGNORECASE),
    re.compile(r"^\s*(?:please\s+)?(?:like\s+and\s+)?subscribe\b", re.IGNORECASE),
    # Whole text is just a known subtitle-site domain
    re.compile(r"^\s*(?:www\.|https?://)?(?:amara\.org|addic7ed\.com|opensubtitles|subscene|"
               r"podnapisi|subdl|subtitleseeker|yifysubtitles)\b\S*\s*$", re.IGNORECASE),
    # Whole text is a single bare domain (e.g. "xxx.com")
    re.compile(r"^\s*(?:www\.|https?://)?[a-z0-9-]{2,}\.(?:com|net|org|tv|io|co|me)\b\S*\s*$",
               re.IGNORECASE),
    # Music tags whisper sometimes emits in transcribe mode
    re.compile(r"^\s*[\[\(]?\s*(?:music|applause|silence|♪+)\s*[\]\)]?\s*$", re.IGNORECASE),
]


def looks_like_hallucination(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    return any(p.search(t) for p in _HALLUCINATION_PATTERNS)


# ----- translation ----------------------------------------------------------
#
# Two backends, selected via KAMI_TRANSLATOR:
#   "google" — deep-translator hits translate.google over the network. Zero
#              setup, decent, but adds a round-trip per sentence and throttles.
#   "nllb"   — Meta NLLB-200 runs locally on the same device as whisper. No
#              network hop (lower, more consistent latency), no rate limit, and
#              stronger Arabic. Heavier first-time setup; falls back to google
#              automatically if its deps/model aren't available.

# ISO-639-1 (what the extension/whisper speak) -> NLLB FLORES-200 codes.
_NLLB_LANG = {
    "ar": "arb_Arab", "en": "eng_Latn", "es": "spa_Latn", "fr": "fra_Latn",
    "de": "deu_Latn", "tr": "tur_Latn", "it": "ita_Latn", "pt": "por_Latn",
    "ru": "rus_Cyrl", "ja": "jpn_Jpan", "ko": "kor_Hang", "zh": "zho_Hans",
    "hi": "hin_Deva", "fa": "pes_Arab", "ur": "urd_Arab", "nl": "nld_Latn",
}

_nllb = None              # (translator, tokenizer) once loaded
_nllb_failed = False      # set True after a load failure so we stop retrying
_nllb_lock = threading.Lock()
_nllb_glossary_disabled = threading.Event()


def _get_nllb(*, allow_download: bool = True):
    """Lazily load NLLB on CTranslate2 (reuses the ct2 already pulled in by
    faster-whisper — no torch at inference time). Returns (translator, tokenizer)
    or None if unavailable, in which case callers fall back to google."""
    global _nllb, _nllb_failed
    if _nllb is not None or _nllb_failed:
        return _nllb
    if not allow_download and not all(
        (NLLB_CT2_CACHE / name).is_file()
        for name in ("model.bin", "tokenizer_config.json", "tokenizer.json")
    ):
        return None
    try:
        from pathlib import Path
        import ctranslate2
        from transformers import AutoTokenizer

        # ct2 needs a converted model dir. Convert once into a cache folder next
        # to this file; subsequent runs load the converted copy directly.
        cache_dir = NLLB_CT2_CACHE
        if not (cache_dir / "model.bin").exists():
            log.info("converting %s to CTranslate2 (one-time, ~2.5GB)...", NLLB_MODEL)
            from ctranslate2.converters import TransformersConverter
            TransformersConverter(NLLB_MODEL).convert(str(cache_dir), quantization="int8")
            AutoTokenizer.from_pretrained(NLLB_MODEL).save_pretrained(cache_dir)

        # Match whatever device whisper actually resolved to; fall back to CPU
        # if the GPU translator can't init (CPU NLLB is fine — it's tiny).
        want_dev = _resolved_device or ("cpu" if DEVICE == "cpu" else "cuda")
        try:
            translator = ctranslate2.Translator(str(cache_dir), device=want_dev)
        except Exception as e:
            log.warning("NLLB on %s failed (%s); using CPU", want_dev, e)
            translator = ctranslate2.Translator(str(cache_dir), device="cpu")
            want_dev = "cpu"
        tokenizer_source = cache_dir if (cache_dir / "tokenizer_config.json").exists() else NLLB_MODEL
        # Keep NLLB's own tokenizer behavior. The generic Transformers
        # `fix_mistral_regex` migration is for Mistral tokenizers and causes
        # degenerate repeated output when forced onto this NLLB checkpoint.
        tokenizer = AutoTokenizer.from_pretrained(tokenizer_source, local_files_only=not allow_download)
        _nllb = (translator, tokenizer)
        log.info("NLLB translator ready (device=%s)", want_dev)
    except Exception as e:
        log.warning("NLLB unavailable (%s) — falling back to google. "
                    "Install with: pip install transformers torch sentencepiece", e)
        _nllb_failed = True
        _nllb = None
    return _nllb


def _translate_nllb(text: str, src: str, tgt: str, *, allow_network_fallback: bool = True) -> str:
    # The tokenizer's src_lang is mutable. Serialize shared local inference so
    # simultaneous mobile/desktop requests cannot mix language state or loads.
    with _nllb_lock:
        return _translate_nllb_impl(text, src, tgt, allow_network_fallback=allow_network_fallback)


def _translate_nllb_impl(text: str, src: str, tgt: str, *, allow_network_fallback: bool = True) -> str:
    bundle = _get_nllb(allow_download=allow_network_fallback)
    if bundle is None:
        if allow_network_fallback:
            return _translate_google(text, src, tgt)
        raise RuntimeError("NLLB local model is unavailable; offline mode will not use a network fallback")
    translator, tokenizer = bundle
    src_code = _NLLB_LANG.get(src)
    tgt_code = _NLLB_LANG.get(tgt)
    if tgt_code is None:
        if allow_network_fallback:
            log.warning("NLLB has no FLORES code for target %r — using google", tgt)
            return _translate_google(text, src, tgt)
        raise ValueError(f"NLLB does not support target language {tgt!r}; offline mode will not use a network fallback")
    # NLLB needs a source language tag. If detection gave us something we don't
    # map (or "auto"), let the tokenizer default and rely on the target tag.
    # NLLB itself does not detect the source language. Whisper/native caption
    # paths normally provide one; deterministic English is the safest fallback
    # for the project's academic corpus when a manual client sends "auto".
    tokenizer.src_lang = src_code or "eng_Latn"
    tokens = tokenizer.convert_ids_to_tokens(tokenizer.encode(text))
    results = translator.translate_batch(
        [tokens], target_prefix=[[tgt_code]], beam_size=1, max_decoding_length=256,
    )
    out_tokens = results[0].hypotheses[0]
    if out_tokens and out_tokens[0] == tgt_code:
        out_tokens = out_tokens[1:]   # strip the target-lang tag we prefixed
    return tokenizer.decode(tokenizer.convert_tokens_to_ids(out_tokens),
                            skip_special_tokens=True)


def _translate_google(text: str, src: str, tgt: str) -> str:
    from deep_translator import GoogleTranslator
    src_arg = "auto" if src in (None, "", "auto") else src
    return GoogleTranslator(source=src_arg, target=tgt).translate(text)


def translate(
    text: str,
    src: str,
    tgt: str,
    domain: str = "auto",
    provider: str | None = None,
    context: str = "",
    strict: bool = False,
    offline: bool = False,
) -> str:
    selected = (provider or TRANSLATOR).strip().lower()
    if not text.strip() or src == tgt or selected == "none":
        return text
    try:
        if selected == "nllb":
            protected = protect(text)
            use_terms = os.getenv('QS_NLLB_GLOSSARY', 'on').lower() not in {'0', 'off', 'false'} and not _nllb_glossary_disabled.is_set()
            enriched = protect_terms(protected, src or '', tgt or '') if use_terms else protected
            output = _translate_nllb(
                enriched.text, src, tgt, allow_network_fallback=not offline
            )
            if enriched is not protected:
                try:
                    return restore_terms(output, enriched, len(protected.values))
                except ValueError:
                    # One plain retry; then bypass terminology for this process
                    # so a model that corrupts markers cannot double every call.
                    _nllb_glossary_disabled.set()
                    log.warning('NLLB terminology markers were not preserved; using plain previews until service restart')
                    output = _translate_nllb(protected.text, src, tgt, allow_network_fallback=not offline)
            return restore_checked(output, protected.values)
        if selected == "google":
            protected = protect(text)
            return restore_checked(
                _translate_google(protected.text, src, tgt), protected.values
            )
        if selected == "llm":
            if not LLM_API_KEY:
                raise RuntimeError("QS_LLM_API_KEY is required for professional LLM translation")
            return translate_openai_compatible(
                text, src, tgt, domain,
                api_base=LLM_API_BASE, api_key=LLM_API_KEY, model=LLM_MODEL, context=context,
            )
        if selected == "codex":
            return translate_codex_subscription(text, src, tgt, domain, context=context)
        if selected == "kimi_subscription":
            return translate_kimi_subscription(text, src, tgt, domain, context=context)
        raise ValueError(f"unsupported translation provider: {selected}")
    except Exception as e:
        log.warning("translation failed (%s -> %s): %s", src, tgt, e)
        if strict:
            raise
    return text


def normalize_translation_mode(value: str | None) -> str:
    return value if value in {"professional", "quick", "offline"} else "professional"


def professional_provider(value: str | None) -> str:
    return value if value in {"codex", "kimi_subscription", "llm"} else "kimi_subscription"


# ----- session --------------------------------------------------------------
@dataclass
class Session:
    sample_rate: int = SAMPLE_RATE
    source_lang: str = "auto"
    target_lang: str = "ar"
    task: str = "transcribe"
    chunk_id: int = 0
    # Live-caption display model: one line at a time, like normal subtitles.
    # `pending` is the sentence currently being spoken (source text). It's
    # re-translated and shown in full every chunk so the line grows readably;
    # when the sentence finishes we clear it and the next sentence *replaces*
    # the old line on screen (the overlay keeps the last line visible in the
    # gap until then). No stacking of multiple sentences.
    pending: str = ""
    last_detected: str = "auto"
    domain: str = "auto"
    translator: str = TRANSLATOR
    translation_mode: str = "professional"
    source_context: list[str] = field(default_factory=list)
    translation_queue: asyncio.Queue | None = None


# Sentence-final marks across the languages we caption — Latin, Arabic (؟ ،),
# and CJK fullwidth (。！？). A trailing one of these means "translate now".
_SENTENCE_END = ".!?…。！？؟،;:"


def ends_sentence(text: str) -> bool:
    return text.rstrip().endswith(tuple(_SENTENCE_END))


def transcribe_chunk(session: Session, pcm_int16: np.ndarray) -> tuple[str, str]:
    """Returns (raw_text, detected_lang)."""
    if pcm_int16.size == 0:
        return "", session.source_lang or "auto"
    audio = pcm_int16.astype(np.float32) / 32768.0
    model = get_model(offline=session.translation_mode == "offline")
    lang = None if session.source_lang in (None, "", "auto") else session.source_lang
    segments, info = model.transcribe(
        audio,
        language=lang,
        task=session.task if session.task in ("transcribe", "translate") else "transcribe",
        vad_filter=VAD_FILTER,
        beam_size=1,                   # fast; bump to 5 for quality
        hotwords=hotwords_for_domain(session.domain),
        # initial_prompt is intentionally OMITTED. It primes whisper with the
        # rolling transcript history, which is the #1 cause of fansub-credit
        # hallucinations in live captioning — past credit-shaped fragments
        # in the prompt produce more credit-shaped output. Cross-chunk name
        # consistency loss is worth the trade.
        condition_on_previous_text=False,
        no_speech_threshold=0.6,
        # When whisper is uncertain it tends to fabricate fansub credits.
        # Tight thresholds force a bail-out:
        #   - compression_ratio > 2.4 → output is repetitive/garbage → drop
        #   - avg_logprob < -1.0     → low confidence → drop
        compression_ratio_threshold=2.4,
        log_prob_threshold=-1.0,
    )
    parts = [seg.text for seg in segments]
    text = "".join(parts).strip()
    return text, (info.language if info and info.language else (lang or "auto"))


async def _render_source(
    session: Session,
    loop,
    source: str,
    provider: str,
    *,
    detected: str | None = None,
    offline: bool = False,
) -> str:
    """Translate source from the authoritative transcript, never from a preview."""
    if not source:
        return ""
    src = (detected or session.last_detected) if session.source_lang == "auto" else session.source_lang
    if session.task == "translate" and session.target_lang == "en":
        return source   # whisper already produced English
    context = " ".join(session.source_context[-4:])[-1600:]
    return await loop.run_in_executor(
        None,
        translate,
        source,
        src,
        session.target_lang,
        session.domain,
        provider,
        context,
        True,
        offline,
    )


async def _send_line(
    ws: WebSocket,
    session: Session,
    partial: str,
    is_final: bool,
    *,
    raw: str | None = None,
    stage: str = "final",
    provider: str | None = None,
    detected: str | None = None,
    chunk_id: int | None = None,
) -> None:
    """Push the single visible line (the current sentence, translated)."""
    await ws.send_text(json.dumps({
        "type": "transcript",
        "text": partial, "raw": session.pending if raw is None else raw,
        "detectedLang": detected or session.last_detected,
        "chunkId": session.chunk_id if chunk_id is None else chunk_id, "isFinal": is_final,
        "stage": stage,
        "provider": provider or session.translator,
    }, ensure_ascii=False))


async def _professional_translation_worker(ws: WebSocket, session: Session, loop) -> None:
    """Translate finalized sentences sequentially while audio capture continues."""
    assert session.translation_queue is not None
    while True:
        item = await session.translation_queue.get()
        if item is None:
            session.translation_queue.task_done()
            return
        source, detected, chunk_id = item
        provider = professional_provider(session.translator)
        try:
            for attempt in range(3):
                try:
                    translated = await _render_source(session, loop, source, provider, detected=detected)
                    if not translated.strip():
                        raise RuntimeError('empty translation')
                    break
                except Exception:
                    if attempt == 2:
                        raise
                    await asyncio.sleep(attempt + 1)
            await _send_line(
                ws, session, translated, True,
                raw=source, stage="professional-final", provider=provider,
                detected=detected, chunk_id=chunk_id,
            )
            session.source_context.append(source)
            session.source_context = session.source_context[-8:]
        except Exception as error:
            log.warning("professional translation failed for chunk #%s: %s", chunk_id, error)
            try:
                await ws.send_text(json.dumps({
                    "type": "error",
                    "message": f"professional translation failed: {error}",
                }, ensure_ascii=False))
            except Exception:
                return
        finally:
            session.translation_queue.task_done()


async def commit_pending(ws: WebSocket, session: Session, loop) -> None:
    """Finalize a source sentence without ever feeding NLLB text to the professional model."""
    if not session.pending:
        return
    source = session.pending
    detected = session.last_detected
    chunk_id = session.chunk_id
    # Save the complete source before any model call. Failed translations
    # remain visible and recoverable instead of disappearing from the record.
    await _send_line(ws, session, "", False, raw=source, stage="source-final", chunk_id=chunk_id)
    session.pending = ""
    if session.translation_mode == "offline":
        translated = await _render_source(session, loop, source, "nllb", offline=True)
        await _send_line(ws, session, translated, True, raw=source, stage="offline-final", provider="nllb")
        return
    assert session.translation_queue is not None
    await session.translation_queue.put((source, detected, chunk_id))


async def _handle_chunk(
    ws: WebSocket, session: Session, loop, raw_bytes: bytes, arrived_at: float
) -> None:
    """One audio chunk: silence-gate -> transcribe -> buffer -> flush sentence."""
    session.chunk_id += 1
    cid = session.chunk_id

    # Completeness takes priority over latency: never discard queued audio
    # merely because recognition is slower than playback.

    pcm = np.frombuffer(raw_bytes, dtype=np.int16)

    if pcm.size:
        rms = float(np.sqrt(np.mean((pcm.astype(np.float32) / 32768.0) ** 2)))
        peak = float(np.max(np.abs(pcm)) / 32768.0)
    else:
        rms = peak = 0.0

    # Silence gate. Whisper hallucinates on silent audio by repeating the
    # initial_prompt context — exactly what causes "the last word spams
    # when the video pauses." Skip transcribe for sub-threshold chunks and
    # send empty text so the overlay clears.
    SILENCE_RMS = 0.0001  # Only near-digital silence; quiet speech goes to ASR/VAD.
    if rms < SILENCE_RMS:
        log.info("chunk #%d: silence skip (rms=%.4f peak=%.3f)", cid, rms, peak)
        # A pause ends the current utterance: finalize whatever's building so it
        # shows in full, then the overlay clears itself after CLEAR_AFTER_MS of
        # no further updates (content.js).
        await commit_pending(ws, session, loop)
        return

    raw, detected = await loop.run_in_executor(None, transcribe_chunk, session, pcm)
    if not raw:
        log.info("chunk #%d: empty transcript (lang=%s) rms=%.4f peak=%.3f",
                 cid, detected, rms, peak)
        return

    # Drop whole-chunk fansub-credit hallucinations BEFORE buffering them.
    # If they entered the buffer they'd corrupt the translated sentence and
    # (via concatenation) the surrounding real words too.
    if looks_like_hallucination(raw) and rms < 0.001:
        # Skip the hallucinated fragment; keep the current line on screen.
        log.info("chunk #%d: hallucination filter dropped raw=%r", cid, raw)
        return

    # Append source chunks into a complete thought. Professional mode displays
    # source immediately and defers model translation until commit; quick mode
    # may show a local NLLB preview, but that preview is never passed downstream.
    session.last_detected = detected
    # PCM chunks are disjoint, not rolling ASR revisions. Deduplicating them
    # erases genuine repeated words and repeated examples from lectures.
    session.pending = f"{session.pending} {raw}".strip()

    if session.translation_mode == "professional":
        await _send_line(ws, session, "", False, stage="source", provider=professional_provider(session.translator))
    else:
        try:
            preview = await _render_source(session, loop, session.pending, "nllb", offline=True)
        except Exception:
            preview = ""
        stage = "offline-preview" if session.translation_mode == "offline" else "quick-preview"
        await _send_line(ws, session, preview, False, stage=stage, provider="nllb")
    log.info("chunk #%d: pending=%r mode=%s", cid, session.pending, session.translation_mode)

    # When the sentence completes (punctuation) or grows long, clear the buffer
    # so the next sentence starts a fresh line and replaces this one on screen.
    if ends_sentence(session.pending) or len(session.pending) >= SENTENCE_MAX_CHARS:
        await commit_pending(ws, session, loop)


# ----- websocket loop -------------------------------------------------------
async def handle_socket(ws: WebSocket):
    client_host = ws.client.host if ws.client else ""
    if not _loopback_client(client_host) and not _mobile_token_valid(ws.query_params.get("token")):
        await ws.close(code=1008, reason="LAN access requires a valid mobile token")
        return
    await ws.accept()
    session = Session()
    session.translation_queue = asyncio.Queue()
    translation_worker: asyncio.Task | None = None
    log.info("client connected")

    try:
        # First message must be config (text JSON).
        first = await ws.receive()
        if "text" in first and first["text"]:
            try:
                cfg = json.loads(first["text"])
                if cfg.get("type") == "config":
                    session.sample_rate = int(cfg.get("sampleRate", SAMPLE_RATE))
                    session.source_lang = cfg.get("sourceLang", "auto") or "auto"
                    session.target_lang = cfg.get("targetLang", "ar") or "ar"
                    session.task = cfg.get("task", "transcribe") or "transcribe"
                    session.domain = cfg.get("domain", "auto") or "auto"
                    session.translator = cfg.get("translator", TRANSLATOR) or TRANSLATOR
                    session.translation_mode = normalize_translation_mode(cfg.get("translationMode"))
                    log.info("config: rate=%s src=%s tgt=%s task=%s translator=%s mode=%s",
                             session.sample_rate, session.source_lang,
                             session.target_lang, session.task, session.translator,
                             session.translation_mode)
            except json.JSONDecodeError:
                pass

        # Main loop: receive binary PCM chunks, transcribe, translate, push back.
        loop = asyncio.get_running_loop()
        translation_worker = asyncio.create_task(_professional_translation_worker(ws, session, loop))
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break

            if "bytes" in msg and msg["bytes"]:
                # Stamp arrival time NOW so the chunk handler can detect
                # backlog. If we stamped inside _handle_chunk, the time would
                # already include the previous chunk's processing wait.
                arrived_at = time.monotonic()
                # Process each chunk in its own try block — a single bad
                # chunk (translator throw, whisper edge case, etc) used to
                # kill the entire WS session. Now we just log and continue.
                try:
                    await _handle_chunk(ws, session, loop, msg["bytes"], arrived_at)
                except Exception as e:
                    log.exception("chunk handler error: %s", e)
                    try:
                        await ws.send_text(json.dumps({
                            "type": "error",
                            "message": f"chunk processing failed: {e}",
                        }))
                    except Exception:
                        pass
                    # Don't break — let the session keep running for the next chunk.

            elif "text" in msg and msg["text"]:
                # Allow runtime reconfig.
                try:
                    cfg = json.loads(msg["text"])
                    if cfg.get("type") == "flush":
                        await commit_pending(ws, session, loop)
                        await session.translation_queue.join()
                        await ws.send_text(json.dumps({"type": "flushed"}))
                        continue
                    if cfg.get("type") == "config":
                        session.source_lang = cfg.get("sourceLang", session.source_lang)
                        session.target_lang = cfg.get("targetLang", session.target_lang)
                        session.task = cfg.get("task", session.task)
                        session.domain = cfg.get("domain", session.domain)
                        session.translator = cfg.get("translator", session.translator)
                        session.translation_mode = normalize_translation_mode(
                            cfg.get("translationMode", session.translation_mode)
                        )
                except json.JSONDecodeError:
                    pass

    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.exception("session error: %s", e)
        try:
            await ws.send_text(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass
    finally:
        if session.translation_queue is not None:
            await session.translation_queue.put(None)
        if translation_worker is not None:
            translation_worker.cancel()
        log.info("client disconnected")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Whisper stays lazy: native web captions only need the translation route,
    # so they should not pay the model download/load cost. The first audio-ASR
    # session initializes Whisper on demand in transcribe_chunk().
    yield


app = FastAPI(
    title="Quant Scholar Translator",
    version=__version__,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-QS-Token"],
)


def _loopback_client(host: str | None) -> bool:
    return (host or "").strip().lower() in {"127.0.0.1", "::1", "localhost", "testclient"}


def _mobile_token_valid(value: str | None) -> bool:
    return bool(MOBILE_ACCESS_TOKEN and value and secrets.compare_digest(MOBILE_ACCESS_TOKEN, value))


@app.middleware("http")
async def protect_nonlocal_requests(request, call_next):
    client_host = request.client.host if request.client else ""
    if (
        not _loopback_client(client_host)
        and not request.url.path.startswith("/mobile")
        and not _mobile_token_valid(request.headers.get("X-QS-Token"))
    ):
        return JSONResponse(
            status_code=403,
            content={"detail": "LAN access requires QS_MOBILE_TOKEN and the matching X-QS-Token header."},
        )
    return await call_next(request)


MOBILE_ROOT = Path(__file__).resolve().parent / "mobile"
if MOBILE_ROOT.is_dir():
    app.mount("/mobile", StaticFiles(directory=MOBILE_ROOT, html=True), name="mobile")


class TranslationRequest(BaseModel):
    text: str = Field(min_length=1, max_length=12000)
    sourceLang: str = "auto"
    targetLang: str = "zh"
    domain: str = "auto"
    translator: str | None = None
    context: str = Field(default="", max_length=4000)
    offline: bool = False


class LocalChatMessage(BaseModel):
    role: str = "user"
    content: str = Field(min_length=1, max_length=120000)


class CaptionItem(BaseModel):
    id: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=12000)


class CaptionTranslationRequest(BaseModel):
    cues: list[CaptionItem] = Field(min_length=1, max_length=24)
    sourceLang: str = "auto"
    targetLang: str = "zh"
    domain: str = "auto"
    translator: str = "kimi_subscription"
    context: str = Field(default="", max_length=4000)


class CaptionJobRequest(CaptionTranslationRequest):
    requestId: str = Field(min_length=1, max_length=200)

    @field_validator('translator')
    @classmethod
    def normalize_legacy_codex(cls, value):
        # Already persisted browser jobs may still use the realtime API ID.
        # Normalize before validation/dispatch AND idempotency fingerprinting:
        # either spelling must query the same job, never launch another model.
        return 'codex_subscription' if value == 'codex' else value


@app.exception_handler(RequestValidationError)
async def caption_request_validation_error(request, error):
    if request.url.path != '/translate/cues/jobs':
        return await request_validation_exception_handler(request, error)
    # Do not log Pydantic's `input`: it contains the user's lecture text.
    issues = [{'field': '.'.join(str(part) for part in item['loc']), 'type': item['type']}
              for item in error.errors()]
    log.warning('Caption request rejected: %s', json.dumps(issues, ensure_ascii=True))
    return JSONResponse(status_code=422, content={'detail': '字幕请求参数不合法', 'issues': issues})


def _run_caption_job(payload):
    from .caption_translation import translate_cues
    if payload.get('offline'):
        cue = payload['cues'][0]
        return [{'id': cue['id'], 'text': translate(cue['text'], payload['sourceLang'], payload['targetLang'],
                 payload['domain'], 'nllb', payload['context'], True, True)}]
    return translate_cues(payload['cues'], payload['sourceLang'], payload['targetLang'],
                          payload['domain'], payload['translator'], payload['context'])


from .caption_jobs import CaptionJobs
caption_jobs = CaptionJobs(_run_caption_job)

from .video_library import VideoLibrary
video_library = VideoLibrary()


def require_local_library(request):
    from urllib.parse import urlsplit
    origin = urlsplit(request.headers.get('origin', ''))
    if (not _loopback_client(request.client.host if request.client else '')
            or (origin.scheme and origin.scheme != 'chrome-extension' and origin.hostname not in ('localhost', '127.0.0.1', '::1'))):
        raise HTTPException(403, '视频文档仅供本机扩展使用')


@app.post('/library/videos/save')
async def save_video_document(request: Request):
    require_local_library(request)
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 24 * 1024 * 1024:
            raise HTTPException(413, '视频文档超过大小上限')
    try:
        session = json.loads(raw)
        if not isinstance(session, dict):
            raise ValueError('视频文档格式无效')
        result = await asyncio.to_thread(video_library.save, session)
        return {'ok': True, **result}
    except (ValueError, TypeError, AttributeError, KeyError):
        raise HTTPException(422, '视频文档参数无效或原字幕已改变，未覆盖已有记录')


class VideoLookupRequest(BaseModel):
    url: str = Field(max_length=4000)
    identity: str = Field(max_length=3000)
    signature: str = Field(max_length=2000)
    duration: float = Field(gt=0, allow_inf_nan=False)


@app.post('/library/videos/lookup')
async def lookup_video_document(body: VideoLookupRequest, request: Request):
    require_local_library(request)
    try:
        record = await asyncio.to_thread(video_library.lookup, body.url, body.identity, body.signature, body.duration)
        return {'ok': True, 'session': record}
    except (ValueError, TypeError, AttributeError, KeyError):
        raise HTTPException(422, '视频存档匹配信息无效')


@app.post('/translate/cues/jobs')
async def caption_job_endpoint(body: CaptionJobRequest, request: Request):
    from urllib.parse import urlparse
    origin = urlparse(request.headers.get('origin', ''))
    if origin.scheme and origin.scheme != 'chrome-extension' and origin.hostname not in ('localhost', '127.0.0.1', '::1'):
        raise HTTPException(403, '提前翻译任务仅供本机扩展或本机工具调用')
    reason = ('caption_text_limit' if sum(len(c.text) for c in body.cues) > 12000 else
              'duplicate_caption_id' if len({c.id for c in body.cues}) != len(body.cues) else
              'unsupported_provider' if body.translator not in {'codex_subscription', 'kimi_subscription', 'nllb'} else
              'offline_batch_limit' if body.translator == 'nllb' and len(body.cues) != 1 else '')
    if reason:
        provider = body.translator if body.translator in {'codex', 'codex_subscription', 'kimi_subscription', 'nllb', 'llm'} else 'unknown'
        log.warning('Caption request rejected: rule=%s provider=%s count=%d', reason, provider, len(body.cues))
        raise HTTPException(422, {'code': reason, 'message': '字幕批次、编号或翻译引擎无效'})
    payload = body.model_dump(exclude={'requestId'})
    payload['offline'] = body.translator == 'nllb'
    try:
        return caption_jobs.submit(body.requestId, payload)
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    except OverflowError as error:
        raise HTTPException(429, str(error)) from error


class LocalChatRequest(BaseModel):
    model: str = "codex-subscription"
    messages: list[LocalChatMessage] = Field(min_length=1, max_length=40)
    max_tokens: int | None = None
    temperature: float | None = None


@app.get("/")
async def root():
    return {
        "ok": True,
        "version": __version__,
        "model": MODEL_SIZE,
        "device": DEVICE,
        "compute": COMPUTE_TYPE,
        "translator": TRANSLATOR,
        "ws": f"ws://{HOST}:{PORT}/ws",
    }


@app.post("/translate")
async def translate_endpoint(request: TranslationRequest):
    """Translate native web captions through the same professional pipeline."""
    loop = asyncio.get_running_loop()
    output = await loop.run_in_executor(
        None,
        translate,
        request.text,
        request.sourceLang,
        request.targetLang,
        request.domain,
        request.translator,
        request.context,
        True,
        request.offline,
    )
    return {"ok": True, "text": output, "raw": request.text}


@app.get("/codex/status")
async def codex_status_endpoint():
    loop = asyncio.get_running_loop()
    status = await loop.run_in_executor(None, codex_status)
    return {"ok": status.subscription, **status.to_dict()}


@app.post("/translate/cues")
async def translate_cues_endpoint(request: CaptionTranslationRequest):
    from .caption_translation import translate_cues
    if (sum(len(cue.text) for cue in request.cues) > 12000
            or len({cue.id for cue in request.cues}) != len(request.cues)
            or request.translator not in {"codex_subscription", "kimi_subscription"}):
        return JSONResponse(status_code=422, content={"detail": "字幕批次、编号或专业翻译引擎无效"})
    try:
        rows = await asyncio.to_thread(
            translate_cues, [cue.model_dump() for cue in request.cues],
            request.sourceLang, request.targetLang, request.domain, request.translator, request.context,
        )
    except ValueError as error:
        return JSONResponse(status_code=502, content={"detail": str(error)})
    except Exception:
        log.exception("caption translation failed")
        return JSONResponse(status_code=502, content={"detail": "专业字幕翻译失败，请检查套餐登录和本地服务"})
    return {"ok": True, "cues": rows}


@app.post("/codex/v1/chat/completions")
async def codex_chat_completions(request: LocalChatRequest):
    """Small OpenAI-compatible surface for the extension's local Codex mode."""
    loop = asyncio.get_running_loop()
    try:
        output = await loop.run_in_executor(
            None,
            run_codex_completion,
            [message.model_dump() for message in request.messages],
        )
    except CodexBridgeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return {
        "id": f"codex-local-{int(time.time() * 1000)}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": CODEX_MODEL,
        "reasoning_effort": CODEX_DEFAULT_EFFORT,
        "billing_mode": "chatgpt-subscription",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": output}, "finish_reason": "stop"}],
    }


@app.get("/kimi/status")
async def kimi_status_endpoint():
    loop = asyncio.get_running_loop()
    status = await loop.run_in_executor(None, kimi_status)
    return {"ok": status.subscription, **status.to_dict()}


@app.post("/kimi/v1/chat/completions")
async def kimi_chat_completions(request: LocalChatRequest):
    """OpenAI-compatible local surface backed by the user's Kimi membership."""
    loop = asyncio.get_running_loop()
    try:
        output = await loop.run_in_executor(
            None,
            run_kimi_completion,
            [message.model_dump() for message in request.messages],
        )
    except KimiBridgeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return {
        "id": f"kimi-local-{int(time.time() * 1000)}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": request.model,
        "billing_mode": "kimi-subscription",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": output}, "finish_reason": "stop"}],
    }


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await handle_socket(ws)


from .media_jobs import create_media_router
app.include_router(create_media_router(get_model, hotwords_for_domain))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("quant_scholar_translator.realtime:app", host=HOST, port=PORT, log_level="info")
