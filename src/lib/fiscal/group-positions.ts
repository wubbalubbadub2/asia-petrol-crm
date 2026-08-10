/**
 * Свод строк фискального документа в позиции бланка ИС ЭСФ.
 *
 * Позиция бланка — это ГРУППА строк с одним `snt_line_no`, а не строка
 * табличной части. 1С раскладывает одну позицию по записям-остаткам
 * виртуального склада: в боевой выгрузке СНТ
 * KZ-SNT-3020-200240037215-20251221-50229974 содержит 88 строк при двух
 * позициях (41 и 47). Контрагент в ИС ЭСФ видит две; менеджер должен
 * видеть то же самое, а разложение — раскрытием второго уровня.
 *
 * У ЭСФ `snt_line_no` пуст всегда, поэтому там группировка вырождается:
 * каждая строка — своя позиция, номер берётся из `line_no`.
 *
 * Чего здесь НЕТ намеренно:
 *   • пересчёта валют — суммы остаются в валюте документа;
 *   • сведе́ния quantity и net_weight — они приходят в РАЗНЫХ единицах
 *     (наблюдалось 59.744 т и 59744 кг на одной строке). net_weight
 *     живёт только на строках раскрытия, в позицию не попадает.
 */

export type FiscalLine = {
  id: string;
  line_no: number | null;
  snt_line_no: number | null;
  name: string | null;
  pin_code: string | null;
  source_lot_id: string | null;
  quantity: number | null;
  unit: string | null;
  net_weight: number | null;
  storage_unit: string | null;
  price: number | null;
  amount_net: number | null;
  amount: number | null;
  vat_amount: number | null;
};

export type FiscalPosition = {
  /** Ключ React. Внутри документа уникален. */
  key: string;
  /** Номер позиции ИС ЭСФ; у ЭСФ null. */
  sntLineNo: number | null;
  /** Что показывать в колонке «№»: позиция бланка либо номер строки. */
  positionNo: number | null;
  name: string | null;
  pinCode: string | null;
  unit: string | null;
  /** Цена позиции. null, если внутри группы она разошлась. */
  price: number | null;
  priceVaries: boolean;
  /**
   * Сумма количества по группе. null, если единицы внутри группы
   * разошлись: складывать тонны с килограммами нельзя, а показать
   * число, которое ничего не значит, хуже, чем показать прочерк.
   */
  quantity: number | null;
  unitVaries: boolean;
  amountNet: number | null;
  amount: number | null;
  vatAmount: number | null;
  /** Исходные строки, отсортированные по line_no. Раскрытие. */
  lines: FiscalLine[];
};

/** Сумма без null-мусора: если слагаемых нет вовсе — null, а не 0. */
function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

/** Все непустые значения одинаковы? Пустые в сравнении не участвуют. */
function uniform<T>(values: (T | null)[]): { value: T | null; varies: boolean } {
  const present = values.filter((v): v is T => v != null);
  if (!present.length) return { value: null, varies: false };
  const first = present[0];
  return { value: first, varies: present.some((v) => v !== first) };
}

const sortKey = (v: number | null) => (v == null ? Number.MAX_SAFE_INTEGER : v);

export function groupPositions(lines: FiscalLine[]): FiscalPosition[] {
  const groups = new Map<string, FiscalLine[]>();

  for (const line of lines) {
    // У ЭСФ snt_line_no пуст — группируем по номеру строки, чтобы
    // каждая осталась самостоятельной позицией. Префикс нужен, чтобы
    // ключи двух режимов не столкнулись, если документ окажется
    // смешанным.
    const key = line.snt_line_no != null ? `snt:${line.snt_line_no}` : `line:${line.line_no}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(line);
    else groups.set(key, [line]);
  }

  const positions: FiscalPosition[] = [];

  for (const [key, bucket] of groups) {
    const sorted = [...bucket].sort((a, b) => sortKey(a.line_no) - sortKey(b.line_no));
    const price = uniform(sorted.map((l) => l.price));
    const unit = uniform(sorted.map((l) => l.unit));
    const head = sorted[0];

    positions.push({
      key,
      sntLineNo: head.snt_line_no,
      positionNo: head.snt_line_no ?? head.line_no,
      name: uniform(sorted.map((l) => l.name)).value,
      pinCode: uniform(sorted.map((l) => l.pin_code)).value,
      unit: unit.value,
      price: price.varies ? null : price.value,
      priceVaries: price.varies,
      quantity: unit.varies ? null : sumOrNull(sorted.map((l) => l.quantity)),
      unitVaries: unit.varies,
      amountNet: sumOrNull(sorted.map((l) => l.amount_net)),
      amount: sumOrNull(sorted.map((l) => l.amount)),
      vatAmount: sumOrNull(sorted.map((l) => l.vat_amount)),
      lines: sorted,
    });
  }

  return positions.sort((a, b) => sortKey(a.positionNo) - sortKey(b.positionNo));
}

/** Итог документа по позициям — для подвала карточки. */
export function totalOfPositions(positions: FiscalPosition[]): number | null {
  return sumOrNull(positions.map((p) => p.amount));
}
