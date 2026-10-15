import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createVaultEnvironment, discoverEnvironments, installKernelDependencies, parseCondaPaths, parseLauncherPaths, vaultEnvironmentPath, type CreationDeps, type DiscoveryDeps, type PythonProbe } from "../src/kernel/environment-manager";
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

  it("creates .venv, installs dependencies, then returns the interpreter", async () => {
    const run = vi.fn(async () => {});
    const install = vi.fn(async (executable: string) => probe(executable));
    const deps: CreationDeps = {
      async claim() {},
      async probe(filename) { return probe(filename); },
      run,
      install
    };
    const stages: string[] = [];
    expect(await createVaultEnvironment(root, base, (stage) => stages.push(stage), undefined, deps)).toBe(vaultEnvironmentPath(root));
    expect(run).toHaveBeenCalledWith(base, ["-m", "venv", path.join(root, ".venv")], undefined);
    expect(install).toHaveBeenCalledOnce();
    expect(stages).toContain("Creating .venv in the vault…");
  });

  it("does not overwrite an existing .venv", async () => {
    const run = vi.fn(async () => {});
    const deps: CreationDeps = { async claim() { throw Object.assign(new Error("exists"), { code: "EEXIST" }); }, async probe(filename) { return probe(filename); }, run, async install(filename) { return probe(filename); } };
    await expect(createVaultEnvironment(root, base, () => {}, undefined, deps)).rejects.toThrow("already contains .venv");
    expect(run).not.toHaveBeenCalled();
  });

  it("does not report creation as successful when dependency installation fails", async () => {
    const deps: CreationDeps = {
      async claim() {},
      async probe(filename) { return probe(filename); },
      async run() {},
      async install() { throw new Error("pip failed"); }
    };
    await expect(createVaultEnvironment(root, base, () => {}, undefined, deps)).rejects.toThrow("pip failed");
  });

  it("keeps the original binding when saving a new choice fails", async () => {
    const settings = normalizeSettings({ defaultPythonPath: base, notebookPythonPaths: { "a.ipynb": "D:\\old\\python.exe" } });
    await expect(saveNotebookEnvironmentBinding(settings, "a.ipynb", vaultEnvironmentPath(root), async () => { throw new Error("save failed"); })).rejects.toThrow("save failed");
    expect(settings.notebookPythonPaths["a.ipynb"]).toBe("D:\\old\\python.exe");
  });
});

describe("Jupyter dependency installation", () => {
  it("installs into the chosen interpreter and verifies the result", async () => {
    const executable = "D:\\Python39\\python.exe";
    const run = vi.fn(async () => {});
    const checked = probe(executable);
    const stages: string[] = [];
    expect(await installKernelDependencies(executable, (stage) => stages.push(stage), undefined, {
      run,
      async probe() { return checked; }
    })).toBe(checked);
    expect(run).toHaveBeenCalledWith(executable, ["-m", "pip", "install", "jupyter_client", "ipykernel"], undefined);
    expect(stages.at(-1)).toBe("Checking the new environment…");
  });

  it("reports failure if packages are still missing", async () => {
    const executable = "D:\\Python39\\python.exe";
    await expect(installKernelDependencies(executable, () => {}, undefined, {
      async run() {},
      async probe() { return { ...probe(executable), missing: ["ipykernel"] }; }
    })).rejects.toThrow("Missing packages: ipykernel");
  });
});
