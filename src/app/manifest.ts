import type { MetadataRoute } from "next";

/**
 * Манифест отдаётся Next как маршрут /manifest.webmanifest — отдельный
 * файл в public/ не нужен.
 *
 * orientation НЕ задаём намеренно: мобильный режим включается только
 * уже 768px, а на планшете альбомная ориентация — основной сценарий.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Singularity Trading CRM",
    short_name: "Singularity",
    description: "CRM и управление сделками Singularity Trading",
    lang: "ru",
    display: "standalone",
    start_url: "/",
    theme_color: "#f59e0b",
    background_color: "#fafaf9",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
