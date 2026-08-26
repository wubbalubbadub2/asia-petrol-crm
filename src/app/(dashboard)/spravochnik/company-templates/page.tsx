"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/role-context";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatDMYTime } from "@/lib/format";
import { inspectTemplate } from "@/lib/transport/fill-template";
import { uploadTemplate } from "@/lib/transport/storage";
import { TEMPLATE_ROWS } from "@/lib/transport/template-rows";

/**
 * Бланки компаний для заявок на перевозку.
 *
 * Компания присылает свой `.docx` с шапкой, подписью и печатью, а строки
 * таблицы называет так, как задали мы. При загрузке файл РАЗБИРАЕТСЯ и
 * сверяется с контрактом: не хватает строки — бланк не принимается и
 * система называет, какой именно. Иначе заявка ушла бы контрагенту с
 * молча незаполненным полем.
 *
 * Активный бланк у компании ровно один (частичный уникальный индекс в
 * 00153), предыдущие остаются в истории: заявка, отправленная в марте,
 * и через год должна открываться на своём бланке.
 */

type Company = { id: string; name: string };
type Template = {
  id: string;
  company_group_id: string;
  original_name: string | null;
  created_at: string;
};

export default function CompanyTemplatesPage() {
  const { isAdmin } = useRole();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [templates, setTemplates] = useState<Record<string, Template>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pendingCompany = useRef<string | null>(null);
  const sbRef = useRef(createClient());

  const load = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = sbRef.current as any;
    const [co, tpl] = await Promise.all([
      sb.from("company_groups").select("id, name").eq("is_active", true).order("name"),
      sb
        .from("transport_company_templates")
        .select("id, company_group_id, original_name, created_at")
        .eq("is_active", true),
    ]);
    if (co.error || tpl.error) {
      toast.error(`Ошибка загрузки: ${(co.error ?? tpl.error).message}`);
    } else {
      setCompanies(co.data as Company[]);
      const map: Record<string, Template> = {};
      for (const t of tpl.data as Template[]) map[t.company_group_id] = t;
      setTemplates(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function pickFile(companyId: string) {
    pendingCompany.current = companyId;
    inputRef.current?.click();
  }

  async function handleFile(file: File) {
    const companyId = pendingCompany.current;
    pendingCompany.current = null;
    if (!companyId) return;

    setBusy(companyId);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());

      // ── Проверка бланка до загрузки ──
      const info = await inspectTemplate(bytes);
      if (info.missing.length > 0) {
        toast.error(
          `Бланк не принят: не нашлись строки — ${info.missing.join("; ")}. ` +
            "Названия строк менять нельзя: по ним система заполняет заявку.",
          { duration: 15000 },
        );
        return;
      }
      if (!info.hasDateLine) {
        toast.error("Бланк не принят: нет строки «Заявка от …» над таблицей", {
          duration: 12000,
        });
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = sbRef.current as any;
      const stamp = Date.now();
      const path = await uploadTemplate(companyId, file, stamp);

      // Прежний бланк уходит в историю ДО вставки нового: активный
      // может быть только один, иначе индекс отклонит вставку.
      const { error: offErr } = await sb
        .from("transport_company_templates")
        .update({ is_active: false })
        .eq("company_group_id", companyId)
        .eq("is_active", true);
      if (offErr) throw offErr;

      const { error } = await sb.from("transport_company_templates").insert({
        company_group_id: companyId,
        file_path: path,
        original_name: file.name,
        is_active: true,
      });
      if (error) throw error;

      toast.success(`Бланк принят: все ${TEMPLATE_ROWS.length} строк на месте`);
      await load();
    } catch (e) {
      toast.error(`Не удалось загрузить бланк: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Бланки компаний</h1>
        <a href="/templates/zayavka-template.docx" download>
          <Button variant="outline" size="sm">
            <Download className="mr-1 h-3.5 w-3.5" />
            Скачать эталонный бланк
          </Button>
        </a>
      </div>

      <div className="max-w-3xl space-y-2 text-[13px] text-muted-foreground">
        <p>
          Отправьте компании эталонный бланк. Она вставляет в него свою шапку, подпись и
          печать и возвращает файл — его и загружаем сюда.
        </p>
        <p>
          Строки таблицы переименовывать и удалять нельзя: по ним система понимает, куда
          подставлять значения. При загрузке файл проверяется, и недостающие строки
          называются поимённо.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".docx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) handleFile(f);
        }}
      />

      {loading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          Загрузка...
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Компания</TableHead>
                <TableHead>Бланк</TableHead>
                <TableHead className="w-44">Загружен</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((c) => {
                const t = templates[c.id];
                return (
                  <TableRow key={c.id}>
                    <TableCell className="text-[13px] font-medium">{c.name}</TableCell>
                    <TableCell className="text-[13px]">
                      {t ? (
                        <span className="inline-flex items-center gap-1.5 text-green-700">
                          <Check className="h-3.5 w-3.5" />
                          {t.original_name ?? "бланк загружен"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-amber-700">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          нет бланка — заявку не сформировать
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">
                      {t ? formatDMYTime(t.created_at) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7"
                        disabled={!isAdmin || busy === c.id}
                        onClick={() => pickFile(c.id)}
                        title={isAdmin ? undefined : "Бланки загружает администратор"}
                      >
                        {busy === c.id ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="mr-1 h-3.5 w-3.5" />
                        )}
                        {t ? "Заменить" : "Загрузить"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
