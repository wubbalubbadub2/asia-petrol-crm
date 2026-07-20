import { describe, it, expect } from "vitest";
import { parseNbrkUsdKzt, parseNbkrUsdKgs, formatKzDate } from "@/lib/fx/parse";

const NBRK = `<rates>
  <item><fullname>ЕВРО</fullname><title>EUR</title><description>520.10</description><quant>1</quant></item>
  <item><fullname>ДОЛЛАР США</fullname><title>USD</title><description>468.88</description><quant>1</quant></item>
</rates>`;

const NBKR = `<CurrencyRates Date="20.07.2026">
  <Currency ISOCode="EUR"><Nominal>1</Nominal><Value>96,5000</Value></Currency>
  <Currency ISOCode="USD"><Nominal>1</Nominal><Value>87,4500</Value></Currency>
</CurrencyRates>`;

describe("fx parse", () => {
  it("вытаскивает USD/KZT из НБ РК", () => {
    expect(parseNbrkUsdKzt(NBRK)).toBeCloseTo(468.88, 2);
  });
  it("вытаскивает USD/KGS из НБ КР (запятая, номинал)", () => {
    expect(parseNbkrUsdKgs(NBKR)).toBeCloseTo(87.45, 2);
  });
  it("делит на номинал, если он > 1", () => {
    const xml = `<CurrencyRates><Currency ISOCode="USD"><Nominal>10</Nominal><Value>874,50</Value></Currency></CurrencyRates>`;
    expect(parseNbkrUsdKgs(xml)).toBeCloseTo(87.45, 2);
  });
  it("форматирует дату для fdate", () => {
    expect(formatKzDate(new Date(Date.UTC(2026, 6, 5)))).toBe("05.07.2026");
  });
  it("кидает ошибку, если USD не найден", () => {
    expect(() => parseNbrkUsdKzt("<rates></rates>")).toThrow();
  });
});
