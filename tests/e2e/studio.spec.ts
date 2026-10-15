import { test, expect } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
test("compile, deploy, sign, inspect, export and reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByText("SIMULATED", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Compile application", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Small actions. Lasting state." }),
  ).toBeVisible();
  const deploy = page.getByRole("button", {
    name: "Deploy locally",
    exact: true,
  });
  await expect(deploy).toBeEnabled();
  await deploy.click();
  await expect(
    page.getByRole("button", { name: "Runtime ready", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Use demo signer", exact: true })
    .click();
  await page.getByLabel("Agent name", { exact: true }).fill("Atlas Research");
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Reads public technical sources and preserves concise findings.");
  await page
    .getByRole("button", { name: "Prepare action", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Review your bounded action" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Run simulation", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Execution receipt" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog").locator("pre")).toContainText(
    '"transactionId": null',
  );
  await page
    .getByRole("button", { name: "Check signature", exact: true })
    .click();
  await page.getByRole("button", { name: "Close receipt" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Receipt signature is valid",
  );
  await page.screenshot({
    path: "test-results/studio-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Write memory", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Public memory", exact: true })
    .fill("Public finding: every intent binds its destination.");
  await page
    .getByRole("button", { name: "Prepare action", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Run simulation", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Execution receipt" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export evidence" }).click();
  expect((await download).suggestedFilename()).toMatch(/^vaultram-/);
  await page.getByRole("button", { name: "Close receipt" }).click();
  await page.getByRole("button", { name: "State", exact: true }).click();
  await expect(
    page.locator("summary").filter({ hasText: "writemem" }).first(),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Atlas Research" }).first(),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/studio-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("injected EIP-1193 test wallet signs all four actions and rejects substituted review data", async ({
  page,
}) => {
  // A controlled provider exercises the real browser signing path. This does
  // not claim that MetaMask or a human user's mobile wallet has been tested.
  const wallet = privateKeyToAccount(generatePrivateKey());
  let signatures = 0;
  await page.exposeFunction(
    "testWalletRequest",
    async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts")
        return [wallet.address];
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_signTypedData_v4") {
        expect(String(params?.[0]).toLowerCase()).toBe(
          wallet.address.toLowerCase(),
        );
        const data = JSON.parse(String(params?.[1]));
        data.domain.chainId = Number(data.domain.chainId);
        signatures++;
        return wallet.signTypedData(data);
      }
      throw new Error("Unexpected wallet request: " + method);
    },
  );
  await page.addInitScript(() => {
    (window as any).ethereum = {
      request: (request: unknown) => (window as any).testWalletRequest(request),
      on: () => {},
      removeListener: () => {},
    };
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Compile application", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Deploy locally", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page
    .getByLabel("Agent name", { exact: true })
    .fill("External provider test");
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Public browser test");
  await page.route("**/api/intent", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.intent.owner = "0x" + "99".repeat(20);
    await route.fulfill({ response, json: body });
  });
  await page
    .getByRole("button", { name: "Prepare action", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "differs from reviewed action",
  );
  expect(signatures).toBe(0);
  await page.unroute("**/api/intent");
  let reviewedPayload = "";
  await page.route("**/api/intent", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.intent.expires = Math.floor(Date.now() / 1000) + 3;
    reviewedPayload = body.intent.payload;
    await route.fulfill({ response, json: body });
  });
  await page
    .getByRole("button", { name: "Prepare action", exact: true })
    .click();
  const renew = page.getByRole("button", {
    name: "Refresh expired request",
    exact: true,
  });
  await expect(renew).toBeVisible({ timeout: 6000 });
  expect(signatures).toBe(0);
  await page.unroute("**/api/intent");
  await renew.click();
  await expect(
    page.getByRole("button", { name: "Sign and submit", exact: true }),
  ).toBeEnabled();
  await page.getByText("Full signed intent", { exact: true }).click();
  const intentText = await page
    .getByRole("dialog")
    .locator("details pre")
    .innerText();
  expect(JSON.parse(intentText).payload).toBe(reviewedPayload);
  expect(JSON.parse(intentText).expires).toBeGreaterThan(
    Math.floor(Date.now() / 1000) + 30,
  );
  expect(signatures).toBe(0);
  async function sign(prepared = false) {
    if (!prepared)
      await page
        .getByRole("button", { name: "Prepare action", exact: true })
        .click();
    await page
      .getByRole("button", { name: "Sign and submit", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Execution receipt" }).locator("pre"),
    ).toContainText(wallet.address.toLowerCase());
    await page.getByRole("button", { name: "Close receipt" }).click();
  }
  await sign(true);
  await page
    .getByRole("button", { name: "Publish service", exact: true })
    .click();
  await page.getByLabel("Service title", { exact: true }).fill("Test service");
  await sign();
  await page.getByRole("button", { name: "Write memory", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Public memory", exact: true })
    .fill("Public wallet-signed memory");
  await sign();
  await page
    .getByRole("button", { name: "Update status", exact: true })
    .click();
  await sign();
  expect(signatures).toBe(4);
});
