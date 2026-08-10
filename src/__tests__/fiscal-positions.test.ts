import { describe, expect, it } from "vitest";

import { groupPositions, totalOfPositions, type FiscalLine } from "@/lib/fiscal/group-positions";

let seq = 0;
const line = (over: Partial<FiscalLine>): FiscalLine => ({
  id: `l${++seq}`,
  line_no: 1,
  snt_line_no: null,
  name: "Топливо для реактивных двигателей марки ТС-1",
  pin_code: "18500034245",
  source_lot_id: null,
  quantity: 0,
  unit: "т",
  net_weight: 0,
  storage_unit: null,
  price: 553682.81,
  amount_net: 0,
  amount: 0,
  vat_amount: 0,
  ...over,
});

describe("свод позиций СНТ", () => {
  // Боевой документ KZ-SNT-3020-200240037215-20251221-50229974:
  // 88 строк, две позиции бланка, внутри позиции различаются только
  // партия-источник и количество.
  const snt = [
    line({ line_no: 1, snt_line_no: 1, quantity: 94.912, amount_net: 52551142.71, amount: 58857279.83, vat_amount: 6306137.12, source_lot_id: "480930131" }),
    line({ line_no: 2, snt_line_no: 1, quantity: 0.8, amount_net: 442946.25, amount: 496099.8, vat_amount: 53153.55, source_lot_id: "481890338" }),
    line({ line_no: 3, snt_line_no: 1, quantity: 0.341, amount_net: 188805.84, amount: 211462.54, vat_amount: 22656.7, source_lot_id: "481891725" }),
    line({ line_no: 42, snt_line_no: 2, quantity: 0.281, price: 553571.43, amount_net: 155553.57, amount: 174220, vat_amount: 18666.43, source_lot_id: "494332651" }),
    line({ line_no: 43, snt_line_no: 2, quantity: 0.362, price: 553571.43, amount_net: 200392.86, amount: 224440, vat_amount: 24047.14, source_lot_id: "494333856" }),
  ];

  it("схлопывает строки в позиции по snt_line_no", () => {
    const positions = groupPositions(snt);
    expect(positions).toHaveLength(2);
    expect(positions[0].sntLineNo).toBe(1);
    expect(positions[0].lines).toHaveLength(3);
    expect(positions[1].sntLineNo).toBe(2);
    expect(positions[1].lines).toHaveLength(2);
  });

  it("складывает количество и суммы внутри позиции", () => {
    const [first] = groupPositions(snt);
    expect(first.quantity).toBeCloseTo(96.053, 6);
    expect(first.amountNet).toBeCloseTo(53182894.8, 2);
    expect(first.amount).toBeCloseTo(59564842.17, 2);
    expect(first.vatAmount).toBeCloseTo(6381947.37, 2);
  });

  it("цена одна на позицию, когда она не менялась", () => {
    const positions = groupPositions(snt);
    expect(positions[0].price).toBe(553682.81);
    expect(positions[0].priceVaries).toBe(false);
    expect(positions[1].price).toBe(553571.43);
  });

  it("расхождение цены внутри позиции не прячется под первым значением", () => {
    const [p] = groupPositions([
      line({ line_no: 1, snt_line_no: 1, price: 100 }),
      line({ line_no: 2, snt_line_no: 1, price: 200 }),
    ]);
    expect(p.priceVaries).toBe(true);
    expect(p.price).toBeNull();
  });

  it("разные единицы внутри позиции гасят сумму количества", () => {
    // Складывать тонны с килограммами нельзя. Прочерк честнее числа.
    const [p] = groupPositions([
      line({ line_no: 1, snt_line_no: 1, quantity: 1.5, unit: "т" }),
      line({ line_no: 2, snt_line_no: 1, quantity: 1500, unit: "кг" }),
    ]);
    expect(p.unitVaries).toBe(true);
    expect(p.quantity).toBeNull();
    // Суммы при этом складываются: они в одной валюте документа.
    expect(p.amount).not.toBeNull();
  });

  it("net_weight в позицию не попадает — он в другой единице", () => {
    const [p] = groupPositions([
      line({ line_no: 1, snt_line_no: 1, quantity: 59.744, unit: "т", net_weight: 59744 }),
    ]);
    expect(p).not.toHaveProperty("netWeight");
    expect(p.quantity).toBe(59.744);
    expect(p.lines[0].net_weight).toBe(59744);
  });

  it("партия-источник доступна только в раскрытии", () => {
    const [p] = groupPositions(snt);
    expect(p.lines.map((l) => l.source_lot_id)).toEqual(["480930131", "481890338", "481891725"]);
  });

  it("позиции и строки внутри них идут по возрастанию номера", () => {
    const positions = groupPositions([
      line({ line_no: 43, snt_line_no: 2 }),
      line({ line_no: 2, snt_line_no: 1 }),
      line({ line_no: 42, snt_line_no: 2 }),
      line({ line_no: 1, snt_line_no: 1 }),
    ]);
    expect(positions.map((p) => p.sntLineNo)).toEqual([1, 2]);
    expect(positions[0].lines.map((l) => l.line_no)).toEqual([1, 2]);
    expect(positions[1].lines.map((l) => l.line_no)).toEqual([42, 43]);
  });

  it("итог документа складывается из сумм позиций", () => {
    expect(totalOfPositions(groupPositions(snt))).toBeCloseTo(59963502.17, 2);
  });
});

describe("свод позиций ЭСФ", () => {
  // У ЭСФ snt_line_no пуст всегда — 7914 строк из 7914 в первой выгрузке.
  const esf = [
    line({ line_no: 1, snt_line_no: null, quantity: 10, amount: 1000, unit: "услуга" }),
    line({ line_no: 2, snt_line_no: null, quantity: 20, amount: 2000, unit: "услуга" }),
  ];

  it("каждая строка остаётся своей позицией", () => {
    const positions = groupPositions(esf);
    expect(positions).toHaveLength(2);
    expect(positions.every((p) => p.lines.length === 1)).toBe(true);
  });

  it("номер позиции берётся из line_no, когда snt_line_no пуст", () => {
    const positions = groupPositions(esf);
    expect(positions.map((p) => p.positionNo)).toEqual([1, 2]);
    expect(positions.every((p) => p.sntLineNo === null)).toBe(true);
  });

  it("отрицательные суммы дополнительного ЭСФ не теряются", () => {
    const [p] = groupPositions([
      line({ line_no: 1, snt_line_no: null, quantity: -1.489, amount_net: -417451.79, amount: -467546, vat_amount: -50094.21 }),
    ]);
    expect(p.quantity).toBe(-1.489);
    expect(p.amount).toBe(-467546);
  });
});

describe("вырожденные случаи", () => {
  it("документ без строк даёт пустой список, а не падение", () => {
    expect(groupPositions([])).toEqual([]);
    expect(totalOfPositions([])).toBeNull();
  });

  it("полностью пустые суммы дают null, а не ноль", () => {
    const [p] = groupPositions([
      line({ line_no: 1, snt_line_no: 1, quantity: null, amount: null, amount_net: null, vat_amount: null }),
    ]);
    expect(p.quantity).toBeNull();
    expect(p.amount).toBeNull();
  });

  it("ключи позиций уникальны внутри документа", () => {
    const positions = groupPositions([
      line({ line_no: 1, snt_line_no: 1 }),
      line({ line_no: 2, snt_line_no: 1 }),
      line({ line_no: 3, snt_line_no: 2 }),
    ]);
    expect(new Set(positions.map((p) => p.key)).size).toBe(positions.length);
  });
});
