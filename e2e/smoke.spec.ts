import { test, expect, type Page } from "@playwright/test";

// End-to-end smoke: the minimum that, if green, proves auth + RLS +
// Supabase connectivity + core page rendering all work together.
// Heavier "create deal → add shipment → verify balance" flow lives in
// a separate spec file once we have stable test fixtures to clean up
// against.
//
// Credentials come from env so the test runs against any environment
// (local dev / staging / production-mirror). The spec is skipped when
// credentials are absent so a dev who hasn't set them up doesn't get
// a red result from unrelated work.

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe("auth + dashboard smoke", () => {
  test.skip(
    !email || !password,
    "E2E_EMAIL / E2E_PASSWORD not set — skipping smoke. " +
    "Create a test Supabase user and export these env vars to enable.",
  );

  async function login(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Пароль").fill(password!);
    await page.getByRole("button", { name: /Войти|Вход/ }).click();
    // Dashboard root has a nav sidebar with these items; any one of them
    // proves the redirect and the dashboard layout loaded.
    await expect(page.getByRole("link", { name: /Сделки|Деaлы|Deals/i })).toBeVisible({ timeout: 15_000 });
  }

  test("unauthenticated user is redirected from a protected route to /login", async ({ page }) => {
    // Use a fresh context — no stored session.
    await page.goto("/deals");
    await expect(page).toHaveURL(/\/login/);
  });

  test("login succeeds and lands on the dashboard", async ({ page }) => {
    await login(page);
    // On the dashboard, the URL should be either / or /deals depending on default.
    expect(page.url()).toMatch(/\/(?:deals)?(?:\?.*)?$/);
  });

  test("deals list renders without Supabase errors", async ({ page }) => {
    await login(page);

    // Capture console errors so a silent RLS rejection or broken query
    // surfaces as a test failure rather than a rendering quirk.
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(String(err.message)));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/deals");
    // The passport table takes a moment to render while data loads — wait
    // for the page header or an empty-state hint.
    await expect(page.getByRole("heading", { name: /Сделки/i })).toBeVisible({ timeout: 15_000 });

    // No uncaught errors should have surfaced during the navigation.
    expect(consoleErrors, consoleErrors.join("\n")).toHaveLength(0);
  });
});
