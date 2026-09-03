"""Incremental ASR hypothesis stabilization.

This is a compact, dependency-free adaptation of the confirmed-prefix and
boundary de-duplication ideas used by WhisperLiveKit's online ASR processor.
"""
from __future__ import annotations

import re


TOKEN_RE = re.compile(r"\S+")


def _tokens(text: str) -> list[str]:
    return TOKEN_RE.findall(str(text or "").strip())


def merge_incremental_text(committed: str, fragment: str, max_overlap: int = 12) -> str:
    """Append a chunk while removing a repeated suffix/prefix boundary."""
    left = _tokens(committed)
    right = _tokens(fragment)
    if not left:
        return " ".join(right)
    if not right:
        return " ".join(left)
    overlap = 0
    for size in range(min(len(left), len(right), max_overlap), 0, -1):
        if [word.casefold() for word in left[-size:]] == [word.casefold() for word in right[:size]]:
            overlap = size
            break
    return " ".join([*left, *right[overlap:]])


class ConfirmedPrefixBuffer:
    """Commit only the longest word prefix repeated by two hypotheses."""

    def __init__(self) -> None:
        self.previous: list[str] = []
        self.committed: list[str] = []

    def update(self, hypothesis: str) -> tuple[str, str]:
        current = _tokens(hypothesis)
        prefix = 0
        for old, new in zip(self.previous, current):
            if old.casefold() != new.casefold():
                break
            prefix += 1
        stable = current[:prefix]
        already = len(self.committed)
        if prefix > already:
            self.committed.extend(stable[already:])
        self.previous = current
        return " ".join(self.committed), " ".join(current[len(self.committed):])

    def reset(self) -> None:
        self.previous.clear()
        self.committed.clear()
