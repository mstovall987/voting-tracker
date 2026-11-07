"""HTTP helpers: polite GET requests with retries, and downloads that skip unchanged files."""
from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from .config import USER_AGENT


class FetchError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _request(url: str, headers: dict | None = None, timeout: int = 60, retries: int = 3):
    hdrs = {"User-Agent": USER_AGENT}
    if headers:
        hdrs.update(headers)
    delay = 2.0
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, resp.read(), resp.headers
        except urllib.error.HTTPError as err:
            if err.code == 304:
                return 304, b"", err.headers
            if err.code in (400, 401, 403, 404, 410) or attempt == retries:
                raise FetchError(f"HTTP {err.code} for {url}") from err
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as err:
            if attempt == retries:
                raise FetchError(f"Network error for {url}: {err}") from err
        time.sleep(delay)
        delay *= 2
    raise FetchError(f"Could not fetch {url}")


def get_bytes(url: str, accept: str | None = None, timeout: int = 60) -> bytes:
    _, body, _ = _request(url, {"Accept": accept} if accept else None, timeout)
    return body


def get_json(url: str, timeout: int = 60):
    return json.loads(get_bytes(url, accept="application/json", timeout=timeout))


def _meta_path(dest: Path) -> Path:
    return dest.with_name(dest.name + ".meta.json")


def file_meta(dest: Path) -> dict:
    try:
        return json.loads(_meta_path(dest).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def download(url: str, dest: Path, timeout: int = 300) -> bool:
    """Save url to dest. Sends If-Modified-Since / If-None-Match so an unchanged file costs
    almost nothing. Returns True only when the file's contents actually changed."""
    meta = file_meta(dest) if dest.exists() else {}
    headers = {}
    if meta.get("last_modified"):
        headers["If-Modified-Since"] = meta["last_modified"]
    if meta.get("etag"):
        headers["If-None-Match"] = meta["etag"]
    status, body, resp_headers = _request(url, headers, timeout)
    if status == 304:
        return False
    digest = hashlib.sha256(body).hexdigest()
    changed = digest != meta.get("sha256") or not dest.exists()
    dest.parent.mkdir(parents=True, exist_ok=True)
    if changed:
        tmp = dest.with_name(dest.name + ".part")
        tmp.write_bytes(body)
        tmp.replace(dest)
    _meta_path(dest).write_text(json.dumps({
        "url": url,
        "last_modified": resp_headers.get("Last-Modified"),
        "etag": resp_headers.get("ETag"),
        "sha256": digest,
        "fetched_at": utc_now(),
    }, indent=1), encoding="utf-8")
    return changed
