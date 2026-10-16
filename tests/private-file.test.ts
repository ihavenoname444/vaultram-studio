import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  symlinkSync,
  linkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPrivateJson } from "../services/gateway/src/private-file.ts";
const dirs: string[] = [];
function fixture(content = '{"synthetic":"not-a-key"}') {
  const dir = mkdtempSync(join(tmpdir(), "private-config-"));
  dirs.push(dir);
  const file = join(dir, "config.json");
  writeFileSync(file, content, { mode: 0o600 });
  return { dir, file };
}
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
it("reads an owned private configuration at 0600 or 0400", () => {
  const { file } = fixture();
  expect(readPrivateJson(file)).toEqual({ synthetic: "not-a-key" });
  chmodSync(file, 0o400);
  expect(readPrivateJson(file)).toEqual({ synthetic: "not-a-key" });
});
it.each([0o644, 0o640, 0o604, 0o620])(
  "rejects group/other access with mode %i",
  (mode) => {
    const { file } = fixture();
    chmodSync(file, mode);
    expect(() => readPrivateJson(file)).toThrow(
      "Private configuration rejected",
    );
  },
);
it("rejects symlinks, hardlinks and directories", () => {
  const { dir, file } = fixture(),
    alias = join(dir, "alias");
  symlinkSync(file, alias);
  expect(() => readPrivateJson(alias)).toThrow();
  rmSync(alias);
  linkSync(file, alias);
  expect(() => readPrivateJson(file)).toThrow();
  expect(() => readPrivateJson(dir)).toThrow();
});
it("rejects malformed and oversized files without echoing their contents", () => {
  for (const content of [
    '{"privateKey":"synthetic-sensitive-content"',
    "x".repeat(65537),
  ]) {
    const { file } = fixture(content);
    try {
      readPrivateJson(file);
      throw Error("Unexpected acceptance");
    } catch (e) {
      expect((e as Error).message).toMatch(/^Private configuration rejected:/);
      expect((e as Error).message).not.toContain("synthetic-sensitive-content");
    }
  }
});
