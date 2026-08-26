import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { fillTemplateToBytes, inspectTemplate } from "@/lib/transport/fill-template";
import { buildTemplateValues, buildDateLine } from "@/lib/transport/request-values";
import { TEMPLATE_ROWS } from "@/lib/transport/template-rows";

/**
 * Заполнение бланка проверяется на НАСТОЯЩЕМ файле — том самом
 * `public/templates/zayavka-template.docx`, который получают компании.
 * Заполненный документ распаковывается обратно и читается как обычный
 * Word: так видно не «функция отработала», а что в правой колонке
 * действительно стоят нужные значения.
 *
 * Данные взяты из заявки ОРТ от 27.03.2026 — единственного образца,
 * который клиент показал.
 */

const TEMPLATE = join(process.cwd(), "public", "templates", "zayavka-template.docx");

const ORT = {
  date: "2026-03-27",
  fuelName: "Мазут топочный марки М-100",
  tonnage: 455,
  wagons: 7,
  cargoPurpose: "export",
  stationName: "Карабалта",
  stationCode: "715905",
  siding: "",
  carrierName: "АО «КТЖ - Грузовые перевозки»",
  consigneeName: "ОсОО «China Petrol Company «Zhongda»",
  consigneeBin: "01009200910089",
  consigneeCode: "5669",
  consigneeAddress: "г. Кара-Балта Восточная промзона",
  consigneeOkpo: "26737181",
  etsngCode: "221066",
  gngCode: "27101967",
  specialMarks: "",
  consignorName: 'ТОО "RAMCO REFINERY"',
  wagonOwnerName: "ТОО «PTC Operator»",
  kzhPayerName: "ТОО «PTC Operator»",
  krgPayerName: "ОсОО «China Petrol Company «Zhongda»",
  routeText: "Темир (660308) — Турксиб-эксп. (704402) — Карабалта (715905)",
  buyerName: "ОсОО Ойл Ресорсиз Трейдинг",
  periodMonth: 3,
  periodYear: 2026,
};

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** Читает заполненный документ так же, как его прочитает Word. */
async function readBack(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")!.async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");

  const cellText = (tc: Element) =>
    Array.from(tc.getElementsByTagNameNS(W, "t"))
      .map((t) => t.textContent ?? "")
      .join("");

  const rows = new Map<string, { label: string; value: string; breaks: number }>();
  for (const tr of Array.from(doc.getElementsByTagNameNS(W, "tr"))) {
    const cells = Array.from(tr.getElementsByTagNameNS(W, "tc")).filter(
      (tc) => tc.parentNode === tr,
    );
    if (cells.length < 2) continue;
    const label = cellText(cells[0]).trim();
    rows.set(label, {
      label,
      value: cellText(cells[1]).trim(),
      breaks: cells[1].getElementsByTagNameNS(W, "br").length,
    });
  }

  const paragraphs = Array.from(doc.getElementsByTagNameNS(W, "p")).map((p) =>
    Array.from(p.getElementsByTagNameNS(W, "t"))
      .map((t) => t.textContent ?? "")
      .join("")
      .trim(),
  );

  return { rows, paragraphs, zip, xml };
}

let filled: Awaited<ReturnType<typeof readBack>>;
let templateBytes: Uint8Array;

beforeAll(async () => {
  templateBytes = new Uint8Array(readFileSync(TEMPLATE));
  const out = await fillTemplateToBytes(templateBytes, {
    dateLine: buildDateLine(ORT.date),
    values: buildTemplateValues(ORT),
  });
  filled = await readBack(out);
});

describe("бланк до заполнения", () => {
  it("содержит все 19 строк контракта и строку с датой", async () => {
    const info = await inspectTemplate(templateBytes);
    expect(info.missing).toEqual([]);
    expect(info.found).toHaveLength(TEMPLATE_ROWS.length);
    expect(info.hasDateLine).toBe(true);
  });
});

describe("заполненная заявка", () => {
  it("дата составления встала в заголовок с полным годом", () => {
    expect(filled.paragraphs).toContain("Заявка от 27.03.2026 г.");
    // Заглушка даты не осталась. Подчёркивания в блоке подписи —
    // законные: там расписывается директор, их трогать нельзя.
    const dateLines = filled.paragraphs.filter((p) => p.startsWith("Заявка от"));
    expect(dateLines).toEqual(["Заявка от 27.03.2026 г."]);
    expect(filled.paragraphs.some((p) => p.includes("________"))).toBe(true);
  });

  it("количество печатается как в образце ОРТ", () => {
    expect(filled.rows.get("Кол-во в тоннах")?.value).toBe("455 тн (7 вц)");
  });

  it("грузополучатель идёт с ИНН, коды — через запятую", () => {
    expect(filled.rows.get("Грузополучатель")?.value).toBe(
      "ОсОО «China Petrol Company «Zhongda», ИНН 01009200910089",
    );
    expect(filled.rows.get("Код ЕТСНГ, ГНГ")?.value).toBe("221066, 27101967");
  });

  it("две оплаты стоят в одной ячейке двумя строками", () => {
    const cell = filled.rows.get("Экспедитор по ЖД")!;
    expect(cell.breaks).toBe(1);
    expect(cell.value).toContain("Оплата по КЗХ – ТОО «PTC Operator»");
    expect(cell.value).toContain("Оплата по КРГ груженый и порожний пробег:");
  });

  it("остальные строки заполнены значениями заявки", () => {
    const expected: Record<string, string> = {
      "Наименование нефтепродукта": "Мазут топочный марки М-100",
      "Назначение груза": "Экспорт",
      "Станция назначения": "Карабалта",
      "Код станции": "715905",
      "Наименование железной дороги": "АО «КТЖ - Грузовые перевозки»",
      "Код грузополучателя": "5669",
      "Адрес грузополучателя": "г. Кара-Балта Восточная промзона",
      "Код ОКПО получателя": "26737181",
      "Грузоотправитель": 'ТОО "RAMCO REFINERY"',
      "Принадлежность вагонов": "ТОО «PTC Operator»",
      "Маршрут транспортировки": "Темир (660308) — Турксиб-эксп. (704402) — Карабалта (715905)",
      "Покупатель": "ОсОО Ойл Ресорсиз Трейдинг",
      "Период перевозки": "март 2026 г.",
    };
    for (const [label, value] of Object.entries(expected)) {
      expect(filled.rows.get(label)?.value, label).toBe(value);
    }
  });

  it("пустые поля остаются пустыми, а не подставляют чужое", () => {
    expect(filled.rows.get("Тупик")?.value).toBe("");
    expect(filled.rows.get("Особые отметки")?.value).toBe("");
  });

  it("названия строк не тронуты — бланк можно заполнить повторно", () => {
    for (const label of TEMPLATE_ROWS) {
      expect(filled.rows.has(label), label).toBe(true);
    }
  });

  it("шапка компании, подпись и печать остаются из бланка", async () => {
    // Всё, кроме document.xml, обязано доехать байт в байт: там лежат
    // колонтитул с реквизитами, картинка печати и стили.
    const original = await JSZip.loadAsync(templateBytes);
    const names = Object.keys(original.files).filter((n) => !original.files[n].dir);
    expect(names).toContain("word/header1.xml");

    for (const name of names) {
      if (name === "word/document.xml") continue;
      const a = await original.file(name)!.async("string");
      const b = await filled.zip.file(name)!.async("string");
      expect(b, name).toBe(a);
    }
  });
});

describe("повторное заполнение", () => {
  it("заполняет уже заполненный документ, а не дописывает к нему", async () => {
    const once = await fillTemplateToBytes(templateBytes, {
      dateLine: buildDateLine("2026-03-27"),
      values: buildTemplateValues(ORT),
    });
    const twice = await fillTemplateToBytes(once, {
      dateLine: buildDateLine("2026-05-01"),
      values: buildTemplateValues({ ...ORT, tonnage: 300, wagons: 5 }),
    });
    const again = await readBack(twice);
    expect(again.rows.get("Кол-во в тоннах")?.value).toBe("300 тн (5 вц)");
    expect(again.paragraphs).toContain("Заявка от 01.05.2026 г.");
    expect(again.paragraphs.some((p) => p.includes("27.03.2026"))).toBe(false);
  });
});
