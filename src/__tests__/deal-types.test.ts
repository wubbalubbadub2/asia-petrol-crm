import { describe, it, expect } from "vitest";
import { DEAL_TYPES, DEAL_TYPE_LABELS, DEAL_TYPE_CURRENCY } from "@/lib/constants/deal-types";

describe("Deal Types", () => {
  it("has 3 deal types", () => {
    expect(DEAL_TYPES).toHaveLength(3);
    expect(DEAL_TYPES).toContain("KG");
    expect(DEAL_TYPES).toContain("KZ");
    expect(DEAL_TYPES).toContain("OIL");
  });

  it("KG is export in USD", () => {
    expect(DEAL_TYPE_LABELS.KG).toContain("Экспорт");
    expect(DEAL_TYPE_CURRENCY.KG).toBe("USD");
  });

  it("KZ is domestic in KZT", () => {
    expect(DEAL_TYPE_LABELS.KZ).toContain("Казахстан");
    expect(DEAL_TYPE_CURRENCY.KZ).toBe("KZT");
  });

  it("OIL is in USD", () => {
    expect(DEAL_TYPE_CURRENCY.OIL).toBe("USD");
  });
});
