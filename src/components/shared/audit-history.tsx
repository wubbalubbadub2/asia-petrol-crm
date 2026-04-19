"use client";

import { useEffect, useState, useRef } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

// One row as stored in the audit_log table (loose typing — JSONB columns
// don't round-trip through our generated Database types cleanly).
type AuditRow = {
  id: string;
  table_name: string;
  row_id: string;
  op: "INSERT" | "UPDATE" | "DELETE";
  user_id: string | null;
  changed_at: string;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
  changed_fields: string[] | null;
};

type EntryWithUser = AuditRow & { user_name: string | null };

const TABLE_LABEL: Record<string, string> = {
  deals: "Сделка",
  deal_payments: "Оплата сделки",
  deal_shipment_prices: "Цена отгрузки",
  shipment_registry: "Реестр",
  dt_kt_logistics: "ДТ-КТ",
  dt_kt_payments: "ДТ-КТ оплата",
};

const OP_LABEL: Record<AuditRow["op"], string> = {
  INSERT: "создано",
  UPDATE: "изменено",
  DELETE: "удалено",
};

const OP_COLOR: Record<AuditRow["op"], string> = {
  INSERT: "text-green-600 border-green-200 bg-green-50",
  UPDATE: "text-amber-700 border-amber-200 bg-amber-50",
  DELETE: "text-red-600 border-red-200 bg-red-50",
};

function fmtTs(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function fmtCellValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return v.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
  if (typeof v === "boolean") return v ? "да" : "нет";
  if (typeof v === "string") {
    // ISO timestamps — shorten. Otherwise pass through, truncated.
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleDateString("ru-RU");
    return v.length > 50 ? v.slice(0, 50) + "…" : v;
  }
  return JSON.stringify(v);
}

export function AuditHistory({
  open,
  onClose,
  dealId,
}: {
  open: boolean;
  onClose: () => void;
  dealId: string;
}) {
  const [entries, setEntries] = useState<EntryWithUser[]>([]);
  const [loading, setLoading] = useState(false);
  const sbRef = useRef(createClient());

  useEffect(() => {
    if (!open || !dealId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      // `audit_log` exists only after migration 00036 is applied. Until the
      // user runs it and regenerates types, the strict Database type doesn't
      // know about this table — cast at the boundary so the rest of the app
      // stays type-safe.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = sbRef.current as any;

      // Parallel: direct deal rows + child rows that carry deal_id in their payload.
      const [dealRows, childRows] = await Promise.all([
        sb.from("audit_log")
          .select("id, table_name, row_id, op, user_id, changed_at, old_row, new_row, changed_fields")
          .eq("table_name", "deals")
          .eq("row_id", dealId)
          .order("changed_at", { ascending: false })
          .limit(200),
        sb.from("audit_log")
          .select("id, table_name, row_id, op, user_id, changed_at, old_row, new_row, changed_fields")
          .in("table_name", ["deal_payments", "deal_shipment_prices", "shipment_registry"])
          .or(`new_row->>deal_id.eq.${dealId},old_row->>deal_id.eq.${dealId}`)
          .order("changed_at", { ascending: false })
          .limit(500),
      ]);

      if (cancelled) return;

      if (dealRows.error) {
        toast.error(dealRows.error.message);
      }
      if (childRows.error) {
        toast.error(childRows.error.message);
      }

      const combined: AuditRow[] = [
        ...((dealRows.data ?? []) as unknown as AuditRow[]),
        ...((childRows.data ?? []) as unknown as AuditRow[]),
      ].sort((a, b) => b.changed_at.localeCompare(a.changed_at));

      // Lookup user names in one round trip.
      const userIds = [...new Set(combined.map((r) => r.user_id).filter((u): u is string => !!u))];
      const userNameById = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profiles } = await sb.from("profiles").select("id, full_name").in("id", userIds);
        for (const p of profiles ?? []) userNameById.set(p.id, p.full_name);
      }

      const enriched: EntryWithUser[] = combined.map((r) => ({
        ...r,
        user_name: r.user_id ? userNameById.get(r.user_id) ?? null : null,
      }));

      setEntries(enriched);
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [open, dealId]);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="border-b border-stone-200 px-4 py-3">
          <SheetTitle>История изменений</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-2 px-4 py-3">
          {loading && <p className="text-[12px] text-stone-400">Загрузка...</p>}
          {!loading && entries.length === 0 && (
            <p className="text-[12px] text-stone-400">
              Пока нет записанных изменений. История ведётся начиная с момента применения миграции 00036.
            </p>
          )}
          {entries.map((e) => (
            <AuditEntry key={e.id} entry={e} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AuditEntry({ entry }: { entry: EntryWithUser }) {
  return (
    <div className="rounded border border-stone-200 bg-white p-2.5 text-[12px]">
      <div className="flex items-center gap-2 mb-1">
        <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${OP_COLOR[entry.op]}`}>
          {OP_LABEL[entry.op]}
        </span>
        <span className="text-[10px] text-stone-500">{TABLE_LABEL[entry.table_name] ?? entry.table_name}</span>
        <span className="ml-auto text-[10px] text-stone-400">{fmtTs(entry.changed_at)}</span>
      </div>
      <div className="text-[11px] text-stone-500 mb-1">
        {entry.user_name ?? <span className="italic text-stone-400">неизвестный пользователь</span>}
      </div>
      {entry.op === "UPDATE" && entry.changed_fields && entry.changed_fields.length > 0 && (
        <div className="space-y-0.5 mt-1 border-l-2 border-amber-200 pl-2">
          {entry.changed_fields.map((f) => {
            const oldV = (entry.old_row ?? {})[f];
            const newV = (entry.new_row ?? {})[f];
            return (
              <div key={f} className="text-[11px]">
                <span className="text-stone-500 font-mono">{f}</span>:{" "}
                <span className="text-stone-400 line-through">{fmtCellValue(oldV)}</span>{" "}
                → <span className="text-stone-800">{fmtCellValue(newV)}</span>
              </div>
            );
          })}
        </div>
      )}
      {entry.op === "INSERT" && entry.new_row && (
        <div className="text-[10px] text-stone-400 mt-0.5">
          <span className="font-mono">id</span>: {String(entry.new_row.id ?? entry.row_id)}
        </div>
      )}
      {entry.op === "DELETE" && entry.old_row && (
        <div className="text-[10px] text-stone-400 mt-0.5">
          <span className="font-mono">id</span>: {String(entry.old_row.id ?? entry.row_id)}
        </div>
      )}
    </div>
  );
}
