/**
 * Паспорт (детальный) → Excel.
 *
 * Client-specced layout 2026-07-14 (files/Паспорт/passport-detail-2026-07-09.xlsx):
 * 63 columns in the same five bands as the regular passport export, PLUS
 * one sub-row per shipment_registry row under each deal — the client's
 * «шаблон выгрузки» block (KG/26/500) maps 1:1 to registry wagons.
 *
 * Key deltas vs passport-excel.ts:
 *  • «ГСМ» → «Продукт», «Цена оконч.» → «Цена финальная», «Месяц» →
 *    «Месяц отгрузки по прилож.».
 *  • New «Биржа» columns (supplier/buyer) — official quotation basis
 *    (FOB MED / CIF NWE) from quotation_product_types.basis via lines.
 *  • Per-group price block: Биржа (empty — no DB field, client decision
 *    2026-07-14) | Котировка | Скидка | Цена предв. | Цена финальная.
 *    «Цена гр. (avg)» dropped («эта графа не нужна»).
 *  • «Остаток, т» = Заявлено − Отгружено (positive; клиент: «остаток
 *    сделать плюсовой») — opposite sign vs the regular export.
 *  • Logistics band: Плательщик жд тарифа, жд тариф план, Плановая
 *    сумма жд, Объем по счету-фактуре, жд тариф факт, Сумма жд по
 *    счету-фактуре, Менеджер по покупке + Менеджер по продаже.
 *  • Sub-rows carry only wagon-owned values (volumes, dates, shipment
 *    amounts, rail data); deal-level aggregates (Оплата/Баланс/Заявлено/
 *    Остаток/Долг/group numbers) live on the main row only — repeating
 *    them per wagon would double-count any SUM the client runs.
 *
 * Dynamically imported from the deals page (exceljs is heavy).
 */

import type { Deal } from "@/lib/hooks/use-deals";
import type { ExportContext } from "@/lib/exports/passport-excel";
import { roundedTonnage } from "@/lib/exports/registry-excel";

type Side = "supplier" | "buyer";

// Slim registry row for the sub-rows — only what the columns read.
type DetailShipment = {
  deal_id: string;
  registry_type: "KG" | "KZ" | null;
  date: string | null;
  loading_volume: number | null;
  shipment_volume: number | null;
  shipped_tonnage_amount: number | null;
  rounded_volume_override: number | null;
  round_volume: boolean | null;
  railway_tariff: number | null;
  shipment_month: string | null;
  supplier_appendix: string | null;
  buyer_appendix: string | null;
};

type Column = {
  key: string;
  header: string;
  width: number;
  band: "deal" | "supplier" | "groups" | "buyer" | "logistics";
  numFmt?: string;
  read: (deal: Deal) => string | number | null | undefined;
  // Sub-row value. Omitted → cell stays empty on shipment rows.
  readShip?: (deal: Deal, s: DetailShipment) => string | number | null | undefined;
};

const NUM_FMT_AMOUNT = "#,##0.00;[Red]-#,##0.00";
const NUM_FMT_VOLUME = "#,##0.000;[Red]-#,##0.000";
const NUM_FMT_PRICE = "#,##0.00";

const MONTHS_RU = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

function monthFromDate(date: string | null): string {
  if (!date) return "";
  const m = Number(date.slice(5, 7));
  return MONTHS_RU[m - 1] ?? "";
}

function defaultLine(deal: Deal, side: Side) {
  const lines = side === "supplier" ? deal.supplier_lines : deal.buyer_lines;
  if (!lines || lines.length === 0) return null;
  return lines.find((l) => l.is_default) ?? lines[0];
}

function preliminaryPrice(deal: Deal, side: Side): number | null {
  const line = defaultLine(deal, side);
  if (!line) return null;
  return (line.price_stage === "final" ? line.preliminary_price : line.price) ?? null;
}

// «Биржа» — official basis string of the line's quotation product.
function exchange(deal: Deal, side: Side): string {
  return defaultLine(deal, side)?.quotation_type?.basis ?? "";
}

function groupAt(deal: Deal, position: number) {
  return (deal.deal_company_groups ?? []).find((g) => g.position === position) ?? null;
}

function groupName(deal: Deal, position: number): string {
  return groupAt(deal, position)?.company_group?.name ?? "";
}

// dcg.price is a single value whose kind is flagged by price_kind —
// route it into the right column, leave the other blank.
function groupPrice(deal: Deal, position: number, kind: "preliminary" | "final"): number | null {
  const g = groupAt(deal, position);
  if (!g || g.price == null) return null;
  return (g.price_kind ?? "preliminary") === kind ? g.price : null;
}

// Один блок колонок на группу. Биржа пустая — у deal_company_groups
// нет поля типа котировки (клиент решил оставить пустой, 2026-07-14).
function groupBlock(position: number): Column[] {
  return [
    { key: `company_group_${position}`, header: `Группа ${position}`, width: 18, band: "groups", read: (d) => groupName(d, position), readShip: (d) => groupName(d, position) },
    { key: `group_${position}_exchange`, header: "Биржа", width: 11, band: "groups", read: () => "" },
    { key: `group_${position}_quotation`, header: "Котировка", width: 11, band: "groups", numFmt: NUM_FMT_PRICE, read: (d) => groupAt(d, position)?.quotation ?? null },
    { key: `group_${position}_discount`, header: "Скидка", width: 10, band: "groups", numFmt: NUM_FMT_PRICE, read: (d) => groupAt(d, position)?.discount ?? null },
    { key: `group_${position}_preliminary_price`, header: "Цена предв.", width: 11, band: "groups", numFmt: NUM_FMT_PRICE, read: (d) => groupPrice(d, position, "preliminary") },
    { key: `group_${position}_final_price`, header: "Цена финальная", width: 11, band: "groups", numFmt: NUM_FMT_PRICE, read: (d) => groupPrice(d, position, "final") },
  ];
}

const COLUMNS: Column[] = [
  // ── Сделка ─────────────────────────────────────────────
  { key: "deal_code", header: "№", width: 14, band: "deal", read: (d) => d.deal_code, readShip: (d) => d.deal_code },
  { key: "month", header: "Месяц отгрузки по прилож.", width: 11, band: "deal", read: (d) => d.month, readShip: (_, s) => s.shipment_month || monthFromDate(s.date) },
  { key: "factory", header: "Завод", width: 14, band: "deal", read: (d) => d.factory?.name ?? "", readShip: (d) => d.factory?.name ?? "" },
  { key: "fuel", header: "Продукт", width: 14, band: "deal", read: (d) => d.fuel_type?.name ?? "", readShip: (d) => d.fuel_type?.name ?? "" },
  { key: "sulfur", header: "%S", width: 6, band: "deal", read: (d) => d.sulfur_percent ?? "", readShip: (d) => d.sulfur_percent ?? "" },

  // ── Поставщик ──────────────────────────────────────────
  { key: "supplier", header: "Поставщик", width: 22, band: "supplier", read: (d) => d.supplier?.short_name ?? d.supplier?.full_name ?? "", readShip: (d) => d.supplier?.short_name ?? d.supplier?.full_name ?? "" },
  { key: "supplier_contract", header: "Договор", width: 14, band: "supplier", read: (d) => d.supplier_contract ?? "", readShip: (d, s) => s.supplier_appendix || (d.supplier_contract ?? "") },
  { key: "supplier_basis", header: "Базис", width: 14, band: "supplier", read: (d) => d.supplier_delivery_basis ?? "", readShip: (d) => d.supplier_delivery_basis ?? "" },
  { key: "supplier_volume", header: "Объем, т", width: 11, band: "supplier", numFmt: NUM_FMT_VOLUME, read: (d) => d.supplier_contracted_volume },
  { key: "supplier_amount", header: "Сумма дог.", width: 14, band: "supplier", numFmt: NUM_FMT_AMOUNT, read: (d) => d.supplier_contracted_amount },
  { key: "supplier_exchange", header: "Биржа", width: 12, band: "supplier", read: (d) => exchange(d, "supplier"), readShip: (d) => exchange(d, "supplier") },
  { key: "supplier_quotation", header: "Котировка", width: 11, band: "supplier", numFmt: NUM_FMT_PRICE, read: (d) => d.supplier_quotation, readShip: (d) => d.supplier_quotation },
  { key: "supplier_discount", header: "Скидка", width: 10, band: "supplier", numFmt: NUM_FMT_PRICE, read: (d) => d.supplier_discount },
  { key: "supplier_preliminary_price", header: "Цена предв.", width: 11, band: "supplier", numFmt: NUM_FMT_PRICE, read: (d) => preliminaryPrice(d, "supplier") },
  { key: "supplier_price", header: "Цена финальная", width: 12, band: "supplier", numFmt: NUM_FMT_PRICE, read: (d) => d.supplier_price, readShip: (d) => d.supplier_price },
  { key: "supplier_shipped_volume", header: "Отгр., т", width: 11, band: "supplier", numFmt: NUM_FMT_VOLUME, read: (d) => d.supplier_shipped_volume, readShip: (_, s) => s.loading_volume },
  // Дата только при наличии своего тоннажа (клиент 2026-07-16, KG/26/487:
  // «если нет числа во входящем или исходящем СНТ — дату не проставляем»).
  { key: "supplier_snt_date", header: "Дата вход. СНТ", width: 12, band: "supplier", read: () => "", readShip: (_, s) => (s.loading_volume != null ? s.date ?? "" : "") },
  // Per-wagon shipped amount mirrors the client's template formula
  // (=O$4*P5): deal supplier price × wagon's incoming tonnage.
  { key: "supplier_shipped_amount", header: "Отгр. сумма", width: 14, band: "supplier", numFmt: NUM_FMT_AMOUNT, read: (d) => d.supplier_shipped_amount, readShip: (d, s) => d.supplier_price != null && s.loading_volume != null ? d.supplier_price * s.loading_volume : null },
  { key: "supplier_payment", header: "Оплата", width: 13, band: "supplier", numFmt: NUM_FMT_AMOUNT, read: (d) => d.supplier_payment },
  { key: "supplier_payment_date", header: "Дата оплаты", width: 12, band: "supplier", read: (d) => d.supplier_payment_date ?? "" },
  { key: "supplier_balance", header: "Баланс", width: 13, band: "supplier", numFmt: NUM_FMT_AMOUNT, read: (d) => d.supplier_balance },

  // ── Группы компании ────────────────────────────────────
  ...groupBlock(1),
  ...groupBlock(2),
  { key: "company_group_3", header: "Группа 3", width: 18, band: "groups", read: (d) => groupName(d, 3), readShip: (d) => groupName(d, 3) },

  // ── Покупатель ─────────────────────────────────────────
  { key: "buyer", header: "Покупатель", width: 22, band: "buyer", read: (d) => d.buyer?.short_name ?? d.buyer?.full_name ?? "", readShip: (d) => d.buyer?.short_name ?? d.buyer?.full_name ?? "" },
  { key: "buyer_contract", header: "Договор", width: 14, band: "buyer", read: (d) => d.buyer_contract ?? "", readShip: (d, s) => s.buyer_appendix || (d.buyer_contract ?? "") },
  { key: "buyer_basis", header: "Базис", width: 14, band: "buyer", read: (d) => d.buyer_delivery_basis ?? "" },
  { key: "buyer_volume", header: "Объем, т", width: 11, band: "buyer", numFmt: NUM_FMT_VOLUME, read: (d) => d.buyer_contracted_volume },
  { key: "buyer_amount", header: "Сумма дог.", width: 14, band: "buyer", numFmt: NUM_FMT_AMOUNT, read: (d) => d.buyer_contracted_amount },
  { key: "buyer_exchange", header: "Биржа", width: 12, band: "buyer", read: (d) => exchange(d, "buyer"), readShip: (d) => exchange(d, "buyer") },
  { key: "buyer_quotation", header: "Котировка", width: 11, band: "buyer", numFmt: NUM_FMT_PRICE, read: (d) => d.buyer_quotation },
  { key: "buyer_discount", header: "Скидка", width: 10, band: "buyer", numFmt: NUM_FMT_PRICE, read: (d) => d.buyer_discount },
  { key: "buyer_preliminary_price", header: "Цена предв.", width: 11, band: "buyer", numFmt: NUM_FMT_PRICE, read: (d) => preliminaryPrice(d, "buyer") },
  { key: "buyer_price", header: "Цена финальная", width: 12, band: "buyer", numFmt: NUM_FMT_PRICE, read: (d) => d.buyer_price, readShip: (d) => d.buyer_price },
  { key: "buyer_ordered_volume", header: "Заявлено, т", width: 11, band: "buyer", numFmt: NUM_FMT_VOLUME, read: (d) => d.buyer_ordered_volume },
  // Положительный остаток: Заявлено − Отгружено (клиентская аннотация
  // «остаток сделать плюсовой»; template: =AT4-SUM(AV5:AV9) → 387.3).
  // NB: regular passport export keeps the old shipped−ordered sign.
  { key: "buyer_remainder", header: "Остаток, т", width: 11, band: "buyer", numFmt: NUM_FMT_VOLUME, read: (d) => (d.buyer_ordered_volume ?? 0) - (d.buyer_shipped_volume ?? 0) },
  { key: "buyer_shipped_volume", header: "Отгр., т", width: 11, band: "buyer", numFmt: NUM_FMT_VOLUME, read: (d) => d.buyer_shipped_volume, readShip: (_, s) => s.shipment_volume },
  { key: "buyer_snt_date", header: "Дата исход. СНТ", width: 12, band: "buyer", read: () => "", readShip: (_, s) => (s.shipment_volume != null ? s.date ?? "" : "") },
  { key: "buyer_shipped_amount", header: "Отгр. сумма", width: 14, band: "buyer", numFmt: NUM_FMT_AMOUNT, read: (d) => d.buyer_shipped_amount, readShip: (d, s) => d.buyer_price != null && s.shipment_volume != null ? d.buyer_price * s.shipment_volume : null },
  { key: "buyer_payment", header: "Оплата", width: 13, band: "buyer", numFmt: NUM_FMT_AMOUNT, read: (d) => d.buyer_payment },
  { key: "buyer_payment_date", header: "Дата оплаты", width: 12, band: "buyer", read: (d) => d.buyer_payment_date ?? "" },
  { key: "buyer_debt", header: "Долг / переплата", width: 14, band: "buyer", numFmt: NUM_FMT_AMOUNT, read: (d) => d.buyer_debt },

  // ── Логистика ──────────────────────────────────────────
  { key: "forwarder", header: "Экспедитор", width: 18, band: "logistics", read: (d) => d.forwarder?.name ?? "", readShip: (d) => d.forwarder?.name ?? "" },
  { key: "logistics_company_group", header: "Плательщик жд тарифа", width: 18, band: "logistics", read: (d) => d.logistics_company_group?.name ?? "" },
  { key: "preliminary_tonnage", header: "Объем план", width: 11, band: "logistics", numFmt: NUM_FMT_VOLUME, read: (d) => d.preliminary_tonnage },
  { key: "planned_tariff", header: "жд тариф план", width: 11, band: "logistics", numFmt: NUM_FMT_PRICE, read: (d) => d.planned_tariff },
  { key: "preliminary_amount", header: "Плановая сумма жд", width: 14, band: "logistics", numFmt: NUM_FMT_AMOUNT, read: (d) => d.preliminary_amount },
  // «KG по исходящим СНТ» (client annotation): per-wagon base follows
  // the registry amount formula — KZ counts loading, KG counts shipment.
  { key: "actual_shipped_volume", header: "Факт объем", width: 11, band: "logistics", numFmt: NUM_FMT_VOLUME, read: (d) => d.actual_shipped_volume, readShip: (_, s) => (s.registry_type === "KZ" ? s.loading_volume : s.shipment_volume) },
  { key: "invoice_volume", header: "Объем по счету-фактуре", width: 12, band: "logistics", numFmt: NUM_FMT_VOLUME, read: (d) => d.invoice_volume, readShip: (_, s) => roundedTonnage(s) },
  { key: "actual_tariff", header: "жд тариф факт", width: 11, band: "logistics", numFmt: NUM_FMT_PRICE, read: (d) => d.actual_tariff, readShip: (_, s) => s.railway_tariff },
  { key: "invoice_amount", header: "Сумма жд по счету-фактуре", width: 14, band: "logistics", numFmt: NUM_FMT_AMOUNT, read: (d) => d.invoice_amount, readShip: (_, s) => s.shipped_tonnage_amount },
  { key: "supplier_manager", header: "Менеджер по покупке", width: 16, band: "logistics", read: (d) => d.supplier_manager?.full_name ?? "" },
  { key: "buyer_manager", header: "Менеджер по продаже", width: 16, band: "logistics", read: (d) => d.buyer_manager?.full_name ?? "" },
];

const BAND_STYLE: Record<Column["band"], { label: string; bg: string; text: string }> = {
  deal:      { label: "Сделка",          bg: "FFF1F0EE", text: "FF44403C" },
  supplier:  { label: "Поставщик",       bg: "FFFFF7E6", text: "FF92400E" },
  groups:    { label: "Группы компании", bg: "FFF3E8FF", text: "FF6B21A8" },
  buyer:     { label: "Покупатель",      bg: "FFE0F2FE", text: "FF1E40AF" },
  logistics: { label: "Логистика",       bg: "FFF4F4F3", text: "FF44403C" },
};

const HEADER_BG = "FF1C1917";
const HEADER_TEXT = "FFFAFAF9";

// Same fuel-tint blend as passport-excel.ts (kept local: that module's
// copy is not exported and the two exports evolve independently).
function blendArgbWithFuel(baseArgb: string, fuelHex: string | null | undefined, fuelAlpha: number): string {
  const base = baseArgb.startsWith("FF") || baseArgb.startsWith("ff") ? baseArgb.slice(2) : baseArgb;
  if (base.length !== 6 || !fuelHex || typeof fuelHex !== "string" || !fuelHex.startsWith("#")) return `FF${base.toUpperCase()}`;
  const fuelStripped = fuelHex.length === 4
    ? fuelHex.slice(1).split("").map((c) => c + c).join("")
    : fuelHex.slice(1);
  if (fuelStripped.length !== 6) return `FF${base.toUpperCase()}`;
  const br = parseInt(base.slice(0, 2), 16);
  const bg = parseInt(base.slice(2, 4), 16);
  const bb = parseInt(base.slice(4, 6), 16);
  const fr = parseInt(fuelStripped.slice(0, 2), 16);
  const fg = parseInt(fuelStripped.slice(2, 4), 16);
  const fb = parseInt(fuelStripped.slice(4, 6), 16);
  if ([br, bg, bb, fr, fg, fb].some(Number.isNaN)) return `FF${base.toUpperCase()}`;
  const a = Math.max(0, Math.min(1, fuelAlpha));
  const mix = (b: number, f: number) => Math.round(f * a + b * (1 - a));
  const hex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
  return `FF${hex(mix(br, fr))}${hex(mix(bg, fg))}${hex(mix(bb, fb))}`;
}

// «Дата оплаты» — реальные даты платежей из deal_payments (клиент
// 2026-07-14: «даты оплат не прогрузились» — deals.*_payment_date это
// почти пустой ручной TEXT, 7 заполненных на 792 сделки). Несколько
// платежей на сторону → список дат dd.mm.yyyy через запятую.
function fmtDate(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

type PaymentDates = { supplier: string; buyer: string };

async function fetchPaymentDatesByDeals(dealIds: string[]): Promise<Map<string, PaymentDates>> {
  const { createClient } = await import("@/lib/supabase/client");
  const sb = createClient();
  const CHUNK = 150;
  const chunks: string[][] = [];
  for (let i = 0; i < dealIds.length; i += CHUNK) chunks.push(dealIds.slice(i, i + CHUNK));
  const results = await Promise.all(chunks.map((ids) =>
    sb
      .from("deal_payments")
      .select("deal_id, side, payment_date")
      .in("deal_id", ids)
      .order("payment_date", { ascending: true }),
  ));
  const raw = new Map<string, { supplier: string[]; buyer: string[] }>();
  for (const res of results) {
    if (res.error) throw new Error(`Оплаты: ${res.error.message}`);
    for (const row of (res.data ?? []) as { deal_id: string; side: "supplier" | "buyer"; payment_date: string }[]) {
      const entry = raw.get(row.deal_id) ?? { supplier: [], buyer: [] };
      const d = fmtDate(row.payment_date);
      if (!entry[row.side].includes(d)) entry[row.side].push(d);
      raw.set(row.deal_id, entry);
    }
  }
  const out = new Map<string, PaymentDates>();
  for (const [dealId, e] of raw) {
    out.set(dealId, { supplier: e.supplier.join(", "), buyer: e.buyer.join(", ") });
  }
  return out;
}

// Batched registry fetch for the exported deals. PostgREST caps URL
// length, so the IN-list goes out in chunks; all chunks in parallel.
async function fetchShipmentsByDeals(dealIds: string[]): Promise<Map<string, DetailShipment[]>> {
  const { createClient } = await import("@/lib/supabase/client");
  const sb = createClient();
  const CHUNK = 150;
  const chunks: string[][] = [];
  for (let i = 0; i < dealIds.length; i += CHUNK) chunks.push(dealIds.slice(i, i + CHUNK));
  const results = await Promise.all(chunks.map((ids) =>
    sb
      .from("shipment_registry")
      .select("deal_id, registry_type, date, loading_volume, shipment_volume, shipped_tonnage_amount, rounded_volume_override, round_volume, railway_tariff, shipment_month, supplier_appendix, buyer_appendix")
      .in("deal_id", ids)
      .order("date", { ascending: true }),
  ));
  const byDeal = new Map<string, DetailShipment[]>();
  for (const res of results) {
    if (res.error) throw new Error(`Реестр отгрузок: ${res.error.message}`);
    // database.ts is stale on round_volume / supplier_appendix (same
    // note in use-registry.ts) — PostgREST returns them fine.
    for (const row of (res.data ?? []) as unknown as DetailShipment[]) {
      const arr = byDeal.get(row.deal_id) ?? [];
      arr.push(row);
      byDeal.set(row.deal_id, arr);
    }
  }
  return byDeal;
}

export async function exportPassportDetailToExcel(deals: Deal[], ctx: ExportContext): Promise<void> {
  const [{ fetchDealLinesForExport }, { getGlobalRefs, getCachedRefsSync }] = await Promise.all([
    import("@/lib/hooks/use-deals"),
    import("@/lib/refs"),
  ]);
  const refs = getCachedRefsSync() ?? await getGlobalRefs();
  const supplierById = new Map(refs.suppliers.map((c) => [c.id, c]));
  const buyerById = new Map(refs.buyers.map((c) => [c.id, c]));
  const factoryById = new Map(refs.factories.map((r) => [r.id, r]));
  const fuelById = new Map(refs.fuelTypes.map((r) => [r.id, r]));
  const forwarderById = new Map(refs.forwarders.map((r) => [r.id, r]));
  const managerById = new Map(refs.managers.map((p) => [p.id, p]));
  const cgById = new Map(refs.companyGroups.map((r) => [r.id, r]));

  const dealIds = deals.map((d) => d.id);
  const { createClient } = await import("@/lib/supabase/client");
  const sb = createClient();

  // Three parallel round-trips: lines (Биржа/цены), shipments (sub-rows),
  // full dcg rows (LIST_SELECT trims quotation/discount off the embed).
  const dcgChunks: string[][] = [];
  for (let i = 0; i < dealIds.length; i += 150) dcgChunks.push(dealIds.slice(i, i + 150));
  const [lines, shipmentsByDeal, paymentDatesByDeal, dcgResults] = await Promise.all([
    fetchDealLinesForExport(dealIds),
    fetchShipmentsByDeals(dealIds),
    fetchPaymentDatesByDeals(dealIds),
    Promise.all(dcgChunks.map((ids) =>
      sb
        .from("deal_company_groups")
        .select("deal_id, id, position, company_group_id, price, price_kind, quotation, discount")
        .in("deal_id", ids),
    )),
  ]);

  type DcgRow = { deal_id: string; id: string; position: number; company_group_id: string; price: number | null; price_kind: "preliminary" | "final"; quotation: number | null; discount: number | null };
  const dcgByDeal = new Map<string, DcgRow[]>();
  for (const res of dcgResults) {
    if (res.error) throw new Error(`Группы компании: ${res.error.message}`);
    // database.ts is stale on dcg.quotation/discount (added in 00089).
    for (const row of (res.data ?? []) as unknown as DcgRow[]) {
      const arr = dcgByDeal.get(row.deal_id) ?? [];
      arr.push(row);
      dcgByDeal.set(row.deal_id, arr);
    }
  }

  deals = deals.map((d) => {
    const s = d.supplier_id ? supplierById.get(d.supplier_id) : null;
    const b = d.buyer_id ? buyerById.get(d.buyer_id) : null;
    const f = d.factory_id ? factoryById.get(d.factory_id) : null;
    const ft = d.fuel_type_id ? fuelById.get(d.fuel_type_id) : null;
    const fw = d.forwarder_id ? forwarderById.get(d.forwarder_id) : null;
    const sm = d.supplier_manager_id ? managerById.get(d.supplier_manager_id) : null;
    const bm = d.buyer_manager_id ? managerById.get(d.buyer_manager_id) : null;
    const lcg = d.logistics_company_group_id ? cgById.get(d.logistics_company_group_id) : null;
    const payDates = paymentDatesByDeal.get(d.id);
    return {
      ...d,
      // Даты платежей из deal_payments; ручное TEXT-поле сделки — fallback.
      supplier_payment_date: payDates?.supplier || d.supplier_payment_date,
      buyer_payment_date: payDates?.buyer || d.buyer_payment_date,
      supplier: s ? { full_name: s.full_name, short_name: s.short_name } : d.supplier ?? null,
      buyer: b ? { full_name: b.full_name, short_name: b.short_name } : d.buyer ?? null,
      factory: f ? { name: f.name } : d.factory ?? null,
      fuel_type: ft ? { name: ft.name, color: ft.color ?? "#6B7280" } : d.fuel_type ?? null,
      forwarder: fw ? { name: fw.name } : d.forwarder ?? null,
      supplier_manager: sm ? { full_name: sm.full_name } : d.supplier_manager ?? null,
      buyer_manager: bm ? { full_name: bm.full_name } : d.buyer_manager ?? null,
      logistics_company_group: lcg ? { name: lcg.name } : d.logistics_company_group ?? null,
      deal_company_groups: (dcgByDeal.get(d.id) ?? []).map((g) => {
        const cg = cgById.get(g.company_group_id);
        return { ...g, company_group: cg ? { name: cg.name } : null };
      }),
      supplier_lines: lines.supplier.get(d.id) ?? d.supplier_lines ?? [],
      buyer_lines: lines.buyer.get(d.id) ?? d.buyer_lines ?? [],
    };
  });

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Singularity Trading CRM";
  wb.created = new Date();

  const sheetName =
    ctx.dealType === "KG" ? "Паспорт (дет.) KG" :
    ctx.dealType === "KZ" ? "Паспорт (дет.) KZ" :
    "Сделки (детально)";
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: "frozen", xSplit: 1, ySplit: 3 }],
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    properties: { outlineLevelRow: 1 } as never,
  });

  // ── Title row ────────────────────────────────────────────
  ws.getRow(1).height = 24;
  ws.mergeCells(1, 1, 1, COLUMNS.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `${sheetName} · ${ctx.year}${deals.length ? `  ·  ${deals.length} сделок` : ""}`;
  titleCell.font = { bold: true, size: 13, color: { argb: HEADER_TEXT } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };

  // ── Band row ─────────────────────────────────────────────
  ws.getRow(2).height = 18;
  let bandStart = 1;
  for (let i = 0; i < COLUMNS.length; i++) {
    const next = COLUMNS[i + 1];
    if (!next || next.band !== COLUMNS[i].band) {
      const style = BAND_STYLE[COLUMNS[i].band];
      if (i + 1 > bandStart) ws.mergeCells(2, bandStart, 2, i + 1);
      const cell = ws.getCell(2, bandStart);
      cell.value = style.label;
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.font = { bold: true, size: 10, color: { argb: style.text } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: style.bg } };
      cell.border = { top: { style: "thin", color: { argb: "FFE7E5E4" } }, bottom: { style: "thin", color: { argb: "FFE7E5E4" } } };
      bandStart = i + 2;
    }
  }

  // ── Column header row ────────────────────────────────────
  const headerRow = ws.getRow(3);
  headerRow.height = 30;
  COLUMNS.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    cell.font = { bold: true, size: 10, color: { argb: HEADER_TEXT } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.border = { bottom: { style: "medium", color: { argb: "FFD97706" } } };
    ws.getColumn(idx + 1).width = col.width;
    if (col.numFmt) ws.getColumn(idx + 1).numFmt = col.numFmt;
  });

  // ── Data rows: deal row + one sub-row per registry shipment ──
  let r = 4;
  for (const deal of deals) {
    const fuelHex = deal.fuel_type?.color ?? null;
    const fillArgb = blendArgbWithFuel("FFFFFFFF", fuelHex, 0.12);

    const dealRow = ws.getRow(r++);
    dealRow.height = 18;
    COLUMNS.forEach((col, colIdx) => {
      const cell = dealRow.getCell(colIdx + 1);
      const v = col.read(deal);
      cell.value = v == null ? "" : v;
      cell.font = { size: 10, name: "Calibri" };
      cell.alignment = { vertical: "middle", horizontal: col.numFmt ? "right" : "left" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
      cell.border = {
        right: { style: "thin", color: { argb: "FFE7E5E4" } },
        bottom: { style: "thin", color: { argb: "FFF5F5F4" } },
      };
      if (col.numFmt) cell.numFmt = col.numFmt;
    });
    for (const key of ["supplier_balance", "buyer_debt"] as const) {
      const idx = COLUMNS.findIndex((c) => c.key === key);
      if (idx === -1) continue;
      const cell = dealRow.getCell(idx + 1);
      if (typeof cell.value === "number" && cell.value < 0) {
        cell.font = { ...cell.font, bold: true, color: { argb: "FFB91C1C" } };
      }
    }

    // Sub-rows: collapsible under the deal (outlineLevel 1), same fuel
    // tint, muted deal-code so the eye separates deal rows from wagons.
    for (const ship of shipmentsByDeal.get(deal.id) ?? []) {
      const row = ws.getRow(r++);
      row.height = 16;
      row.outlineLevel = 1;
      COLUMNS.forEach((col, colIdx) => {
        const cell = row.getCell(colIdx + 1);
        const v = col.readShip ? col.readShip(deal, ship) : null;
        cell.value = v == null ? "" : v;
        cell.font = { size: 9.5, name: "Calibri", color: { argb: colIdx === 0 ? "FF78716C" : "FF44403C" } };
        cell.alignment = { vertical: "middle", horizontal: col.numFmt ? "right" : "left" };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
        cell.border = {
          right: { style: "thin", color: { argb: "FFE7E5E4" } },
          bottom: { style: "thin", color: { argb: "FFF5F5F4" } },
        };
        if (col.numFmt) cell.numFmt = col.numFmt;
      });
    }
  }

  // ── Totals row: main deal rows only (sub-rows would double-count) ──
  if (deals.length > 0) {
    const totalRow = ws.getRow(r);
    totalRow.height = 22;
    const TOTAL_KEYS = new Set([
      "supplier_volume", "supplier_amount", "supplier_shipped_amount",
      "supplier_shipped_volume", "supplier_payment", "supplier_balance",
      "buyer_volume", "buyer_amount", "buyer_ordered_volume", "buyer_remainder",
      "buyer_shipped_volume", "buyer_shipped_amount", "buyer_payment", "buyer_debt",
      "preliminary_tonnage", "preliminary_amount", "actual_shipped_volume",
      "invoice_volume", "invoice_amount",
    ]);
    COLUMNS.forEach((col, idx) => {
      const cell = totalRow.getCell(idx + 1);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
      cell.font = { bold: true, size: 10 };
      cell.border = { top: { style: "medium", color: { argb: "FFD97706" } } };
      if (idx === 0) {
        cell.value = "Итого";
        cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      } else if (TOTAL_KEYS.has(col.key)) {
        let sum = 0;
        for (const d of deals) {
          const v = col.read(d);
          if (typeof v === "number" && Number.isFinite(v)) sum += v;
        }
        cell.value = sum;
        cell.alignment = { vertical: "middle", horizontal: "right" };
        if (col.numFmt) cell.numFmt = col.numFmt;
      }
    });
  }

  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: COLUMNS.length } };

  // ── Download ────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const datestamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `passport-detail-${ctx.dealType.toLowerCase()}-${ctx.year}-${datestamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
