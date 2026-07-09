-- =====================================================================
-- GrappleLab — Quiz question bank (run AFTER schema.sql + seed.sql +
-- seed_techniques.sql, in the Supabase SQL editor)
--
-- Generates multiple-choice questions in `quiz_questions` from the REAL
-- technique + position data. No BJJ facts are fabricated: every prompt names
-- an existing technique, and every option is a real position name or a real
-- technique_kind enum value. Only the prompt template and the arrangement of
-- options are generated.
--
-- Two questions per technique:
--   1. "Which position is the {name} used from?"  — 4 options: the real
--      position + 3 random OTHER real positions, correct answer at a random
--      slot.
--   2. "Is the {name} a submission, sweep, pass, escape, takedown, control,
--      or transition?" — all 7 technique_kind values, correct = the real kind.
--
-- Idempotent: guarded by prompt text (deterministic per technique + type), so
-- re-running adds nothing and only fills in newly-added techniques. The random
-- option layout is fixed once a row is inserted.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Position questions (only techniques that have a position; needs >= 4
--    positions so 3 distractors are available).
-- ---------------------------------------------------------------------
insert into quiz_questions (technique_id, prompt, options, correct_index)
select
  q.technique_id,
  q.prompt,
  q.options,
  q.correct_index
from (
  with placed as (
    select
      t.id as technique_id,
      t.name as tname,
      p.name as correct_pos,
      array(
        select pos.name
        from positions pos
        where pos.name <> p.name
        order by random()
        limit 3
      ) as distractors,
      floor(random() * 4)::int as ci
    from techniques t
    join positions p on p.id = t.position_id
  )
  select
    technique_id,
    'Which position is the ' || tname || ' used from?' as prompt,
    -- Insert the correct answer at slot `ci` among the 3 distractors.
    to_jsonb(distractors[1:ci] || array[correct_pos] || distractors[ci + 1:3]) as options,
    ci::smallint as correct_index
  from placed
  where array_length(distractors, 1) = 3
) q
where not exists (
  select 1 from quiz_questions e where e.prompt = q.prompt
);


-- ---------------------------------------------------------------------
-- 2. Kind questions — all 7 enum values in declared order; the correct
--    answer is the technique's real kind.
-- ---------------------------------------------------------------------
insert into quiz_questions (technique_id, prompt, options, correct_index)
select
  t.id,
  'Is the ' || t.name
    || ' a submission, sweep, pass, escape, takedown, control, or transition?' as prompt,
  to_jsonb(array(
    select e::text from unnest(enum_range(null::technique_kind)) e
  )) as options,
  (
    array_position(
      array(select e::text from unnest(enum_range(null::technique_kind)) e),
      t.kind::text
    ) - 1
  )::smallint as correct_index
from techniques t
where not exists (
  select 1 from quiz_questions e
  where e.prompt = 'Is the ' || t.name
    || ' a submission, sweep, pass, escape, takedown, control, or transition?'
);
