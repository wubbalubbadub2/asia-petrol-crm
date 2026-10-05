/**
 * «Закупка» — предыстория сделки KG: у кого наша компания (Taur Trading /
 * НАЗС / Таур Импекс — поставщики с флагом is_own_supplier) купила
 * топливо по приложению. Одна закупка питает несколько сделок KG,
 * сделка ссылается не больше чем на одну (deals.upstream_purchase_id).
 *
 * Цены здесь нет и на балансы закупка не влияет. «Продано» и «Остаток»
 * считает БД (вью deal_upstream_purchase_totals) — в React их не
 * пересчитываем, только показываем.
 *
 * Таблица, вью и колонки появились миграцией закупок; в сгенерированном
 * database.ts их пока нет, поэтому типы строк описаны здесь вручную.
 */

// Форма встраивания закупки в список сделок (LIST_SELECT в use-deals.ts).
export type UpstreamPurchaseEmbed = {
  appendix: string | null;
  // numeric приходит из PostgREST числом, но на всякий случай терпим строку.
  volume_tons: number | string | null;
  seller: { short_name: string | null; full_name: string } | null;
};

/** Строка deal_upstream_purchases (как её читает карточка сделки). */
export type UpstreamPurchase = {
  id: string;
  our_company_id: string;
  seller_id: string;
  factory_id: string;
  fuel_type_id: string;
  appendix: string;
  volume_tons: number | string;
  comment: string | null;
  seller?: { short_name: string | null; full_name: string } | null;
};

/** Строка вью deal_upstream_purchase_totals. */
export type UpstreamPurchaseTotals = {
  purchase_id: string;
  deal_count: number;
  sold_tons: number | string | null;
  remaining_tons: number | string | null;
};

function toNum(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Краткое имя продавца, иначе полное — как везде в паспорте. */
export function sellerLabel(seller: { short_name: string | null; full_name: string } | null | undefined): string {
  if (!seller) return "";
  return seller.short_name || seller.full_name || "";
}

type WithUpstream = { upstream_purchase?: UpstreamPurchaseEmbed | null };

/** «У кого купили» для строки паспорта / выгрузки. */
export function upstreamSeller(d: WithUpstream): string {
  return sellerLabel(d.upstream_purchase?.seller);
}

/** «Номер приложения» закупки. */
export function upstreamAppendix(d: WithUpstream): string {
  return d.upstream_purchase?.appendix ?? "";
}

/** «Объём выкупа», т. Итог по колонке НЕ считается: одна закупка стоит
 *  в нескольких сделках, и сумма по строкам удвоила бы объём. */
export function upstreamVolume(d: WithUpstream): number | null {
  return toNum(d.upstream_purchase?.volume_tons);
}

/** Числа из вью — как числа (или null, если строки во вью нет). */
export function totalsNumbers(t: UpstreamPurchaseTotals | null | undefined): { sold: number; remaining: number | null; dealCount: number } {
  return {
    sold: toNum(t?.sold_tons) ?? 0,
    remaining: toNum(t?.remaining_tons),
    dealCount: t?.deal_count ?? 0,
  };
}

/** Остаток ушёл в минус — продали больше, чем закупили. Сохранять это
 *  можно (правило согласовано), но оператор должен это видеть. */
export function isOversold(remaining: number | null | undefined): boolean {
  return remaining != null && remaining < 0;
}

/** Блок «Закупка» показывается только в сделке KG, у которой поставщик —
 *  наша компания, либо если сделка уже привязана к закупке. */
export function showsUpstreamBlock(
  dealType: string,
  supplierIsOwn: boolean | null | undefined,
  linkedPurchaseId: string | null | undefined,
): boolean {
  if (dealType !== "KG") return false;
  return !!supplierIsOwn || !!linkedPurchaseId;
}
