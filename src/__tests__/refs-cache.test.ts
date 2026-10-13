import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useMemo } from "react";

/**
 * Регрессия 2026-08-04: «Нет групп. Создайте в справочнике.»
 *
 * В справочнике 19 активных company_groups, но кнопка «Добавить группу»
 * в карточке сделки падала с тостом «Нет групп». Причина — кэш refs:
 * запрос, ушедший ДО восстановления сессии, получает от PostgREST
 * 200 [] (RLS `auth.uid() IS NOT NULL` просто не отдаёт строк, это НЕ
 * ошибка), и пустой результат оседал в модульном кэше. `useGlobalRefs`
 * читает кэш синхронно и не проверяет TTL, поэтому все выпадающие
 * списки оставались пустыми до полной перезагрузки страницы.
 */

type Row = Record<string, unknown>;
type Res = { data: Row[] | null; error: { message: string } | null };

let response: (table: string) => Res = () => ({ data: [], error: null });
let calls: string[] = [];
// Ленивые справочники в браузере приходят отдельным запросом, уже
// после первого рендера. В тесте их ответ держится за этим промисом.
const LAZY_TABLES = new Set(["quotation_product_types", "consignees", "delivery_bases"]);
let lazyGate: Promise<void> = Promise.resolve();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => {
      calls.push(table);
      const res = response(table);
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.order = chain;
      builder.then = (ok: (v: Res) => unknown, err?: (e: unknown) => unknown) =>
        (LAZY_TABLES.has(table) ? lazyGate.then(() => res) : Promise.resolve(res)).then(ok, err);
      return builder;
    },
  }),
}));

async function freshModule() {
  vi.resetModules();
  calls = [];
  return await import("@/lib/refs");
}

const GROUPS: Row[] = [{ id: "cg-1", name: "ОМИ", full_name: 'ОсОО "ОМИ"' }];
const withGroups = (t: string): Res => ({
  data: t === "company_groups" ? GROUPS : [],
  error: null,
});

beforeEach(() => {
  response = () => ({ data: [], error: null });
  lazyGate = Promise.resolve();
});

describe("кэш справочников", () => {
  it("не кэширует ответ, в котором все справочники пусты", async () => {
    const refs = await freshModule();
    const first = await refs.getGlobalRefs();
    expect(first.companyGroups).toHaveLength(0);
    // Пустой ответ = запрос без сессии либо недоступный PostgREST.
    // Кэшировать его нельзя, иначе списки мертвы до перезагрузки.
    expect(refs.getCachedRefsSync()).toBeNull();

    response = withGroups;
    const second = await refs.getGlobalRefs();
    expect(second.companyGroups).toHaveLength(1);
  });

  it("не кэширует ответ с ошибкой запроса", async () => {
    const refs = await freshModule();
    response = () => ({ data: null, error: { message: "PGRST301" } });
    await refs.getGlobalRefs();
    expect(refs.getCachedRefsSync()).toBeNull();

    response = withGroups;
    const second = await refs.getGlobalRefs();
    expect(second.companyGroups).toHaveLength(1);
  });

  it("кэширует нормальный ответ и не ходит в сеть повторно", async () => {
    const refs = await freshModule();
    response = withGroups;
    await refs.getGlobalRefs();
    expect(refs.getCachedRefsSync()?.companyGroups).toHaveLength(1);

    const before = calls.length;
    await refs.getGlobalRefs();
    expect(calls.length).toBe(before);
  });
});

describe("useGlobalRefs", () => {
  it("получает справочники после принудительного перезапроса, без перезагрузки страницы", async () => {
    const refs = await freshModule();
    // Сессия ещё не восстановлена — RLS отдаёт пустые списки.
    await refs.getGlobalRefs();
    const { result } = renderHook(() => refs.useGlobalRefs());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.refs.companyGroups).toHaveLength(0);

    // Кто-то на странице форсит перезапрос (кнопка «Добавить группу»).
    response = withGroups;
    refs.invalidateGlobalRefs();
    await refs.getGlobalRefs();

    await waitFor(() =>
      expect(result.current.refs.companyGroups).toHaveLength(1),
    );
  });
});

/**
 * Регрессия 2026-10-13: «KG 726 — не выбирается котировка».
 *
 * Карточка сделки, открытая по прямой ссылке или после F5, показывала
 * в «Котировка» и «Базис поставки» только «—». Типы котировок и базисы
 * грузятся лениво (getLazyRefs) и дописывались в уже отданный объект
 * кэша молча: подписчики useGlobalRefs не будились, а карточка
 * мемоизирует опции по ссылке на объект — и так и не видела списков.
 * Сеть при этом отдавала все 16 типов (проверено в проде, 200 OK).
 */
describe("ленивые справочники (котировки, базисы, грузополучатели)", () => {
  const QT: Row[] = [{ id: "qt-1", name: "МАЗУТ 3,5%" }];
  const DB: Row[] = [{ id: "db-1", name: "DAP" }];
  const withLazy = (t: string): Res => ({
    data: t === "company_groups" ? GROUPS
      : t === "quotation_product_types" ? QT
      : t === "delivery_bases" ? DB
      : [],
    error: null,
  });

  it("доезжают до компонента, который мемоизирует опции по ссылке на refs", async () => {
    const refs = await freshModule();
    response = withLazy;
    let releaseLazy!: () => void;
    lazyGate = new Promise<void>((r) => { releaseLazy = r; });
    // Так карточка сделки строит опции: useMemo(..., [globalRefs]).
    const { result } = renderHook(() => {
      const { refs: r } = refs.useGlobalRefs();
      return useMemo(() => ({
        quotationTypes: r.quotationTypes.map((x) => x.id),
        deliveryBases: r.deliveryBases.map((x) => x.id),
      }), [r]);
    });
    // Основные справочники пришли, карточка отрисовалась — котировок ещё нет.
    await waitFor(() => expect(refs.getCachedRefsSync()).not.toBeNull());
    expect(result.current.quotationTypes).toEqual([]);
    // Теперь приехал ленивый запрос.
    releaseLazy();
    await waitFor(() => expect(result.current.quotationTypes).toEqual(["qt-1"]));
    expect(result.current.deliveryBases).toEqual(["db-1"]);
  });

  it("лежат в синхронном кэше для следующей страницы", async () => {
    const refs = await freshModule();
    response = withLazy;
    await refs.getGlobalRefs();
    await waitFor(() => expect(refs.getCachedRefsSync()?.quotationTypes).toHaveLength(1));
    expect(refs.getCachedRefsSync()?.deliveryBases).toHaveLength(1);
  });
});
