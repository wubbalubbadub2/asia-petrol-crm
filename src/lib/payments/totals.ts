/**
 * Разделение оплат сделки на брутто и возвраты/перезачёты.
 *
 * В deal_payments.amount сумма лежит ВСЕГДА плюсом, знак задаёт
 * payment_type: 'refund' и 'offset' минусуют (миграция 00062).
 * Нетто-итог = брутто − возвраты; именно нетто читают триггеры
 * баланса (00021/00052/00060/00112), поэтому вся арифметика знака
 * живёт здесь, а не размазана по компонентам и выгрузкам.
 */
export type PaymentTypeish = string | null | undefined;

type PaymentLike = { amount: number | null; payment_type: PaymentTypeish };

/** Возврат и перезачёт численно идентичны — различается только подпись (00062). */
export function isRefundKind(t: PaymentTypeish): boolean {
  return t === "refund" || t === "offset";
}

/**
 * Вклад строки в НЕТТО-итог: возврат/перезачёт уходит в минус.
 * Ноль возвращаем без домножения — иначе `0 * -1` даёт -0, и пустая
 * строка оплаты отрисовалась бы в таблице как «−0,00».
 */
export function signedAmount(p: PaymentLike): number {
  const v = p.amount ?? 0;
  if (v === 0) return 0;
  return isRefundKind(p.payment_type) ? -v : v;
}

export type PaymentTotals = {
  /** Только payment_type='payment'. Колонка «Оплата». */
  gross: number;
  /** refund + offset, ПОЛОЖИТЕЛЬНОЕ. Колонка «Возврат/Перезачет». */
  refund: number;
  /** gross − refund. То, что читают формулы баланса. */
  net: number;
};

export function splitPaymentTotals(items: readonly PaymentLike[]): PaymentTotals {
  let gross = 0;
  let refund = 0;
  for (const p of items) {
    if (isRefundKind(p.payment_type)) refund += p.amount ?? 0;
    else gross += p.amount ?? 0;
  }
  return { gross, refund, net: gross - refund };
}
