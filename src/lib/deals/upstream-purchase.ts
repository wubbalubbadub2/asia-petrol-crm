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
  // Оплаты нашей компании первичному поставщику (00181).
  payments?: UpstreamPayment[] | null;
};

/** Оплата по закупке (deal_upstream_purchase_payments, 00181). */
export type UpstreamPayment = {
  id?: string;
  amount: number | string;
  currency: string;
  payment_date: string;
  comment?: string | null;
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

/** «Первичный поставщик» для строки паспорта / выгрузки. */
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

const fmtMoney = (n: number) =>
  n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * «Сумма оплаты» в паспорте / выгрузке: по валютам, без пересчёта —
 * «150 000,75 USD; 9 000 000,00 KZT». Одна закупка стоит в нескольких
 * сделках, поэтому в «Итого» колонка не суммируется. Карточка сделки
 * берёт тот же итог из вью deal_upstream_purchase_payment_totals.
 */
export function upstreamPaidByCurrency(d: WithUpstream): { currency: string; amount: number }[] {
  const byCur = new Map<string, number>();
  for (const p of d.upstream_purchase?.payments ?? []) {
    const n = toNum(p.amount);
    if (n == null) continue;
    // Копейки — целыми, чтобы сумма не набирала хвост двоичной дроби.
    byCur.set(p.currency, (byCur.get(p.currency) ?? 0) + Math.round(n * 100));
  }
  return [...byCur.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, cents]) => ({ currency, amount: cents / 100 }));
}

export function upstreamPaidLabel(d: WithUpstream): string {
  return upstreamPaidByCurrency(d).map((x) => `${fmtMoney(x.amount)} ${x.currency}`).join("; ");
}

/** «Дата оплаты» — последняя оплата по закупке, `YYYY-MM-DD` или null. */
export function upstreamLastPaymentDate(d: WithUpstream): string | null {
  let last: string | null = null;
  for (const p of d.upstream_purchase?.payments ?? []) {
    if (p.payment_date && (last == null || p.payment_date > last)) last = p.payment_date;
  }
  return last;
}
