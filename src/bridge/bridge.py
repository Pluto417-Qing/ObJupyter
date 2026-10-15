"""JSON-lines bridge between Obsidian and one local Jupyter kernel."""

import asyncio
import json
import os
import queue
import sys
import tempfile
import threading
from pathlib import Path

from jupyter_client import AsyncKernelManager
from jupyter_client.kernelspec import KernelSpecManager


class Bridge:
    def __init__(self):
        self.incoming = asyncio.Queue()
        self.write_lock = threading.Lock()
        self.manager = None
        self.client = None
        self.spec_dir = tempfile.TemporaryDirectory(prefix="objupyter-kernel-")
        self.execution = None
        self.active_id = None
        self.active_cell = None
        self.cwd = None
        self.closed = False

        spec_path = Path(self.spec_dir.name) / "objupyter"
        spec_path.mkdir()
        (spec_path / "kernel.json").write_text(json.dumps({
            "argv": [sys.executable, "-m", "ipykernel_launcher", "-f", "{connection_file}"],
            "display_name": "ObJupyter Python",
            "language": "python"
        }), encoding="utf-8")

    def send(self, message):
        with self.write_lock:
            sys.stdout.write(json.dumps(message, ensure_ascii=False, default=str) + "\n")
            sys.stdout.flush()

    def response(self, request_id, result=None, error=None):
        self.send({"id": request_id, "ok": error is None, "result": result, "error": error})

    def event(self, name, cell_id=None, **data):
        self.send({"event": name, "cellId": cell_id, **data})

    def read_stdin(self, loop):
        for line in sys.stdin:
            try:
                message = json.loads(line)
                loop.call_soon_threadsafe(self.incoming.put_nowait, message)
            except json.JSONDecodeError:
                self.event("error", message="Invalid JSON request")
        loop.call_soon_threadsafe(self.incoming.put_nowait, None)

    async def start_kernel(self, cwd):
        self.cwd = cwd
        specs = KernelSpecManager(kernel_dirs=[self.spec_dir.name], ensure_native_kernel=False)
        self.manager = AsyncKernelManager(kernel_name="objupyter", kernel_spec_manager=specs)
        await self.manager.start_kernel(cwd=cwd)
        self.client = self.manager.client()
        self.client.start_channels()
        await self.client.wait_for_ready(timeout=30)
        self.event("status", state="idle")

    async def stop_kernel(self):
        if self.execution and not self.execution.done():
            request_id = self.active_id
            self.execution.cancel()
            try:
                await self.execution
            except asyncio.CancelledError:
                pass
            if request_id is not None:
                self.response(request_id, error="Execution stopped because the kernel was closed or restarted.")
        self.execution = None
        self.active_id = None
        self.active_cell = None
        if self.client:
            self.client.stop_channels()
            self.client = None
        if self.manager:
            await self.manager.shutdown_kernel(now=True)
            self.manager = None

    async def stdin_messages(self, msg_id, cell_id):
        while True:
            try:
                message = await self.client.get_stdin_msg(timeout=0.5)
            except queue.Empty:
                continue
            if message.get("parent_header", {}).get("msg_id") == msg_id and message.get("msg_type") == "input_request":
                content = message.get("content", {})
                self.event("input_request", cell_id, prompt=content.get("prompt", ""), password=bool(content.get("password")))

    async def execute(self, request_id, cell_id, code):
        msg_id = self.client.execute(code, allow_stdin=True, stop_on_error=True)
        stdin_task = asyncio.create_task(self.stdin_messages(msg_id, cell_id))
        status = "ok"
        count = None
        idle = False
        try:
            while not idle:
                try:
                    message = await self.client.get_iopub_msg(timeout=0.5)
                except queue.Empty:
                    if not await self.manager.is_alive():
                        raise RuntimeError("Python kernel exited unexpectedly")
                    continue
                if message.get("parent_header", {}).get("msg_id") != msg_id:
                    continue
                kind = message.get("msg_type")
                content = message.get("content", {})
                if kind == "status":
                    state = content.get("execution_state")
                    self.event("status", cell_id, state=state)
                    idle = state == "idle"
                elif kind == "execute_input":
                    count = content.get("execution_count")
                    self.event("execution_count", cell_id, count=count)
                elif kind == "stream":
                    self.event("output", cell_id, output={"output_type": "stream", "name": content.get("name", "stdout"), "text": content.get("text", "")})
                elif kind in ("display_data", "execute_result"):
                    output = {"output_type": kind, "data": content.get("data", {}), "metadata": content.get("metadata", {})}
                    if kind == "execute_result":
                        output["execution_count"] = content.get("execution_count")
                    display_id = content.get("transient", {}).get("display_id")
                    self.event("output", cell_id, output=output, displayId=display_id)
                elif kind == "update_display_data":
                    self.event("update_display", cell_id, data=content.get("data", {}), metadata=content.get("metadata", {}), displayId=content.get("transient", {}).get("display_id"))
                elif kind == "error":
                    status = "error"
                    self.event("output", cell_id, output={"output_type": "error", "ename": content.get("ename", "Error"), "evalue": content.get("evalue", ""), "traceback": content.get("traceback", [])})
                elif kind == "clear_output":
                    self.event("clear_output", cell_id, wait=bool(content.get("wait")))

            while True:
                try:
                    reply = await self.client.get_shell_msg(timeout=0.5)
                except queue.Empty:
                    if not await self.manager.is_alive():
                        raise RuntimeError("Python kernel exited unexpectedly")
                    continue
                if reply.get("parent_header", {}).get("msg_id") == msg_id and reply.get("msg_type") == "execute_reply":
                    status = reply.get("content", {}).get("status", status)
                    count = reply.get("content", {}).get("execution_count", count)
                    break
            self.response(request_id, {"status": status, "execution_count": count})
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self.response(request_id, error=str(error))
            self.event("status", cell_id, state="dead")
        finally:
            stdin_task.cancel()
            self.execution = None
            self.active_id = None
            self.active_cell = None

    async def dispatch(self, message):
        request_id = message.get("id")
        method = message.get("method")
        params = message.get("params") or {}
        try:
            if method == "start":
                if self.manager:
                    raise RuntimeError("Kernel already started")
                cwd = params.get("cwd")
                if not isinstance(cwd, str) or not os.path.isdir(cwd):
                    raise ValueError("Notebook directory does not exist")
                await self.start_kernel(cwd)
                self.response(request_id, {"python": sys.executable})
            elif method == "execute":
                if not self.client:
                    raise RuntimeError("Kernel is not started")
                if self.execution:
                    raise RuntimeError("Another cell is running")
                cell_id = params.get("cellId")
                code = params.get("code")
                if not isinstance(cell_id, str) or not isinstance(code, str):
                    raise ValueError("Invalid execute parameters")
                self.active_id = request_id
                self.active_cell = cell_id
                self.execution = asyncio.create_task(self.execute(request_id, cell_id, code))
            elif method == "input_reply":
                if not self.execution:
                    raise RuntimeError("No cell is awaiting input")
                self.client.input(str(params.get("value", "")))
                self.response(request_id, {})
            elif method == "interrupt":
                if self.manager and self.execution:
                    try:
                        await asyncio.wait_for(self.manager.interrupt_kernel(), timeout=3)
                        await asyncio.wait_for(asyncio.shield(self.execution), timeout=5)
                        self.response(request_id, {"restarted": False})
                    except (asyncio.TimeoutError, Exception):
                        # Windows kernels do not always respond to an interrupt signal.
                        # A forced restart guarantees that Stop actually ends the cell.
                        await self.stop_kernel()
                        await self.start_kernel(self.cwd)
                        self.response(request_id, {"restarted": True})
                else:
                    self.response(request_id, {"restarted": False})
            elif method == "restart":
                if not self.manager:
                    raise RuntimeError("Kernel is not started")
                await self.stop_kernel()
                await self.start_kernel(self.cwd)
                self.response(request_id, {})
            elif method == "shutdown":
                await self.stop_kernel()
                self.response(request_id, {})
                self.closed = True
            else:
                raise ValueError("Unknown method")
        except Exception as error:
            self.response(request_id, error=str(error))

    async def run(self):
        loop = asyncio.get_running_loop()
        threading.Thread(target=self.read_stdin, args=(loop,), daemon=True).start()
        try:
            while not self.closed:
                message = await self.incoming.get()
                if message is None:
                    break
                if isinstance(message, dict):
                    await self.dispatch(message)
        finally:
            await self.stop_kernel()
            self.spec_dir.cleanup()


if __name__ == "__main__":
    asyncio.run(Bridge().run())
