import { describe, it, expect } from "vitest";
import { nbrkUrl, NBKR_URL, fetchNbrkRate, fetchNbkrRate } from "@/lib/fx/ingest";

const NBRK = `<rates><item><title>USD</title><description>468.88</description></item></rates>`;
const NBKR = `<CurrencyRates><Currency ISOCode="USD"><Nominal>1</Nominal><Value>87,4500</Value></Currency></CurrencyRates>`;
const fakeFetch = (body: string) =>
  (async () => ({ ok: true, text: async () => body })) as unknown as typeof fetch;

describe("fx ingest (pure)", () => {
  it("строит URL НБ РК с fdate", () => {
    expect(nbrkUrl(new Date(Date.UTC(2026, 6, 5)))).toContain("fdate=05.07.2026");
  });
  it("URL НБ КР — daily.xml", () => {
    expect(NBKR_URL).toContain("nbkr.kg");
  });
  it("fetchNbrkRate парсит ответ", async () => {
    expect(await fetchNbrkRate(new Date(Date.UTC(2026, 6, 5)), fakeFetch(NBRK))).toBeCloseTo(468.88, 2);
  });
  it("fetchNbkrRate парсит ответ", async () => {
    expect(await fetchNbkrRate(fakeFetch(NBKR))).toBeCloseTo(87.45, 2);
  });
});
