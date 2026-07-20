import { describe, it, expect } from "vitest";
import { groupFlows, type FlowRow } from "@/lib/hooks/use-fx-reports";

const rows: FlowRow[] = [
  { metric: "supply_in", deal_type: "KG", year: 2026, month: 6, usd: 100, kzt: 48000 },
  { metric: "supply_in", deal_type: "KZ", year: 2026, month: 6, usd: 50, kzt: 24000 },
  { metric: "pay_buyer", deal_type: "KG", year: 2026, month: 7, usd: 10, kzt: 4800 },
];

describe("groupFlows", () => {
  it("группирует по метрике и считает итоги", () => {
    const g = groupFlows(rows);
    expect(g.byMetric.supply_in).toHaveLength(2);
    expect(g.totals.supply_in).toEqual({ usd: 150, kzt: 72000 });
    expect(g.totals.pay_buyer).toEqual({ usd: 10, kzt: 4800 });
  });
});
