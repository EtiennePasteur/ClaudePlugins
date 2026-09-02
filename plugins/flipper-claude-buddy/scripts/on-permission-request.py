#!/usr/bin/env python3
"""PermissionRequest hook: shows permission request on Flipper, waits for user decision."""

import json
import os
import socket
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _runtime import SOCKET_PATH  # noqa: E402
TIMEOUT = 60  # seconds to wait for user decision on Flipper


def send_to_bridge(request: dict) -> dict:
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(TIMEOUT)
    s.connect(SOCKET_PATH)
    s.sendall(json.dumps(request).encode())
    s.shutdown(socket.SHUT_WR)
    resp = s.recv(4096)
    s.close()
    return json.loads(resp.decode())


def single_choice_question(tool_input: dict):
    """Return (question, labels) when the call is a single-select, single
    question with 2-4 options — the only shape the Flipper can answer.

    Anything else (several questions, multiSelect) still has an answer shape
    the device cannot express, so it falls through to Claude's own dialog.
    """
    questions = tool_input.get("questions")
    if not isinstance(questions, list) or len(questions) != 1:
        return None
    question = questions[0]
    if not isinstance(question, dict) or question.get("multiSelect"):
        return None
    options = question.get("options")
    if not isinstance(options, list) or not 2 <= len(options) <= 4:
        return None
    labels = [
        o["label"] for o in options
        if isinstance(o, dict) and isinstance(o.get("label"), str) and o["label"]
    ]
    if len(labels) != len(options):
        return None
    if not isinstance(question.get("question"), str) or not question["question"]:
        return None
    return question, labels


def defer_to_claude():
    """Hand the decision back to Claude's own dialog and stop."""
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PermissionRequest",
            "decision": {"behavior": "ask"},
        }
    }))
    sys.exit(0)


def handle_question(tool_input: dict):
    """Answer an AskUserQuestion call from the Flipper.

    The tool itself is a pass-through: whatever ``answers`` map its input
    carries is what gets reported back to Claude, so filling that map here is
    what turns a button press on the device into the user's answer. Keys are
    the question text verbatim; the value is the chosen option's label.

    Returns (rather than exiting) when the call cannot be served from the
    device, leaving the caller to fall back to the normal dialog.
    """
    parsed = single_choice_question(tool_input)
    if parsed is None:
        return
    question, labels = parsed

    try:
        result = send_to_bridge({
            "action": "question_request",
            "header": question.get("header") or "",
            "question": question["question"],
            "options": labels,
        })
    except Exception:
        return

    status = result.get("status")
    if status == "ask":
        defer_to_claude()
    if status != "ok":
        # no_flipper, timeout, busy, error — fall back to normal dialog
        return

    index = result.get("index")
    if not isinstance(index, int) or not 0 <= index < len(labels):
        return

    updated_input = {
        "questions": tool_input["questions"],
        "answers": {question["question"]: labels[index]},
    }
    if "metadata" in tool_input:
        updated_input["metadata"] = tool_input["metadata"]

    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PermissionRequest",
            "decision": {"behavior": "allow", "updatedInput": updated_input},
        }
    }))
    sys.exit(0)


def extract_detail(tool_name: str, tool_input: dict) -> str:
    """Extract a short detail string from the tool input."""
    # Special handling for mcp__atlassian__searchJiraIssuesUsingJql and similar
    if "__" in tool_name:
        parts = tool_name.split("__")
        if len(parts) >= 3:
            # e.g. mcp__atlassian__searchJiraIssuesUsingJql
            return parts[-1][:21]
    if tool_name == "Bash":
        desc = tool_input.get("description", "")
        if desc:
            return desc[:21]
        cmd = tool_input.get("command", "")
        return cmd[:21] if cmd else ""
    if tool_name in ("Edit", "Write", "Read"):
        path = tool_input.get("file_path", "")
        return os.path.basename(path)[:21] if path else ""
    if tool_name in ("WebFetch", "WebSearch"):
        val = tool_input.get("url") or tool_input.get("query", "")
        for prefix in ("https://", "http://"):
            if val.startswith(prefix):
                val = val[len(prefix):]
                break
        return val[:21]
    if tool_name == "Agent":
        return tool_input.get("description", "")[:21]
    return ""


def main():
    if not os.path.exists(SOCKET_PATH):
        # Bridge not running — fall back to normal permission dialog
        sys.exit(1)

    try:
        hook_input = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, EOFError):
        sys.exit(1)


    tool_name_raw = hook_input.get("tool_name", "Unknown")
    tool_input = hook_input.get("tool_input", {})

    # A question needs a list of choices, not Allow/Deny — and if the Flipper
    # cannot render this particular shape, Claude's own dialog should own it.
    if tool_name_raw == "AskUserQuestion":
        handle_question(tool_input)
        sys.exit(1)

    # For tool_name like mcp__atlassian__searchJiraIssuesUsingJql, display as mcp_atlassian
    if "__" in tool_name_raw:
        parts = tool_name_raw.split("__")
        if len(parts) >= 2:
            tool_name = f"{parts[0]}_{parts[1]}"
        else:
            tool_name = tool_name_raw
    else:
        tool_name = tool_name_raw

    detail = extract_detail(tool_name_raw, tool_input)

    try:
        result = send_to_bridge(
            {"action": "permission_request", "tool": tool_name, "detail": detail}
        )
    except Exception:
        # Bridge error — fall back to normal permission dialog
        sys.exit(1)

    status = result.get("status")

    # Dismissed on Flipper — defer to Claude's normal permission dialog
    if status == "ask":
        defer_to_claude()

    # Only act on explicit user decisions from Flipper
    if status != "ok":
        # no_flipper, timeout, busy, error — fall back to normal dialog
        sys.exit(1)

    allowed = result.get("allowed", False)
    always = result.get("always", False)

    if allowed:
        decision = {"behavior": "allow"}
        if always:
            suggestions = hook_input.get("permission_suggestions", [])
            if suggestions:
                decision["updatedPermissions"] = suggestions
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "decision": decision,
            }
        }
    else:
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "decision": {"behavior": "deny", "message": "Denied on Flipper"},
            }
        }

    print(json.dumps(output))
    sys.exit(0)


if __name__ == "__main__":
    main()
