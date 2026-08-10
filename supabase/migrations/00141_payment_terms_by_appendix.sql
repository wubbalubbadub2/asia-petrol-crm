-- 00141_payment_terms_by_appendix.sql
--
-- Клиент 2026-08-10 (ТЗ «Добавить при формировании сделки строку Условия
-- оплаты со стороны Поставщик/Покупатель» + файл-пример отчёта):
-- условия оплаты задаются в ДНЯХ и выбираются вручную ПО ПРИЛОЖЕНИЮ,
-- просрочка считается от даты входящего/исходящего СНТ с возможностью
-- выбора, минусовые значения выделяются красным.
--
-- ── Что уже было ─────────────────────────────────────────────────────
-- 00125 завела отсрочку НА СДЕЛКЕ по стороне:
--   {supplier,buyer}_deferral_days / _mode / _note / _planned_pay_date.
-- Плановая дата считалась только внутри Excel-выгрузки
-- (passport-detail-excel.ts): поставщик — от loading_date, покупатель —
-- от date. На экране её не было вообще.
--
-- ── Почему уровня сделки мало ────────────────────────────────────────
-- Клиент 2026-08-10: «просрочки могут быть у покупателя, он работает по
-- приложению, а сделка — это и покупатель, и поставщик, и логисты».
-- В файле-примере это видно прямо: у приложений одного и того же
-- контрагента «Таур Импекс ОсОО» сроки разные — 90 дней у одних, 14 у
-- других, и колонка так и названа «дата + 90/14».
--
-- Приложение живёт на строке-варианте (00072: «одна строка-вариант на
-- приложение по каждой стороне»), туда и кладём срок. Поля сделки из
-- 00125 остаются ЗАПАСНЫМ значением: строка без своего срока берёт
-- сделкин. Ни одна существующая настройка не теряется.
--
-- ── Выбор даты отсчёта ───────────────────────────────────────────────
-- Новое поле deferral_date_basis: 'loading' (входящее СНТ) либо
-- 'shipment' (исходящее СНТ). Умолчание сохраняет сегодняшнее поведение
-- экспортёра: поставщик — от входящего, покупатель — от исходящего.
-- Поэтому выгрузка passport-detail-excel обязана дать те же числа, что
-- и до миграции; на это есть тест.
--
-- Разделение объёмов по сторонам уже реализовано в 00059
-- (supplier → loading_volume, buyer → shipment_volume) и здесь только
-- переиспользуется — клиент подтвердил это правило 2026-08-10
-- («входящий объём — это когда с поставщика, исходящий — когда к
-- покупателю»).

-- =====================================================================
-- 1. Срок и базис отсчёта на приложении (строке-варианте)
-- =====================================================================

ALTER TABLE deal_supplier_lines
  ADD COLUMN IF NOT EXISTS deferral_days       INT,
  ADD COLUMN IF NOT EXISTS deferral_date_basis TEXT;

ALTER TABLE deal_buyer_lines
  ADD COLUMN IF NOT EXISTS deferral_days       INT,
  ADD COLUMN IF NOT EXISTS deferral_date_basis TEXT;

-- Базис на сделке — чтобы запасное значение тоже умело его выражать.
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS supplier_deferral_date_basis TEXT,
  ADD COLUMN IF NOT EXISTS buyer_deferral_date_basis    TEXT;

-- Ограничения ставим через DO, как в 00125: миграция должна оставаться
-- переприменяемой, а ADD CONSTRAINT IF NOT EXISTS в PostgreSQL нет.
DO $$
BEGIN
  ALTER TABLE deal_supplier_lines ADD CONSTRAINT deal_supplier_lines_deferral_basis_chk
    CHECK (deferral_date_basis IS NULL OR deferral_date_basis IN ('loading','shipment'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE deal_buyer_lines ADD CONSTRAINT deal_buyer_lines_deferral_basis_chk
    CHECK (deferral_date_basis IS NULL OR deferral_date_basis IN ('loading','shipment'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE deals ADD CONSTRAINT deals_supplier_deferral_basis_chk
    CHECK (supplier_deferral_date_basis IS NULL OR supplier_deferral_date_basis IN ('loading','shipment'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE deals ADD CONSTRAINT deals_buyer_deferral_basis_chk
    CHECK (buyer_deferral_date_basis IS NULL OR buyer_deferral_date_basis IN ('loading','shipment'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE deal_supplier_lines ADD CONSTRAINT deal_supplier_lines_deferral_days_chk
    CHECK (deferral_days IS NULL OR deferral_days >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE deal_buyer_lines ADD CONSTRAINT deal_buyer_lines_deferral_days_chk
    CHECK (deferral_days IS NULL OR deferral_days >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN deal_supplier_lines.deferral_days IS
  'Условия оплаты по приложению, календарных дней. NULL — берём deals.supplier_deferral_days (00125).';
COMMENT ON COLUMN deal_buyer_lines.deferral_days IS
  'Условия оплаты по приложению, календарных дней. NULL — берём deals.buyer_deferral_days (00125).';
COMMENT ON COLUMN deal_supplier_lines.deferral_date_basis IS
  'От какой даты СНТ считать: loading — входящее, shipment — исходящее. NULL → сделка → умолчание стороны (поставщик: loading).';
COMMENT ON COLUMN deal_buyer_lines.deferral_date_basis IS
  'От какой даты СНТ считать: loading — входящее, shipment — исходящее. NULL → сделка → умолчание стороны (покупатель: shipment).';

-- =====================================================================
-- 2. Атомарный слой: срок оплаты по каждой отгрузке и стороне
-- =====================================================================
--
-- Одна строка на пару (отгрузка, сторона). Сумма и объём берутся из
-- deal_shipment_prices — это СТОИМОСТЬ ТОВАРА. Брать
-- shipment_registry.shipped_tonnage_amount здесь нельзя: по 00031 это
-- CEIL(объём) × ж/д тариф, то есть логистика, а не товар.
--
-- «Сегодня» — обычный CURRENT_DATE, как в 00127. На Supabase это UTC,
-- поэтому в предутренние часы по местному времени значение может
-- отставать на день. Отдельного соглашения о часовом поясе в проекте
-- нет; заводить его в одной этой миграции — значит разойтись с 00127.

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
    -- Приложение: на строке реестра лежит денормализованная копия
    -- (00072), на строке-варианте — источник.
    CASE s.side WHEN 'supplier' THEN COALESCE(sr.supplier_appendix, sl.appendix)
                ELSE COALESCE(sr.buyer_appendix,  bl.appendix) END AS appendix,
    -- Срок: приложение важнее сделки.
    CASE s.side WHEN 'supplier' THEN COALESCE(sl.deferral_days, d.supplier_deferral_days)
                ELSE COALESCE(bl.deferral_days, d.buyer_deferral_days) END AS deferral_days,
    CASE s.side WHEN 'supplier'
         THEN COALESCE(sl.deferral_date_basis, d.supplier_deferral_date_basis, 'loading')
         ELSE COALESCE(bl.deferral_date_basis, d.buyer_deferral_date_basis,   'shipment') END AS date_basis,
    -- Режим и ручная дата остаются на сделке (00125).
    CASE s.side WHEN 'supplier' THEN d.supplier_deferral_mode ELSE d.buyer_deferral_mode END AS deferral_mode,
    CASE s.side WHEN 'supplier' THEN d.supplier_planned_pay_date ELSE d.buyer_planned_pay_date END AS manual_pay_date,
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
  SELECT b.*,
         CASE b.date_basis WHEN 'loading' THEN b.loading_date ELSE b.shipment_date END AS basis_date
  FROM base b
),
with_planned AS (
  SELECT w.*,
         CASE
           WHEN w.deferral_mode = 'other' THEN w.manual_pay_date
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
  p.deferral_days,
  p.date_basis,
  p.deferral_mode,
  p.basis_date,
  p.planned_pay_date,
  -- Плюс — время на оплату есть, минус — просрочка. Пустая дата СНТ или
  -- пустой срок дают NULL, а НЕ ноль: в исходном Excel клиента такие
  -- строки превращались в «30.03.1900» и «−46154» и висели как реальная
  -- просрочка.
  CASE WHEN p.planned_pay_date IS NULL THEN NULL
       ELSE p.planned_pay_date - CURRENT_DATE END AS days_to_pay,
  p.volume,
  p.amount
FROM with_planned p;

COMMENT ON VIEW deal_payment_terms IS
  'Срок оплаты по каждой отгрузке и стороне: приложение → срок в днях → плановая дата → дней до оплаты (минус = просрочка). Суммы — стоимость товара из deal_shipment_prices, не ж/д тариф.';

-- =====================================================================
-- 3. Отчёт: строка = сделка + приложение + дата СНТ
-- =====================================================================
--
-- Гранулярность взята из файла-примера клиента: объёмы в строках
-- 440–614 тонн, то есть 7–10 вагонов, а у сделки KG 157 две строки с
-- разными датами (20.03 и 27.03). Значит вагоны одной даты сложены —
-- что логично, у них общий срок оплаты.
--
-- САЛЬДО берём КАНОНИЧЕСКОЕ, а не пересчитываем:
--   deals.supplier_balance = отгружено − оплата (+ доп. расходы, когда
--     включён «Грузоотправитель в цене», 00052/00063/00112);
--   deals.buyer_debt       = оплата − отгружено (знак перевёрнут в 00060
--     по требованию клиента).
-- В отчёте нужна величина «сколько должны контрагенту», поэтому по
-- покупателю берём -buyer_debt. Своей формулы не заводим: иначе отчёт
-- разошёлся бы с паспортом и «Инкассацией» на сделках с доп. расходами.

CREATE OR REPLACE VIEW deal_payment_terms_report
WITH (security_invoker = true) AS
SELECT
  t.deal_id,
  t.side,
  d.deal_code,
  d.deal_type,
  d.year,
  d.month,
  d.is_archived,
  -- Контрагент — по стороне отчёта.
  CASE t.side WHEN 'supplier' THEN COALESCE(cs.short_name, cs.full_name)
              ELSE COALESCE(cb.short_name, cb.full_name) END AS counterparty_name,
  CASE t.side WHEN 'supplier' THEN d.supplier_id ELSE d.buyer_id END AS counterparty_id,
  COALESCE(cb.short_name, cb.full_name) AS buyer_name,
  ch.chain AS company_chain,
  t.appendix,
  t.basis_date,
  t.date_basis,
  t.deferral_days,
  t.planned_pay_date,
  t.days_to_pay,
  SUM(t.amount) AS shipped_amount,
  SUM(t.volume) AS shipped_volume,
  -- Цена по формуле клиента: сумма / объём. Может расходиться с
  -- deal_shipment_prices.calculated_price при скидке — это фактическая
  -- цена отгрузки, а не договорная ставка.
  SUM(t.amount) / NULLIF(SUM(t.volume), 0) AS price,
  -- Оплата и сальдо — по СДЕЛКЕ и стороне (клиент 2026-08-10: «сальдо по
  -- итогам»). Привязки оплаты к конкретной отгрузке в базе нет:
  -- у deal_payments есть только deal_id и side. Повторяются в каждой
  -- строке сделки; показывать их один раз — задача отчёта.
  CASE t.side WHEN 'supplier' THEN d.supplier_payment ELSE d.buyer_payment END AS deal_payment,
  CASE t.side WHEN 'supplier' THEN d.supplier_balance ELSE -d.buyer_debt END AS deal_saldo
FROM deal_payment_terms t
JOIN deals d ON d.id = t.deal_id
LEFT JOIN counterparties cs ON cs.id = d.supplier_id
LEFT JOIN counterparties cb ON cb.id = d.buyer_id
LEFT JOIN LATERAL (
  SELECT string_agg(cg.name, ' → ' ORDER BY dcg.position) AS chain
  FROM deal_company_groups dcg
  JOIN company_groups cg ON cg.id = dcg.company_group_id
  WHERE dcg.deal_id = d.id
) ch ON TRUE
-- Строки без отгрузки в отчёт не идут: пустая дата означает, что
-- события ещё не было. Именно они засоряли исходный файл клиента.
WHERE t.basis_date IS NOT NULL
GROUP BY
  t.deal_id, t.side, d.deal_code, d.deal_type, d.year, d.month, d.is_archived,
  d.supplier_id, d.buyer_id, cs.short_name, cs.full_name, cb.short_name, cb.full_name,
  ch.chain, t.appendix, t.basis_date, t.date_basis, t.deferral_days,
  t.planned_pay_date, t.days_to_pay,
  d.supplier_payment, d.buyer_payment, d.supplier_balance, d.buyer_debt;

COMMENT ON VIEW deal_payment_terms_report IS
  'Отчёт «Условия оплаты»: строка = сделка + приложение + дата СНТ. Сальдо и оплата — по сделке (канонические supplier_balance / -buyer_debt).';

-- =====================================================================
-- 4. Сводка по сделке — для колонки в паспорте
-- =====================================================================
--
-- Паспорт показывает строку на СДЕЛКУ, а срок живёт на приложении.
-- Поэтому сводка отвечает на три вопроса сразу:
--   • какие сроки действуют по стороне (их может быть несколько);
--   • сколько приложений на стороне — если ровно одно, паспорт может
--     править срок по месту, если больше, правка неоднозначна и нужна
--     карточка сделки;
--   • худшая просрочка по отгрузкам — она и красится красным.
--
-- Сроки считаем от СТРОК-ВАРИАНТОВ, а не от отгрузок: приложение с
-- условиями может существовать до первой отгрузки, и в паспорте это
-- должно быть видно. Просрочку — от отгрузок, её без даты СНТ нет.
--
-- deal_saldo здесь для правила клиента 2026-08-10: закрытое сальдо
-- гасит красный. На уровне отчёта группа — «контрагент + приложение»,
-- на уровне паспорта строка и есть сделка.

CREATE OR REPLACE VIEW deal_payment_terms_summary
WITH (security_invoker = true) AS
WITH ln AS (
  SELECT l.deal_id, 'supplier'::TEXT AS side, l.id AS line_id,
         COALESCE(l.deferral_days, d.supplier_deferral_days) AS eff_days
    FROM deal_supplier_lines l
    JOIN deals d ON d.id = l.deal_id
  UNION ALL
  SELECT l.deal_id, 'buyer'::TEXT, l.id,
         COALESCE(l.deferral_days, d.buyer_deferral_days)
    FROM deal_buyer_lines l
    JOIN deals d ON d.id = l.deal_id
),
ln_agg AS (
  SELECT deal_id, side,
         COUNT(*)::INT AS line_count,
         (array_agg(line_id ORDER BY line_id))[1] AS single_line_id,
         array_agg(DISTINCT eff_days) FILTER (WHERE eff_days IS NOT NULL) AS deferral_days_list
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
  -- Значим только когда line_count = 1: тогда паспорт знает, в какую
  -- строку-вариант писать правку.
  l.single_line_id,
  l.deferral_days_list,
  s.worst_days_to_pay,
  COALESCE(s.overdue_count, 0) AS overdue_count,
  CASE l.side WHEN 'supplier' THEN d.supplier_balance ELSE -d.buyer_debt END AS deal_saldo
FROM ln_agg l
JOIN deals d ON d.id = l.deal_id
LEFT JOIN sh_agg s ON s.deal_id = l.deal_id AND s.side = l.side;

COMMENT ON VIEW deal_payment_terms_summary IS
  'Сводка условий оплаты на сделку и сторону: действующие сроки, число приложений (1 → правка в паспорте возможна), худшая просрочка, каноническое сальдо.';

-- =====================================================================
-- 5. Гранты
-- =====================================================================
-- Порядок как в 00139: снимаем дефолтные гранты Supabase (их получает и
-- anon), возвращаем чтение только вошедшим. RLS базовых таблиц продолжает
-- действовать через security_invoker.

REVOKE ALL ON deal_payment_terms         FROM anon, authenticated;
REVOKE ALL ON deal_payment_terms_report  FROM anon, authenticated;
REVOKE ALL ON deal_payment_terms_summary FROM anon, authenticated;
GRANT SELECT ON deal_payment_terms         TO authenticated;
GRANT SELECT ON deal_payment_terms_report  TO authenticated;
GRANT SELECT ON deal_payment_terms_summary TO authenticated;
