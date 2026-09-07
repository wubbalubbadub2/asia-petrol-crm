/**
 * Выборка справочника «Заводы».
 *
 * Между factories и stations ДВЕ связи: stations.default_factory_id
 * (миграция 00022, «завод по умолчанию» у станции) и
 * factories.departure_station_id (00154, «станция отправления» завода).
 * PostgREST не встраивает `stations(...)` без указания ключа — падает с
 * «more than one relationship was found» (прод 2026-09-07). Ключ назван
 * явно, как у станций (`factories!default_factory_id`).
 */
export const FACTORIES_LIST_SELECT =
  "id, name, code, departure_station_id, " +
  "departure_station:stations!departure_station_id(name, code), is_active";
