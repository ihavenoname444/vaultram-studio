import { ABI, Action, Transaction } from "@wharfkit/antelope";
import { z } from "zod";
import { AppSpecSchema, compile, JUNGLE4 } from "./index.ts";
const name = z.string().regex(/^[a-z1-5.]{1,12}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const OnboardingInput = z
  .object({
    spec: AppSpecSchema,
    budget: z.number().int().min(1).max(100),
    maxPayload: z.number().int().min(1).max(256),
    hours: z.number().int().min(1).max(168),
  })
  .strict();
export const OnboardingPlan = z
  .object({
    version: z.literal(2),
    kind: z.literal("REGISTER_AND_GRANT"),
    chainId: z.literal(JUNGLE4),
    contract: name,
    codeHash: hash,
    abiHash: hash,
    owner: name,
    allocator: name,
    actor: name,
    permission: name.refine((x) => !["active", "owner"].includes(x)),
    spec: AppSpecSchema,
    grantId: z.string().regex(/^[1-9][0-9]{0,15}$/),
    budget: z.number().int().min(1).max(100),
    maxPayload: z.number().int().min(1).max(256),
    expires: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type EnrollmentPlan = z.infer<typeof OnboardingPlan>;
export function planOf(request: any): EnrollmentPlan {
  return OnboardingPlan.parse(
    Object.fromEntries(
      Object.keys(OnboardingPlan.shape).map((k) => [k, request[k]]),
    ),
  );
}
// Exact action encoder shared with the wallet. No caller-supplied ABI/actions.
const abi = ABI.from({
  version: "eosio::abi/1.2",
  structs: [
    {
      name: "regapp",
      base: "",
      fields: [
        { name: "id", type: "uint64" },
        { name: "owner", type: "name" },
        { name: "app_hash", type: "checksum256" },
      ],
    },
    {
      name: "grant",
      base: "",
      fields: [
        { name: "id", type: "uint64" },
        { name: "app_id", type: "uint64" },
        { name: "actor", type: "name" },
        { name: "actor_permission", type: "name" },
        { name: "space", type: "name" },
        { name: "budget", type: "uint64" },
        { name: "expires", type: "uint64" },
        { name: "max_payload", type: "uint32" },
      ],
    },
  ],
  actions: ["regapp", "grant"].map((name) => ({
    name,
    type: name,
    ricardian_contract: "",
  })),
});
export function onboardingActors(plan: EnrollmentPlan) {
  return [...new Set([plan.owner, plan.allocator])].sort();
}
export function onboardingActions(raw: unknown) {
  const p = OnboardingPlan.parse(raw),
    app = compile(p.spec);
  const authorization = onboardingActors(p).map((actor) => ({
    actor,
    permission: "active",
  }));
  return [
    Action.from(
      {
        account: p.contract,
        name: "regapp",
        authorization,
        data: { id: app.appId, owner: p.owner, app_hash: app.appHash.slice(2) },
      },
      abi,
    ),
    Action.from(
      {
        account: p.contract,
        name: "grant",
        authorization,
        data: {
          id: p.grantId,
          app_id: app.appId,
          actor: p.actor,
          actor_permission: p.permission,
          space: "memory",
          budget: p.budget,
          expires: p.expires,
          max_payload: p.maxPayload,
        },
      },
      abi,
    ),
  ];
}
export function onboardingTransaction(request: any) {
  const p = planOf(request),
    tx = Transaction.from(request.transaction);
  if (
    String(tx.id) !== request.transactionId ||
    String(tx.signingDigest(JUNGLE4)) !== request.signingDigest ||
    JSON.stringify(tx.actions) !== JSON.stringify(onboardingActions(p)) ||
    tx.context_free_actions.length ||
    tx.transaction_extensions.length ||
    Number(tx.delay_sec) !== 0 ||
    !Array.isArray(request.signers) ||
    JSON.stringify(request.signers.map((s: any) => s.actor)) !==
      JSON.stringify(onboardingActors(p)) ||
    request.signers.some((s: any) => typeof s.publicKey !== "string")
  )
    throw Error("Exact owner/allocator onboarding transaction mismatch");
  return tx;
}
