import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { inspectTemplate, fillTemplateToBytes } from "@/lib/transport/fill-template";
import { buildTemplateValues, formatRequestDate } from "@/lib/transport/request-values";

/**
 * Бланки у компаний РАЗНЫЕ.
 *
 * 26.08.2026 клиент прислал пять настоящих заявок — от ОРТ, Бетта
 * Трейд, ОМИ, Singularity и ДОТ. Разбор показал, что одинаковых среди
 * них нет:
 *
 *   • «Покупатель» есть только у Бетта Трейд, у остальных строки нет;
 *   • у Бетта Трейд и Singularity дата стоит как «Дата 31.07.2026 г.»
 *     отдельной строкой, а слово «Заявка» — самостоятельным заголовком
 *     ниже; у ОРТ и ОМИ — привычное «Заявка от 26.08.2026 г.»;
 *   • в заявке на план ГУ вместо «Период перевозки» — «Месяц
 *     отгрузки», зато добавлены «Страна назначения» и «Порт»;
 *   • у ОМИ добавлена строка «Номера вагонов-цистерн».
 *
 * Первая редакция проверки требовала все 19 строк и умела только
 * «Заявка от …», то есть НЕ ПРИНЯЛА БЫ НИ ОДИН из настоящих бланков.
 *
 * Сами файлы в репозиторий не кладём: в них вшиты печати и подписи
 * компаний. Вместо этого собираем те же формы из эталонного бланка —
 * проверяется ровно то поведение, на котором первая редакция ломалась.
 */

const TEMPLATE = join(process.cwd(), "public", "templates", "zayavka-template.docx");
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function base(): Uint8Array {
  return new Uint8Array(readFileSync(TEMPLATE));
}

/** Копия бланка с правкой текста внутри document.xml. */
async function variant(mutate: (xml: string) => string): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(base());
  const xml = await zip.file("word/document.xml")!.async("string");
  zip.file("word/document.xml", mutate(xml));
  return zip.generateAsync({ type: "uint8array" });
}

/** Убрать строку таблицы с этим названием в левой колонке. */
function dropRow(xml: string, label: string): string {
  const rows = xml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? [];
  const victim = rows.find((r) => r.includes(`>${label}<`));
  if (!victim) throw new Error(`строка «${label}» в эталоне не найдена`);
  return xml.replace(victim, "");
}

async function readRows(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")!.async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const cellText = (tc: Element) =>
    Array.from(tc.getElementsByTagNameNS(W, "t")).map((t) => t.textContent ?? "").join("").trim();

  const rows = new Map<string, string>();
  for (const tr of Array.from(doc.getElementsByTagNameNS(W, "tr"))) {
    const cells = Array.from(tr.getElementsByTagNameNS(W, "tc")).filter((tc) => tc.parentNode === tr);
    if (cells.length < 2) continue;
    rows.set(cellText(cells[0]), cellText(cells[1]));
  }
  const paragraphs = Array.from(doc.getElementsByTagNameNS(W, "p")).map((p) =>
    Array.from(p.getElementsByTagNameNS(W, "t")).map((t) => t.textContent ?? "").join("").trim(),
  );
  return { rows, paragraphs };
}

const VALUES = {
  date: "2026-09-01",
  fuelName: "Мазут топочный марки М-100",
  tonnage: 390,
  wagons: 6,
  cargoPurpose: "export",
  periodMonth: 8,
  periodYear: 2026,
  buyerName: "ОсОО Бетта Трейд",
};

describe("бланк без строки «Покупатель» — как у ОРТ, ОМИ и Singularity", () => {
  it("принимается: строка необязательная", async () => {
    const info = await inspectTemplate(await variant((x) => dropRow(x, "Покупатель")));
    expect(info.missingRequired).toEqual([]);
    expect(info.missing).toEqual(["Покупатель"]);
    expect(info.found).toHaveLength(18);
  });

  it("заполняется без неё, остальные строки на месте", async () => {
    const filled = await fillTemplateToBytes(await variant((x) => dropRow(x, "Покупатель")), {
      date: formatRequestDate(VALUES.date),
      values: buildTemplateValues(VALUES),
    });
    const { rows } = await readRows(filled);
    expect(rows.has("Покупатель")).toBe(false);
    expect(rows.get("Кол-во в тоннах")).toBe("390 тн (6 вц)");
  });
});

describe("бланк с датой в виде «Дата …» — как у Бетта Трейд и Singularity", () => {
  const asDataLine = (x: string) => x.replace("Заявка от ____________ г.", "Дата ____________ г.");

  it("строка с датой находится", async () => {
    const info = await inspectTemplate(await variant(asDataLine));
    expect(info.hasDateLine).toBe(true);
  });

  it("подпись строки сохраняется, меняется только дата", async () => {
    const filled = await fillTemplateToBytes(await variant(asDataLine), {
      date: formatRequestDate(VALUES.date),
      values: buildTemplateValues(VALUES),
    });
    const { paragraphs } = await readRows(filled);
    // Не «Заявка от 01.09.2026 г.» — бланк компании пишет иначе.
    expect(paragraphs).toContain("Дата 01.09.2026 г.");
    expect(paragraphs.some((p) => p.startsWith("Заявка от"))).toBe(false);
  });
});

describe("«Месяц отгрузки» — как в заявке на план ГУ", () => {
  const renamed = (x: string) => x.replace(">Период перевозки<", ">Месяц отгрузки<");

  it("считается той же строкой, что «Период перевозки»", async () => {
    const info = await inspectTemplate(await variant(renamed));
    expect(info.missing).toEqual([]);
    expect(info.extra).toEqual([]);
  });

  it("период попадает в неё", async () => {
    const filled = await fillTemplateToBytes(await variant(renamed), {
      date: formatRequestDate(VALUES.date),
      values: buildTemplateValues(VALUES),
    });
    const { rows } = await readRows(filled);
    expect(rows.get("Месяц отгрузки")).toBe("Август 2026 г.");
  });
});

describe("строки, которых нет в контракте", () => {
  it("перечисляются как «останутся как есть» и не мешают приёму", async () => {
    // Строка, которой система не знает вовсе. «Страна назначения» и
    // «Порт» лишними больше НЕ считаются: их мы умеем заполнять.
    const info = await inspectTemplate(
      await variant((x) => x.replace(">Особые отметки<", ">Примечание перевозчика<")),
    );
    expect(info.missingRequired).toEqual([]);
    expect(info.extra).toEqual(["Примечание перевозчика"]);
    expect(info.missing).toEqual(["Особые отметки"]);
  });

  it("их содержимое не затирается при заполнении", async () => {
    const bytes = await variant((x) => x.replace(">Особые отметки<", ">Примечание перевозчика<"));
    const filled = await fillTemplateToBytes(bytes, {
      date: formatRequestDate(VALUES.date),
      values: buildTemplateValues(VALUES),
    });
    const { rows } = await readRows(filled);
    expect(rows.has("Примечание перевозчика")).toBe(true);
  });
});

describe("файл, который заявкой не является", () => {
  it("отклоняется, если нет строк, без которых документ бессмыслен", async () => {
    const info = await inspectTemplate(
      await variant((x) => dropRow(dropRow(x, "Грузополучатель"), "Маршрут транспортировки")),
    );
    expect(info.missingRequired).toEqual(["Грузополучатель", "Маршрут транспортировки"]);
  });
});

describe("период перевозки", () => {
  it("пишется с заглавной, как во всех настоящих заявках", async () => {
    const filled = await fillTemplateToBytes(base(), {
      date: formatRequestDate(VALUES.date),
      values: buildTemplateValues(VALUES),
    });
    const { rows } = await readRows(filled);
    expect(rows.get("Период перевозки")).toBe("Август 2026 г.");
  });
});

describe("формы из настоящих заявок, которых не было в модели", () => {
  it("период диапазоном — «Август-сентябрь 2026 г.», как у ОМИ", async () => {
    const filled = await fillTemplateToBytes(base(), {
      date: formatRequestDate("2026-08-26"),
      values: buildTemplateValues({
        date: "2026-08-26",
        periodMonth: 8,
        periodMonthTo: 9,
        periodYear: 2026,
      }),
    });
    const { rows } = await readRows(filled);
    expect(rows.get("Период перевозки")).toBe("Август-сентябрь 2026 г.");
  });

  it("тот же месяц в обоих полях диапазоном не считается", async () => {
    const filled = await fillTemplateToBytes(base(), {
      date: formatRequestDate("2026-08-26"),
      values: buildTemplateValues({
        date: "2026-08-26",
        periodMonth: 8,
        periodMonthTo: 8,
        periodYear: 2026,
      }),
    });
    const { rows } = await readRows(filled);
    expect(rows.get("Период перевозки")).toBe("Август 2026 г.");
  });

  it("оплат по ЖД может быть четыре — как в заявке на Батуми", async () => {
    const filled = await fillTemplateToBytes(base(), {
      date: formatRequestDate("2026-08-26"),
      values: buildTemplateValues({
        date: "2026-08-26",
        payers: [
          { railway: "КЗХ", text: "PTC OPERATOR ТОО КОД 2782503" },
          { railway: "РЖД", text: "РТС-ТРАНС ООО КОД 1006067843 РАСЧЕТ ЧЕРЕЗ ЦФТО" },
          { railway: "АЗЖД", text: "ADY Express 57550226" },
          { railway: "ГРЖД", text: "GR Transit LLC 156341" },
        ],
      }),
    });
    const { rows } = await readRows(filled);
    const cell = rows.get("Экспедитор по ЖД") ?? "";
    expect(cell).toContain("Оплата по КЗХ PTC OPERATOR ТОО КОД 2782503");
    expect(cell).toContain("Оплата по ГРЖД GR Transit LLC 156341");
  });

  it("привычные две оплаты пишутся как раньше", async () => {
    const filled = await fillTemplateToBytes(base(), {
      date: formatRequestDate("2026-03-27"),
      values: buildTemplateValues({
        date: "2026-03-27",
        payers: [
          { railway: "КЗХ", text: "– ТОО «PTC Operator»" },
          { railway: "КРГ", text: "груженый и порожний пробег: ОсОО «China Petrol»" },
        ],
      }),
    });
    const { rows } = await readRows(filled);
    const cell = rows.get("Экспедитор по ЖД") ?? "";
    expect(cell).toContain("Оплата по КЗХ – ТОО «PTC Operator»");
    expect(cell).toContain("Оплата по КРГ груженый и порожний пробег: ОсОО «China Petrol»");
  });

  it("«Страна назначения» и «Порт» заполняются, если строки есть в бланке", async () => {
    const bytes = await variant((x) =>
      x.replace(">Тупик<", ">Страна назначения<").replace(">Особые отметки<", ">Порт<"),
    );
    const info = await inspectTemplate(bytes);
    // Они больше не «лишние»: система умеет их заполнять.
    expect(info.extra).toEqual([]);

    const filled = await fillTemplateToBytes(bytes, {
      date: formatRequestDate("2026-08-26"),
      values: buildTemplateValues({
        date: "2026-08-26",
        destinationCountry: "Грузия, далее водным транспортом",
        port: "Батуми",
      }),
    });
    const { rows } = await readRows(filled);
    expect(rows.get("Страна назначения")).toBe("Грузия, далее водным транспортом");
    expect(rows.get("Порт")).toBe("Батуми");
  });

  it("«Номера вагонов-цистерн» заполняются — как у ОМИ", async () => {
    const bytes = await variant((x) => x.replace(">Тупик<", ">Номера вагонов-цистерн<"));
    const filled = await fillTemplateToBytes(bytes, {
      date: formatRequestDate("2026-08-26"),
      values: buildTemplateValues({
        date: "2026-08-26",
        wagonNumbers: "51694719, 51726354, 51602407",
      }),
    });
    const { rows } = await readRows(filled);
    expect(rows.get("Номера вагонов-цистерн")).toBe("51694719, 51726354, 51602407");
  });

  it("эталонный бланк без этих строк принимается без предупреждений", async () => {
    const info = await inspectTemplate(base());
    expect(info.missing).toEqual([]);
    expect(info.extra).toEqual([]);
    expect(info.missingRequired).toEqual([]);
  });
});
