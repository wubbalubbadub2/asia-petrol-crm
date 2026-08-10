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
  is_void, is_superseded, line_count
`;

const LINE_SELECT = `
  id, line_no, snt_line_no, name, pin_code, source_lot_id, quantity, unit,
  net_weight, storage_unit, price, amount_net, amount, vat_amount
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
