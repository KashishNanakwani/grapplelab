-- =====================================================================
-- GrappleLab — Seed data (run AFTER schema.sql, in the Supabase SQL editor)
--
-- Seeds the five foundational positions and the five high-frequency
-- submissions listed in CLAUDE.md so the technique library has real data.
--
-- Per CLAUDE.md's "do not invent BJJ curriculum" rule, techniques carry NO
-- instructional descriptions — only structural fields (name, position, kind,
-- belt level). Add real descriptions/videos later from a trusted source.
--
-- This script is idempotent: re-running it inserts no duplicates.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Foundational positions (name is unique → on conflict do nothing)
-- ---------------------------------------------------------------------
insert into positions (name, sort_order) values
  ('Closed Guard',  1),
  ('Side Control',  2),
  ('Mount',         3),
  ('Back Control',  4),
  ('Knee-on-Belly', 5)
on conflict (name) do nothing;


-- ---------------------------------------------------------------------
-- High-frequency submissions, mapped to their canonical positions.
-- `position_id` is resolved by joining on the position name; the
-- `not exists` guard makes re-runs safe (techniques has no unique name).
-- ---------------------------------------------------------------------
insert into techniques (name, position_id, kind, belt_level, is_free)
select
  v.name,
  p.id,
  v.kind::technique_kind,
  v.belt::belt_rank,
  v.is_free
from (values
  ('Armbar',             'Closed Guard', 'submission', 'white', true),
  ('Triangle',           'Closed Guard', 'submission', 'white', true),
  ('Cross Collar Choke', 'Closed Guard', 'submission', 'white', true),
  ('Kimura',             'Side Control', 'submission', 'white', true),
  ('Rear Naked Choke',   'Back Control', 'submission', 'white', true)
) as v(name, position_name, kind, belt, is_free)
join positions p on p.name = v.position_name
where not exists (
  select 1 from techniques t
  where t.name = v.name and t.position_id = p.id
);
