import {
  readdirSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  cpSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { join, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { releaseFiles } from "./release-audit.ts";
const root = resolve(".");
const paths = releaseFiles(root).map((f) => resolve(root, f.path));
const stage = mkdtempSync(join(tmpdir(), "vaultram-source-"));
const packageRoot = join(stage, "vaultram-studio");
mkdirSync(packageRoot);
const manifest: Record<string, string> = {};
try {
  for (const path of paths) {
    const rel = relative(root, path);
    const bytes = readFileSync(path);
    if (
      /PVT_(?:K1|R1)_[1-9A-HJ-NP-Za-km-z]{40,}|-----BEGIN (?:EC |RSA )?PRIVATE KEY-----|sk-proj-[A-Za-z0-9_-]{20,}/.test(
        bytes.toString(),
      )
    )
      throw new Error("Secret pattern detected: " + rel);
    const target = join(packageRoot, rel);
    mkdirSync(join(target, ".."), { recursive: true });
    cpSync(path, target);
    manifest[rel] = createHash("sha256").update(bytes).digest("hex");
  }
  writeFileSync(
    join(packageRoot, "SOURCE-MANIFEST.json"),
    JSON.stringify(manifest, null, 2),
  );
  const target = resolve(process.argv[2] ?? "../VaultRAM-Studio-source.zip");
  // A fresh temporary archive prevents stale entries surviving a repeated package run.
  const archive = join(stage, "source.zip");
  const result = spawnSync("zip", ["-qr", archive, "vaultram-studio"], {
    cwd: stage,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error("zip failed");
  cpSync(archive, target);
  console.log(
    JSON.stringify(
      {
        archive: target,
        files: paths.length,
        sha256: createHash("sha256").update(readFileSync(target)).digest("hex"),
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(stage, { recursive: true, force: true });
}
