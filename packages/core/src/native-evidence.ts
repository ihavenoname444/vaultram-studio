// Structural checks on RPC evidence. RPC/consensus authenticity remains a trust
// assumption; these checks do not turn an RPC response into a light-client proof.
export function assertNativeBlock(
  block: any,
  n: unknown,
  txid: string,
  lib: unknown,
  expectedId?: string,
) {
  if (
    !Number.isSafeInteger(n) ||
    Number(n) < 1 ||
    !Number.isSafeInteger(lib) ||
    Number(n) > Number(lib) ||
    block?.block_num !== n ||
    !/^[a-f0-9]{64}$/.test(block?.id ?? "") ||
    (expectedId !== undefined && block.id !== expectedId) ||
    !Array.isArray(block.transactions) ||
    !block.transactions.some(
      (t: any) => t.status === "executed" && (t.trx?.id ?? t.trx) === txid,
    )
  )
    throw Error("Executed irreversible inclusion mismatch");
}
export function assertNativeEffect(
  effect: any,
  reservation: any,
  c: { grantId: string; actor: string; space: string },
  rid: string,
  payload: string,
  payloadHash: string,
) {
  if (
    !effect ||
    !reservation ||
    String(effect.id) !== rid ||
    String(reservation.id) !== rid ||
    effect.payload !== payload ||
    String(effect.reservation) !== rid ||
    String(effect.grant_id) !== c.grantId ||
    effect.actor !== c.actor ||
    effect.space !== c.space ||
    Number(reservation.status) !== 1 ||
    reservation.payload_hash !== payloadHash ||
    String(reservation.grant_id) !== c.grantId ||
    ["obligation", "nullifier", "effect_id"].some(
      (k) => String(reservation[k]) !== rid,
    )
  )
    throw Error("Native effect binding mismatch");
}
