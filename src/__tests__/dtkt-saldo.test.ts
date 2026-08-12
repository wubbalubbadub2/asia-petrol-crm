import { describe, it, expect } from "vitest";
import { computeDtKtSaldo } from "@/lib/dtkt/saldo";

// Сценарии — реальные записи ДТ-КТ за 2026 год, снятые с рабочей базы
// 12.08.2026. Ожидаемые значения — из сверки бухгалтерии.
const zero = { opening_balance: 0, refund: 0, fines: 0, surcharge_preliminary: 0, ogem: 0 };

describe("computeDtKtSaldo — формула клиента", () => {
  it("PTC-Operator / TENGRI WAY: разбор из обращения 12.08.2026", () => {
    // 32 340,20 + 228 825,00 − 204 087,56 − 21 940,00
    const saldo = computeDtKtSaldo(
      { ...zero, opening_balance: 32340.2, surcharge_preliminary: 21940 },
      204087.56,
      228825,
    );
    expect(saldo).toBeCloseTo(35137.64, 2);
  });

  it("PTC-Operator / ОРТ: сверхнорматив свыше миллиона", () => {
    const saldo = computeDtKtSaldo(
      { ...zero, opening_balance: 804037.88, surcharge_preliminary: 1422313.01 },
      6488747.45,
      7126350.56,
    );
    expect(saldo).toBeCloseTo(19327.98, 2);
  });

  it("UE-LOGISTIC / ОМИ: без сальдо на 1 янв — переплата даёт плюс", () => {
    const saldo = computeDtKtSaldo({ ...zero }, 46427.05, 108390);
    expect(saldo).toBeCloseTo(61962.95, 2);
  });

  it("PTC-Operator / ОМИ: отрицательное сальдо на 1 янв читается как есть", () => {
    const saldo = computeDtKtSaldo(
      { ...zero, opening_balance: -891932.7, surcharge_preliminary: 289544.06 },
      1223961.77,
      969168.3,
    );
    expect(saldo).toBeCloseTo(-1436270.23, 2);
  });

  it("PTC-Operator / Progressive oil trading: крупные суммы в тенге", () => {
    const saldo = computeDtKtSaldo(
      { ...zero, opening_balance: -18491050.36 },
      430658258.81,
      142393037.47,
    );
    expect(saldo).toBeCloseTo(-306756271.7, 2);
  });
});

describe("computeDtKtSaldo — знак результата", () => {
  it("минус = нам должны: отгрузили больше, чем оплатили", () => {
    expect(computeDtKtSaldo({ ...zero }, 100, 40)).toBe(-60);
  });

  it("плюс = мы должны: оплатили больше, чем отгрузили", () => {
    expect(computeDtKtSaldo({ ...zero }, 40, 100)).toBe(60);
  });

  it("знак сальдо на 1 янв не разворачивается — берётся как в колонке", () => {
    expect(computeDtKtSaldo({ ...zero, opening_balance: -500 }, 0, 0)).toBe(-500);
    expect(computeDtKtSaldo({ ...zero, opening_balance: 500 }, 0, 0)).toBe(500);
  });
});

describe("computeDtKtSaldo — возврат плюсуется к оплате", () => {
  it("UE-LOGISTIC / АБ Линк: возврат гасит сальдо на 1 янв в ноль", () => {
    const saldo = computeDtKtSaldo({ ...zero, opening_balance: -578000, refund: 578000 }, 0, 0);
    expect(saldo).toBe(0);
  });

  it("возврат идёт в ту же сторону, что и оплата", () => {
    const viaRefund = computeDtKtSaldo({ ...zero, refund: 300 }, 0, 0);
    const viaPayment = computeDtKtSaldo({ ...zero }, 0, 300);
    expect(viaRefund).toBe(viaPayment);
  });

  it("возврат со знаком минус уменьшает оплату", () => {
    expect(computeDtKtSaldo({ ...zero, refund: -300 }, 0, 1000)).toBe(700);
  });
});

describe("computeDtKtSaldo — удержания", () => {
  it("штрафы, сверхнорматив и ОГЭМ вычитаются наравне с отгрузкой", () => {
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
    expect(saldo).toBe(150);
  });
});
