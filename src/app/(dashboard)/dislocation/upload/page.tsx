"use client";
// Загрузка файлов дислокации (миграция 00174, функция rail_upload_dislocation).
//
// 1. Выбрать экспедитора и файлы — разбор в браузере тем же парсером, что
//    проверен на 40 файлах PTC и Шагыр.
// 2. Подтвердить дату и время снимка — в самом файле 1С их нет, только в имени.
// 3. Сопоставить новые названия станций со справочником — один раз, дальше
//    соответствие запоминается.
// 4. Каждый файл уходит одним вызовом: либо целиком в базе, либо его нет.
import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { parseAnyDislocationSheet, parseTrackingSnapshotAt } from "@/lib/parsers/dislocation-tracking";
import {
  collectStationNames,
  parseSnapshotAtFromFileName,
  sha256Hex,
  toUploadRows,
  type StationName,
} from "@/lib/dislocation/upload";
import type { DislocationRow } from "@/lib/parsers/dislocation";
import { railDb, dbErrorMessage } from "@/lib/dislocation/db";
import { useRailReferences, useUploads } from "@/lib/hooks/use-dislocation";
import { useRole } from "@/lib/role-context";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type ParsedFile = {
  name: string;
  hash: string;
  /** `YYYY-MM-DDTHH:mm:ss` — редактируется пользователем. */
  snapshotAt: string;
  rows: DislocationRow[];
  error: string | null;
  warnings: string[];
  status: "ready" | "uploading" | "done" | "failed";
  result?: string;
};

export default function DislocationUploadPage() {
  const { isWritable, isAdmin } = useRole();
  const { forwarders, stations } = useRailReferences();
  const uploads = useUploads();
  const [forwarderId, setForwarderId] = useState("");
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [parsing, setParsing] = useState(false);
  const [unknownStations, setUnknownStations] = useState<StationName[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function onPick(list: FileList | null) {
    if (!list || list.length === 0) return;
    setParsing(true);
    const XLSX = await import("xlsx");
    const parsed: ParsedFile[] = [];
    for (const file of Array.from(list)) {
      const buffer = await file.arrayBuffer();
      const hash = await sha256Hex(buffer);
      const base: ParsedFile = {
        name: file.name,
        hash,
        snapshotAt: parseSnapshotAtFromFileName(file.name) ?? "",
        rows: [],
        error: null,
        warnings: [],
        status: "ready",
      };
      try {
        const wb = XLSX.read(buffer, { cellDates: false });
        const sheet = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as unknown[][];
        const res = parseAnyDislocationSheet(sheet);
        // Дата снимка: имя файла 1С → имя файла слежения → подвал файла.
        if (!base.snapshotAt) base.snapshotAt = parseTrackingSnapshotAt(file.name) ?? res.snapshotAt ?? "";
        if (res.missingColumns.length > 0) {
          base.error = `Формат не поддерживается: нет колонок ${res.missingColumns.join(", ")}. Читаются рассылка 1С («Рассылка дислокации») и выгрузка слежения («dislocation_…»).`;
        } else if (res.rows.length === 0) {
          base.error = "В файле нет вагонов";
        }
        base.rows = res.rows;
        base.warnings = res.errors.map((e) => `строка ${e.sheetRow}: ${e.message}`);
      } catch (e) {
        base.error = `Файл не читается: ${(e as Error).message}`;
      }
      if (!base.error && !base.snapshotAt) base.warnings.unshift("В имени файла нет даты — укажите дату снимка");
      parsed.push(base);
    }
    parsed.sort((a, b) => a.snapshotAt.localeCompare(b.snapshotAt));
    setFiles(parsed);

    // Станции, которых нет в справочнике соответствий.
    const names = collectStationNames(parsed.flatMap((f) => (f.error ? [] : f.rows)));
    const { data, error } = await railDb()
      .from("rail_station_aliases")
      .select("alias")
      .in("alias", names.map((n) => n.alias));
    if (error) toast.error(`Справочник станций: ${dbErrorMessage(error)}`);
    const known = new Set(((data ?? []) as { alias: string }[]).map((a) => a.alias));
    setUnknownStations(names.filter((n) => !known.has(n.alias)));
    setMapping({});
    setParsing(false);
  }

  const readyFiles = files.filter((f) => !f.error && f.status !== "done");
  const unmapped = unknownStations.filter((s) => !mapping[s.alias]);
  const missingSnapshot = readyFiles.some((f) => !f.snapshotAt);
  const canSave =
    isWritable && !!forwarderId && readyFiles.length > 0 && unmapped.length === 0 && !missingSnapshot && !saving;

  const blockers = useMemo(() => {
    const b: string[] = [];
    if (!forwarderId) b.push("выберите экспедитора");
    if (unmapped.length > 0) b.push(`сопоставьте станции: ${unmapped.length}`);
    if (missingSnapshot) b.push("укажите дату снимка у всех файлов");
    return b;
  }, [forwarderId, unmapped.length, missingSnapshot]);

  async function onSave() {
    setSaving(true);
    const sb = railDb();
    if (unknownStations.length > 0) {
      const { error } = await sb
        .from("rail_station_aliases")
        .insert(unknownStations.map((s) => ({ alias: s.alias, station_id: mapping[s.alias] })));
      if (error) {
        toast.error(`Станции не сохранены: ${dbErrorMessage(error)}`);
        setSaving(false);
        return;
      }
      setUnknownStations([]);
    }

    let ok = 0;
    for (const f of readyFiles) {
      setFiles((prev) => prev.map((x) => (x.hash === f.hash ? { ...x, status: "uploading" } : x)));
      const { error } = await sb.rpc("rail_upload_dislocation", {
        p_forwarder_id: forwarderId,
        p_snapshot_at: f.snapshotAt,
        p_file_name: f.name,
        p_content_hash: f.hash,
        p_rows: toUploadRows(f.rows),
      });
      if (!error) ok++;
      setFiles((prev) =>
        prev.map((x) =>
          x.hash === f.hash
            ? error
              ? { ...x, status: "failed", result: dbErrorMessage(error) }
              : { ...x, status: "done", result: `загружено вагонов: ${f.rows.length}` }
            : x,
        ),
      );
    }
    setSaving(false);
    if (ok > 0) toast.success(`Загружено файлов: ${ok} из ${readyFiles.length}`);
    uploads.reload();
  }

  const stationOptions = stations;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Загрузка дислокации</h1>
        <Link href="/dislocation" className="text-[12px] text-amber-700 hover:underline">← Простой вагонов</Link>
      </div>

      {!isWritable ? (
        <p className="text-sm text-stone-500">Загрузка доступна менеджерам и логистам.</p>
      ) : (
        <section className="grid gap-3 rounded border border-stone-200 bg-white p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label className="text-[11px] text-stone-500">Экспедитор, от которого файл</Label>
              <SearchableSelect options={forwarders} value={forwarderId} onChange={setForwarderId}
                placeholder="Выберите экспедитора" triggerClassName="h-8 w-64 text-[12px]" />
            </div>
            <div className="grid gap-1">
              <Label className="text-[11px] text-stone-500">Файлы (можно несколько)</Label>
              <Input type="file" multiple accept=".xlsx,.xls" onChange={(e) => onPick(e.target.files)}
                     className="h-8 w-80 text-[12px]" />
            </div>
            {parsing ? <span className="text-[12px] text-stone-500">Разбор…</span> : null}
          </div>

          {files.length > 0 ? (
            <table className="w-full border-collapse text-[11px]">
              <thead className="bg-stone-100">
                <tr className="border-b">
                  <th className="px-2 py-1 text-left font-medium">Файл</th>
                  <th className="px-2 py-1 text-left font-medium">Дата и время снимка</th>
                  <th className="px-2 py-1 text-right font-medium">Вагонов</th>
                  <th className="px-2 py-1 text-left font-medium">Результат</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.hash} className="border-b align-top">
                    <td className="px-2 py-1">{f.name}</td>
                    <td className="px-2 py-1">
                      {f.error ? "—" : (
                        <Input type="datetime-local" step={1} value={f.snapshotAt} disabled={f.status === "done"}
                          onChange={(e) => setFiles((prev) => prev.map((x) => x.hash === f.hash ? { ...x, snapshotAt: e.target.value.length === 16 ? `${e.target.value}:00` : e.target.value } : x))}
                          className="h-7 w-52 text-[11px]" />
                      )}
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums">{f.rows.length}</td>
                    <td className="px-2 py-1">
                      {f.error ? <span className="text-red-700">{f.error}</span>
                        : f.status === "done" ? <span className="text-emerald-700">{f.result}</span>
                        : f.status === "failed" ? <span className="text-red-700">{f.result}</span>
                        : f.status === "uploading" ? "Загрузка…"
                        : <span className="text-stone-500">готов{f.warnings.length ? ` · ${f.warnings.slice(0, 3).join("; ")}` : ""}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {unknownStations.length > 0 ? (
            <div className="grid gap-2">
              <p className="text-[12px] font-medium">
                Новые названия станций — сопоставьте со справочником один раз. «Шагыр (Эксп.)» и «Шагыр» — одна станция погрузки.
              </p>
              <div className="grid grid-cols-[minmax(0,260px)_minmax(0,320px)] gap-x-3 gap-y-1">
                {unknownStations.map((s) => (
                  <div key={s.alias} className="contents">
                    <span className="self-center text-[12px]">{s.sample}</span>
                    <SearchableSelect options={stationOptions} value={mapping[s.alias] ?? ""}
                      onChange={(v) => setMapping((m) => ({ ...m, [s.alias]: v }))}
                      placeholder="Станция из справочника" triggerClassName="h-7 w-full text-[11px]" />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {files.length > 0 ? (
            <div className="flex items-center gap-3">
              <Button onClick={onSave} disabled={!canSave} className="h-8 text-[12px]">
                {saving ? "Загрузка…" : `Загрузить файлов: ${readyFiles.length}`}
              </Button>
              {blockers.length > 0 ? <span className="text-[12px] text-stone-500">Осталось: {blockers.join(", ")}</span> : null}
            </div>
          ) : null}
        </section>
      )}

      <section className="grid gap-2">
        <h2 className="text-[14px] font-semibold">Загруженные файлы</h2>
        {uploads.loading ? <p className="text-sm text-stone-500">Загрузка…</p> : uploads.data.length === 0 ? (
          <p className="text-sm text-stone-500">Файлов ещё нет.</p>
        ) : (
          <div className="overflow-auto rounded border border-stone-200 bg-white">
            <table className="w-full border-collapse text-[11px]">
              <thead className="bg-stone-100">
                <tr className="border-b">
                  <th className="px-2 py-1 text-left font-medium">Снимок</th>
                  <th className="px-2 py-1 text-left font-medium">Экспедитор</th>
                  <th className="px-2 py-1 text-left font-medium">Файл</th>
                  <th className="px-2 py-1 text-right font-medium">Вагонов</th>
                  {isAdmin ? <th className="px-2 py-1" /> : null}
                </tr>
              </thead>
              <tbody>
                {uploads.data.map((u) => (
                  <tr key={u.id} className="border-b">
                    <td className="px-2 py-1 font-mono">{u.snapshot_at.slice(0, 16).replace("T", " ").split(" ").map((p, i) => i === 0 ? p.split("-").reverse().join(".") : p).join(" ")}</td>
                    <td className="px-2 py-1">{u.forwarders?.name ?? "—"}</td>
                    <td className="px-2 py-1">{u.file_name}</td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums">{u.row_count}</td>
                    {isAdmin ? (
                      <td className="px-2 py-1 text-right">
                        <button className="text-red-700 hover:underline"
                          onClick={() => { if (confirm(`Удалить файл «${u.file_name}»? Рейсы экспедитора будут пересчитаны.`)) uploads.remove(u.id); }}>
                          удалить
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
