import { STATE_TONE_CLASS, stateTone } from "@/lib/fiscal/constants";

/**
 * Бейдж состояния документа.
 *
 * Показывает СИНОНИМ (`state_label`), цвет выбирает по КОДУ
 * (`state_code`). Если синоним не приехал — падаем на код, чтобы
 * ячейка не осталась пустой: пустую ячейку оператор прочитает как
 * «состояния нет», а это неправда — состояние есть, не приехала только
 * его человеческая подпись.
 */
export function FiscalStateBadge({
  code,
  label,
}: {
  code: string | null;
  label: string | null;
}) {
  const tone = stateTone(code);
  return (
    <span
      className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[11px] leading-tight ring-1 ring-inset ${STATE_TONE_CLASS[tone]}`}
      title={code ?? undefined}
    >
      {label ?? code ?? "—"}
    </span>
  );
}
