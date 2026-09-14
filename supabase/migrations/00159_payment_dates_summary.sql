-- 00159_payment_dates_summary.sql
--
-- Клиент 2026-09-14 (скриншот паспорта): «при вводе оплаты мы вводим
-- дату тоже, их нужно показывать. Со стороны поставщика и покупателя».
--
-- Что не так сейчас. В паспорте колонка «Дата оплаты» читает
-- deals.supplier_payment_date — РУЧНОЕ поле, которое операторы не
-- заполняют, потому что оплаты заводят строками в deal_payments, и дата
-- лежит там, на строке. Отсюда «оплата 225 248 864,800 стоит, а дата
-- пустая». У покупателя колонки нет вовсе. Показательно, что детальная
-- выгрузка в Excel уже берёт дату правильно — из оплаты
-- (passport-detail-excel.ts, readShip → s.supPay.payment_date), а экран
-- нет.
--
-- Что делает миграция. Добавляет вью со сводкой ФАКТИЧЕСКИХ дат оплат
-- по сделке и стороне. Отбор строк повторяет refresh_deal_payment_totals
-- (00145) один в один, чтобы дата и сумма в соседних колонках говорили
-- об одних и тех же записях:
--   • payment_type = 'payment' — после 00147 возврат это минусовая
--     оплата того же типа, а взаимозачёты живут в своей колонке и в
--     «Оплату» не входят;
--   • валюта записи либо не указана, либо совпадает с валютой стороны.
-- Из-за CHECK в 00145 (payment_date IS NOT NULL OR payment_type =
-- 'offset') у отобранных строк дата всегда есть.
--
-- Ручное поле deals.{supplier,buyer}_payment_date НЕ трогаем и не
-- удаляем: клиент выбрал «фактическая дата с ручным переопределением»,
-- поэтому оно остаётся как override и продолжает править карточка сделки.
--
-- Схему не меняет, данные не трогает: только SELECT поверх deal_payments.
-- RLS действует через security_invoker, как у соседних вью 00141/00142.
--
-- Rollback: DROP VIEW deal_payment_dates_summary; экран вернётся к
-- показу только ручного поля, данные не пострадают.

CREATE OR REPLACE VIEW deal_payment_dates_summary
WITH (security_invoker = true) AS
SELECT
  p.deal_id,
  p.side,
  COUNT(*)::INT                                      AS payment_count,
  MIN(p.payment_date)                                AS first_date,
  MAX(p.payment_date)                                AS last_date,
  ARRAY_AGG(p.payment_date ORDER BY p.payment_date)  AS dates
FROM deal_payments p
JOIN deals d ON d.id = p.deal_id
WHERE p.payment_type = 'payment'
  AND (
    p.currency IS NULL
    OR p.currency = CASE p.side
                      WHEN 'supplier' THEN d.supplier_currency
                      ELSE d.buyer_currency
                    END
  )
GROUP BY p.deal_id, p.side;

COMMENT ON VIEW deal_payment_dates_summary IS
  'Даты фактических оплат по сделке и стороне для колонки «Дата оплаты» в паспорте. Отбор строк совпадает с refresh_deal_payment_totals (00145): payment_type = payment, валюта стороны. Ручное поле deals.*_payment_date — отдельный override, здесь его нет.';

REVOKE ALL ON deal_payment_dates_summary FROM anon, authenticated;
GRANT SELECT ON deal_payment_dates_summary TO authenticated;
