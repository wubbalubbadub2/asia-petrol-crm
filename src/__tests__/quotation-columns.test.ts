import { describe, it, expect } from "vitest";
import { getColumnsForProduct } from "@/lib/constants/quotation-columns";

describe("Quotation Column Mapping", () => {
  it("ГАЗОЙЛЬ 0,1% gets full 4-column layout", () => {
    const cols = getColumnsForProduct("ГАЗОЙЛЬ 0,1%");
    expect(cols).toHaveLength(4);
    expect(cols[0].label).toContain("CIF NWE");
    expect(cols[1].label).toContain("FOB MED");
    expect(cols[2].label).toContain("FOB Rotterdam");
    expect(cols[3].label).toContain("Среднее");
    expect(cols[3].editable).toBe(false);
    expect(cols[3].formula).toBe("avg");
  });

  it("ВГО 0,5-0,6% gets cargo/barge 3-column layout", () => {
    const cols = getColumnsForProduct("ВГО 0,5-0,6%");
    expect(cols).toHaveLength(3);
    expect(cols[0].label).toContain("CIF NWE Cargo");
    expect(cols[1].label).toContain("FOB Rotterdam barge");
    expect(cols[2].formula).toBe("avg");
  });

  it("ВГО 2% also gets cargo/barge layout", () => {
    const cols = getColumnsForProduct("ВГО 2%");
    expect(cols).toHaveLength(3);
  });

  it("Eurobob gets single FOB Rotterdam column", () => {
    const cols = getColumnsForProduct("Eurobob");
    expect(cols).toHaveLength(1);
    expect(cols[0].label).toContain("FOB Rotterdam");
    expect(cols[0].editable).toBe(true);
  });

  it("Prem Unl 10 ppm gets single FOB MED column", () => {
    const cols = getColumnsForProduct("Prem Unl 10 ppm");
    expect(cols).toHaveLength(1);
    expect(cols[0].label).toContain("FOB MED");
  });

  it("BRENT DTD (Platts) gets мин/макс/сред layout", () => {
    const cols = getColumnsForProduct("BRENT DTD (Platts)");
    expect(cols).toHaveLength(3);
    expect(cols[0].label).toBe("мин");
    expect(cols[1].label).toBe("макс");
    expect(cols[2].label).toBe("сред");
    expect(cols[2].formula).toBe("avg");
  });

  it("НАФТА gets full 4-column layout", () => {
    const cols = getColumnsForProduct("НАФТА");
    expect(cols).toHaveLength(4);
  });

  it("Jet gets full 4-column layout", () => {
    const cols = getColumnsForProduct("Jet");
    expect(cols).toHaveLength(4);
  });

  it("ULSD 10 ppm gets CIF + FOB MED (2 columns)", () => {
    const cols = getColumnsForProduct("ULSD 10 ppm");
    expect(cols).toHaveLength(2);
  });

  it("МАЗУТ 1,0% FOB NWE gets single FOB NWE column", () => {
    const cols = getColumnsForProduct("МАЗУТ 1,0% FOB NWE");
    expect(cols).toHaveLength(1);
    expect(cols[0].label).toContain("FOB NWE");
  });

  it("МАЗУТ 0,5% Marine Fuel gets single column", () => {
    const cols = getColumnsForProduct("МАЗУТ 0,5% Marine Fuel");
    expect(cols).toHaveLength(1);
  });

  it("unknown product gets default full layout", () => {
    const cols = getColumnsForProduct("Новый продукт");
    expect(cols).toHaveLength(4);
  });

  it("all editable columns have editable=true", () => {
    const cols = getColumnsForProduct("ГАЗОЙЛЬ 0,1%");
    const editables = cols.filter((c) => c.editable);
    expect(editables.length).toBeGreaterThan(0);
    editables.forEach((c) => {
      expect(c.formula).toBeUndefined();
    });
  });

  it("formula columns have editable=false", () => {
    const cols = getColumnsForProduct("ГАЗОЙЛЬ 0,1%");
    const formulas = cols.filter((c) => c.formula);
    formulas.forEach((c) => {
      expect(c.editable).toBe(false);
    });
  });
});
