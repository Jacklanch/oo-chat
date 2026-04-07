#!/usr/bin/env python3
"""Recieves one meeting JSON object from stdin; create calendar event via cli.core.schedule_one_event.

Prints one JSON line to stdout: {"ok": true|false, "message": "..."}
Exit 0 on success, 1 on failure.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    # Act like running from the root directory
    os.chdir(_ROOT)
    if str(_ROOT) not in sys.path:
        sys.path.insert(0, str(_ROOT))

    from cli.core import do_create_events

    try:
        # Read the meeting from stdin
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "message": f"Invalid JSON: {e}"}))
        sys.exit(1)

    meeting = {
        "title": data.get("title"),
        "date": data.get("date"),
        "start_time": data.get("start_time"),
        "end_time": data.get("end_time"),
        "location": data.get("location"),
        "attendees": data.get("attendees"),
        "is_video_call": bool(data.get("is_video_call")),
    }
    # "all" because only one event is going to be passed in at a time
    msg = do_create_events([meeting], 'all')
    ok = True
    # Check for errors from msg output
    if "No calendar connected" in msg:
        ok = False
    if "No events matched" in msg:
        ok = False
    if "No events could be added" in msg:
        ok = False
    print(json.dumps({"ok": ok, "message": msg}))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()