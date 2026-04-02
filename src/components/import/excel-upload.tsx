"use client";

import { useState, useRef } from "react";
import { Upload, FileSpreadsheet, X, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type ExcelUploadProps = {
  onDataParsed: (rows: Record<string, unknown>[]) => void;
  accept?: string;
};

export function ExcelUpload({ onDataParsed, accept = ".xlsx,.xls,.csv" }: ExcelUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(f: File) {
    setFile(f);
    setParsing(true);

    try {
      // Dynamic import of xlsx library
      const XLSX = await import("xlsx");
      const buffer = await f.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const firstSheet = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheet];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: null });

      if (jsonData.length === 0) {
        toast.error("Файл пуст или формат не распознан");
        setParsing(false);
        return;
      }

      toast.success(`Распознано ${jsonData.length} строк из "${firstSheet}"`);
      onDataParsed(jsonData as Record<string, unknown>[]);
    } catch (err) {
      toast.error(`Ошибка чтения файла: ${(err as Error).message}`);
    }
    setParsing(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      className="rounded-lg border-2 border-dashed border-stone-300 bg-stone-50/50 p-8 text-center transition-colors hover:border-amber-400 hover:bg-amber-50/30"
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        className="hidden"
      />
      {file ? (
        <div className="space-y-2">
          <FileSpreadsheet className="h-8 w-8 text-green-600 mx-auto" />
          <p className="text-[13px] font-medium text-stone-700">{file.name}</p>
          <p className="text-[11px] text-stone-400">
            {(file.size / 1024).toFixed(0)} KB
          </p>
          {parsing ? (
            <p className="text-[12px] text-amber-600">Обработка...</p>
          ) : (
            <div className="flex gap-2 justify-center">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setFile(null);
                  if (inputRef.current) inputRef.current.value = "";
                }}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Убрать
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => inputRef.current?.click()}
              >
                Загрузить другой
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <Upload className="h-8 w-8 text-stone-400 mx-auto" />
          <p className="text-[13px] text-stone-600">
            Перетащите Excel файл или{" "}
            <button
              onClick={() => inputRef.current?.click()}
              className="text-amber-600 font-medium hover:underline"
            >
              выберите файл
            </button>
          </p>
          <p className="text-[11px] text-stone-400">.xlsx, .xls, .csv</p>
        </div>
      )}
    </div>
  );
}
