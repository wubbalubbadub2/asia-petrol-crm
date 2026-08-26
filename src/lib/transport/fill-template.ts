import { TEMPLATE_ROWS, normalizeRowLabel } from "@/lib/transport/template-rows";

/**
 * Заполнение бланка заявки на перевозку.
 *
 * Компания присылает свой `.docx` с шапкой, подписью и печатью, а строки
 * таблицы называются так, как задали мы (клиент 25.08.2026). Поэтому
 * здесь не разбирается чужая разметка: находим строку по названию в
 * левой колонке и подменяем значение в правой. Всё остальное — шапка,
 * печать, поля, шрифты, колонтитулы — остаётся из файла компании
 * нетронутым, поэтому вёрстка гарантированно совпадает с тем, что они
 * отправляют сейчас.
 *
 * Правится XML через DOM, а не регулярками: Word рвёт текст на куски
 * произвольно («Кол-во в тоннах» внутри файла может лежать тремя
 * фрагментами), вложенные таблицы и разные пространства имён ломают
 * любое текстовое сопоставление. DOMParser есть и в браузере, и в
 * jsdom, поэтому заполнение целиком проверяется тестом на настоящем
 * файле бланка.
 *
 * Оформление берётся из самой ячейки: шрифт и размер первого прогона
 * сохраняются, меняется только текст. Иначе подставленное значение
 * выпало бы из бланка чужим шрифтом.
 */

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const DOC_PART = "word/document.xml";
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Значение одной строки заявки. Несколько строк — перенос внутри ячейки. */
export type TemplateValue = { label: string; lines: string[] };

export type TemplateInspection = {
  /** Названия строк, найденные в бланке. */
  found: string[];
  /** Строки контракта, которых в бланке нет. */
  missing: string[];
  /** Нашлась ли строка «Заявка от …» над таблицей. */
  hasDateLine: boolean;
};

function els(root: Element | Document, local: string): Element[] {
  return Array.from(root.getElementsByTagNameNS(W_NS, local));
}

/** Текст элемента: все прогоны склеены, пробелы нормализованы. */
function textOf(node: Element): string {
  return els(node, "t")
    .map((t) => t.textContent ?? "")
    .join("");
}

/** Ячейки ПРЯМЫХ строк таблицы — без вложенных таблиц. */
function directCells(tr: Element): Element[] {
  return els(tr, "tc").filter((tc) => tc.parentNode === tr);
}

/**
 * Переписать текст абзаца, сохранив его оформление.
 *
 * Оставляем `w:pPr` абзаца и `w:rPr` первого прогона, всё остальное
 * содержимое выбрасываем и собираем заново. Перенос строки внутри
 * ячейки — `w:br`, как это делает сам Word: в образце ОРТ строка
 * «Экспедитор по ЖД» состоит из двух строк.
 */
function setParagraphText(p: Element, lines: string[]): void {
  const doc = p.ownerDocument;
  const firstRun = els(p, "r")[0];
  const rPr = firstRun ? els(firstRun, "rPr")[0] : undefined;
  const rPrClone = rPr ? (rPr.cloneNode(true) as Element) : null;

  for (const child of Array.from(p.childNodes)) {
    const el = child as Element;
    // Оформление абзаца оставляем, содержимое сносим.
    if (el.namespaceURI === W_NS && el.localName === "pPr") continue;
    p.removeChild(child);
  }

  const run = doc.createElementNS(W_NS, "w:r");
  if (rPrClone) run.appendChild(rPrClone);

  lines.forEach((line, i) => {
    if (i > 0) run.appendChild(doc.createElementNS(W_NS, "w:br"));
    const t = doc.createElementNS(W_NS, "w:t");
    t.setAttribute("xml:space", "preserve");
    t.textContent = line;
    run.appendChild(t);
  });

  p.appendChild(run);
}

/** Записать значение в ячейку: первый абзац переписан, лишние убраны. */
function setCellText(tc: Element, lines: string[]): void {
  const paragraphs = els(tc, "p").filter((p) => p.parentNode === tc);
  if (paragraphs.length === 0) {
    const doc = tc.ownerDocument;
    const p = doc.createElementNS(W_NS, "w:p");
    tc.appendChild(p);
    setParagraphText(p, lines);
    return;
  }
  setParagraphText(paragraphs[0], lines);
  for (const extra of paragraphs.slice(1)) tc.removeChild(extra);
}

function parseDocument(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) throw new Error("Не удалось разобрать документ Word");
  return doc;
}

/** Байты .docx: из браузера приходит ArrayBuffer, из теста — Uint8Array. */
export type DocxBytes = ArrayBuffer | Uint8Array;

/**
 * JSZip разбирает тип аргумента через instanceof, а он не работает
 * между реалмами: ArrayBuffer, созданный в Node, внутри jsdom
 * перестаёт быть «своим», и загрузка падает на «Can't read the data».
 * Приводим к Uint8Array текущего реалма — заодно это единственный тип,
 * который JSZip понимает одинаково везде.
 */
function toBytes(bytes: DocxBytes): Uint8Array {
  return ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
}

async function readDocumentXml(bytes: DocxBytes) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(toBytes(bytes));
  const part = zip.file(DOC_PART);
  if (!part) {
    throw new Error("Это не документ Word: внутри нет word/document.xml");
  }
  return { zip, xml: await part.async("string") };
}

/** Строки таблицы бланка: «название в левой колонке → сама строка». */
function labelledRows(doc: Document): Map<string, Element> {
  const map = new Map<string, Element>();
  for (const tr of els(doc, "tr")) {
    const cells = directCells(tr);
    if (cells.length < 2) continue;
    const label = normalizeRowLabel(textOf(cells[0]));
    if (label && !map.has(label)) map.set(label, tr);
  }
  return map;
}

/**
 * Абзац с датой над таблицей — «Заявка от 27.03.2026 г.».
 *
 * Берём ПЕРВЫЙ подходящий абзац: в бланке он один и стоит выше
 * таблицы, а внутри ячеек такого текста быть не может.
 */
function dateParagraph(doc: Document): Element | undefined {
  return els(doc, "p").find((p) => textOf(p).trim().startsWith("Заявка от"));
}

/**
 * Что нашлось в загруженном бланке. Вызывается при загрузке шаблона:
 * компания могла удалить или переименовать строку, и тогда заявка ушла
 * бы к контрагенту с незаполненным полем — молча.
 */
export async function inspectTemplate(bytes: DocxBytes): Promise<TemplateInspection> {
  const { xml } = await readDocumentXml(bytes);
  const doc = parseDocument(xml);
  const rows = labelledRows(doc);

  const found: string[] = [];
  const missing: string[] = [];
  for (const label of TEMPLATE_ROWS) {
    if (rows.has(normalizeRowLabel(label))) found.push(label);
    else missing.push(label);
  }

  return { found, missing, hasDateLine: dateParagraph(doc) !== undefined };
}

/**
 * Заполнить бланк значениями заявки.
 *
 * Строки, которых в бланке нет, молча пропускаются — до заполнения их
 * ловит `inspectTemplate` при загрузке шаблона.
 */
export async function fillTemplate(
  bytes: DocxBytes,
  opts: { dateLine: string; values: TemplateValue[] },
): Promise<Blob> {
  const { zip, xml } = await readDocumentXml(bytes);
  const doc = parseDocument(xml);

  const dp = dateParagraph(doc);
  if (dp) setParagraphText(dp, [opts.dateLine]);

  const rows = labelledRows(doc);
  for (const { label, lines } of opts.values) {
    const tr = rows.get(normalizeRowLabel(label));
    if (!tr) continue;
    const cells = directCells(tr);
    setCellText(cells[1], lines.length ? lines : [""]);
  }

  const out = XML_DECL + new XMLSerializer().serializeToString(doc.documentElement);
  zip.file(DOC_PART, out);

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  });
}

/** Для тестов: то же заполнение, но результат — байты, а не Blob. */
export async function fillTemplateToBytes(
  bytes: DocxBytes,
  opts: { dateLine: string; values: TemplateValue[] },
): Promise<Uint8Array> {
  const blob = await fillTemplate(bytes, opts);
  return new Uint8Array(await blob.arrayBuffer());
}
