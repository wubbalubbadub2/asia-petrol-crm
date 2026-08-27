#!/usr/bin/env node
/**
 * Бланки заявки для компаний, у которых нет своего файла.
 *
 *   npx tsx scripts/build-company-blanks.ts <папка с печатями> <куда класть>
 *
 * Клиент 27.08.2026: «для шаблонам собери бланки сам, фио оставь
 * пустыми». У одиннадцати компаний есть печать и подпись картинками, а
 * готовая заявка — только у пяти. Для остальных собираем бланк из
 * эталона: те же 19 строк, сверху название компании, снизу подпись и
 * печать картинками, ФИО директора — пустая строка.
 *
 * ВАЖНО: результат В РЕПОЗИТОРИЙ НЕ КЛАДЁТСЯ. В файлах печати и подписи
 * компаний, поэтому папка назначения задаётся аргументом и лежит вне
 * проекта. Скрипт ничего не публикует и никуда не отправляет.
 *
 * Название в шапке — то, под которым компания заведена в CRM. Полное
 * юридическое наименование, ИНН и адрес подставит человек: этих данных
 * в присланных папках нет, а выдумывать реквизиты нельзя.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { TEMPLATE_ROWS, DATE_LINE_PLACEHOLDER } from "../src/lib/transport/template-rows";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Папка печатей → название компании в CRM.
 *
 * Имена папок и названия в справочнике «Группы компании» расходятся
 * («СИНГУЛЯРИТИ» против «Singularity Trading»), поэтому соответствие
 * задано явно, а не выводится из имени папки.
 */
const COMPANY_NAMES: Record<string, string> = {
  "CAODL": "CAODL",
  "Ordo Munai Impex": "ОМИ",
  "Progressive Oil": "Progressive oil trading",
  "Tengri Way": "TENGRI WAY",
  "АБ ЛИНК": "АБ Линк",
  "АРКА ПРОФ": "Арқа Проф",
  "БЕТТА ТРЕЙД": "Бетта Трейд",
  "Дот-Трейдинг": "ДОТ",
  "ОРТ": "ОРТ",
  "СИНГУЛЯРИТИ": "Singularity Trading",
  "Фьюл Саплай": "Fuel Supply",
};

/** У этих компаний есть свой файл заявки — бланк собирать не нужно. */
const HAS_OWN_TEMPLATE = new Set(["ОРТ", "БЕТТА ТРЕЙД", "СИНГУЛЯРИТИ", "Ordo Munai Impex"]);

const EMU_PER_CM = 360000;
const SIGNATURE_CM = 4.0;
const STAMP_CM = 4.0;

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const WP_NS = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';

// ── Размеры картинок ────────────────────────────────────────────────
// Чтобы печать не растянуло овалом, нужны настоящие пропорции файла.
// Читаем их из самих байтов: PNG — из IHDR, JPEG — из маркера SOF.

function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function jpegSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 несут размеры.
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    const len = buf.readUInt16BE(i + 2);
    if (isSof) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

function imageSize(buf: Buffer, ext: string): { w: number; h: number } {
  const size = ext === ".jpg" || ext === ".jpeg" ? jpegSize(buf) : pngSize(buf);
  // Не разобрали — считаем квадратом: лучше слегка не тот размер, чем
  // деление на ноль и битый документ.
  return size ?? { w: 1000, h: 1000 };
}

/** Ширина задана, высота — по пропорциям файла. */
function extentEmu(size: { w: number; h: number }, widthCm: number) {
  const cx = Math.round(widthCm * EMU_PER_CM);
  const cy = Math.round((cx * size.h) / size.w);
  return { cx, cy };
}

// ── Куски документа ─────────────────────────────────────────────────

type ParaOpts = { bold?: boolean; size?: number; align?: string; spaceAfter?: number };

function runProps({ bold = false, size = 24 }: ParaOpts): string {
  return (
    `<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>` +
    `${bold ? "<w:b/>" : ""}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`
  );
}

function p(text: string, opts: ParaOpts = {}): string {
  const { align = "left", spaceAfter = 0 } = opts;
  const rPr = runProps(opts);
  const pPr = `<w:pPr><w:spacing w:after="${spaceAfter}" w:line="240" w:lineRule="auto"/><w:jc w:val="${align}"/>${rPr}</w:pPr>`;
  const run = text === "" ? "" : `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  return `<w:p>${pPr}${run}</w:p>`;
}

/** Абзац с картинкой: подпись и печать вставляются в строку. */
function imageParagraph(rId: string, id: number, cx: number, cy: number, align = "left"): string {
  return (
    `<w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="${align}"/></w:pPr><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${id}" name="Рисунок ${id}"/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="Рисунок ${id}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline>` +
    `</w:drawing></w:r></w:p>`
  );
}

const LEFT_W = 4200;
const RIGHT_W = 5300;

function tc(text: string, width: number): string {
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>` +
    p(text, { size: 22 }) +
    `</w:tc>`
  );
}

function table(): string {
  const borders =
    "<w:tblBorders>" +
    ["top", "left", "bottom", "right", "insideH", "insideV"]
      .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
      .join("") +
    "</w:tblBorders>";
  const rows = TEMPLATE_ROWS.map((label) => `<w:tr>${tc(label, LEFT_W)}${tc("", RIGHT_W)}</w:tr>`).join("");
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${LEFT_W + RIGHT_W}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${borders}</w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="${LEFT_W}"/><w:gridCol w:w="${RIGHT_W}"/></w:tblGrid>` +
    rows +
    `</w:tbl>`
  );
}

// ── Сборка одного бланка ────────────────────────────────────────────

type Picture = { file: string; ext: string; buf: Buffer; widthCm: number };

function buildDocx(companyName: string, signature: Picture | null, stamp: Picture | null, outFile: string) {
  const stage = join(root, ".company-blank-build");
  rmSync(stage, { recursive: true, force: true });

  const media: { name: string; buf: Buffer; rId: string; ext: string }[] = [];
  let rIdSeq = 3; // rId1 — колонтитул, rId2 — стили

  const addPicture = (pic: Picture, base: string) => {
    const rId = `rId${rIdSeq++}`;
    media.push({ name: `${base}${pic.ext}`, buf: pic.buf, rId, ext: pic.ext });
    return rId;
  };

  const sigRid = signature ? addPicture(signature, "signature") : null;
  const stampRid = stamp ? addPicture(stamp, "stamp") : null;

  const sigExt = signature ? extentEmu(imageSize(signature.buf, signature.ext), signature.widthCm) : null;
  const stampExt = stamp ? extentEmu(imageSize(stamp.buf, stamp.ext), stamp.widthCm) : null;

  const signatureBlock =
    p("С уважением,", { spaceAfter: 60 }) +
    p("Директор", { spaceAfter: 60 }) +
    p(companyName, { bold: true, spaceAfter: 0 }) +
    (sigRid && sigExt ? imageParagraph(sigRid, 1, sigExt.cx, sigExt.cy) : "") +
    // ФИО директора клиент просил оставить пустым (27.08.2026).
    p("____________________________", { spaceAfter: 0 }) +
    p("", { spaceAfter: 120 }) +
    (stampRid && stampExt ? imageParagraph(stampRid, 2, stampExt.cx, stampExt.cy) : "");

  const documentXml =
    XML +
    `<w:document ${W_NS} ${R_NS} ${WP_NS}><w:body>` +
    p(DATE_LINE_PLACEHOLDER, { bold: true, size: 24, align: "center", spaceAfter: 240 }) +
    table() +
    p("", { spaceAfter: 240 }) +
    signatureBlock +
    `<w:sectPr><w:headerReference w:type="default" r:id="rId1"/>` +
    `<w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/>` +
    `</w:sectPr></w:body></w:document>`;

  const headerXml =
    XML +
    `<w:hdr ${W_NS}>` +
    p(companyName, { bold: true, size: 24, align: "center" }) +
    p("", { size: 20, align: "center", spaceAfter: 120 }) +
    `</w:hdr>`;

  const stylesXml =
    XML +
    `<w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr>` +
    `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>` +
    `<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="ru-RU"/>` +
    `</w:rPr></w:rPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
    `</w:styles>`;

  const exts = new Set(media.map((m) => m.ext.replace(".", "")));
  const contentTypes =
    XML +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    [...exts]
      .map((e) => `<Default Extension="${e}" ContentType="image/${e === "jpg" ? "jpeg" : e}"/>`)
      .join("") +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `</Types>`;

  const rootRels =
    XML +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  const docRels =
    XML +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    media
      .map(
        (m) =>
          `<Relationship Id="${m.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`,
      )
      .join("") +
    `</Relationships>`;

  const parts: [string, string | Buffer][] = [
    ["[Content_Types].xml", contentTypes],
    ["_rels/.rels", rootRels],
    ["word/document.xml", documentXml],
    ["word/_rels/document.xml.rels", docRels],
    ["word/header1.xml", headerXml],
    ["word/styles.xml", stylesXml],
    ...media.map((m) => [`word/media/${m.name}`, m.buf] as [string, Buffer]),
  ];

  for (const [name, body] of parts) {
    const full = join(stage, name);
    mkdirSync(dirname(full), { recursive: true });
    if (typeof body === "string") writeFileSync(full, body, "utf8");
    else writeFileSync(full, body);
  }

  if (existsSync(outFile)) rmSync(outFile);
  execFileSync("zip", ["-q", "-X", "-r", outFile, ".", "-i", "*"], { cwd: stage });
  rmSync(stage, { recursive: true, force: true });
}

// ── Разбор папок ────────────────────────────────────────────────────

const stampsDir = process.argv[2];
const outDir = process.argv[3];

if (!stampsDir || !outDir) {
  console.error("Использование: npx tsx scripts/build-company-blanks.ts <папка с печатями> <куда класть>");
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });

// macOS отдаёт имена файлов в разложенном виде (NFD): «й» там — «и» с
// отдельным значком краткости, и строковое сравнение с «Фьюл Саплай»
// из кода не срабатывает. Приводим к составному виду (NFC), иначе
// пропускаются ровно те компании, в названии которых есть «й».
const folders = readdirSync(stampsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name.normalize("NFC"));

let built = 0;
for (const folder of folders) {
  if (HAS_OWN_TEMPLATE.has(folder)) {
    console.log(`⏭  ${folder} — есть своя заявка, бланк не нужен`);
    continue;
  }

  const company = COMPANY_NAMES[folder];
  if (!company) {
    console.log(`⚠  ${folder} — нет соответствия названию в CRM, пропущено`);
    continue;
  }

  const files = readdirSync(join(stampsDir, folder)).map((f) => f.normalize("NFC")).filter((f) =>
    [".png", ".jpg", ".jpeg"].includes(extname(f).toLowerCase()),
  );
  const pick = (re: RegExp) => files.find((f) => re.test(f.toLowerCase()));

  // «Рисунок1.png» у ОРТ — печать, но там свой бланк; у остальных имена
  // говорящие: печать / подпись / роспись.
  const stampFile = pick(/печать|pot|stamp/);
  const signFile = pick(/подпись|роспись|sign/);

  const toPicture = (f: string | undefined, widthCm: number): Picture | null => {
    if (!f) return null;
    const ext = extname(f).toLowerCase();
    return { file: f, ext: ext === ".jpeg" ? ".jpg" : ext, buf: readFileSync(join(stampsDir, folder, f)), widthCm };
  };

  const stamp = toPicture(stampFile, STAMP_CM);
  const signature = toPicture(signFile, SIGNATURE_CM);

  const out = join(outDir, `Бланк заявки — ${company}.docx`);
  buildDocx(company, signature, stamp, out);
  built++;
  console.log(
    `✓  ${company}: подпись ${signFile ?? "НЕТ"}, печать ${stampFile ?? "НЕТ"} → ${out.split("/").pop()}`,
  );
}

console.log(`\nСобрано бланков: ${built}`);
console.log("Шапка содержит только название из CRM: полное юридическое наименование,");
console.log("ИНН и адрес допишите в Word. ФИО директора оставлено пустым.");
