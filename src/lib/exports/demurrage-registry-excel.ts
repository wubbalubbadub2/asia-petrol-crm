/**
 * Выгрузка реестра сверхнормативов в Excel (формат PTC, колонки A–R +
 * сверочные). Ячейки собирает `buildRegistrySheetRows`; здесь только книга.
 */
import type { RegistryRow } from "@/lib/dislocation/types";
import { buildRegistrySheetRows, REGISTRY_HEADERS } from "@/lib/dislocation/registry-export";

const DATE_COLUMNS = [6, 7, 8, 9]; // F–I, 1-based
const WIDTHS = [26, 18, 18, 22, 11, 12, 12, 12, 12, 10, 10, 10, 11, 11, 9, 11, 30, 8, 13, 13, 10];

export async function exportDemurrageRegistry(rows: RegistryRow[], month: string): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Лист1");

  ws.addRow([...REGISTRY_HEADERS]);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { wrapText: true, vertical: "middle" };

  const body = buildRegistrySheetRows(rows);
  for (const cells of body) ws.addRow(cells);

  const last = body.length + 1;
  const total = ws.addRow([]);
  total.getCell(1).value = "Итого";
  total.getCell(13).value = { formula: `SUM(M2:M${last})` };
  total.getCell(14).value = { formula: `SUM(N2:N${last})` };
  total.getCell(15).value = { formula: `SUM(O2:O${last})` };
  total.getCell(16).value = { formula: `SUM(P2:P${last})` };
  total.font = { bold: true };

  WIDTHS.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  for (const c of DATE_COLUMNS) ws.getColumn(c).numFmt = "dd.mm.yyyy";
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `сверхнормативы-${month.slice(0, 7)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
