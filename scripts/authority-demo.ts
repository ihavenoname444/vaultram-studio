import { existsSync } from "node:fs";
import { resolve } from "node:path";
const model = process.argv[2] ?? "v1";
if (!["v1", "owner-app-v2"].includes(model))
  throw Error("Unknown authority model");
const file = resolve(
  model === "v1"
    ? ".data/authority-studio/config.json"
    : ".data/owner-app-studio/config.json",
);
if (!existsSync(file))
  throw Error(
    "Run the dedicated authority setup first; see docs/NATIVE_STUDIO.md",
  );
process.env.VAULTRAM_AUTHORITY_CONFIG = file;
process.env.VAULTRAM_AUTHORITY_MODEL = model;
await import("./demo.ts");
