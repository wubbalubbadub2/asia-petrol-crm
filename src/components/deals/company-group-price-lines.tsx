"use client";
// Варианты цены группы компаний — под группой в «Цепочке компании»,
// только KG (00183; клиент 2026-10-29, пример KG/26/736). «Основной» — это
// цена группы из строки выше (зеркало в БД), здесь у него только объём:
// привязка к варианту покупателя или объём вручную. Остальные варианты —
// котировка, скидка, цена, тип, объём. Под каждым — примечание, как у
// поставщика: «Отгружено по этому варианту: N тонн · Сумма: S (по цене P)».

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  buyerLineName, companyGroupLineName, companyGroupLineNote, fetchCompanyGroupLines, fetchCompanyGroupLineVolumes,
  orderCompanyGroupLines, sbLoose,
  type BuyerLineOption, type CompanyGroupLine, type CompanyGroupLineVolume,
} from "@/lib/hooks/use-company-group-lines";
import { parseNum } from "@/lib/utils/parse-num";

const price3 = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const selectCls =
  "h-7 w-full rounded border border-stone-300 bg-white px-1.5 text-[11px] text-stone-800 hover:border-amber-400 focus:border-amber-500 focus:outline-none";
const inputCls = "h-7 text-[11px] font-mono text-right border-stone-300 bg-white hover:border-amber-400 focus:border-amber-500";

export function CompanyGroupPriceLines({ dealId, groupId, groupPrice, currencySymbol, editing, title }: {
  dealId: string;
  /** Заголовок над вариантами — только если есть что показать. */
  title?: string;
  groupId: string;
  /** Цена группы — перечитать варианты, когда её поправили в строке выше. */
  groupPrice: number | null;
  currencySymbol: string;
  editing: boolean;
}) {
  const [lines, setLines] = useState<CompanyGroupLine[]>([]);
  const [volumes, setVolumes] = useState<Map<string, CompanyGroupLineVolume>>(new Map());
  const [buyerLines, setBuyerLines] = useState<BuyerLineOption[]>([]);

  // Перечитать — сменой счётчика; загрузка в эффекте отменяется, если группа сменилась раньше ответа.
  const [version, setVersion] = useState(0);
  const load = () => setVersion((v) => v + 1);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchCompanyGroupLines([groupId]),
      fetchCompanyGroupLineVolumes([groupId]),
      sbLoose().from("deal_buyer_lines").select("id, position, is_default, price").eq("deal_id", dealId),
    ]).then(([l, v, b]) => {
      if (cancelled) return;
      setLines(l.get(groupId) ?? []);
      setVolumes(v);
      setBuyerLines(((b.data ?? []) as BuyerLineOption[]).map((x) => ({ ...x, price: x.price == null ? null : Number(x.price) })));
    }).catch((e: Error) => { if (!cancelled) toast.error(`Варианты цены группы: ${e.message}`); });
    return () => { cancelled = true; };
  }, [dealId, groupId, groupPrice, version]);

  async function update(id: string, patch: Partial<CompanyGroupLine>) {
    const { error } = await sbLoose().from("deal_company_group_lines").update(patch).eq("id", id);
    if (error) { toast.error(error.message); return; }
    load();
  }

  async function add() {
    const position = lines.length > 0 ? Math.max(...lines.map((l) => l.position)) + 1 : 1;
    const { error } = await sbLoose().from("deal_company_group_lines").insert({ deal_company_group_id: groupId, position });
    if (error) { toast.error(error.message); return; }
    load();
  }

  async function remove(l: CompanyGroupLine, name: string) {
    if (!confirm(`Удалить ${name.toLowerCase()} цены группы?`)) return;
    const { data, error } = await sbLoose().from("deal_company_group_lines").delete().eq("id", l.id).select("id");
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error("Вариант не удалён — нет прав"); return; }
    load();
  }

  const ordered = orderCompanyGroupLines(lines);
  // Один «Основной» без объёма — показывать нечего, как раньше.
  if (!editing && ordered.every((l) => l.is_default && l.buyer_line_id == null && l.manual_volume == null)) return null;

  return (
    <div className="mt-1.5 space-y-1.5">
      {title && <p className="text-[10px] text-purple-600 uppercase font-medium">{title}</p>}
      {ordered.map((l) => {
        const name = companyGroupLineName(l, ordered);
        const note = companyGroupLineNote(l.price, volumes.get(l.id), currencySymbol);
        const link = l.buyer_line_id ? `к варианту покупателя «${buyerLineName(l.buyer_line_id, buyerLines)}»` : null;
        const from = l.valid_from ? `с ${l.valid_from.split("-").reverse().join(".")}` : null;
        return (
          <div key={l.id} className="rounded border border-purple-100 bg-white/70 px-2 py-1.5 text-[11px]">
            {!editing ? (
              <div className="text-stone-700">
                <span className="font-medium">{name}:</span>{" "}
                <span className="font-mono tabular-nums">{price3(l.price)} {currencySymbol}</span>
                {l.price_kind === "final" ? " фин." : " предв."}
                {link && <span className="text-stone-500"> · {link}{from ? ` ${from}` : ""}</span>}
              </div>
            ) : (
              <div className="grid grid-cols-[110px_80px_80px_90px_80px_150px_120px_100px_28px] gap-1.5 items-center">
                <span className="font-medium text-stone-700">{name}</span>
                {l.is_default ? (
                  <span className="col-span-4 text-stone-500">
                    {price3(l.price)} {currencySymbol} — цена группы, правится в строке выше
                  </span>
                ) : (
                  <>
                    <Input type="number" step="0.001" placeholder="котир." defaultValue={l.quotation ?? ""}
                      className={inputCls}
                      onBlur={(e) => {
                        const q = parseNum(e.target.value);
                        if (q === l.quotation) return;
                        void update(l.id, { quotation: q, price: q != null ? Math.round((q - (l.discount ?? 0)) * 100) / 100 : l.price });
                      }} />
                    <Input type="number" step="0.001" placeholder="скидка" defaultValue={l.discount ?? ""}
                      className={inputCls}
                      onBlur={(e) => {
                        const d = parseNum(e.target.value);
                        if (d === l.discount) return;
                        void update(l.id, { discount: d, price: l.quotation != null ? Math.round((l.quotation - (d ?? 0)) * 100) / 100 : l.price });
                      }} />
                    <Input key={`p-${l.id}-${l.price ?? ""}`} type="number" step="0.001" placeholder="цена" defaultValue={l.price ?? ""}
                      className={inputCls}
                      onBlur={(e) => {
                        const p = parseNum(e.target.value);
                        if (p !== l.price) void update(l.id, { price: p });
                      }} />
                    <select value={l.price_kind} className={selectCls} title="Тип цены"
                      onChange={(e) => void update(l.id, { price_kind: e.target.value as CompanyGroupLine["price_kind"] })}>
                      <option value="preliminary">Предв.</option>
                      <option value="final">Фин.</option>
                    </select>
                  </>
                )}
                <select value={l.buyer_line_id ?? ""} className={selectCls} title="Объём — из отгрузок этого варианта покупателя"
                  onChange={(e) => {
                    const v = e.target.value || null;
                    if (v === l.buyer_line_id) return;
                    void update(l.id, v ? { buyer_line_id: v, manual_volume: null } : { buyer_line_id: null });
                  }}>
                  <option value="">Объём вручную</option>
                  {orderCompanyGroupLines(buyerLines).map((b) => (
                    <option key={b.id} value={b.id}>Покупатель: {buyerLineName(b.id, buyerLines)} ({price3(b.price)})</option>
                  ))}
                </select>
                {l.buyer_line_id ? (
                  <Input type="date" defaultValue={l.valid_from ?? ""} title="Действует с — отгрузки с этой даты идут по этой цене"
                    className="h-7 text-[11px] border-stone-300 bg-white"
                    onBlur={(e) => {
                      const v = e.target.value || null;
                      if (v !== l.valid_from) void update(l.id, { valid_from: v });
                    }} />
                ) : <span />}
                {l.buyer_line_id ? <span /> : (
                  <Input type="number" step="0.001" placeholder="объём, т" defaultValue={l.manual_volume ?? ""}
                    className={inputCls}
                    onBlur={(e) => {
                      const v = parseNum(e.target.value);
                      if (v !== l.manual_volume) void update(l.id, { manual_volume: v });
                    }} />
                )}
                {l.is_default ? <span /> : (
                  <button onClick={() => void remove(l, name)} title="Удалить вариант"
                    className="flex h-7 w-7 items-center justify-center rounded text-stone-400 hover:text-red-600 hover:bg-red-50">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
            {note && <div className="mt-1 border-t border-stone-200/70 pt-1 text-stone-500 font-mono tabular-nums">{note}</div>}
          </div>
        );
      })}
      {editing && (
        <button onClick={() => void add()} className="inline-flex items-center gap-1 text-[11px] text-purple-600 hover:text-purple-800">
          <Plus className="h-3 w-3" /> Добавить вариант цены
        </button>
      )}
    </div>
  );
}
