// Генерация иконок PWA из public/pwa-icon.svg.
// Запуск: node scripts/generate-pwa-icons.mjs
//
// Маскируемая иконка рисуется с полями: Android обрезает её в круг,
// и знак без отступов потеряет края. Безопасная зона — центральные
// 80% холста, поэтому знак ужимается до 320 из 512.
import sharp from "sharp";
import { readFileSync } from "node:fs";

const svg = readFileSync("public/pwa-icon.svg");

await sharp(svg).resize(192, 192).png().toFile("public/icon-192.png");
await sharp(svg).resize(512, 512).png().toFile("public/icon-512.png");
await sharp(svg).resize(180, 180).png().toFile("public/apple-touch-icon.png");

await sharp({
  create: { width: 512, height: 512, channels: 4, background: "#d97706" },
})
  .composite([{ input: await sharp(svg).resize(320, 320).png().toBuffer(), gravity: "centre" }])
  .png()
  .toFile("public/icon-maskable-512.png");

console.log("Иконки PWA сгенерированы в public/");
