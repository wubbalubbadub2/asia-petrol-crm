"use client";

import { useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { fetchAllPaginated } from "@/lib/supabase/fetch-all";
import type { FiscalLine } from "@/lib/fiscal/group-positions";

/** Карточка документа: шапка, строки и обе стороны цепочки исправлений. */

export type FiscalDocumentDetail = {
  id: string;
  source_org_code: string;
  doc_kind: string;
  registration_number: string;
  doc_number_display: string | null;
  registration_date: string;
  issue_date: string | null;
  shipment_date: string | null;
  direction_code: string;
  doc_type_code: string;
  doc_type_label: string | null;
  status_code: string;
  status_label: string | null;
  state_code: string;
  state_label: string | null;
  operation_kind_code: string | null;
  operation_kind_label: string | null;
  own_party_name: string | null;
  own_party_role_code: string | null;
  counterparty_identifier: string | null;
  counterparty_name: string | null;
  counterparty_role_code: string | null;
  total_amount: number | null;
  currency_code: string;
  fx_rate: number;
  related_registration_number: string | null;
  related_snt_registration_number: string | null;
  is_void: boolean;
  is_superseded: boolean;
  line_count: number;

  // ── Поля печатного бланка (00143) ────────────────────────────────
  // Раздел A
  import_kind: string | null;
  export_kind: string | null;
  movement_kind: string | null;
  has_ethyl_alcohol: boolean | null;
  has_wine_material: boolean | null;
  has_beer: boolean | null;
  has_alcohol: boolean | null;
  has_oil_products: boolean | null;
  has_biofuel: boolean | null;
  has_tobacco: boolean | null;
  has_marked_goods: boolean | null;
  has_export_control: boolean | null;
  // Раздел B
  supplier_identifier: string | null;
  supplier_name: string | null;
  supplier_is_nonresident: boolean | null;
  supplier_branch_bin: string | null;
  supplier_country_code: string | null;
  supplier_ship_country_code: string | null;
  supplier_address: string | null;
  supplier_warehouse_id: string | null;
  supplier_warehouse_name: string | null;
  // Раздел C
  recipient_identifier: string | null;
  recipient_name: string | null;
  recipient_is_nonresident: boolean | null;
  recipient_branch_bin: string | null;
  recipient_country_code: string | null;
  recipient_delivery_country_code: string | null;
  recipient_address: string | null;
  recipient_warehouse_id: string | null;
  recipient_warehouse_name: string | null;
  recipient_is_retailer: boolean | null;
  // Раздел D
  shipper_identifier: string | null;
  shipper_name: string | null;
  shipper_country_code: string | null;
  shipper_is_nonresident: boolean | null;
  shipper_note: string | null;
  consignee_identifier: string | null;
  consignee_name: string | null;
  consignee_country_code: string | null;
  consignee_is_nonresident: boolean | null;
  consignee_note: string | null;
  // Раздел E
  carrier_name: string | null;
  carrier_identifier: string | null;
  transport_road: boolean | null;
  transport_rail: boolean | null;
  transport_air: boolean | null;
  transport_sea: boolean | null;
  transport_pipeline: boolean | null;
  transport_other: boolean | null;
  vehicle_number: string | null;
  trailer_number: string | null;
  wagon_number: string | null;
  seal_number: string | null;
  // Раздел F
  contract_number: string | null;
  contract_date: string | null;
  contract_text: string | null;
  contract_registry_number: string | null;
  payment_terms: string | null;
  delivery_terms: string | null;
  without_contract: boolean | null;
  // Разделы L, M, N
  issued_by_name: string | null;
  signature_type: string | null;
  author: string | null;
  accepted_at: string | null;
  accepted_by_identifier: string | null;
  accepted_by_name: string | null;
  revoked_at: string | null;
  proxy_release_number: string | null;
  proxy_release_date: string | null;
  proxy_receipt_number: string | null;
  proxy_receipt_date: string | null;
  driver_name: string | null;
  driver_iin: string | null;
  ogd_code_dispatch: string | null;
  ogd_code_delivery: string | null;
  // Служебное 1С
  source_doc_basis: string | null;
  source_doc_number: string | null;
  source_ref: string | null;
  source_identifier: string | null;
  source_organization: string | null;
  status_note: string | null;
  matching_status: string | null;
  extra_tables: Record<string, Record<string, unknown>[]> | null;
};

/** Ссылка на соседа по цепочке. null — документа нет в базе. */
export type FiscalLink = { id: string; registration_number: string; doc_number_display: string | null } | null;

const DETAIL_SELECT = `
  id, source_org_code, doc_kind, registration_number, doc_number_display,
  registration_date, issue_date, shipment_date, direction_code,
  doc_type_code, doc_type_label, status_code, status_label,
  state_code, state_label, operation_kind_code, operation_kind_label,
  own_party_name, own_party_role_code, counterparty_identifier,
  counterparty_name, counterparty_role_code, total_amount, currency_code,
  fx_rate, related_registration_number, related_snt_registration_number,
  is_void, is_superseded, line_count,
  import_kind, export_kind, movement_kind,
  has_ethyl_alcohol, has_wine_material, has_beer, has_alcohol,
  has_oil_products, has_biofuel, has_tobacco, has_marked_goods, has_export_control,
  supplier_identifier, supplier_name, supplier_is_nonresident, supplier_branch_bin,
  supplier_country_code, supplier_ship_country_code, supplier_address,
  supplier_warehouse_id, supplier_warehouse_name,
  recipient_identifier, recipient_name, recipient_is_nonresident, recipient_branch_bin,
  recipient_country_code, recipient_delivery_country_code, recipient_address,
  recipient_warehouse_id, recipient_warehouse_name, recipient_is_retailer,
  shipper_identifier, shipper_name, shipper_country_code, shipper_is_nonresident, shipper_note,
  consignee_identifier, consignee_name, consignee_country_code, consignee_is_nonresident, consignee_note,
  carrier_name, carrier_identifier, transport_road, transport_rail, transport_air,
  transport_sea, transport_pipeline, transport_other,
  vehicle_number, trailer_number, wagon_number, seal_number,
  contract_number, contract_date, contract_text, contract_registry_number,
  payment_terms, delivery_terms, without_contract,
  issued_by_name, signature_type, author, accepted_at, accepted_by_identifier,
  accepted_by_name, revoked_at, proxy_release_number, proxy_release_date,
  proxy_receipt_number, proxy_receipt_date, driver_name, driver_iin,
  ogd_code_dispatch, ogd_code_delivery,
  source_doc_basis, source_doc_number, source_ref, source_identifier,
  source_organization, status_note, matching_status, extra_tables
`;

const LINE_SELECT = `
  id, line_no, snt_line_no, name, pin_code, source_lot_id, quantity, unit,
  net_weight, storage_unit, price, amount_net, amount, vat_amount,
  origin_sign, tnved_code, unit_code, product_identifier, vat_rate, vat_rate_percent,
  without_vat, excise_rate, excise_rate_amount, excise_amount,
  product_1c_name, origin_source, declaration_number, declaration_position,
  product_name_eaeu, extra_info
`;

export function useFiscalDocument(id: string) {
  const sb = useRef(createClient());
  const [doc, setDoc] = useState<FiscalDocumentDetail | null>(null);
  const [lines, setLines] = useState<FiscalLine[]>([]);
  /** Документ, который исправляет ЭТОТ. */
  const [corrects, setCorrects] = useState<FiscalLink>(null);
  /** Документ, который исправляет этот — обратная сторона цепочки. */
  const [correctedBy, setCorrectedBy] = useState<FiscalLink>(null);
  /** У ЭСФ — связанная СНТ. */
  const [relatedSnt, setRelatedSnt] = useState<FiscalLink>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const client = sb.current;

    const run = async () => {
      setLoading(true);
      setError(null);

      const { data: head, error: headErr } = await client
        .from("fiscal_document")
        .select(DETAIL_SELECT)
        .eq("id", id)
        .maybeSingle();

      if (cancelled) return;
      if (headErr) {
        setError(headErr.message);
        setLoading(false);
        return;
      }
      if (!head) {
        setError("Документ не найден");
        setLoading(false);
        return;
      }
      setDoc(head as FiscalDocumentDetail);

      // Строки тянутся с постраничным добиранием: у одного боевого СНТ
      // их 88, но верхней границы у табличной части 1С нет.
      const { data: lineRows } = await fetchAllPaginated<FiscalLine>((from, to) =>
        client
          .from("fiscal_document_line")
          .select(LINE_SELECT)
          .eq("document_id", id)
          .order("line_no")
          .range(from, to),
      );
      if (cancelled) return;
      setLines(lineRows);

      // Обе стороны цепочки ищутся по ключу (организация, вид, номер) —
      // тому же, которым документ опознаётся при загрузке.
      const linkSelect = "id, registration_number, doc_number_display";
      const h = head as FiscalDocumentDetail;

      const [fwd, back, snt] = await Promise.all([
        h.related_registration_number
          ? client.from("fiscal_document").select(linkSelect)
              .eq("source_org_code", h.source_org_code)
              .eq("doc_kind", h.doc_kind)
              .eq("registration_number", h.related_registration_number)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        client.from("fiscal_document").select(linkSelect)
          .eq("source_org_code", h.source_org_code)
          .eq("doc_kind", h.doc_kind)
          .eq("related_registration_number", h.registration_number)
          .maybeSingle(),
        h.related_snt_registration_number
          ? client.from("fiscal_document").select(linkSelect)
              .eq("source_org_code", h.source_org_code)
              .eq("doc_kind", "snt")
              .eq("registration_number", h.related_snt_registration_number)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      if (cancelled) return;
      setCorrects((fwd.data ?? null) as FiscalLink);
      setCorrectedBy((back.data ?? null) as FiscalLink);
      setRelatedSnt((snt.data ?? null) as FiscalLink);
      setLoading(false);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return { doc, lines, corrects, correctedBy, relatedSnt, loading, error };
}
