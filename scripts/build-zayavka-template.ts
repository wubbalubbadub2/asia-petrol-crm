#!/usr/bin/env node
/**
 * Сборка эталонного шаблона заявки на перевозку.
 *
 *   npm run template:zayavka
 *   → public/templates/zayavka-template.docx
 *
 * ЗАЧЕМ. Клиент 25.08.2026: «Поля будут в шаблоне как мы зададим и
 * клиент будет заполнять поля по тем названиям которые мы изначально
 * зададим». То есть названия строк — наш контракт, а компания вставляет
 * в готовый бланк только свою шапку, подпись и печать. Поэтому эталон
 * рождается здесь, а не рисуется руками в Word: изменилась строка —
 * пересобрали файл, и все компании получают одинаковую разметку.
 *
 * ПРАВАЯ КОЛОНКА ПУСТАЯ НАМЕРЕННО. Если оставить в ней пример, а
 * генератор по какой-то причине не заполнит строку, в отправленную
 * заявку уедет чужой грузополучатель или чужой объём — ошибка, которую
 * на глаз не поймать. Пустая ячейка в такой ситуации сразу видна.
 *
 * Файл собирается как обычный zip: .docx — это набор XML внутри архива.
 * Отдельная библиотека ради шести файлов не нужна.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// Названия строк живут в одном модуле с генератором документа — иначе
// бланк и подстановка разъедутся, и строки перестанут заполняться.
import { TEMPLATE_ROWS, DATE_LINE_PLACEHOLDER } from "../src/lib/transport/template-rows";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "templates");
const outFile = join(outDir, "zayavka-template.docx");
const stage = join(root, ".zayavka-template-build");


const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** Абзац. size — половины пункта (24 = 12pt). */
type ParaOpts = { bold?: boolean; size?: number; align?: string; spaceAfter?: number };

function p(text: string, { bold = false, size = 24, align = "left", spaceAfter = 0 }: ParaOpts = {}): string {
  const rPr = `<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>${
    bold ? "<w:b/>" : ""
  }<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`;
  const pPr = `<w:pPr><w:spacing w:after="${spaceAfter}" w:line="240" w:lineRule="auto"/><w:jc w:val="${align}"/>${rPr}</w:pPr>`;
  const run = text === "" ? "" : `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  return `<w:p>${pPr}${run}</w:p>`;
}

/** Ячейка таблицы фиксированной ширины. */
function tc(text: string, width: number, { bold = false }: { bold?: boolean } = {}): string {
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>` +
    `<w:vAlign w:val="center"/></w:tcPr>` +
    p(text, { bold, size: 22 }) +
    `</w:tc>`
  );
}

const LEFT_W = 4200;
const RIGHT_W = 5300;

function table(): string {
  const borders =
    "<w:tblBorders>" +
    ["top", "left", "bottom", "right", "insideH", "insideV"]
      .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
      .join("") +
    "</w:tblBorders>";

  const rows = TEMPLATE_ROWS.map(
    (label) =>
      `<w:tr>${tc(label, LEFT_W, { bold: false })}${tc("", RIGHT_W)}</w:tr>`,
  ).join("");

  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${LEFT_W + RIGHT_W}" w:type="dxa"/>` +
    `<w:tblLayout w:type="fixed"/>${borders}</w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="${LEFT_W}"/><w:gridCol w:w="${RIGHT_W}"/></w:tblGrid>` +
    rows +
    `</w:tbl>`
  );
}

const documentXml =
  XML +
  `<w:document ${W}><w:body>` +
  p(DATE_LINE_PLACEHOLDER, { bold: true, size: 24, align: "center", spaceAfter: 240 }) +
  table() +
  p("", { spaceAfter: 240 }) +
  p("С уважением,") +
  p("Директор") +
  p("НАЗВАНИЕ КОМПАНИИ                    ________________") +
  p("Фамилия И.О.") +
  `<w:sectPr><w:headerReference w:type="default" r:id="rId1" ` +
  `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>` +
  `<w:pgSz w:w="11906" w:h="16838"/>` +
  `<w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/>` +
  `</w:sectPr></w:body></w:document>`;

// Шапка компании — то, что заменяет заказчик. Своё название, ИНН и
// адрес; сюда же вставляется логотип, если он есть на бланке.
const headerXml =
  XML +
  `<w:hdr ${W}>` +
  p("НАЗВАНИЕ КОМПАНИИ", { bold: true, size: 24, align: "center" }) +
  p("ИНН 000000000000", { size: 20, align: "center" }) +
  p("Адрес компании", { size: 20, align: "center", spaceAfter: 120 }) +
  `</w:hdr>`;

const stylesXml =
  XML +
  `<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr>` +
  `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>` +
  `<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="ru-RU"/>` +
  `</w:rPr></w:rPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  `</w:styles>`;

const contentTypes =
  XML +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
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
  `</Relationships>`;

const parts = [
  ["[Content_Types].xml", contentTypes],
  ["_rels/.rels", rootRels],
  ["word/document.xml", documentXml],
  ["word/_rels/document.xml.rels", docRels],
  ["word/header1.xml", headerXml],
  ["word/styles.xml", stylesXml],
];

rmSync(stage, { recursive: true, force: true });
for (const [name, body] of parts) {
  const full = join(stage, name);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body, "utf8");
}

mkdirSync(outDir, { recursive: true });
if (existsSync(outFile)) rmSync(outFile);

// -X: без макосных расширенных атрибутов, иначе Word ругается на архив.
execFileSync("zip", ["-q", "-X", "-r", outFile, ".", "-i", "*"], { cwd: stage });
rmSync(stage, { recursive: true, force: true });

console.log(`Шаблон собран: ${outFile}`);
console.log(`Строк в таблице: ${TEMPLATE_ROWS.length}`);
