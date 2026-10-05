// @vitest-environment node
import { describe, it, expect } from "vitest";
import { daysBetween, dealLinkStatus, localToday, UNLINKED_ALERT_DAYS } from "@/lib/applications/deal-link";

// Клиент 2026-10-05: заявка без сделки через 8–9 дней должна быть видна.
describe("dealLinkStatus — заявка без сделки", () => {
  it("порог — 8 дней", () => {
    expect(UNLINKED_ALERT_DAYS).toBe(8);
  });

  it("привязана — без пометки, сколько бы дней ни прошло", () => {
    expect(dealLinkStatus("2026-01-01", 1, "2026-10-05")).toEqual({ kind: "linked" });
  });

  it("7 дней без сделки — ждём, 8 — просрочена", () => {
    expect(dealLinkStatus("2026-09-28", 0, "2026-10-05")).toEqual({ kind: "waiting", days: 7 });
    expect(dealLinkStatus("2026-09-27", 0, "2026-10-05")).toEqual({ kind: "overdue", days: 8 });
  });

  it("дата в будущем — 0 дней, не минус", () => {
    expect(dealLinkStatus("2026-10-10", 0, "2026-10-05")).toEqual({ kind: "waiting", days: 0 });
  });

  it("дни — по календарю, через смену месяца и года", () => {
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(daysBetween("2026-02-27", "2026-03-01")).toBe(2);
    expect(daysBetween("2026-10-05T23:59:00", "2026-10-05")).toBe(0);
  });

  it("localToday — местная дата YYYY-MM-DD", () => {
    expect(localToday(new Date(2026, 9, 5, 23, 30))).toBe("2026-10-05");
  });
});
