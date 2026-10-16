import { existsSync } from "node:fs";
import { resolve } from "node:path";
const file = resolve(".data/authority-studio/config.json");
if (!existsSync(file))
  throw Error(
    "Run the dedicated authority setup first; see docs/NATIVE_STUDIO.md",
  );
process.env.VAULTRAM_AUTHORITY_CONFIG = file;
await import("./demo.ts");
