"use client";

import { useState, useRef, useEffect } from "react";
import { Send, MessageSquare, DollarSign, Truck, FileText, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type ActivityMessage } from "@/lib/hooks/use-deal-activity";
import { currencySymbol } from "@/lib/constants/currencies";

function formatAmount(n: number): string {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

const toNum = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

// Field-name → Russian label used as the row prefix. Mirrors the labels
// emitted by the 00088 trigger so even rows that were inserted without
// content (or with the trigger's terse "X изменён") render consistently
// on the FE.
const FIELD_LABELS: Record<string, string> = {
  supplier_payment: "Оплата поставщику",
  buyer_payment: "Оплата покупателя",
  supplier_contracted_volume: "Объём поставщика",
  buyer_contracted_volume: "Объём покупателя",
  buyer_ordered_volume: "Заказанный объём покупателя",
  supplier_price: "Цена поставщика",
  buyer_price: "Цена покупателя",
  supplier_quotation: "Котировка поставщика",
  buyer_quotation: "Котировка покупателя",
  supplier_discount: "Скидка поставщика",
  buyer_discount: "Скидка покупателя",
  planned_tariff: "Плановый тариф",
  actual_tariff: "Факт. тариф",
  preliminary_tonnage: "Предв. тоннаж",
  surcharge_amount: "Доплата",
  supplier_contract: "Договор поставщика",
  buyer_contract: "Договор покупателя",
  supplier_delivery_basis: "Базис поставки (поставщик)",
  buyer_delivery_basis: "Базис поставки (покупатель)",
  supplier_payment_date: "Дата оплаты поставщику",
  buyer_payment_date: "Дата оплаты покупателя",
  buyer_ship_date: "Дата отгрузки покупателю",
  month: "Месяц сделки",
  supplier_id: "Поставщик",
  buyer_id: "Покупатель",
  factory_id: "Завод",
  fuel_type_id: "Вид ГСМ",
  forwarder_id: "Экспедитор",
  supplier_manager_id: "Менеджер поставщика",
  buyer_manager_id: "Менеджер покупателя",
  trader_id: "Трейдер",
  is_archived: "Архивирована",
};

// Format a single value for display. Numeric values get Russian thousand
// separators + optional currency/unit suffix. Strings render as-is.
// Null / undefined renders as «—».
function formatValue(raw: unknown, suffix: string, isNumeric: boolean): string {
  if (raw === null || raw === undefined) return "—";
  if (isNumeric) {
    const n = toNum(raw);
    if (n === null) return "—";
    return formatAmount(n) + (suffix ? " " + suffix : "");
  }
  const s = String(raw);
  return s === "" ? "—" : s;
}

type ActivityMetadata = {
  field?: string;
  delta?: number | string;
  old?: number | string | null;
  new?: number | string | null;
  old_label?: string | null;
  new_label?: string | null;
  currency?: string | null;
  unit?: string | null;
};

// Render the activity row's main line. Payment events keep the existing
// "delta + currency" shape (cumulative-to-delta migration in 00087).
// Other system rows use "Label: old → new" so the user can see what
// changed at a glance.
function renderActivityContent(msg: ActivityMessage): string {
  const md = (msg.metadata ?? {}) as ActivityMetadata;
  const field = md.field;

  // Payments: delta + currency, ignore content (which is the cumulative
  // legacy text on pre-00087 rows).
  if (msg.type === "payment" && (field === "supplier_payment" || field === "buyer_payment")) {
    const oldN = toNum(md.old) ?? 0;
    const newN = toNum(md.new) ?? 0;
    const delta = md.delta != null ? (toNum(md.delta) ?? 0) : newN - oldN;
    const label = FIELD_LABELS[field];
    const sym = currencySymbol(md.currency ?? null, "");
    const signed = (delta < 0 ? "−" : "") + formatAmount(Math.abs(delta));
    return `${label}: ${signed}${sym ? " " + sym : ""}`;
  }

  // Non-payment system rows: only re-format if we have a known field
  // with old/new in metadata. Otherwise fall back to whatever the
  // trigger wrote.
  if (!field || !(field in FIELD_LABELS)) return msg.content;

  const label = FIELD_LABELS[field];
  const isFK = field.endsWith("_id");
  const isBool = field === "is_archived";
  const suffix = md.currency
    ? currencySymbol(md.currency, "")
    : (md.unit ?? "");

  if (isFK) {
    const oldStr = md.old_label ?? (md.old == null ? "—" : String(md.old));
    const newStr = md.new_label ?? (md.new == null ? "—" : String(md.new));
    return `${label}: ${oldStr} → ${newStr}`;
  }

  if (isBool) {
    return msg.content; // trigger already formatted it ("перенесена в архив" / "восстановлена")
  }

  const isNumeric = !!(
    field.includes("volume") ||
    field.includes("price") ||
    field.includes("quotation") ||
    field.includes("discount") ||
    field.includes("tariff") ||
    field.includes("tonnage") ||
    field === "surcharge_amount"
  );
  return `${label}: ${formatValue(md.old, suffix, isNumeric)} → ${formatValue(md.new, suffix, isNumeric)}`;
}

const TYPE_ICONS: Record<string, { icon: typeof MessageSquare; color: string; bg: string }> = {
  comment: { icon: MessageSquare, color: "text-amber-600", bg: "bg-amber-100" },
  system: { icon: Settings, color: "text-stone-500", bg: "bg-stone-100" },
  payment: { icon: DollarSign, color: "text-green-600", bg: "bg-green-100" },
  shipment: { icon: Truck, color: "text-blue-600", bg: "bg-blue-100" },
  attachment: { icon: FileText, color: "text-purple-600", bg: "bg-purple-100" },
  status_change: { icon: Settings, color: "text-orange-600", bg: "bg-orange-100" },
};

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин назад`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ч назад`;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ActivityFeed({ messages, loading, sendMessage }: {
  messages: ActivityMessage[];
  loading: boolean;
  sendMessage: (content: string) => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  async function handleSend() {
    if (!input.trim() || sending) return;
    setSending(true);
    const text = input;
    setInput("");
    await sendMessage(text);
    setSending(false);
  }

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-1 space-y-0.5">
        {loading ? (
          <p className="text-[12px] text-stone-400 py-4 text-center">Загрузка...</p>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-stone-400">
            <MessageSquare className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-[12px]">Нет сообщений</p>
            <p className="text-[10px]">Напишите первый комментарий</p>
          </div>
        ) : messages.map((msg) => {
          const cfg = TYPE_ICONS[msg.type] ?? TYPE_ICONS.comment;
          const Icon = cfg.icon;
          const isComment = msg.type === "comment";
          return (
            <div key={msg.id} className="flex gap-2.5 py-2">
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                isComment ? "bg-gradient-to-br from-amber-400 to-amber-600 text-white text-[10px] font-bold" : cfg.bg
              }`}>
                {isComment ? (msg.user?.full_name?.charAt(0)?.toUpperCase() ?? "?") : <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  {/* Show author ФИО for EVERY entry that has a user_id —
                      not just comments. Operator request 2026-06-22:
                      need to see who recorded a payment / changed a
                      field, not only who wrote a chat message.
                      Falls back silently if user_id is NULL (system-
                      bound writes via service_role; or pre-00094
                      payment events whose trigger didn't record the
                      author yet). */}
                  {msg.user?.full_name && <span className="text-[12px] font-medium text-stone-800">{msg.user.full_name}</span>}
                  <span className="text-[10px] text-stone-400">{formatTime(msg.created_at)}</span>
                </div>
                <p className={`text-[12px] leading-relaxed mt-0.5 ${isComment ? "text-stone-700" : "text-stone-500 italic"}`}>{renderActivityContent(msg)}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-stone-200 pt-2 mt-2 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="Написать комментарий..."
          className="flex-1 rounded-lg border border-stone-200 px-3 py-2 text-[13px] focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-200 transition-colors"
        />
        <Button size="sm" onClick={handleSend} disabled={!input.trim() || sending} className="h-9 px-3">
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
