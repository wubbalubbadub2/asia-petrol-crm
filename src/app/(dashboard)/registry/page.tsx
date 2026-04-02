"use client";

import { useState } from "react";
import { Plus, Upload, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRegistry, type ShipmentRecord } from "@/lib/hooks/use-registry";

const tabs = [
  { key: "kg" as const, label: "KG (Экспорт)" },
  { key: "kz" as const, label: "KZ (Внутренний)" },
];

function formatNum(val: number | null | undefined): string {
  if (val == null) return "";
  return val.toLocaleString("ru-RU", { maximumFractionDigits: 4 });
}

function formatDate(d: string | null): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("ru-RU");
}

export default function RegistryPage() {
  const [activeTab, setActiveTab] = useState<"kg" | "kz">("kg");
  const { data: records, loading, reload } = useRegistry(activeTab === "kg" ? "KG" : "KZ");
  const currency = activeTab === "kg" ? "$" : "₸";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Реестр отгрузки</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => window.location.href = "/import"}>
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Импорт Excel
          </Button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-stone-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-amber-500 text-amber-700"
                : "border-transparent text-stone-500 hover:text-stone-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
        <span className="ml-auto self-center text-[11px] text-stone-400">
          {records.length} записей
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка...</p>
      ) : records.length === 0 ? (
        <div className="rounded-md border border-stone-200 bg-white py-12 text-center">
          <Truck className="h-8 w-8 text-stone-300 mx-auto mb-2" />
          <p className="text-sm text-stone-500">
            Реестр {activeTab.toUpperCase()} пуст
          </p>
          <p className="text-[12px] text-stone-400 mt-1">
            Импортируйте данные из Excel через раздел Импорт
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-stone-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow className="bg-stone-50">
                <TableHead className="text-[11px] w-[50px]">№</TableHead>
                <TableHead className="text-[11px]">Дата</TableHead>
                <TableHead className="text-[11px]">№ накладной</TableHead>
                <TableHead className="text-[11px]">№ вагона</TableHead>
                <TableHead className="text-right text-[11px]">Объем</TableHead>
                <TableHead className="text-[11px]">Ст. назнач.</TableHead>
                <TableHead className="text-[11px]">Ст. отправ.</TableHead>
                <TableHead className="text-[11px]">ГСМ</TableHead>
                <TableHead className="text-[11px]">№ сделки</TableHead>
                <TableHead className="text-[11px]">Завод</TableHead>
                <TableHead className="text-[11px]">Экспедитор</TableHead>
                <TableHead className="text-right text-[11px]">Тариф</TableHead>
                <TableHead className="text-right text-[11px]">Сумма {currency}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((rec) => (
                <TableRow key={rec.id} className="hover:bg-amber-50/20">
                  <TableCell className="font-mono text-[11px] text-stone-400">{rec.row_number ?? ""}</TableCell>
                  <TableCell className="text-[11px]">{formatDate(rec.date)}</TableCell>
                  <TableCell className="font-mono text-[11px]">{rec.waybill_number ?? ""}</TableCell>
                  <TableCell className="font-mono text-[11px] max-w-[100px] truncate">{rec.wagon_number ?? ""}</TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular-nums">{formatNum(rec.shipment_volume)}</TableCell>
                  <TableCell className="text-[11px] text-stone-600">{rec.destination_station?.name ?? ""}</TableCell>
                  <TableCell className="text-[11px] text-stone-600">{rec.departure_station?.name ?? ""}</TableCell>
                  <TableCell className="text-[11px]">
                    {rec.fuel_type ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: rec.fuel_type.color }} />
                        {rec.fuel_type.name}
                      </span>
                    ) : ""}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-amber-700">{rec.deal?.deal_code ?? ""}</TableCell>
                  <TableCell className="text-[11px] text-stone-600">{rec.factory?.name ?? ""}</TableCell>
                  <TableCell className="text-[11px] text-stone-600">{rec.forwarder?.name ?? ""}</TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular-nums">{formatNum(rec.railway_tariff)}</TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular-nums">{formatNum(rec.shipped_tonnage_amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
