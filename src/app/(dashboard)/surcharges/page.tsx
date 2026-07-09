"use client";

import { useState, useEffect } from "react";
import { Plus, Filter, Trash2, Pencil } from "lucide-react";
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
  // Money canon 2026-07-07: always 2 decimals.
  return val.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function SurchargeDialog({
  open,
  onClose,
  onSaved,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** null = режим создания, объект = режим редактирования. */
  editing: SurchargeRecord | null;
}) {
  const isEdit = editing != null;
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  // При открытии диалога пре-заполняем поля из editing или очищаем
  // для создания. Этот же useEffect ловит переход create ↔ edit,
  // если оператор откроет разные записи подряд.
  useEffect(() => {
    if (!open) return;
    setDealPassportNumber(editing?.deal_passport_number ?? "");
    setReason(editing?.reason ?? "");
    setAmount(editing?.amount != null ? String(editing.amount) : "");
    setPeriod(editing?.period ?? "");
    setIssuedByName(editing?.issued_by_name ?? "");
    setIssuedToName(editing?.issued_to_name ?? "");
    setApprovalStatus(editing?.approval_status ?? "на рассмотрении");
    setClaimedAmount(editing?.claimed_amount != null ? String(editing.claimed_amount) : "");
    setPaidAmount(editing?.paid_amount != null ? String(editing.paid_amount) : "");
  }, [open, editing]);

  async function handleSave() {
    if (!reason.trim()) {
      toast.error("Укажите причину");
      return;
    }
    setSaving(true);
    const sb = createClient();
    const payload = {
      deal_passport_number: dealPassportNumber || null,
      reason,
      amount: amount ? parseFloat(amount) : null,
      period: period || null,
      issued_by_name: issuedByName || null,
      issued_to_name: issuedToName || null,
      approval_status: approvalStatus,
      claimed_amount: claimedAmount ? parseFloat(claimedAmount) : null,
      paid_amount: paidAmount ? parseFloat(paidAmount) : null,
    };
    const { error } = isEdit && editing
      ? await sb.from("surcharges").update(payload).eq("id", editing.id)
      : await sb.from("surcharges").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("Ошибка сохранения: " + error.message);
    } else {
      toast.success(isEdit ? "Изменения сохранены" : "Запись добавлена");
      onSaved();
      onClose();
    }
  }

  async function handleDelete() {
    if (!isEdit || !editing) return;
    if (!confirm(`Удалить запись «${editing.reason ?? "без причины"}»?`)) return;
    setDeleting(true);
    const sb = createClient();
    const { error } = await sb.from("surcharges").delete().eq("id", editing.id);
    setDeleting(false);
    if (error) {
      toast.error("Ошибка удаления: " + error.message);
    } else {
      toast.success("Запись удалена");
      onSaved();
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Редактировать сверхнорматив / штраф" : "Добавить сверхнорматив / штраф"}</DialogTitle>
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
            disabled={saving || deleting}
            className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
          >
            {saving ? "Сохранение..." : isEdit ? "Сохранить" : "Добавить"}
          </Button>
          {isEdit && (
            <Button
              variant="outline"
              onClick={handleDelete}
              disabled={saving || deleting}
              className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
              title="Удалить запись"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              {deleting ? "Удаление…" : "Удалить"}
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving || deleting}>
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
  // Один диалог для create + edit. dialogState = "add" → создание,
  // dialogState = SurchargeRecord → редактирование, null → закрыт.
  const [dialogState, setDialogState] = useState<"add" | SurchargeRecord | null>(null);

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
          onClick={() => setDialogState("add")}
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
            onClick={() => setDialogState("add")}
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
                <TableRow
                  key={rec.id}
                  className="hover:bg-amber-50/30 cursor-pointer group"
                  onClick={() => setDialogState(rec)}
                  title="Кликните, чтобы отредактировать"
                >
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
                  <TableCell className="w-8">
                    <Pencil className="h-3.5 w-3.5 text-stone-300 group-hover:text-amber-600 transition-colors" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <SurchargeDialog
        open={dialogState !== null}
        onClose={() => setDialogState(null)}
        onSaved={loadRecords}
        editing={dialogState === "add" || dialogState === null ? null : dialogState}
      />
    </div>
  );
}
