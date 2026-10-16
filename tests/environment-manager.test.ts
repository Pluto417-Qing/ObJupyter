import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createVaultEnvironment, dependencyInstallCommand, discoverEnvironments, installKernelDependencies, parseCondaPaths, parseLauncherPaths, setupVaultEnvironment, vaultEnvironmentPath, type CreationDeps, type DiscoveryDeps, type PythonProbe, type SetupDeps } from "../src/kernel/environment-manager";
import { saveNotebookEnvironmentBinding } from "../src/kernel/environment-binding";
import { normalizeSettings } from "../src/settings";

function probe(executable: string): PythonProbe {
  return { executable, version: "3.11.9", prefix: path.dirname(executable), basePrefix: path.dirname(executable), missing: [] };
}

describe("Python environment discovery", () => {
  it("parses launcher paths containing spaces and Conda JSON", () => {
    expect(parseLauncherPaths(" -V:3.11 * C:\\Program Files\\Python311\\python.exe\r\n -V:3.9 D:\\Python39\\python.exe\r\n"))
      .toEqual(["C:\\Program Files\\Python311\\python.exe", "D:\\Python39\\python.exe"]);
    expect(parseCondaPaths(JSON.stringify({ envs: ["C:\\Miniconda3", "C:\\Miniconda3\\envs\\science"] }))).toHaveLength(2);
  });

  it("filters invalid interpreters and deduplicates launcher, PATH, and Conda results", async () => {
    const base = "C:\\Program Files\\Python311\\python.exe";
    const conda = "C:\\Miniconda3\\envs\\science\\python.exe";
    const valid = new Set([base.toLowerCase(), conda.toLowerCase()]);
    const deps: DiscoveryDeps = {
      async run(command) {
        if (command === "py") return ` -V:3.11 * ${base}\r\n`;
        if (command === "where.exe") return `${base}\r\nC:\\WindowsApps\\python.exe\r\n`;
        if (command === "conda.exe") return JSON.stringify({ envs: ["C:\\Miniconda3\\envs\\science"] });
        throw new Error("unexpected command");
      },
      async exists(filename) { return valid.has(filename.toLowerCase()); },
      async probe(filename) { return probe(filename === "python.exe" ? base : filename); }
    };
    const found = await discoverEnvironments("C:\\Vault", [base, "python.exe"], deps, {});
    expect(found.map((item) => item.executable)).toEqual([base, conda]);
    expect(found[0].source).toBe("Configured");
  });

  it("continues when Conda is unavailable", async () => {
    const base = "D:\\Python39\\python.exe";
    const deps: DiscoveryDeps = {
      async run(command) {
        if (command === "py") return ` -V:3.9 ${base}\n`;
        throw new Error("not installed");
      },
      async exists(filename) { return filename === base; },
      async probe(filename) { return probe(filename); }
    };
    expect((await discoverEnvironments("C:\\Vault", [], deps, {})).map((item) => item.executable)).toEqual([base]);
  });
});

describe("vault environment creation", () => {
  const root = path.resolve("C:\\Test Vault");
  const base = "C:\\Program Files\\Python311\\python.exe";

  it("creates .venv without installing packages, then returns the interpreter", async () => {
    const run = vi.fn(async () => {});
    const check = vi.fn(async (executable: string) => probe(executable));
    const deps: CreationDeps = {
      async claim() {},
      probe: check,
      run
    };
    const stages: string[] = [];
    expect(await createVaultEnvironment(root, base, (stage) => stages.push(stage), undefined, deps)).toBe(vaultEnvironmentPath(root));
    expect(run).toHaveBeenCalledWith(base, ["-m", "venv", path.join(root, ".venv")], undefined);
    expect(check).toHaveBeenCalledWith(vaultEnvironmentPath(root));
    expect(run).toHaveBeenCalledOnce();
    expect(stages).toContain("Creating .venv in the vault…");
  });

  it("does not overwrite an existing .venv", async () => {
    const run = vi.fn(async () => {});
    const deps: CreationDeps = { async claim() { throw Object.assign(new Error("exists"), { code: "EEXIST" }); }, async probe(filename) { return probe(filename); }, run };
    await expect(createVaultEnvironment(root, base, () => {}, undefined, deps)).rejects.toThrow("already contains .venv");
    expect(run).not.toHaveBeenCalled();
  });

  it("does not report creation as successful when the new interpreter cannot run", async () => {
    const deps: CreationDeps = {
      async claim() {},
      async probe(filename) {
        if (filename === vaultEnvironmentPath(root)) throw new Error("new interpreter failed");
        return probe(filename);
      },
      async run() {}
    };
    await expect(createVaultEnvironment(root, base, () => {}, undefined, deps)).rejects.toThrow("new interpreter failed");
  });

  it("keeps the original binding when saving a new choice fails", async () => {
    const settings = normalizeSettings({ defaultPythonPath: base, notebookPythonPaths: { "a.ipynb": "D:\\old\\python.exe" } });
    await expect(saveNotebookEnvironmentBinding(settings, "a.ipynb", vaultEnvironmentPath(root), async () => { throw new Error("save failed"); })).rejects.toThrow("save failed");
    expect(settings.notebookPythonPaths["a.ipynb"]).toBe("D:\\old\\python.exe");
  });
});

describe("Jupyter dependency guidance", () => {
  it("provides a PowerShell command for the selected interpreter and missing packages", () => {
    expect(dependencyInstallCommand("C:\\Program Files\\Python311\\python.exe", ["ipykernel"]))
      .toBe("& 'C:\\Program Files\\Python311\\python.exe' -m pip install ipykernel");
    expect(dependencyInstallCommand("C:\\Dev's Python\\python.exe", ["jupyter_client"]))
      .toBe("& 'C:\\Dev''s Python\\python.exe' -m pip install jupyter_client");
  });
});

describe("one-click vault environment setup", () => {
  const root = path.resolve("C:\\Test Vault");
  const base = "C:\\Python311\\python.exe";
  const executable = vaultEnvironmentPath(root);

  it("creates a missing vault environment, installs dependencies, and returns it", async () => {
    const create = vi.fn(async () => executable);
    const install = vi.fn(async () => probe(executable));
    const deps: SetupDeps = { async exists() { return false; }, create, install };
    expect(await setupVaultEnvironment(root, base, () => {}, undefined, deps)).toBe(executable);
    expect(create).toHaveBeenCalledWith(root, base, expect.any(Function), undefined);
    expect(install).toHaveBeenCalledWith(executable, expect.any(Function), undefined, undefined);
  });

  it("reuses an existing vault environment without creating it again", async () => {
    const create = vi.fn(async () => executable);
    const install = vi.fn(async () => probe(executable));
    const deps: SetupDeps = { async exists() { return true; }, create, install };
    expect(await setupVaultEnvironment(root, "", () => {}, undefined, deps)).toBe(executable);
    expect(create).not.toHaveBeenCalled();
    expect(install).toHaveBeenCalledOnce();
  });

  it("installs only missing packages and verifies the result", async () => {
    const run = vi.fn(async () => {});
    const check = vi.fn()
      .mockResolvedValueOnce({ ...probe(executable), missing: ["ipykernel"] })
      .mockResolvedValueOnce(probe(executable));
    expect((await installKernelDependencies(executable, () => {}, undefined, { run, probe: check })).missing).toEqual([]);
    expect(run).toHaveBeenCalledWith(executable, ["-m", "pip", "install", "ipykernel"], undefined, undefined);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("skips pip when dependencies are already present", async () => {
    const run = vi.fn(async () => {});
    await installKernelDependencies(executable, () => {}, undefined, { run, async probe() { return probe(executable); } });
    expect(run).not.toHaveBeenCalled();
  });

  it("retries directly when the configured proxy cannot be reached", async () => {
    const run = vi.fn(async () => { throw new Error("ProxyError('Cannot connect to proxy')"); });
    const runWithoutProxy = vi.fn(async () => {});
    const check = vi.fn()
      .mockResolvedValueOnce({ ...probe(executable), missing: ["jupyter_client"] })
      .mockResolvedValueOnce(probe(executable));
    const stages: string[] = [];
    await installKernelDependencies(executable, (stage) => stages.push(stage), undefined, { run, runWithoutProxy, probe: check });
    expect(runWithoutProxy).toHaveBeenCalledWith(executable, ["-m", "pip", "install", "jupyter_client"], undefined, undefined);
    expect(stages).toContain("Configured proxy is unavailable. Retrying without proxy…");
  });

  it("explains when neither the proxy nor a direct connection works", async () => {
    await expect(installKernelDependencies(executable, () => {}, undefined, {
      async run() { throw new Error("ProxyError('Cannot connect to proxy')"); },
      async runWithoutProxy() { throw new Error("Connection timed out"); },
      async probe() { return { ...probe(executable), missing: ["ipykernel"] }; }
    })).rejects.toThrow("Pip could not connect through the configured proxy or directly");
  });

  it("forwards pip output while dependencies install", async () => {
    const output: string[] = [];
    const check = vi.fn()
      .mockResolvedValueOnce({ ...probe(executable), missing: ["ipykernel"] })
      .mockResolvedValueOnce(probe(executable));
    await installKernelDependencies(executable, () => {}, undefined, {
      async run(_executable, _args, _signal, onOutput) { onOutput?.("Collecting ipykernel\n"); },
      probe: check
    }, (chunk) => output.push(chunk));
    expect(output).toEqual(["Collecting ipykernel\n"]);
  });

  it("reports packages still missing after installation", async () => {
    await expect(installKernelDependencies(executable, () => {}, undefined, {
      async run() {},
      async probe() { return { ...probe(executable), missing: ["ipykernel"] }; }
    })).rejects.toThrow("Missing packages: ipykernel");
  });
});
