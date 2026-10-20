import { describe, it, expect } from "vitest";
import { assertRevokedRejection } from "../scripts/lib/revocation-evidence.ts";

const error = {
  code: 3050003,
  name: "eosio_assert_message_exception",
  details: [{ message: "assertion failure with message: grant revoked" }],
};
describe("live rejection evidence classification", () => {
  it("accepts only the exact revoked assertion with unchanged snapshots", () => {
    expect(() =>
      assertRevokedRejection(error, { consumed: 1 }, { consumed: 1 }),
    ).not.toThrow();
  });
  it.each([
    null,
    { message: "grant revoked" },
    { ...error, code: 3090003 },
    { ...error, name: "unsatisfied_authorization" },
    {
      ...error,
      details: [{ message: "assertion failure with message: grant expired" }],
    },
  ])(
    "does not turn transport or unrelated failures into a passed test",
    (value) => {
      expect(() => assertRevokedRejection(value, [], [])).toThrow();
    },
  );
  it("rejects observed state changes even with the expected assertion", () => {
    expect(() =>
      assertRevokedRejection(error, { consumed: 1 }, { consumed: 2 }),
    ).toThrow();
  });
});
