/**
 * Виды взаимозачёта (00145). Общие для карточки сделки и паспорта —
 * подписи и порядок не должны разъезжаться между экранами.
 *
 * bilateral  — двусторонний: указывает встречную сделку, и в ней
 *              триггер sync_offset_mirror держит зеркальную строку с
 *              противоположным знаком.
 * trilateral — трёхсторонний: зеркала нет, встречная сделка в БД
 *              запрещена CHECK-констрейнтом deal_payments_
 *              counterparty_only_bilateral_chk.
 */
export type OffsetKind = "bilateral" | "trilateral";

export const OFFSET_KIND_LABELS: Record<string, string> = {
  bilateral: "2-х сторонний",
  trilateral: "3-х сторонний",
};

export const OFFSET_KINDS: readonly OffsetKind[] = ["bilateral", "trilateral"];

/** Подпись вида для строки, у которой вид ещё не проставлен (строки до 00145). */
export function offsetKindLabel(kind: string | null | undefined): string {
  return kind ? OFFSET_KIND_LABELS[kind] ?? kind : "вид не указан";
}
