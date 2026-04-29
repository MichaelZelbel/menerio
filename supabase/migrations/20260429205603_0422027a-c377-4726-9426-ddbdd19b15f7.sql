INSERT INTO public.collection_templates (slug, name, icon, category, description, field_schema, agent_instructions, official, usage_count)
VALUES
(
  'home-maintenance',
  'Home Maintenance',
  '🔧',
  'home',
  'Track home assets, vendors, service dates, costs, notes, and warranties.',
  '[
    {"key":"asset","label":"Asset","type":"text","primary":true},
    {"key":"vendor","label":"Vendor","type":"link_person"},
    {"key":"service_date","label":"Service Date","type":"date","indexable":true},
    {"key":"cost","label":"Cost","type":"currency"},
    {"key":"notes","label":"Notes","type":"longtext"},
    {"key":"warranty_expires","label":"Warranty Expires","type":"date","indexable":true}
  ]'::jsonb,
  'Capture entries when the user mentions repairs, maintenance visits, appliance details, contractors, warranties, or home assets that may matter later. Extract the asset, vendor or service person, service date, cost, notes, and any warranty expiration automatically when stated. Ask a brief follow-up if a warranty, next service date, or vendor name is implied but missing. Pay special attention to time-bridging warnings: if a warranty is near expiry, a service date suggests recurring maintenance, or a cost/vendor detail could help future troubleshooting, preserve it clearly.',
  true,
  0
),
(
  'job-applications',
  'Job Applications',
  '💼',
  'work',
  'Track roles, companies, statuses, application dates, compensation ranges, contacts, and notes.',
  '[
    {"key":"company","label":"Company","type":"text","primary":true},
    {"key":"role","label":"Role","type":"text"},
    {"key":"status","label":"Status","type":"select","options":["applied","interviewing","offered","rejected","withdrawn"],"indexable":true},
    {"key":"applied_date","label":"Applied Date","type":"date","indexable":true},
    {"key":"salary_range","label":"Salary Range","type":"text"},
    {"key":"contact","label":"Contact","type":"link_person"},
    {"key":"notes","label":"Notes","type":"longtext"}
  ]'::jsonb,
  'Capture entries when the user mentions applying to a role, hearing back from a company, scheduling interviews, receiving offers or rejections, or discussing a job lead. Extract company, role, status, applied date, salary range, contact, and notes when stated. Watch for follow-up cadence signals like recruiter replies, interview timing, deadlines, and next steps, and suggest capturing follow-up context when useful. Detect warm intro opportunities when the user mentions a person connected to the company or role.',
  true,
  0
),
(
  'workout-log',
  'Workout Log',
  '💪',
  'health',
  'Log workouts with date, type, duration, feelings, and exercise details.',
  '[
    {"key":"date","label":"Date","type":"date","primary":true,"indexable":true},
    {"key":"type","label":"Type","type":"select","options":["cardio","strength","flexibility","sports"]},
    {"key":"duration_min","label":"Duration Min","type":"number"},
    {"key":"how_i_felt","label":"How I Felt","type":"longtext"},
    {"key":"exercises","label":"Exercises","type":"longtext"}
  ]'::jsonb,
  'Capture entries when the user casually mentions completing a workout, exercise session, run, class, sport, stretch, or training block. Keep capture low-friction: infer date, type, duration, exercises, and how the user felt from natural phrasing without asking for perfect detail. Ask only one concise follow-up if the core workout type or date is missing. Prefer preserving imperfect notes over interrupting the user with too many questions.',
  true,
  0
),
(
  'wine-journal',
  'Wine Journal',
  '🍷',
  'personal',
  'Remember wines, vintages, regions, where you had them, ratings, and tasting notes.',
  '[
    {"key":"name","label":"Name","type":"text","primary":true},
    {"key":"vintage","label":"Vintage","type":"number"},
    {"key":"region","label":"Region","type":"text"},
    {"key":"where_drunk","label":"Where Drunk","type":"text"},
    {"key":"date","label":"Date","type":"date","indexable":true},
    {"key":"rating","label":"Rating","type":"select","options":["1","2","3","4","5"]},
    {"key":"notes","label":"Notes","type":"longtext"}
  ]'::jsonb,
  'Capture entries when the user mentions drinking, buying, tasting, liking, disliking, or wanting to remember a specific wine. Extract the wine name, vintage, region, location, date, rating, and tasting notes when available. Ask a short follow-up only if the wine name is unclear or the user seems to want a rating but did not give one. Preserve subjective impressions and context because they are often more useful than formal tasting vocabulary.',
  true,
  0
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  icon = EXCLUDED.icon,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  field_schema = EXCLUDED.field_schema,
  agent_instructions = EXCLUDED.agent_instructions,
  official = EXCLUDED.official;