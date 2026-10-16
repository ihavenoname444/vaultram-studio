import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
const output = "contracts/build";
mkdirSync(output, { recursive: true });
if (!process.argv.includes("--remote")) {
  const r = spawnSync(
    "cdt-cpp",
    [
      "-abigen",
      "-contract=vaultram",
      "-o",
      output + "/runtime.wasm",
      "contracts/vaulta-runtime/runtime.cpp",
    ],
    { stdio: "inherit" },
  );
  if (r.error)
    throw new Error(
      "CDT unavailable. Install CDT 4.1.1, or explicitly use --remote to send only runtime.cpp to the Vaulta IDE compiler.",
    );
  if (r.status !== 0) process.exit(r.status ?? 1);
  const hashes: Record<string, string> = {};
  for (const [key, path] of Object.entries({
    sourceSha256: "contracts/vaulta-runtime/runtime.cpp",
    wasmSha256: output + "/runtime.wasm",
    abiSha256: output + "/runtime.abi",
  })) {
    hashes[key] = createHash("sha256").update(readFileSync(path)).digest("hex");
  }
  const version = spawnSync("cdt-cpp", ["--version"], { encoding: "utf8" });
  writeFileSync(
    output + "/build.json",
    JSON.stringify(
      {
        method: "local CDT",
        compilerVersion: version.stdout.trim(),
        sourceCommit: process.env.GITHUB_SHA ?? null,
        ...hashes,
      },
      null,
      2,
    ) + "\n",
  );
  process.exit(0);
}
const source = readFileSync("contracts/vaulta-runtime/runtime.cpp", "utf8");
console.log(
  "Sending runtime.cpp only to api.ide.eosnetwork.com (remote compiler; reproducibility not attested).",
);
const id = randomUUID();
const socket = new WebSocket("wss://api.ide.eosnetwork.com/websocket");
const result = await new Promise<string>((resolve, reject) => {
  const timer = setTimeout(() => {
    socket.close();
    reject(new Error("Remote compiler timed out"));
  }, 60000);
  socket.addEventListener("open", () =>
    socket.send(
      JSON.stringify({
        type: "save",
        data: {
          id,
          name: "vaultram-runtime",
          files: [{ name: "runtime.cpp", path: "", content: source }],
          selectedFile: "",
          openFiles: [],
          createdAt: Date.now(),
        },
      }),
    ),
  );
  socket.addEventListener("error", () => {
    clearTimeout(timer);
    reject(new Error("Remote compiler connection failed"));
  });
  socket.addEventListener("message", (event) => {
    const m = JSON.parse(String(event.data));
    if (m.type === "saved")
      socket.send(JSON.stringify({ type: "build", data: { id } }));
    if (m.type === "build-status") {
      clearTimeout(timer);
      socket.close();
      if (m.data.success) resolve(String(m.data.data));
      else reject(new Error(String(m.data.data)));
    }
  });
});
if (!/^[a-zA-Z0-9_-]+$/.test(result))
  throw new Error("Unexpected build identifier");
const hashes: Record<string, string> = {
  sourceSha256: createHash("sha256").update(source).digest("hex"),
};
for (const ext of ["wasm", "abi"]) {
  const r = await fetch(
    "https://api.ide.eosnetwork.com/v1/download/" +
      ext +
      "/" +
      result +
      "/runtime",
    { signal: AbortSignal.timeout(20000) },
  );
  if (!r.ok) throw new Error("Artifact download failed");
  const bytes = Buffer.from(await r.arrayBuffer());
  if (
    ext === "wasm" &&
    !bytes.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))
  )
    throw new Error("Invalid WASM");
  if (ext === "abi") JSON.parse(bytes.toString());
  writeFileSync(output + "/runtime." + ext, bytes);
  hashes[ext + "Sha256"] = createHash("sha256").update(bytes).digest("hex");
}
writeFileSync(
  output + "/build.json",
  JSON.stringify(
    {
      method: "Vaulta IDE remote compiler",
      compilerVersion: "not attested",
      builtAt: new Date().toISOString(),
      ...hashes,
    },
    null,
    2,
  ),
);
console.log(hashes);
