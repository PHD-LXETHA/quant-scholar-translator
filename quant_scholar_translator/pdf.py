"""Audited adapter for the BabelDOC engine vendored in Quant Scholar.

An explicit command template is still supported for experimentation, but the
default always invokes this repository's own bundled engine entry point.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(os.getenv("QS_PROJECT_ROOT", Path(__file__).resolve().parents[1])).resolve()


@dataclass
class PdfJob:
    schemaVersion: int
    id: str
    sourcePdf: str
    outputDirectory: str
    sourceLanguage: str
    targetLanguage: str
    status: str
    createdAt: str
    engineCommand: list[str]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def command_from_template(template_json: str, *, input_pdf: Path, output_dir: Path,
                          source_lang: str, target_lang: str) -> list[str]:
    raw = json.loads(template_json)
    if not isinstance(raw, list) or not raw or not all(isinstance(value, str) for value in raw):
        raise ValueError("PDF engine command must be a non-empty JSON string array")
    values = {
        "input": str(input_pdf),
        "output_dir": str(output_dir),
        "source_lang": source_lang,
        "target_lang": target_lang,
    }
    return [part.format_map(values) for part in raw]


def redact_command(command: list[str]) -> list[str]:
    redacted = list(command)
    secret_flags = {"--api-key", "--openai-api-key", "--token", "--password"}
    for index, value in enumerate(redacted[:-1]):
        if value.lower() in secret_flags:
            redacted[index + 1] = "***"
    return redacted


def run_job(input_pdf: Path, output_dir: Path, source_lang: str, target_lang: str,
            template_json: str, dry_run: bool = False) -> PdfJob:
    input_pdf = input_pdf.resolve(strict=True)
    if input_pdf.suffix.lower() != ".pdf":
        raise ValueError("Input must be a PDF file")
    output_dir = output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    command = command_from_template(
        template_json,
        input_pdf=input_pdf,
        output_dir=output_dir,
        source_lang=source_lang,
        target_lang=target_lang,
    )
    job = PdfJob(
        schemaVersion=1,
        id=f"pdf-{int(datetime.now().timestamp() * 1000)}",
        sourcePdf=str(input_pdf),
        outputDirectory=str(output_dir),
        sourceLanguage=source_lang,
        targetLanguage=target_lang,
        status="planned" if dry_run else "running",
        createdAt=utc_now(),
        engineCommand=redact_command(command),
    )
    manifest = output_dir / f"{job.id}.json"
    manifest.write_text(json.dumps(asdict(job), ensure_ascii=False, indent=2), encoding="utf-8")
    if not dry_run:
        try:
            child_env = os.environ.copy()
            child_env.setdefault("QS_BABELDOC_CACHE", str(PROJECT_ROOT / ".models" / "babeldoc"))
            subprocess.run(command, cwd=output_dir, env=child_env, check=True)
            job.status = "completed"
        except Exception:
            job.status = "failed"
            raise
        finally:
            manifest.write_text(json.dumps(asdict(job), ensure_ascii=False, indent=2), encoding="utf-8")
    return job


def bundled_command_template() -> str:
    """Use the installed PDF provider without retaining its source repository."""
    command = [
        sys.executable,
        "-m", "babeldoc.main",
        "--files", "{input}",
        "--output", "{output_dir}",
        "--lang-in", "{source_lang}",
        "--lang-out", "{target_lang}",
    ]
    return json.dumps(command, ensure_ascii=False)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run an isolated professional PDF translation engine")
    parser.add_argument("input", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--source-lang", default="en")
    parser.add_argument("--target-lang", default="zh")
    parser.add_argument(
        "--command-json",
        default=os.getenv("QS_PDF_COMMAND_JSON", "") or bundled_command_template(),
        help="Optional JSON argv template; defaults to the installed PDF provider",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    job = run_job(args.input, args.output_dir, args.source_lang, args.target_lang,
                  args.command_json, args.dry_run)
    print(json.dumps(asdict(job), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
