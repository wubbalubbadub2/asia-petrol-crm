-- 00156_transport_request_extras.sql
--
-- Поля, которых не хватило настоящим бланкам, и несколько оплат по ЖД.
--
-- Разбор пяти реальных заявок 26.08.2026 показал, что бланки у компаний
-- разные и модель заявки уже́ их формы:
--
--   • у Singularity (план ГУ, экспорт в Батуми) есть «Страна
--     назначения» и «Порт» — маршрут уходит за пределы КЗХ;
--   • у ОМИ есть «Номера вагонов-цистерн» — перечень номеров;
--   • у ОМИ период указан ДИАПАЗОНОМ: «Август-сентябрь 2026 г.»;
--   • у Singularity в «Экспедитор по ЖД» ЧЕТЫРЕ оплаты, а не две:
--     КЗХ, РЖД, АЗЖД и ГРЖД, у каждой свой плательщик и код.
--
-- Клиент 27.08.2026 подтвердил: поля заводить, диапазон нужен, оплаты
-- «дать возможность добавления нескольких».

ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS destination_country TEXT;
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS port TEXT;
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS wagon_numbers TEXT;
ALTER TABLE transport_requests ADD COLUMN IF NOT EXISTS period_month_to INT;

-- ADD CONSTRAINT не умеет IF NOT EXISTS, а остальной файл переживает
-- повторный прогон — держим единообразие.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transport_requests_period_month_to_check'
  ) THEN
    ALTER TABLE transport_requests
      ADD CONSTRAINT transport_requests_period_month_to_check
      CHECK (period_month_to IS NULL OR period_month_to BETWEEN 1 AND 12);
  END IF;
END $$;

COMMENT ON COLUMN transport_requests.destination_country IS 'Страна назначения — только у экспортных заявок за пределы КЗХ';
COMMENT ON COLUMN transport_requests.port IS 'Порт перевалки, если груз уходит водным транспортом';
COMMENT ON COLUMN transport_requests.wagon_numbers IS 'Перечень номеров вагонов-цистерн, если он известен заранее';
COMMENT ON COLUMN transport_requests.period_month_to IS 'Последний месяц периода: «Август-сентябрь 2026 г.». Пусто — период в один месяц';

-- ═══════════════════════════════════════════════════════════════
-- Оплаты по железным дорогам
-- ═══════════════════════════════════════════════════════════════
-- В ячейке «Экспедитор по ЖД» у каждой дороги своя строка. Формулировки
-- в настоящих заявках разные:
--
--   «Оплата по КЗХ – ТОО «PTC Operator»»
--   «Оплата по КРГ груженый и порожний пробег: ОсОО «China Petrol …»»
--   «Оплата по КЗХ PTC OPERATOR ТОО КОД 2782503»
--
-- Общее у них только начало «Оплата по <дорога>», дальше текст пишут
-- как принято у этой дороги. Поэтому дорога — отдельным полем (по ней
-- строки сортируются и её можно подставлять), а остаток строки —
-- свободный текст. Пытаться разложить его на «плательщик + код +
-- примечание» значило бы навязать форму, которой в документах нет.

CREATE TABLE IF NOT EXISTS transport_request_payers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES transport_requests(id) ON DELETE CASCADE,
  position INT NOT NULL,
  railway TEXT NOT NULL,
  payer_text TEXT,
  UNIQUE (request_id, position)
);

CREATE INDEX IF NOT EXISTS idx_transport_request_payers_request
  ON transport_request_payers(request_id, position);

ALTER TABLE transport_request_payers ENABLE ROW LEVEL SECURITY;

-- Строки оплат правятся вместе с заявкой, поэтому удаляет их та же
-- роль, что и редактирует: иначе убрать лишнюю строку смог бы только
-- админ.
CREATE POLICY "auth_select_transport_request_payers" ON transport_request_payers
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "writable_insert_transport_request_payers" ON transport_request_payers
  FOR INSERT WITH CHECK (is_writable_role());
CREATE POLICY "writable_update_transport_request_payers" ON transport_request_payers
  FOR UPDATE USING (is_writable_role());
CREATE POLICY "writable_delete_transport_request_payers" ON transport_request_payers
  FOR DELETE USING (is_writable_role());

COMMENT ON TABLE transport_request_payers IS
  'Строки «Оплата по <дорога> …» в ячейке «Экспедитор по ЖД»';

-- ═══════════════════════════════════════════════════════════════
-- Перенос двух прежних оплат в строки
-- ═══════════════════════════════════════════════════════════════
-- До этой миграции оплаты жили двумя ссылками: forwarder_kzh_id и
-- payer_krg_consignee_id. Колонки остаются (миграции append-only), но
-- источником больше не считаются — их содержимое переезжает в строки,
-- чтобы уже заведённые заявки не потеряли эти данные.
--
-- Формулировки берём те же, что в настоящих заявках.

DO $$
DECLARE
  v_rows INT := 0;
BEGIN
  INSERT INTO transport_request_payers (request_id, position, railway, payer_text)
  SELECT r.id, 1, 'КЗХ', '– ' || f.name
    FROM transport_requests r
    JOIN forwarders f ON f.id = r.forwarder_kzh_id
   WHERE NOT EXISTS (
     SELECT 1 FROM transport_request_payers p WHERE p.request_id = r.id
   );
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO transport_request_payers (request_id, position, railway, payer_text)
  SELECT r.id, 2, 'КРГ', 'груженый и порожний пробег: ' || c.name
    FROM transport_requests r
    JOIN consignees c ON c.id = r.payer_krg_consignee_id
   WHERE NOT EXISTS (
     SELECT 1 FROM transport_request_payers p
      WHERE p.request_id = r.id AND p.position = 2
   );

  RAISE NOTICE 'Оплаты по КЗХ перенесены в строки: % заявок', v_rows;
END $$;
