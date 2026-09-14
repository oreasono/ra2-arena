#!/usr/bin/env python3
import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
VM_DIR = Path(os.environ.get("VM_DIR", "/run/ra2-arena"))
OUT = Path(os.environ.get("ARENA_OUT", VM_DIR / "screens"))
PORT = int(os.environ.get("HTTP_PORT", "80"))
ROUTES = {"/a.png": "xpa", "/b.png": "xpb"}


def vm_running(guest):
    try:
        pid = int((VM_DIR / f"{guest}.pid").read_text())
        os.kill(pid, 0)
        return (VM_DIR / f"{guest}.mon").is_socket()
    except (OSError, ValueError):
        return False


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, content_type, body):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/status":
            state = {name: vm_running(f"xp{name}") for name in ("a", "b")}
            body = json.dumps({"ok": all(state.values()), "vms": state}).encode()
            self.reply(200 if all(state.values()) else 503, "application/json", body)
            return

        guest = ROUTES.get(path)
        if guest is None:
            self.reply(404, "text/plain; charset=utf-8", b"not found\n")
            return

        label = guest[-1]
        env = os.environ | {"VM_HOST": "local", "VM_DIR": str(VM_DIR), "ARENA_OUT": str(OUT)}
        try:
            subprocess.run(
                [HERE / "vm.sh", "shot", guest, label], env=env, check=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=20,
            )
            self.reply(200, "image/png", (OUT / f"{label}.png").read_bytes())
        except (OSError, subprocess.SubprocessError) as error:
            self.log_error("screenshot failed: %s", error)
            self.reply(503, "text/plain; charset=utf-8", b"screenshot unavailable\n")


HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
