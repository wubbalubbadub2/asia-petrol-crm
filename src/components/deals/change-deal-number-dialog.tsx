"use client";

import { useState, useTransition } from "react";
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
import { createClient } from "@/lib/supabase/client";

type DealType = "KG" | "KZ" | "OIL";

function formatCode(type: DealType, year: number, number: number) {
  return `${type}/${String(year % 100).padStart(2, "0")}/${String(number).padStart(3, "0")}`;
}

export function ChangeDealNumberDialog({
  open,
  onOpenChange,
  dealId,
  dealType,
  year,
  currentNumber,
  currentCode,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  dealType: DealType;
  year: number;
  currentNumber: number;
  currentCode: string;
  onChanged: () => void;
}) {
  const [value, setValue] = useState<string>(String(currentNumber));
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n < 1) {
      toast.error("Номер должен быть положительным целым числом");
      return;
    }
    if (n === currentNumber) {
      onOpenChange(false);
      return;
    }

    start(async () => {
      const supabase = createClient();
      const { error } = await supabase
        .from("deals")
        .update({ deal_number: n })
        .eq("id", dealId);

      if (error) {
        if (error.code === "23505") {
          toast.error(`Сделка ${formatCode(dealType, year, n)} уже существует`);
        } else {
          toast.error(`Ошибка: ${error.message}`);
        }
        return;
      }

      // Bump the per-(type, year) sequence so future auto-generated numbers
      // can't collide with the manually picked one. Admin-only flow + low
      // frequency, so a read/compare/update is safe (no race risk worth a
      // SECURITY DEFINER RPC).
      const { data: seq } = await supabase
        .from("deal_sequences")
        .select("last_number")
        .eq("deal_type", dealType)
        .eq("year", year)
        .maybeSingle();
      if (!seq) {
        await supabase
          .from("deal_sequences")
          .insert({ deal_type: dealType, year, last_number: n });
      } else if (seq.last_number < n) {
        await supabase
          .from("deal_sequences")
          .update({ last_number: n })
          .eq("deal_type", dealType)
          .eq("year", year);
      }

      toast.success(`Номер изменён: ${currentCode} → ${formatCode(dealType, year, n)}`);
      onChanged();
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Изменить номер сделки</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 pt-2">
          <p className="text-[12px] text-stone-600">
            Текущий код: <span className="font-mono font-medium">{currentCode}</span>
          </p>
          <div className="space-y-1.5">
            <Label>Новый номер</Label>
            <Input
              type="number"
              min={1}
              step={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
            <p className="text-[11px] text-stone-500">
              Год и тип ({dealType}/{String(year % 100).padStart(2, "0")}/…) не меняются.
              Изменение попадёт в журнал.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Сохранение..." : "Изменить"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
