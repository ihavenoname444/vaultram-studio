import { readFileSync, existsSync, lstatSync, realpathSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { createHash } from "node:crypto";
export function releaseFiles(root = resolve(".")) {
  const paths: string[] = JSON.parse(
    readFileSync(resolve(root, "scripts/release-files.json"), "utf8"),
  );
  if (new Set(paths).size !== paths.length)
    throw new Error("Duplicate release path");
  const knownSecrets: string[] = [];
  const keyFile = resolve(root, ".data/testnet-keys.json");
  if (existsSync(keyFile))
    for (const value of Object.values(
      JSON.parse(readFileSync(keyFile, "utf8")),
    ))
      if (typeof value === "string" && value.startsWith("PVT_"))
        knownSecrets.push(value);
  for (const file of [".data/simulation-wallet.key", ".data/receipt-key.pem"])
    if (existsSync(resolve(root, file)))
      knownSecrets.push(readFileSync(resolve(root, file), "utf8").trim());
  const secrets =
    /PVT_(?:K1|R1)_[1-9A-HJ-NP-Za-km-z]{40,}|-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----|(?:sk-proj-|github_pat_|gh[pousr]_)[A-Za-z0-9_-]{20,}/;
  return paths.map((path) => {
    if (
      path.startsWith("/") ||
      path
        .split("/")
        .some(
          (p) =>
            !p ||
            p === ".." ||
            p === ".data" ||
            p === ".git" ||
            p === "node_modules",
        ) ||
      (path.includes(".env") && path !== ".env.example")
    )
      throw new Error("Forbidden release path: " + path);
    const absolute = resolve(root, path);
    const rel = relative(realpathSync(root), realpathSync(absolute));
    if (
      rel.startsWith(".." + sep) ||
      lstatSync(absolute).isSymbolicLink() ||
      !lstatSync(absolute).isFile()
    )
      throw new Error("Unsafe release path: " + path);
    const content = readFileSync(absolute, "utf8");
    if (Buffer.byteLength(content) > 2_000_000 || content.includes("\0"))
      throw new Error("Unexpected release content: " + path);
    if (
      secrets.test(content) ||
      knownSecrets.some(
        (secret) => secret.length > 20 && content.includes(secret),
      )
    )
      throw new Error("Secret detected in " + path);
    if (/\/Users\/d444\//.test(content))
      throw new Error("Local filesystem detail in " + path);
    return {
      path,
      mode: "100644",
      type: "blob",
      content,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
  });
}
