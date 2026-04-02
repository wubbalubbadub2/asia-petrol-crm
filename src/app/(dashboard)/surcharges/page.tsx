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

type ApprovalStatus = "Рассмотрено" | "на рассмотрении";

type SurchargeRecord = {
  id: string;
  deal_passport_number: string | null;
  reason: string | null;
  amount: number | null;
  period: string | null;
  issued_by_name: string | null;
  issued_to_name: string | null;
  approval_status: ApprovalStatus | null;
  claimed_amount: number | null;
  paid_amount: number | null;
};

function StatusBadge({ status }: { status: ApprovalStatus | null }) {
  if (!status) return <span className="text-stone-400 text-[11px]">—</span>;
  if (status === "Рассмотрено") {
    return (
      <span className="inline-flex items-center rounded-full bg-green-50 border border-green-200 px-2 py-0.5 text-[11px] font-medium text-green-700">
        Рассмотрено
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-700">
      на рассмотрении
    </span>
  );
}

function formatMoney(val: number | null | undefined): string {
  if (val == null) return "—";
  return val.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function AddSurchargeDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [saving, setSaving] = useState(false);

  const [dealPassportNumber, setDealPassportNumber] = useState("");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState("");
  const [issuedByName, setIssuedByName] = useState("");
  const [issuedToName, setIssuedToName] = useState("");
  const [approvalStatus, setApprovalStatus] =
    useState<ApprovalStatus>("на рассмотрении");
  const [claimedAmount, setClaimedAmount] = useState("");
  const [paidAmount, setPaidAmount] = useState("");

  async function handleSave() {
    if (!reason.trim()) {
      toast.error("Укажите причину");
      return;
    }
    setSaving(true);
    const sb = createClient();
    const { error } = await sb.from("surcharges").insert({
      deal_passport_number: dealPassportNumber || null,
      reason: reason || null,
      amount: amount ? parseFloat(amount) : null,
      period: period || null,
      issued_by_name: issuedByName || null,
      issued_to_name: issuedToName || null,
      approval_status: approvalStatus,
      claimed_amount: claimedAmount ? parseFloat(claimedAmount) : null,
      paid_amount: paidAmount ? parseFloat(paidAmount) : null,
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

  function reset() {
    setDealPassportNumber("");
    setReason("");
    setAmount("");
    setPeriod("");
    setIssuedByName("");
    setIssuedToName("");
    setApprovalStatus("на рассмотрении");
    setClaimedAmount("");
    setPaidAmount("");
  }

  function handleClose() {
    reset();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={() => handleClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Добавить сверхнорматив / штраф</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[12px] text-stone-500">№ сделки</Label>
            <Input
              value={dealPassportNumber}
              onChange={(e) => setDealPassportNumber(e.target.value)}
              placeholder="AP-2024-001"
              className="h-8 text-[13px]"
            />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Период</Label>
            <Input
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="янв 2024"
              className="h-8 text-[13px]"
            />
          </div>
          <div className="col-span-2">
            <Label className="text-[12px] text-stone-500">
              Причина <span className="text-destructive">*</span>
            </Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Простой вагонов, превышение нормы..."
              className="h-8 text-[13px]"
            />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Сумма</Label>
            <Input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-8 text-[13px] font-mono"
              placeholder="0.00"
            />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">
              Статус
            </Label>
            <select
              value={approvalStatus}
              onChange={(e) =>
                setApprovalStatus(e.target.value as ApprovalStatus)
              }
              className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer"
            >
              <option value="на рассмотрении">на рассмотрении</option>
              <option value="Рассмотрено">Рассмотрено</option>
            </select>
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Выставлена от</Label>
            <Input
              value={issuedByName}
              onChange={(e) => setIssuedByName(e.target.value)}
              placeholder="Организация"
              className="h-8 text-[13px]"
            />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Выставлена на</Label>
            <Input
              value={issuedToName}
              onChange={(e) => setIssuedToName(e.target.value)}
              placeholder="Организация"
              className="h-8 text-[13px]"
            />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Выставлено к оплате</Label>
            <Input
              type="number"
              step="0.01"
              value={claimedAmount}
              onChange={(e) => setClaimedAmount(e.target.value)}
              className="h-8 text-[13px] font-mono"
              placeholder="0.00"
            />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Оплачено</Label>
            <Input
              type="number"
              step="0.01"
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
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
          <Button variant="outline" onClick={handleClose}>
            Отмена
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SurchargesPage() {
  const [records, setRecords] = useState<SurchargeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  async function loadRecords() {
    setLoading(true);
    const sb = createClient();
    const { data, error } = await sb
      .from("surcharges")
      .select(
        `id,
         deal_passport_number,
         reason,
         amount,
         period,
         issued_by_name,
         issued_to_name,
         approval_status,
         claimed_amount,
         paid_amount`
      )
      .order("created_at", { ascending: false });

    setLoading(false);
    if (error) {
      toast.error("Ошибка загрузки данных");
      return;
    }
    setRecords((data ?? []) as SurchargeRecord[]);
  }

  useEffect(() => {
    loadRecords();
  }, []);

  const filtered = records.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.deal_passport_number?.toLowerCase().includes(q) ||
      r.reason?.toLowerCase().includes(q) ||
      r.issued_by_name?.toLowerCase().includes(q) ||
      r.issued_to_name?.toLowerCase().includes(q) ||
      r.period?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Сверхнормативы / Штрафы</h1>
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
        <Input
          placeholder="Поиск по № сделки, причине, организации..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm h-7 text-[12px]"
        />
        <span className="text-[11px] text-stone-400 ml-auto">
          {filtered.length} записей
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка...</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-stone-200 bg-white py-12 text-center">
          <p className="text-sm text-stone-500">Нет записей</p>
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
                <TableHead className="text-[11px]">№ сделки</TableHead>
                <TableHead className="text-[11px]">Причина</TableHead>
                <TableHead className="text-right text-[11px]">Сумма</TableHead>
                <TableHead className="text-[11px]">Период</TableHead>
                <TableHead className="text-[11px]">Выставлена от</TableHead>
                <TableHead className="text-[11px]">Выставлена на</TableHead>
                <TableHead className="text-[11px]">Статус</TableHead>
                <TableHead className="text-right text-[11px]">Оплачено</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((rec) => (
                <TableRow key={rec.id} className="hover:bg-amber-50/30">
                  <TableCell className="font-mono text-[12px] text-amber-700">
                    {rec.deal_passport_number ?? "—"}
                  </TableCell>
                  <TableCell className="text-[12px] text-stone-700 max-w-[200px] truncate">
                    {rec.reason ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular-nums text-stone-800">
                    {formatMoney(rec.amount)}
                  </TableCell>
                  <TableCell className="text-[12px] text-stone-600">
                    {rec.period ?? "—"}
                  </TableCell>
                  <TableCell className="text-[12px] text-stone-600 max-w-[140px] truncate">
                    {rec.issued_by_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-[12px] text-stone-600 max-w-[140px] truncate">
                    {rec.issued_to_name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={rec.approval_status} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular-nums text-green-700">
                    {formatMoney(rec.paid_amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AddSurchargeDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={loadRecords}
      />
    </div>
  );
}
