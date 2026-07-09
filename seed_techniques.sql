-- =====================================================================
-- GrappleLab — Expanded technique seed (run AFTER schema.sql + seed.sql,
-- in the Supabase SQL editor)
--
-- Adds ~100 real, widely-recognized BJJ technique NAMES across the
-- foundational positions, plus the extra standard positions those
-- techniques live in (Half Guard, Open Guard, Butterfly Guard,
-- Guard Passing, Standing, Turtle).
--
-- Per CLAUDE.md's "do not invent BJJ curriculum" rule, techniques carry NO
-- instructional descriptions — only structural fields (name, position, kind,
-- belt level). `description` and `video_url` are left NULL; add real
-- instructions/videos later from a trusted source.
--
-- Idempotent, matching seed.sql: positions use `on conflict do nothing`;
-- techniques are joined to positions by name and guarded with `not exists`
-- (name + position_id), so re-running inserts no duplicates and the original
-- five seeded techniques are left untouched.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Extra foundational positions (name is unique → on conflict do nothing).
-- sort_order continues after the five from seed.sql (1–5).
-- ---------------------------------------------------------------------
insert into positions (name, sort_order) values
  ('Half Guard',      6),
  ('Open Guard',      7),
  ('Butterfly Guard', 8),
  ('Guard Passing',   9),
  ('Standing',       10),
  ('Turtle',         11)
on conflict (name) do nothing;


-- ---------------------------------------------------------------------
-- ~100 techniques. `position_id` is resolved by joining on position name;
-- the `not exists` guard makes re-runs safe (techniques has no unique name).
--
-- The list is ordered fundamentals-first: the first ~50 rows are marked
-- is_free = true (the free-tier cap), the remainder false. `kind` uses the
-- technique_kind enum; belt_level skews white/blue, with a few purple.
-- ---------------------------------------------------------------------
insert into techniques (name, position_id, kind, belt_level, is_free)
select
  v.name,
  p.id,
  v.kind::technique_kind,
  v.belt::belt_rank,
  v.is_free
from (values
  -- ============================ FREE (~50): core fundamentals ==========
  -- Standing / takedowns
  ('Double Leg Takedown',            'Standing',        'takedown',   'white', true),
  ('Single Leg Takedown',            'Standing',        'takedown',   'white', true),
  ('Ankle Pick',                     'Standing',        'takedown',   'white', true),
  ('Osoto Gari',                     'Standing',        'takedown',   'blue',  true),
  ('Body Lock Takedown',             'Standing',        'takedown',   'blue',  true),
  ('Guard Pull',                     'Standing',        'transition', 'white', true),
  ('Arm Drag',                       'Standing',        'transition', 'white', true),
  -- Closed Guard
  ('Scissor Sweep',                  'Closed Guard',    'sweep',      'white', true),
  ('Hip Bump Sweep',                 'Closed Guard',    'sweep',      'white', true),
  ('Pendulum Sweep',                 'Closed Guard',    'sweep',      'white', true),
  ('Flower Sweep',                   'Closed Guard',    'sweep',      'white', true),
  ('Kimura from Guard',              'Closed Guard',    'submission', 'white', true),
  ('Guillotine Choke',               'Closed Guard',    'submission', 'white', true),
  ('Omoplata',                       'Closed Guard',    'submission', 'blue',  true),
  -- Open Guard
  ('Tripod Sweep',                   'Open Guard',      'sweep',      'white', true),
  ('Sickle Sweep',                   'Open Guard',      'sweep',      'white', true),
  ('Spider Guard Sweep',             'Open Guard',      'sweep',      'blue',  true),
  -- Butterfly Guard
  ('Butterfly Sweep',                'Butterfly Guard', 'sweep',      'white', true),
  ('Hook Sweep',                     'Butterfly Guard', 'sweep',      'blue',  true),
  -- Half Guard
  ('Old School Sweep',               'Half Guard',      'sweep',      'white', true),
  ('Knee Shield',                    'Half Guard',      'control',    'white', true),
  ('Back Take from Half Guard',      'Half Guard',      'transition', 'blue',  true),
  -- Guard Passing
  ('Toreando Pass',                  'Guard Passing',   'pass',       'white', true),
  ('Knee Cut Pass',                  'Guard Passing',   'pass',       'white', true),
  ('Double Under Pass',              'Guard Passing',   'pass',       'white', true),
  ('Over-Under Pass',                'Guard Passing',   'pass',       'blue',  true),
  ('Stack Pass',                     'Guard Passing',   'pass',       'white', true),
  ('Leg Drag',                       'Guard Passing',   'pass',       'blue',  true),
  -- Side Control
  ('Americana',                      'Side Control',    'submission', 'white', true),
  ('Armbar from Side Control',       'Side Control',    'submission', 'blue',  true),
  ('Arm Triangle Choke',             'Side Control',    'submission', 'blue',  true),
  ('Hip Escape to Guard',            'Side Control',    'escape',     'white', true),
  ('Transition to Mount',            'Side Control',    'transition', 'white', true),
  ('Transition to Knee-on-Belly',    'Side Control',    'transition', 'white', true),
  -- Mount
  ('Armbar from Mount',              'Mount',           'submission', 'white', true),
  ('Cross Collar Choke from Mount',  'Mount',           'submission', 'white', true),
  ('Americana from Mount',           'Mount',           'submission', 'white', true),
  ('Ezekiel Choke',                  'Mount',           'submission', 'blue',  true),
  ('Upa Escape',                     'Mount',           'escape',     'white', true),
  ('Elbow Escape',                   'Mount',           'escape',     'white', true),
  ('Technical Mount',                'Mount',           'control',    'blue',  true),
  -- Back Control
  ('Bow and Arrow Choke',            'Back Control',    'submission', 'blue',  true),
  ('Rear Collar Choke',              'Back Control',    'submission', 'blue',  true),
  ('Back Escape',                    'Back Control',    'escape',     'white', true),
  ('Seatbelt Control',               'Back Control',    'control',    'white', true),
  -- Knee-on-Belly
  ('Knee-on-Belly Control',          'Knee-on-Belly',   'control',    'white', true),
  ('Far-Side Armbar',                'Knee-on-Belly',   'submission', 'blue',  true),
  ('Baseball Bat Choke',             'Knee-on-Belly',   'submission', 'blue',  true),
  -- Turtle
  ('Clock Choke',                    'Turtle',          'submission', 'blue',  true),
  ('Back Take from Turtle',          'Turtle',          'transition', 'white', true),

  -- ============================ PRO (~50): situational / advanced =====
  -- Standing / takedowns
  ('Seoi Nage',                      'Standing',        'takedown',   'blue',   false),
  ('Uchi Mata',                      'Standing',        'takedown',   'purple', false),
  ('O Goshi',                        'Standing',        'takedown',   'blue',   false),
  ('Foot Sweep',                     'Standing',        'takedown',   'blue',   false),
  ('Snap Down',                      'Standing',        'transition', 'white',  false),
  ('Fireman''s Carry',               'Standing',        'takedown',   'blue',   false),
  ('Duck Under',                     'Standing',        'takedown',   'blue',   false),
  ('Kouchi Gari',                    'Standing',        'takedown',   'purple', false),
  -- Closed Guard
  ('Gogoplata',                      'Closed Guard',    'submission', 'purple', false),
  ('Loop Choke',                     'Closed Guard',    'submission', 'blue',   false),
  -- Open Guard
  ('De La Riva Guard',               'Open Guard',      'control',    'blue',   false),
  ('Reverse De La Riva Guard',       'Open Guard',      'control',    'purple', false),
  ('X-Guard Sweep',                  'Open Guard',      'sweep',      'blue',   false),
  ('Single Leg X Sweep',             'Open Guard',      'sweep',      'purple', false),
  ('Balloon Sweep',                  'Open Guard',      'sweep',      'blue',   false),
  ('Berimbolo',                      'Open Guard',      'transition', 'purple', false),
  ('Lasso Sweep',                    'Open Guard',      'sweep',      'blue',   false),
  -- Butterfly Guard
  ('Overhead Sweep',                 'Butterfly Guard', 'sweep',      'blue',   false),
  ('Arm Drag to Back',               'Butterfly Guard', 'transition', 'blue',   false),
  -- Half Guard
  ('Electric Chair Sweep',           'Half Guard',      'sweep',      'purple', false),
  ('Lockdown',                       'Half Guard',      'control',    'blue',   false),
  ('Coming to the Knees Sweep',      'Half Guard',      'sweep',      'blue',   false),
  ('Dogfight',                       'Half Guard',      'transition', 'blue',   false),
  ('Kimura from Half Guard',         'Half Guard',      'submission', 'blue',   false),
  ('Deep Half Guard Sweep',          'Half Guard',      'sweep',      'purple', false),
  -- Guard Passing
  ('X-Pass',                         'Guard Passing',   'pass',       'blue',   false),
  ('Long Step Pass',                 'Guard Passing',   'pass',       'blue',   false),
  ('Smash Pass',                     'Guard Passing',   'pass',       'blue',   false),
  ('Body Lock Pass',                 'Guard Passing',   'pass',       'blue',   false),
  ('Folding Pass',                   'Guard Passing',   'pass',       'purple', false),
  ('Backstep Pass',                  'Guard Passing',   'pass',       'blue',   false),
  -- Side Control
  ('Paper Cutter Choke',             'Side Control',    'submission', 'blue',   false),
  ('Ghost Escape',                   'Side Control',    'escape',     'blue',   false),
  ('North-South Choke',              'Side Control',    'submission', 'purple', false),
  ('Reverse Kimura',                 'Side Control',    'submission', 'purple', false),
  -- Mount
  ('S-Mount',                        'Mount',           'control',    'blue',   false),
  ('Gift Wrap',                      'Mount',           'control',    'purple', false),
  ('Arm Triangle from Mount',        'Mount',           'submission', 'blue',   false),
  ('Mounted Triangle',               'Mount',           'submission', 'purple', false),
  -- Back Control
  ('Rear Triangle Choke',            'Back Control',    'submission', 'purple', false),
  ('Straitjacket Control',           'Back Control',    'control',    'purple', false),
  ('Body Triangle',                  'Back Control',    'control',    'blue',   false),
  -- Knee-on-Belly
  ('Spinning Armbar from Knee-on-Belly', 'Knee-on-Belly', 'submission', 'purple', false),
  ('Knee-on-Belly to Mount',         'Knee-on-Belly',   'transition', 'white',  false),
  -- Turtle
  ('Crucifix',                       'Turtle',          'transition', 'purple', false),
  ('Peruvian Necktie',               'Turtle',          'submission', 'purple', false),
  ('Anaconda Choke',                 'Turtle',          'submission', 'blue',   false),
  ('D''Arce Choke',                  'Turtle',          'submission', 'blue',   false),
  ('Granby Roll',                    'Turtle',          'escape',     'blue',   false),
  ('Front Headlock',                 'Turtle',          'control',    'blue',   false)
) as v(name, position_name, kind, belt, is_free)
join positions p on p.name = v.position_name
where not exists (
  select 1 from techniques t
  where t.name = v.name and t.position_id = p.id
);
