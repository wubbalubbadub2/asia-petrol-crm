"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import type { Deal } from "./use-deals";
import type { DealSupplierLine, DealBuyerLine, LineRollups, LineRollup } from "./use-deal-lines";
import type { ActivityMessage } from "./use-deal-activity";

// Сворачиваем 7 параллельных запросов /deals/[id] в один RPC
// get_deal_bundle (migration 00093). HTTP/2 multiplex'ил их, но каждый
// платил свой ~1.5s RTT во Frankfurt — wall-clock = max. Один round-trip
// = один RTT.

type AttachmentSnap = {
  id: string;
  category: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  uploaded_at: string;
};

type RegRollupRow = {
  supplier_line_id: string | null;
  buyer_line_id: string | null;
  shipment_volume: number | string | null;
  loading_volume: number | string | null;
};

type ShipmentPriceRollupRow = {
  side: string;
  amount: number | string | null;
  shipment_registry: { supplier_line_id: string | null; buyer_line_id: string | null } | null;
};

export type DealBundle = {
  deal: Deal | null;
  supplierLines: DealSupplierLine[];
  buyerLines: DealBuyerLine[];
  lineRollups: LineRollups;
  attachments: Record<string, AttachmentSnap[]>;
  activity: ActivityMessage[];
};

// Поле shipment_registry в shipment_prices_raw может прийти null (если у
// строки нет привязки к реестру) — нормализуем при агрегации. Тот же
// алгоритм, что был внутри useDealLineRollups; вынесен в чистую функцию,
// чтобы хук-обёртка реюзал его без дубля кода.
export function computeLineRollups(
  shipmentRollupRaw: RegRollupRow[],
  shipmentPricesRaw: ShipmentPriceRollupRow[],
): LineRollups {
  const supplier: Record<string, LineRollup> = {};
  const buyer: Record<string, LineRollup> = {};

  const num = (v: unknown) => {
    const n = typeof v === "number" ? v : v == null ? 0 : Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  for (const r of shipmentRollupRaw) {
    if (r.supplier_line_id && r.loading_volume != null) {
      const s = supplier[r.supplier_line_id] ?? { volume: 0, amount: 0 };
      s.volume += num(r.loading_volume);
      supplier[r.supplier_line_id] = s;
    }
    if (r.buyer_line_id && r.shipment_volume != null) {
      const b = buyer[r.buyer_line_id] ?? { volume: 0, amount: 0 };
      b.volume += num(r.shipment_volume);
      buyer[r.buyer_line_id] = b;
    }
  }

  for (const p of shipmentPricesRaw) {
    const reg = p.shipment_registry;
    if (!reg) continue;
    const lineId = p.side === "supplier" ? reg.supplier_line_id : reg.buyer_line_id;
    if (!lineId) continue;
    const map = p.side === "supplier" ? supplier : buyer;
    const it = map[lineId] ?? { volume: 0, amount: 0 };
    it.amount += num(p.amount);
    map[lineId] = it;
  }

  return { supplier, buyer };
}

// Module-level cache (same stale-while-revalidate pattern as useDeal):
// повторное открытие сделки в той же сессии рисуется мгновенно из
// памяти, пока фоновый fetch обновляет.
const bundleCache = new Map<string, { data: DealBundle; ts: number }>();
const BUNDLE_TTL_MS = 60_000;

type BundleRpcShape = {
  deal: Record<string, unknown> | null;
  supplier_lines: unknown[] | null;
  buyer_lines: unknown[] | null;
  shipment_rollup_raw: RegRollupRow[] | null;
  shipment_prices_raw: ShipmentPriceRollupRow[] | null;
  attachments: Record<string, AttachmentSnap[]> | null;
  activity: ActivityMessage[] | null;
};

// Annotate deal with supplier_lines_count / buyer_lines_count — UI
// fields в passport-table и где-то ещё (см. annotateLineCounts в
// use-deals.ts).
function annotateDeal(rawDeal: Record<string, unknown> | null): Deal | null {
  if (!rawDeal) return null;
  const supplierLines = (rawDeal.supplier_lines as { id: string }[] | undefined) ?? [];
  const buyerLines = (rawDeal.buyer_lines as { id: string }[] | undefined) ?? [];
  return {
    ...(rawDeal as unknown as Deal),
    supplier_lines_count: supplierLines.length,
    buyer_lines_count: buyerLines.length,
  };
}

function parseBundle(raw: BundleRpcShape): DealBundle {
  const deal = annotateDeal(raw.deal);
  const supplierLines = (raw.supplier_lines ?? []) as DealSupplierLine[];
  const buyerLines = (raw.buyer_lines ?? []) as DealBuyerLine[];
  const lineRollups = computeLineRollups(
    (raw.shipment_rollup_raw ?? []) as RegRollupRow[],
    (raw.shipment_prices_raw ?? []) as ShipmentPriceRollupRow[],
  );
  const attachments = (raw.attachments ?? {}) as Record<string, AttachmentSnap[]>;
  const activity = (raw.activity ?? []) as ActivityMessage[];
  return { deal, supplierLines, buyerLines, lineRollups, attachments, activity };
}

const EMPTY_BUNDLE: DealBundle = {
  deal: null,
  supplierLines: [],
  buyerLines: [],
  lineRollups: { supplier: {}, buyer: {} },
  attachments: {},
  activity: [],
};

export function useDealBundle(dealId: string | null) {
  const cached = dealId ? bundleCache.get(dealId) : null;
  const isFresh = !!cached && Date.now() - cached.ts < BUNDLE_TTL_MS;
  const [data, setData] = useState<DealBundle>(cached?.data ?? EMPTY_BUNDLE);
  // Same rationale as useDeal: don't toggle loading=true on subsequent
  // loads, иначе page блокеру (`if (loading) return …`) выкинет
  // dismount всего поддерева на каждом сохранении поля.
  const [loading, setLoading] = useState(!cached);
  const sb = useRef(createClient());

  const load = useCallback(async () => {
    if (!dealId) {
      setLoading(false);
      return;
    }
    // RPC types ещё не сгенерированы — cast по аналогии с
    // recompute_line_shipment_prices в use-deal-lines.ts.
    const { data: raw, error } = await (
      sb.current.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: BundleRpcShape | null; error: { message: string } | null }>
    )("get_deal_bundle", { p_deal_id: dealId });

    if (error) {
      toast.error(`Ошибка загрузки сделки: ${error.message}`);
      setLoading(false);
      return;
    }
    if (raw) {
      const bundle = parseBundle(raw);
      setData(bundle);
      bundleCache.set(dealId, { data: bundle, ts: Date.now() });
    }
    setLoading(false);
  }, [dealId]);

  useEffect(() => {
    if (!isFresh) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // Точечные перезагрузки — у каждой секции свой reload-колбэк, чтобы
  // page.tsx мог обновить, например, только линии после правки variant.
  // Самый тяжёлый round-trip всё ещё bundle reload — но он же
  // обновляет всё разом, поэтому используется как полное обновление.
  return {
    deal: data.deal,
    supplierLines: data.supplierLines,
    buyerLines: data.buyerLines,
    lineRollups: data.lineRollups,
    attachments: data.attachments,
    activity: data.activity,
    loading,
    reload: load,
    // Удобство: инвалидировать кеш у конкретного dealId (например,
    // после внешнего мутирующего действия — DealCompanyChain editor).
    invalidate: () => {
      if (dealId) bundleCache.delete(dealId);
    },
  };
}

// Экспорт для тестов / других потребителей.
export function invalidateDealBundle(dealId: string) {
  bundleCache.delete(dealId);
}

// ────────────────────────────────────────────────────────────────────
// Realtime activity layer.
// ────────────────────────────────────────────────────────────────────
//
// useDealBundle тянет первичный список активности одним запросом,
// поэтому отдельный INITIAL fetch + Postgres-channel subscribe из
// useDealActivity больше не нужен. Но live-апдейты (новые комментарии
// от других пользователей и собственные оптимистичные вставки) всё
// ещё нужны.
//
// Этот хук:
//   * принимает `seed` (= bundle.activity) как начальное состояние;
//   * подписывается на postgres_changes ТОЛЬКО после первого
//     рендера — чтобы канал не отстреливал до того, как bundle resolve
//     (на bundle resolve канал просто переоткроется с новыми seed —
//     setMessages синхронизируется через useEffect ниже);
//   * sendMessage делает оптимистичную вставку + persist, тот же
//     контракт что и старый useDealActivity.
//
// Why defer the subscription: первый paint /deals/[id] должен дожимать
// один RPC, не плюсовать к нему WS handshake. Канал поднимается лениво
// после mount.

export function useDealActivityLive(
  dealId: string,
  seed: ActivityMessage[],
) {
  const [messages, setMessages] = useState<ActivityMessage[]>(seed);
  const sb = useRef(createClient());

  // Bundle reload меняет seed — синхронизируем локальное состояние,
  // НО только если seed актуальнее (длиннее или содержит новые ids).
  // Иначе оптимистичные вставки, ещё не отражённые в bundle, исчезнут
  // при рефетче bundle. Простая стратегия: merge by id, preserving
  // локальный порядок.
  const seedSig = useMemo(
    () => seed.map((m) => m.id).join(","),
    [seed],
  );
  useEffect(() => {
    setMessages((prev) => {
      const seenIds = new Set(prev.map((m) => m.id));
      const merged = [...prev];
      for (const m of seed) {
        if (!seenIds.has(m.id)) merged.push(m);
      }
      // Sort ASC by created_at — тот же порядок что ожидает
      // ActivityFeed (scroll вниз = новейшие).
      merged.sort((a, b) => a.created_at.localeCompare(b.created_at));
      return merged;
    });
    // seedSig охватывает все интересующие нас изменения seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedSig]);

  useEffect(() => {
    if (!dealId) return;
    const channel = sb.current
      .channel(`deal-activity-${dealId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "deal_activity",
          filter: `deal_id=eq.${dealId}`,
        },
        async (payload) => {
          const { data } = await sb.current
            .from("deal_activity")
            .select("*, user:profiles(full_name, role)")
            .eq("id", payload.new.id)
            .single();
          if (data) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === data.id)) return prev;
              return [...prev, data as ActivityMessage];
            });
          }
        },
      )
      .subscribe();
    return () => {
      sb.current.removeChannel(channel);
    };
  }, [dealId]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return;
      const {
        data: { user },
      } = await sb.current.auth.getUser();
      if (!user) {
        toast.error("Не авторизован");
        return;
      }
      const tempId = crypto.randomUUID();
      const optimistic: ActivityMessage = {
        id: tempId,
        deal_id: dealId,
        user_id: user.id,
        type: "comment",
        content: content.trim(),
        metadata: null,
        created_at: new Date().toISOString(),
        user: null,
      };
      setMessages((prev) => [...prev, optimistic]);

      const { data, error } = await sb.current
        .from("deal_activity")
        .insert({
          deal_id: dealId,
          user_id: user.id,
          type: "comment",
          content: content.trim(),
        })
        .select("*, user:profiles(full_name, role)")
        .single();

      if (error) {
        toast.error(`Ошибка: ${error.message}`);
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
      } else if (data) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? (data as ActivityMessage) : m)),
        );
      }
    },
    [dealId],
  );

  return { messages, sendMessage };
}
