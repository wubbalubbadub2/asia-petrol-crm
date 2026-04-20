import { test, expect, type Page } from "@playwright/test";

// End-to-end: paste ~20 wagon rows into the registry bulk-add dialog
// and confirm the preview reports 20 valid rows.
//
// Skips when credentials aren't present. Does not actually persist
// rows to the DB — we stop at the preview state to keep the test
// environment clean. Persistence is covered by the SQL trigger tests.

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe("bulk-paste preview", () => {
  test.skip(
    !email || !password,
    "E2E_EMAIL / E2E_PASSWORD not set — skipping bulk-paste spec.",
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

  // Generate 20 synthetic lines in the parser's preferred format:
  // wagon\tvolume\tdate, with a mix of comma/dot decimals so the
  // parser's numeric-format tolerance is exercised.
  function buildPaste(n: number): string {
    const lines: string[] = [];
    for (let i = 0; i < n; i++) {
      const wagon = String(51_700_000 + i);
      const volume = (54 + (i % 3) * 0.1).toFixed(3).replace(".", i % 2 === 0 ? "," : ".");
      const day = String((i % 28) + 1).padStart(2, "0");
      lines.push(`${wagon}\t${volume}\t${day}.01.2026`);
    }
    return lines.join("\n");
  }

  test("parser reports 20 valid rows from a 20-line paste", async ({ page }) => {
    await login(page);
    await page.goto("/registry");

    // The bulk-add button only appears inside a registry group that
    // already exists. Fail informatively if there are no groups —
    // this spec needs at least one to click into.
    const bulkButton = page.getByRole("button", { name: /Массово/i }).first();
    await expect(bulkButton, "registry needs at least one group for bulk-paste").toBeVisible({
      timeout: 10_000,
    });
    await bulkButton.click();

    // Dialog opens with a textarea we can paste into.
    const textarea = page.getByPlaceholder(/51742534/);
    await expect(textarea).toBeVisible();
    await textarea.fill(buildPaste(20));

    // Preview header shows "Предпросмотр (N строк)" + valid count.
    await expect(page.getByText(/валидных:\s*20/i)).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText(/с ошибками:\s*0/i)).toBeVisible();
  });

  test("parser surfaces errors for bad dates but keeps valid rows", async ({ page }) => {
    await login(page);
    await page.goto("/registry");

    const bulkButton = page.getByRole("button", { name: /Массово/i }).first();
    await bulkButton.click();

    const textarea = page.getByPlaceholder(/51742534/);
    // Three good rows + one with an impossible date (32.13.2026).
    const pasteWithError = [
      "51742534\t54,719\t15.01.2026",
      "51742535\t54,719\t16.01.2026",
      "51742536\t54,719\t32.13.2026",   // bad date — parser must flag
      "51742537\t54,719\t17.01.2026",
    ].join("\n");
    await textarea.fill(pasteWithError);

    await expect(page.getByText(/валидных:\s*3/i)).toBeVisible();
    await expect(page.getByText(/с ошибками:\s*1/i)).toBeVisible();

    // Save button label advertises that error rows will be skipped —
    // proves the UX change from the recent bulk-add fix is live.
    await expect(page.getByRole("button", { name: /пропустим/i })).toBeVisible();
  });
});
