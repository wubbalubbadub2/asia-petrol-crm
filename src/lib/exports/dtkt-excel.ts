/**
 * ДТ-КТ Логистика → Excel.
 *
 * Два варианта, как у паспорта сделок (клиент 2026-08-25):
 *
 *   short  — одна строка на пару «экспедитор + плательщик ЖД», ровно
 *            те же колонки, что на экране;
 *   detail — та же строка плюс сворачиваемые под-строки: даты и суммы
 *            оплат экспедитору и даты/тонны/суммы АВР от экспедитора.
 *
 * Сальдо СЮДА ПРИХОДИТ ПОСЧИТАННЫМ страницей (`computeDtKtSaldo`) —
 * второго источника правды по деньгам в выгрузке нет. Знак тот же, что
 * и на экране: плюс — мы должны экспедитору, минус — нам должны.
 *
 * АВР в базе отдельной сущностью не лежит: акт собирается из строк
 * реестра отгрузки по паре (экспедитор, плательщик ЖД) за год. В
 * под-строках они СГРУППИРОВАНЫ ПО ДАТЕ отгрузки — колонка «Вагонов»
 * показывает, сколько строк реестра сложилось в дату, чтобы группировка
 * не прятала данные. Сумма берётся из `shipped_tonnage_amount` — та же
 * величина, что и в колонке «Отгр. сумма» на экране.
 *
 * Валюты не конвертируются (как и на экране): у оплат валюта своя, в
 * под-строках она видна отдельной колонкой.
 *
 * exceljs большой, поэтому модуль подключается динамическим import()
 * со страницы по клику.
 */

export type DtKtExportPayment = {
  date: string | null;
  amount: number | null;
  currency: string | null;
  description: string | null;
};

export type DtKtExportRow = {
  forwarderId: string;
  companyGroupId: string;
  forwarder: string;
  companyGroup: string;
  year: number | null;
  openingBalance: number | null;
  /** Сумма строк оплат — как её считает страница. */
  payment: number;
  shippedVolume: number;
  shippedAmount: number;
  refund: number | null;
  fines: number | null;
  surcharge: number | null;
  ogem: number | null;
  /** Готовое сальдо из computeDtKtSaldo. Здесь НЕ пересчитывается. */
  saldo: number;
  payments: DtKtExportPayment[];
};

export type DtKtExportVariant = "short" | "detail";

export type DtKtExportContext = {
  year: number;
  variant: DtKtExportVariant;
};

/** Строка АВР: сутки отгрузки, свёрнутые из строк реестра. */
type AvrRow = { date: string; volume: number; amount: number; wagons: number };

/** Под-строка детального варианта: i-я оплата рядом с i-м АВР. */
type SubRow = { pay: DtKtExportPayment | null; avr: AvrRow | null };

// Деньги — 2 знака, красный минус: знак сальдо здесь смысловой.
const NUM_FMT_AMOUNT = "#,##0.00;[Red]-#,##0.00";
const NUM_FMT_VOLUME = "#,##0.000";
const NUM_FMT_DATE = "dd.mm.yy";

type Column = {
  key: string;
  header: string;
  width: number;
  numFmt?: string;
  align?: "left" | "right" | "center";
  /** Значение в главной строке записи ДТ-КТ. */
  read: (r: DtKtExportRow) => string | number | Date | null | undefined;
  /** Значение в под-строке (только detail). Нет — ячейка пустая. */
  readSub?: (r: DtKtExportRow, s: SubRow) => string | number | Date | null | undefined;
  /** Суммировать в строке «Итого». */
  total?: boolean;
};

/**
 * ISO-строка → Date в UTC-полночь календарного дня — как
 * `excelDate` детального паспорта. Клиент 2026-08-03: «даты в экспорте
 * не в формате даты — нельзя фильтровать по месяцу»; Excel группирует
 * автофильтр по году/месяцу только у date-типизированных ячеек, а срез
 * до 10 символов не даёт часовому поясу утащить дату на сутки назад.
 */
function excelDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

const COL_FORWARDER: Column = { key: "forwarder", header: "Экспедитор", width: 26, read: (r) => r.forwarder };
const COL_GROUP: Column = { key: "company_group", header: "Плательщик ЖД", width: 24, read: (r) => r.companyGroup };
const COL_YEAR: Column = { key: "year", header: "Год", width: 7, align: "center", read: (r) => r.year };
const COL_OPENING: Column = { key: "opening", header: "Сальдо 1 янв.", width: 16, numFmt: NUM_FMT_AMOUNT, read: (r) => r.openingBalance, total: true };
const COL_PAYMENT: Column = { key: "payment", header: "Оплата", width: 16, numFmt: NUM_FMT_AMOUNT, read: (r) => r.payment, total: true };
const COL_VOLUME: Column = { key: "shipped_volume", header: "Отгр. тонн", width: 14, numFmt: NUM_FMT_VOLUME, read: (r) => (r.shippedVolume || null), total: true };
const COL_AMOUNT: Column = { key: "shipped_amount", header: "Отгр. сумма", width: 16, numFmt: NUM_FMT_AMOUNT, read: (r) => (r.shippedAmount || null), total: true };
const COL_REFUND: Column = { key: "refund", header: "Возврат", width: 14, numFmt: NUM_FMT_AMOUNT, read: (r) => r.refund, total: true };
const COL_FINES: Column = { key: "fines", header: "Штрафы", width: 14, numFmt: NUM_FMT_AMOUNT, read: (r) => r.fines, total: true };
const COL_SURCHARGE: Column = { key: "surcharge", header: "Сверхнорм.", width: 15, numFmt: NUM_FMT_AMOUNT, read: (r) => r.surcharge, total: true };
const COL_OGEM: Column = { key: "ogem", header: "ОГЭМ", width: 14, numFmt: NUM_FMT_AMOUNT, read: (r) => r.ogem, total: true };
const COL_SALDO: Column = { key: "saldo", header: "Сальдо", width: 18, numFmt: NUM_FMT_AMOUNT, read: (r) => r.saldo, total: true };

// Колонки, живущие только в детальном варианте: в главной строке пусто,
// значение появляется в под-строке.
const COL_PAY_DATE: Column = {
  key: "pay_date", header: "Дата оплаты", width: 13, numFmt: NUM_FMT_DATE, align: "center",
  read: () => null, readSub: (_r, s) => excelDate(s.pay?.date),
};
const COL_PAY_CURRENCY: Column = {
  key: "pay_currency", header: "Валюта", width: 9, align: "center",
  read: () => null, readSub: (_r, s) => s.pay?.currency ?? null,
};
const COL_AVR_DATE: Column = {
  key: "avr_date", header: "Дата АВР", width: 13, numFmt: NUM_FMT_DATE, align: "center",
  read: () => null, readSub: (_r, s) => excelDate(s.avr?.date),
};
const COL_AVR_WAGONS: Column = {
  key: "avr_wagons", header: "Вагонов", width: 9, align: "center",
  read: () => null, readSub: (_r, s) => s.avr?.wagons ?? null,
};
const COL_PAY_NOTE: Column = {
  key: "pay_note", header: "Назначение оплаты", width: 34,
  read: () => null, readSub: (_r, s) => s.pay?.description ?? null,
};

const COLUMNS_SHORT: Column[] = [
  COL_FORWARDER, COL_GROUP, COL_YEAR,
  COL_OPENING, COL_PAYMENT, COL_VOLUME, COL_AMOUNT,
  COL_REFUND, COL_FINES, COL_SURCHARGE, COL_OGEM, COL_SALDO,
];

const COLUMNS_DETAIL: Column[] = [
  COL_FORWARDER, COL_GROUP, COL_YEAR,
  COL_OPENING,
  COL_PAY_DATE,
  { ...COL_PAYMENT, readSub: (_r, s) => s.pay?.amount ?? null },
  COL_PAY_CURRENCY,
  COL_AVR_DATE,
  { ...COL_VOLUME, readSub: (_r, s) => s.avr?.volume ?? null },
  { ...COL_AMOUNT, readSub: (_r, s) => s.avr?.amount ?? null },
  COL_AVR_WAGONS,
  COL_REFUND, COL_FINES, COL_SURCHARGE, COL_OGEM, COL_SALDO,
  COL_PAY_NOTE,
];

const HEADER_BG = "FF1C1917";   // sidebar dark
const HEADER_TEXT = "FFFAFAF9"; // background warm
const RED = "FFB91C1C";

/**
 * АВР по каждой паре «экспедитор + плательщик ЖД» за год: строки
 * реестра, свёрнутые по дате отгрузки. Ключ — `${forwarder}::${group}`,
 * ровно тот же, по которому страница считает «Отгр. сумма», поэтому
 * сумма под-строк сходится с главной строкой.
 */
async function fetchAvrByPair(year: number): Promise<Map<string, AvrRow[]>> {
  const [{ createClient }, { fetchAllPaginated }] = await Promise.all([
    import("@/lib/supabase/client"),
    import("@/lib/supabase/fetch-all"),
  ]);
  const sb = createClient();
  const { data, error } = await fetchAllPaginated<{
    date: string | null;
    forwarder_id: string | null;
    company_group_id: string | null;
    shipment_volume: number | null;
    shipped_tonnage_amount: number | null;
  }>((from, to) =>
    sb.from("shipment_registry")
      .select("date, forwarder_id, company_group_id, shipment_volume, shipped_tonnage_amount")
      .gte("date", `${year}-01-01`).lte("date", `${year}-12-31`)
      .order("date")
      .range(from, to),
  );
  if (error) throw new Error(error.message);

  const byPair = new Map<string, Map<string, AvrRow>>();
  for (const r of data) {
    if (!r.forwarder_id || !r.date) continue;
    const key = `${r.forwarder_id}::${r.company_group_id ?? ""}`;
    let byDate = byPair.get(key);
    if (!byDate) { byDate = new Map(); byPair.set(key, byDate); }
    const day = r.date.slice(0, 10);
    const acc = byDate.get(day) ?? { date: day, volume: 0, amount: 0, wagons: 0 };
    acc.volume += r.shipment_volume ?? 0;
    acc.amount += r.shipped_tonnage_amount ?? 0;
    acc.wagons += 1;
    byDate.set(day, acc);
  }

  const out = new Map<string, AvrRow[]>();
  for (const [key, byDate] of byPair) {
    out.set(key, Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)));
  }
  return out;
}

/**
 * Модуль exceljs передаётся снаружи: в браузере — динамическим import(),
 * в тесте — обычным. Нужен ровно конструктор книги, поэтому тип
 * структурный: у типов exceljs нет `default`, он синтетический.
 */
type ExcelJSModule = { Workbook: new () => import("exceljs").Workbook };

/**
 * Сборка книги без сети и без браузера — чтобы её можно было проверить
 * тестом на настоящих ячейках, а не на массиве описаний колонок
 * (`src/__tests__/dtkt-excel-workbook.test.ts`).
 */
export function buildDtKtWorkbook(
  ExcelJS: ExcelJSModule,
  rows: DtKtExportRow[],
  ctx: DtKtExportContext,
  avrByPair: Map<string, AvrRow[]>,
) {
  const isDetail = ctx.variant === "detail";
  const columns = isDetail ? COLUMNS_DETAIL : COLUMNS_SHORT;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Singularity Trading CRM";
  wb.created = new Date();

  const sheetName = isDetail ? "ДТ-КТ сальдо (дет.)" : "ДТ-КТ сальдо";
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: "frozen", xSplit: 2, ySplit: 2 }],
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    // summaryBelow: false — под-строки идут ПОД своей записью, значит
    // кнопка «свернуть» должна стоять на ней же. По умолчанию OOXML
    // считает итог нижним, и Excel вешает кнопку на следующую запись:
    // жмёшь плюс у «Арқа Проф», а сворачивается TENGRI WAY.
    properties: {
      outlineLevelRow: 1,
      outlineProperties: { summaryBelow: false, summaryRight: false },
    } as never,
  });

  // ── Title row ────────────────────────────────────────────
  ws.getRow(1).height = 24;
  ws.mergeCells(1, 1, 1, columns.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `ДТ-КТ Логистика · сальдо · ${ctx.year}`
    + (rows.length ? `  ·  ${rows.length} записей` : "")
    + "   ·   плюс — мы должны экспедитору, минус — нам должны";
  titleCell.font = { bold: true, size: 13, color: { argb: HEADER_TEXT } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };

  // ── Column header row ────────────────────────────────────
  const headerRow = ws.getRow(2);
  headerRow.height = 24;
  columns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    cell.font = { bold: true, size: 10, color: { argb: HEADER_TEXT } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.border = { bottom: { style: "medium", color: { argb: "FFD97706" } } };
    ws.getColumn(idx + 1).width = col.width;
    if (col.numFmt) ws.getColumn(idx + 1).numFmt = col.numFmt;
  });

  // ── Data rows ────────────────────────────────────────────
  let r = 3;
  for (const row of rows) {
    const mainRow = ws.getRow(r++);
    mainRow.height = 18;
    columns.forEach((col, colIdx) => {
      const cell = mainRow.getCell(colIdx + 1);
      const v = col.read(row);
      cell.value = v == null || v === "" ? null : v;
      cell.font = { size: 10, name: "Calibri" };
      cell.alignment = { vertical: "middle", horizontal: col.align ?? (col.numFmt ? "right" : "left") };
      cell.border = {
        right: { style: "thin", color: { argb: "FFE7E5E4" } },
        bottom: { style: "thin", color: { argb: "FFF5F5F4" } },
      };
      if (col.numFmt) cell.numFmt = col.numFmt;
      // Минус = нам должны — тот же красный, что и в таблице на экране.
      if (col.key === "saldo" && row.saldo < 0) {
        cell.font = { size: 10, name: "Calibri", bold: true, color: { argb: RED } };
      }
    });

    if (!isDetail) continue;

    // Под-строки: i-я оплата рядом с i-м АВР. Списки независимы, длина
    // блока — по длинному из них, недостающая половина пустая (тот же
    // приём, что в passport-detail-excel).
    const avrs = avrByPair.get(`${row.forwarderId}::${row.companyGroupId}`) ?? [];
    const pays = [...row.payments].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    const subCount = Math.max(avrs.length, pays.length);
    for (let i = 0; i < subCount; i++) {
      const sub: SubRow = { pay: pays[i] ?? null, avr: avrs[i] ?? null };
      const subRow = ws.getRow(r++);
      subRow.height = 16;
      subRow.outlineLevel = 1;
      columns.forEach((col, colIdx) => {
        const cell = subRow.getCell(colIdx + 1);
        const v = col.readSub ? col.readSub(row, sub) : null;
        cell.value = v == null || v === "" ? null : v;
        cell.font = { size: 9.5, name: "Calibri", color: { argb: "FF44403C" } };
        cell.alignment = { vertical: "middle", horizontal: col.align ?? (col.numFmt ? "right" : "left") };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFAFAF9" } };
        cell.border = {
          right: { style: "thin", color: { argb: "FFE7E5E4" } },
          bottom: { style: "thin", color: { argb: "FFF5F5F4" } },
        };
        if (col.numFmt) cell.numFmt = col.numFmt;
        if (cell.value instanceof Date) cell.numFmt = "dd.mm.yy";
      });
    }
  }

  // ── Итого: только по главным строкам, под-строки удвоили бы суммы ──
  if (rows.length > 0) {
    const totalRow = ws.getRow(r);
    totalRow.height = 22;
    columns.forEach((col, idx) => {
      const cell = totalRow.getCell(idx + 1);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
      cell.font = { bold: true, size: 10 };
      cell.border = { top: { style: "medium", color: { argb: "FFD97706" } } };
      if (idx === 0) {
        cell.value = "Итого";
        cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        return;
      }
      if (!col.total) return;
      let sum = 0;
      for (const row of rows) {
        const v = col.read(row);
        if (typeof v === "number" && Number.isFinite(v)) sum += v;
      }
      cell.value = sum;
      cell.alignment = { vertical: "middle", horizontal: "right" };
      if (col.numFmt) cell.numFmt = col.numFmt;
      if (col.key === "saldo" && sum < 0) cell.font = { bold: true, size: 10, color: { argb: RED } };
    });
  }

  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: columns.length } };

  return wb;
}

export async function exportDtKtToExcel(rows: DtKtExportRow[], ctx: DtKtExportContext): Promise<void> {
  // Реестр тянем только для детального варианта — сокращённому хватает
  // готовых сумм со страницы.
  const avrByPair = ctx.variant === "detail"
    ? await fetchAvrByPair(ctx.year)
    : new Map<string, AvrRow[]>();

  const ExcelJS = (await import("exceljs")).default;
  const wb = buildDtKtWorkbook(ExcelJS, rows, ctx, avrByPair);

  // ── Download ────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const datestamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `dtkt-saldo-${ctx.variant}-${ctx.year}-${datestamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Для регрессионных тестов (dtkt-excel-columns, dtkt-excel-workbook).
export { COLUMNS_SHORT as DTKT_SHORT_COLUMNS, COLUMNS_DETAIL as DTKT_DETAIL_COLUMNS, excelDate };
export type { AvrRow as DtKtAvrRow };
