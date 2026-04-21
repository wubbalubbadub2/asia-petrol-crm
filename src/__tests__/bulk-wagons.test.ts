import { describe, it, expect } from "vitest";
import { parseBulkWagons } from "@/lib/parsers/bulk-wagons";

describe("parseBulkWagons", () => {
  describe("empty and trivial input", () => {
    it("returns [] for empty string", () => {
      expect(parseBulkWagons("")).toEqual([]);
    });

    it("returns [] for whitespace-only string", () => {
      expect(parseBulkWagons("   \n\n  \t  \n")).toEqual([]);
    });

    it("parses a single wagon number alone", () => {
      const rows = parseBulkWagons("51742534");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ wagon: "51742534", volume: null, date: null, waybill: null });
    });
  });

  describe("tab-separated Excel paste", () => {
    it("parses wagon + volume", () => {
      const rows = parseBulkWagons("51742534\t54.719");
      expect(rows).toEqual([{ wagon: "51742534", volume: 54.719, date: null, waybill: null }]);
    });

    it("accepts comma as decimal separator (Russian locale)", () => {
      const rows = parseBulkWagons("51742534\t54,719");
      expect(rows[0].volume).toBe(54.719);
    });

    it("parses wagon + volume + DD.MM.YYYY date", () => {
      const rows = parseBulkWagons("51742534\t54,719\t05.11.2025");
      expect(rows).toEqual([
        { wagon: "51742534", volume: 54.719, date: "2025-11-05", waybill: null },
      ]);
    });

    it("parses DD/MM/YYYY date", () => {
      const rows = parseBulkWagons("51742534\t54.719\t05/11/2025");
      expect(rows[0].date).toBe("2025-11-05");
    });

    it("parses ISO date", () => {
      const rows = parseBulkWagons("51742534\t54.719\t2025-11-05");
      expect(rows[0].date).toBe("2025-11-05");
    });

    it("zero-pads day and month on DD.MM.YYYY", () => {
      const rows = parseBulkWagons("51742534\t54.719\t5.1.2025");
      expect(rows[0].date).toBe("2025-01-05");
    });

    it("expands 2-digit year to 20xx", () => {
      const rows = parseBulkWagons("51742534\t54.719\t05.11.25");
      expect(rows[0].date).toBe("2025-11-05");
    });

    it("parses wagon + volume + date + waybill #", () => {
      const rows = parseBulkWagons("51742534\t54,719\t05.11.2025\tЭД0012345");
      expect(rows[0]).toEqual({
        wagon: "51742534",
        volume: 54.719,
        date: "2025-11-05",
        waybill: "ЭД0012345",
      });
    });

    it("waybill is null when 4th column is missing", () => {
      const rows = parseBulkWagons("51742534\t54,719\t05.11.2025");
      expect(rows[0].waybill).toBeNull();
    });
  });

  describe("multiple rows", () => {
    it("parses a three-row block", () => {
      const input = [
        "51742534\t54.719",
        "51667558\t54.719",
        "75040170\t54.719",
      ].join("\n");
      const rows = parseBulkWagons(input);
      expect(rows.map((r) => r.wagon)).toEqual(["51742534", "51667558", "75040170"]);
      expect(rows.every((r) => r.volume === 54.719)).toBe(true);
    });

    it("skips empty lines between rows", () => {
      const rows = parseBulkWagons("51742534\t54.719\n\n\n51667558\t54.719\n");
      expect(rows).toHaveLength(2);
    });

    it("trims whitespace on each cell", () => {
      const rows = parseBulkWagons("  51742534  \t  54.719  ");
      expect(rows[0]).toEqual({ wagon: "51742534", volume: 54.719, date: null, waybill: null });
    });

    it("preserves leading zeros in wagon numbers", () => {
      const rows = parseBulkWagons("00012345\t10");
      expect(rows[0].wagon).toBe("00012345");
    });
  });

  describe("header row auto-skip", () => {
    it("skips a header row that starts with non-numeric text", () => {
      const input = [
        "№ вагона\tОбъем",
        "51742534\t54.719",
        "51667558\t54.719",
      ].join("\n");
      const rows = parseBulkWagons(input);
      expect(rows).toHaveLength(2);
      expect(rows[0].wagon).toBe("51742534");
    });

    it("does NOT skip a row that starts with a digit", () => {
      const input = "51742534\t54.719\n51667558\t54.719";
      const rows = parseBulkWagons(input);
      expect(rows).toHaveLength(2);
    });

    it("skips Latin-alphabet headers too", () => {
      const rows = parseBulkWagons("Wagon\tVolume\n51742534\t54.719");
      expect(rows).toHaveLength(1);
    });
  });

  describe("whitespace-separated fallback", () => {
    it("splits on 2+ spaces when no tabs present", () => {
      const rows = parseBulkWagons("51742534   54.719");
      expect(rows[0].wagon).toBe("51742534");
      expect(rows[0].volume).toBe(54.719);
    });

    it("splits on single whitespace as last resort", () => {
      const rows = parseBulkWagons("51742534 54.719");
      expect(rows[0].wagon).toBe("51742534");
      expect(rows[0].volume).toBe(54.719);
    });
  });

  describe("error reporting", () => {
    it("reports unparseable volume", () => {
      const rows = parseBulkWagons("51742534\tNotANumber");
      expect(rows[0].wagon).toBe("51742534");
      expect(rows[0].volume).toBeNull();
      expect(rows[0].error).toMatch(/объ/i);
    });

    it("reports invalid date", () => {
      const rows = parseBulkWagons("51742534\t54.719\t32.13.2025");
      expect(rows[0].date).toBeNull();
      expect(rows[0].error).toMatch(/даты/i);
    });

    it("valid rows among invalid still parse correctly", () => {
      const input = [
        "51742534\t54.719",
        "bad_wagon\tbad_vol",
        "51667558\t54.719",
      ].join("\n");
      const rows = parseBulkWagons(input);
      expect(rows).toHaveLength(3);
      expect(rows[0].error).toBeUndefined();
      expect(rows[1].error).toBeDefined();
      expect(rows[2].error).toBeUndefined();
    });
  });

  describe("realistic Excel paste from Russian user", () => {
    it("handles the full example from the user's workflow", () => {
      const input = [
        "№ вагона\tОбъем\tДата",
        "51742534\t54,719\t05.11.2025",
        "51667558\t54,719\t05.11.2025",
        "75040170\t54,719\t05.11.2025",
        "76752823\t54,719\t05.11.2025",
      ].join("\n");
      const rows = parseBulkWagons(input);
      expect(rows).toHaveLength(4);
      expect(rows.every((r) => r.volume === 54.719)).toBe(true);
      expect(rows.every((r) => r.date === "2025-11-05")).toBe(true);
      expect(rows.every((r) => !r.error)).toBe(true);
    });
  });
});
