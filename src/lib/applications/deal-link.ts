/**
 * Заявка и сделка (клиент 2026-10-05): «если сделка ещё не создана, то
 * через 8–9 дней как-то обозначилось, что заявка не привязана — так можно
 * будет отслеживать заявки отработанные и отгруженные».
 *
 * Дни считаем от даты заявки (поле «Дата»), по календарю, без времени.
 * С 8-го дня без сделки — «просрочена» (красным).
 */
import { fetchAllPaginated } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/client";

export const UNLINKED_ALERT_DAYS = 8;

export type DealLinkStatus =
  | { kind: "linked" }
  | { kind: "waiting"; days: number }
  | { kind: "overdue"; days: number };

/** Полных календарных дней между датами `YYYY-MM-DD` (b − a). */
export function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** Сегодня `YYYY-MM-DD` по местному календарю пользователя. */
export function localToday(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function dealLinkStatus(appDate: string, linkedDeals: number, today: string): DealLinkStatus {
  if (linkedDeals > 0) return { kind: "linked" };
  const days = Math.max(0, daysBetween(appDate, today));
  return days >= UNLINKED_ALERT_DAYS ? { kind: "overdue", days } : { kind: "waiting", days };
}

export type DealOption = { id: string; deal_code: string };

/**
 * Все неархивные сделки для выбора. Постранично: PostgREST отдаёт не
 * больше 1000 строк, а сделок уже больше — без этого часть сделок
 * в списке просто не появлялась.
 */
export async function loadDealOptions(): Promise<DealOption[]> {
  const sb = createClient();
  const { data, error } = await fetchAllPaginated<{ id: string; deal_code: string | null }>((from, to) =>
    sb.from("deals")
      .select("id, deal_code")
      .eq("is_archived", false)
      .order("deal_code")
      .order("id")
      .range(from, to),
  );
  if (error) throw error;
  return data.filter((d): d is DealOption => !!d.deal_code);
}
