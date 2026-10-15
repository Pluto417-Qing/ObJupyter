import { BridgeClient } from "./bridge-client";

interface Session {
  bridge: BridgeClient;
  pythonPath: string;
  users: number;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private starting = new Map<string, Promise<Session>>();

  canSwitch(filePath: string, ownedBridge: BridgeClient | null): boolean {
    if (this.starting.has(filePath)) return false;
    const session = this.sessions.get(filePath);
    return !session || (session.users === 1 && session.bridge === ownedBridge);
  }

  async acquire(filePath: string, pythonPath: string, cwd: string): Promise<BridgeClient> {
    const existing = this.sessions.get(filePath);
    if (existing) {
      if (existing.pythonPath !== pythonPath) throw new Error("Notebook is already open with another Python environment. Close its other view first.");
      existing.users++;
      return existing.bridge;
    }
    let pending = this.starting.get(filePath);
    if (!pending) {
      pending = BridgeClient.start(pythonPath, cwd).then((bridge) => {
        const session = { bridge, pythonPath, users: 0 };
        this.sessions.set(filePath, session);
        return session;
      }).finally(() => this.starting.delete(filePath));
      this.starting.set(filePath, pending);
    }
    const session = await pending;
    if (session.pythonPath !== pythonPath) throw new Error("Notebook is starting with another Python environment.");
    session.users++;
    return session.bridge;
  }

  async release(filePath: string): Promise<void> {
    const session = this.sessions.get(filePath);
    if (!session) return;
    session.users--;
    if (session.users <= 0) {
      this.sessions.delete(filePath);
      await session.bridge.dispose();
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const session = this.sessions.get(oldPath);
    if (!session) return;
    this.sessions.delete(oldPath);
    this.sessions.set(newPath, session);
  }

  async dispose(): Promise<void> {
    await Promise.allSettled(this.starting.values());
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map((session) => session.bridge.dispose()));
  }
}
