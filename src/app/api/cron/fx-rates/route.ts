// src/app/api/cron/fx-rates/route.ts
// Тонкая обёртка Vercel Cron над портируемым ядром ingestDailyRates.
// При переезде с Vercel меняется ТОЛЬКО этот файл + расписание.
import { type NextRequest } from "next/server";
import { ingestDailyRates } from "@/lib/fx/ingest";

export const runtime = "nodejs";      // ядру нужен service-role клиент
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  // Vercel Cron шлёт `Authorization: Bearer <CRON_SECRET>`.
  if (secret && auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const result = await ingestDailyRates();
    return Response.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
