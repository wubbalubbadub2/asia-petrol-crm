import { describe, expect, it } from "vitest";
import {
  defaultManagerId,
  stationCodeOnPick,
  usableStationCode,
} from "@/lib/application-autofill";

describe("usableStationCode", () => {
  it("принимает код из 5–6 цифр", () => {
    expect(usableStationCode("700204")).toBe("700204");
    expect(usableStationCode("66030")).toBe("66030");
    expect(usableStationCode(" 715905 ")).toBe("715905");
  });

  it("отбрасывает мусор и пустое", () => {
    expect(usableStationCode("ст. Серхетабад")).toBeNull();
    expect(usableStationCode("1234")).toBeNull();
    expect(usableStationCode("1234567")).toBeNull();
    expect(usableStationCode("70020a")).toBeNull();
    expect(usableStationCode("")).toBeNull();
    expect(usableStationCode(null)).toBeNull();
    expect(usableStationCode(undefined)).toBeNull();
  });
});

describe("stationCodeOnPick", () => {
  it("подставляет код выбранной станции поверх прежнего", () => {
    expect(stationCodeOnPick("", "700204")).toBe("700204");
    expect(stationCodeOnPick("715905", "700204")).toBe("700204");
  });

  it("без пригодного кода оставляет то, что в поле", () => {
    expect(stationCodeOnPick("123456", "ст. Серхетабад")).toBe("123456");
    expect(stationCodeOnPick("123456", null)).toBe("123456");
    expect(stationCodeOnPick("", undefined)).toBe("");
  });
});

describe("defaultManagerId", () => {
  const managers = [{ id: "u1" }, { id: "u2" }];

  it("текущий пользователь из списка менеджеров", () => {
    expect(defaultManagerId("u2", managers)).toBe("u2");
  });

  it("пусто, если пользователя нет в списке или он не известен", () => {
    expect(defaultManagerId("u3", managers)).toBe("");
    expect(defaultManagerId(null, managers)).toBe("");
    expect(defaultManagerId(undefined, managers)).toBe("");
    expect(defaultManagerId("u1", [])).toBe("");
  });
});
