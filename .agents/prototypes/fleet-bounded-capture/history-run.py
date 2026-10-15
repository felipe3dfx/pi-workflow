"""Dependency-free Linux PTY probe. No terminal emulator or physical display."""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import struct
import subprocess
import tempfile
import termios
import time

HERE = Path(__file__).resolve().parent
KEYS = [("open-history", b"\r"), ("page-up", b"\x1b[5~"), ("page-up-2", b"\x1b[5~"), ("page-up-3", b"\x1b[5~"), ("load-earlier", b"\x1b[5~"), ("collapse-thinking", b"\x14"), ("page-down", b"\x1b[6~"), ("expand-thinking", b"\x14"), ("follow", b"f"), ("back", b"\x1b"), ("reopen", b"\r"), ("collapse-again", b"\x14")]


def run(mode, history):
    with tempfile.TemporaryDirectory(prefix="fleet-pty-") as root:
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 55, 0, 0))
        env = {"PATH": os.environ["PATH"], "HOME": root, "LANG": "C.UTF-8", "TERM": "xterm-256color", "PI_OFFLINE": "1"}
        process = subprocess.Popen(["node", str(HERE / "history-case.mjs"), mode, root, str(history)], stdin=slave, stdout=slave, stderr=subprocess.PIPE, env=env, start_new_session=True)
        os.close(slave)
        received, sends, buffer = {}, [], b""
        deadline, next_send = time.monotonic() + 35, float("inf")
        try:
            while time.monotonic() < deadline:
                readable, _, _ = select.select([master], [], [], 0.01)
                if readable:
                    try:
                        data = os.read(master, 65536)
                    except OSError as error:
                        if error.errno == errno.EIO:
                            break
                        raise
                    if not data:
                        break
                    buffer = (buffer + data)[-200000:]
                    for match in re.finditer(rb"FLEET_PROBE_(\d+)_END", buffer):
                        received.setdefault(int(match[1]), time.monotonic_ns())
                if 0 in received and not sends:
                    next_send = min(next_send, time.monotonic())
                if len(sends) < len(KEYS) and (not sends or len(sends) in received) and time.monotonic() >= next_send:
                    name, key = KEYS[len(sends)]
                    sends.append({"seq": len(sends) + 1, "action": name, "ns": time.monotonic_ns()})
                    os.write(master, key)
                    next_send = time.monotonic() + 0.3
                if len(sends) == len(KEYS) and len(KEYS) in received:
                    os.write(master, b"q")
                    break
                if process.poll() is not None:
                    break
            process.wait(timeout=4)
            stderr = process.stderr.read().decode()
            assert process.returncode == 0, stderr
            result = json.loads(Path(root, "result.json").read_text())
            events = [json.loads(line) for line in Path(root, "timing.jsonl").read_text().splitlines()]
            probes = []
            for sent in sends:
                seq = sent["seq"]
                ev = {kind: next((e for e in events if e["type"] == kind and e["seq"] == seq), None) for kind in ["input", "render", "write"]}
                assert all(ev.values()), (mode, history, sent, events)
                ns = sent["ns"]
                probes.append({"action": sent["action"], "inputDeliveryMs": (int(ev["input"]["ns"]) - ns) / 1e6, "inputToWriteMs": (int(ev["write"]["ns"]) - ns) / 1e6, "inputToPtyReadMs": (received[seq] - ns) / 1e6, "componentRenderMs": ev["render"]["ms"], "stats": ev["render"].get("stats")})
            assert len(probes) == len(KEYS)
            if mode == "candidate" and history:
                earlier = next(p for p in probes if p["action"] == "load-earlier")
                assert earlier["stats"]["parsedMessages"] == 32, earlier
            return {"workload": result, "probes": probes, "timingEvents": events}
        finally:
            try:
                os.killpg(process.pid, 15)
            except ProcessLookupError:
                pass
            if process.poll() is None:
                try:
                    process.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, 9)
                    process.wait()
            try:
                os.killpg(process.pid, 9)
            except ProcessLookupError:
                pass
            os.close(master)
            process.stderr.close()


if __name__ == "__main__":
    samples = []
    for repeat in range(3):
        for history in [0, 2000, 10000]:
            for mode in (["baseline", "candidate"] if repeat % 2 == 0 else ["candidate", "baseline"]):
                samples.append({"repeat": repeat, **run(mode, history)})
    print(json.dumps({"harness": "Python PTY + Pi TuiMainScreen/ProcessTerminal; not physical display", "samples": samples}, indent=2))
