"use client";

import { useState, useEffect } from "react";
import { Archive, Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { useRole } from "@/lib/hooks/use-role";
import { toast } from "sonner";

type ArchiveYear = {
  id: string;
  year: number;
  archived_at: string;
  is_locked: boolean;
};

type YearStats = {
  year: number;
  dealCount: number;
  isArchived: boolean;
};

export default function ArchivePage() {
  const supabase = createClient();
  const { isAdmin } = useRole();
  const [archives, setArchives] = useState<ArchiveYear[]>([]);
  const [yearStats, setYearStats] = useState<YearStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [archiveYear, setArchiveYear] = useState(new Date().getFullYear() - 1);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [{ data: archiveData }, { data: deals }] = await Promise.all([
      supabase.from("archive_years").select("*").order("year", { ascending: false }),
      supabase.from("deals").select("year, is_archived"),
    ]);

    setArchives((archiveData ?? []) as ArchiveYear[]);

    // Compute year stats
    const yearMap: Record<number, { total: number; archived: number }> = {};
    for (const d of (deals ?? []) as { year: number; is_archived: boolean }[]) {
      if (!yearMap[d.year]) yearMap[d.year] = { total: 0, archived: 0 };
      yearMap[d.year].total++;
      if (d.is_archived) yearMap[d.year].archived++;
    }

    const archivedYears = new Set((archiveData ?? []).map((a: ArchiveYear) => a.year));
    const stats = Object.entries(yearMap)
      .map(([y, s]) => ({ year: Number(y), dealCount: s.total, isArchived: archivedYears.has(Number(y)) }))
      .sort((a, b) => b.year - a.year);

    setYearStats(stats);
    setLoading(false);
  }

  async function handleArchive() {
    if (!isAdmin) { toast.error("Только администратор может архивировать"); return; }
    setArchiving(true);

    // Archive all deals for that year
    const { error: dealError } = await supabase
      .from("deals")
      .update({ is_archived: true, archived_at: new Date().toISOString() })
      .eq("year", archiveYear)
      .eq("is_archived", false);

    if (dealError) { toast.error(`Ошибка: ${dealError.message}`); setArchiving(false); return; }

    // Create archive record
    const { error: archiveError } = await supabase
      .from("archive_years")
      .upsert({ year: archiveYear, is_locked: true });

    if (archiveError) { toast.error(`Ошибка: ${archiveError.message}`); }
    else { toast.success(`Год ${archiveYear} заархивирован`); }

    setArchiving(false);
    await loadData();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Архив</h1>

      {/* Archive action */}
      {isAdmin && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px]">Архивировать год</CardTitle>
          </CardHeader>
          <CardContent className="flex items-end gap-3">
            <div>
              <Label className="text-[12px] text-stone-500">Год</Label>
              <Input
                type="number"
                value={archiveYear}
                onChange={(e) => setArchiveYear(Number(e.target.value))}
                className="w-24 h-8 text-[13px]"
              />
            </div>
            <Button size="sm" onClick={handleArchive} disabled={archiving}>
              <Archive className="mr-1.5 h-3.5 w-3.5" />
              {archiving ? "Архивация..." : "Архивировать"}
            </Button>
            <p className="text-[11px] text-stone-400 ml-2">
              Все сделки за выбранный год станут доступны только для чтения
            </p>
          </CardContent>
        </Card>
      )}

      {/* Year stats */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка...</p>
      ) : yearStats.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Нет данных о сделках для архивации
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border border-stone-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow className="bg-stone-50">
                <TableHead className="text-[11px]">Год</TableHead>
                <TableHead className="text-[11px] text-right">Кол-во сделок</TableHead>
                <TableHead className="text-[11px] text-center">Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {yearStats.map((ys) => (
                <TableRow key={ys.year}>
                  <TableCell className="font-mono text-[13px] font-medium">{ys.year}</TableCell>
                  <TableCell className="text-right font-mono text-[12px] tabular-nums">{ys.dealCount}</TableCell>
                  <TableCell className="text-center">
                    {ys.isArchived ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-600">
                        <Lock className="h-3 w-3" />
                        Заархивирован
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] text-green-700">
                        <Unlock className="h-3 w-3" />
                        Активный
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
