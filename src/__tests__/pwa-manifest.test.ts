import { describe, it, expect } from "vitest";
import manifest from "@/app/manifest";

/**
 * Манифест — единственное, что делает приложение устанавливаемым.
 * Проверяем поля, без которых браузер не предложит установку:
 * name, start_url, display: standalone и иконки 192 + 512.
 */
describe("PWA-манифест", () => {
  const m = manifest();

  it("имя и режим отображения заданы", () => {
    expect(m.name).toBe("Singularity Trading CRM");
    expect(m.short_name).toBe("Singularity");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.lang).toBe("ru");
  });

  it("цвета совпадают с интерфейсом", () => {
    expect(m.theme_color).toBe("#f59e0b");
    expect(m.background_color).toBe("#fafaf9");
  });

  it("есть иконки 192 и 512, включая маскируемую", () => {
    const sizes = (m.icons ?? []).map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    const maskable = (m.icons ?? []).filter((i) => i.purpose === "maskable");
    expect(maskable.length).toBeGreaterThan(0);
  });

  it("ориентация не зафиксирована — планшет должен уметь альбомную", () => {
    expect(m.orientation).toBeUndefined();
  });
});
