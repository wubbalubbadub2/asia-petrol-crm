-- Test: generate_deal_number issues a strictly monotonic per-(type, year)
-- counter (mig 00011).
--
-- The app calls this RPC before every INSERT into deals. It must
-- always produce the next unused number for the given (deal_type,
-- year) pair, starting at 1, and must be concurrency-safe enough for
-- our actual workload (two managers creating deals back-to-back).
-- Strict concurrency safety is guaranteed by the INSERT/ON CONFLICT
-- pattern because Postgres takes the row lock on the existing
-- deal_sequences row before applying the update.

BEGIN;

DO $$
DECLARE
  v_n1 INT;
  v_n2 INT;
  v_n3 INT;
  v_kz INT;
  v_next_year INT;
BEGIN
  -- Clean slate for this (type, year) combo so the sequence starts
  -- predictably even if prior tests (or real data) exist.
  DELETE FROM deal_sequences WHERE deal_type = 'KG' AND year = 2099;
  DELETE FROM deal_sequences WHERE deal_type = 'KZ' AND year = 2099;
  DELETE FROM deal_sequences WHERE deal_type = 'KG' AND year = 2100;

  SELECT generate_deal_number('KG', 2099) INTO v_n1;
  SELECT generate_deal_number('KG', 2099) INTO v_n2;
  SELECT generate_deal_number('KG', 2099) INTO v_n3;

  IF v_n1 <> 1 OR v_n2 <> 2 OR v_n3 <> 3 THEN
    RAISE EXCEPTION 'KG/2099 sequence expected 1,2,3, got %,%,%', v_n1, v_n2, v_n3;
  END IF;

  -- Different deal_type with the same year gets its own counter.
  SELECT generate_deal_number('KZ', 2099) INTO v_kz;
  IF v_kz <> 1 THEN
    RAISE EXCEPTION 'KZ/2099 sequence expected fresh 1, got %', v_kz;
  END IF;

  -- Different year gets its own counter too.
  SELECT generate_deal_number('KG', 2100) INTO v_next_year;
  IF v_next_year <> 1 THEN
    RAISE EXCEPTION 'KG/2100 sequence expected fresh 1, got %', v_next_year;
  END IF;

  -- And the original counter wasn't disturbed.
  SELECT generate_deal_number('KG', 2099) INTO v_n1;
  IF v_n1 <> 4 THEN
    RAISE EXCEPTION 'KG/2099 after other types/years expected 4, got %', v_n1;
  END IF;
END $$;

ROLLBACK;
