// Парсинг фидов нацбанков регулярками — фиды простые и стабильные,
// отдельная XML-зависимость не нужна.

/** KZT за 1 USD из фида НБ РК (get_rates.cfm). */
export function parseNbrkUsdKzt(xml: string): number {
  const m = xml.match(
    /<item>[\s\S]*?<title>\s*USD\s*<\/title>[\s\S]*?<description>\s*([\d.,]+)\s*<\/description>/i,
  );
  if (!m) throw new Error("НБ РК: курс USD не найден в фиде");
  const val = Number(m[1].replace(",", "."));
  if (!Number.isFinite(val) || val <= 0) throw new Error(`НБ РК: некорректный курс "${m[1]}"`);
  return val;
}

/** KGS за 1 USD из фида НБ КР (daily.xml), с учётом номинала. */
export function parseNbkrUsdKgs(xml: string): number {
  const m = xml.match(
    /<Currency\s+ISOCode="USD">\s*<Nominal>\s*(\d+)\s*<\/Nominal>\s*<Value>\s*([\d.,]+)\s*<\/Value>/i,
  );
  if (!m) throw new Error("НБ КР: курс USD не найден в фиде");
  const nominal = Number(m[1]) || 1;
  const value = Number(m[2].replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`НБ КР: некорректный курс "${m[2]}"`);
  return value / nominal;
}

/** DD.MM.YYYY (UTC) для параметра fdate НБ РК. */
export function formatKzDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}.${mm}.${yyyy}`;
}
