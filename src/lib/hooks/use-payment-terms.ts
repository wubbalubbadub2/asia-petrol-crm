"use client";
// Отчёт «Условия оплаты» (миграция 00141).
//
// Считает ВСЁ база: строка представления deal_payment_terms_report — это
// уже сделка + приложение + дата СНТ, со сроком, плановой датой и
// «днями до оплаты». Здесь только сетевой слой и фильтры.
//
// Типы: `database.ts` генерируется из прода и про новые представления
// ещё не знает (нужен `npm run types:db` после применения 00141).
// До этого описываем строку руками и приводим через unknown — тот же
// приём, что уже применён в use-registry.ts для колонок 00072/00086.

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPaginated } from "@/lib/supabase/fetch-all";
import { toast } from "sonner";

export type PaymentTermsSide = "supplier" | "buyer";

export type PaymentTermsRow = {
  deal_id: string;
  side: PaymentTermsSide;
  deal_code: string | null;
  deal_type: "KG" | "KZ";
  year: number | null;
  month: string | null;
  counterparty_name: string | null;
  counterparty_id: string | null;
  buyer_name: string | null;
  company_chain: string | null;
  appendix: string | null;
  basis_date: string;
  date_basis: "auto" | "manual";
  deferral_days: number | null;
  planned_pay_date: string | null;
  /** Плюс — есть время на оплату, минус — просрочка, NULL — срок не задан. */
  days_to_pay: number | null;
  shipped_amount: number | null;
  shipped_volume: number | null;
  price: number | null;
  /** Оплата и сальдо — по СДЕЛКЕ: привязки оплаты к отгрузке в базе нет. */
  deal_payment: number | null;
  deal_saldo: number | null;
};

export type PaymentTermsFilters = {
  side: PaymentTermsSide;
  year: number;
  dealType: "KG" | "KZ" | null;
};

export function usePaymentTerms({ side, year, dealType }: PaymentTermsFilters) {
  const [data, setData] = useState<PaymentTermsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const supabaseRef = useRef(createClient());

  const load = useCallback(async () => {
    setLoading(true);
    const sb = supabaseRef.current;
    const { data: rows, error } = await fetchAllPaginated<PaymentTermsRow>((from, to) => {
      let q = sb
        .from("deal_payment_terms_report")
        .select("*")
        .eq("side", side)
        .eq("year", year)
        .eq("is_archived", false);
      if (dealType) q = q.eq("deal_type", dealType);
      return q
        .order("counterparty_name", { ascending: true })
        .order("appendix", { ascending: true })
        .order("basis_date", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: PaymentTermsRow[] | null; error: null }>;
    });

    if (error) toast.error(`Ошибка загрузки отчёта: ${error.message}`);
    setData(rows);
    setLoading(false);
  }, [side, year, dealType]);

  useEffect(() => { void load(); }, [load]);

  return { data, loading, reload: load };
}

/**
 * Ключ группы для гашения красного. Клиент 2026-08-10: «если по группе
 * контрагент + приложение сальдо закрыто (≤ 0), красный по всей группе
 * гасим».
 */
export function groupKey(r: PaymentTermsRow): string {
  return `${r.counterparty_id ?? r.counterparty_name ?? ""}|${r.appendix ?? ""}`;
}

/**
 * Сальдо по группе «контрагент + приложение».
 *
 * Сальдо живёт на СДЕЛКЕ и повторяется в каждой её строке, поэтому
 * простая сумма по строкам умножила бы его на число отгрузок. Считаем
 * каждую сделку один раз.
 */
export function groupSaldoMap(rows: PaymentTermsRow[]): Map<string, number> {
  const perGroup = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const g = groupKey(r);
    let deals = perGroup.get(g);
    if (!deals) { deals = new Map(); perGroup.set(g, deals); }
    deals.set(r.deal_id, r.deal_saldo ?? 0);
  }
  const out = new Map<string, number>();
  for (const [g, deals] of perGroup) {
    let total = 0;
    for (const v of deals.values()) total += v;
    out.set(g, total);
  }
  return out;
}

/**
 * Красить ли «дней до оплаты» красным. Красим только настоящую
 * просрочку (строго меньше нуля: ноль — «платить сегодня»), и только
 * если по группе ещё есть незакрытый долг.
 */
export function isOverdueVisible(r: PaymentTermsRow, groupSaldo: Map<string, number>): boolean {
  if (r.days_to_pay == null || r.days_to_pay >= 0) return false;
  const saldo = groupSaldo.get(groupKey(r));
  if (saldo != null && saldo <= 0) return false;
  return true;
}
