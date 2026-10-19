import { z } from "zod";
import { JUNGLE4 } from "./index.ts";
import { assertAppBinding, type AppAuthorityBinding } from "./app-authority.ts";

export const AuthorityRequirement = z.enum([
  "NATIVE_TESTNET_PROOF",
  "VAULTRAM_BACKED",
]);
export function assertAuthorityRequirement(requirement: unknown) {
  if (AuthorityRequirement.parse(requirement) !== "NATIVE_TESTNET_PROOF")
    throw Error(
      "Verified VaultRAM backing unavailable; native test writes are not backed capacity",
    );
}

const count = z
  .union([z.number(), z.string().regex(/^(0|[1-9][0-9]*)$/)])
  .transform(Number)
  .pipe(z.number().int().min(0).max(10000));
const grantSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  space: z.string().regex(/^[a-z1-5.]{1,12}$/),
  budget: count,
  available: count,
  reserved: count,
  quarantined: count,
  consumed: count,
  max_payload: count.pipe(z.number().min(1).max(256)),
  expires: z
    .union([z.number(), z.string().regex(/^[0-9]+$/)])
    .transform(Number)
    .pipe(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)),
  revoked: z
    .union([z.boolean(), z.literal(0), z.literal(1)])
    .transform(Boolean),
});

// Presentation of an observed grant, not an authorization token or a backing proof.
// Caller checks deployment pins/permission; independent receipts remain separate.
export function authorityManifest(
  app: unknown,
  grant: unknown,
  c: {
    appBinding: AppAuthorityBinding;
    account: string;
    actor: string;
    permission: string;
    grantId: string;
    space: string;
  },
) {
  assertAppBinding(app, grant, c.appBinding, c.actor, c.permission);
  const g = grantSchema.parse(grant);
  if (
    g.id !== c.grantId ||
    g.space !== c.space ||
    g.available + g.reserved + g.quarantined + g.consumed !== g.budget
  )
    throw Error("Manifest grant binding/conservation mismatch");
  return {
    version: 1,
    evidence: "CURRENT_RPC_OBSERVATION",
    requirement: "NATIVE_TESTNET_PROOF",
    chainId: JUNGLE4,
    contract: c.account,
    app: { ...c.appBinding },
    actor: c.actor,
    permission: c.permission,
    grantId: g.id,
    namespace: g.space,
    actions: ["reserve", "consume"],
    limits: {
      unit: "UNBACKED_TEST_WRITE",
      budget: g.budget,
      available: g.available,
      reserved: g.reserved,
      quarantined: g.quarantined,
      consumed: g.consumed,
      maxPayloadBytes: g.max_payload,
      expires: g.expires,
      revoked: g.revoked,
    },
    revocation: {
      actor: c.appBinding.owner,
      permission: "active",
      action: "revoke",
    },
    backing: { status: "UNAVAILABLE", verified: false, position: null },
    unsupported: [
      "PAYMENTS",
      "EXTERNAL_CHAIN_EXECUTION",
      "RAM_BYTE_QUOTA",
      "SEPARATE_SIGNED_USER_INTENT",
    ],
    trust: {
      signer: "LOCAL_OPERATOR",
      ownerCustody: "LOCAL_TEST_OPERATOR",
      gateway: "CAN_ORIGINATE_IN_SCOPE_WRITES",
      hostIsolation: "NOT_ESTABLISHED",
      upgradeAuthority: "CONTRACT_ACCOUNT_ADMINISTRATOR",
    },
  } as const;
}
