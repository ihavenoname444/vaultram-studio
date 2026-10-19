// Offline export import plus read-only chain reconciliation. Never broadcasts.
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { AuthorityGateway } from "../services/gateway/src/authority.ts";
import { readPrivateJson } from "../services/gateway/src/private-file.ts";
const [config, file, destination] = process.argv.slice(2);
if (!config || !file || !destination)
  throw Error(
    "Usage: recover-native.ts OPERATIONAL_CONFIG EXPORT_JSON SEPARATE_RECOVERY_DIRECTORY",
  );
if (statSync(file).size > 1000000) throw Error("Recovery export too large");
const directory = resolve(destination);
const g = new AuthorityGateway(
  readPrivateJson(config),
  directory,
  undefined,
  existsSync(directory + "/authority.sqlite") ? "existing" : "recovery",
);
try {
  if (
    !g.db.prepare("SELECT 1 FROM native_safety WHERE recovery_locked=1").get()
  )
    throw Error(
      "Destination is not a recovery journal; choose a separate directory",
    );
  console.log(
    JSON.stringify(
      await g.restoreExport(JSON.parse(readFileSync(file, "utf8"))),
      null,
      2,
    ),
  );
} finally {
  g.close();
}
