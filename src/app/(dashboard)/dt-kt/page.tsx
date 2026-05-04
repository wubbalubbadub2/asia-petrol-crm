"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Plus, Filter, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { CURRENCIES, currencySymbol } from "@/lib/constants/currencies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import type { TablesUpdate } from "@/lib/types/database";

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

function fmt(v: number | null | undefined) { return v == null ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: 2 }); }
function n(v: number | null | undefined) { return v ?? 0; }

// Inline editable cells for DT-KT (number / date / text)
function InlineDtNum({ value, onSave, className = "" }: { value: number | null | undefined; onSave: (v: number | null) => Promise<void>; className?: string }) {
  const [ed, setEd] = useState(false);
  const [lv, setLv] = useState("");
  if (!ed) return (
    <button onClick={() => { setLv(value == null ? "" : String(value)); setEd(true); }}
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
      {value ? new Date(value).toLocaleDateString("ru-RU") : "—"}
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

function computeSaldo(row: DtKtRecord, shipped: number) {
  return n(row.opening_balance) + n(row.payment) - shipped - n(row.fines) - n(row.surcharge_preliminary) - n(row.ogem) - n(row.refund);
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
          <div><Label className="text-[12px] text-stone-500">Сальдо на 1 янв.</Label><Input type="number" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} className="h-8 text-[13px] font-mono" placeholder="0.00" /></div>
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
    const [{ data: recs }, { data: regData }, { data: payData }] = await Promise.all([
      sb.current.from("dt_kt_logistics")
        .select("id, forwarder_id, company_group_id, year, opening_balance, payment, refund, fines, surcharge_preliminary, ogem, forwarder:forwarders(name), company_group:company_groups(name)")
        .eq("year", yearFilter).order("forwarder_id"),
      // Placeholder — registry sums computed below
      Promise.resolve({ data: null }),
      // Load all payments for these records
      sb.current.from("dt_kt_payments").select("id, dt_kt_id, payment_date, amount, description, currency").order("payment_date"),
    ]);
    setRecords((recs ?? []) as unknown as DtKtRecord[]);
    // Registry sums grouped by (forwarder_id, company_group_id). Each
    // dt_kt_logistics row is keyed on that triple (+ year), so a forwarder
    // with multiple group companies has multiple buckets that must NOT be
    // collapsed. Amount comes from shipped_tonnage_amount (populated by
    // trigger 00031) so registry / DT-KT / dashboard all show the same number.
    if (!regData) {
      const { data: fallback } = await sb.current.from("shipment_registry")
        .select("forwarder_id, company_group_id, shipment_volume, shipped_tonnage_amount")
        .gte("date", `${yearFilter}-01-01`).lte("date", `${yearFilter}-12-31`);
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
    // Group payments by dt_kt_id
    const pMap: Record<string, DtKtPayment[]> = {};
    for (const p of (payData ?? []) as (DtKtPayment & { dt_kt_id: string })[]) {
      if (!pMap[p.dt_kt_id]) pMap[p.dt_kt_id] = [];
      pMap[p.dt_kt_id].push(p);
    }
    setDtktPayments(pMap);
    setLoading(false);
  }

  useEffect(() => { load(); }, [yearFilter]);

  async function updateDtKt(id: string, patch: TablesUpdate<"dt_kt_logistics">) {
    const { error } = await sb.current.from("dt_kt_logistics").update(patch).eq("id", id);
    if (error) { toast.error(error.message); return; }
    await load();
  }
  async function updatePayment(id: string, patch: TablesUpdate<"dt_kt_payments">) {
    const { error } = await sb.current.from("dt_kt_payments").update(patch).eq("id", id);
    if (error) { toast.error(error.message); return; }
    await load();
  }
  async function addPayment(dtKtId: string, forwarderId: string | null, companyGroupId: string | null) {
    if (!forwarderId || !companyGroupId) {
      toast.error("Не удалось определить экспедитора или группу компании для оплаты");
      return;
    }
    const { error } = await sb.current.from("dt_kt_payments").insert({
      dt_kt_id: dtKtId,
      forwarder_id: forwarderId,
      company_group_id: companyGroupId,
      payment_date: new Date().toISOString().split("T")[0],
      amount: 0,
    });
    if (error) { toast.error(error.message); return; }
    setExpandedPayments(dtKtId);
    await load();
  }
  async function deletePayment(id: string) {
    const { error } = await sb.current.from("dt_kt_payments").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    await load();
  }

  function getRegistrySum(fwId: string | null, cgId: string | null) {
    if (!fwId) return { vol: 0, amt: 0 };
    const s = registrySums.find((r) => r.forwarder_id === fwId && r.company_group_id === cgId);
    return { vol: s?.total_volume ?? 0, amt: s?.total_amount ?? 0 };
  }

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
        if (computeSaldo(r, reg.amt) >= 0) return false;
      }
      if (q) {
        const fwName = ((r.forwarder as { name?: string } | null)?.name ?? "").toLowerCase();
        const cgName = ((r.company_group as { name?: string } | null)?.name ?? "").toLowerCase();
        if (!fwName.includes(q) && !cgName.includes(q)) return false;
      }
      return true;
    });
  }, [records, forwarderFilter, companyGroupFilter, onlyNegativeSaldo, search, registrySums]);

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
      opening += n(r.opening_balance);
      payment += n(r.payment);
      regVol += reg.vol;
      regAmt += reg.amt;
      refund += n(r.refund);
      fines += n(r.fines);
      surcharge += n(r.surcharge_preliminary);
      ogem += n(r.ogem);
      saldo += computeSaldo(r, reg.amt);
    }
    return { opening, payment, regVol, regAmt, refund, fines, surcharge, ogem, saldo };
  }, [filtered, registrySums]);

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
        <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white" onClick={() => setShowAdd(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />Добавить
        </Button>
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

      {loading ? <p className="text-sm text-muted-foreground">Загрузка...</p>
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
                <TableHead className="text-right text-[11px]">Сальдо 1 янв.</TableHead>
                <TableHead className="text-right text-[11px]">Оплата</TableHead>
                <TableHead className="text-right text-[11px]">Отгр. тонн</TableHead>
                <TableHead className="text-right text-[11px]">Отгр. сумма</TableHead>
                <TableHead className="text-right text-[11px]">Возврат</TableHead>
                <TableHead className="text-right text-[11px]">Штрафы</TableHead>
                <TableHead className="text-right text-[11px]">Сверхнорм.</TableHead>
                <TableHead className="text-right text-[11px]">ОГЭМ</TableHead>
                <TableHead className="text-right text-[11px] font-semibold">Сальдо</TableHead>
                <TableHead className="w-[30px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((rec) => {
                const reg = getRegistrySum(rec.forwarder_id, rec.company_group_id);
                const saldo = computeSaldo(rec, reg.amt);
                const pays = dtktPayments[rec.id] ?? [];
                return (
                  <>
                    <TableRow key={rec.id} className="hover:bg-amber-50/30">
                      <TableCell className="text-[12px] text-stone-700">{(rec.forwarder as any)?.name ?? "—"}</TableCell>
                      <TableCell className="text-[12px] text-stone-600">{(rec.company_group as any)?.name ?? "—"}</TableCell>
                      <TableCell className="font-mono text-[12px]">{rec.year ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <InlineDtNum value={rec.opening_balance} onSave={(v) => updateDtKt(rec.id, { opening_balance: v })} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px] tabular-nums">
                        <button onClick={() => setExpandedPayments(expandedPayments === rec.id ? null : rec.id)}
                          className="hover:bg-amber-50 rounded px-1 underline decoration-dotted decoration-stone-300">
                          {fmt(rec.payment)} {pays.length > 0 && <span className="text-[9px] text-stone-400">({pays.length})</span>}
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
                    {/* Expanded editable payments */}
                    {expandedPayments === rec.id && (
                      <TableRow key={`${rec.id}-pays`}>
                        <TableCell colSpan={13} className="bg-stone-50/50 px-4 py-2">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-[10px] font-medium text-stone-500">Оплаты ({pays.length}):</p>
                            <Button size="sm" variant="outline" onClick={() => addPayment(rec.id, rec.forwarder_id, rec.company_group_id)} className="h-6 text-[10px]">
                              <Plus className="h-3 w-3 mr-1" />Добавить оплату
                            </Button>
                          </div>
                          {pays.length === 0 ? (
                            <p className="text-[11px] text-stone-400">Нет оплат</p>
                          ) : (
                            <div className="space-y-0.5">
                              {pays.map((p) => (
                                <div key={p.id} className="flex items-center gap-3 text-[11px]">
                                  <span className="w-28"><InlineDtDate value={p.payment_date} onSave={(v) => v ? updatePayment(p.id, { payment_date: v }) : Promise.resolve()} /></span>
                                  <span className="w-28 text-right">
                                    <InlineDtNum value={p.amount} onSave={(v) => v != null ? updatePayment(p.id, { amount: v }) : Promise.resolve()} />
                                  </span>
                                  <span className="text-[10px] text-stone-500 w-10">{currencySymbol(p.currency ?? "KZT")}</span>
                                  <select
                                    value={p.currency ?? ""}
                                    onChange={(e) => updatePayment(p.id, { currency: e.target.value || null })}
                                    className="h-6 text-[10px] border border-transparent rounded bg-transparent hover:bg-amber-50 px-0.5 cursor-pointer focus:outline-none focus:border-amber-300"
                                  >
                                    <option value="">авто</option>
                                    {CURRENCIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                                  </select>
                                  <span className="flex-1"><InlineDtText value={p.description} onSave={(v) => updatePayment(p.id, { description: v })} placeholder="описание" /></span>
                                  <button onClick={() => { if (confirm("Удалить оплату?")) deletePayment(p.id); }} className="text-stone-300 hover:text-red-500 transition-colors">
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </>
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
