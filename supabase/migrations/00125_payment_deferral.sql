-- 00125_payment_deferral.sql
-- Условия оплаты (отсрочка) для отчёта «Паспорт (долги)». Клиент 2026-07-21:
-- отсрочка задаётся на сделке по стороне (2 приложения — продавец/покупатель).
-- Режим 'shipment' = «с даты отгрузки» (плановая дата = дата СНТ + дни,
-- считается в экспортере); 'other' = «прочее» (ручная плановая дата + заметка).
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS supplier_deferral_days    INT,
  ADD COLUMN IF NOT EXISTS supplier_deferral_mode    TEXT,
  ADD COLUMN IF NOT EXISTS supplier_deferral_note    TEXT,
  ADD COLUMN IF NOT EXISTS supplier_planned_pay_date DATE,
  ADD COLUMN IF NOT EXISTS buyer_deferral_days       INT,
  ADD COLUMN IF NOT EXISTS buyer_deferral_mode       TEXT,
  ADD COLUMN IF NOT EXISTS buyer_deferral_note       TEXT,
  ADD COLUMN IF NOT EXISTS buyer_planned_pay_date    DATE;

DO $$
BEGIN
  ALTER TABLE deals ADD CONSTRAINT deals_supplier_deferral_mode_chk
    CHECK (supplier_deferral_mode IS NULL OR supplier_deferral_mode IN ('shipment','other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE deals ADD CONSTRAINT deals_buyer_deferral_mode_chk
    CHECK (buyer_deferral_mode IS NULL OR buyer_deferral_mode IN ('shipment','other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
