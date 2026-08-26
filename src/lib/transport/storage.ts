import { createClient } from "@/lib/supabase/client";

/**
 * Файлы заявок на перевозку в Supabase Storage.
 *
 * Бакеты закрытые: в бланках лежат подпись и печать компании. Оба
 * заведены руками в дашборде (как `deal-attachments`) — миграциями
 * storage в этом проекте не управляется, иначе джоба CI, где схемы
 * `storage` нет, падала бы на ровном месте.
 */

export const TEMPLATE_BUCKET = "transport-templates";
export const FILES_BUCKET = "transport-request-files";

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Путь бланка: папка на компанию, метка времени в имени.
 *
 * Старые версии остаются: заявка, отправленная в марте, и через год
 * должна открываться на том бланке, на котором её отправляли, — поэтому
 * файл не перезаписывается, а кладётся рядом.
 */
export function templatePath(companyGroupId: string, stampMs: number): string {
  return `${companyGroupId}/${stampMs}.docx`;
}

export function requestFilePath(requestId: string, stampMs: number, ext: "docx" | "pdf"): string {
  return `${requestId}/${stampMs}.${ext}`;
}

/** Скачать бланк компании. Возвращает байты для заполнения. */
export async function downloadTemplate(path: string): Promise<Uint8Array> {
  const sb = createClient();
  const { data, error } = await sb.storage.from(TEMPLATE_BUCKET).download(path);
  if (error) throw new Error(`Не удалось получить бланк компании: ${error.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

/** Загрузить бланк. Возвращает путь, под которым он лёг. */
export async function uploadTemplate(
  companyGroupId: string,
  file: Blob,
  stampMs: number,
): Promise<string> {
  const sb = createClient();
  const path = templatePath(companyGroupId, stampMs);
  const { error } = await sb.storage
    .from(TEMPLATE_BUCKET)
    .upload(path, file, { contentType: DOCX_MIME, upsert: false });
  if (error) throw new Error(`Не удалось загрузить бланк: ${error.message}`);
  return path;
}

/**
 * Сохранить сформированный документ рядом с заявкой.
 *
 * Клиент 25.08: файлы храним, чтобы было видно, какой именно документ
 * ушёл контрагенту. Ошибка загрузки НЕ должна ронять выгрузку: файл у
 * менеджера на руках уже есть, а история — дело второе.
 */
export async function saveRequestFile(opts: {
  requestId: string;
  kind: "docx" | "pdf";
  blob: Blob;
  fileName: string;
  stampMs: number;
}): Promise<void> {
  const sb = createClient();
  const path = requestFilePath(opts.requestId, opts.stampMs, opts.kind);

  const { error: upErr } = await sb.storage
    .from(FILES_BUCKET)
    .upload(path, opts.blob, {
      contentType: opts.kind === "docx" ? DOCX_MIME : "application/pdf",
      upsert: false,
    });
  if (upErr) throw new Error(upErr.message);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = sb as any;
  const { error } = await db.from("transport_request_files").insert({
    request_id: opts.requestId,
    kind: opts.kind === "docx" ? "word" : "pdf",
    file_path: path,
    original_name: opts.fileName,
  });
  if (error) throw new Error(error.message);
}

/** Ссылка на сохранённый файл — короткоживущая, бакет закрытый. */
export async function signedFileUrl(path: string, seconds = 60): Promise<string> {
  const sb = createClient();
  const { data, error } = await sb.storage.from(FILES_BUCKET).createSignedUrl(path, seconds);
  if (error || !data) throw new Error(error?.message ?? "Не удалось получить ссылку");
  return data.signedUrl;
}

/** Отдать файл пользователю — тот же приём, что у выгрузок в Excel. */
export function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
