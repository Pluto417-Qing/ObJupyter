"""Integration tests for the real JSON-lines bridge and Python kernel."""

import importlib.util
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path


BRIDGE = Path(__file__).parents[1] / "src" / "bridge" / "bridge.py"
HAS_JUPYTER = all(importlib.util.find_spec(name) for name in ("jupyter_client", "ipykernel"))


@unittest.skipUnless(HAS_JUPYTER, "Install jupyter_client and ipykernel in the test interpreter")
class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.process = subprocess.Popen(
            [sys.executable, "-u", str(BRIDGE)], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1,
            env={**os.environ, "PYTHONIOENCODING": "utf-8"}
        )
        self.messages = queue.Queue()
        self.next_id = 1
        threading.Thread(target=self.read_output, daemon=True).start()
        self.request("start", {"cwd": self.directory.name})

    def tearDown(self):
        if self.process.poll() is None:
            try:
                self.request("shutdown", {})
            except Exception:
                pass
            self.process.kill()
        self.process.wait(timeout=10)
        self.process.stdin.close()
        self.process.stdout.close()
        self.process.stderr.close()
        self.directory.cleanup()

    def read_output(self):
        for line in self.process.stdout:
            self.messages.put(json.loads(line))

    def send(self, method, params):
        request_id = self.next_id
        self.next_id += 1
        self.process.stdin.write(json.dumps({"id": request_id, "method": method, "params": params}) + "\n")
        self.process.stdin.flush()
        return request_id

    def receive_until(self, request_id, on_event=None, allow_error=False):
        events = []
        while True:
            try:
                message = self.messages.get(timeout=45)
            except queue.Empty:
                stderr = self.process.stderr.read() if self.process.poll() is not None else ""
                self.fail(f"Bridge timed out. {stderr}")
            if "event" in message:
                events.append(message)
                if on_event:
                    on_event(message)
            elif message.get("id") == request_id:
                if not message["ok"] and not allow_error:
                    self.fail(message["error"])
                return message["result"] if message["ok"] else message, events

    def request(self, method, params, on_event=None):
        return self.receive_until(self.send(method, params), on_event)

    def test_state_output_error_and_restart(self):
        self.request("execute", {"cellId": "a", "code": "x = 41"})
        result, events = self.request("execute", {"cellId": "b", "code": "print(x + 1)"})
        self.assertEqual(result["status"], "ok")
        self.assertTrue(any(e.get("output", {}).get("text") == "42\n" for e in events if e["event"] == "output"))
        result, events = self.request("execute", {"cellId": "c", "code": "raise ValueError('bad')"})
        self.assertEqual(result["status"], "error")
        self.assertTrue(any(e.get("output", {}).get("ename") == "ValueError" for e in events if e["event"] == "output"))
        self.request("restart", {})
        result, events = self.request("execute", {"cellId": "d", "code": "print('x' in globals())"})
        self.assertTrue(any(e.get("output", {}).get("text") == "False\n" for e in events if e["event"] == "output"))

    def test_interrupt_and_unicode(self):
        request_id = self.send("execute", {"cellId": "slow", "code": "import time\ntime.sleep(30)"})
        interrupted = False

        def interrupt(event):
            nonlocal interrupted
            if event["event"] == "status" and event.get("state") == "busy" and not interrupted:
                interrupted = True
                self.send("interrupt", {})

        result, _ = self.receive_until(request_id, interrupt, allow_error=True)
        self.assertTrue(interrupted)
        self.assertTrue(result.get("status") == "error" or result.get("ok") is False)
        _, events = self.request("execute", {"cellId": "unicode", "code": "print('你好 🌟')"})
        self.assertTrue(any(e.get("output", {}).get("text") == "你好 🌟\n" for e in events if e["event"] == "output"))

    def test_input_and_image_output(self):
        def answer(event):
            if event["event"] == "input_request":
                self.send("input_reply", {"value": "Ada"})

        _, events = self.request("execute", {"cellId": "input", "code": "print('Hello ' + input('Name: '))"}, answer)
        self.assertTrue(any(e.get("output", {}).get("text") == "Hello Ada\n" for e in events if e["event"] == "output"))
        _, events = self.request("execute", {"cellId": "image", "code": "from IPython.display import display, Image\ndisplay(Image(data=b'\\x89PNG\\r\\n\\x1a\\n'))"})
        self.assertTrue(any("image/png" in e.get("output", {}).get("data", {}) for e in events if e["event"] == "output"))


if __name__ == "__main__":
    unittest.main()
