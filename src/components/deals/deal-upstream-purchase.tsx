"use client";

// Блок «Закупка (первичный поставщик)» в карточке сделки KG (миграция 00180).
// Наша компания (поставщик сделки с флагом is_own_supplier) купила
// топливо у внешнего продавца по приложению; одна закупка питает
// несколько сделок. Цены нет, на балансы не влияет.
//
// «Продано» и «Остаток» берём из вью deal_upstream_purchase_totals —
// БД здесь источник истины, React их не пересчитывает. Все проверки
// (поставщик сделки = наша компания закупки, завод/продукт совпадают,
// тип сделки KG, продавец — не наша компания) делают триггеры БД; их
// русское сообщение показываем как есть.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Link2, Plus, Pencil, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect, type SelectOption } from "@/components/ui/searchable-select";
import { CollapsibleSection, SECTION_COLORS } from "@/components/deals/collapsible-section";
import { createClient } from "@/lib/supabase/client";
import { updateDeal, invalidateDeal, type Deal } from "@/lib/hooks/use-deals";
import { parseNum } from "@/lib/utils/parse-num";
import { sortByName } from "@/lib/sort-names";
import { useGlobalRefs } from "@/lib/refs";
import {
  sellerLabel,
  totalsNumbers,
  isOversold,
  type UpstreamPurchase,
  type UpstreamPurchaseTotals,
} from "@/lib/deals/upstream-purchase";

// Таблицы и вью закупок нет в сгенерированном database.ts — тот же
// обход, что у consignees в lib/refs.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = { from: (table: string) => any };
function sbLoose(): LooseClient {
  return createClient() as unknown as LooseClient;
}

const PURCHASE_SELECT =
  "id, our_company_id, seller_id, factory_id, fuel_type_id, appendix, volume_tons, comment, seller:counterparties!seller_id(short_name, full_name)";

const fmtVol = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

type FormState = { sellerId: string; appendix: string; volume: string; comment: string };
const EMPTY_FORM: FormState = { sellerId: "", appendix: "", volume: "", comment: "" };

export function DealUpstreamPurchase({ deal, canWrite, onChanged }: {
  deal: Deal;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const linkedId = deal.upstream_purchase_id ?? null;
  const { refs } = useGlobalRefs();
  const [linked, setLinked] = useState<UpstreamPurchase | null>(null);
  const [candidates, setCandidates] = useState<UpstreamPurchase[]>([]);
  const [totals, setTotals] = useState<Map<string, UpstreamPurchaseTotals>>(new Map());
  const [sellers, setSellers] = useState<SelectOption[]>([]);
  const [mode, setMode] = useState<"view" | "new" | "edit">("view");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [pickId, setPickId] = useState("");
  const [busy, setBusy] = useState(false);

  // Подбирать закупку можно только той же нашей компании, с тем же
  // заводом и продуктом — иначе триггер всё равно откажет.
  const canMatch = !!deal.supplier_id && !!deal.factory_id && !!deal.fuel_type_id;

  const load = useCallback(async () => {
    const sb = sbLoose();
    const [linkedRes, candRes] = await Promise.all([
      linkedId
        ? sb.from("deal_upstream_purchases").select(PURCHASE_SELECT).eq("id", linkedId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      canWrite && canMatch
        ? sb.from("deal_upstream_purchases").select(PURCHASE_SELECT)
            .eq("our_company_id", deal.supplier_id)
            .eq("factory_id", deal.factory_id)
            .eq("fuel_type_id", deal.fuel_type_id)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (linkedRes.error) toast.error(`Закупка: ${linkedRes.error.message}`);
    if (candRes.error) toast.error(`Закупки: ${candRes.error.message}`);
    const lp = (linkedRes.data ?? null) as UpstreamPurchase | null;
    const cands = (candRes.data ?? []) as UpstreamPurchase[];
    setLinked(lp);
    setCandidates(cands);

    const ids = [...new Set([...(lp ? [lp.id] : []), ...cands.map((c) => c.id)])];
    if (ids.length === 0) { setTotals(new Map()); return; }
    const { data: tRows, error: tErr } = await sb
      .from("deal_upstream_purchase_totals")
      .select("purchase_id, deal_count, sold_tons, remaining_tons")
      .in("purchase_id", ids);
    if (tErr) { toast.error(`Остаток закупки: ${tErr.message}`); return; }
    setTotals(new Map(((tRows ?? []) as UpstreamPurchaseTotals[]).map((t) => [t.purchase_id, t])));
  }, [linkedId, canWrite, canMatch, deal.supplier_id, deal.factory_id, deal.fuel_type_id]);

  useEffect(() => { void load(); }, [load]);

  // Продавцы — поставщики из справочника, КРОМЕ наших компаний.
  async function loadSellers() {
    if (sellers.length > 0) return;
    const { data, error } = await sbLoose()
      .from("counterparties")
      .select("id, short_name, full_name")
      .eq("type", "supplier")
      .eq("is_active", true)
      .eq("is_own_supplier", false);
    if (error) { toast.error(`Поставщики: ${error.message}`); return; }
    const rows = (data ?? []) as { id: string; short_name: string | null; full_name: string }[];
    setSellers(sortByName(rows, (r) => r.short_name || r.full_name).map((r) => ({ value: r.id, label: r.short_name || r.full_name })));
  }

  function afterChange() {
    // Сделка (bundle), список паспорта и соседние сделки этой закупки —
    // у всех поменялись «Объём выкупа» / «Остаток».
    invalidateDeal(deal.id);
    onChanged();
    void load();
  }

  async function link(purchaseId: string | null) {
    setBusy(true);
    try {
      // updateDeal сам показывает toast с сообщением триггера при отказе.
      await updateDeal(deal.id, { upstream_purchase_id: purchaseId });
      toast.success(purchaseId ? "Закупка привязана" : "Закупка отвязана");
      setPickId("");
      afterChange();
    } catch {
      /* toast уже показан */
    } finally {
      setBusy(false);
    }
  }

  function openNew() {
    setForm(EMPTY_FORM);
    setMode("new");
    void loadSellers();
  }
  function openEdit() {
    if (!linked) return;
    setForm({
      sellerId: linked.seller_id,
      appendix: linked.appendix,
      volume: String(linked.volume_tons ?? ""),
      comment: linked.comment ?? "",
    });
    setMode("edit");
    void loadSellers();
  }

  async function save() {
    const volume = parseNum(form.volume);
    if (!form.sellerId) { toast.error("Выберите продавца"); return; }
    if (!form.appendix.trim()) { toast.error("Укажите номер приложения"); return; }
    if (volume == null || volume <= 0) { toast.error("Объём выкупа должен быть больше нуля"); return; }
    const values = {
      seller_id: form.sellerId,
      appendix: form.appendix.trim(),
      volume_tons: volume,
      comment: form.comment.trim() || null,
    };
    setBusy(true);
    try {
      const sb = sbLoose();
      if (mode === "edit" && linked) {
        const { error } = await sb.from("deal_upstream_purchases").update(values).eq("id", linked.id);
        if (error) { toast.error(`Ошибка сохранения: ${error.message}`); return; }
        toast.success("Закупка сохранена");
        setMode("view");
        afterChange();
        return;
      }
      // Новая закупка: наша компания, завод и продукт — из сделки.
      const { data, error } = await sb
        .from("deal_upstream_purchases")
        .insert({
          ...values,
          our_company_id: deal.supplier_id,
          factory_id: deal.factory_id,
          fuel_type_id: deal.fuel_type_id,
        })
        .select("id")
        .single();
      if (error || !data) { toast.error(`Ошибка создания закупки: ${error?.message ?? "нет ответа"}`); return; }
      setMode("view");
      await link((data as { id: string }).id);
    } finally {
      setBusy(false);
    }
  }

  const linkedTotals = linked ? totalsNumbers(totals.get(linked.id)) : null;
  const volume = linked ? parseNum(String(linked.volume_tons)) : null;
  const pickOptions: SelectOption[] = candidates
    .filter((c) => c.id !== linkedId)
    .map((c) => {
      const t = totalsNumbers(totals.get(c.id));
      return { value: c.id, label: `${sellerLabel(c.seller)} · ${c.appendix} · остаток ${fmtVol(t.remaining)} т` };
    });

  const cell = (label: string, value: React.ReactNode, mono = false) => (
    <div>
      <span className="text-[11px] text-stone-400 block">{label}</span>
      <span className={`text-[13px] text-stone-800 ${mono ? "font-mono tabular-nums" : ""}`}>{value}</span>
    </div>
  );

  return (
    <CollapsibleSection
      title="Закупка (первичный поставщик)"
      headerBg={SECTION_COLORS.upstream}
      storageKey={`deal:${deal.id}:section:upstream`}
      contentClassName="space-y-3"
    >
      {linked ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-x-6 gap-y-2">
          {cell("Первичный поставщик", sellerLabel(linked.seller) || "—")}
          {cell("Номер приложения", linked.appendix)}
          {cell("Объём выкупа", fmtVol(volume), true)}
          {cell("Продано", fmtVol(linkedTotals?.sold ?? 0), true)}
          {cell(
            "Остаток",
            <span className={isOversold(linkedTotals?.remaining) ? "text-red-600 font-medium" : ""}>
              {fmtVol(linkedTotals?.remaining ?? null)}
            </span>,
            true,
          )}
          {/* Завод / продукт самой закупки (триггер держит их равными сделке). */}
          {cell(
            "Завод / продукт",
            `${refs.factories.find((r) => r.id === linked.factory_id)?.name ?? deal.factory?.name ?? "—"} / ${refs.fuelTypes.find((r) => r.id === linked.fuel_type_id)?.name ?? deal.fuel_type?.name ?? "—"}`,
          )}
          {linked.comment && <div className="col-span-full">{cell("Комментарий", linked.comment)}</div>}
          {isOversold(linkedTotals?.remaining) && (
            <p className="col-span-full text-[12px] font-medium text-red-600">
              Продано больше, чем закуплено
            </p>
          )}
        </div>
      ) : (
        <p className="text-[12px] text-stone-500">Закупка не привязана.</p>
      )}

      {canWrite && mode === "view" && (
        <div className="flex flex-wrap items-center gap-2">
          {canMatch ? (
            <>
              {pickOptions.length > 0 && (
                <>
                  <div className="w-[360px] max-w-full">
                    <SearchableSelect
                      value={pickId}
                      onChange={setPickId}
                      options={pickOptions}
                      placeholder="Выбрать закупку…"
                      searchPlaceholder="Продавец или приложение…"
                    />
                  </div>
                  <Button size="sm" variant="outline" disabled={!pickId || busy} onClick={() => void link(pickId)}>
                    <Link2 className="h-3.5 w-3.5 mr-1" />Привязать
                  </Button>
                </>
              )}
              <Button size="sm" variant="outline" disabled={busy} onClick={openNew}>
                <Plus className="h-3.5 w-3.5 mr-1" />Новая закупка
              </Button>
            </>
          ) : (
            <span className="text-[12px] text-stone-500">Чтобы привязать закупку, укажите в сделке поставщика, завод и продукт.</span>
          )}
          {linked && (
            <>
              <Button size="sm" variant="outline" disabled={busy} onClick={openEdit}>
                <Pencil className="h-3.5 w-3.5 mr-1" />Изменить
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => { if (confirm("Отвязать сделку от закупки? Сама закупка останется.")) void link(null); }}
              >
                <Unlink className="h-3.5 w-3.5 mr-1" />Отвязать
              </Button>
            </>
          )}
        </div>
      )}

      {canWrite && mode !== "view" && (
        <form
          onSubmit={(e) => { e.preventDefault(); void save(); }}
          className="rounded border border-stone-200 p-3 space-y-2"
        >
          <p className="text-[12px] font-medium text-stone-700">
            {mode === "new" ? "Новая закупка" : "Изменить закупку"}
            {mode === "edit" && linkedTotals && linkedTotals.dealCount > 1 && (
              <span className="ml-2 font-normal text-amber-700">— изменится во всех {linkedTotals.dealCount} привязанных сделках</span>
            )}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2">
            <div>
              <span className="text-[11px] text-stone-400 block">Первичный поставщик</span>
              <SearchableSelect
                value={form.sellerId}
                onChange={(v) => setForm((f) => ({ ...f, sellerId: v }))}
                options={sellers}
                placeholder="Продавец…"
                searchPlaceholder="Поиск поставщика…"
              />
            </div>
            <div>
              <span className="text-[11px] text-stone-400 block">Номер приложения</span>
              <Input className="h-8 text-[13px]" value={form.appendix} onChange={(e) => setForm((f) => ({ ...f, appendix: e.target.value }))} />
            </div>
            <div>
              <span className="text-[11px] text-stone-400 block">Объём выкупа, т</span>
              <Input className="h-8 text-[13px] font-mono tabular-nums" inputMode="decimal" value={form.volume} onChange={(e) => setForm((f) => ({ ...f, volume: e.target.value }))} />
            </div>
            <div>
              <span className="text-[11px] text-stone-400 block">Завод / продукт (из сделки)</span>
              <span className="text-[13px] text-stone-600 leading-8">{deal.factory?.name ?? "—"} / {deal.fuel_type?.name ?? "—"}</span>
            </div>
            <div className="col-span-full">
              <span className="text-[11px] text-stone-400 block">Комментарий</span>
              <Input className="h-8 text-[13px]" value={form.comment} onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setMode("view")}>Отмена</Button>
            <Button type="submit" size="sm" disabled={busy}>{busy ? "Сохранение..." : "Сохранить"}</Button>
          </div>
        </form>
      )}
    </CollapsibleSection>
  );
}
