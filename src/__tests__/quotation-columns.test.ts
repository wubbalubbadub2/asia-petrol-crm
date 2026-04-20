import { describe, it, expect } from "vitest";
import { getColumnsForProduct } from "@/lib/constants/quotation-columns";

// Each preset appends a "Комментарии" column; FULL additionally has a
// standalone CIF NWE column. Counts reflect the current config.

describe("Quotation Column Mapping", () => {
  it("ГАЗОЙЛЬ 0,1% gets full layout (5 prices + comment)", () => {
    const cols = getColumnsForProduct("ГАЗОЙЛЬ 0,1%");
    expect(cols).toHaveLength(6);
    expect(cols[0].label).toContain("CIF NWE");
    expect(cols[1].label).toContain("FOB MED");
    expect(cols[2].label).toContain("FOB Rotterdam");
    expect(cols[3].label).toContain("Среднее");
    expect(cols[3].editable).toBe(false);
    expect(cols[3].formula).toBe("avg");
    expect(cols[5].key).toBe("comment");
  });

  it("ВГО 0,5-0,6% gets cargo/barge layout (2 prices + avg + comment)", () => {
    const cols = getColumnsForProduct("ВГО 0,5-0,6%");
    expect(cols).toHaveLength(4);
    expect(cols[0].label).toContain("CIF NWE Cargo");
    expect(cols[1].label).toContain("FOB Rotterdam barge");
    expect(cols[2].formula).toBe("avg");
    expect(cols[3].key).toBe("comment");
  });

  it("ВГО 2% also gets cargo/barge layout", () => {
    const cols = getColumnsForProduct("ВГО 2%");
    expect(cols).toHaveLength(4);
  });

  it("Eurobob gets FOB Rotterdam + comment", () => {
    const cols = getColumnsForProduct("Eurobob");
    expect(cols).toHaveLength(2);
    expect(cols[0].label).toContain("FOB Rotterdam");
    expect(cols[0].editable).toBe(true);
    expect(cols[1].key).toBe("comment");
  });

  it("Prem Unl 10 ppm gets FOB MED + comment", () => {
    const cols = getColumnsForProduct("Prem Unl 10 ppm");
    expect(cols).toHaveLength(2);
    expect(cols[0].label).toContain("FOB MED");
    expect(cols[1].key).toBe("comment");
  });

  it("BRENT DTD (Platts) gets мин/макс/сред + comment", () => {
    const cols = getColumnsForProduct("BRENT DTD (Platts)");
    expect(cols).toHaveLength(4);
    expect(cols[0].label).toBe("мин");
    expect(cols[1].label).toBe("макс");
    expect(cols[2].label).toBe("сред");
    expect(cols[2].formula).toBe("avg");
    expect(cols[3].key).toBe("comment");
  });

  it("НАФТА gets full layout", () => {
    const cols = getColumnsForProduct("НАФТА");
    expect(cols).toHaveLength(6);
  });

  it("Jet gets full layout", () => {
    const cols = getColumnsForProduct("Jet");
    expect(cols).toHaveLength(6);
  });

  it("ULSD 10 ppm gets CIF + FOB MED + comment", () => {
    const cols = getColumnsForProduct("ULSD 10 ppm");
    expect(cols).toHaveLength(3);
  });

  it("МАЗУТ 1,0% FOB NWE gets FOB NWE + comment", () => {
    const cols = getColumnsForProduct("МАЗУТ 1,0% FOB NWE");
    expect(cols).toHaveLength(2);
    expect(cols[0].label).toContain("FOB NWE");
  });

  it("МАЗУТ 0,5% Marine Fuel gets single price + comment", () => {
    const cols = getColumnsForProduct("МАЗУТ 0,5% Marine Fuel");
    expect(cols).toHaveLength(2);
  });

  it("unknown product gets default full layout", () => {
    const cols = getColumnsForProduct("Новый продукт");
    expect(cols).toHaveLength(6);
  });

  it("all editable columns never have a formula", () => {
    const cols = getColumnsForProduct("ГАЗОЙЛЬ 0,1%");
    const editables = cols.filter((c) => c.editable);
    expect(editables.length).toBeGreaterThan(0);
    editables.forEach((c) => {
      expect(c.formula).toBeUndefined();
    });
  });

  it("all formula columns are read-only", () => {
    const cols = getColumnsForProduct("ГАЗОЙЛЬ 0,1%");
    const formulas = cols.filter((c) => c.formula);
    formulas.forEach((c) => {
      expect(c.editable).toBe(false);
    });
  });
});
