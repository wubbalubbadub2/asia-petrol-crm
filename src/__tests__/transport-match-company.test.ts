import { describe, it, expect } from "vitest";
import { matchCompany, words } from "@/lib/transport/match-company";

/**
 * Привязка бланка к компании по имени файла.
 *
 * Самое хрупкое место массовой загрузки: ошибётся — и заявка уедет
 * контрагенту на чужом бланке, с чужой печатью. Поэтому проверяется на
 * НАСТОЯЩИХ именах файлов, которые прислал клиент 26.08.2026, и на
 * настоящих названиях компаний из справочника.
 */

const COMPANIES = [
  "CAODL",
  "Progressive oil trading",
  "Singularity Trading",
  "TENGRI WAY",
  "Арқа Проф",
  "Бетта Трейд",
  "ДОТ",
  "ОМИ",
  "ОРТ",
  "АБ Линк",
  "Fuel Supply",
].map((name, i) => ({ id: `id-${i}`, name }));

const of = (file: string) => matchCompany(file, COMPANIES).company?.name ?? null;

describe("файлы, присланные компаниями", () => {
  it("узнаёт компанию в длинном имени заявки", () => {
    expect(of("Заявка 390 тн Тендык-Карабалта от Бетта Трейд от 31.07.docx")).toBe("Бетта Трейд");
    expect(of("заявка от ОМИ на 845 тн 13 вц Актобе-2 - Карабалта.docx")).toBe("ОМИ");
    expect(of("Заявка 4000, Мазут, Жанаозен Карабалта от ДОТ на план ГУ.docx")).toBe("ДОТ");
  });

  it("узнаёт по одному слову, если названия целиком в имени нет", () => {
    // «Singularity Trading» — в имени только «Singularity».
    expect(of("Заявка на ГУ 3300 тн 56 вц Актобе-2 - Батуми Singularity.docx")).toBe(
      "Singularity Trading",
    );
  });

  it("«ОРТ» не путается со словом «транспортировки»", () => {
    // Поиск подстрокой нашёл бы «орт» внутри «транспортировки» и увёл
    // бы чужой файл к ОРТ.
    expect(of("Заявка 9 вц 585 тн мазут, Жинишке -Карабалта от ОРТ на разметку.docx")).toBe("ОРТ");
    expect(of("Схема транспортировки грузов.docx")).toBeNull();
  });
});

describe("бланки, собранные нами", () => {
  it("узнаёт компанию по имени вида «Бланк заявки — …»", () => {
    expect(of("Бланк заявки — CAODL.docx")).toBe("CAODL");
    expect(of("Бланк заявки — TENGRI WAY.docx")).toBe("TENGRI WAY");
    expect(of("Бланк заявки — Арқа Проф.docx")).toBe("Арқа Проф");
    expect(of("Бланк заявки — Fuel Supply.docx")).toBe("Fuel Supply");
    expect(of("Бланк заявки — АБ Линк.docx")).toBe("АБ Линк");
    expect(of("Бланк заявки — ДОТ.docx")).toBe("ДОТ");
  });

  it("«Progressive oil trading» выигрывает у «Singularity Trading» по числу слов", () => {
    expect(of("Бланк заявки — Progressive oil trading.docx")).toBe("Progressive oil trading");
  });
});

describe("когда угадывать нельзя", () => {
  it("одно общее слово у двух компаний — отказ, а не выбор наугад", () => {
    const m = matchCompany("Заявка Trading 2026.docx", COMPANIES);
    expect(m.company).toBeNull();
    expect(m.reason).toContain("подходят несколько");
  });

  it("названия компании в имени нет — отказ", () => {
    const m = matchCompany("Заявка 500 тн Карабалта.docx", COMPANIES);
    expect(m.company).toBeNull();
    expect(m.reason).toContain("нет");
  });
});

describe("разбор на слова", () => {
  it("режет по любым разделителям и не теряет кириллицу с қ", () => {
    expect(words("Бланк заявки — Арқа Проф.docx")).toEqual([
      "бланк", "заявки", "арқа", "проф", "docx",
    ]);
  });

  it("разложенный юникод из macOS считается тем же словом", () => {
    // «й» в именах файлов macOS хранит как «и» + значок краткости.
    const nfd = "Фьюл Саплай".normalize("NFD");
    expect(words(nfd)).toEqual(words("Фьюл Саплай"));
  });
});
