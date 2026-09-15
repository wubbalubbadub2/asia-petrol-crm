// Тело попапа с отгрузками для тоннажных ячеек паспорта.
//
// Вынесено из passport-table.tsx отдельным модулем, чтобы итог можно
// было закрыть тестом: в попапе оплат итог есть, а здесь клиент
// 2026-09-15 попросил такой же — «по сумме отгруженного тоннажа
// (покупатель, поставщик) нужно summary внизу, как с оплатами делали».

import { formatDMY } from "@/lib/format";

export type ShipmentLine = {
  loading_volume: number | null;
  shipment_volume: number | null;
  date: string | null;
};

const vol = (v: number) =>
  v.toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/**
 * Заголовок «N отгрузок», строки «ДД.ММ.ГГ: объём» по возрастанию даты
 * и итог внизу. Строки без объёма по нужному полю отбрасываются — они
 * относятся к другой стороне сделки и в сумму попасть не должны.
 *
 * Итог считается по ПОКАЗАННЫМ строкам. Это осознанно: ячейка рядом
 * показывает роллап из БД, и если он разойдётся со списком, разница
 * будет видна глазами — ровно тот случай, что чинили в 00131.
 */
export function shipmentLines(
  shipments: ShipmentLine[],
  field: "loading_volume" | "shipment_volume",
): string {
  const rows = shipments
    .filter((s) => s[field] != null)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  if (rows.length === 0) return "Нет отгрузок";

  const body = rows.map((s) => {
    const d = s.date ? formatDMY(s.date) : "—";
    return `${d}: ${vol(s[field] as number)}`;
  });

  const total = rows.reduce((acc, s) => acc + (s[field] as number), 0);
  const word = rows.length === 1 ? "отгрузка" : rows.length < 5 ? "отгрузки" : "отгрузок";

  // Разделитель по ширине самой длинной строки: шрифт попапа
  // моноширинный, поэтому итог встаёт ровно под столбцом объёмов.
  const totalLine = `Итого: ${vol(total)}`;
  const width = Math.max(...body.map((l) => l.length), totalLine.length);

  return [
    `${rows.length} ${word}`,
    ...body,
    "─".repeat(width),
    totalLine,
  ].join("\n");
}
