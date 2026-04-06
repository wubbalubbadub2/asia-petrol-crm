"use client";

import { useState, useEffect } from "react";
import { Plus, Filter } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";

type Forwarder = { id: string; name: string };
type CompanyGroup = { id: string; name: string };

type DtKtRecord = {
  id: string;
  forwarder_id: string | null;
  company_group_id: string | null;
  year: number | null;
  opening_balance: number | null;
  payment: number | null;
  refund: number | null;
  fines: number | null;
  surcharge_preliminary: number | null;
  ogem: number | null;
  forwarder?: { name: string } | null;
  company_group?: { name: string } | null;
};

function n(val: number | null | undefined): number {
  return val ?? 0;
}

function formatMoney(val: number | null | undefined): string {
  if (val == null) return "—";
  return val.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

// Excel formula: =E+G-(I+J+K+L)-H
// = opening + payment - (shipped_tonnage + fines + surcharge + ogem) - refund
function computeSaldo(row: DtKtRecord): number {
  return (
    n(row.opening_balance) +
    n(row.payment) -
    (n(row.fines) + n(row.surcharge_preliminary) + n(row.ogem)) -
    n(row.refund)
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <Label className="text-[12px] text-stone-500">{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer"
      >
        <option value="">Выберите...</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function AddDtKtDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [forwarders, setForwarders] = useState<Forwarder[]>([]);
  const [companyGroups, setCompanyGroups] = useState<CompanyGroup[]>([]);
  const [saving, setSaving] = useState(false);

  const [forwarderId, setForwarderId] = useState("");
  const [companyGroupId, setCompanyGroupId] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [openingBalance, setOpeningBalance] = useState("");
  const [payment, setPayment] = useState("");
  const [refund, setRefund] = useState("");
  const [fines, setFines] = useState("");
  const [surchargePreliminary, setSurchargePreliminary] = useState("");
  const [ogem, setOgem] = useState("");

  useEffect(() => {
    if (!open) return;
    const sb = createClient();
    Promise.all([
      sb.from("forwarders").select("id, name").eq("is_active", true).order("name"),
      sb.from("company_groups").select("id, name").order("name"),
    ]).then(([fw, cg]) => {
      setForwarders((fw.data ?? []) as Forwarder[]);
      setCompanyGroups((cg.data ?? []) as CompanyGroup[]);
    });
  }, [open]);

  async function handleSave() {
    if (!forwarderId) {
      toast.error("Выберите экспедитора");
      return;
    }
    if (!year) {
      toast.error("Укажите год");
      return;
    }
    setSaving(true);
    const sb = createClient();
    const { error } = await sb.from("dt_kt_logistics").insert({
      forwarder_id: forwarderId || null,
      company_group_id: companyGroupId || null,
      year: year ? parseInt(year) : null,
      opening_balance: openingBalance ? parseFloat(openingBalance) : null,
      payment: payment ? parseFloat(payment) : null,
      refund: refund ? parseFloat(refund) : null,
      fines: fines ? parseFloat(fines) : null,
      surcharge_preliminary: surchargePreliminary
        ? parseFloat(surchargePreliminary)
        : null,
      ogem: ogem ? parseFloat(ogem) : null,
    });
    setSaving(false);
    if (error) {
      toast.error("Ошибка сохранения: " + error.message);
    } else {
      toast.success("Запись добавлена");
      onCreated();
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Добавить запись ДТ-КТ</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Экспедитор *"
            value={forwarderId}
            onChange={setForwarderId}
            options={forwarders.map((f) => ({ value: f.id, label: f.name }))}
          />
          <SelectField
            label="Группа компании"
            value={companyGroupId}
            onChange={setCompanyGroupId}
            options={companyGroups.map((g) => ({
              value: g.id,
              label: g.name,
            }))}
          />
          <div>
            <Label className="text-[12px] text-stone-500">Год *</Label>
            <Input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="h-8 text-[13px] font-mono"
            />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">
              Сальдо на 1 янв.
            </Label>
            <Input
              type="number"
              step="0.01"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              className="h-8 text-[13px] font-mono"
              placeholder="0.00"
            />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Оплата</Label>
            <Input
              type="number"
              step="0.01"
              value={payment}
              onChange={(e) => setPayment(e.target.value)}
              className="h-8 text-[13px] font-mono"
              placeholder="0.00"
            />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Возврат</Label>
            <Input
              type="number"
              step="0.01"
              value={refund}
              onChange={(e) => setRefund(e.target.value)}
              className="h-8 text-[13px] font-mono"
              placeholder="0.00"
            />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Штрафы</Label>
            <Input
              type="number"
              step="0.01"
              value={fines}
              onChange={(e) => setFines(e.target.value)}
              className="h-8 text-[13px] font-mono"
              placeholder="0.00"
            />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Сверхнорм.</Label>
            <Input
              type="number"
              step="0.01"
              value={surchargePreliminary}
              onChange={(e) => setSurchargePreliminary(e.target.value)}
              className="h-8 text-[13px] font-mono"
              placeholder="0.00"
            />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">ОГЭМ</Label>
            <Input
              type="number"
              step="0.01"
              value={ogem}
              onChange={(e) => setOgem(e.target.value)}
              className="h-8 text-[13px] font-mono"
              placeholder="0.00"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-2">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
          >
            {saving ? "Сохранение..." : "Добавить"}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function DtKtPage() {
  const [records, setRecords] = useState<DtKtRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear());
  const [showAdd, setShowAdd] = useState(false);

  async function loadRecords() {
    setLoading(true);
    const sb = createClient();
    const { data, error } = await sb
      .from("dt_kt_logistics")
      .select(
        `id,
         forwarder_id,
         company_group_id,
         year,
         opening_balance,
         payment,
         refund,
         fines,
         surcharge_preliminary,
         ogem,
         forwarder:forwarders(name),
         company_group:company_groups(name)`
      )
      .eq("year", yearFilter)
      .order("forwarder_id");

    setLoading(false);
    if (error) {
      toast.error("Ошибка загрузки данных");
      return;
    }
    setRecords((data ?? []) as unknown as DtKtRecord[]);
  }

  useEffect(() => {
    loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearFilter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">ДТ-КТ Логистика</h1>
        <Button
          size="sm"
          className="bg-amber-500 hover:bg-amber-600 text-white"
          onClick={() => setShowAdd(true)}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Добавить
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-stone-400" />
          <span className="text-[12px] text-stone-500">Год:</span>
          <Input
            type="number"
            value={yearFilter}
            onChange={(e) => setYearFilter(Number(e.target.value))}
            className="w-20 h-7 text-[12px]"
          />
        </div>
        <span className="text-[11px] text-stone-400 ml-auto">
          {records.length} записей
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка...</p>
      ) : records.length === 0 ? (
        <div className="rounded-md border border-stone-200 bg-white py-12 text-center">
          <p className="text-sm text-stone-500">
            Нет данных за {yearFilter} год
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => setShowAdd(true)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Добавить первую запись
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-stone-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow className="bg-stone-50">
                <TableHead className="text-[11px]">Экспедитор</TableHead>
                <TableHead className="text-[11px]">Группа компании</TableHead>
                <TableHead className="text-[11px]">Год</TableHead>
                <TableHead className="text-right text-[11px]">
                  Сальдо на 1 янв.
                </TableHead>
                <TableHead className="text-right text-[11px]">Оплата</TableHead>
                <TableHead className="text-right text-[11px]">Возврат</TableHead>
                <TableHead className="text-right text-[11px]">Штрафы</TableHead>
                <TableHead className="text-right text-[11px]">
                  Сверхнорм.
                </TableHead>
                <TableHead className="text-right text-[11px]">ОГЭМ</TableHead>
                <TableHead className="text-right text-[11px] font-semibold text-stone-700">
                  Текущее сальдо
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((rec) => {
                const saldo = computeSaldo(rec);
                return (
                  <TableRow key={rec.id} className="hover:bg-amber-50/30">
                    <TableCell className="text-[12px] text-stone-700">
                      {(rec.forwarder as any)?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-[12px] text-stone-600">
                      {(rec.company_group as any)?.name ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-[12px] text-stone-600">
                      {rec.year ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] tabular-nums text-stone-700">
                      {formatMoney(rec.opening_balance)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] tabular-nums text-stone-700">
                      {formatMoney(rec.payment)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] tabular-nums text-stone-700">
                      {formatMoney(rec.refund)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] tabular-nums text-red-600">
                      {formatMoney(rec.fines)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] tabular-nums text-orange-600">
                      {formatMoney(rec.surcharge_preliminary)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] tabular-nums text-stone-700">
                      {formatMoney(rec.ogem)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono text-[11px] tabular-nums font-semibold ${
                        saldo < 0 ? "text-red-600" : "text-green-700"
                      }`}
                    >
                      {saldo.toLocaleString("ru-RU", {
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AddDtKtDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={loadRecords}
      />
    </div>
  );
}
