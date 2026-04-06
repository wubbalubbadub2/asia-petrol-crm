import { describe, it, expect } from "vitest";
import { MONTHS_RU, getQuarterFromMonth } from "@/lib/constants/months-ru";

describe("Russian Months", () => {
  it("has 12 months", () => {
    expect(MONTHS_RU).toHaveLength(12);
  });

  it("starts with январь", () => {
    expect(MONTHS_RU[0]).toBe("январь");
  });

  it("ends with декабрь", () => {
    expect(MONTHS_RU[11]).toBe("декабрь");
  });
});

describe("getQuarterFromMonth", () => {
  it("Q1: январь-март", () => {
    expect(getQuarterFromMonth("январь")).toBe("I кв");
    expect(getQuarterFromMonth("февраль")).toBe("I кв");
    expect(getQuarterFromMonth("март")).toBe("I кв");
  });

  it("Q2: апрель-июнь", () => {
    expect(getQuarterFromMonth("апрель")).toBe("II кв");
    expect(getQuarterFromMonth("май")).toBe("II кв");
    expect(getQuarterFromMonth("июнь")).toBe("II кв");
  });

  it("Q3: июль-сентябрь", () => {
    expect(getQuarterFromMonth("июль")).toBe("III кв");
    expect(getQuarterFromMonth("август")).toBe("III кв");
    expect(getQuarterFromMonth("сентябрь")).toBe("III кв");
  });

  it("Q4: октябрь-декабрь", () => {
    expect(getQuarterFromMonth("октябрь")).toBe("IV кв");
    expect(getQuarterFromMonth("ноябрь")).toBe("IV кв");
    expect(getQuarterFromMonth("декабрь")).toBe("IV кв");
  });

  it("returns empty string for invalid month", () => {
    expect(getQuarterFromMonth("invalid")).toBe("");
    expect(getQuarterFromMonth("")).toBe("");
  });
});
