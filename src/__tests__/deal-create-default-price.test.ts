import { describe, it, expect } from "vitest";
import { EMPTY_VARIANT, variantDraftToLinePatch } from "@/components/deals/deal-create-variants";
import { requiresQuotationType } from "@/lib/deals/price-validation";

// Менеджеры 2026-09-30: «по умолчанию поставить Цену фикс/Вручную».
describe("новая сделка — тип цены по умолчанию", () => {
  it("«Фикс / Вручную», котировка не требуется", () => {
    const patch = variantDraftToLinePatch({ ...EMPTY_VARIANT });
    expect(patch.price_condition).toBe("manual");
    expect(requiresQuotationType(patch.price_condition, patch.trigger_basis)).toBe(false);
  });
});
