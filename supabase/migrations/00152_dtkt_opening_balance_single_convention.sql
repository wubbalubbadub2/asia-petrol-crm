-- 00152_dtkt_opening_balance_single_convention.sql
--
-- Клиент 2026-08-25 (ДТ-КТ Логистика): «+ это мы должны, а − это нам
-- должны, а сейчас кажется наоборот». Формулу вернули к «сальдо = наш
-- долг перед экспедитором» коммитом 342f544 (src/lib/dtkt/saldo.ts).
-- Эта миграция чинит вторую половину проблемы: колонка «Сальдо на 1
-- янв.» живёт сразу в двух конвенциях, и ни одна формула не может быть
-- права для обеих.
--
-- ═══ КАК КОЛОНКА РАЗЪЕХАЛАСЬ ═══
--
--  30.07  00133 разово перевернула знак сохранённых opening_balance и
--         формулу UI: «− = нам должны на 1 января».
--  12.08  формулу вернули к прямой (a9a3813), данные не трогали. С этого
--         дня величина на экране сходилась с бухгалтерской таблицей
--         только у записей, введённых в СТАРОЙ конвенции («+ = нам
--         должны»), поэтому сотрудники правили «Сальдо 1 янв.» именно
--         под неё — гнались за суммой, а не за подписью к знаку.
--  25.08  формула снова «сальдо = наш долг» — та же, что была 30.07.
--
-- Записи, которых после 00133 никто не касался, уже в нужной конвенции.
-- Записи, введённые руками после 00133, стоят в обратной — их и
-- разворачивает эта миграция.
--
-- ═══ ОТКУДА СПИСОК ═══
--
-- Диагностика по audit_log на проде (scripts/dtkt-sign-diagnostic.sql,
-- прогон 2026-08-25) дала по 2026 году ровно три группы:
--
--   • 5 строк UE-LOGISTIC — последняя правка 30.07 10:30 без
--     пользователя, то есть сам пакет 00133. Конвенция верная,
--     НЕ ТРОГАЕМ. Проверка: UE-LOGISTIC / АБ Линк −578 000,00 +
--     возврат 578 000,00 = 0,00 — как и ждала бухгалтерия.
--   • 9 строк PTC - Operator — последнюю правку opening_balance сделал
--     человек уже после 00133 (03.08, 12.08 и 24.08). Все девять стоят
--     положительными, тогда как у группы 00133 знаки разные, — это и
--     есть след старой конвенции «+ = нам должны». Перечислены ниже.
--   • 8 строк без единой правки: у шести opening_balance пуст (знака
--     нет, разворачивать нечего), а две — Prologistic / Singularity
--     Trading 64 728,42 и PTC - Operator / Fuel Supply 6 720,00 —
--     заведены руками после 00133 и в этой миграции НЕ трогаются:
--     следа «было → стало» по ним нет, конвенцию подтверждает
--     бухгалтерия. Миграция выводит их в NOTICE.
--
-- Почему не отбором по audit_log, как в первой редакции: отбор дал 9
-- кандидатов вместо ожидаемых трёх и сработал предохранитель — правка
-- данных не применилась, ни одна строка не изменилась. Список выверен
-- построчно, поэтому здесь он явный.
--
-- ═══ ПРОВЕРКА НА ЦИФРАХ БУХГАЛТЕРИИ ═══
--
--   PTC - Operator / TENGRI WAY: было +32 340,20 → станет −32 340,20
--     сальдо −32 340,20 + 204 087,56 + 21 940,00 − 228 825,00
--           = −35 137,64 — те самые 35 137,64 «нам должны», которые
--     бухгалтерия ждала 12.08, теперь с запрошенным знаком.
--
-- ═══ ЧТО МЕНЯЕТСЯ НА ЭКРАНЕ (по данным прогона 25.08) ═══
--
--   CAODL                     15 444,67  →     −13 139,83
--   Progressive oil trading  401 266 856,47 → 364 284 755,75
--   Singularity Trading        −298 726,62 →    −404 469,44
--   TENGRI WAY                  29 542,76  →     −35 137,64
--   Арқа Проф               42 827 189,04  →   5 788 881,04
--   Бетта Трейд                286 166,40  →     166 891,44
--   ДОТ                        751 459,18  →     253 252,04
--   ОМИ                      1 345 619,87  →    −249 925,93
--   ОРТ                       −590 155,36  →    −806 901,80
--
-- Величина сальдо сдвигается ровно на удвоенное «Сальдо 1 янв.» — это
-- и есть цена того, что колонка стояла в чужой конвенции.
--
-- ═══ БЕЗОПАСНОСТЬ ═══
--
-- Строка ищется по экспедитору, плательщику ЖД, году И текущему
-- значению. Не нашлось ровно одной — вся миграция откатывается
-- (единственная транзакция), ничего не меняется. Повторный прогон
-- видит уже развёрнутое значение, пишет NOTICE и пропускает строку,
-- поэтому дважды знак не перевернётся.
--
-- Rollback: прогнать этот же файл, заменив в списке значения на
-- отрицательные.

DO $$
DECLARE
  r        RECORD;
  v_ids    UUID[];
  v_back   INT;
  v_done   INT := 0;
  v_skip   INT := 0;
  v_other  INT;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('PTC - Operator', 'CAODL',                   14292.25::NUMERIC),
      ('PTC - Operator', 'Progressive oil trading', 18491050.36),
      ('PTC - Operator', 'Singularity Trading',        52871.41),
      ('PTC - Operator', 'TENGRI WAY',                 32340.20),
      ('PTC - Operator', 'Арқа Проф',              18519154.00),
      ('PTC - Operator', 'Бетта Трейд',                59637.48),
      ('PTC - Operator', 'ДОТ',                       249103.57),
      ('PTC - Operator', 'ОМИ',                       797772.90),
      ('PTC - Operator', 'ОРТ',                       108373.22)
    ) AS t(fw, cg, now_val)
  LOOP
    -- Совпадение по названию с точностью до крайних пробелов: в
    -- справочниках встречаются «TENGRI WAY » и «Fuel Supply ».
    SELECT COALESCE(array_agg(l.id), '{}')
      INTO v_ids
      FROM dt_kt_logistics l
      JOIN forwarders     f ON f.id = l.forwarder_id
      JOIN company_groups g ON g.id = l.company_group_id
     WHERE l.year = 2026
       AND btrim(f.name) = r.fw
       AND btrim(g.name) = r.cg
       AND l.opening_balance = r.now_val;

    IF COALESCE(array_length(v_ids, 1), 0) = 1 THEN
      UPDATE dt_kt_logistics
         SET opening_balance = -opening_balance
       WHERE id = v_ids[1];
      v_done := v_done + 1;
      RAISE NOTICE '  развёрнуто: % / % — % → %', r.fw, r.cg, r.now_val, -r.now_val;
      CONTINUE;
    END IF;

    -- Уже развёрнута? Тогда это повторный прогон, а не расхождение.
    SELECT COUNT(*)
      INTO v_back
      FROM dt_kt_logistics l
      JOIN forwarders     f ON f.id = l.forwarder_id
      JOIN company_groups g ON g.id = l.company_group_id
     WHERE l.year = 2026
       AND btrim(f.name) = r.fw
       AND btrim(g.name) = r.cg
       AND l.opening_balance = -r.now_val;

    IF COALESCE(array_length(v_ids, 1), 0) = 0 AND v_back = 1 THEN
      v_skip := v_skip + 1;
      RAISE NOTICE '  пропуск: % / % уже стоит % — миграция применялась раньше', r.fw, r.cg, -r.now_val;
      CONTINUE;
    END IF;

    RAISE EXCEPTION
      'ДТ-КТ 2026: % / % — под значение % подошло % строк (развёрнутых: %). Данные разошлись со списком, миграция отменена целиком',
      r.fw, r.cg, r.now_val, COALESCE(array_length(v_ids, 1), 0), v_back;
  END LOOP;

  IF v_done = 0 AND v_skip = 9 THEN
    RAISE NOTICE '00152 уже применена — все 9 строк стоят в нужной конвенции';
  ELSIF v_done + v_skip <> 9 THEN
    RAISE EXCEPTION 'обработано % строк вместо 9 — миграция отменена', v_done + v_skip;
  ELSE
    RAISE NOTICE 'ДТ-КТ: знак «Сальдо 1 янв.» выровнен у % строк (пропущено уже развёрнутых: %)', v_done, v_skip;
  END IF;

  -- ── Заведены руками после 00133, следа «было → стало» нет: знак
  --    подтверждает бухгалтерия, миграция их не касается ──
  FOR r IN
    SELECT f.name AS fw, g.name AS cg, l.year, l.opening_balance AS now_val
      FROM dt_kt_logistics l
      JOIN forwarders     f ON f.id = l.forwarder_id
      JOIN company_groups g ON g.id = l.company_group_id
     WHERE l.opening_balance IS NOT NULL
       AND l.opening_balance <> 0
       AND NOT EXISTS (
         SELECT 1 FROM audit_log a
          WHERE a.table_name = 'dt_kt_logistics'
            AND a.row_id = l.id
            AND a.changed_fields @> ARRAY['opening_balance']
       )
     ORDER BY f.name, g.name, l.year
  LOOP
    RAISE NOTICE '  ПРОВЕРИТЬ У БУХГАЛТЕРИИ: % / % / % — сальдо 1 янв = %, правок не было, знак не трогали',
      r.fw, r.cg, r.year, r.now_val;
  END LOOP;

  -- Диагностика шла по 2026 году; если в базе есть другие годы со
  -- знаком — их конвенцию никто не смотрел.
  SELECT COUNT(*) INTO v_other
    FROM dt_kt_logistics
   WHERE year <> 2026 AND opening_balance IS NOT NULL AND opening_balance <> 0;

  IF v_other > 0 THEN
    RAISE NOTICE '  ВНИМАНИЕ: строк с сальдо 1 янв за другие годы: % — их конвенция не проверялась', v_other;
  END IF;
END $$;
