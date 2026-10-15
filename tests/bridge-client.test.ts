import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { materializeBridge } from "../src/kernel/bridge-client";

describe("Python bridge packaging", () => {
  it("materializes the embedded bridge source", async () => {
    const path = await materializeBridge();
    const source = await readFile(path, "utf8");
    expect(source).toContain("class Bridge:");
    expect(source).toContain("ipykernel_launcher");
  });
});
