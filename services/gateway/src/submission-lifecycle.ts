import type { DatabaseSync } from "node:sqlite";

type Journal = "native_ops" | "native_owner_ops" | "native_onboard_ops";

// No awaits: the final unresolved check and creation share a SQLite writer lock,
// including across processes/connections. Never hold this lock during RPC work.
export function prepareJournal<T>(
  db: DatabaseSync,
  table: Journal,
  create: () => T,
): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    if (
      db
        .prepare(
          `SELECT 1 FROM ${table} WHERE status IN ('PENDING','UNKNOWN') LIMIT 1`,
        )
        .get()
    )
      throw Error("Reconcile unresolved submission first");
    const result = create();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// Describes this intent's lifecycle, never permission to repeat its business effect.
// RPC finality is trusted-node evidence, not a light-client consensus proof.
export function submissionOutcome(
  status: string,
  fresh = false,
  blocked = true,
) {
  const common = {
    automaticRetry: false,
    newIntentRequiresAuthorityCheck: true,
    automaticRebroadcast: false,
    submissionBlockCleared: false,
  };
  if (status === "IRREVERSIBLE")
    return {
      ...common,
      state: "FINALIZED",
      nextAction: fresh ? "STOP" : "RECONCILE",
      reason: fresh
        ? "TRUSTED_RPC_FINALITY_AND_EFFECT"
        : "HISTORICAL_FINALITY_FRESH_CHECK_UNAVAILABLE",
      submissionBlockCleared: fresh && !blocked,
    };
  if (status === "PENDING" || status === "SUBMITTED")
    return {
      ...common,
      state: "SUBMITTED",
      nextAction: "RECONCILE",
      reason: "FINALITY_UNCONFIRMED",
    };
  if (
    status === "UNKNOWN" ||
    status === "BROADCASTING" ||
    status === "RESERVED"
  )
    return {
      ...common,
      state: "UNKNOWN",
      nextAction: "RECONCILE",
      reason: "SUBMISSION_UNRESOLVED",
    };
  if (status === "REJECTED")
    return {
      ...common,
      state: "REJECTED",
      nextAction: "STOP",
      reason: "REJECTED_BEFORE_BROADCAST",
    };
  return {
    ...common,
    state: "PREPARED",
    nextAction: "STOP",
    reason: "EXPLICIT_SUBMISSION_REQUIRED",
  };
}
