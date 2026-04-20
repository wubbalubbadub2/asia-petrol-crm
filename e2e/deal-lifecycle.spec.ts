import { test, expect, type Page } from "@playwright/test";

// End-to-end: create deal → open its detail page → verify the
// computed fields react to edits. The aim is to catch regressions
// in the derived-field and rollup triggers from the front-end side,
// complementing the SQL tests in supabase/tests/.
//
// We don't mint fresh counterparties — the test picks whichever
// active supplier/buyer exist in the target environment. This keeps
// the spec safe to run against any env with seed data.
//
// Skips unless E2E_EMAIL / E2E_PASSWORD are set (same convention as
// smoke.spec.ts) so devs without credentials don't see false reds.

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe("deal lifecycle", () => {
  test.skip(
    !email || !password,
    "E2E_EMAIL / E2E_PASSWORD not set — skipping deal lifecycle spec.",
  );

  async function login(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Пароль").fill(password!);
    await page.getByRole("button", { name: /Войти|Вход/ }).click();
    await expect(page.getByRole("link", { name: /Сделки|Deals/i })).toBeVisible({
      timeout: 15_000,
    });
  }

  test("contracted amount recomputes when price changes", async ({ page }) => {
    await login(page);
    await page.goto("/deals");

    // Pick the first row's deal code link — if there are zero deals the
    // test can't run meaningfully against this env, so assert at least one.
    const firstDealLink = page.locator('a[href*="/deals/"][href$="/"], a[href^="/deals/"]:not([href="/deals/new"])').first();
    await expect(firstDealLink).toBeVisible({ timeout: 15_000 });
    await firstDealLink.click();

    // Deal detail header renders the deal code in mono type.
    await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });

    // Enter edit mode.
    await page.getByRole("button", { name: /Редактировать/ }).click();

    // Edit the supplier_contracted_volume and supplier_price. After blur,
    // supplier_contracted_amount (auto-computed by trigger) should equal
    // volume × price to within rounding.
    const volume = "10";
    const price = "500";

    // The passport section labels these in Russian; we find inputs by
    // their sibling label text.
    const volumeInput = page.locator('label:has-text("Объем контракт") + input, div:has(> span:text-is("Объем контракт")) input').first();
    const priceInput = page.locator('div:has(> span:text-is("Цена")) input').first();

    await volumeInput.fill(volume);
    await volumeInput.blur();
    await priceInput.fill(price);
    await priceInput.blur();

    // Small wait for the optimistic update + server round-trip.
    await page.waitForTimeout(1_500);

    // Re-read the computed field. It's a read-only span (the Field
    // component falls through to plain text when no `field` prop).
    // The label "Сумма по контракту" marks the Поставщик section block.
    const contractedCell = page.locator('div:has(> span:text-is("Сумма по контракту"))').first();
    await expect(contractedCell).toContainText(/5[\s  ]*000/); // 10 × 500 with ru-RU thousand separator
  });

  test("edit mode shows input fields, not plain text", async ({ page }) => {
    await login(page);
    await page.goto("/deals");

    const firstDealLink = page.locator('a[href^="/deals/"]:not([href="/deals/new"])').first();
    await firstDealLink.click();

    await page.getByRole("button", { name: /Редактировать/ }).click();

    // With the refactored Field component, edit mode renders real
    // <input> elements. Confirm at least one input is present in the
    // Поставщик card — proves the affordance fix is live.
    const supplierCard = page.locator('div:has(> div > div:text-is("Поставщик"))').first();
    await expect(supplierCard.locator("input").first()).toBeVisible({ timeout: 5_000 });
  });
});
