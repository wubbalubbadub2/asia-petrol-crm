import { describe, it, expect } from "vitest";
import { parseSNT, worksheetToCellMap } from "@/lib/parsers/snt-parser";

// The 1C СНТ Excel export has quirks that the parser has to absorb:
// numbers come in with comma decimals, blank rows are sprinkled
// through the goods table, and supplier/receiver positions drift
// between templates (N28 vs B28 vs AD40). These tests lock the
// behaviour we want before anyone refactors the parser.

describe("parseSNT", () => {
  it("extracts header + single goods row + totals", () => {
    const result = parseSNT({
      A5: "СНТ-2026-00123",
      G5: "ИС-999-2026",
      A8: "15.01.2026",
      G8: "15.01.2026 10:23",
      N28: "BIN-111",
      N29: "ООО Поставщик",
      BC28: "BIN-222",
      BC29: "АО Покупатель",
      G70: "Дизтопливо ТС Л-0,05-62",
      Q70: "2710192100",
      W70: "тонна",
      AB70: "54,719",
      AI70: "500",
      AK70: 25_000,
      BA70: "12",
      BC70: 3_000,
      BE70: 28_000,
      // Totals land outside the goods scan window (70-90) so they
      // don't register as a second goods row when the G column is
      // blank there — the parser's known quirk worth noting.
      A92: "Всего",
      AB92: "54,719",
      BE92: 28_000,
    });

    expect(result.snt_number).toBe("СНТ-2026-00123");
    expect(result.registration_number).toBe("ИС-999-2026");
    expect(result.shipment_date).toBe("15.01.2026");
    expect(result.supplier_bin).toBe("BIN-111");
    expect(result.supplier_name).toBe("ООО Поставщик");
    expect(result.receiver_bin).toBe("BIN-222");
    expect(result.receiver_name).toBe("АО Покупатель");

    expect(result.goods).toHaveLength(1);
    expect(result.goods[0].description).toBe("Дизтопливо ТС Л-0,05-62");
    expect(result.goods[0].quantity).toBe(54.719);
    expect(result.goods[0].total_with_tax).toBe(28_000);

    // Totals row is preferred over the fallback sum.
    expect(result.total_quantity).toBe(54.719);
    expect(result.total_amount).toBe(28_000);
  });

  it("falls back on supplier/receiver position variants", () => {
    // No N28 → should try B28.
    const result = parseSNT({
      A5: "СНТ-1",
      B28: "BIN-333",
      B29: "Alt-position Supplier",
      AD40: "BIN-444",
      AD41: "Alt-position Receiver",
    });

    expect(result.supplier_bin).toBe("BIN-333");
    expect(result.supplier_name).toBe("Alt-position Supplier");
    expect(result.receiver_bin).toBe("BIN-444");
    expect(result.receiver_name).toBe("Alt-position Receiver");
  });

  it("skips header/footer junk rows inside the goods table", () => {
    const result = parseSNT({
      A5: "СНТ-2",
      G70: "№ п/п",               // header row — skip
      G71: "Признак происхождения", // Column header row — skip
      G72: "Дизтопливо",
      AB72: 10,
      G73: "Всего по разделу",    // footer row — skip
    });

    expect(result.goods).toHaveLength(1);
    expect(result.goods[0].description).toBe("Дизтопливо");
  });

  it("computes totals from goods when the explicit totals row is missing", () => {
    const result = parseSNT({
      A5: "СНТ-3",
      G70: "Бензин АИ-92",
      AB70: 10,
      BE70: 5_000,
      G71: "Бензин АИ-95",
      AB71: 15,
      BE71: 8_000,
    });

    expect(result.total_quantity).toBe(25);
    expect(result.total_amount).toBe(13_000);
  });

  it("parses comma-decimal numbers and whitespace in numeric cells", () => {
    const result = parseSNT({
      A5: "СНТ-4",
      G70: "Dieselfuel",
      AB70: "1 234,56",   // Russian formatting: space thousands, comma decimal
      AI70: "500.25",
    });

    expect(result.goods[0].quantity).toBe(1234.56);
    expect(result.goods[0].price_per_unit).toBe(500.25);
  });

  it("returns nulls for an empty sheet rather than throwing", () => {
    const result = parseSNT({});
    expect(result.snt_number).toBeNull();
    expect(result.goods).toEqual([]);
    expect(result.total_quantity).toBeNull();
    expect(result.total_amount).toBeNull();
  });
});

describe("worksheetToCellMap", () => {
  it("flattens an xlsx worksheet into an { addr: value } map", () => {
    const map = worksheetToCellMap({
      A5:   { v: "СНТ-1", w: "СНТ-1" },
      AB70: { v: 54.719,  w: "54,719" }, // w is preferred so comma formatting survives
      "!ref": { v: "A1:Z100" },            // metadata — must be skipped
    });

    expect(map).toEqual({
      A5: "СНТ-1",
      AB70: "54,719",
    });
    expect(map["!ref"]).toBeUndefined();
  });

  it("falls back to numeric v when w is missing", () => {
    const map = worksheetToCellMap({
      X1: { v: 42 },
    });
    expect(map.X1).toBe(42);
  });
});
