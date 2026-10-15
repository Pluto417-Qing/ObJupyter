import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import bridgeSource from "../bridge/bridge.py";

export interface BridgeEvent {
  event: string;
  cellId?: string;
  [key: string]: unknown;
}

interface Pending {
  resolve(value: any): void;
  reject(reason: Error): void;
}

export async function materializeBridge(): Promise<string> {
  const hash = createHash("sha256").update(bridgeSource).digest("hex").slice(0, 16);
  const directory = path.join(os.tmpdir(), "objupyter");
  const filename = path.join(directory, `bridge-${hash}.py`);
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.access(filename);
  } catch {
    await fs.writeFile(filename, bridgeSource, { encoding: "utf8", flag: "wx" }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  }
  return filename;
}

export class BridgeClient extends EventEmitter {
  private process: ChildProcessWithoutNullStreams;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private closed = false;
  private stderr = "";

  private constructor(pythonPath: string, bridgePath: string) {
    super();
    this.process = spawn(pythonPath, ["-u", bridgePath], {
      shell: false, windowsHide: true, stdio: "pipe",
      env: { ...process.env, PYTHONIOENCODING: "utf-8" }
    });
    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-8000); });
    this.process.on("error", (error) => this.failAll(error));
    this.process.on("exit", (code) => this.failAll(new Error(`Python bridge exited (${code}). ${this.stderr}`.trim())));
    readline.createInterface({ input: this.process.stdout }).on("line", (line) => this.handleLine(line));
  }

  static async start(pythonPath: string, cwd: string): Promise<BridgeClient> {
    const bridge = new BridgeClient(pythonPath, await materializeBridge());
    try {
      await bridge.request("start", { cwd }, 45_000);
      return bridge;
    } catch (error) {
      bridge.process.kill();
      throw error;
    }
  }

  private handleLine(line: string): void {
    let message: any;
    try { message = JSON.parse(line); } catch { return; }
    if (typeof message.event === "string") {
      this.emit("event", message as BridgeEvent);
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(String(message.error ?? "Unknown bridge error")));
  }

  private failAll(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.emit("event", { event: "status", state: "dead" } satisfies BridgeEvent);
  }

  request<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = 0): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Python bridge is closed"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const finish: Pending = {
        resolve: (value) => { if (timer) clearTimeout(timer); resolve(value); },
        reject: (error) => { if (timer) clearTimeout(timer); reject(error); }
      };
      this.pending.set(id, finish);
      if (timeoutMs) timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.process.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (error && this.pending.delete(id)) finish.reject(error);
      });
    });
  }

  async dispose(): Promise<void> {
    if (!this.closed) {
      try { await this.request("shutdown", {}, 3000); } catch { /* Force termination below. */ }
    }
    this.closed = true;
    this.process.kill();
    this.removeAllListeners();
  }
}
