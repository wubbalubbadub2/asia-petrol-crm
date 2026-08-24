import { describe, it, expect } from "vitest";
import { computeDtKtSaldo } from "@/lib/dtkt/saldo";

// Сценарии — реальные записи ДТ-КТ за 2026 год, снятые с рабочей базы
// 12.08.2026. Величины сверены бухгалтерией, знак — по конвенции клиента
// 25.08.2026: плюс = мы должны экспедитору, минус = нам должны.
//
// «Сальдо 1 янв» во всех сценариях — в этой же конвенции (её выравнивает
// миграция 00152): у TENGRI WAY и ОРТ на экране до 00152 стоят обратные
// +32 340,20 и +804 037,88, введённые руками в конвенции бухгалтерской
// таблицы.
const zero = { opening_balance: 0, refund: 0, fines: 0, surcharge_preliminary: 0, ogem: 0 };

describe("computeDtKtSaldo — формула клиента", () => {
  it("PTC-Operator / TENGRI WAY: разбор из обращения 12.08.2026", () => {
    // −32 340,20 + 204 087,56 + 21 940,00 − 228 825,00
    const saldo = computeDtKtSaldo(
      { ...zero, opening_balance: -32340.2, surcharge_preliminary: 21940 },
      204087.56,
      228825,
    );
    // Бухгалтерия ждала 35 137,64 «нам должны» — величина та же, знак минусовой.
    expect(saldo).toBeCloseTo(-35137.64, 2);
  });

  it("PTC-Operator / ОРТ: сверхнорматив свыше миллиона", () => {
    const saldo = computeDtKtSaldo(
      { ...zero, opening_balance: -804037.88, surcharge_preliminary: 1422313.01 },
      6488747.45,
      7126350.56,
    );
    expect(saldo).toBeCloseTo(-19327.98, 2);
  });

  it("UE-LOGISTIC / ОМИ: без сальдо на 1 янв — переплата уходит в минус", () => {
    const saldo = computeDtKtSaldo({ ...zero }, 46427.05, 108390);
    expect(saldo).toBeCloseTo(-61962.95, 2);
  });

  it("PTC-Operator / ОМИ: отрицательное сальдо на 1 янв читается как есть", () => {
    const saldo = computeDtKtSaldo(
      { ...zero, opening_balance: -891932.7, surcharge_preliminary: 289544.06 },
      1223961.77,
      969168.3,
    );
    expect(saldo).toBeCloseTo(-347595.17, 2);
  });

  it("PTC-Operator / Progressive oil trading: отгрузка втрое больше оплаты — наш долг", () => {
    const saldo = computeDtKtSaldo(
      { ...zero, opening_balance: -18491050.36 },
      430658258.81,
      142393037.47,
    );
    expect(saldo).toBeCloseTo(269774170.98, 2);
  });
});

describe("computeDtKtSaldo — знак результата", () => {
  it("плюс = мы должны: отгрузили на нас больше, чем мы оплатили", () => {
    expect(computeDtKtSaldo({ ...zero }, 100, 40)).toBe(60);
  });

  it("минус = нам должны: оплатили больше, чем экспедитор отгрузил", () => {
    expect(computeDtKtSaldo({ ...zero }, 40, 100)).toBe(-60);
  });

  it("знак сальдо на 1 янв не разворачивается — берётся как в колонке", () => {
    expect(computeDtKtSaldo({ ...zero, opening_balance: -500 }, 0, 0)).toBe(-500);
    expect(computeDtKtSaldo({ ...zero, opening_balance: 500 }, 0, 0)).toBe(500);
  });
});

describe("computeDtKtSaldo — возврат", () => {
  it("UE-LOGISTIC / АБ Линк: возврат гасит сальдо на 1 янв в ноль", () => {
    const saldo = computeDtKtSaldo({ ...zero, opening_balance: -578000, refund: 578000 }, 0, 0);
    expect(saldo).toBe(0);
  });

  it("возврат берётся со своим знаком и гасит нашу переплату", () => {
    // Оплатили на 300 больше отгрузки → нам должны 300; вернули 300 → закрыто.
    expect(computeDtKtSaldo({ ...zero, refund: 300 }, 0, 300)).toBe(0);
  });

  it("возврат идёт в сторону, обратную оплате", () => {
    const viaRefund = computeDtKtSaldo({ ...zero, refund: 300 }, 0, 0);
    const viaPayment = computeDtKtSaldo({ ...zero }, 0, 300);
    expect(viaRefund).toBe(-viaPayment);
  });
});

describe("computeDtKtSaldo — начисления экспедитора", () => {
  it("штрафы, сверхнорматив и ОГЭМ прибавляются наравне с отгрузкой", () => {
    const saldo = computeDtKtSaldo(
      { ...zero, fines: 10, surcharge_preliminary: 20, ogem: 30 },
      40,
      100,
    );
    expect(saldo).toBe(0);
  });

  it("пустые ячейки считаются нулём, а не ломают сальдо", () => {
    const saldo = computeDtKtSaldo(
      { opening_balance: null, refund: null, fines: null, surcharge_preliminary: null, ogem: null },
      100,
      250,
    );
    expect(saldo).toBe(-150);
  });
});
