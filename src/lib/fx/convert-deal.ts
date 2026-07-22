/**
 * Пересчёт сделки в выбранную валюту для отчёта «Сбор по валюте».
 *
 * Чистая функция: никакой сети, никакого React. Каждая денежная
 * величина пересобирается из СОБЫТИЙ, и каждое событие берёт курс
 * своей даты — хранимые итоги сделки сконвертировать нельзя, у них
 * нет даты.
 *
 * Источники (проверено на живой БД 2026-07-22):
 *   Приход / Отгружено сумма — deal_shipment_prices (у строки есть
 *     собственная shipment_date; сумма правится вручную в карточке
 *     Триггер/Фикс/Средний месяц, поэтому «цена × объём» пересчитывать
 *     НЕЛЬЗЯ — разойдётся с паспортом);
 *   Оплаты — deal_payments (знак уже применён на загрузке);
 *   Сумма жд и грузоотправителя — shipment_registry.
 *
 * Баланс и Долг повторяют формулу БД (compute_deal_derived_fields,
 * миграция 00112) слово в слово. Условие «валюта сделки == валюта
 * логистики» проверяется по ИСХОДНЫМ валютам: после конвертации оно
 * выполнялось бы всегда, и баланс разошёлся бы с паспортом по
 * составу, а не только по курсу.
 */
import type { Deal } from "@/lib/hooks/use-deals";
import type { FxRates } from "@/lib/fx/rates";

export type PriceRow = {
  deal_id: string;
  side: "supplier" | "buyer";
  amount: number | null;
  shipment_date: string | null;
};

export type PaymentRow = {
  deal_id: string;
  side: "supplier" | "buyer";
  amount: number | null;      // знак уже применён (возврат/перезачёт → минус)
  payment_date: string | null;
  currency: string | null;
};

export type LogisticsRow = {
  deal_id: string;
  loading_date: string | null;   // входящее СНТ — по нему считается логистика
  date: string | null;           // исходящее СНТ — фолбэк, если входящей нет
  shipped_tonnage_amount: number | null;
  additional_expenses: number | null;
  currency: string | null;
};

export type DealEvents = {
  prices: PriceRow[];
  payments: PaymentRow[];
  logistics: LogisticsRow[];
};

export type FxDealRow = {
  id: string;
  dealCode: string;
  month: string | null;
  factory: string;
  fuel: string;
  supplier: string;
  supplierContract: string;
  supplierPrice: number | null;
  supplierAmount: number | null;
  supplierVolume: number | null;
  supplierPayment: number | null;
  supplierBalance: number | null;
  chain: string;
  buyer: string;
  buyerContract: string;
  buyerPrice: number | null;
  buyerVolume: number | null;
  buyerAmount: number | null;
  buyerPayment: number | null;
  buyerDebt: number | null;
  forwarder: string;
  logisticsGroup: string;
  actualTariff: number | null;
  actualVolume: number | null;
  railAmount: number | null;
  shipperAmount: number | null;
  /** Хоть одна сумма не сконвертировалась — не хватило курса. */
  incomplete: boolean;
};

const MONTHS_RU = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

export function monthNumRu(month: string | null): number | null {
  if (!month) return null;
  const i = MONTHS_RU.indexOf(month.trim().toLowerCase());
  return i === -1 ? null : i + 1;
}

// Сумма списка событий в целевой валюте. Если хоть одно событие не
// сконвертировалось — возвращаем null: показать заниженную сумму
// хуже, чем показать пустую ячейку.
function sumConverted<T>(
  items: T[],
  amountOf: (x: T) => number | null,
  dateOf: (x: T) => string | null,
  currencyOf: (x: T) => string,
  fx: FxRates,
  target: string,
  fallback: { year: number; month: number } | null,
): number | null {
  let total = 0;
  for (const it of items) {
    const raw = amountOf(it);
    if (raw == null) continue;
    const v = fx.convert(raw, currencyOf(it), target, dateOf(it), fallback);
    if (v == null) return null;
    total += v;
  }
  return total;
}

function divide(amount: number | null, volume: number | null): number | null {
  if (amount == null || volume == null || volume === 0) return null;
  return amount / volume;
}

export function convertDeal(
  deal: Deal,
  events: DealEvents,
  fx: FxRates,
  target: string,
): FxDealRow {
  const m = monthNumRu(deal.month);
  const fallback = deal.year != null && m != null ? { year: deal.year, month: m } : null;

  const supplierPrices = events.prices.filter((p) => p.side === "supplier");
  const buyerPrices = events.prices.filter((p) => p.side === "buyer");
  const supplierPays = events.payments.filter((p) => p.side === "supplier");
  const buyerPays = events.payments.filter((p) => p.side === "buyer");

  const supplierAmount = sumConverted(
    supplierPrices, (p) => p.amount, (p) => p.shipment_date,
    () => deal.supplier_currency, fx, target, fallback,
  );
  const buyerAmount = sumConverted(
    buyerPrices, (p) => p.amount, (p) => p.shipment_date,
    () => deal.buyer_currency, fx, target, fallback,
  );
  const supplierPayment = sumConverted(
    supplierPays, (p) => p.amount, (p) => p.payment_date,
    (p) => p.currency ?? deal.supplier_currency, fx, target, fallback,
  );
  const buyerPayment = sumConverted(
    buyerPays, (p) => p.amount, (p) => p.payment_date,
    (p) => p.currency ?? deal.buyer_currency, fx, target, fallback,
  );

  // Логистика — по дате ВХОДЯЩЕГО СНТ (ТЗ: «оплата экспедитору так же
  // берётся по дате входящего СНТ»); если её нет — по исходящему.
  const logisticsDate = (r: LogisticsRow) => r.loading_date ?? r.date;
  const logisticsCur = (r: LogisticsRow) => r.currency ?? deal.logistics_currency;
  const railAmount = sumConverted(
    events.logistics, (r) => r.shipped_tonnage_amount, logisticsDate,
    logisticsCur, fx, target, fallback,
  );
  const shipperAmount = sumConverted(
    events.logistics, (r) => r.additional_expenses, logisticsDate,
    logisticsCur, fx, target, fallback,
  );

  // Формула паспорта (00112). Галочки смотрят на ИСХОДНЫЕ валюты.
  const railInPrice = deal.railway_in_price === true && deal.supplier_currency === deal.logistics_currency;
  const shipperInPrice = deal.additional_expenses_in_price === true && deal.supplier_currency === deal.logistics_currency;
  const balanceParts: (number | null)[] = [supplierAmount, supplierPayment];
  if (railInPrice) balanceParts.push(railAmount);
  if (shipperInPrice) balanceParts.push(shipperAmount);
  const supplierBalance = balanceParts.some((x) => x == null)
    ? null
    : (supplierAmount as number) - (supplierPayment as number)
      + (railInPrice ? (railAmount as number) : 0)
      + (shipperInPrice ? (shipperAmount as number) : 0);

  const buyerDebt = buyerPayment == null || buyerAmount == null
    ? null
    : buyerPayment - buyerAmount;

  const supplierVolume = deal.supplier_shipped_volume;
  const buyerVolume = deal.buyer_shipped_volume;
  const actualVolume = deal.actual_shipped_volume;

  const chain = (deal.deal_company_groups ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((g) => g.company_group?.name)
    .filter((n): n is string => !!n)
    .join(" → ");

  const money = [supplierAmount, buyerAmount, supplierPayment, buyerPayment, railAmount, shipperAmount];
  const incomplete = money.some((x) => x == null) || supplierBalance == null || buyerDebt == null;

  return {
    id: deal.id,
    dealCode: deal.deal_code,
    month: deal.month,
    factory: deal.factory?.name ?? "",
    fuel: deal.fuel_type?.name ?? "",
    supplier: deal.supplier?.short_name ?? deal.supplier?.full_name ?? "",
    supplierContract: deal.supplier_contract ?? "",
    supplierPrice: divide(supplierAmount, supplierVolume),
    supplierAmount,
    supplierVolume,
    supplierPayment,
    supplierBalance,
    chain,
    buyer: deal.buyer?.short_name ?? deal.buyer?.full_name ?? "",
    buyerContract: deal.buyer_contract ?? "",
    buyerPrice: divide(buyerAmount, buyerVolume),
    buyerVolume,
    buyerAmount,
    buyerPayment,
    buyerDebt,
    forwarder: deal.forwarder?.name ?? "",
    logisticsGroup: deal.logistics_company_group?.name ?? "",
    actualTariff: divide(railAmount, actualVolume),
    actualVolume,
    railAmount,
    shipperAmount,
    incomplete,
  };
}
