"""JSON protocol for Flipper <-> Host Bridge communication."""

import json
import time
import unicodedata
import uuid

def make_id() -> str:
    return uuid.uuid4().hex[:8]


def encode(msg_type: str, data: dict | None = None) -> bytes:
    msg = {
        "v": 1,
        "t": msg_type,
        "d": data or {},
    }
    return json.dumps(msg, separators=(",", ":")).encode() + b"\n"


def decode(line: bytes) -> dict | None:
    line = line.strip()
    if not line:
        return None
    try:
        msg = json.loads(line)
        if isinstance(msg, dict) and "t" in msg:
            return msg
    except json.JSONDecodeError:
        pass
    return None


def notify_msg(sound: str, vibro: bool = True, text: str = "", subtext: str = "") -> bytes:
    d: dict = {"sound": sound, "vibro": vibro, "text": text}
    if subtext:
        d["sub"] = subtext[:21]
    return encode("notify", d)


def state_msg(claude_connected: bool = False) -> bytes:
    return encode("state", {"claude": claude_connected})


def status_msg(line1: str, line2: str = "") -> bytes:
    d: dict = {"line1": line1[:21]}
    if line2:
        d["line2"] = line2[:21]
    return encode("status", d)


def ping_msg(rssi: int | None = None) -> bytes:
    d: dict[str, int] = {}
    if rssi is not None:
        d["rssi"] = int(rssi)
    return encode("ping", d)


def menu_msg(items: list[str]) -> bytes:
    return encode("menu", {"items": "|".join(items)})


def perm_msg(tool: str, detail: str = "") -> bytes:
    d: dict = {"tool": tool[:21]}
    if detail:
        d["detail"] = detail[:21]
    return encode("perm", d)


def wire_safe(text: str, limit: int) -> str:
    r"""Fold a string down to what the Flipper can parse and render.

    ``protocol.c`` extracts strings with ``strstr``/``strchr`` and no escape
    handling, so a quote, a backslash or a ``\uXXXX`` escape would truncate
    the field mid-parse.  The LCD font is ASCII-only too.  Accented letters
    are decomposed to their base form ("é" -> "e"); anything still outside
    printable ASCII — and the ``|`` used as the option separator — is dropped.
    """
    kept = []
    for ch in unicodedata.normalize("NFKD", text):
        if unicodedata.combining(ch):
            continue
        # Blank rather than drop, so "Vert|pomme" doesn't become "Vertpomme".
        kept.append(" " if ch in '"\\|' else ch if 32 <= ord(ch) < 127 else "")
    return " ".join("".join(kept).split())[:limit]


def ask_msg(header: str, question: str, options: list[str]) -> bytes:
    """Multiple-choice question. Options are answered by index, so the
    labels on the wire are display-only and may be folded/truncated."""
    return encode("ask", {
        "hdr": wire_safe(header, 21),
        "q": wire_safe(question, 63),
        "opts": "|".join(wire_safe(o, 26) for o in options),
    })
