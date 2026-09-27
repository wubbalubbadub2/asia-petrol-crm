/**
 * Строки представлений миграции 00174. `database.ts` генерируется из
 * прода и про новые таблицы узнает только после `npm run types:db` —
 * до этого описываем строки руками.
 */

export type StayKind = "loading" | "unloading";
export type ProtocolStatus = "ok" | "none" | "ambiguous";

/** Строка `rail_demurrage`: стоянка + протокол + сутки + сумма. */
export type DemurrageRow = {
  stay_key: string;
  forwarder_id: string;
  forwarder_name: string;
  wagon_number: string;
  stay_kind: StayKind;
  station_id: string | null;
  station_name: string | null;
  arrival_waybill_number: string | null;
  computed_arrival: string | null;
  computed_departure: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  end_date: string | null;
  is_final: boolean;
  has_override: boolean;
  arrival_override_reason: string | null;
  departure_override_reason: string | null;
  needs_check: boolean;
  check_reason: string | null;
  loaded_waybill_number: string | null;
  loaded_waybill_date: string | null;
  cargo_name: string | null;
  deal_id: string | null;
  deal_code: string | null;
  company_group_name: string | null;
  protocol_id: string | null;
  protocol_number: string | null;
  protocol_status: ProtocolStatus;
  demurrage_rate: number | null;
  currency: string | null;
  norm_days: number | null;
  total_days: number | null;
  overage_days: number | null;
  amount: number | null;
};

/** Строка `rail_demurrage_registry`: гружёный рейс × месяц. */
export type RegistryRow = {
  forwarder_id: string;
  forwarder_name: string;
  wagon_number: string;
  loaded_waybill_number: string | null;
  loaded_waybill_date: string | null;
  departure_station_id: string | null;
  destination_station_id: string | null;
  departure_station_name: string | null;
  destination_station_name: string | null;
  cargo_name: string | null;
  company_group_name: string | null;
  deal_code: string | null;
  loading_key: string | null;
  unloading_key: string | null;
  loading_arrival: string | null;
  loading_departure: string | null;
  unloading_arrival: string | null;
  unloading_departure: string | null;
  loading_norm: number | null;
  unloading_norm: number | null;
  rate: number | null;
  currency: string | null;
  unloading_final: boolean;
  needs_check: boolean;
  month: string;
  loading_overage_days: number;
  unloading_overage_days: number;
  amount: number;
};

/** Строка `rail_dislocation_snapshots` — для ленты вагона. */
export type SnapshotRow = {
  id: string;
  upload_id: string;
  forwarder_id: string;
  snapshot_at: string;
  wagon_number: string;
  departure_station: string | null;
  current_station: string | null;
  destination_station: string | null;
  waybill_number: string | null;
  waybill_date: string | null;
  last_operation_at: string | null;
  operation_code: string | null;
  operation_name: string | null;
  load_state: string | null;
  idle_at_station: number | null;
};

export type UploadListRow = {
  id: string;
  forwarder_id: string;
  snapshot_at: string;
  file_name: string;
  row_count: number;
  created_at: string;
  forwarders: { name: string } | null;
};

export type ProtocolRoute = {
  id?: string;
  position: number;
  departure_station_id: string;
  destination_station_id: string;
  fuel_type_id: string | null;
  loading_norm_days: number;
  unloading_norm_days: number;
  railway_tariff_per_ton: number | null;
  operator_rate_per_ton: number | null;
  forwarding_fee_per_ton: number | null;
};

export type Protocol = {
  id?: string;
  forwarder_id: string;
  company_group_id: string | null;
  number: string;
  protocol_date: string | null;
  valid_from: string;
  valid_to: string | null;
  demurrage_rate: number;
  currency: string;
  rate_includes_vat: boolean;
  arrival_day_counts: boolean;
  partial_day_counts_full: boolean;
  note: string | null;
  routes: ProtocolRoute[];
};
