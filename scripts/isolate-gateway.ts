// macOS-only launch boundary. No unsandboxed fallback. --probe reads no secrets.
import { spawnSync, spawn } from "node:child_process";
import {
  readFileSync,
  realpathSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { parseEnv } from "node:util";
const root = realpathSync(resolve("."));
const data = resolve(root, ".data/demo-owner-app");
const config = resolve(root, ".data/owner-app-studio/config.json");
if (process.platform !== "darwin")
  throw Error("Isolation launcher requires macOS; no unisolated fallback");
const node = realpathSync(process.execPath);
const quote = (s: string) => JSON.stringify(s);
const reads = ["services", "packages", "node_modules", "contracts/build"].map(
  (p) => realpathSync(resolve(root, p)),
);
const profile = `(version 1)
(deny default)
(allow process-exec (literal ${quote(node)}))
(allow process-fork)
(allow sysctl-read)
(allow file-read-metadata)
(allow file-read* (subpath "/System/Library") (subpath "/usr/lib") (subpath "/private/var/db/dyld") (subpath ${quote(dirname(node))}) ${reads.map((p) => `(subpath ${quote(p)})`).join(" ")} (literal ${quote(resolve(root, "package.json"))}) (literal ${quote(resolve(root, "tsconfig.json"))}) (literal ${quote(config)}))
(allow file-read* file-write* (subpath ${quote(data)}) (literal "/dev/null"))
(allow file-read* (literal "/dev/urandom") (literal "/dev/random") (literal "/etc/resolv.conf") (literal "/private/etc/resolv.conf") (literal "/private/etc/hosts") (subpath "/private/var/run"))
(allow network-outbound (remote tcp "*:443") (remote udp "*:53"))
(allow network-inbound network-bind (local tcp "127.0.0.1:8787"))
(allow mach-lookup (global-name "com.apple.SystemConfiguration.configd") (global-name "com.apple.system.opendirectoryd") (global-name "com.apple.trustd.agent"))
`;
const env: Record<string, string> = {
  PATH: "/usr/bin:/bin",
  HOME: "/nonexistent",
  TMPDIR: data,
  TSX_DISABLE_CACHE: "1",
};
const probe = mkdtempSync(resolve(tmpdir(), "vaultram-isolation-"));
try {
  const canary = resolve(probe, "owner-canary");
  writeFileSync(canary, "NOT_A_SECRET_TEST_CANARY");
  const code = `const fs=require('node:fs');try{fs.readFileSync(${JSON.stringify(canary)});process.exit(9)}catch(e){if(e.code!=='EPERM'&&e.code!=='EACCES')process.exit(8)};console.log('CANARY_READ_DENIED')`;
  const r = spawnSync(
    "/usr/bin/sandbox-exec",
    ["-p", profile, node, "-e", code],
    { env, encoding: "utf8", timeout: 10000 },
  );
  if (r.status !== 0 || r.stdout.trim() !== "CANARY_READ_DENIED")
    throw Error(
      "OS isolation could not be activated/verified; gateway was NOT started. Run the probe from a normal macOS terminal. No unisolated fallback.",
    );
} finally {
  rmSync(probe, { recursive: true, force: true });
}
if (process.argv.includes("--probe")) {
  console.log(
    "OS canary denied. This is one isolation check, not a complete sandbox audit.",
  );
} else {
  // Only restricted operational credentials enter the child environment.
  const values = parseEnv(readFileSync(resolve(root, ".env.jungle4"), "utf8"));
  for (const k of [
    "VAULTA_RPC",
    "VAULTA_RUNTIME",
    "VAULTA_RELAYER",
    "VAULTA_RELAYER_PRIVATE_KEY",
    "VAULTA_CODE_HASH",
    "VAULTA_ABI_HASH",
  ]) {
    if (!values[k]) throw Error("Missing restricted operational configuration");
    env[k] = values[k];
  }
  Object.assign(env, {
    VAULTA_PERMISSION: "relay",
    VAULTRAM_MODE: "JUNGLE4",
    VAULTRAM_DATA_DIR: data,
    VAULTRAM_AUTHORITY_CONFIG: config,
    VAULTRAM_PORT: "8787",
    VAULTRAM_UI_PORT: "5173",
    VAULTRAM_SKIP_DOTENV: "1",
  });
  mkdirSync(data, { recursive: true, mode: 0o700 });
  const child = spawn(
    "/usr/bin/sandbox-exec",
    ["-p", profile, node, "--import", "tsx", "services/gateway/src/server.ts"],
    { cwd: root, env, stdio: "inherit" },
  );
  for (const sig of ["SIGINT", "SIGTERM"] as const)
    process.on(sig, () => child.kill(sig));
  child.on("error", () => {
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
