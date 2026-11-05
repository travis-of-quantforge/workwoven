import { test, expect } from "@playwright/test";
test("unconfigured installation gives an honest setup path", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A shared place to move work forward." }),
  ).toBeVisible();
  await expect(page.getByText("Connect your workspace")).toBeVisible();
  await expect(page.locator("header")).toHaveCSS("display", "flex");
  expect(
    await page
      .locator("header")
      .evaluate((el) => el.getBoundingClientRect().left),
  ).toBeGreaterThan(15);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.getByRole("link", { name: "Sign in to create" })).toHaveCSS(
    "color",
    "rgb(255, 255, 255)",
  );
  await page.getByRole("link", { name: "Sign in to create" }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeDisabled();
});
