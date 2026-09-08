"""One command entry point for text and live-video translation."""
from __future__ import annotations

import argparse
import sys


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

    args = parser.parse_args(argv)
    if args.command == "serve":
        return _serve()
    if args.command == "translate":
        from . import translate_text

        print(translate_text(args.text, args.source, args.target, args.domain))
        return 0
    parser.error("unknown command")
    return 2


if __name__ == "__main__":
    sys.exit(main())
