/**
 * Порядок названий в выпадающих списках справочников (клиент 2026-09-30):
 * «по алфавиту, сначала английские, потом русские».
 *
 * Сортировка базы (`.order("name")`) не годится: коллация en_US ставит
 * латиницу и кириллицу как попало относительно регистра, а поставщики
 * сортировались по полному имени («ТОО "…"»), хотя в списке видно
 * краткое. `localeCompare(…, "ru")` ставит кириллицу ПЕРЕД латиницей.
 *
 * Правило: сначала названия с цифры, потом на латинице, потом на
 * кириллице; внутри — по алфавиту без учёта регистра и кавычек.
 */
const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true, ignorePunctuation: true });

function scriptRank(name: string): number {
  const first = name.match(/[\p{L}\p{N}]/u)?.[0];
  if (first == null) return 3;
  if (/\p{N}/u.test(first)) return 0;
  if (/\p{Script=Latin}/u.test(first)) return 1;
  if (/\p{Script=Cyrillic}/u.test(first)) return 2;
  return 3;
}

export function compareNames(a: string | null | undefined, b: string | null | undefined): number {
  const x = (a ?? "").trim();
  const y = (b ?? "").trim();
  return scriptRank(x) - scriptRank(y) || collator.compare(x, y);
}

/** Копия массива, отсортированная по названию, которое видит пользователь. */
export function sortByName<T>(items: readonly T[], name: (item: T) => string | null | undefined): T[] {
  return [...items].sort((a, b) => compareNames(name(a), name(b)));
}
