import { describe, it, expect } from "vitest";
import { isStaleChunkError } from "@/lib/chunk-error";

// Клиент 25.08.2026 при клике «Excel» получил
// «Не удалось экспортировать: Failed to load chunk
//  /_next/static/chunks/06fzrtmu_rcv~.js from module 26030».
//
// Проверено на проде: все 18 чанков текущего деплоя отдают 200, а этот —
// 404, то есть он из предыдущей сборки. Вкладка была открыта до выката,
// хеши чанков сменились, и динамический import() выгрузки не нашёл файл.
// Сервис-воркера на проде нет, кэшировать было некому.

describe("устаревший чанк после деплоя", () => {
  it("узнаёт сообщение, которое видел клиент", () => {
    expect(isStaleChunkError(
      new Error("Failed to load chunk /_next/static/chunks/06fzrtmu_rcv~.js from module 26030"),
    )).toBe(true);
  });

  it("узнаёт остальные формулировки загрузчиков", () => {
    const chunkErr = new Error("boom");
    chunkErr.name = "ChunkLoadError";
    for (const e of [
      chunkErr,
      new Error("Loading chunk 482 failed."),
      new TypeError("Failed to fetch dynamically imported module: https://x/_next/static/chunks/a.js"),
      new TypeError("error loading dynamically imported module"),
      new Error("Importing a module script failed."),
    ]) {
      expect(isStaleChunkError(e)).toBe(true);
    }
  });

  it("не перехватывает обычные ошибки выгрузки", () => {
    for (const e of [
      new Error("permission denied for table shipment_registry"),
      new Error("Failed to fetch"),
      new Error("JWT expired"),
      null,
      undefined,
      "строка вместо ошибки",
    ]) {
      expect(isStaleChunkError(e)).toBe(false);
    }
  });
});
