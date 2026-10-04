/**
 * Подстановки в форме «Заявки»: код станции из справочника станций и
 * ответственный менеджер по умолчанию.
 */

/**
 * Код станции из справочника годится для подстановки, только если это
 * код ЖД — 5–6 цифр («700204»). В справочнике встречается мусор вроде
 * «ст. Серхетабад» (название вместо кода) — такой не подставляем.
 */
export function usableStationCode(code: string | null | undefined): string | null {
  const c = (code ?? "").trim();
  return /^\d{5,6}$/.test(c) ? c : null;
}

/**
 * «Код станции» при выборе станции назначения: код новой станции, а если
 * у неё нет пригодного кода — то, что уже стоит в поле. Руками поле
 * можно поправить и после подстановки.
 */
export function stationCodeOnPick(
  current: string,
  stationCode: string | null | undefined,
): string {
  return usableStationCode(stationCode) ?? current;
}

/**
 * Ответственный менеджер новой заявки — текущий пользователь, если он
 * есть в списке менеджеров. Нет в списке — поле остаётся пустым.
 */
export function defaultManagerId(
  userId: string | null | undefined,
  managers: { id: string }[],
): string {
  if (!userId) return "";
  return managers.some((m) => m.id === userId) ? userId : "";
}
