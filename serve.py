"""Serve the website locally:  python serve.py [port] [--open]   then open http://localhost:8000

(Or double-click "Start Voting Tracker.bat".) The site can't be opened by double-clicking
web/index.html: browsers block pages opened from a file from loading their scripts and data.

Uses explicit MIME types because Python on Windows sometimes reads .js as text/plain from the
registry, which stops the browser from loading the site's JavaScript modules."""
from __future__ import annotations

import functools
import http.server
import os
import sys
import webbrowser
from pathlib import Path

WEB = Path(__file__).resolve().parent / "web"


class Server(http.server.ThreadingHTTPServer):
    # On Windows, address reuse lets a second server silently share a busy port; refuse instead.
    allow_reuse_address = os.name != "nt"


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")  # always show the latest data
        super().end_headers()

    def log_message(self, fmt, *args):  # keep the console quiet
        pass


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    open_browser = "--open" in sys.argv
    port = int(args[0]) if args else 8000
    url = f"http://localhost:{port}"
    handler = functools.partial(Handler, directory=str(WEB))
    try:
        httpd = Server(("127.0.0.1", port), handler)
    except OSError:
        # Something already listens there, most likely the tracker started earlier: just open it.
        print(f"Port {port} is already in use, so the tracker is probably running. Opening {url}", flush=True)
        if open_browser:
            webbrowser.open(url)
        return
    with httpd:
        print(f"Voting Tracker is running at {url}\n"
              "Keep this window open while you use it. Close it (or press Ctrl+C) to stop.", flush=True)
        if open_browser:
            webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
