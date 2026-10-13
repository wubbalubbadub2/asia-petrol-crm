"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * «Условия оплаты» на форме создания сделки.
 *
 * Клиент 2026-10-13: «Можно эту функцию добавить и при создании сделки,
 * чтобы сразу вносить». До этого блок был только в карточке сделки
 * (PaymentConditionsSection в deals/[id]/page.tsx) и писал каждое поле
 * в БД сразу. Форма создания копит значения локально и пишет их одним
 * INSERT вместе с остальной сделкой — поэтому это отдельный
 * презентационный компонент, а не переиспользование карточного.
 *
 * Колонки те же, что у карточки (00125/00142): *_deferral_days,
 * *_deferral_mode ('shipment' | 'other'), *_deferral_note,
 * *_planned_pay_date. Пустое поле остаётся NULL — ровно как у сделки,
 * созданной без этого блока.
 */
export type DeferralMode = "" | "shipment" | "other";

export type PaymentTermsDraft = {
  days: string;
  mode: DeferralMode;
  note: string;
  plannedPayDate: string;
};

export const EMPTY_PAYMENT_TERMS: PaymentTermsDraft = { days: "", mode: "", note: "", plannedPayDate: "" };

export type PaymentTermsDealPatch = {
  supplier_deferral_days: number | null;
  supplier_deferral_mode: "shipment" | "other" | null;
  supplier_deferral_note: string | null;
  supplier_planned_pay_date: string | null;
  buyer_deferral_days: number | null;
  buyer_deferral_mode: "shipment" | "other" | null;
  buyer_deferral_note: string | null;
  buyer_planned_pay_date: string | null;
};

function sidePatch(d: PaymentTermsDraft) {
  const days = d.days.trim() === "" ? NaN : parseInt(d.days, 10);
  const mode = d.mode === "shipment" || d.mode === "other" ? d.mode : null;
  // Заметка и ручная дата видны только при «прочее» — скрытое не пишем,
  // иначе в сделку уехало бы то, чего оператор на экране не видел.
  const other = mode === "other";
  return {
    days: Number.isFinite(days) ? days : null,
    mode,
    note: other && d.note.trim() !== "" ? d.note.trim() : null,
    plannedPayDate: other && d.plannedPayDate !== "" ? d.plannedPayDate : null,
  };
}

export function paymentTermsDraftToDealPatch(
  supplier: PaymentTermsDraft,
  buyer: PaymentTermsDraft,
): PaymentTermsDealPatch {
  const s = sidePatch(supplier);
  const b = sidePatch(buyer);
  return {
    supplier_deferral_days: s.days,
    supplier_deferral_mode: s.mode,
    supplier_deferral_note: s.note,
    supplier_planned_pay_date: s.plannedPayDate,
    buyer_deferral_days: b.days,
    buyer_deferral_mode: b.mode,
    buyer_deferral_note: b.note,
    buyer_planned_pay_date: b.plannedPayDate,
  };
}

const SELECT_CLASS =
  "w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer";

// Объявлен на уровне модуля, как SelectField в форме: компонент,
// созданный внутри рендера, терял бы фокус на каждом вводе.
function SideFields({
  idPrefix, title, value, onChange,
}: {
  idPrefix: string;
  title: string;
  value: PaymentTermsDraft;
  onChange: (next: PaymentTermsDraft) => void;
}) {
  const set = (patch: Partial<PaymentTermsDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-1.5">
      <div className="text-[12px] font-medium text-stone-500">{title}</div>
      <div>
        <Label htmlFor={`${idPrefix}-days`} className="text-[12px] text-stone-500">Отсрочка, дн.</Label>
        <Input
          id={`${idPrefix}-days`}
          type="number"
          min={0}
          step={1}
          value={value.days}
          onChange={(e) => set({ days: e.target.value })}
          className="h-8 text-[13px] font-mono"
        />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-mode`} className="text-[12px] text-stone-500">Режим</Label>
        <select
          id={`${idPrefix}-mode`}
          value={value.mode}
          onChange={(e) => set({ mode: e.target.value as DeferralMode })}
          className={SELECT_CLASS}
        >
          <option value="">—</option>
          <option value="shipment">с даты отгрузки</option>
          <option value="other">прочее</option>
        </select>
      </div>
      {value.mode === "other" && (
        <>
          <div>
            <Label htmlFor={`${idPrefix}-note`} className="text-[12px] text-stone-500">Заметка</Label>
            <Input
              id={`${idPrefix}-note`}
              type="text"
              value={value.note}
              onChange={(e) => set({ note: e.target.value })}
              className="h-8 text-[13px]"
            />
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-date`} className="text-[12px] text-stone-500">Плановая дата (ручная)</Label>
            <Input
              id={`${idPrefix}-date`}
              type="date"
              value={value.plannedPayDate}
              onChange={(e) => set({ plannedPayDate: e.target.value })}
              className="h-8 text-[13px]"
            />
          </div>
        </>
      )}
    </div>
  );
}

export function DealPaymentTermsDraft({
  supplier, buyer, onSupplierChange, onBuyerChange,
}: {
  supplier: PaymentTermsDraft;
  buyer: PaymentTermsDraft;
  onSupplierChange: (next: PaymentTermsDraft) => void;
  onBuyerChange: (next: PaymentTermsDraft) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <SideFields idPrefix="deal-new-terms-supplier" title="Поставщик" value={supplier} onChange={onSupplierChange} />
      <SideFields idPrefix="deal-new-terms-buyer" title="Покупатель" value={buyer} onChange={onBuyerChange} />
    </div>
  );
}
