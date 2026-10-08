/**
 * Подпись «Приложение» у варианта цены для выбора в реестре.
 *
 * У большинства сделок один вариант, и его поле «Приложение» пустое:
 * номер приложения менеджеры пишут в самой сделке («Номер приложения»).
 * Реестр при показе строки уже подставляет его вместо пустого
 * (effSupplierAppendix в registry/page.tsx) — здесь то же правило для
 * выбора варианта, иначе выбор «по приложению» просто не показывался
 * (клиент 2026-10-08: «опять нету выбора по приложению»).
 *
 * Правило: подпись варианта → у основного варианта номер приложения
 * сделки → «(без приложения)».
 */
export type LineForAppendix = { appendix: string | null; is_default: boolean };

export const NO_APPENDIX = "(без приложения)";

export function effectiveAppendix(line: LineForAppendix, dealContract: string | null | undefined): string | null {
  const own = (line.appendix ?? "").trim();
  if (own) return own;
  const deal = (dealContract ?? "").trim();
  return line.is_default && deal ? deal : null;
}

export function appendixLabel(line: LineForAppendix, dealContract: string | null | undefined): string {
  return effectiveAppendix(line, dealContract) ?? NO_APPENDIX;
}

/** Уникальные подписи для быстрого выбора по приложению на обеих сторонах. */
export function appendixOptions(
  supplierLines: LineForAppendix[], supplierContract: string | null | undefined,
  buyerLines: LineForAppendix[], buyerContract: string | null | undefined,
): string[] {
  const s = new Set<string>();
  for (const l of supplierLines) { const a = effectiveAppendix(l, supplierContract); if (a) s.add(a); }
  for (const l of buyerLines) { const a = effectiveAppendix(l, buyerContract); if (a) s.add(a); }
  return [...s].sort((a, b) => a.localeCompare(b, "ru"));
}
