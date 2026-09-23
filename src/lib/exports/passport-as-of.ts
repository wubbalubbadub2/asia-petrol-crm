/**
 * Паспорт на дату — срез rollup-колонок сделки на выбранный день.
 *
 * Клиент 2026-09-17: «выгрузка паспорта в эксель на определённую дату».
 *
 * Считает срез Postgres (RPC `passport_snapshot_as_of`, миграция 00160):
 * все денежные колонки паспорта — это rollup'ы `deals`, которые пишут
 * триггеры, и пересчитывать их в React нельзя. Здесь только два шага:
 * забрать срез и наложить его на уже загруженные строки паспорта, чтобы
 * существующий экспортёр отработал без единой правки в колонках.
 *
 * Накрываются ТОЛЬКО перечисленные в SNAPSHOT_KEYS поля. Цены,
 * котировки, объёмы договора, контрагенты и цепочка групп остаются
 * текущими — истории у них нет (см. комментарий к миграции), и в шапке
 * файла это подписано.
 */

import { createClient } from "@/lib/supabase/client";
import type { Deal } from "@/lib/hooks/use-deals";

/** Строка ответа RPC: ключ + те же имена полей, что у колонок `deals`. */
export type PassportSnapshotRow = {
  deal_id: string;
} & Record<SnapshotKey, number | null>;

/**
 * Поля сделки, которые пересчитывает срез. Имена совпадают с колонками
 * `deals` и с именами в RETURNS TABLE миграции 00160 — за счёт этого
 * наложение ниже не содержит ни одного ручного соответствия.
 */
export const SNAPSHOT_KEYS = [
  "supplier_shipped_volume",
  "supplier_shipped_amount",
  "supplier_payment_gross",
  "supplier_refund_total",
  "supplier_offset_total",
  "supplier_payment",
  "supplier_railway_amount",
  "additional_expenses_amount",
  "supplier_balance",
  "buyer_shipped_volume",
  "buyer_shipped_amount",
  "buyer_payment_gross",
  "buyer_refund_total",
  "buyer_offset_total",
  "buyer_payment",
  "buyer_debt",
  "actual_shipped_volume",
  "invoice_amount",
  "actual_tariff",
  "shipper_actual_tariff",
] as const;

type SnapshotKey = (typeof SNAPSHOT_KEYS)[number];

// database.ts генерится с удалённой схемы и о новых RPC не знает —
// узкий структурный каст, тот же приём, что в use-fx-reports.ts.
// .rpc зовём КАК МЕТОД клиента, иначе теряется this-binding.
type RpcResult = { data: unknown; error: { message: string } | null };
type RpcBuilder = PromiseLike<RpcResult> & {
  order: (column: string) => RpcBuilder;
  range: (from: number, to: number) => PromiseLike<RpcResult>;
};
type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => RpcBuilder };

/**
 * Срез по указанным сделкам. Постранично: PostgREST режет ответ
 * табличной функции на 1000 строк, а в паспорте бывает больше сделок —
 * без пагинации хвост выгрузки молча остался бы с текущими цифрами.
 */
export async function fetchPassportSnapshot(
  asOf: string,
  dealIds: string[],
): Promise<Map<string, PassportSnapshotRow>> {
  const byDeal = new Map<string, PassportSnapshotRow>();
  if (dealIds.length === 0) return byDeal;

  const sb = createClient() as unknown as RpcClient;
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .rpc("passport_snapshot_as_of", { p_date: asOf, p_deal_ids: dealIds })
      // Срез отдаёт по строке на сделку, поэтому deal_id уникален и
      // задаёт полный порядок строк для постраничного чтения.
      .order("deal_id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as PassportSnapshotRow[];
    for (const row of rows) byDeal.set(row.deal_id, row);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return byDeal;
}

/**
 * Накладывает срез на строки паспорта.
 *
 * Сделки, по которым срез не вернулся, в файл НЕ идут: строка с
 * сегодняшними цифрами в выгрузке «на дату» врала бы молча. Их id
 * возвращаются отдельно, чтобы страница могла предупредить оператора.
 */
export function applyPassportSnapshot(
  deals: Deal[],
  snapshot: Map<string, PassportSnapshotRow>,
): { deals: Deal[]; missing: string[] } {
  const out: Deal[] = [];
  const missing: string[] = [];
  for (const deal of deals) {
    const row = snapshot.get(deal.id);
    if (!row) {
      missing.push(deal.id);
      continue;
    }
    const patched = { ...deal } as Deal & Record<SnapshotKey, number | null>;
    for (const key of SNAPSHOT_KEYS) {
      patched[key] = row[key] ?? null;
    }
    out.push(patched);
  }
  return { deals: out, missing };
}
