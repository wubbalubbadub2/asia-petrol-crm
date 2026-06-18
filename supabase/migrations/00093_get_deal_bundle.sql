-- Объединённый загрузчик паспорта сделки (perf-аудит 2026-06-18, MAJOR #5).
--
-- /deals/[id] открывался семью параллельными запросами:
--   1) deals + 11 FK join'ов  (useDeal)
--   2) deal_supplier_lines + 2 join'а (useDealSupplierLines)
--   3) deal_buyer_lines + 2 join'а (useDealBuyerLines)
--   4) shipment_registry + deal_shipment_prices (useDealLineRollups)
--   5) deal_activity + profiles (useDealActivity)
--   6) deal_attachments × 4 секции (DocumentsSection mount × 4)
--   7) deal_shipment_prices (useDealTriggerPrices) — остаётся отдельным,
--      потому что нужен с фильтром по side и редким; в первый paint не
--      попадает (рендерится только если выбрано не-manual ценообразование).
--
-- HTTP/2 мультиплексирует, но каждый платит свой ~1.5s RTT во Frankfurt,
-- wall-clock = max. Сворачиваем в один round-trip RPC, возвращающий
-- единый JSONB-объект.
--
-- SECURITY INVOKER + GRANT EXECUTE TO authenticated: проверки RLS на
-- нижележащих таблицах продолжают работать. Если у пользователя нет
-- доступа к, скажем, deal_attachments — пустой массив, не ошибка.

CREATE OR REPLACE FUNCTION get_deal_bundle(p_deal_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    -- ─── Сделка + scalar joins (заменяет DEAL_SELECT из use-deals.ts) ─────
    'deal', (
      SELECT to_jsonb(d.*) || jsonb_build_object(
        'factory',                     (SELECT to_jsonb(x.*) FROM factories x WHERE x.id = d.factory_id),
        'fuel_type',                   (SELECT to_jsonb(x.*) FROM fuel_types x WHERE x.id = d.fuel_type_id),
        'supplier',                    (SELECT to_jsonb(x.*) FROM counterparties x WHERE x.id = d.supplier_id),
        'buyer',                       (SELECT to_jsonb(x.*) FROM counterparties x WHERE x.id = d.buyer_id),
        'forwarder',                   (SELECT to_jsonb(x.*) FROM forwarders x WHERE x.id = d.forwarder_id),
        'supplier_manager',            (SELECT to_jsonb(x.*) FROM profiles x WHERE x.id = d.supplier_manager_id),
        'buyer_manager',               (SELECT to_jsonb(x.*) FROM profiles x WHERE x.id = d.buyer_manager_id),
        'trader',                      (SELECT to_jsonb(x.*) FROM profiles x WHERE x.id = d.trader_id),
        'buyer_destination_station',   (SELECT to_jsonb(x.*) FROM stations x WHERE x.id = d.buyer_destination_station_id),
        'supplier_departure_station',  (SELECT to_jsonb(x.*) FROM stations x WHERE x.id = d.supplier_departure_station_id),
        'logistics_company_group',     (SELECT to_jsonb(x.*) FROM company_groups x WHERE x.id = d.logistics_company_group_id),
        'deal_company_groups', (
          SELECT COALESCE(jsonb_agg(
            to_jsonb(dcg.*) || jsonb_build_object(
              'company_group', (SELECT to_jsonb(cg.*) FROM company_groups cg WHERE cg.id = dcg.company_group_id)
            )
            ORDER BY dcg.position
          ), '[]'::jsonb)
          FROM deal_company_groups dcg WHERE dcg.deal_id = d.id
        ),
        -- Лёгкие id-only массивы — UI считает по ним «+N линий» (см.
        -- annotateLineCounts в use-deals.ts). Полные снимки лежат в
        -- supplier_lines / buyer_lines ниже.
        'supplier_lines', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object('id', sl.id)), '[]'::jsonb)
          FROM deal_supplier_lines sl WHERE sl.deal_id = d.id
        ),
        'buyer_lines', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object('id', bl.id)), '[]'::jsonb)
          FROM deal_buyer_lines bl WHERE bl.deal_id = d.id
        )
      )
      FROM deals d WHERE d.id = p_deal_id
    ),

    -- ─── Линии поставщика (заменяет SUPPLIER_SELECT из use-deal-lines.ts) ─
    'supplier_lines', (
      SELECT COALESCE(jsonb_agg(
        to_jsonb(sl.*) || jsonb_build_object(
          'quotation_type',    (SELECT to_jsonb(q.*) FROM quotation_product_types q WHERE q.id = sl.quotation_type_id),
          'departure_station', (SELECT to_jsonb(s.*) FROM stations s WHERE s.id = sl.departure_station_id)
        )
        -- Тот же sort, что и SUPPLIER_SELECT: дефолт сначала, затем position.
        ORDER BY sl.is_default DESC, sl.position
      ), '[]'::jsonb)
      FROM deal_supplier_lines sl WHERE sl.deal_id = p_deal_id
    ),

    -- ─── Линии покупателя ─────────────────────────────────────────────────
    'buyer_lines', (
      SELECT COALESCE(jsonb_agg(
        to_jsonb(bl.*) || jsonb_build_object(
          'quotation_type',      (SELECT to_jsonb(q.*) FROM quotation_product_types q WHERE q.id = bl.quotation_type_id),
          'destination_station', (SELECT to_jsonb(s.*) FROM stations s WHERE s.id = bl.destination_station_id)
        )
        ORDER BY bl.is_default DESC, bl.position
      ), '[]'::jsonb)
      FROM deal_buyer_lines bl WHERE bl.deal_id = p_deal_id
    ),

    -- ─── Сырьё для useDealLineRollups ─────────────────────────────────────
    -- Клиент сам агрегирует по supplier_line_id / buyer_line_id —
    -- pipe-through того же кода что и use-deal-lines.ts.
    'shipment_rollup_raw', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'supplier_line_id', sr.supplier_line_id,
        'buyer_line_id',    sr.buyer_line_id,
        'shipment_volume',  sr.shipment_volume,
        'loading_volume',   sr.loading_volume
      )), '[]'::jsonb)
      FROM shipment_registry sr WHERE sr.deal_id = p_deal_id
    ),
    'shipment_prices_raw', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'side',   dsp.side,
        'amount', dsp.amount,
        'shipment_registry', CASE WHEN sr.id IS NULL THEN NULL ELSE jsonb_build_object(
          'supplier_line_id', sr.supplier_line_id,
          'buyer_line_id',    sr.buyer_line_id
        ) END
      )), '[]'::jsonb)
      FROM deal_shipment_prices dsp
      LEFT JOIN shipment_registry sr ON sr.id = dsp.shipment_registry_id
      WHERE dsp.deal_id = p_deal_id
    ),

    -- ─── Вложения, сгруппированные по секции ──────────────────────────────
    -- DocumentsSection монтировался 4 раза и каждый раз делал свой
    -- запрос с .eq('section', …). Здесь группируем один раз; UI читает
    -- attachments[section].
    'attachments', (
      SELECT COALESCE(jsonb_object_agg(section, files), '{}'::jsonb)
      FROM (
        SELECT
          a.section,
          jsonb_agg(
            jsonb_build_object(
              'id',           a.id,
              'category',     a.category,
              'file_name',    a.file_name,
              'file_path',    a.file_path,
              'file_size',    a.file_size,
              'uploaded_at',  a.uploaded_at
            )
            ORDER BY a.uploaded_at DESC
          ) AS files
        FROM deal_attachments a
        WHERE a.deal_id = p_deal_id AND a.section IS NOT NULL
        GROUP BY a.section
      ) grouped
    ),

    -- ─── Активность (для первого paint; realtime подписка — в хуке) ───────
    -- useDealActivity сортирует ASC, поэтому возвращаем в том же
    -- порядке. Лимит 200 — чат-история редко выходит за это в одной
    -- сделке; если выходит — операторы скроллят и реалтайм-инсерты
    -- доливают свежее.
    'activity', (
      SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data->>'created_at')), '[]'::jsonb)
      FROM (
        SELECT to_jsonb(act.*) || jsonb_build_object(
          'user', (SELECT jsonb_build_object('full_name', p.full_name, 'role', p.role)
                   FROM profiles p WHERE p.id = act.user_id)
        ) AS row_data
        FROM deal_activity act
        WHERE act.deal_id = p_deal_id
        ORDER BY act.created_at DESC
        LIMIT 200
      ) sub
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- RLS на нижележащих таблицах продолжает работать через SECURITY INVOKER.
GRANT EXECUTE ON FUNCTION get_deal_bundle(UUID) TO authenticated;
