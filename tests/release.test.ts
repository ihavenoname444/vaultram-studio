import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey } from "viem/accounts";
import { releaseFiles } from "../scripts/release-audit.ts";
const roots: string[] = [];
function fixture(paths = ["README.md"]) {
  const root = mkdtempSync(join(tmpdir(), "vaultram-release-"));
  roots.push(root);
  mkdirSync(join(root, "scripts"));
  writeFileSync(
    join(root, "scripts/release-files.json"),
    JSON.stringify(paths),
  );
  writeFileSync(join(root, "README.md"), "Public source\n");
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
describe("public source boundary", () => {
  it("exports only allowlisted files, never unlisted local keys", () => {
    const root = fixture();
    writeFileSync(join(root, ".env"), "SECRET=local-only");
    mkdirSync(join(root, ".data"));
    writeFileSync(
      join(root, ".data/simulation-wallet.key"),
      generatePrivateKey(),
    );
    const files = releaseFiles(root);
    expect(files.map((f) => f.path)).toEqual(["README.md"]);
    expect(files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    ".env",
    ".env.jungle4",
    ".data/key",
    "../outside",
    "node_modules/key",
  ])("rejects forbidden path %s even if allowlisted", (path) => {
    expect(() => releaseFiles(fixture([path]))).toThrow(
      "Forbidden release path",
    );
  });
  it("rejects symlink escape", () => {
    const external = fixture();
    const root = fixture(["linked.md"]);
    symlinkSync(join(external, "README.md"), join(root, "linked.md"));
    expect(() => releaseFiles(root)).toThrow("Unsafe release path");
  });
  it("detects an actual local EOA private key accidentally pasted into source", () => {
    const root = fixture();
    mkdirSync(join(root, ".data"));
    const secret = generatePrivateKey();
    writeFileSync(join(root, ".data/simulation-wallet.key"), secret);
    writeFileSync(join(root, "README.md"), "Accidental paste: " + secret);
    expect(() => releaseFiles(root)).toThrow("Secret detected in README.md");
  });
  it("detects credential patterns without relying on a local key file", () => {
    const root = fixture();
    writeFileSync(join(root, "README.md"), "PVT_" + "K1_" + "a".repeat(50));
    expect(() => releaseFiles(root)).toThrow("Secret detected in README.md");
  });
});
