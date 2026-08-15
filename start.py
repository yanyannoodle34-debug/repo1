#!/usr/bin/env python3
"""Terminal bot manager for Telegram Bot Runner.

Usage:
  python3 start.py
  TBR_URL=http://localhost:3000 ADMIN_PASSWORD=secret python3 start.py

Commands at the prompt:
  <N>s  — start bot number N
  <N>x  — stop bot number N
  r     — refresh list
  q     — quit
"""
import os
import sys
import json
import urllib.request
import urllib.parse
import http.cookiejar
import getpass

BASE = os.environ.get("TBR_URL", "http://localhost:3000").rstrip("/")
_jar = http.cookiejar.CookieJar()
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_jar))


def _trpc_query(proc: str, data=None):
    enc = urllib.parse.quote(json.dumps({"0": {"json": data or {}}}))
    req = urllib.request.Request(f"{BASE}/api/trpc/{proc}?batch=1&input={enc}")
    with _opener.open(req) as r:
        return json.loads(r.read())[0]["result"]["data"]["json"]


def _trpc_mutate(proc: str, data=None):
    body = json.dumps({"0": {"json": data or {}}}).encode()
    req = urllib.request.Request(
        f"{BASE}/api/trpc/{proc}?batch=1",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with _opener.open(req) as r:
        return json.loads(r.read())[0]["result"]["data"]["json"]


def _login():
    pw = os.environ.get("ADMIN_PASSWORD") or getpass.getpass(f"Password for {BASE}: ")
    body = json.dumps({"password": pw}).encode()
    req = urllib.request.Request(
        f"{BASE}/auth/login",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        _opener.open(req)
    except urllib.error.HTTPError as e:
        sys.exit(f"Login failed: {e.read().decode()}")


_C = {
    "running":  "\033[32m",
    "stopped":  "\033[90m",
    "failed":   "\033[31m",
    "starting": "\033[34m",
    "stopping": "\033[33m",
    "draft":    "\033[90m",
}
_R = "\033[0m"


def _pill(status: str) -> str:
    c = _C.get(status, "")
    return f"{c}{status}{_R}" if c else status


def _show(bots: list) -> None:
    print(f"\n  {'#':<3} {'Name':<26} {'Runtime':<8} Status")
    print("  " + "─" * 52)
    for i, b in enumerate(bots, 1):
        print(f"  {i:<3} {b['name']:<26} {b['runtime']:<8} {_pill(b['status'])}")
    print()


def main():
    print(f"Connecting to {BASE} …")
    _login()
    print("Logged in.  <N>s = start  <N>x = stop  r = refresh  q = quit")

    bots: list = []
    need_refresh = True

    while True:
        if need_refresh:
            try:
                bots = _trpc_query("bot.list")
            except Exception as exc:
                print(f"  Error fetching bots: {exc}")
                bots = []
            if not bots:
                print("  No bots found. Upload one via the web dashboard first.")
                break
            _show(bots)
            need_refresh = False

        try:
            cmd = input("> ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if cmd == "q":
            break
        if cmd == "r":
            need_refresh = True
            continue

        if len(cmd) >= 2 and cmd[-1] in ("s", "x") and cmd[:-1].isdigit():
            idx = int(cmd[:-1]) - 1
            if not (0 <= idx < len(bots)):
                print("  Invalid number.")
                continue
            bot = bots[idx]
            try:
                if cmd[-1] == "s":
                    if bot["status"] not in ("stopped", "failed", "draft"):
                        print(f"  {bot['name']} is already {bot['status']}.")
                        continue
                    _trpc_mutate("bot.start", {"botId": bot["id"]})
                    print(f"  → Starting {bot['name']} …")
                else:
                    if bot["status"] not in ("running", "starting"):
                        print(f"  {bot['name']} is not running ({bot['status']}).")
                        continue
                    _trpc_mutate("bot.stop", {"botId": bot["id"]})
                    print(f"  → Stopping {bot['name']} …")
                need_refresh = True
            except Exception as exc:
                print(f"  Error: {exc}")
        else:
            print("  Commands: <N>s = start  <N>x = stop  r = refresh  q = quit")


if __name__ == "__main__":
    main()
