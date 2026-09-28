"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, FileText, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatDMY } from "@/lib/format";
import { MONTHS_RU } from "@/lib/constants/months-ru";
import { CARRIED_OVER_COLUMNS } from "@/components/transport/request-form";
import { deleteRequestWithFiles } from "@/lib/transport/storage";
import { useRole } from "@/lib/role-context";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useDealOptions } from "@/lib/hooks/use-deals";

/**
 * Список заявок на перевозку.
 *
 * «Копировать» создаёт черновик со всеми полями исходной заявки, датой
 * сегодня и своим номером — клиент 25.08: «чтобы они могли открыть или
 * скопировать уже готовый сформированный файл и поменять только
 * некоторые поля, чтобы не заполнять все заново».
 */

type Row = {
  id: string;
  request_year: number;
  request_number: number;
  date: string;
  status: "draft" | "issued";
  tonnage: number | null;
  wagons: number | null;
  period_month: number | null;
  period_year: number | null;
  company_group: { name: string } | null;
  fuel_type: { name: string; full_name: string | null } | null;
  destination_station: { name: string; code: string | null } | null;
  /** Сделки заявки (00175). Пусто — «сделка не создана». */
  deals: { deal_id: string; deal: { id: string; deal_code: string | null } | null }[];
};

type DealFilter = "all" | "none" | "linked";
const DEAL_FILTER_LABEL: Record<DealFilter, string> = {
  all: "Все",
  none: "Сделка не создана",
  linked: "Со сделкой",
};

const SELECT =
  "id, request_year, request_number, date, status, tonnage, wagons, period_month, period_year, " +
  "company_group:company_groups(name), fuel_type:fuel_types(name, full_name), " +
  "destination_station:stations(name, code), " +
  "deals:transport_request_deals(deal_id, deal:deals(id, deal_code))";

function StatusBadge({ status }: { status: Row["status"] }) {
  return status === "issued" ? (
    <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">
      Заявка
    </span>
  ) : (
    <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[11px] font-medium text-stone-600">
      Черновик
    </span>
  );
}

export default function TransportRequestsPage() {
  const router = useRouter();
  const { isAdmin, isWritable } = useRole();
  const [dealFilter, setDealFilter] = useState<DealFilter>("all");
  const [linking, setLinking] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [copying, setCopying] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const sbRef = useRef(createClient());

  const load = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = sbRef.current as any;
    const { data, error } = await sb
      .from("transport_requests")
      .select(SELECT)
      .order("request_year", { ascending: false })
      .order("request_number", { ascending: false });
    if (error) toast.error(`Ошибка загрузки: ${error.message}`);
    else setRows((data ?? []) as Row[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Справочник сделок для привязки прямо из списка — постранично, с кэшем.
  const deals = useDealOptions();

  /** Привязка из списка: добавляем новые сделки, снимаем убранные. */
  async function setRequestDeals(r: Row, next: string[]) {
    const current = r.deals.map((d) => d.deal_id);
    const added = next.filter((id) => !current.includes(id));
    const removed = current.filter((id) => !next.includes(id));
    setLinking(r.id);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = sbRef.current as any;
      if (removed.length > 0) {
        const { error } = await sb
          .from("transport_request_deals")
          .delete()
          .eq("request_id", r.id)
          .in("deal_id", removed);
        if (error) throw error;
      }
      if (added.length > 0) {
        const { error } = await sb
          .from("transport_request_deals")
          .insert(added.map((dealId) => ({ request_id: r.id, deal_id: dealId })));
        if (error) throw error;
      }
      await load();
    } catch (e) {
      toast.error(`Не удалось привязать сделку: ${(e as Error).message}`);
    } finally {
      setLinking(null);
    }
  }

  async function copyRequest(id: string) {
    setCopying(id);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = sbRef.current as any;
      const { data: src, error: readErr } = await sb
        .from("transport_requests")
        .select("*")
        .eq("id", id)
        .single();
      if (readErr) throw readErr;

      const copy: Record<string, unknown> = {
        date: new Date().toISOString().slice(0, 10),
        status: "draft",
      };
      for (const col of CARRIED_OVER_COLUMNS) copy[col] = src[col];

      const { data: created, error } = await sb
        .from("transport_requests")
        .insert(copy)
        .select("id")
        .single();
      if (error) throw error;

      // Оплаты по ЖД — часть заявки, копия без них была бы неполной.
      const { data: lines } = await sb
        .from("transport_request_payers")
        .select("position, railway, payer_text")
        .eq("request_id", id)
        .order("position");
      const payerRows = (lines ?? []) as {
        position: number; railway: string; payer_text: string | null;
      }[];
      if (payerRows.length > 0) {
        await sb.from("transport_request_payers").insert(
          payerRows.map((l) => ({
            request_id: created.id,
            position: l.position,
            railway: l.railway,
            payer_text: l.payer_text,
          })),
        );
      }

      toast.success("Копия создана");
      router.push(`/transport-requests/${created.id}`);
    } catch (e) {
      toast.error(`Не удалось скопировать: ${(e as Error).message}`);
    } finally {
      setCopying(null);
    }
  }

  async function removeRequest(r: Row) {
    const label = `№ ${r.request_number}/${String(r.request_year).slice(2)}`;
    if (!confirm(`Удалить заявку ${label}? Сформированные файлы тоже удалятся.`)) return;
    setDeleting(r.id);
    try {
      await deleteRequestWithFiles(r.id);
      setRows((prev) => prev.filter((x) => x.id !== r.id));
      toast.success(`Заявка ${label} удалена`);
    } catch (e) {
      toast.error(`Не удалось удалить: ${(e as Error).message}`);
    } finally {
      setDeleting(null);
    }
  }

  const q = search.trim().toLowerCase();
  const byDeal = rows.filter((r) =>
    dealFilter === "none" ? r.deals.length === 0
      : dealFilter === "linked" ? r.deals.length > 0
      : true,
  );
  const filtered = q
    ? byDeal.filter((r) =>
        [
          `${r.request_number}`,
          r.company_group?.name,
          r.fuel_type?.full_name ?? r.fuel_type?.name,
          r.destination_station?.name,
          ...r.deals.map((d) => d.deal?.deal_code),
        ]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q)),
      )
    : byDeal;
  const unlinkedCount = rows.filter((r) => r.deals.length === 0).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Заявки на перевозку</h1>
        <Link href="/transport-requests/new">
          <Button size="sm">
            <Plus className="mr-1 h-3.5 w-3.5" />
            Создать заявку
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex overflow-hidden rounded border border-stone-200 bg-white">
        {(["all", "none", "linked"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setDealFilter(f)}
            className={`cursor-pointer px-3 py-1.5 text-[12px] font-medium transition-colors ${dealFilter === f ? "bg-amber-500 text-white" : "text-stone-600 hover:bg-stone-50"}`}
          >
            {DEAL_FILTER_LABEL[f]}
            {f === "none" ? <span className="ml-1 opacity-70">{unlinkedCount}</span> : null}
          </button>
        ))}
      </div>
      <div className="relative w-full max-w-sm">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Номер, компания, продукт, станция, сделка..."
          className="h-9 pl-8"
        />
      </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          Загрузка...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
          <FileText className="h-6 w-6" />
          <span className="text-[13px]">
            {rows.length === 0 ? "Заявок пока нет" : "Ничего не найдено"}
          </span>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">№</TableHead>
                <TableHead className="w-28">Дата</TableHead>
                <TableHead>Компания</TableHead>
                <TableHead className="min-w-52">Сделки</TableHead>
                <TableHead>Продукт</TableHead>
                <TableHead className="text-right">Тонн</TableHead>
                <TableHead className="text-right">Вагонов</TableHead>
                <TableHead>Станция назначения</TableHead>
                <TableHead>Период</TableHead>
                <TableHead className="w-28">Статус</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id} className="hover:bg-muted/40">
                  <TableCell className="font-mono text-[12px]">
                    <Link href={`/transport-requests/${r.id}`} className="hover:underline">
                      {r.request_number}/{String(r.request_year).slice(2)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-[13px]">{formatDMY(r.date)}</TableCell>
                  <TableCell className="text-[13px]">{r.company_group?.name ?? "—"}</TableCell>
                  <TableCell className="text-[12px]">
                    <div className="flex flex-col gap-1">
                      {r.deals.length > 0 ? (
                        <div className="flex flex-wrap gap-x-2">
                          {r.deals.map((d) => (
                            <Link key={d.deal_id} href={`/deals/${d.deal_id}`} className="font-mono text-amber-700 hover:underline">
                              {d.deal?.deal_code ?? d.deal_id.slice(0, 8)}
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <span className="text-stone-400">сделка не создана</span>
                      )}
                      {isWritable ? (
                        <SearchableSelect
                          multi
                          options={deals.options}
                          value={r.deals.map((d) => d.deal_id)}
                          onChange={(next) => setRequestDeals(r, next)}
                          placeholder={linking === r.id ? "Сохранение…" : "Привязать сделку"}
                          searchPlaceholder="Код сделки"
                          emptyMessage={deals.emptyMessage}
                          multiSummary={(n) => `Изменить (${n})`}
                          clearLabel="Отвязать все"
                          triggerClassName="h-7 w-44 text-[11px]"
                        />
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {r.fuel_type?.full_name || r.fuel_type?.name || "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12px]">
                    {r.tonnage ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12px]">
                    {r.wagons ?? "—"}
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {r.destination_station
                      ? r.destination_station.code
                        ? `${r.destination_station.name} (${r.destination_station.code})`
                        : r.destination_station.name
                      : "—"}
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {r.period_month && r.period_year
                      ? `${MONTHS_RU[r.period_month - 1]} ${r.period_year}`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      disabled={copying === r.id}
                      onClick={() => copyRequest(r.id)}
                      title="Создать копию с этими же полями"
                    >
                      {copying === r.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-destructive hover:text-destructive"
                      disabled={!isAdmin || deleting === r.id}
                      onClick={() => removeRequest(r)}
                      title={isAdmin ? "Удалить заявку" : "Удалять заявки может администратор"}
                    >
                      {deleting === r.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
