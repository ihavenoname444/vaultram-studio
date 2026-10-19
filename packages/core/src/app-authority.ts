import { z } from "zod";
export const NativeAppId = z
  .string()
  .regex(/^[1-9][0-9]{0,19}$/)
  .refine((x) => BigInt(x) <= 18446744073709551615n, "App ID exceeds uint64");
export const AppBinding = z
  .object({
    appId: NativeAppId,
    owner: z.string().regex(/^[a-z1-5.]{1,12}$/),
    appHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type AppAuthorityBinding = z.infer<typeof AppBinding>;

// Owner is a native account consenting on chain, never a relayer's assertion
// about ownership of a legacy EVM address. The full hash binds the Studio spec.
export function assertAppBinding(
  app: any,
  grant: any,
  binding: AppAuthorityBinding,
  actor: string,
  permission: string,
) {
  if (
    !app ||
    !grant ||
    String(app.id) !== binding.appId ||
    app.owner !== binding.owner ||
    app.app_hash !== binding.appHash ||
    String(grant.app_id) !== binding.appId ||
    grant.owner !== binding.owner ||
    grant.actor !== actor ||
    grant.actor_permission !== permission
  )
    throw Error("Native owner/app authority binding mismatch");
}

export function assertAppEffect(
  effect: any,
  binding: AppAuthorityBinding,
  permission: string,
) {
  if (
    !effect ||
    String(effect.app_id) !== binding.appId ||
    effect.owner !== binding.owner ||
    effect.actor_permission !== permission
  )
    throw Error("Native owner/app effect binding mismatch");
}

export function assertCompiledApp(
  app: { appId: string; appHash: string },
  binding: AppAuthorityBinding,
) {
  if (app.appId !== binding.appId || app.appHash !== "0x" + binding.appHash)
    throw Error("Compiled app does not match registered native app");
}
