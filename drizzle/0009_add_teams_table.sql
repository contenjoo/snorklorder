CREATE TABLE IF NOT EXISTS "teams" (
  "id" serial PRIMARY KEY NOT NULL,
  "code" text UNIQUE NOT NULL,
  "label_en" text,
  "color_palette" text,
  "is_active" integer NOT NULL DEFAULT 1,
  "kind" text NOT NULL DEFAULT 'group',
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "teams_code_idx" ON "teams" ("code");

INSERT INTO teams (code, label_en, color_palette, kind) VALUES
  ('서울1팀', 'Seoul Team 1', 'blue', 'group'),
  ('서울4팀', 'Seoul Team 4', 'blue', 'group'),
  ('서울8팀', 'Seoul Team 8', 'violet', 'group'),
  ('경기2팀', 'Gyeonggi Team 2', 'emerald', 'group'),
  ('경기3팀', 'Gyeonggi Team 3', 'green', 'group'),
  ('경기5팀', 'Gyeonggi Team 5', 'teal', 'group'),
  ('경기6팀', 'Gyeonggi Team 6', 'gray', 'group'),
  ('경기7팀', 'Gyeonggi Team 7', 'rose', 'group'),
  ('경기9팀', 'Gyeonggi Team 9', 'amber', 'group'),
  ('취소', 'Cancelled', 'red', 'system')
ON CONFLICT (code) DO NOTHING;
