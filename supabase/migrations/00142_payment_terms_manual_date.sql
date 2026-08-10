-- 00142_payment_terms_manual_date.sql
--
-- Клиент 2026-08-10, уточнение к 00141: «нужно дать такой выбор — от
-- даты отгрузки (тут дата тянется автоматом) или ввести дату самому, и
-- дальше менеджер сам вводит дату». И повторно: «без даты входящего и
-- даты исходящего СНТ».
--
-- В 00141 выбор был между двумя автоматическими вариантами — входящее
-- или исходящее СНТ. Клиент это отклонил: вариантов должно быть ровно
-- два, «автоматом» и «вручную». Какая именно дата берётся автоматом,
-- система решает сама по стороне — это уже установленное правило
-- (клиент 2026-08-10): «входящий объём — это когда с поставщика,
-- исходящий — когда к покупателю». Значит и дата отгрузки у поставщика
-- — входящее СНТ, у покупателя — исходящее. Выбирать тут нечего.
--
-- Значения deferral_date_basis: 'auto' | 'manual'. NULL по-прежнему
-- означает «взять со сделки», а если и там пусто — 'auto'.
--
-- Значения 'loading' / 'shipment' из 00141 в проде никто выставить не
-- успел (возможность появилась в тот же день и до интерфейса не
-- дошла), поэтому ограничение переписываем без миграции данных.

-- =====================================================================
-- 1. Ручная дата на приложении + два допустимых варианта отсчёта
-- =====================================================================

ALTER TABLE deal_supplier_lines
  ADD COLUMN IF NOT EXISTS deferral_planned_date DATE;
ALTER TABLE deal_buyer_lines
  ADD COLUMN IF NOT EXISTS deferral_planned_date DATE;

ALTER TABLE deal_supplier_lines DROP CONSTRAINT IF EXISTS deal_supplier_lines_deferral_basis_chk;
ALTER TABLE deal_buyer_lines    DROP CONSTRAINT IF EXISTS deal_buyer_lines_deferral_basis_chk;
ALTER TABLE deals               DROP CONSTRAINT IF EXISTS deals_supplier_deferral_basis_chk;
ALTER TABLE deals               DROP CONSTRAINT IF EXISTS deals_buyer_deferral_basis_chk;

-- Подстраховка на случай, если 'loading'/'shipment' всё же где-то
-- проставились между 00141 и 00142: приводим к 'auto', смысл тот же.
UPDATE deal_supplier_lines SET deferral_date_basis = 'auto'
 WHERE deferral_date_basis IN ('loading','shipment');
UPDATE deal_buyer_lines    SET deferral_date_basis = 'auto'
 WHERE deferral_date_basis IN ('loading','shipment');
UPDATE deals SET supplier_deferral_date_basis = 'auto'
 WHERE supplier_deferral_date_basis IN ('loading','shipment');
UPDATE deals SET buyer_deferral_date_basis = 'auto'
 WHERE buyer_deferral_date_basis IN ('loading','shipment');

ALTER TABLE deal_supplier_lines ADD CONSTRAINT deal_supplier_lines_deferral_basis_chk
  CHECK (deferral_date_basis IS NULL OR deferral_date_basis IN ('auto','manual'));
ALTER TABLE deal_buyer_lines ADD CONSTRAINT deal_buyer_lines_deferral_basis_chk
  CHECK (deferral_date_basis IS NULL OR deferral_date_basis IN ('auto','manual'));
ALTER TABLE deals ADD CONSTRAINT deals_supplier_deferral_basis_chk
  CHECK (supplier_deferral_date_basis IS NULL OR supplier_deferral_date_basis IN ('auto','manual'));
ALTER TABLE deals ADD CONSTRAINT deals_buyer_deferral_basis_chk
  CHECK (buyer_deferral_date_basis IS NULL OR buyer_deferral_date_basis IN ('auto','manual'));

COMMENT ON COLUMN deal_supplier_lines.deferral_date_basis IS
  'auto — считать от даты отгрузки (у поставщика это входящее СНТ), manual — плановую дату ставит менеджер. NULL → значение сделки → auto.';
COMMENT ON COLUMN deal_buyer_lines.deferral_date_basis IS
  'auto — считать от даты отгрузки (у покупателя это исходящее СНТ), manual — плановую дату ставит менеджер. NULL → значение сделки → auto.';
COMMENT ON COLUMN deal_supplier_lines.deferral_planned_date IS
  'Плановая дата оплаты, введённая вручную по приложению. Работает при deferral_date_basis = manual.';
COMMENT ON COLUMN deal_buyer_lines.deferral_planned_date IS
  'Плановая дата оплаты, введённая вручную по приложению. Работает при deferral_date_basis = manual.';

-- =====================================================================
-- 2. Пересборка расчёта
-- =====================================================================
-- Состав и порядок колонок не меняются, поэтому CREATE OR REPLACE не
-- ломает зависящее от него deal_payment_terms_report.
--
-- basis_date = дата отгрузки стороны. Она нужна всегда, даже в ручном
-- режиме: это «Дата отгрузки» в отчёте и ключ группировки строк.
-- Считать от неё в ручном режиме ничего не будем.

CREATE OR REPLACE VIEW deal_payment_terms
WITH (security_invoker = true) AS
WITH sides AS (
  SELECT unnest(ARRAY['supplier','buyer']) AS side
),
base AS (
  SELECT
    sr.id      AS shipment_id,
    sr.deal_id,
    s.side,
    sr.wagon_number,
    sr.loading_date,
    sr.date    AS shipment_date,
    CASE s.side WHEN 'supplier' THEN sr.supplier_line_id ELSE sr.buyer_line_id END AS line_id,
    CASE s.side WHEN 'supplier' THEN COALESCE(sr.supplier_appendix, sl.appendix)
                ELSE COALESCE(sr.buyer_appendix,  bl.appendix) END AS appendix,
    CASE s.side WHEN 'supplier' THEN COALESCE(sl.deferral_days, d.supplier_deferral_days)
                ELSE COALESCE(bl.deferral_days, d.buyer_deferral_days) END AS deferral_days,
    CASE s.side WHEN 'supplier'
         THEN COALESCE(sl.deferral_date_basis, d.supplier_deferral_date_basis, 'auto')
         ELSE COALESCE(bl.deferral_date_basis, d.buyer_deferral_date_basis,   'auto') END AS date_basis,
    CASE s.side WHEN 'supplier' THEN d.supplier_deferral_mode ELSE d.buyer_deferral_mode END AS deferral_mode,
    CASE s.side WHEN 'supplier' THEN d.supplier_planned_pay_date ELSE d.buyer_planned_pay_date END AS manual_pay_date,
    CASE s.side WHEN 'supplier' THEN sl.deferral_planned_date ELSE bl.deferral_planned_date END AS line_manual_date,
    dsp.volume,
    dsp.amount
  FROM shipment_registry sr
  CROSS JOIN sides s
  JOIN deals d ON d.id = sr.deal_id
  LEFT JOIN deal_supplier_lines  sl  ON s.side = 'supplier' AND sl.id = sr.supplier_line_id
  LEFT JOIN deal_buyer_lines     bl  ON s.side = 'buyer'    AND bl.id = sr.buyer_line_id
  LEFT JOIN deal_shipment_prices dsp ON dsp.shipment_registry_id = sr.id AND dsp.side = s.side
),
with_basis AS (
  -- Дата отгрузки стороны: у поставщика приход (входящее СНТ), у
  -- покупателя отгрузка (исходящее). Правило клиента 2026-08-10,
  -- то же, по которому уже разведены объёмы в 00059.
  SELECT b.*,
         CASE b.side WHEN 'supplier' THEN b.loading_date ELSE b.shipment_date END AS basis_date
  FROM base b
),
with_planned AS (
  SELECT w.*,
         CASE
           WHEN w.date_basis = 'manual'    THEN COALESCE(w.line_manual_date, w.manual_pay_date)
           WHEN w.deferral_mode = 'other'  THEN w.manual_pay_date
           WHEN w.basis_date IS NULL OR w.deferral_days IS NULL THEN NULL
           ELSE w.basis_date + w.deferral_days
         END AS planned_pay_date
  FROM with_basis w
)
SELECT
  p.shipment_id,
  p.deal_id,
  p.side,
  p.wagon_number,
  p.appendix,
  p.line_id,
  -- При ручной дате срок в днях не имеет смысла и не показывается.
  CASE WHEN p.date_basis = 'manual' THEN NULL ELSE p.deferral_days END AS deferral_days,
  p.date_basis,
  p.deferral_mode,
  p.basis_date,
  p.planned_pay_date,
  CASE WHEN p.planned_pay_date IS NULL THEN NULL
       ELSE p.planned_pay_date - CURRENT_DATE END AS days_to_pay,
  p.volume,
  p.amount
FROM with_planned p;

-- =====================================================================
-- 3. Сводка для паспорта — добавлен признак ручной даты
-- =====================================================================

DROP VIEW IF EXISTS deal_payment_terms_summary;

CREATE VIEW deal_payment_terms_summary
WITH (security_invoker = true) AS
WITH ln AS (
  SELECT l.deal_id, 'supplier'::TEXT AS side, l.id AS line_id,
         COALESCE(l.deferral_days, d.supplier_deferral_days) AS eff_days,
         COALESCE(l.deferral_date_basis, d.supplier_deferral_date_basis, 'auto') AS eff_basis
    FROM deal_supplier_lines l
    JOIN deals d ON d.id = l.deal_id
  UNION ALL
  SELECT l.deal_id, 'buyer'::TEXT, l.id,
         COALESCE(l.deferral_days, d.buyer_deferral_days),
         COALESCE(l.deferral_date_basis, d.buyer_deferral_date_basis, 'auto')
    FROM deal_buyer_lines l
    JOIN deals d ON d.id = l.deal_id
),
ln_agg AS (
  SELECT deal_id, side,
         COUNT(*)::INT AS line_count,
         (array_agg(line_id ORDER BY line_id))[1] AS single_line_id,
         array_agg(DISTINCT eff_days) FILTER (WHERE eff_days IS NOT NULL AND eff_basis <> 'manual') AS deferral_days_list,
         bool_or(eff_basis = 'manual') AS has_manual_date
    FROM ln
   GROUP BY deal_id, side
),
sh_agg AS (
  SELECT deal_id, side,
         MIN(days_to_pay) AS worst_days_to_pay,
         COUNT(*) FILTER (WHERE days_to_pay < 0)::INT AS overdue_count
    FROM deal_payment_terms
   WHERE days_to_pay IS NOT NULL
   GROUP BY deal_id, side
)
SELECT
  l.deal_id,
  l.side,
  l.line_count,
  l.single_line_id,
  l.deferral_days_list,
  COALESCE(l.has_manual_date, FALSE) AS has_manual_date,
  s.worst_days_to_pay,
  COALESCE(s.overdue_count, 0) AS overdue_count,
  CASE l.side WHEN 'supplier' THEN d.supplier_balance ELSE -d.buyer_debt END AS deal_saldo
FROM ln_agg l
JOIN deals d ON d.id = l.deal_id
LEFT JOIN sh_agg s ON s.deal_id = l.deal_id AND s.side = l.side;

COMMENT ON VIEW deal_payment_terms_summary IS
  'Сводка условий оплаты на сделку и сторону: сроки, число приложений (1 → правка в паспорте возможна), признак ручной даты, худшая просрочка, каноническое сальдо.';

REVOKE ALL ON deal_payment_terms_summary FROM anon, authenticated;
GRANT SELECT ON deal_payment_terms_summary TO authenticated;
