"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CURRENCIES, currencySymbol } from "@/lib/constants/currencies";

/**
 * Оплаты, вносимые при СОЗДАНИИ сделки — до того как deal.id существует.
 * Работает исключительно на локальном state, никаких Supabase-запросов.
 * Родитель (new/page.tsx) получает готовый массив draft-оплат и после
 * успешного createDeal вставляет их пачкой в deal_payments.
 *
 * По UX максимально повторяет секцию Оплаты в паспорте сделки: тип
 * (Оплата / Возврат / Перезачёт / Заранее), сумма, дата, комментарий,
 * валюта (по умолчанию — валюта сделки). Обе стороны видны сразу.
 */

export type PaymentType = "payment" | "prepayment" | "refund" | "offset";

export type DraftPayment = {
  clientId: string;               // for React keys — не сохраняется в БД
  side: "supplier" | "buyer";
  payment_type: PaymentType;
  amount: string;                 // в state строкой, парсится на save
  payment_date: string;           // YYYY-MM-DD
  description: string;
  currency: string;               // пусто = унаследовать валюту сделки
};

const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  payment: "Оплата",
  prepayment: "Заранее",
  refund: "Возврат",
  offset: "Перезачёт",
};

function newDraftPayment(side: "supplier" | "buyer"): DraftPayment {
  return {
    clientId: crypto.randomUUID(),
    side,
    payment_type: "payment",
    amount: "",
    payment_date: new Date().toISOString().slice(0, 10),
    description: "",
    currency: "",
  };
}

function signedAmount(p: DraftPayment): number {
  const raw = parseFloat(p.amount);
  if (!Number.isFinite(raw)) return 0;
  return p.payment_type === "refund" || p.payment_type === "offset" ? -raw : raw;
}

export function DealPaymentsDraft({
  payments,
  onChange,
  dealCurrency,
}: {
  payments: DraftPayment[];
  onChange: (next: DraftPayment[]) => void;
  dealCurrency: string;
}) {
  function addFor(side: "supplier" | "buyer") {
    onChange([...payments, newDraftPayment(side)]);
  }
  function updateAt(clientId: string, patch: Partial<DraftPayment>) {
    onChange(payments.map((p) => (p.clientId === clientId ? { ...p, ...patch } : p)));
  }
  function removeAt(clientId: string) {
    onChange(payments.filter((p) => p.clientId !== clientId));
  }

  const supplierList = payments.filter((p) => p.side === "supplier");
  const buyerList = payments.filter((p) => p.side === "buyer");

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <SideList
        label="Оплаты поставщику"
        items={supplierList}
        onAdd={() => addFor("supplier")}
        onUpdate={updateAt}
        onRemove={removeAt}
        dealCurrency={dealCurrency}
      />
      <SideList
        label="Оплаты от покупателя"
        items={buyerList}
        onAdd={() => addFor("buyer")}
        onUpdate={updateAt}
        onRemove={removeAt}
        dealCurrency={dealCurrency}
      />
    </div>
  );
}

function SideList({
  label,
  items,
  onAdd,
  onUpdate,
  onRemove,
  dealCurrency,
}: {
  label: string;
  items: DraftPayment[];
  onAdd: () => void;
  onUpdate: (clientId: string, patch: Partial<DraftPayment>) => void;
  onRemove: (clientId: string) => void;
  dealCurrency: string;
}) {
  // По каждой валюте отдельный итог: чтобы смешанные валюты не сливались
  // в бессмысленную сумму. Возвраты и перезачёты идут с минусом.
  const totals = new Map<string, number>();
  for (const p of items) {
    const code = p.currency || dealCurrency;
    totals.set(code, (totals.get(code) ?? 0) + signedAmount(p));
  }
  return (
    <div className="border border-stone-200 rounded-md bg-white">
      <div className="flex items-center justify-between px-3 py-2 border-b border-stone-200">
        <h4 className="text-[12px] font-medium text-stone-700">{label}</h4>
        <Button type="button" size="sm" variant="outline" onClick={onAdd} className="h-6 text-[10px] px-2">
          <Plus className="h-3 w-3 mr-1" />
          Оплата
        </Button>
      </div>
      <div className="p-2 space-y-1">
        {items.length === 0 ? (
          <p className="text-[11px] text-stone-400 px-1 py-1">Нет оплат</p>
        ) : (
          <>
            {items.map((p) => (
              <PaymentDraftRow
                key={p.clientId}
                p={p}
                dealCurrency={dealCurrency}
                onUpdate={(patch) => onUpdate(p.clientId, patch)}
                onRemove={() => onRemove(p.clientId)}
              />
            ))}
            <div className="flex items-center gap-2 px-2 pt-2 border-t border-stone-200 text-[11px]">
              <span className="text-stone-500 w-20 font-medium">Итого:</span>
              <span className="flex flex-wrap gap-x-3 font-mono tabular-nums font-bold text-stone-900">
                {[...totals.entries()].map(([code, v]) => (
                  <span key={code}>
                    {v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currencySymbol(code)}
                  </span>
                ))}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PaymentDraftRow({
  p,
  dealCurrency,
  onUpdate,
  onRemove,
}: {
  p: DraftPayment;
  dealCurrency: string;
  onUpdate: (patch: Partial<DraftPayment>) => void;
  onRemove: () => void;
}) {
  const isMinus = p.payment_type === "refund" || p.payment_type === "offset";
  const effectiveCurrency = p.currency || dealCurrency;
  return (
    <div className={`flex items-center gap-2 rounded px-2 py-1 text-[11px] ${isMinus ? "bg-red-50/60" : "bg-stone-50"}`}>
      <select
        value={p.payment_type}
        onChange={(e) => onUpdate({ payment_type: e.target.value as PaymentType })}
        className={`h-6 text-[10px] border border-transparent rounded bg-transparent hover:bg-amber-50 px-1 cursor-pointer focus:outline-none focus:border-amber-300 ${isMinus ? "text-red-600 font-medium" : "text-stone-600"}`}
        title="Тип записи"
      >
        {(Object.keys(PAYMENT_TYPE_LABELS) as PaymentType[]).map((t) => (
          <option key={t} value={t}>
            {PAYMENT_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <Input
        type="date"
        value={p.payment_date}
        onChange={(e) => onUpdate({ payment_date: e.target.value })}
        className="h-6 text-[11px] px-1.5 w-32"
      />
      <Input
        type="number"
        step="0.01"
        value={p.amount}
        onChange={(e) => onUpdate({ amount: e.target.value })}
        placeholder="0,00"
        className="h-6 text-[11px] px-1.5 w-28 font-mono text-right"
      />
      <select
        value={p.currency}
        onChange={(e) => onUpdate({ currency: e.target.value })}
        className="h-6 text-[10px] border border-transparent rounded bg-transparent hover:bg-amber-50 px-1 cursor-pointer focus:outline-none focus:border-amber-300 text-stone-600"
        title="Валюта (пусто = валюта сделки)"
      >
        <option value="">{currencySymbol(effectiveCurrency)} (сделка)</option>
        {CURRENCIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.symbol} {c.value}
          </option>
        ))}
      </select>
      <Input
        value={p.description}
        onChange={(e) => onUpdate({ description: e.target.value })}
        placeholder="комментарий…"
        className="h-6 text-[11px] px-1.5 flex-1 min-w-0"
      />
      <button
        type="button"
        onClick={onRemove}
        title="Удалить"
        className="text-stone-400 hover:text-red-600 p-0.5"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
