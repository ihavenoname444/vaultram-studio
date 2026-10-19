import { describe, expect, it } from "vitest";
import { authorityManifest } from "../packages/core/src/authority-manifest.ts";
const c = {
  account: "authority111",
  actor: "agent1111111",
  permission: "vrstudio",
  grantId: "1",
  space: "memory",
  appBinding: { appId: "42", owner: "owner1111111", appHash: "a".repeat(64) },
};
const app = {
  id: 42,
  owner: c.appBinding.owner,
  app_hash: c.appBinding.appHash,
};
const grant = {
  id: 1,
  app_id: 42,
  owner: app.owner,
  actor: c.actor,
  actor_permission: c.permission,
  space: "memory",
  budget: 4,
  available: 1,
  reserved: 1,
  quarantined: 1,
  consumed: 1,
  max_payload: 100,
  expires: 1000,
  revoked: false,
};
describe("authority permission manifest", () => {
  it("preserves the gateway's supported safe-integer expiry range", () => {
    expect(
      authorityManifest(app, { ...grant, expires: "4294967296" }, c).limits
        .expires,
    ).toBe(4294967296);
    expect(() =>
      authorityManifest(app, { ...grant, expires: "9007199254740992" }, c),
    ).toThrow();
  });
  it("does not promote untrusted backing claims or treat expiry as unused capacity", () => {
    const m = authorityManifest(
      app,
      { ...grant, backing: { verified: true }, revoked: 1 },
      c,
    );
    expect(m.backing.verified).toBe(false);
    expect(m.limits).toMatchObject({
      available: 1,
      reserved: 1,
      quarantined: 1,
      expires: 1000,
      revoked: true,
    });
    expect(m.revocation.actor).toBe(app.owner);
  });
  it("rejects substituted identity, permission, namespace and nonconserving or malformed state", () => {
    for (const patch of [
      { owner: c.actor },
      { app_id: 43 },
      { actor_permission: "active" },
      { id: 2 },
      { space: "treasury" },
      { available: 2 },
      { available: -1 },
      { available: "1e0" },
      { max_payload: 257 },
      { revoked: "false" },
      { expires: Infinity },
    ])
      expect(() => authorityManifest(app, { ...grant, ...patch }, c)).toThrow();
    expect(() =>
      authorityManifest({ ...app, app_hash: "b".repeat(64) }, grant, c),
    ).toThrow();
  });
});
