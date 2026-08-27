import type { TemplateValue } from "@/lib/transport/fill-template";
import { dateLine, OPTIONAL_ROWS } from "@/lib/transport/template-rows";

/**
 * PDF заявки на перевозку.
 *
 * Клиент 25.08.2026 выбрал «свой PDF с картинками из шаблона»:
 * конвертера Word → PDF на сервере нет, поэтому макет рисуется заново, а
 * из бланка компании берутся картинки — шапка, подпись и печать. Это
 * ПОХОЖЕ на Word, но не байт в байт, и клиент об этом предупреждён.
 *
 * Кириллица в PDF работает только со вшитым шрифтом: встроенные
 * Helvetica и Times знают лишь латиницу и на первой же русской букве
 * бросают ошибку. В `public/fonts` лежит PT Sans — свободный шрифт,
 * сделанный как раз под кириллицу. Файлы тянутся только в момент
 * формирования PDF, в основной бандл не попадают.
 *
 * Почему не Carlito, метрический клон Calibri, которым набраны
 * excel-выгрузки: pdf-lib вшивает его целиком с ошибкой «Trying to
 * access beyond buffer length», а вшить с обрезкой нельзя — см. ниже.
 *
 * Картинки различаются по тому, ОТКУДА на них ссылаются: то, что
 * подключено в колонтитуле, — шапка и рисуется сверху; то, что в теле
 * документа, — подпись и печать, они уходят в блок подписи. Определить
 * «где печать, а где подпись» по самому файлу нельзя: в бланках они
 * называются image1.png и image2.png.
 */

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 48;
const LINE = 13;

export type PdfInput = {
  /** Дата составления в виде «27.03.2026». */
  date: string;
  values: TemplateValue[];
  companyName: string;
  /** Картинки из колонтитула бланка — шапка. */
  headerImages: Uint8Array[];
  /** Картинки из тела бланка — подпись и печать. */
  bodyImages: Uint8Array[];
};

/** Картинки бланка, разложенные по назначению. */
export type TemplateImages = { header: Uint8Array[]; body: Uint8Array[] };

/**
 * Достать картинки из бланка и понять, какие из них в колонтитуле.
 *
 * Связи хранятся отдельными файлами: `word/_rels/document.xml.rels` для
 * тела и `word/_rels/headerN.xml.rels` для колонтитулов. Картинка,
 * названная в связях колонтитула, — часть шапки.
 */
export async function extractTemplateImages(bytes: Uint8Array): Promise<TemplateImages> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);

  const targetsIn = async (relsPath: string): Promise<Set<string>> => {
    const file = zip.file(relsPath);
    if (!file) return new Set();
    const xml = await file.async("string");
    const out = new Set<string>();
    for (const m of xml.matchAll(/Target="([^"]+)"/g)) {
      const target = m[1].replace(/^\.\.\//, "").replace(/^\//, "");
      if (target.startsWith("media/")) out.add(`word/${target}`);
      else if (target.startsWith("word/media/")) out.add(target);
    }
    return out;
  };

  const headerTargets = new Set<string>();
  for (const name of Object.keys(zip.files)) {
    if (/^word\/_rels\/(header|footer)\d*\.xml\.rels$/.test(name)) {
      for (const t of await targetsIn(name)) headerTargets.add(t);
    }
  }

  const header: Uint8Array[] = [];
  const body: Uint8Array[] = [];
  const media = Object.keys(zip.files)
    .filter((n) => /^word\/media\/.+\.(png|jpe?g)$/i.test(n))
    .sort();

  for (const name of media) {
    const data = await zip.file(name)!.async("uint8array");
    (headerTargets.has(name) ? header : body).push(data);
  }

  return { header, body };
}

/** Тип картинки по «магическим» первым байтам, а не по имени файла. */
function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50;
}

/** Разбить строку по ширине колонки — pdf-lib сам этого не делает. */
function wrap(
  text: string,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || line === "") {
        line = candidate;
      } else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Собрать PDF. Шрифты и картинки приходят снаружи, поэтому функция
 * проверяется тестом без сети и без браузера.
 */
export async function buildRequestPdf(
  input: PdfInput,
  fonts: { regular: Uint8Array; bold: Uint8Array },
): Promise<Uint8Array> {
  const [{ PDFDocument, rgb }, fontkitMod] = await Promise.all([
    import("pdf-lib"),
    import("@pdf-lib/fontkit"),
  ]);

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkitMod.default);
  // subset: false — ОБЯЗАТЕЛЬНО.
  //
  // С обрезкой (subset: true) pdf-lib выбрасывает почти все
  // кириллические глифы. Файл при этом остаётся валидным PDF нужного
  // размера, число страниц верное, тесты проходят — а в документе от
  // текста остаются отдельные буквы: «л», «Д», «к». Проверено на двух
  // разных шрифтах, дело не в конкретном файле, а в самом обрезчике.
  // Поймать это можно только глазами на готовом документе.
  //
  // Полный шрифт добавляет к каждому PDF около 300 КБ. Это плата за
  // читаемый документ.
  const regular = await pdf.embedFont(fonts.regular, { subset: false });
  const bold = await pdf.embedFont(fonts.bold, { subset: false });

  let page = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - MARGIN;
  const contentWidth = A4.w - MARGIN * 2;
  const ink = rgb(0.1, 0.1, 0.1);
  const rule = rgb(0.6, 0.6, 0.6);

  const newPage = () => {
    page = pdf.addPage([A4.w, A4.h]);
    y = A4.h - MARGIN;
  };

  const embed = async (bytes: Uint8Array) =>
    isPng(bytes) ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);

  /**
   * Размер картинки в рамке «не шире и не выше».
   *
   * Ограничивать только ширину мало: квадратный логотип при ширине
   * 220 пунктов занимает 220 в высоту и сталкивает таблицу на вторую
   * страницу. Берём тот масштаб, который умещает картинку в обе
   * стороны, пропорции сохраняются.
   */
  const fit = (
    image: { width: number; height: number },
    maxW: number,
    maxH: number,
  ) => {
    const k = Math.min(maxW / image.width, maxH / image.height, 1);
    return { w: image.width * k, h: image.height * k };
  };

  // ── Шапка ────────────────────────────────────────────────
  for (const img of input.headerImages) {
    try {
      const image = await embed(img);
      const { w, h } = fit(image, Math.min(contentWidth, 260), 70);
      page.drawImage(image, { x: MARGIN, y: y - h, width: w, height: h });
      y -= h + 8;
    } catch {
      // Битую картинку из чужого бланка молча пропускаем: документ
      // важнее логотипа.
    }
  }

  if (input.headerImages.length === 0 && input.companyName) {
    page.drawText(input.companyName, {
      x: MARGIN,
      y: y - 12,
      size: 12,
      font: bold,
      color: ink,
    });
    y -= 24;
  }

  // ── Заголовок с датой ────────────────────────────────────
  const title = dateLine(input.date);
  const titleWidth = bold.widthOfTextAtSize(title, 13);
  page.drawText(title, {
    x: (A4.w - titleWidth) / 2,
    y: y - 16,
    size: 13,
    font: bold,
    color: ink,
  });
  y -= 40;

  // ── Таблица ──────────────────────────────────────────────
  const labelW = contentWidth * 0.42;
  const valueW = contentWidth - labelW;
  const size = 9.5;
  const padX = 5;
  const padY = 4;

  // Необязательные строки печатаем, только если они заполнены. «Страна
  // назначения», «Порт» и «Номера вагонов-цистерн» нужны экспортной
  // заявке и не нужны обычной; пустыми они только зашумляют документ. У
  // остальных строк пустая клетка законна — так в бланках компаний.
  const optional = new Set<string>(OPTIONAL_ROWS);
  const printable = input.values.filter(
    ({ label, lines }) => !optional.has(label) || lines.some((l) => l.trim() !== ""),
  );

  for (const { label, lines } of printable) {
    const value = lines.filter((l) => l !== "").join("\n");
    const labelLines = wrap(label, regular, size, labelW - padX * 2);
    const valueLines = wrap(value, regular, size, valueW - padX * 2);
    const rows = Math.max(labelLines.length, valueLines.length, 1);
    const rowH = rows * LINE + padY * 2;

    if (y - rowH < MARGIN + 60) newPage();

    const top = y;
    const bottom = y - rowH;

    // Рамка ячеек.
    page.drawRectangle({
      x: MARGIN, y: bottom, width: labelW, height: rowH,
      borderColor: rule, borderWidth: 0.6,
    });
    page.drawRectangle({
      x: MARGIN + labelW, y: bottom, width: valueW, height: rowH,
      borderColor: rule, borderWidth: 0.6,
    });

    labelLines.forEach((line, i) => {
      page.drawText(line, {
        x: MARGIN + padX, y: top - padY - LINE * (i + 1) + 3.5,
        size, font: regular, color: ink,
      });
    });
    valueLines.forEach((line, i) => {
      page.drawText(line, {
        x: MARGIN + labelW + padX, y: top - padY - LINE * (i + 1) + 3.5,
        size, font: regular, color: ink,
      });
    });

    y = bottom;
  }

  // ── Подпись и печать ─────────────────────────────────────
  y -= 28;
  if (y < MARGIN + 140) newPage();

  page.drawText("С уважением,", { x: MARGIN, y, size: 10, font: regular, color: ink });
  y -= 16;
  page.drawText("Директор", { x: MARGIN, y, size: 10, font: regular, color: ink });
  y -= 16;
  if (input.companyName) {
    page.drawText(input.companyName, { x: MARGIN, y, size: 10, font: bold, color: ink });
    y -= 20;
  }

  let x = MARGIN;
  for (const img of input.bodyImages) {
    try {
      const image = await embed(img);
      const { w, h } = fit(image, 110, 90);
      if (y - h < MARGIN) break;
      page.drawImage(image, { x, y: y - h, width: w, height: h });
      x += w + 16;
    } catch {
      // см. выше
    }
  }

  return pdf.save();
}

/**
 * Шрифты для PDF. Полтора мегабайта на двоих, поэтому тянутся один раз
 * и только когда действительно формируют PDF — в основной бандл они не
 * попадают.
 */
let fontCache: { regular: Uint8Array; bold: Uint8Array } | null = null;

export async function loadPdfFonts(): Promise<{ regular: Uint8Array; bold: Uint8Array }> {
  if (fontCache) return fontCache;
  const [regular, bold] = await Promise.all([
    fetch("/fonts/PTSans-Regular.ttf").then((r) => {
      if (!r.ok) throw new Error(`шрифт не загрузился (${r.status})`);
      return r.arrayBuffer();
    }),
    fetch("/fonts/PTSans-Bold.ttf").then((r) => {
      if (!r.ok) throw new Error(`шрифт не загрузился (${r.status})`);
      return r.arrayBuffer();
    }),
  ]);
  fontCache = { regular: new Uint8Array(regular), bold: new Uint8Array(bold) };
  return fontCache;
}
