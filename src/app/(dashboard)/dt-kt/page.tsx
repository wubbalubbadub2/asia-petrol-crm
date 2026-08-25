"use client";

import { useState, useEffect, useRef, useMemo, Fragment , useCallback } from "react";
import { Plus, Filter, Trash2, X, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { reportExportError } from "@/lib/chunk-error";
import { CURRENCIES, currencySymbol } from "@/lib/constants/currencies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { computeDtKtSaldo } from "@/lib/dtkt/saldo";
import { useDelayed } from "@/lib/hooks/use-delayed";
import { fetchAllPaginated } from "@/lib/supabase/fetch-all";
import type { TablesUpdate } from "@/lib/types/database";
import { formatDMY } from "@/lib/format";

type DtKtRecord = {
  id: string;
  forwarder_id: string;
  company_group_id: string;
  year: number;
  opening_balance: number | null;
  payment: number | null;
  refund: number | null;
  fines: number | null;
  surcharge_preliminary: number | null;
  ogem: number | null;
  forwarder?: { name: string } | null;
  company_group?: { name: string } | null;
};

type DtKtPayment = { id: string; payment_date: string; amount: number; description: string | null; currency: string | null };
type RegistrySums = { forwarder_id: string; company_group_id: string | null; total_volume: number; total_amount: number };

function fmt(v: number | null | undefined) {
  // Money — always 2 decimals per client canon 2026-07-07.
  return v == null ? "—" : v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function n(v: number | null | undefined) { return v ?? 0; }

// Подсказки о знаке. Колонка «Сальдо на 1 янв.» вводится руками, и до
// 12.08.2026 понять по форме, каким знаком её писать, было нельзя — три
// записи из-за этого ввели в старой конвенции.
const SIGN_HINT = "Вводится со своим знаком: минус — нам должны, плюс — мы должны. Знак берётся как есть и в расчёте не разворачивается.";
const SALDO_HINT = "Сальдо 1 янв + Возврат + Отгрузка + Штрафы + Сверхнорм + ОГЭМ − Оплата. Плюс — мы должны экспедитору, минус (красным) — нам должны.";

// Inline editable cells for DT-KT (number / date / text)
function InlineDtNum({ value, onSave, className = "", title }: { value: number | null | undefined; onSave: (v: number | null) => Promise<void>; className?: string; title?: string }) {
  const [ed, setEd] = useState(false);
  const [lv, setLv] = useState("");
  if (!ed) return (
    <button onClick={() => { setLv(value == null ? "" : String(value)); setEd(true); }} title={title}
      className={`w-full text-right font-mono text-[11px] tabular-nums hover:bg-amber-50 rounded px-1 py-0.5 cursor-text ${className}`}>
      {fmt(value)}
    </button>
  );
  return (
    <input autoFocus type="number" step="0.01" value={lv}
      onChange={(e) => setLv(e.target.value)}
      onBlur={() => { setEd(false); const x = lv.trim() === "" ? null : parseFloat(lv.replace(",", ".")); if (x !== value) onSave(Number.isFinite(x as number) ? x : null); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEd(false); }}
      className="w-full text-right font-mono text-[11px] border border-amber-300 rounded px-1 bg-amber-50/50 focus:outline-none" />
  );
}
function InlineDtDate({ value, onSave }: { value: string | null; onSave: (v: string | null) => Promise<void> }) {
  const [ed, setEd] = useState(false);
  const [lv, setLv] = useState("");
  if (!ed) return (
    <button onClick={() => { setLv(value ? value.split("T")[0] : ""); setEd(true); }}
      className="text-[11px] hover:bg-amber-50 rounded px-1 py-0.5 cursor-text">
      {value ? formatDMY(value) : "—"}
    </button>
  );
  return (
    <input autoFocus type="date" value={lv}
      onChange={(e) => setLv(e.target.value)}
      onBlur={() => { setEd(false); if (lv && lv !== (value?.split("T")[0] ?? "")) onSave(lv); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEd(false); }}
      className="border border-amber-300 rounded px-1 py-0 text-[11px] bg-amber-50/50 focus:outline-none" />
  );
}
function InlineDtText({ value, onSave, placeholder = "" }: { value: string | null; onSave: (v: string | null) => Promise<void>; placeholder?: string }) {
  const [ed, setEd] = useState(false);
  const [lv, setLv] = useState("");
  if (!ed) return (
    <button onClick={() => { setLv(value ?? ""); setEd(true); }}
      className="text-[11px] text-stone-500 hover:bg-amber-50 rounded px-1 py-0.5 cursor-text">
      {value || <span className="text-stone-300">{placeholder || "—"}</span>}
    </button>
  );
  return (
    <input autoFocus value={lv}
      onChange={(e) => setLv(e.target.value)}
      onBlur={() => { setEd(false); const nv = lv.trim() || null; if (nv !== value) onSave(nv); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEd(false); }}
      placeholder={placeholder}
      className="border border-amber-300 rounded px-1 py-0 text-[11px] bg-amber-50/50 focus:outline-none" />
  );
}

// Формула сальдо живёт в @/lib/dtkt/saldo — там же вся её история и
// конвенция знака. Здесь только подстановка величин, которых нет в самой
// строке: shipped (сумма реестра за год) и payment (сумма строк
// dt_kt_payments, а не хранимая row.payment — иначе сальдо считалось бы
// от устаревшего итога оплат).
function computeSaldo(row: DtKtRecord, shipped: number, payment: number) {
  return computeDtKtSaldo(row, shipped, payment);
}

// --- Add Dialog with multiple payments ---
function AddDtKtDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const sb = useRef(createClient());
  const [forwarders, setForwarders] = useState<{ id: string; name: string }[]>([]);
  const [companyGroups, setCompanyGroups] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [fwId, setFwId] = useState(""); const [cgId, setCgId] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [balance, setBalance] = useState(""); const [refund, setRefund] = useState("");
  const [fines, setFines] = useState(""); const [surcharge, setSurcharge] = useState(""); const [ogem, setOgem] = useState("");
  // Multiple payments (each can have its own currency override)
  const [payments, setPayments] = useState<{ amount: string; date: string; currency: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      sb.current.from("forwarders").select("id, name").eq("is_active", true).order("name"),
      sb.current.from("company_groups").select("id, name").order("name"),
    ]).then(([fw, cg]) => {
      setForwarders((fw.data ?? []) as { id: string; name: string }[]);
      setCompanyGroups((cg.data ?? []) as { id: string; name: string }[]);
    });
  }, [open]);

  function addPaymentRow() { setPayments([...payments, { amount: "", date: new Date().toISOString().split("T")[0], currency: "" }]); }
  function removePaymentRow(i: number) { setPayments(payments.filter((_, idx) => idx !== i)); }

  async function save() {
    if (!fwId) { toast.error("Выберите экспедитора"); return; }
    if (!cgId) { toast.error("Выберите группу компании"); return; }
    setSaving(true);
    const totalPayment = payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    const { data, error } = await sb.current.from("dt_kt_logistics").insert({
      forwarder_id: fwId, company_group_id: cgId, year: parseInt(year),
      opening_balance: balance ? parseFloat(balance) : null,
      payment: totalPayment || null,
      refund: refund ? parseFloat(refund) : null, fines: fines ? parseFloat(fines) : null,
      surcharge_preliminary: surcharge ? parseFloat(surcharge) : null, ogem: ogem ? parseFloat(ogem) : null,
    }).select("id").single();
    if (error || !data) { toast.error(error?.message ?? "Ошибка"); setSaving(false); return; }
    // Insert individual payments
    if (payments.length > 0) {
      const paymentRows = payments.filter((p) => p.amount).map((p) => ({
        dt_kt_id: data.id, forwarder_id: fwId, company_group_id: cgId,
        payment_date: p.date, amount: parseFloat(p.amount),
        currency: p.currency || null,
      }));
      if (paymentRows.length > 0) await sb.current.from("dt_kt_payments").insert(paymentRows);
    }
    setSaving(false); toast.success("Запись добавлена"); onCreated(); onClose();
    setFwId(""); setCgId(""); setBalance(""); setRefund(""); setFines(""); setSurcharge(""); setOgem(""); setPayments([]);
  }

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Добавить запись ДТ-КТ</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><Label className="text-[12px] text-stone-500">Экспедитор *</Label>
            <select value={fwId} onChange={(e) => setFwId(e.target.value)} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer">
              <option value="">Выберите...</option>{forwarders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div><Label className="text-[12px] text-stone-500">Группа компании</Label>
            <select value={cgId} onChange={(e) => setCgId(e.target.value)} className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer">
              <option value="">Выберите...</option>{companyGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div><Label className="text-[12px] text-stone-500">Год *</Label><Input type="number" value={year} onChange={(e) => setYear(e.target.value)} className="h-8 text-[13px] font-mono" /></div>
          <div>
            <Label className="text-[12px] text-stone-500">Сальдо на 1 янв.</Label>
            <Input type="number" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} className="h-8 text-[13px] font-mono" placeholder="0.00" title={SIGN_HINT} />
            <p className="mt-0.5 text-[10px] text-stone-400">минус — нам должны, плюс — мы должны</p>
          </div>
          <div><Label className="text-[12px] text-stone-500">Возврат</Label><Input type="number" step="0.01" value={refund} onChange={(e) => setRefund(e.target.value)} className="h-8 text-[13px] font-mono" placeholder="0.00" /></div>
          <div><Label className="text-[12px] text-stone-500">Штрафы</Label><Input type="number" step="0.01" value={fines} onChange={(e) => setFines(e.target.value)} className="h-8 text-[13px] font-mono" placeholder="0.00" /></div>
          <div><Label className="text-[12px] text-stone-500">Сверхнорм.</Label><Input type="number" step="0.01" value={surcharge} onChange={(e) => setSurcharge(e.target.value)} className="h-8 text-[13px] font-mono" placeholder="0.00" /></div>
          <div><Label className="text-[12px] text-stone-500">ОГЭМ</Label><Input type="number" step="0.01" value={ogem} onChange={(e) => setOgem(e.target.value)} className="h-8 text-[13px] font-mono" placeholder="0.00" /></div>
        </div>
        {/* Multiple payments */}
        <div className="mt-3 border-t pt-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[12px] font-medium text-stone-600">Оплаты</p>
            <Button size="sm" variant="outline" onClick={addPaymentRow} className="h-6 text-[10px]"><Plus className="h-3 w-3 mr-1" />Добавить оплату</Button>
          </div>
          {payments.length === 0 ? <p className="text-[11px] text-stone-400">Нет оплат</p> : (
            <div className="space-y-1.5">
              {payments.map((p, i) => (
                <div key={i} className="flex gap-2 items-end">
                  <div className="w-28"><Label className="text-[10px]">Сумма</Label><Input type="number" step="0.01" value={p.amount} onChange={(e) => { const u = [...payments]; u[i].amount = e.target.value; setPayments(u); }} className="h-7 text-[12px] font-mono" /></div>
                  <div className="w-24"><Label className="text-[10px]">Валюта</Label>
                    <select value={p.currency} onChange={(e) => { const u = [...payments]; u[i].currency = e.target.value; setPayments(u); }} className="w-full h-7 rounded border border-stone-200 bg-white px-1 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer">
                      <option value="">авто</option>
                      {CURRENCIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <div className="w-32"><Label className="text-[10px]">Дата</Label><Input type="date" value={p.date} onChange={(e) => { const u = [...payments]; u[i].date = e.target.value; setPayments(u); }} className="h-7 text-[12px]" /></div>
                  <button onClick={() => removePaymentRow(i)} className="text-stone-300 hover:text-red-500 pb-1"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              <p className="text-[10px] text-stone-500">Итого: {fmt(payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0))}</p>
            </div>
          )}
        </div>
        <Button onClick={save} disabled={saving} className="w-full mt-2 bg-amber-500 hover:bg-amber-600 text-white">{saving ? "Сохранение..." : "Добавить"}</Button>
      </DialogContent>
    </Dialog>
  );
}

export default function DtKtPage() {
  const sb = useRef(createClient());
  const [records, setRecords] = useState<DtKtRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const showLoader = useDelayed(loading);
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear());
  const [showAdd, setShowAdd] = useState(false);
  const [registrySums, setRegistrySums] = useState<RegistrySums[]>([]);
  const [dtktPayments, setDtktPayments] = useState<Record<string, DtKtPayment[]>>({});
  const [expandedPayments, setExpandedPayments] = useState<string | null>(null);
  // Column filters
  const [forwarderFilter, setForwarderFilter] = useState("");
  const [companyGroupFilter, setCompanyGroupFilter] = useState("");
  const [search, setSearch] = useState("");
  const [onlyNegativeSaldo, setOnlyNegativeSaldo] = useState(false);

  async function load() {
    setLoading(true);
    // dt_kt_payments has no year filter at all (history across all
    // forwarders × years lives in one bucket), so it WILL hit the
    // PostgREST Max-Rows=1000 cap once the client has ≥3 active years.
    // Paginate to keep the full history visible.
    const [{ data: recs }, { data: regData }, { data: payData }] = await Promise.all([
      sb.current.from("dt_kt_logistics")
        .select("id, forwarder_id, company_group_id, year, opening_balance, payment, refund, fines, surcharge_preliminary, ogem, forwarder:forwarders(name), company_group:company_groups(name)")
        .eq("year", yearFilter).order("forwarder_id"),
      // Placeholder — registry sums computed below
      Promise.resolve({ data: null }),
      // Load all payments for these records — paginated.
      fetchAllPaginated((from, to) =>
        sb.current.from("dt_kt_payments")
          .select("id, dt_kt_id, payment_date, amount, description, currency")
          .order("payment_date")
          .range(from, to),
      ),
    ]);
    setRecords((recs ?? []) as unknown as DtKtRecord[]);
    // Оплаты кладём в состояние СРАЗУ за записями — до (медленного)
    // фетча сумм реестра. Иначе первый рендер успевает показать
    // fallback на хранимую dt_kt_logistics.payment, и пользователь
    // видит мигание устаревшей цифры перед правильной.
    const pMap: Record<string, DtKtPayment[]> = {};
    for (const p of (payData ?? []) as (DtKtPayment & { dt_kt_id: string })[]) {
      if (!pMap[p.dt_kt_id]) pMap[p.dt_kt_id] = [];
      pMap[p.dt_kt_id].push(p);
    }
    setDtktPayments(pMap);
    // Registry sums grouped by (forwarder_id, company_group_id). Each
    // dt_kt_logistics row is keyed on that triple (+ year), so a forwarder
    // with multiple group companies has multiple buckets that must NOT be
    // collapsed. Amount comes from shipped_tonnage_amount (populated by
    // trigger 00031) so registry / DT-KT / dashboard all show the same number.
    if (!regData) {
      // A single year can easily exceed 1000 shipments (Beken's KG side
      // does already). Paginate so the DT-KT registry-sum column is
      // accurate for high-volume years.
      const { data: fallback } = await fetchAllPaginated((from, to) =>
        sb.current.from("shipment_registry")
          .select("forwarder_id, company_group_id, shipment_volume, shipped_tonnage_amount")
          .gte("date", `${yearFilter}-01-01`).lte("date", `${yearFilter}-12-31`)
          .range(from, to),
      );
      if (fallback) {
        const sums = new Map<string, RegistrySums>();
        for (const r of fallback as { forwarder_id: string | null; company_group_id: string | null; shipment_volume: number | null; shipped_tonnage_amount: number | null }[]) {
          if (!r.forwarder_id) continue;
          const key = `${r.forwarder_id}::${r.company_group_id ?? ""}`;
          if (!sums.has(key)) sums.set(key, { forwarder_id: r.forwarder_id, company_group_id: r.company_group_id, total_volume: 0, total_amount: 0 });
          const s = sums.get(key)!;
          s.total_volume += r.shipment_volume ?? 0;
          s.total_amount += r.shipped_tonnage_amount ?? 0;
        }
        setRegistrySums(Array.from(sums.values()));
      }
    } else {
      setRegistrySums(regData as RegistrySums[]);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [yearFilter]);

  // Все правки — оптимистичные: состояние меняется сразу (как в Excel),
  // запрос уходит следом, при ошибке откатываемся на снимок + toast.
  // Раньше здесь стоял await load() — полный рефетч страницы на каждый
  // ввод; из-за него же колонка «Оплата» визуально «не менялась».
  async function updateDtKt(id: string, patch: TablesUpdate<"dt_kt_logistics">) {
    const snapshot = records;
    setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } as DtKtRecord : r)));
    const { error } = await sb.current.from("dt_kt_logistics").update(patch).eq("id", id);
    if (error) { setRecords(snapshot); toast.error(error.message); }
  }
  async function updatePayment(id: string, patch: TablesUpdate<"dt_kt_payments">) {
    const snapshot = dtktPayments;
    setDtktPayments((prev) => {
      const next: Record<string, DtKtPayment[]> = {};
      for (const [k, list] of Object.entries(prev)) {
        next[k] = list.map((p) => (p.id === id ? { ...p, ...patch } as DtKtPayment : p));
      }
      return next;
    });
    const { error } = await sb.current.from("dt_kt_payments").update(patch).eq("id", id);
    if (error) { setDtktPayments(snapshot); toast.error(error.message); }
  }
  async function addPayment(dtKtId: string, forwarderId: string | null, companyGroupId: string | null) {
    if (!forwarderId || !companyGroupId) {
      toast.error("Не удалось определить экспедитора или группу компании для оплаты");
      return;
    }
    setExpandedPayments(dtKtId);
    const { data, error } = await sb.current.from("dt_kt_payments").insert({
      dt_kt_id: dtKtId,
      forwarder_id: forwarderId,
      company_group_id: companyGroupId,
      payment_date: new Date().toISOString().split("T")[0],
      amount: 0,
    }).select("id, dt_kt_id, payment_date, amount, description, currency").single();
    if (error || !data) { toast.error(error?.message ?? "Не удалось добавить оплату"); return; }
    const row = data as unknown as DtKtPayment;
    setDtktPayments((prev) => ({ ...prev, [dtKtId]: [...(prev[dtKtId] ?? []), row] }));
  }
  async function deletePayment(id: string) {
    const snapshot = dtktPayments;
    setDtktPayments((prev) => {
      const next: Record<string, DtKtPayment[]> = {};
      for (const [k, list] of Object.entries(prev)) next[k] = list.filter((p) => p.id !== id);
      return next;
    });
    const { error } = await sb.current.from("dt_kt_payments").delete().eq("id", id);
    if (error) { setDtktPayments(snapshot); toast.error(error.message); }
  }

  // «Оплата» = СУММА строк оплат, а не хранимая dt_kt_logistics.payment.
  // Хранимая заполнялась один раз при создании записи и не
  // пересчитывалась при правке оплат (клиент 2026-07-22: 458 117,80
  // вместо 727 792,30 по 11 оплатам). Триггер 00126 теперь держит
  // колонку в БД, но считаем ещё и здесь — от уже загруженных строк,
  // чтобы цифра менялась мгновенно, без ожидания ответа сервера.
  // Fallback на хранимую — для записей вообще без детальных оплат.
  // useCallback, а не голая функция: обе величины ниже мемоизируются, и
  // компилятор React требует, чтобы их зависимости были стабильны —
  // иначе мемоизация молча отключается.
  const paymentOf = useCallback((rec: DtKtRecord) => {
    const pays = dtktPayments[rec.id];
    return pays && pays.length > 0 ? pays.reduce((s, p) => s + n(p.amount), 0) : n(rec.payment);
  }, [dtktPayments]);

  const getRegistrySum = useCallback((fwId: string | null, cgId: string | null) => {
    if (!fwId) return { vol: 0, amt: 0 };
    const s = registrySums.find((r) => r.forwarder_id === fwId && r.company_group_id === cgId);
    return { vol: s?.total_volume ?? 0, amt: s?.total_amount ?? 0 };
  }, [registrySums]);

  // Build filter option lists from the loaded set so dropdowns only contain
  // values that actually appear for the current year — avoids dead options.
  const forwarderOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of records) {
      const name = (r.forwarder as { name?: string } | null)?.name;
      if (r.forwarder_id && name) m.set(r.forwarder_id, name);
    }
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [records]);

  const companyGroupOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of records) {
      const name = (r.company_group as { name?: string } | null)?.name;
      if (r.company_group_id && name) m.set(r.company_group_id, name);
    }
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [records]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (forwarderFilter && r.forwarder_id !== forwarderFilter) return false;
      if (companyGroupFilter && r.company_group_id !== companyGroupFilter) return false;
      if (onlyNegativeSaldo) {
        const reg = getRegistrySum(r.forwarder_id, r.company_group_id);
        if (computeSaldo(r, reg.amt, paymentOf(r)) >= 0) return false;
      }
      if (q) {
        const fwName = ((r.forwarder as { name?: string } | null)?.name ?? "").toLowerCase();
        const cgName = ((r.company_group as { name?: string } | null)?.name ?? "").toLowerCase();
        if (!fwName.includes(q) && !cgName.includes(q)) return false;
      }
      return true;
    });
  }, [records, forwarderFilter, companyGroupFilter, onlyNegativeSaldo, search, getRegistrySum, paymentOf]);

  const activeFilterCount =
    (forwarderFilter ? 1 : 0) +
    (companyGroupFilter ? 1 : 0) +
    (onlyNegativeSaldo ? 1 : 0) +
    (search.trim() ? 1 : 0);

  // Footer totals — sum across the currently visible rows so the row reflects
  // whatever the user has filtered down to. Currencies are summed naively;
  // mixed-currency aggregates are a known limitation (same as cell display).
  const totals = useMemo(() => {
    let opening = 0, payment = 0, regVol = 0, regAmt = 0, refund = 0, fines = 0, surcharge = 0, ogem = 0, saldo = 0;
    for (const r of filtered) {
      const reg = getRegistrySum(r.forwarder_id, r.company_group_id);
      const pay = paymentOf(r);
      opening += n(r.opening_balance);
      payment += pay;
      regVol += reg.vol;
      regAmt += reg.amt;
      refund += n(r.refund);
      fines += n(r.fines);
      surcharge += n(r.surcharge_preliminary);
      ogem += n(r.ogem);
      saldo += computeSaldo(r, reg.amt, pay);
    }
    return { opening, payment, regVol, regAmt, refund, fines, surcharge, ogem, saldo };
  }, [filtered, getRegistrySum, paymentOf]);

  // Excel — динамический import(), exceljs не тянется в основной бандл.
  // Выгружается ТЕКУЩАЯ выборка, чтобы файл совпадал с экраном, и с теми
  // же величинами: сальдо считает страница, экспорт его только печатает.
  // Два варианта (клиент 2026-08-25): сокращённый — как таблица;
  // детальный — плюс даты/суммы оплат и АВР от экспедитора.
  const [exporting, setExporting] = useState(false);
  async function handleExport(variant: "short" | "detail") {
    if (exporting) return;
    setExporting(true);
    try {
      const { exportDtKtToExcel } = await import("@/lib/exports/dtkt-excel");
      const rows = filtered.map((rec) => {
        const reg = getRegistrySum(rec.forwarder_id, rec.company_group_id);
        const pay = paymentOf(rec);
        return {
          forwarderId: rec.forwarder_id,
          companyGroupId: rec.company_group_id,
          forwarder: rec.forwarder?.name ?? "—",
          companyGroup: rec.company_group?.name ?? "—",
          year: rec.year ?? null,
          openingBalance: rec.opening_balance,
          payment: pay,
          shippedVolume: reg.vol,
          shippedAmount: reg.amt,
          refund: rec.refund,
          fines: rec.fines,
          surcharge: rec.surcharge_preliminary,
          ogem: rec.ogem,
          saldo: computeSaldo(rec, reg.amt, pay),
          payments: (dtktPayments[rec.id] ?? []).map((p) => ({
            date: p.payment_date,
            amount: p.amount,
            currency: p.currency,
            description: p.description,
          })),
        };
      });
      await exportDtKtToExcel(rows, { year: yearFilter, variant });
      toast.success("Файл готов");
    } catch (e) {
      reportExportError(e);
    } finally {
      setExporting(false);
    }
  }

  function clearAllFilters() {
    setForwarderFilter("");
    setCompanyGroupFilter("");
    setOnlyNegativeSaldo(false);
    setSearch("");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">ДТ-КТ Логистика</h1>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            {/* DropdownMenuTrigger не принимает asChild в типах этого
                репозитория — триггер стилизован под соседнюю кнопку,
                как в паспорте и реестре. */}
            <DropdownMenuTrigger
              className="inline-flex items-center justify-center whitespace-nowrap gap-1 h-8 rounded-md border border-stone-200 bg-white px-3 text-xs font-medium shadow-xs hover:bg-stone-50 transition-colors disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
              disabled={exporting || filtered.length === 0}
              title="Экспорт текущей выборки в Excel"
            >
              {exporting ? <Loader2 className="mr-0.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-0.5 h-3.5 w-3.5" />}
              Excel
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem onClick={() => handleExport("short")} disabled={exporting}>
                <div className="flex flex-col">
                  <span className="font-medium">Сальдо (сокращённый)</span>
                  <span className="text-[11px] text-stone-500">Одна строка на экспедитора и плательщика ЖД</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("detail")} disabled={exporting}>
                <div className="flex flex-col">
                  <span className="font-medium">Сальдо (детальный)</span>
                  <span className="text-[11px] text-stone-500">Плюс даты и суммы оплат и АВР от экспедитора</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white" onClick={() => setShowAdd(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />Добавить
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-stone-400" />
            <span className="text-[12px] text-stone-500">Год:</span>
            <Input type="number" value={yearFilter} onChange={(e) => setYearFilter(Number(e.target.value))} className="w-20 h-7 text-[12px]" />
          </div>
          <Input
            placeholder="Поиск по экспедитору / группе..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs h-7 text-[12px]"
          />
          <label className="flex items-center gap-1.5 text-[11px] text-stone-600 cursor-pointer">
            <input
              type="checkbox"
              checked={onlyNegativeSaldo}
              onChange={(e) => setOnlyNegativeSaldo(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-stone-300 text-amber-500 focus:ring-amber-300"
            />
            Только отриц. сальдо
          </label>
          {activeFilterCount > 0 && (
            <Button size="sm" variant="ghost" onClick={clearAllFilters} className="h-7 text-[11px] text-stone-500 hover:text-red-600">
              <X className="h-3 w-3 mr-0.5" />
              Сбросить фильтры ({activeFilterCount})
            </Button>
          )}
          <span className="text-[11px] text-stone-400 ml-auto">
            {filtered.length} {filtered.length === records.length ? "" : `из ${records.length}`} записей
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          <select
            value={forwarderFilter}
            onChange={(e) => setForwarderFilter(e.target.value)}
            className="h-7 rounded-md border border-stone-200 bg-white px-2 text-[11px] focus:border-amber-400 focus:outline-none cursor-pointer"
          >
            <option value="">Все экспедиторы</option>
            {forwarderOptions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <select
            value={companyGroupFilter}
            onChange={(e) => setCompanyGroupFilter(e.target.value)}
            className="h-7 rounded-md border border-stone-200 bg-white px-2 text-[11px] focus:border-amber-400 focus:outline-none cursor-pointer"
          >
            <option value="">Все группы</option>
            {companyGroupOptions.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
      </div>

      {showLoader && records.length === 0 ? <p className="text-sm text-muted-foreground">Загрузка...</p>
      : records.length === 0 ? (
        <div className="rounded-md border border-stone-200 bg-white py-12 text-center">
          <p className="text-sm text-stone-500">Нет данных за {yearFilter} год</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-stone-200 bg-white py-12 text-center">
          <p className="text-sm text-stone-500">Ни одна запись не подходит под фильтры</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-stone-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow className="bg-stone-50">
                <TableHead className="text-[11px]">Экспедитор</TableHead>
                <TableHead className="text-[11px]">Группа комп.</TableHead>
                <TableHead className="text-[11px]">Год</TableHead>
                <TableHead className="text-right text-[11px]" title={SIGN_HINT}>Сальдо 1 янв.<span className="ml-0.5 text-stone-300">?</span></TableHead>
                <TableHead className="text-right text-[11px]">Оплата</TableHead>
                <TableHead className="text-right text-[11px]">Отгр. тонн</TableHead>
                <TableHead className="text-right text-[11px]">Отгр. сумма</TableHead>
                <TableHead className="text-right text-[11px]">Возврат</TableHead>
                <TableHead className="text-right text-[11px]">Штрафы</TableHead>
                <TableHead className="text-right text-[11px]">Сверхнорм.</TableHead>
                <TableHead className="text-right text-[11px]">ОГЭМ</TableHead>
                <TableHead className="text-right text-[11px] font-semibold" title={SALDO_HINT}>Сальдо<span className="ml-0.5 font-normal text-stone-300">?</span></TableHead>
                <TableHead className="w-[30px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((rec) => {
                const reg = getRegistrySum(rec.forwarder_id, rec.company_group_id);
                const pay = paymentOf(rec);
                const saldo = computeSaldo(rec, reg.amt, pay);
                // Сортировка на клиенте: правка даты оптимистична, рефетча
                // (который раньше приносил порядок с сервера) больше нет.
                const pays = [...(dtktPayments[rec.id] ?? [])]
                  .sort((a, b) => (a.payment_date ?? "").localeCompare(b.payment_date ?? ""));
                const expanded = expandedPayments === rec.id;
                return (
                  <Fragment key={rec.id}>
                    <TableRow className="hover:bg-amber-50/30">
                      <TableCell className="text-[12px] text-stone-700">{rec.forwarder?.name ?? "—"}</TableCell>
                      <TableCell className="text-[12px] text-stone-600">{rec.company_group?.name ?? "—"}</TableCell>
                      <TableCell className="font-mono text-[12px]">{rec.year ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <InlineDtNum value={rec.opening_balance} onSave={(v) => updateDtKt(rec.id, { opening_balance: v })} title={SIGN_HINT} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular-nums">
                        <button onClick={() => setExpandedPayments(expanded ? null : rec.id)}
                          className="hover:bg-amber-50 rounded px-1 underline decoration-dotted decoration-stone-300">
                          {fmt(pay)} {pays.length > 0 && <span className="text-[9px] text-stone-400">({pays.length})</span>}
                        </button>
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular-nums text-blue-600">{reg.vol > 0 ? fmt(reg.vol) : "—"}</TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular-nums text-blue-600">{reg.amt > 0 ? fmt(reg.amt) : "—"}</TableCell>
                      <TableCell className="text-right">
                        <InlineDtNum value={rec.refund} onSave={(v) => updateDtKt(rec.id, { refund: v })} />
                      </TableCell>
                      <TableCell className="text-right">
                        <InlineDtNum value={rec.fines} onSave={(v) => updateDtKt(rec.id, { fines: v })} className="text-red-600" />
                      </TableCell>
                      <TableCell className="text-right">
                        <InlineDtNum value={rec.surcharge_preliminary} onSave={(v) => updateDtKt(rec.id, { surcharge_preliminary: v })} className="text-orange-600" />
                      </TableCell>
                      <TableCell className="text-right">
                        <InlineDtNum value={rec.ogem} onSave={(v) => updateDtKt(rec.id, { ogem: v })} />
                      </TableCell>
                      <TableCell className={`text-right font-mono text-[11px] tabular-nums font-semibold ${saldo < 0 ? "text-red-600" : "text-green-700"}`}>{fmt(saldo)}</TableCell>
                      <TableCell>
                        <button onClick={async () => {
                          if (!confirm("Удалить запись ДТ-КТ?")) return;
                          const s = createClient();
                          await s.from("dt_kt_payments").delete().eq("dt_kt_id", rec.id);
                          const { error } = await s.from("dt_kt_logistics").delete().eq("id", rec.id);
                          if (error) toast.error(error.message); else { toast.success("Удалено"); load(); }
                        }} className="rounded p-0.5 text-stone-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </TableCell>
                    </TableRow>
                    {/* Раскрытые оплаты — строками ТАБЛИЦЫ, а не свободной
                        версткой внутри colSpan. Суммы стоят ровно под
                        колонкой «Оплата» и под её итогом (клиент
                        2026-07-22: «расположение колонки оплат и итоговой
                        суммы путает пользователей»). */}
                    {expanded && (
                      <TableRow className="bg-stone-50/60 hover:bg-stone-50/60">
                        <TableCell colSpan={4} className="py-1 pl-4 text-[10px] font-medium text-stone-500">
                          Оплаты ({pays.length}):
                        </TableCell>
                        <TableCell colSpan={9} className="py-1 text-right">
                          <Button size="sm" variant="outline" onClick={() => addPayment(rec.id, rec.forwarder_id, rec.company_group_id)} className="h-6 text-[10px]">
                            <Plus className="h-3 w-3 mr-1" />Добавить оплату
                          </Button>
                        </TableCell>
                      </TableRow>
                    )}
                    {expanded && pays.length === 0 && (
                      <TableRow className="bg-stone-50/60 hover:bg-stone-50/60">
                        <TableCell colSpan={13} className="py-1 pl-4 text-[11px] text-stone-400">Нет оплат</TableCell>
                      </TableRow>
                    )}
                    {expanded && pays.map((p) => (
                      <TableRow key={p.id} className="bg-stone-50/60 hover:bg-amber-50/40">
                        <TableCell className="py-0.5 pl-4 text-[11px]">
                          <InlineDtDate value={p.payment_date} onSave={(v) => v ? updatePayment(p.id, { payment_date: v }) : Promise.resolve()} />
                        </TableCell>
                        <TableCell colSpan={2} className="py-0.5 text-[11px]">
                          <InlineDtText value={p.description} onSave={(v) => updatePayment(p.id, { description: v })} placeholder="описание" />
                        </TableCell>
                        <TableCell className="py-0.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-[10px] text-stone-400">{currencySymbol(p.currency ?? "KZT")}</span>
                            <select
                              value={p.currency ?? ""}
                              onChange={(e) => updatePayment(p.id, { currency: e.target.value || null })}
                              className="h-6 text-[10px] border border-transparent rounded bg-transparent hover:bg-amber-50 px-0.5 cursor-pointer focus:outline-none focus:border-amber-300"
                            >
                              <option value="">авто</option>
                              {CURRENCIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                            </select>
                          </div>
                        </TableCell>
                        <TableCell className="py-0.5 text-right">
                          <InlineDtNum value={p.amount} onSave={(v) => v != null ? updatePayment(p.id, { amount: v }) : Promise.resolve()} />
                        </TableCell>
                        <TableCell colSpan={7} />
                        <TableCell className="py-0.5">
                          <button onClick={() => { if (confirm("Удалить оплату?")) deletePayment(p.id); }} className="rounded p-0.5 text-stone-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow className="bg-stone-100 hover:bg-stone-100 border-t-2 border-stone-300">
                <TableCell colSpan={3} className="text-[12px] font-semibold text-stone-700">
                  Итого ({filtered.length})
                </TableCell>
                <TableCell className="text-right font-mono text-[11px] tabular-nums font-semibold">{fmt(totals.opening)}</TableCell>
                <TableCell className="text-right font-mono text-[11px] tabular-nums font-semibold">{fmt(totals.payment)}</TableCell>
                <TableCell className="text-right font-mono text-[11px] tabular-nums font-semibold text-blue-700">{totals.regVol > 0 ? fmt(totals.regVol) : "—"}</TableCell>
                <TableCell className="text-right font-mono text-[11px] tabular-nums font-semibold text-blue-700">{totals.regAmt > 0 ? fmt(totals.regAmt) : "—"}</TableCell>
                <TableCell className="text-right font-mono text-[11px] tabular-nums font-semibold">{fmt(totals.refund)}</TableCell>
                <TableCell className="text-right font-mono text-[11px] tabular-nums font-semibold text-red-600">{fmt(totals.fines)}</TableCell>
                <TableCell className="text-right font-mono text-[11px] tabular-nums font-semibold text-orange-600">{fmt(totals.surcharge)}</TableCell>
                <TableCell className="text-right font-mono text-[11px] tabular-nums font-semibold">{fmt(totals.ogem)}</TableCell>
                <TableCell className={`text-right font-mono text-[11px] tabular-nums font-bold ${totals.saldo < 0 ? "text-red-600" : "text-green-700"}`}>{fmt(totals.saldo)}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}

      <AddDtKtDialog open={showAdd} onClose={() => setShowAdd(false)} onCreated={load} />
    </div>
  );
}
