"use client";

import { useState, useEffect, useRef } from "react";
import { FileSpreadsheet, Receipt, Truck, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExcelUpload } from "@/components/import/excel-upload";
import { bulkInsertRegistry } from "@/lib/hooks/use-registry";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/types/database";
import { toast } from "sonner";

const tabs = [
  { key: "snt" as const, label: "СНТ", icon: FileSpreadsheet },
  { key: "esf" as const, label: "ЭСФ", icon: Receipt },
  { key: "registry" as const, label: "Реестр отгрузки", icon: Truck },
];

export default function ImportPage() {
  const [activeTab, setActiveTab] = useState<"snt" | "esf" | "registry">("registry");
  const [parsedData, setParsedData] = useState<Record<string, unknown>[]>([]);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [esfDealId, setEsfDealId] = useState("");
  const [dealOptions, setDealOptions] = useState<{ id: string; deal_code: string }[]>([]);
  const sbRef = useRef(createClient());

  // Load deal options for ESF assignment
  useEffect(() => {
    if (activeTab !== "esf") return;
    sbRef.current.from("deals").select("id, deal_code").eq("is_archived", false).order("deal_code")
      .then(({ data }) => setDealOptions((data ?? []) as { id: string; deal_code: string }[]));
  }, [activeTab]);

  function handleDataParsed(rows: Record<string, unknown>[]) {
    setParsedData(rows);
    setImportDone(false);
  }

  function clearData() {
    setParsedData([]);
    setImportDone(false);
  }

  // Coerce an Excel cell (unknown) into a nullable string for DB insert.
  function asString(v: unknown): string | null {
    if (v == null || v === "") return null;
    return String(v);
  }

  async function handleImportRegistry() {
    if (parsedData.length === 0) return;
    setImporting(true);

    // Map Excel columns to DB columns (best effort)
    const records = parsedData.map((row) => ({
      registry_type: "KG" as const,
      quarter: asString(row["квартал"] ?? row["quarter"]),
      month: asString(row["месяц"] ?? row["month"]),
      date: asString(row["дата"] ?? row["date"]),
      waybill_number: asString(row["№ накладной"] ?? row["waybill"]),
      wagon_number: asString(row["№ вагонов"] ?? row["wagon"]),
      shipment_volume: parseFloat(String(row["объем отгрузки"] ?? row["Объем отгрузки"] ?? row["volume"] ?? 0)) || null,
      shipment_month: asString(row["месяц отгрузки"]),
      railway_tariff: parseFloat(String(row["Ж/Д тариф"] ?? row["тариф"] ?? 0)) || null,
      invoice_number: asString(row["№ СФ"]),
      comment: asString(row["коментарий"] ?? row["комент"]),
      loading_volume: parseFloat(String(row["Налив тонн"] ?? row["налив"] ?? 0)) || null,
      additional_month: asString(row["месяц доп"] ?? row["доп месяц"]),
    }));

    const result = await bulkInsertRegistry(records);
    setImporting(false);
    if (result) setImportDone(true);
  }

  async function handleImportSntEsf() {
    if (parsedData.length === 0) return;
    setImporting(true);

    const supabase = createClient();

    // Store documents — dispatch by tab so each insert gets its correct type.
    const docs = parsedData.map((row) => ({
      raw_data: row as Json,
      supplier_name: asString(row["Поставщик"] ?? row["supplier"]),
      receiver_name: asString(row["Получатель"] ?? row["receiver"]),
      goods_description: asString(row["Товар"] ?? row["Наименование товара"] ?? row["goods"]),
      quantity: parseFloat(String(row["Количество"] ?? row["quantity"] ?? row["Кол-во"] ?? 0)) || null,
      total_amount: parseFloat(String(row["Сумма"] ?? row["total"] ?? row["Итого"] ?? 0)) || null,
      ...(activeTab === "esf" && esfDealId ? { deal_id: esfDealId } : {}),
    }));

    const { error: docError } = activeTab === "snt"
      ? await supabase.from("snt_documents").insert(docs)
      : await supabase.from("esf_documents").insert(docs);
    if (docError) { toast.error(`Ошибка импорта документов: ${docError.message}`); setImporting(false); return; }

    // Also create registry entries from the same data
    const registryRecords = parsedData.map((row) => ({
      registry_type: "KG" as const,
      date: asString(row["Дата"] ?? row["дата"] ?? row["date"]),
      waybill_number: asString(row["№ накладной"] ?? row["№ СНТ"] ?? row["waybill"]),
      wagon_number: asString(row["№ вагонов"] ?? row["№ ВЦ"] ?? row["wagon"]),
      shipment_volume: parseFloat(String(row["Количество"] ?? row["объем отгрузки"] ?? row["quantity"] ?? 0)) || null,
      comment: `Импорт из ${activeTab === "snt" ? "СНТ" : "ЭСФ"}`,
    })).filter((r) => r.shipment_volume);

    if (registryRecords.length > 0) {
      await bulkInsertRegistry(registryRecords);
    }

    toast.success(`Импортировано ${docs.length} документов, ${registryRecords.length} записей в реестр`);
    setImporting(false);
    setImportDone(true);
  }

  const columns = parsedData.length > 0 ? Object.keys(parsedData[0]) : [];
  const previewRows = parsedData.slice(0, 20);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Импорт данных</h1>

      <div className="flex gap-1 border-b border-stone-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); clearData(); }}
            className={`flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-amber-500 text-amber-700"
                : "border-transparent text-stone-500 hover:text-stone-700"
            }`}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Step 1: Upload */}
      {!importDone && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px]">
              1. Загрузите файл ({tabs.find(t => t.key === activeTab)?.label})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ExcelUpload onDataParsed={handleDataParsed} />
          </CardContent>
        </Card>
      )}

      {/* Step 2: Preview */}
      {parsedData.length > 0 && !importDone && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px] flex items-center justify-between">
              <span>2. Предварительный просмотр ({parsedData.length} строк)</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={clearData}>
                  Отмена
                </Button>
                {activeTab === "registry" && (
                  <Button size="sm" onClick={handleImportRegistry} disabled={importing}>
                    <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                    {importing ? "Импорт..." : `Импортировать ${parsedData.length} записей`}
                  </Button>
                )}
                {activeTab === "snt" && (
                  <Button size="sm" onClick={handleImportSntEsf} disabled={importing}>
                    <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                    {importing ? "Импорт..." : `Импорт СНТ + создать записи в реестр`}
                  </Button>
                )}
                {activeTab === "esf" && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <Label className="text-[11px] text-stone-500 whitespace-nowrap">Привязать к сделке:</Label>
                      <select value={esfDealId} onChange={(e) => setEsfDealId(e.target.value)}
                        className="h-8 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer min-w-[120px]">
                        <option value="">— без привязки —</option>
                        {dealOptions.map((d) => <option key={d.id} value={d.id}>{d.deal_code}</option>)}
                      </select>
                    </div>
                    <Button size="sm" onClick={handleImportSntEsf} disabled={importing}>
                      <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                      {importing ? "Импорт..." : `Импорт ЭСФ + создать записи в реестр`}
                    </Button>
                  </>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {previewRows.length < parsedData.length && (
              <p className="text-[11px] text-stone-400 mb-2">
                Показано {previewRows.length} из {parsedData.length} строк
              </p>
            )}
            <div className="overflow-x-auto rounded-md border border-stone-200 max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50">
                    {columns.map((col) => (
                      <TableHead key={col} className="text-[10px] whitespace-nowrap min-w-[80px]">
                        {col}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row, i) => (
                    <TableRow key={i}>
                      {columns.map((col) => (
                        <TableCell key={col} className="text-[11px] font-mono whitespace-nowrap max-w-[150px] truncate">
                          {row[col] != null ? String(row[col]) : ""}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Done */}
      {importDone && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8">
            <CheckCircle className="h-10 w-10 text-green-500" />
            <p className="text-[14px] font-medium text-stone-800">
              Импорт завершен
            </p>
            <p className="text-[12px] text-stone-500">
              {parsedData.length} записей добавлено в реестр отгрузки
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={clearData}>
                Импортировать еще
              </Button>
              <Button size="sm" onClick={() => window.location.href = "/registry"}>
                Перейти в реестр
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Help text */}
      {parsedData.length === 0 && !importDone && (
        <div className="rounded-md bg-amber-50/50 border border-amber-200 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-[12px] text-stone-600 space-y-1">
              {activeTab === "snt" && (
                <p>Загрузите Excel файл СНТ, выгруженный из 1С. Система распознает номер СНТ, дату, поставщика, получателя и товары.</p>
              )}
              {activeTab === "esf" && (
                <p>Загрузите Excel файл ЭСФ (электронная счет-фактура). Система распознает регистрационный номер, даты, суммы и налоги.</p>
              )}
              {activeTab === "registry" && (
                <p>Загрузите Excel файл реестра отгрузки. Столбцы: №, квартал, месяц, дата, № накладной, № вагонов, объем отгрузки, станции, вид ГСМ, № сделки, завод, поставщик, экспедитор, тариф.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
