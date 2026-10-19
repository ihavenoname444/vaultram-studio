import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const compiler = process.env.CDT_CPP ?? "cdt-cpp";
const version = spawnSync(compiler, ["--version"], { encoding: "utf8" });
if (version.status !== 0 || !version.stdout.includes("4.1.1"))
  throw Error("Official CDT 4.1.1 required; see docs/AUTHORITY_PROOF.md");
const model = process.argv[2] ?? "v1";
if (!["v1", "owner-app-v2"].includes(model))
  throw Error("Unknown authority model");
const source = resolve(
    model === "v1"
      ? "contracts/authority-proof/authority.cpp"
      : "contracts/owner-app/authority.cpp",
  ),
  out = "contracts/build/" + (model === "v1" ? "authority" : "owner-app");
const stage = mkdtempSync(join(tmpdir(), "vaultram-authority-"));
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
try {
  for (const n of [1, 2]) {
    mkdirSync(join(stage, String(n)));
    const r = spawnSync(
      compiler,
      [
        "-abigen",
        "-contract=vrauthority",
        "-o",
        join(stage, String(n), "authority.wasm"),
        source,
      ],
      { stdio: "inherit" },
    );
    if (r.status !== 0) throw Error("Authority build failed");
  }
  mkdirSync(out, { recursive: true });
  const hashes: Record<string, string> = {
    sourceSha256: hash(readFileSync(source)),
  };
  for (const ext of ["wasm", "abi"]) {
    const a = readFileSync(join(stage, "1", "authority." + ext)),
      b = readFileSync(join(stage, "2", "authority." + ext));
    if (!a.equals(b)) throw Error("Repeated build differs: " + ext);
    writeFileSync(out + "/authority." + ext, a);
    hashes[ext + "Sha256"] = hash(a);
  }
  writeFileSync(
    out + "/build.json",
    JSON.stringify(
      {
        method: "Local CDT",
        compilerVersion: version.stdout.trim(),
        repeatBuildByteIdentical: true,
        ...hashes,
      },
      null,
      2,
    ),
  );
  console.log(hashes);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
