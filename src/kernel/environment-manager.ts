import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const KERNEL_PACKAGES = ["jupyter_client", "ipykernel"];
const PROBE_SCRIPT = "import importlib.util,json,sys; print(json.dumps({'executable':sys.executable,'version':sys.version.split()[0],'prefix':sys.prefix,'basePrefix':sys.base_prefix,'missing':[x for x in ('jupyter_client','ipykernel') if importlib.util.find_spec(x) is None]}))";

export interface PythonEnvironment {
  executable: string;
  version: string;
  source: string;
  missing: string[];
  isBase: boolean;
}

export interface PythonProbe {
  executable: string;
  version: string;
  prefix: string;
  basePrefix: string;
  missing: string[];
}

export interface DiscoveryDeps {
  run(command: string, args: string[], timeout: number): Promise<string>;
  probe(executable: string): Promise<PythonProbe>;
  exists(filename: string): Promise<boolean>;
}

export const defaultDiscoveryDeps: DiscoveryDeps = {
  async run(command, args, timeout) {
    const { stdout } = await runFile(command, args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 });
    return stdout;
  },
  async probe(executable) {
    const output = await defaultDiscoveryDeps.run(executable, ["-c", PROBE_SCRIPT], 15_000);
    const data = JSON.parse(output.trim()) as PythonProbe;
    if (!data.executable || !data.version || !data.prefix || !data.basePrefix || !Array.isArray(data.missing)) throw new Error("Unexpected Python response");
    return data;
  },
  async exists(filename) {
    try { await fs.access(filename); return true; } catch { return false; }
  }
};

export function parseLauncherPaths(output: string): string[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/((?:[A-Za-z]:\\|\\\\)[^\r\n]*?python(?:w)?\.exe)\s*$/i);
    return match ? [match[1]] : [];
  });
}

export function parseCondaPaths(output: string): string[] {
  const data = JSON.parse(output) as { envs?: unknown };
  if (!Array.isArray(data.envs)) return [];
  return data.envs.filter((item): item is string => typeof item === "string").map((folder) => path.join(folder, "python.exe"));
}

export async function probePython(executable: string, deps: DiscoveryDeps = defaultDiscoveryDeps): Promise<PythonProbe> {
  return deps.probe(executable);
}

export async function discoverEnvironments(vaultRoot: string, configuredPaths: string[], deps: DiscoveryDeps = defaultDiscoveryDeps, env: NodeJS.ProcessEnv = process.env): Promise<PythonEnvironment[]> {
  const candidates: { executable: string; source: string }[] = [];
  const add = (executable: string | undefined, source: string) => {
    if (executable?.trim()) candidates.push({ executable: executable.trim(), source });
  };
  add(path.join(vaultRoot, ".venv", "Scripts", "python.exe"), "Vault .venv");
  add(env.VIRTUAL_ENV && path.join(env.VIRTUAL_ENV, "Scripts", "python.exe"), "Active virtual environment");
  add(env.CONDA_PREFIX && path.join(env.CONDA_PREFIX, "python.exe"), "Active Conda environment");
  for (const configured of configuredPaths) add(configured, "Configured");

  const results = await Promise.allSettled([
    deps.run("py", ["-0p"], 8_000),
    deps.run("where.exe", ["python"], 8_000),
    deps.run("where.exe", ["conda"], 8_000)
  ]);
  if (results[0].status === "fulfilled") for (const filename of parseLauncherPaths(results[0].value)) add(filename, "Python launcher");
  if (results[1].status === "fulfilled") for (const filename of results[1].value.split(/\r?\n/)) {
    if (!/\\Microsoft\\WindowsApps\\/i.test(filename)) add(filename, "PATH");
  }
  const condaExecutables = results[2].status === "fulfilled" ? results[2].value.split(/\r?\n/).filter((item) => /conda\.(?:exe|bat)$/i.test(item)) : [];
  if (!condaExecutables.length) condaExecutables.push("conda.exe");
  for (const executable of condaExecutables.slice(0, 2)) {
    try {
      const output = /\.bat$/i.test(executable)
        ? await deps.run("cmd.exe", ["/d", "/s", "/c", `"${executable}" info --envs --json`], 12_000)
        : await deps.run(executable, ["info", "--envs", "--json"], 12_000);
      for (const filename of parseCondaPaths(output)) add(filename, "Conda");
      break;
    } catch { /* Conda is optional. */ }
  }

  const seen = new Set<string>();
  const unique = candidates.filter(({ executable }) => {
    const key = path.resolve(executable).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const discovered: PythonEnvironment[] = [];
  for (let offset = 0; offset < unique.length; offset += 4) {
    const batch = await Promise.all(unique.slice(offset, offset + 4).map(async (candidate) => {
      try {
        if ((path.isAbsolute(candidate.executable) || path.win32.isAbsolute(candidate.executable)) && !(await deps.exists(candidate.executable))) return null;
        const result = await deps.probe(candidate.executable);
        return { executable: result.executable, version: result.version, source: candidate.source, missing: result.missing, isBase: result.prefix.toLowerCase() === result.basePrefix.toLowerCase() } satisfies PythonEnvironment;
      } catch { return null; }
    }));
    for (const item of batch) if (item) discovered.push(item);
  }
  const canonical = new Set<string>();
  return discovered.filter((item) => {
    const key = path.resolve(item.executable).toLowerCase();
    if (canonical.has(key)) return false;
    canonical.add(key);
    return true;
  });
}

async function runProcess(executable: string, args: string[], signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, shell: false, signal, stdio: ["ignore", "pipe", "pipe"] });
    const timeout = args[1] === "venv" ? 120_000 : 600_000;
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${path.basename(executable)} timed out after ${Math.round(timeout / 1000)} seconds.`)); }, timeout);
    let details = "";
    const append = (chunk: Buffer) => { details = (details + chunk.toString()).slice(-4000); };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`${path.basename(executable)} exited (${code}). ${details.trim()}`));
    });
  });
}

export function vaultEnvironmentPath(vaultRoot: string): string {
  return path.join(vaultRoot, ".venv", "Scripts", "python.exe");
}

export interface InstallationDeps {
  run(executable: string, args: string[], signal?: AbortSignal): Promise<void>;
  probe(executable: string): Promise<PythonProbe>;
}

const defaultInstallationDeps: InstallationDeps = { run: runProcess, probe: probePython };

export async function installKernelDependencies(executable: string, onStage: (stage: string) => void, signal?: AbortSignal, deps: InstallationDeps = defaultInstallationDeps): Promise<PythonProbe> {
  onStage(`Installing ${KERNEL_PACKAGES.join(" and ")}…`);
  await deps.run(executable, ["-m", "pip", "install", ...KERNEL_PACKAGES], signal);
  onStage("Checking the new environment…");
  const checked = await deps.probe(executable);
  if (checked.missing.length) throw new Error(`Missing packages: ${checked.missing.join(", ")}`);
  return checked;
}

export interface CreationDeps {
  claim(target: string): Promise<void>;
  probe(executable: string): Promise<PythonProbe>;
  run(executable: string, args: string[], signal?: AbortSignal): Promise<void>;
  install(executable: string, onStage: (stage: string) => void, signal?: AbortSignal): Promise<PythonProbe>;
}

const defaultCreationDeps: CreationDeps = {
  async claim(target) { await fs.mkdir(target); },
  probe: probePython,
  run: runProcess,
  install: installKernelDependencies
};

export async function createVaultEnvironment(vaultRoot: string, basePython: string, onStage: (stage: string) => void, signal?: AbortSignal, deps: CreationDeps = defaultCreationDeps): Promise<string> {
  const target = path.join(vaultRoot, ".venv");
  const base = await deps.probe(basePython);
  if (base.prefix.toLowerCase() !== base.basePrefix.toLowerCase()) throw new Error("Choose a base Python installation to create .venv.");
  try { await deps.claim(target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("The vault already contains .venv. Choose that environment or repair it instead.");
    throw error;
  }
  onStage("Creating .venv in the vault…");
  await deps.run(base.executable, ["-m", "venv", target], signal);
  const executable = vaultEnvironmentPath(vaultRoot);
  await deps.install(executable, onStage, signal);
  return executable;
}
