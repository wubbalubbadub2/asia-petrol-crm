import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CollapsibleSection } from "@/components/deals/collapsible-section";

// Клиент 2026-09-30: «Выберите котировку… Покупатель» при свёрнутом
// «Покупателе» — поле с ошибкой было не найти. Форма раскрывает секцию
// сменой openSignal.
describe("CollapsibleSection — openSignal", () => {
  const view = (signal: number) => (
    <CollapsibleSection title="Покупатель" id="deal-new-buyer" openSignal={signal}>
      <span>поле котировки</span>
    </CollapsibleSection>
  );

  it("свёрнута по умолчанию, раскрывается при новом сигнале", () => {
    const { rerender, container } = render(view(0));
    expect(screen.queryByText("поле котировки")).toBeNull();
    expect(container.querySelector("#deal-new-buyer")).not.toBeNull();
    rerender(view(1));
    expect(screen.getByText("поле котировки")).toBeTruthy();
  });

  it("повторный сигнал раскрывает снова, если оператор свернул", () => {
    const { rerender } = render(view(0));
    rerender(view(1));
    expect(screen.getByText("поле котировки")).toBeTruthy();
    fireEvent.click(screen.getByText("Покупатель"));
    expect(screen.queryByText("поле котировки")).toBeNull();
    rerender(view(1));
    expect(screen.queryByText("поле котировки")).toBeNull();
    rerender(view(2));
    expect(screen.getByText("поле котировки")).toBeTruthy();
  });
});
