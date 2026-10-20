// A rejected transaction is an RPC observation, never an irreversible receipt.
export function assertRevokedRejection(
  error: any,
  before: unknown,
  after: unknown,
) {
  if (
    error?.code !== 3050003 ||
    error.name !== "eosio_assert_message_exception" ||
    !Array.isArray(error.details) ||
    !error.details.some(
      (d: any) => d.message === "assertion failure with message: grant revoked",
    ) ||
    JSON.stringify(before) !== JSON.stringify(after)
  )
    throw Error(
      "Expected explicit grant-revoked assertion and unchanged state",
    );
}
