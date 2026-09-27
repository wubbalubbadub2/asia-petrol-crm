"use client";
// Протоколы согласования договорной цены экспедиторов (миграция 00174).
//
// Из протокола расчёт простоя берёт: нормы погрузки/выгрузки по маршруту,
// ставку за вагон-сутки, валюту, НДС и правило «день прибытия считается /
// со следующих суток». Протокол выбирается по экспедитору, станциям
// гружёного рейса и дате гружёного рейса внутри периода действия.
// Ставки за тонну на этапе 1 только хранятся.
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useProtocols, useRailReferences, saveProtocol, deleteProtocol, type Option } from "@/lib/hooks/use-dislocation";
import type { Protocol, ProtocolRoute } from "@/lib/dislocation/types";
import { useRole } from "@/lib/role-context";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatDMY } from "@/lib/format";

const EMPTY_ROUTE: ProtocolRoute = {
  position: 0,
  departure_station_id: "",
  destination_station_id: "",
  fuel_type_id: null,
  loading_norm_days: 2,
  unloading_norm_days: 3,
  railway_tariff_per_ton: null,
  operator_rate_per_ton: null,
  forwarding_fee_per_ton: null,
};

const EMPTY: Protocol = {
  forwarder_id: "",
  company_group_id: null,
  number: "",
  protocol_date: null,
  valid_from: "",
  valid_to: null,
  demurrage_rate: 35,
  currency: "USD",
  rate_includes_vat: false,
  arrival_day_counts: true,
  partial_day_counts_full: true,
  note: null,
  routes: [{ ...EMPTY_ROUTE }],
};

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
const label = (opts: Option[], id: string | null) => opts.find((o) => o.value === id)?.label ?? "—";

function validate(p: Protocol): string | null {
  if (!p.forwarder_id) return "Выберите экспедитора";
  if (!p.number.trim()) return "Укажите номер протокола";
  if (!p.valid_from) return "Укажите начало действия";
  if (p.valid_to && p.valid_to < p.valid_from) return "Окончание действия раньше начала";
  if (!(p.demurrage_rate >= 0)) return "Ставка за вагон-сутки не может быть отрицательной";
  if (!/^[A-Z]{3}$/.test(p.currency)) return "Валюта — три латинские буквы (USD)";
  if (p.routes.length === 0) return "Добавьте хотя бы один маршрут";
  for (const [i, r] of p.routes.entries()) {
    if (!r.departure_station_id || !r.destination_station_id) return `Маршрут ${i + 1}: выберите станции`;
    for (const n of [r.loading_norm_days, r.unloading_norm_days]) {
      if (!Number.isInteger(n) || n < 0 || n > 60) return `Маршрут ${i + 1}: норма — целое число суток от 0 до 60`;
    }
  }
  return null;
}

export default function ProtocolsPage() {
  const { isWritable, isAdmin } = useRole();
  const { data, loading, reload } = useProtocols();
  const { forwarders, stations, companyGroups, fuelTypes } = useRailReferences();
  const [form, setForm] = useState<Protocol | null>(null);
  const [saving, setSaving] = useState(false);

  const setRoute = (i: number, patch: Partial<ProtocolRoute>) =>
    setForm((f) => (f ? { ...f, routes: f.routes.map((r, j) => (j === i ? { ...r, ...patch } : r)) } : f));

  async function onSave() {
    if (!form) return;
    const err = validate(form);
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    const ok = await saveProtocol({ ...form, number: form.number.trim() });
    setSaving(false);
    if (ok) {
      toast.success("Протокол сохранён — простой пересчитан");
      setForm(null);
      reload();
    }
  }

  async function onDelete(p: Protocol) {
    if (!p.id || !confirm(`Удалить протокол № ${p.number}? Суммы по его периоду пропадут.`)) return;
    if (await deleteProtocol(p.id)) reload();
  }

  const th = "border-r px-2 py-1 text-left font-medium whitespace-nowrap";
  const td = "border-r px-2 py-1 whitespace-nowrap";

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Протоколы согласования цены</h1>
        <div className="flex items-center gap-3">
          <Link href="/dislocation" className="text-[12px] text-amber-700 hover:underline">← Простой вагонов</Link>
          {isWritable ? <Button className="h-8 text-[12px]" onClick={() => setForm(structuredClone(EMPTY))}>Новый протокол</Button> : null}
        </div>
      </div>

      {loading ? <p className="text-sm text-stone-500">Загрузка…</p> : data.length === 0 ? (
        <p className="text-sm text-stone-500">Протоколов нет. Без протокола простой считается в сутках, но без нормы и суммы.</p>
      ) : (
        <div className="overflow-auto rounded border border-stone-200 bg-white">
          <table className="w-full border-collapse text-[11px]">
            <thead className="bg-stone-100">
              <tr className="border-b">
                <th className={th}>№</th><th className={th}>Экспедитор</th><th className={th}>Компания группы</th>
                <th className={th}>Действует</th><th className={th}>Вагон-сутки</th><th className={th}>Счёт суток</th>
                <th className={th}>Маршруты (погрузка / выгрузка, сут)</th><th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id} className="border-b align-top">
                  <td className={td}>{p.number}{p.protocol_date ? ` от ${formatDMY(p.protocol_date)}` : ""}</td>
                  <td className={td}>{label(forwarders, p.forwarder_id)}</td>
                  <td className={td}>{label(companyGroups, p.company_group_id)}</td>
                  <td className={`${td} font-mono`}>{formatDMY(p.valid_from)} — {p.valid_to ? formatDMY(p.valid_to) : "…"}</td>
                  <td className={`${td} font-mono`}>{p.demurrage_rate} {p.currency}{p.rate_includes_vat ? " с НДС" : " без НДС"}</td>
                  <td className={td}>{p.arrival_day_counts ? "день прибытия считается" : "со следующих суток"}</td>
                  <td className={td}>
                    {p.routes.map((r) => (
                      <div key={r.id}>{label(stations, r.departure_station_id)} → {label(stations, r.destination_station_id)}: {r.loading_norm_days} / {r.unloading_norm_days}</div>
                    ))}
                  </td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    {isWritable ? <button className="text-amber-700 hover:underline" onClick={() => setForm(structuredClone(p))}>изменить</button> : null}
                    {isAdmin ? <button className="ml-3 text-red-700 hover:underline" onClick={() => onDelete(p)}>удалить</button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{form?.id ? `Протокол № ${form.number}` : "Новый протокол"}</DialogTitle>
          </DialogHeader>
          {form ? (
            <div className="grid gap-3 text-[12px]">
              <div className="grid grid-cols-4 gap-3">
                <div className="grid gap-1">
                  <Label className="text-[11px] text-stone-500">Экспедитор *</Label>
                  <SearchableSelect options={forwarders} value={form.forwarder_id} onChange={(v) => setForm({ ...form, forwarder_id: v })}
                    placeholder="Экспедитор" triggerClassName="h-8 w-full text-[12px]" />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[11px] text-stone-500">Компания группы</Label>
                  <SearchableSelect options={companyGroups} value={form.company_group_id ?? ""} onChange={(v) => setForm({ ...form, company_group_id: v || null })}
                    placeholder="Компания" triggerClassName="h-8 w-full text-[12px]" />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[11px] text-stone-500">Номер *</Label>
                  <Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} className="h-8 text-[12px]" />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[11px] text-stone-500">Дата протокола</Label>
                  <Input type="date" value={form.protocol_date ?? ""} onChange={(e) => setForm({ ...form, protocol_date: e.target.value || null })} className="h-8 text-[12px]" />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[11px] text-stone-500">Действует с *</Label>
                  <Input type="date" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} className="h-8 text-[12px]" />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[11px] text-stone-500">Действует по (пусто — бессрочно)</Label>
                  <Input type="date" value={form.valid_to ?? ""} onChange={(e) => setForm({ ...form, valid_to: e.target.value || null })} className="h-8 text-[12px]" />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[11px] text-stone-500">Ставка за вагон-сутки сверх нормы *</Label>
                  <Input inputMode="decimal" value={String(form.demurrage_rate)} onChange={(e) => setForm({ ...form, demurrage_rate: Number(e.target.value.replace(",", ".")) })} className="h-8 text-[12px]" />
                </div>
                <div className="grid gap-1">
                  <Label className="text-[11px] text-stone-500">Валюта *</Label>
                  <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} className="h-8 text-[12px]" />
                </div>
              </div>

              <div className="flex flex-wrap gap-5">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.arrival_day_counts} onChange={(e) => setForm({ ...form, arrival_day_counts: e.target.checked })} />
                  День прибытия — первые сутки нормы («день в день»). Снять — норма со следующих суток.
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.rate_includes_vat} onChange={(e) => setForm({ ...form, rate_includes_vat: e.target.checked })} />
                  Ставка с НДС
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.partial_day_counts_full} onChange={(e) => setForm({ ...form, partial_day_counts_full: e.target.checked })} />
                  Неполные сутки — полные
                </label>
              </div>

              <div className="grid gap-1">
                <Label className="text-[11px] text-stone-500">Маршруты</Label>
                <table className="w-full border-collapse text-[11px]">
                  <thead className="bg-stone-100">
                    <tr className="border-b">
                      <th className={th}>Станция погрузки *</th><th className={th}>Станция выгрузки *</th><th className={th}>Груз</th>
                      <th className={th}>Норма погр., сут *</th><th className={th}>Норма выгр., сут *</th>
                      <th className={th}>Ж/д тариф $/т</th><th className={th}>Оператор $/т</th><th className={th}>ТЭО $/т</th><th className="px-2 py-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.routes.map((r, i) => (
                      <tr key={i} className="border-b">
                        <td className="px-1 py-1"><SearchableSelect options={stations} value={r.departure_station_id} onChange={(v) => setRoute(i, { departure_station_id: v })} placeholder="Станция" triggerClassName="h-7 w-44 text-[11px]" /></td>
                        <td className="px-1 py-1"><SearchableSelect options={stations} value={r.destination_station_id} onChange={(v) => setRoute(i, { destination_station_id: v })} placeholder="Станция" triggerClassName="h-7 w-44 text-[11px]" /></td>
                        <td className="px-1 py-1"><SearchableSelect options={fuelTypes} value={r.fuel_type_id ?? ""} onChange={(v) => setRoute(i, { fuel_type_id: v || null })} placeholder="Груз" triggerClassName="h-7 w-32 text-[11px]" /></td>
                        <td className="px-1 py-1"><Input inputMode="numeric" value={String(r.loading_norm_days)} onChange={(e) => setRoute(i, { loading_norm_days: Number(e.target.value) })} className="h-7 w-16 text-[11px]" /></td>
                        <td className="px-1 py-1"><Input inputMode="numeric" value={String(r.unloading_norm_days)} onChange={(e) => setRoute(i, { unloading_norm_days: Number(e.target.value) })} className="h-7 w-16 text-[11px]" /></td>
                        <td className="px-1 py-1"><Input inputMode="decimal" value={r.railway_tariff_per_ton ?? ""} onChange={(e) => setRoute(i, { railway_tariff_per_ton: numOrNull(e.target.value) })} className="h-7 w-20 text-[11px]" /></td>
                        <td className="px-1 py-1"><Input inputMode="decimal" value={r.operator_rate_per_ton ?? ""} onChange={(e) => setRoute(i, { operator_rate_per_ton: numOrNull(e.target.value) })} className="h-7 w-20 text-[11px]" /></td>
                        <td className="px-1 py-1"><Input inputMode="decimal" value={r.forwarding_fee_per_ton ?? ""} onChange={(e) => setRoute(i, { forwarding_fee_per_ton: numOrNull(e.target.value) })} className="h-7 w-20 text-[11px]" /></td>
                        <td className="px-1 py-1 text-right">
                          <button className="text-red-700 hover:underline" onClick={() => setForm({ ...form, routes: form.routes.filter((_, j) => j !== i) })}>убрать</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="justify-self-start text-[12px] text-amber-700 hover:underline"
                  onClick={() => setForm({ ...form, routes: [...form.routes, { ...EMPTY_ROUTE, position: form.routes.length }] })}>
                  + маршрут
                </button>
              </div>

              <div className="grid gap-1">
                <Label className="text-[11px] text-stone-500">Примечание</Label>
                <Input value={form.note ?? ""} onChange={(e) => setForm({ ...form, note: e.target.value || null })} className="h-8 text-[12px]" />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" className="h-8 text-[12px]" onClick={() => setForm(null)}>Отмена</Button>
            <Button className="h-8 text-[12px]" disabled={saving} onClick={onSave}>{saving ? "Сохранение…" : "Сохранить"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
