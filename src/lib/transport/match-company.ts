/**
 * Какой компании принадлежит файл бланка.
 *
 * Бланки приходят по-разному: наши собранные названы «Бланк заявки —
 * TENGRI WAY.docx», а присланные компаниями — «Заявка 390 тн
 * Тендык-Карабалта от Бетта Трейд от 31.07.docx». Общее у них только
 * то, что название компании где-то в имени есть.
 */

export type CompanyLike = { id: string; name: string };

/** Слова строки в нижнем регистре: разделители — всё, кроме букв и цифр. */
export function words(s: string): string[] {
  return s
    .normalize("NFC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
}

export type Match = { company: CompanyLike | null; reason: string };

/**
 * Считаем, сколько слов названия компании встречается в имени файла как
 * ОТДЕЛЬНЫЕ слова. Побеждает единственный лучший; делят счёт двое —
 * файл не берём.
 *
 * Почему по словам, а не подстрокой:
 *
 *   • «Бетта Трейд» попадает в имя целиком, а от «Singularity Trading»
 *     остаётся одно слово — «…Батуми Singularity»; поиск подстроки
 *     целиком тут не сработает;
 *   • «ОРТ» подстрокой находится внутри слова «транспортировки», и
 *     файл чужой компании уехал бы к ОРТ. Как отдельное слово — нет;
 *   • «Trading» есть и у Singularity Trading, и у Progressive oil
 *     trading: счёт делится, и мы честно отказываемся угадывать.
 */
export function matchCompany(fileName: string, companies: CompanyLike[]): Match {
  const base = fileName.replace(/\.[^.]+$/, "");
  const fileWords = new Set(words(base));

  const scored = companies
    .map((c) => ({ c, score: words(c.name).filter((w) => fileWords.has(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { company: null, reason: "названия компании в имени файла нет" };
  }
  if (scored.length > 1 && scored[0].score === scored[1].score) {
    const tied = scored.filter((x) => x.score === scored[0].score).map((x) => x.c.name);
    return { company: null, reason: `подходят несколько: ${tied.join(", ")}` };
  }
  return { company: scored[0].c, reason: "" };
}
