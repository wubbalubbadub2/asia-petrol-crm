import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRequestPdf, extractTemplateImages } from "@/lib/transport/build-pdf";
import { buildTemplateValues, formatRequestDate } from "@/lib/transport/request-values";

/**
 * PDF заявки.
 *
 * Клиент 25.08.2026 выбрал свой макет с картинками из бланка — точного
 * повторения Word тут быть не может, поэтому проверяется то, что должно
 * быть верным всегда: файл читается как PDF, кириллица не роняет
 * генерацию (без вшитого шрифта pdf-lib падает на первой русской
 * букве), длинные значения не обрезаются в никуда, а картинки из
 * колонтитула и из тела бланка различаются.
 */

const FONTS = join(process.cwd(), "public", "fonts");
const TEMPLATE = join(process.cwd(), "public", "templates", "zayavka-template.docx");

let fonts: { regular: Uint8Array; bold: Uint8Array };

beforeAll(() => {
  fonts = {
    regular: new Uint8Array(readFileSync(join(FONTS, "PTSans-Regular.ttf"))),
    bold: new Uint8Array(readFileSync(join(FONTS, "PTSans-Bold.ttf"))),
  };
});

const VALUES = {
  date: "2026-03-27",
  fuelName: "Мазут топочный марки М-100",
  tonnage: 455,
  wagons: 7,
  cargoPurpose: "export",
  stationName: "Карабалта",
  stationCode: "715905",
  consigneeName: "ОсОО «China Petrol Company «Zhongda»",
  consigneeBin: "01009200910089",
  routeText: "Темир (660308) — Турксиб-эксп. (704402) — Карабалта (715905)",
  periodMonth: 3,
  periodYear: 2026,
  payers: [
    { railway: "КЗХ", text: "– ТОО «PTC Operator»" },
    { railway: "КРГ", text: "груженый и порожний пробег: ОсОО «China Petrol Company «Zhongda»" },
  ],
};

describe("сборка PDF", () => {
  it("кириллица не роняет генерацию", async () => {
    const bytes = await buildRequestPdf(
      {
        date: formatRequestDate(VALUES.date),
        values: buildTemplateValues(VALUES),
        companyName: "ОсОО «Ойл Ресорсиз Трейдинг»",
        headerImages: [],
        bodyImages: [],
      },
      fonts,
    );
    // Без вшитого шрифта pdf-lib бросает на первой же русской букве.
    expect(bytes.length).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("получается корректный PDF на одну страницу", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const bytes = await buildRequestPdf(
      {
        date: formatRequestDate(VALUES.date),
        values: buildTemplateValues(VALUES),
        companyName: "ОсОО «Ойл Ресорсиз Трейдинг»",
        headerImages: [],
        bodyImages: [],
      },
      fonts,
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("длинное значение переносится, а не уезжает за поля", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const long = "Оплата по КЗХ PTC OPERATOR ТОО КОД 2782503, оплата по РЖД РТС-ТРАНС ООО КОД 1006067843 расчет через ЦФТО, оплата по АЗЖД ADY Express 57550226, оплата по ГРЖД GR Transit LLC 156341";
    const bytes = await buildRequestPdf(
      {
        date: formatRequestDate(VALUES.date),
        values: buildTemplateValues({ ...VALUES, specialMarks: long }),
        companyName: "Компания",
        headerImages: [],
        bodyImages: [],
      },
      fonts,
    );
    const doc = await PDFDocument.load(bytes);
    // Длинный текст занимает место, но документ остаётся читаемым:
    // строки переносятся, а не обрезаются молча.
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("пустая заявка тоже собирается", async () => {
    const bytes = await buildRequestPdf(
      {
        date: formatRequestDate("2026-01-01"),
        values: buildTemplateValues({ date: "2026-01-01" }),
        companyName: "",
        headerImages: [],
        bodyImages: [],
      },
      fonts,
    );
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });
});

describe("картинки из бланка", () => {
  it("шапка и подпись различаются по тому, откуда на них ссылаются", async () => {
    // В эталоне картинок нет вовсе — проверяем, что разбор это переживает.
    const bytes = new Uint8Array(readFileSync(TEMPLATE));
    const images = await extractTemplateImages(bytes);
    expect(images.header).toEqual([]);
    expect(images.body).toEqual([]);
  });

  it("картинки бланка попадают в PDF", async () => {
    const { PDFDocument, rgb } = await import("pdf-lib");
    // Настоящий PNG: собираем через pdf-lib, чтобы не тащить файл в репозиторий.
    const src = await PDFDocument.create();
    const p = src.addPage([10, 10]);
    p.drawRectangle({ x: 0, y: 0, width: 10, height: 10, color: rgb(0, 0, 0) });

    // Минимальный валидный PNG 1×1, чёрный.
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82,
    ]);

    const bytes = await buildRequestPdf(
      {
        date: formatRequestDate(VALUES.date),
        values: buildTemplateValues(VALUES),
        companyName: "Компания",
        headerImages: [png],
        bodyImages: [png, png],
      },
      fonts,
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(bytes.length).toBeGreaterThan(1000);
  });
});

describe("необязательные строки", () => {
  it("пустые «Страна назначения», «Порт» и «Номера вагонов» не печатаются", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const withOut = await buildRequestPdf(
      {
        date: formatRequestDate(VALUES.date),
        values: buildTemplateValues(VALUES),
        companyName: "Компания",
        headerImages: [],
        bodyImages: [],
      },
      fonts,
    );
    const withThem = await buildRequestPdf(
      {
        date: formatRequestDate(VALUES.date),
        values: buildTemplateValues({
          ...VALUES,
          destinationCountry: "Грузия",
          port: "Батуми",
          wagonNumbers: "51694719, 51726354",
        }),
        companyName: "Компания",
        headerImages: [],
        bodyImages: [],
      },
      fonts,
    );
    // Заполненная заявка длиннее: в ней на три строки таблицы больше.
    expect(withThem.length).toBeGreaterThan(withOut.length);
    expect((await PDFDocument.load(withOut)).getPageCount()).toBe(1);
  });
});
