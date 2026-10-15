import { test, expect } from "@playwright/test";
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
  if (await deploy.isEnabled()) await deploy.click();
  await page
    .getByRole("button", { name: "Use demo signer", exact: true })
    .click();
  await page.getByLabel("Agent name", { exact: true }).fill("Atlas Research");
  await page
    .getByLabel("Description", { exact: true })
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
    .getByLabel("Public memory", { exact: true })
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
