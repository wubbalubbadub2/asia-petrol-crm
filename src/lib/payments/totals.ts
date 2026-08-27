/**
 * Разделение оплат сделки на брутто, возвраты и взаимозачёты.
 *
 * Конвенция знака (00145 поверх 00062):
 *   • 'payment' — оплата, знак хранится в самой сумме (минус = возврат);
 *   • 'refund'  — историческая строка, лежит ПЛЮСОМ и вычитается;
 *   • 'offset'  — взаимозачёт, хранится СО СВОИМ знаком и ПРИБАВЛЯЕТСЯ.
 *
 * Нетто-итог = брутто − возвраты + взаимозачёты; ровно это пишет в
 * deals.supplier_payment / buyer_payment функция refresh_deal_payment_totals
 * (00145), и его же читают триггеры баланса (00021/00052/00060/00112).
 * Вся арифметика знака живёт здесь, а не размазана по компонентам и
 * выгрузкам.
 */
export type PaymentTypeish = string | null | undefined;

type PaymentLike = { amount: number | null; payment_type: PaymentTypeish };

/** Взаимозачёт (00145): отдельная сущность, в колонку «Оплата» не входит. */
export function isOffsetKind(t: PaymentTypeish): boolean {
  return t === "offset";
}

/**
 * Строка НЕ является обычной оплатой: возврат или взаимозачёт.
 * Используется там, где нужно оставить в колонке «Оплата» только
 * payment_type='payment' — сами величины возврата и взаимозачёта
 * складываются по-разному, см. splitPaymentTotals.
 */
export function isRefundKind(t: PaymentTypeish): boolean {
  return t === "refund" || t === "offset";
}

/**
 * Вклад строки в НЕТТО-итог: возврат уходит в минус, взаимозачёт идёт
 * со своим знаком.
 * Ноль возвращаем без домножения — иначе `0 * -1` даёт -0, и пустая
 * строка оплаты отрисовалась бы в таблице как «−0,00».
 */
export function signedAmount(p: PaymentLike): number {
  const v = p.amount ?? 0;
  if (v === 0) return 0;
  return p.payment_type === "refund" ? -v : v;
}

export type PaymentTotals = {
  /** Только payment_type='payment'. Колонка «Оплата». */
  gross: number;
  /** Только payment_type='refund', ПОЛОЖИТЕЛЬНОЕ. Исторические строки. */
  refund: number;
  /** Только payment_type='offset', СО ЗНАКОМ. Колонка «Взаимозачет». */
  offset: number;
  /** gross − refund + offset. То, что читают формулы баланса. */
  net: number;
};

export function splitPaymentTotals(items: readonly PaymentLike[]): PaymentTotals {
  let gross = 0;
  let refund = 0;
  let offset = 0;
  for (const p of items) {
    const v = p.amount ?? 0;
    if (p.payment_type === "refund") refund += v;
    else if (isOffsetKind(p.payment_type)) offset += v;
    else gross += v;
  }
  return { gross, refund, offset, net: gross - refund + offset };
}

/**
 * Итог взаимозачётов сделки ровно так, как его считает
 * refresh_deal_payment_totals (00145): суммируются только строки в
 * валюте сделки, `currency IS NULL` означает «валюта сделки».
 *
 * Нужен фронту для оптимистичного пересчёта: без фильтра по валюте
 * ячейка показала бы одно число, а сервер вернул бы другое.
 */
export function offsetTotalInDealCurrency(
  items: readonly (PaymentLike & { currency: string | null })[],
  dealCurrency: string | null,
): number {
  let sum = 0;
  for (const p of items) {
    if (!isOffsetKind(p.payment_type)) continue;
    if (p.currency != null && p.currency !== dealCurrency) continue;
    sum += p.amount ?? 0;
  }
  return sum;
}
