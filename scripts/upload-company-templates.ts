#!/usr/bin/env node
/**
 * Загрузка бланков компаний в CRM пачкой.
 *
 *   npx tsx scripts/upload-company-templates.ts <папка с .docx> [ещё папка] [--apply]
 *
 * Без `--apply` ничего не пишет: показывает, какой файл какой компании
 * достанется и пройдёт ли он проверку. Это не перестраховка — файл
 * привязывается к компании по её названию внутри имени файла («…от
 * Бетта Трейд от 31.07.docx»), и ошибиться тут легко. Сначала посмотрите
 * разбор, потом запускайте с `--apply`.
 *
 * ДОСТУП. Скрипт ходит в Supabase сервисным ключом: загрузка бланков
 * закрыта правом администратора (00153), а интерактивного входа у
 * консольного скрипта нет. Ключ берётся из окружения или из `.env.local`
 * и никуда не пишется:
 *
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * ПРОВЕРКА БЛАНКА — та же, что в интерфейсе: `inspectTemplate`. Файл без
 * обязательных строк не загружается, о недостающих необязательных
 * скрипт предупреждает.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import { inspectTemplate } from "../src/lib/transport/fill-template";
import { TEMPLATE_ROWS } from "../src/lib/transport/template-rows";
import { matchCompany, type CompanyLike } from "../src/lib/transport/match-company";

const TEMPLATE_BUCKET = "transport-templates";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

if (existsSync(".env.local")) loadEnv({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Положите их в .env.local или передайте в команде:");
  console.error('  NEXT_PUBLIC_SUPABASE_URL="…" SUPABASE_SERVICE_ROLE_KEY="…" \\');
  console.error('    npx tsx scripts/upload-company-templates.ts "<папка>" --apply');
  process.exit(2);
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dirs = args.filter((a) => !a.startsWith("--"));

if (dirs.length === 0) {
  console.error("Укажите хотя бы одну папку с файлами .docx");
  process.exit(2);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: companies, error } = await sb
    .from("company_groups")
    .select("id, name")
    .eq("is_active", true);
  if (error) throw new Error(`Не удалось прочитать компании: ${error.message}`);

  const list = (companies ?? []) as CompanyLike[];
  console.log(`Компаний в справочнике: ${list.length}`);
  console.log(apply ? "Режим: ЗАГРУЗКА\n" : "Режим: разбор без записи (добавьте --apply)\n");

  const files: string[] = [];
  for (const dir of dirs) {
    for (const f of readdirSync(dir)) {
      if (extname(f).toLowerCase() === ".docx" && !f.startsWith("~$")) files.push(join(dir, f));
    }
  }

  let ok = 0;
  let skipped = 0;

  for (const file of files) {
    const name = basename(file);
    const { company, reason } = matchCompany(name, list);

    if (!company) {
      console.log(`✗  ${name}\n   компания не опознана: ${reason}`);
      skipped++;
      continue;
    }

    const bytes = new Uint8Array(readFileSync(file));
    const info = await inspectTemplate(bytes);

    if (info.missingRequired.length > 0) {
      console.log(
        `✗  ${name} → ${company.name}\n   нет обязательных строк: ${info.missingRequired.join(", ")}`,
      );
      skipped++;
      continue;
    }

    const notes: string[] = [];
    if (info.missing.length) notes.push(`не заполнятся: ${info.missing.join(", ")}`);
    if (info.extra.length) notes.push(`останутся как есть: ${info.extra.join(", ")}`);
    if (!info.hasDateLine) notes.push("строки с датой нет — дату придётся ставить вручную");

    console.log(
      `✓  ${name} → ${company.name}\n   строк ${info.found.length}/${TEMPLATE_ROWS.length}` +
        (notes.length ? `; ${notes.join("; ")}` : ""),
    );

    if (!apply) continue;

    const stamp = Date.now();
    const path = `${company.id}/${stamp}.docx`;

    const { error: upErr } = await sb.storage
      .from(TEMPLATE_BUCKET)
      .upload(path, bytes, { contentType: DOCX_MIME, upsert: false });
    if (upErr) {
      console.log(`   ОШИБКА загрузки файла: ${upErr.message}`);
      skipped++;
      continue;
    }

    // Прежний бланк уходит в историю ДО вставки нового: активный может
    // быть только один, иначе частичный уникальный индекс отклонит.
    const { error: offErr } = await sb
      .from("transport_company_templates")
      .update({ is_active: false })
      .eq("company_group_id", company.id)
      .eq("is_active", true);
    if (offErr) {
      console.log(`   ОШИБКА снятия прежнего бланка: ${offErr.message}`);
      skipped++;
      continue;
    }

    const { error: insErr } = await sb.from("transport_company_templates").insert({
      company_group_id: company.id,
      file_path: path,
      original_name: name,
      is_active: true,
    });
    if (insErr) {
      console.log(`   ОШИБКА записи: ${insErr.message}`);
      skipped++;
      continue;
    }

    console.log("   загружен и сделан активным");
    ok++;
  }

  console.log(`\nФайлов: ${files.length}, ${apply ? `загружено ${ok}` : "к загрузке готовы"}, пропущено ${skipped}`);
  if (!apply) console.log("Ничего не записано. Повторите с --apply.");
}

main().catch((e) => {
  console.error(`Сорвалось: ${(e as Error).message}`);
  process.exit(1);
});
