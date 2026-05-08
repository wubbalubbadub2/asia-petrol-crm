"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, MessageSquare, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { createDeal } from "@/lib/hooks/use-deals";
import { MONTHS_RU, getQuarterFromMonth } from "@/lib/constants/months-ru";
import { DEAL_TYPES } from "@/lib/constants/deal-types";

import { toast } from "sonner";
import { ActivityFeed } from "@/components/shared/activity-feed";
import { useDealActivity } from "@/lib/hooks/use-deal-activity";
import { VariantsCard, EMPTY_VARIANT, variantDraftToLinePatch, type VariantDraft } from "@/components/deals/deal-create-variants";

type RefOption = { id: string; name: string };
type CounterpartyOption = { id: string; full_name: string; short_name: string | null };
type ProfileOption = { id: string; full_name: string };

export default function NewDealPage() {
  const router = useRouter();
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [draftDealId, setDraftDealId] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [showChat, setShowChat] = useState(false);

  // Auto-create draft deal on mount for chat
  useEffect(() => {
    async function createDraft() {
      const { data } = await supabase
        .from("deals")
        .insert({ deal_type: "KZ", deal_number: -Math.floor(Math.random() * 999999), year: new Date().getFullYear(), month: "январь", is_draft: true })
        .select("id")
        .single();
      if (data) setDraftDealId(data.id);
    }
    createDraft();
    // Cleanup: delete draft if user leaves without saving
    return () => {
      // Note: cleanup won't reliably run on navigation, but beforeunload handles it
    };
  }, []);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (hasChanges) { e.preventDefault(); }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasChanges]);

  // Track changes
  function markChanged() { if (!hasChanges) setHasChanges(true); }

  // Reference data
  const [factories, setFactories] = useState<RefOption[]>([]);
  const [fuelTypes, setFuelTypes] = useState<RefOption[]>([]);
  const [suppliers, setSuppliers] = useState<CounterpartyOption[]>([]);
  const [buyers, setBuyers] = useState<CounterpartyOption[]>([]);
  const [forwarders, setForwarders] = useState<RefOption[]>([]);
  const [companyGroups, setCompanyGroups] = useState<RefOption[]>([]);
  const [stations, setStations] = useState<RefOption[]>([]);
  const [managers, setManagers] = useState<ProfileOption[]>([]);

  // Form fields
  const [dealType, setDealType] = useState<"KG" | "KZ" | "OIL">("KZ");
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState<string>(MONTHS_RU[new Date().getMonth()]);
  const [factoryId, setFactoryId] = useState("");
  const [fuelTypeId, setFuelTypeId] = useState("");
  const [sulfurPercent, setSulfurPercent] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [railwayInPrice, setRailwayInPrice] = useState(false);

  // Quotation types for price linking
  const [quotationTypes, setQuotationTypes] = useState<RefOption[]>([]);

  // Supplier scalars (one per side)
  const [supplierId, setSupplierId] = useState("");
  const [supplierContract, setSupplierContract] = useState("");
  const [supplierVolume, setSupplierVolume] = useState("");
  const [supplierVariants, setSupplierVariants] = useState<VariantDraft[]>([{ ...EMPTY_VARIANT }]);

  // Buyer scalars (one per side)
  const [buyerId, setBuyerId] = useState("");
  const [buyerContract, setBuyerContract] = useState("");
  const [buyerVolume, setBuyerVolume] = useState("");
  const [buyerVariants, setBuyerVariants] = useState<VariantDraft[]>([{ ...EMPTY_VARIANT }]);

  // Company groups (up to 6)
  const [dealCompanyGroups, setDealCompanyGroups] = useState<
    { companyGroupId: string; price: string; contractRef: string }[]
  >([]);

  function addCompanyGroup() {
    if (dealCompanyGroups.length >= 6) return;
    setDealCompanyGroups([...dealCompanyGroups, { companyGroupId: "", price: "", contractRef: "" }]);
  }

  function updateCompanyGroup(idx: number, field: string, value: string) {
    const updated = [...dealCompanyGroups];
    updated[idx] = { ...updated[idx], [field]: value };
    setDealCompanyGroups(updated);
  }

  function removeCompanyGroup(idx: number) {
    setDealCompanyGroups(dealCompanyGroups.filter((_, i) => i !== idx));
  }

  // Logistics
  const [forwarderId, setForwarderId] = useState("");
  const [logisticsCompanyGroupId, setLogisticsCompanyGroupId] = useState("");
  const [plannedTariff, setPlannedTariff] = useState("");
  const [preliminaryTonnage, setPreliminaryTonnage] = useState("");

  // Auto-lookup tariff. Driven by the buyer's default variant's destination
  // station (variant 0). Per-variant tariff lookup isn't a thing yet —
  // logistics tariff is one row on the deal.
  useEffect(() => {
    const buyerDefaultStationId = buyerVariants[0]?.stationId || "";
    if (!forwarderId || !buyerDefaultStationId || !month || !fuelTypeId) return;
    const supabase = createClient();
    supabase.from("tariffs")
      .select("planned_tariff")
      .eq("forwarder_id", forwarderId)
      .eq("destination_station_id", buyerDefaultStationId)
      .eq("fuel_type_id", fuelTypeId)
      .eq("month", month)
      .eq("year", year)
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data?.planned_tariff && !plannedTariff) {
          setPlannedTariff(String(data.planned_tariff));
        }
      });
  }, [forwarderId, buyerVariants, month, fuelTypeId, year]);

  // Managers
  const [supplierManagerId, setSupplierManagerId] = useState("");
  const [buyerManagerId, setBuyerManagerId] = useState("");
  const [traderId, setTraderId] = useState("");

  useEffect(() => {
    Promise.all([
      supabase.from("factories").select("id, name").eq("is_active", true).order("name"),
      supabase.from("fuel_types").select("id, name").eq("is_active", true).order("sort_order"),
      supabase.from("counterparties").select("id, full_name, short_name").eq("type", "supplier").eq("is_active", true).order("full_name"),
      supabase.from("counterparties").select("id, full_name, short_name").eq("type", "buyer").eq("is_active", true).order("full_name"),
      supabase.from("forwarders").select("id, name").eq("is_active", true).order("name"),
      supabase.from("company_groups").select("id, name").eq("is_active", true).order("name"),
      supabase.from("stations").select("id, name").eq("is_active", true).order("name"),
      supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
      supabase.from("quotation_product_types").select("id, name").eq("is_active", true).order("sort_order"),
    ]).then(([f, ft, s, b, fw, cg, st, m, qt]) => {
      setFactories((f.data ?? []) as RefOption[]);
      setFuelTypes((ft.data ?? []) as RefOption[]);
      setSuppliers((s.data ?? []) as CounterpartyOption[]);
      setBuyers((b.data ?? []) as CounterpartyOption[]);
      setForwarders((fw.data ?? []) as RefOption[]);
      setCompanyGroups((cg.data ?? []) as RefOption[]);
      setStations((st.data ?? []) as RefOption[]);
      setManagers((m.data ?? []) as ProfileOption[]);
      setQuotationTypes((qt.data ?? []) as RefOption[]);
    });
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const sv0 = supplierVariants[0] ?? EMPTY_VARIANT;
    const bv0 = buyerVariants[0] ?? EMPTY_VARIANT;
    const quarter = getQuarterFromMonth(month);
    const dealData = {
      deal_type: dealType,
      year,
      quarter,
      month,
      factory_id: factoryId || null,
      fuel_type_id: fuelTypeId || null,
      sulfur_percent: sulfurPercent || null,
      currency,
      supplier_id: supplierId || null,
      supplier_contract: supplierContract || null,
      supplier_contracted_volume: supplierVolume ? parseFloat(supplierVolume) : null,
      // Variant 0 (default) values mirror to the deals scalars via reverse
      // sync trigger. Additional variants are written below.
      supplier_price: sv0.price ? parseFloat(sv0.price) : null,
      supplier_price_condition: variantDraftToLinePatch(sv0).price_condition,
      supplier_delivery_basis: sv0.deliveryBasis || null,
      supplier_departure_station_id: sv0.stationId || null,
      supplier_quotation: sv0.quotation ? parseFloat(sv0.quotation) : null,
      supplier_quotation_comment: sv0.quotationComment || null,
      supplier_discount: sv0.discount ? parseFloat(sv0.discount) : null,
      railway_in_price: railwayInPrice,
      buyer_id: buyerId || null,
      buyer_contract: buyerContract || null,
      buyer_contracted_volume: buyerVolume ? parseFloat(buyerVolume) : null,
      buyer_price: bv0.price ? parseFloat(bv0.price) : null,
      buyer_price_condition: variantDraftToLinePatch(bv0).price_condition,
      buyer_delivery_basis: bv0.deliveryBasis || null,
      buyer_destination_station_id: bv0.stationId || null,
      buyer_quotation: bv0.quotation ? parseFloat(bv0.quotation) : null,
      buyer_quotation_comment: bv0.quotationComment || null,
      buyer_discount: bv0.discount ? parseFloat(bv0.discount) : null,
      forwarder_id: forwarderId || null,
      logistics_company_group_id: logisticsCompanyGroupId || null,
      planned_tariff: plannedTariff ? parseFloat(plannedTariff) : null,
      preliminary_tonnage: preliminaryTonnage ? parseFloat(preliminaryTonnage) : null,
      supplier_manager_id: supplierManagerId || null,
      buyer_manager_id: buyerManagerId || null,
      trader_id: traderId || null,
    };

    let deal;
    if (draftDealId) {
      // Update the draft deal with real data and generate a deal number
      const { data: numData } = await supabase.rpc("generate_deal_number", { p_type: dealType, p_year: year });
      const dealNumber = numData as number ?? 1;
      const { data, error } = await supabase
        .from("deals")
        .update({ ...dealData, deal_number: dealNumber, is_draft: false })
        .eq("id", draftDealId)
        .select()
        .single();
      if (error) { toast.error(`Ошибка: ${error.message}`); setSaving(false); return; }
      deal = data;
      toast.success(
        `Сделка ${dealType}/${String(year % 100).padStart(2, "0")}/${String(dealNumber).padStart(3, "0")} создана`,
      );
    } else {
      deal = await createDeal(dealData);
    }

    // Replace pricing variants with the form's set. Drops the auto-seeded
    // empty default line and any prior partial state, then writes the
    // user-entered variants. The line→deals sync trigger keeps deals.scalars
    // mirrored from the new default (variant 0).
    if (deal) {
      await supabase.from("deal_supplier_lines").delete().eq("deal_id", deal.id);
      await supabase.from("deal_supplier_lines").insert(
        supplierVariants.map((v, i) => ({
          deal_id: deal.id,
          position: i + 1,
          is_default: i === 0,
          ...variantDraftToLinePatch(v),
          quotation_type_id: v.quotationTypeId || null,
          quotation: v.quotation ? parseFloat(v.quotation) : null,
          quotation_comment: v.quotationComment || null,
          discount: v.discount ? parseFloat(v.discount) : null,
          price: v.price ? parseFloat(v.price) : null,
          delivery_basis: v.deliveryBasis || null,
          departure_station_id: v.stationId || null,
        }))
      );

      await supabase.from("deal_buyer_lines").delete().eq("deal_id", deal.id);
      await supabase.from("deal_buyer_lines").insert(
        buyerVariants.map((v, i) => ({
          deal_id: deal.id,
          position: i + 1,
          is_default: i === 0,
          ...variantDraftToLinePatch(v),
          quotation_type_id: v.quotationTypeId || null,
          quotation: v.quotation ? parseFloat(v.quotation) : null,
          quotation_comment: v.quotationComment || null,
          discount: v.discount ? parseFloat(v.discount) : null,
          price: v.price ? parseFloat(v.price) : null,
          delivery_basis: v.deliveryBasis || null,
          destination_station_id: v.stationId || null,
        }))
      );
    }

    // Save company groups
    if (deal && dealCompanyGroups.length > 0) {
      const cgRecords = dealCompanyGroups
        .filter((cg) => cg.companyGroupId)
        .map((cg, idx) => ({
          deal_id: deal.id,
          company_group_id: cg.companyGroupId,
          position: idx + 1,
          price: cg.price ? parseFloat(cg.price) : null,
          contract_ref: cg.contractRef || null,
        }));
      if (cgRecords.length > 0) {
        await supabase.from("deal_company_groups").insert(cgRecords);
      }
    }

    setHasChanges(false); // Prevent unsaved warning
    setSaving(false);
    if (deal) router.push("/deals");
  }

  function SelectField({
    label, value, onChange, options, placeholder = "Выберите...",
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
    placeholder?: string;
  }) {
    return (
      <div>
        <Label className="text-[12px] text-stone-500">{label}</Label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer"
        >
          <option value="">{placeholder}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/deals">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold">Новая сделка</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Basic Info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-[14px]">Основные данные</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-[12px] text-stone-500">Тип сделки</Label>
              <div className="flex gap-1 mt-1">
                {DEAL_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setDealType(t)}
                    className={`flex-1 rounded-md px-2 py-1.5 text-[12px] font-medium border transition-colors ${
                      dealType === t
                        ? "bg-amber-100 text-amber-800 border-amber-300"
                        : "bg-white text-stone-500 border-stone-200 hover:bg-stone-50"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-[12px] text-stone-500">Год</Label>
              <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-8 text-[13px]" />
            </div>
            <SelectField
              label="Месяц"
              value={month}
              onChange={setMonth}
              options={MONTHS_RU.map((m) => ({ value: m, label: m }))}
            />
            <SelectField
              label="Завод"
              value={factoryId}
              onChange={setFactoryId}
              options={factories.map((f) => ({ value: f.id, label: f.name }))}
            />
            <SelectField
              label="Вид ГСМ"
              value={fuelTypeId}
              onChange={setFuelTypeId}
              options={fuelTypes.map((f) => ({ value: f.id, label: f.name }))}
            />
            <div>
              <Label className="text-[12px] text-stone-500">% серы</Label>
              <Input value={sulfurPercent} onChange={(e) => setSulfurPercent(e.target.value)} placeholder="0,5%" className="h-8 text-[13px]" />
            </div>
            <SelectField
              label="Валюта"
              value={currency}
              onChange={setCurrency}
              options={[
                { value: "USD", label: "USD ($)" },
                { value: "KZT", label: "KZT (₸)" },
                { value: "KGS", label: "KGS (сом)" },
                { value: "RUB", label: "RUB (₽)" },
              ]}
            />
          </CardContent>
        </Card>

        {/* Supplier */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-[14px]">Поставщик</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              <SelectField
                label="Поставщик"
                value={supplierId}
                onChange={setSupplierId}
                options={suppliers.map((s) => ({ value: s.id, label: s.short_name || s.full_name }))}
              />
              <div>
                <Label className="text-[12px] text-stone-500">№ договора</Label>
                <Input value={supplierContract} onChange={(e) => setSupplierContract(e.target.value)} placeholder="1 от 30.12.24" className="h-8 text-[13px]" />
              </div>
              <div>
                <Label className="text-[12px] text-stone-500">Объем (тонн)</Label>
                <Input type="number" step="0.01" value={supplierVolume} onChange={(e) => setSupplierVolume(e.target.value)} className="h-8 text-[13px] font-mono" />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input
                  type="checkbox"
                  id="railway-in-price"
                  checked={railwayInPrice}
                  onChange={(e) => setRailwayInPrice(e.target.checked)}
                  className="h-4 w-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                />
                <Label htmlFor="railway-in-price" className="text-[12px] text-stone-600 cursor-pointer">ЖД в цене (минусует с баланса)</Label>
              </div>
            </div>
            <div>
              <div className="text-[12px] font-medium text-stone-600 mb-1.5">Условия и маршрут</div>
              <VariantsCard
                side="supplier"
                variants={supplierVariants}
                setVariants={(v) => { setSupplierVariants(v); markChanged(); }}
                month={month}
                year={year}
                quotationTypes={quotationTypes}
                stations={stations}
              />
            </div>
          </CardContent>
        </Card>

        {/* Buyer */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-[14px]">Покупатель</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              <SelectField
                label="Покупатель"
                value={buyerId}
                onChange={setBuyerId}
                options={buyers.map((b) => ({ value: b.id, label: b.short_name || b.full_name }))}
              />
              <div>
                <Label className="text-[12px] text-stone-500">№ договора</Label>
                <Input value={buyerContract} onChange={(e) => setBuyerContract(e.target.value)} placeholder="20 от 12.12.2024" className="h-8 text-[13px]" />
              </div>
              <div>
                <Label className="text-[12px] text-stone-500">Объем (тонн)</Label>
                <Input type="number" step="0.01" value={buyerVolume} onChange={(e) => setBuyerVolume(e.target.value)} className="h-8 text-[13px] font-mono" />
              </div>
            </div>
            <div>
              <div className="text-[12px] font-medium text-stone-600 mb-1.5">Условия и маршрут</div>
              <VariantsCard
                side="buyer"
                variants={buyerVariants}
                setVariants={(v) => { setBuyerVariants(v); markChanged(); }}
                month={month}
                year={year}
                quotationTypes={quotationTypes}
                stations={stations}
              />
            </div>
          </CardContent>
        </Card>

        {/* Company Groups */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[14px]">Группы компании</CardTitle>
              {dealCompanyGroups.length < 6 && (
                <Button type="button" size="sm" variant="outline" onClick={addCompanyGroup}>
                  + Добавить группу
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {dealCompanyGroups.length === 0 ? (
              <p className="text-[12px] text-stone-400">Нет групп компании. Нажмите "Добавить группу" (до 6).</p>
            ) : (
              <div className="space-y-3">
                {dealCompanyGroups.map((cg, idx) => (
                  <div key={idx} className="flex items-end gap-2 p-2 rounded-md bg-stone-50 border border-stone-200">
                    <span className="text-[11px] text-stone-400 font-mono w-4 shrink-0 pb-2">{idx + 1}</span>
                    <div className="flex-1">
                      <Label className="text-[11px] text-stone-500">Группа</Label>
                      <select
                        value={cg.companyGroupId}
                        onChange={(e) => updateCompanyGroup(idx, "companyGroupId", e.target.value)}
                        className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer"
                      >
                        <option value="">Выберите...</option>
                        {companyGroups.map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="w-32">
                      <Label className="text-[11px] text-stone-500">Цена</Label>
                      <Input type="number" step="0.01" value={cg.price} onChange={(e) => updateCompanyGroup(idx, "price", e.target.value)} className="h-8 text-[13px] font-mono" />
                    </div>
                    <div className="w-40">
                      <Label className="text-[11px] text-stone-500">№ прил / договор</Label>
                      <Input value={cg.contractRef} onChange={(e) => updateCompanyGroup(idx, "contractRef", e.target.value)} placeholder="№ и дата" className="h-8 text-[13px]" />
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={() => removeCompanyGroup(idx)} className="text-red-500 hover:text-red-700 shrink-0 h-8 w-8 p-0">
                      ×
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Logistics */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-[14px]">Логистика</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <SelectField
              label="Экспедитор"
              value={forwarderId}
              onChange={setForwarderId}
              options={forwarders.map((f) => ({ value: f.id, label: f.name }))}
            />
            <SelectField
              label="Группа компании"
              value={logisticsCompanyGroupId}
              onChange={setLogisticsCompanyGroupId}
              options={companyGroups.map((c) => ({ value: c.id, label: c.name }))}
            />
            <div>
              <Label className="text-[12px] text-stone-500">Тариф план</Label>
              <Input type="number" step="0.01" value={plannedTariff} onChange={(e) => setPlannedTariff(e.target.value)} className="h-8 text-[13px] font-mono" />
            </div>
            <div>
              <Label className="text-[12px] text-stone-500">Объем предварит. (тонн)</Label>
              <Input type="number" step="0.01" value={preliminaryTonnage} onChange={(e) => setPreliminaryTonnage(e.target.value)} className="h-8 text-[13px] font-mono" />
            </div>
          </CardContent>
        </Card>

        {/* Managers */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-[14px]">Ответственные</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <SelectField
              label="Менеджер поставщика"
              value={supplierManagerId}
              onChange={setSupplierManagerId}
              options={managers.map((m) => ({ value: m.id, label: m.full_name }))}
            />
            <SelectField
              label="Менеджер покупателя"
              value={buyerManagerId}
              onChange={setBuyerManagerId}
              options={managers.map((m) => ({ value: m.id, label: m.full_name }))}
            />
            <SelectField
              label="Трейдер"
              value={traderId}
              onChange={setTraderId}
              options={managers.map((m) => ({ value: m.id, label: m.full_name }))}
            />
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Создание..." : "Создать сделку"}
          </Button>
          <Button type="button" variant="outline" onClick={async () => {
            if (!confirm("Отменить создание сделки? Все данные и сообщения будут потеряны.")) return;
            // Delete draft deal
            if (draftDealId) await supabase.from("deals").delete().eq("id", draftDealId);
            router.push("/deals");
          }}>
            Отмена
          </Button>
        </div>
      </form>

      {/* Floating chat button */}
      {draftDealId && (
        <>
          <button
            onClick={() => setShowChat(!showChat)}
            className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-lg shadow-amber-500/30 hover:shadow-xl hover:scale-105 transition-all"
          >
            {showChat ? <X className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
          </button>

          {showChat && (
            <div className="fixed bottom-20 right-6 z-50 w-[360px] h-[450px] rounded-xl border border-stone-200 bg-white shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2.5">
                <h3 className="text-[13px] font-bold">Чат по сделке</h3>
                <button onClick={() => setShowChat(false)} className="text-stone-400 hover:text-stone-600"><X className="h-4 w-4" /></button>
              </div>
              <div className="p-3 h-[calc(100%-3rem)]">
                <DraftChatWrapper dealId={draftDealId} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DraftChatWrapper({ dealId }: { dealId: string }) {
  const { messages, loading, sendMessage } = useDealActivity(dealId);
  return <ActivityFeed messages={messages} loading={loading} sendMessage={sendMessage} />;
}
