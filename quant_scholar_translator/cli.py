"""One command entry point for text, live video, and PDF translation."""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path


def _serve() -> int:
    import uvicorn

    from .config import HOST, PORT

    uvicorn.run("quant_scholar_translator.realtime:app", host=HOST, port=PORT, log_level="info")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="quant-scholar", description="Quant Scholar unified translation library")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("serve", help="start the live-caption and translation service")

    text_parser = sub.add_parser("translate", help="translate a text fragment")
    text_parser.add_argument("text")
    text_parser.add_argument("--source", default="auto")
    text_parser.add_argument("--target", default="zh")
    text_parser.add_argument("--domain", default="auto")

    pdf_parser = sub.add_parser("pdf", help="translate a PDF through the installed PDF provider")
    pdf_parser.add_argument("input", type=Path)
    pdf_parser.add_argument("--output-dir", type=Path, required=True)
    pdf_parser.add_argument("--source", default="en")
    pdf_parser.add_argument("--target", default="zh")
    pdf_parser.add_argument("--dry-run", action="store_true")

    args = parser.parse_args(argv)
    if args.command == "serve":
        return _serve()
    if args.command == "translate":
        from . import translate_text

        print(translate_text(args.text, args.source, args.target, args.domain))
        return 0
    if args.command == "pdf":
        from .pdf import bundled_command_template, run_job

        job = run_job(
            args.input,
            args.output_dir,
            args.source,
            args.target,
            bundled_command_template(),
            args.dry_run,
        )
        print(json.dumps(asdict(job), ensure_ascii=False, indent=2))
        return 0
    parser.error("unknown command")
    return 2


if __name__ == "__main__":
    sys.exit(main())
