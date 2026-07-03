"use client";

import { useState, useEffect, useRef } from "react";
import { FileSpreadsheet, Receipt, Truck, CheckCircle, AlertCircle, Download } from "lucide-react";
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
  // When the source only carries one volume column (e.g. СНТ «Количество» or a
  // registry export with just «объем»), the toggle decides which DB column it
  // lands in — отгрузка → shipment_volume, налив → loading_volume. Explicit
  // «объем отгрузки» + «Налив тонн» columns always win over this default.
  // 2026-06-26: default "load" so the «Входящее СНТ» button
  // (supplier-side) is pre-selected on import open.
  const [volumeTarget, setVolumeTarget] = useState<"ship" | "load">("load");
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

  // Build + download an Excel template whose headers exactly match what the
  // importer expects. Same file the client fills in — no separate template
  // drift (client's ask: "один шаблон — чтобы и клиенту отправлять, и в
  // паспорт сделки загружать").
  async function downloadTemplate() {
    const XLSX = await import("xlsx");
    const templates: Record<typeof activeTab, { headers: string[]; sample: Record<string, unknown> }> = {
      registry: {
        headers: [
          "квартал", "месяц", "дата", "№ накладной", "№ вагонов",
          "объем отгрузки", "месяц отгрузки", "Ж/Д тариф", "№ СФ",
          "коментарий", "Налив тонн", "месяц доп",
        ],
        sample: {
          "квартал": "Q1", "месяц": "январь", "дата": "15.01.2026",
          "№ накладной": "АО123456", "№ вагонов": "51742534",
          "объем отгрузки": 54.719, "месяц отгрузки": "январь",
          "Ж/Д тариф": 18500, "№ СФ": "СФ-0001", "коментарий": "",
          "Налив тонн": 54.719, "месяц доп": "",
        },
      },
      snt: {
        headers: [
          "№ СНТ", "Дата", "Поставщик", "Получатель",
          "Товар", "Количество", "Сумма", "№ вагонов", "№ накладной",
        ],
        sample: {
          "№ СНТ": "SNT-2026-0001", "Дата": "15.01.2026",
          "Поставщик": "ООО Пример", "Получатель": "АО Клиент",
          "Товар": "Дизель ТС Л-0,05-62 зимнее",
          "Количество": 54.719, "Сумма": 18_500_000,
          "№ вагонов": "51742534", "№ накладной": "АО123456",
        },
      },
      esf: {
        headers: [
          "№ ЭСФ", "Дата", "Поставщик", "Получатель",
          "Наименование товара", "Количество", "Сумма", "НДС", "Итого",
        ],
        sample: {
          "№ ЭСФ": "ESF-2026-0001", "Дата": "15.01.2026",
          "Поставщик": "ООО Пример", "Получатель": "АО Клиент",
          "Наименование товара": "Дизель ТС Л-0,05-62",
          "Количество": 54.719, "Сумма": 16_516_071,
          "НДС": 1_983_929, "Итого": 18_500_000,
        },
      },
    };
    const t = templates[activeTab];
    const ws = XLSX.utils.json_to_sheet([t.sample], { header: t.headers });
    const wb = XLSX.utils.book_new();
    const sheetName = activeTab === "registry" ? "Реестр отгрузки" : activeTab.toUpperCase();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `шаблон_${sheetName.replace(/\s+/g, "_").toLowerCase()}.xlsx`);
    toast.success("Шаблон скачан");
  }

  async function handleImportRegistry() {
    if (parsedData.length === 0) return;
    setImporting(true);

    // Map Excel columns to DB columns (best effort)
    const records = parsedData.map((row) => {
      const shipExplicit = parseFloat(String(row["объем отгрузки"] ?? row["Объем отгрузки"] ?? 0)) || null;
      const loadExplicit = parseFloat(String(row["Налив тонн"] ?? 0)) || null;
      const fallback = parseFloat(String(row["volume"] ?? row["налив"] ?? 0)) || null;
      // If the row had only a single unlabeled volume, route it per toggle.
      const shipFinal = shipExplicit ?? (loadExplicit == null && volumeTarget === "ship" ? fallback : null);
      const loadFinal = loadExplicit ?? (shipExplicit == null && volumeTarget === "load" ? fallback : null);
      return {
        registry_type: "KG" as const,
        quarter: asString(row["квартал"] ?? row["quarter"]),
        month: asString(row["месяц"] ?? row["month"]),
        date: asString(row["дата"] ?? row["date"]),
        waybill_number: asString(row["№ накладной"] ?? row["waybill"]),
        wagon_number: asString(row["№ вагонов"] ?? row["wagon"]),
        shipment_volume: shipFinal,
        shipment_month: asString(row["месяц отгрузки"]),
        railway_tariff: parseFloat(String(row["Ж/Д тариф"] ?? row["тариф"] ?? 0)) || null,
        invoice_number: asString(row["№ СФ"]),
        comment: asString(row["коментарий"] ?? row["комент"]),
        loading_volume: loadFinal,
        additional_month: asString(row["месяц доп"] ?? row["доп месяц"]),
      };
    });

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

    // Also create registry entries from the same data. СНТ/ЭСФ only carry one
    // quantity column — route it to shipment_volume or loading_volume per toggle.
    const registryRecords = parsedData.map((row) => {
      const qty = parseFloat(String(row["Количество"] ?? row["объем отгрузки"] ?? row["quantity"] ?? 0)) || null;
      return {
        registry_type: "KG" as const,
        date: asString(row["Дата"] ?? row["дата"] ?? row["date"]),
        waybill_number: asString(row["№ накладной"] ?? row["№ СНТ"] ?? row["waybill"]),
        wagon_number: asString(row["№ вагонов"] ?? row["№ ВЦ"] ?? row["wagon"]),
        shipment_volume: volumeTarget === "ship" ? qty : null,
        loading_volume: volumeTarget === "load" ? qty : null,
        comment: `Импорт из ${activeTab === "snt" ? "СНТ" : "ЭСФ"}`,
      };
    }).filter((r) => r.shipment_volume || r.loading_volume);

    // Dedupe against existing registry rows: СНТ/ЭСФ import only carries
    // ONE volume (loading OR shipment) but the same (wagon, waybill) may
    // already have a full row from the paired opposite-side import or
    // from the /registry Excel import. Client 2026-07-03 «есть дубли:
    // одной отгрузкой добавили входящее+исходящее, ниже ещё раз
    // добавили только входящее» — that was this exact scenario. When a
    // matching row exists, MERGE the missing volume onto it instead of
    // inserting a second row.
    if (registryRecords.length > 0) {
      const wagonWaybillPairs = registryRecords
        .filter((r) => r.wagon_number && r.waybill_number)
        .map((r) => `(${r.wagon_number},${r.waybill_number})`);
      // Fetch every existing row that matches any of the incoming
      // (wagon, waybill) pairs. Range covers a big import in one shot.
      const { data: existing } = wagonWaybillPairs.length > 0
        ? await supabase
            .from("shipment_registry")
            .select("id, wagon_number, waybill_number, loading_volume, shipment_volume")
            .eq("registry_type", "KG")
            .in("wagon_number", registryRecords.map((r) => r.wagon_number).filter(Boolean) as string[])
            .in("waybill_number", registryRecords.map((r) => r.waybill_number).filter(Boolean) as string[])
        : { data: [] as { id: string; wagon_number: string | null; waybill_number: string | null; loading_volume: number | null; shipment_volume: number | null }[] };
      const existingByKey = new Map<string, { id: string; loading_volume: number | null; shipment_volume: number | null }>();
      for (const r of existing ?? []) {
        if (r.wagon_number && r.waybill_number) {
          existingByKey.set(`${r.wagon_number}::${r.waybill_number}`, r);
        }
      }
      const toInsert: typeof registryRecords = [];
      const toUpdate: { id: string; patch: { loading_volume?: number | null; shipment_volume?: number | null } }[] = [];
      for (const rec of registryRecords) {
        const key = rec.wagon_number && rec.waybill_number ? `${rec.wagon_number}::${rec.waybill_number}` : null;
        const match = key ? existingByKey.get(key) : null;
        if (!match) { toInsert.push(rec); continue; }
        // Fill only the volume column the incoming row provides AND the
        // existing row leaves empty — never overwrite an already-set
        // volume, that's a hint the operator changed something and this
        // partial import shouldn't stomp it.
        const patch: { loading_volume?: number | null; shipment_volume?: number | null } = {};
        if (rec.loading_volume != null && match.loading_volume == null) patch.loading_volume = rec.loading_volume;
        if (rec.shipment_volume != null && match.shipment_volume == null) patch.shipment_volume = rec.shipment_volume;
        if (Object.keys(patch).length > 0) toUpdate.push({ id: match.id, patch });
      }
      if (toInsert.length > 0) await bulkInsertRegistry(toInsert);
      // Serial updates keep the trigger-driven rollups sane (one at a
      // time). N is small — this only fires when the import actually
      // has duplicates, not on every row.
      for (const u of toUpdate) {
        await supabase.from("shipment_registry").update(u.patch).eq("id", u.id);
      }
      toast.success(`Импортировано ${docs.length} документов, ${toInsert.length} новых записей, ${toUpdate.length} дозаполнено`);
    } else {
      toast.success(`Импортировано ${docs.length} документов`);
    }

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
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-[14px]">
              1. Загрузите файл ({tabs.find(t => t.key === activeTab)?.label})
            </CardTitle>
            <Button size="sm" variant="outline" onClick={downloadTemplate} className="h-7 text-[11px]">
              <Download className="mr-1 h-3 w-3" />
              Скачать шаблон
            </Button>
          </CardHeader>
          <CardContent>
            <ExcelUpload onDataParsed={handleDataParsed} />
            <p className="text-[10px] text-stone-400 mt-2">
              Шаблон можно отправить клиенту — столбцы совпадают с тем, что ожидает загрузчик, поэтому заполненный файл можно сразу импортировать обратно.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Preview */}
      {parsedData.length > 0 && !importDone && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px] flex items-center justify-between">
              <span>2. Предварительный просмотр ({parsedData.length} строк)</span>
              <div className="flex gap-2 items-center">
                <div className="flex items-center gap-1.5">
                  <Label className="text-[11px] text-stone-500 whitespace-nowrap">Объём идёт в:</Label>
                  <div className="inline-flex rounded border border-stone-200 bg-white overflow-hidden">
                    {/* 2026-06-26 swap: Входящее = supplier (loading_volume),
                        Исходящее = buyer (shipment_volume). Matches the
                        00044 rollup convention. */}
                    <button
                      type="button"
                      onClick={() => setVolumeTarget("load")}
                      className={`px-2 py-0.5 text-[11px] transition-colors ${volumeTarget === "load" ? "bg-amber-600 text-white" : "text-stone-600 hover:bg-stone-50"}`}
                      title="столбец loading_volume (поставщик)"
                    >
                      Входящее СНТ
                    </button>
                    <button
                      type="button"
                      onClick={() => setVolumeTarget("ship")}
                      className={`px-2 py-0.5 text-[11px] transition-colors border-l border-stone-200 ${volumeTarget === "ship" ? "bg-amber-600 text-white" : "text-stone-600 hover:bg-stone-50"}`}
                      title="столбец shipment_volume (покупатель)"
                    >
                      Исходящее СНТ
                    </button>
                  </div>
                </div>
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
