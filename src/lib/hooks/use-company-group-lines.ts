"use client";
// Варианты цены группы компаний (00183, только KG; клиент 2026-10-29,
// пример KG/26/736). Вариант = цена + объём: объём либо из отгрузок
// привязанного варианта покупателя (с «действует с»), либо вручную.
// Объём и сумму считает вью deal_company_group_line_volumes — БД источник
// истины; здесь только чтение и подписи.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPaginated } from "@/lib/supabase/fetch-all";

// Таблицы и вью нет в сгенерированном database.ts (появятся после
// `npm run types:db` на проде) — тот же обход, что у оплат закупки.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = { from: (table: string) => any };
export const sbLoose = () => createClient() as unknown as LooseClient;

export type CompanyGroupLine = {
  id: string;
  deal_company_group_id: string;
  position: number;
  is_default: boolean;
  quotation: number | null;
  quotation_comment: string | null;
  discount: number | null;
  price: number | null;
  price_kind: "preliminary" | "final";
  buyer_line_id: string | null;
  valid_from: string | null;
  manual_volume: number | null;
};

export type CompanyGroupLineVolume = { volume: number | null; amount: number | null; is_linked: boolean };

/** Вариант покупателя для привязки: «Основной» / «Вариант N», как в карточке. */
export type BuyerLineOption = { id: string; position: number; is_default: boolean; price: number | null };

const LINE_COLUMNS =
  "id, deal_company_group_id, position, is_default, quotation, quotation_comment, discount, price, price_kind, buyer_line_id, valid_from, manual_volume";

const num = (v: unknown): number | null => (v == null ? null : Number(v));

function toLine(r: Record<string, unknown>): CompanyGroupLine {
  return {
    ...(r as unknown as CompanyGroupLine),
    quotation: num(r.quotation),
    discount: num(r.discount),
    price: num(r.price),
    manual_volume: num(r.manual_volume),
  };
}

/** «Основной» первым, остальные по порядку. */
export function orderCompanyGroupLines<T extends { is_default: boolean; position: number }>(lines: T[]): T[] {
  return [...lines].sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.position - b.position);
}

/** «★ Основной» / «Вариант N»: N — по порядку вариантов, как у поставщика и покупателя. */
export function companyGroupLineName(line: { id: string; is_default: boolean }, ordered: { id: string }[]): string {
  if (line.is_default) return "★ Основной";
  return `Вариант ${ordered.findIndex((l) => l.id === line.id) + 1}`;
}

export function buyerLineName(id: string, buyerLines: BuyerLineOption[]): string {
  const ordered = orderCompanyGroupLines(buyerLines);
  const l = ordered.find((b) => b.id === id);
  if (!l) return "—";
  return l.is_default ? "Основной" : `Вариант ${ordered.indexOf(l) + 1}`;
}

const tons3 = (v: number) => v.toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const money2 = (v: number) => v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Примечание под вариантом, как у поставщика (клиент 2026-10-29):
 *  «Отгружено по этому варианту: 956,007 тонн · Сумма: 430 203,15 $ (по цене 450,000)». */
export function companyGroupLineNote(price: number | null, v: CompanyGroupLineVolume | undefined, currencySymbol: string): string | null {
  if (!v || v.volume == null) return null;
  const head = `${v.is_linked ? "Отгружено по этому варианту" : "Объём"}: ${tons3(v.volume)} тонн`;
  if (v.amount == null || price == null) return head;
  return `${head} · Сумма: ${money2(v.amount)} ${currencySymbol} (по цене ${tons3(price)})`;
}

/** Варианты групп цепочки — по id групп (паспорт: только группы с > 1 вариантом показывают все цены). */
export async function fetchCompanyGroupLines(groupIds: string[]): Promise<Map<string, CompanyGroupLine[]>> {
  const out = new Map<string, CompanyGroupLine[]>();
  if (groupIds.length === 0) return out;
  const chunks: string[][] = [];
  for (let i = 0; i < groupIds.length; i += 150) chunks.push(groupIds.slice(i, i + 150));
  const results = await Promise.all(chunks.map((chunk) =>
    fetchAllPaginated<Record<string, unknown>>((from, to) =>
      sbLoose().from("deal_company_group_lines").select(LINE_COLUMNS)
        .in("deal_company_group_id", chunk)
        .order("deal_company_group_id", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ));
  for (const r of results.flatMap((x) => x.data)) {
    const line = toLine(r);
    const list = out.get(line.deal_company_group_id) ?? [];
    list.push(line);
    out.set(line.deal_company_group_id, list);
  }
  for (const [k, list] of out) out.set(k, orderCompanyGroupLines(list));
  return out;
}

export async function fetchCompanyGroupLineVolumes(groupIds: string[]): Promise<Map<string, CompanyGroupLineVolume>> {
  const out = new Map<string, CompanyGroupLineVolume>();
  if (groupIds.length === 0) return out;
  const { data, error } = await sbLoose().from("deal_company_group_line_volumes")
    .select("line_id, volume, amount, is_linked")
    .in("deal_company_group_id", groupIds);
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    out.set(r.line_id as string, { volume: num(r.volume), amount: num(r.amount), is_linked: Boolean(r.is_linked) });
  }
  return out;
}

/** Паспорт: варианты групп KG-сделок на экране; `version` — перечитать после правки. */
export function useCompanyGroupLinesSummary(groupIds: string[], version: string) {
  const [map, setMap] = useState<Map<string, CompanyGroupLine[]>>(new Map());
  const key = groupIds.join(",");
  useEffect(() => {
    let cancelled = false;
    void fetchCompanyGroupLines(key ? key.split(",") : [])
      .then((m) => { if (!cancelled) setMap(m); })
      .catch((e) => console.error("company group lines:", e));
    return () => { cancelled = true; };
  }, [key, version]);
  return map;
}
