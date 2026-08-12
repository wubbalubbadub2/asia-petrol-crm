-- 00146_appendix_completed.sql
--
-- Клиент 2026-08-12: «добавить галочку завершение приложения».
--
-- Приложение живёт на строке-варианте (00072), туда и ставим признак.
-- Пометка информационная: ничего не блокирует, не прячет и ни в какие
-- расчёты не входит. Если позже понадобится скрывать завершённые
-- приложения из выбора при заведении отгрузки — это отдельная задача,
-- молча такое поведение вводить нельзя.

ALTER TABLE deal_supplier_lines
  ADD COLUMN IF NOT EXISTS is_completed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE deal_buyer_lines
  ADD COLUMN IF NOT EXISTS is_completed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN deal_supplier_lines.is_completed IS
  'Приложение завершено. Информационная пометка, на расчёты и доступность не влияет.';
COMMENT ON COLUMN deal_buyer_lines.is_completed IS
  'Приложение завершено. Информационная пометка, на расчёты и доступность не влияет.';
