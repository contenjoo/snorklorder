-- Add Dongduk Girls' High School (standalone school in Seoul)
-- Managing teacher: Youngmi Shin (ymshin@sonline20.sen.go.kr)
-- Plus 20 colleague teachers

-- 1) Insert school
INSERT INTO schools (name, name_en, code, region, team, domain)
VALUES (
  '동덕여자고등학교',
  'Dongduk Girls'' High School',
  'DONGDUKGIRLS',
  '서울',
  NULL,
  'sonline20.sen.go.kr'
)
ON CONFLICT (code) DO NOTHING;

-- 2) Insert teachers (managing teacher first, then colleagues)
WITH s AS (SELECT id FROM schools WHERE code = 'DONGDUKGIRLS' LIMIT 1)
INSERT INTO teachers (school_id, name, email, status)
SELECT s.id, v.name, v.email, 'pending'
FROM s,
     (VALUES
       ('Youngmi Shin',   'ymshin@sonline20.sen.go.kr'),
       ('barcamoral',     'barcamoral@sonline20.sen.go.kr'),
       ('bolddaek',       'bolddaek@sonline20.sen.go.kr'),
       ('bradsin119',     'bradsin119@sonline20.sen.go.kr'),
       ('choizarr',       'choizarr@sonline20.sen.go.kr'),
       ('ethicscap',      'ethicscap@sonline20.sen.go.kr'),
       ('everflavor',     'everflavor@sonline20.sen.go.kr'),
       ('hbjclass',       'hbjclass@sonline20.sen.go.kr'),
       ('heesung0128',    'heesung0128@sonline20.sen.go.kr'),
       ('hjkw0707',       'hjkw0707@sonline20.sen.go.kr'),
       ('kijomi90',       'kijomi90@sonline20.sen.go.kr'),
       ('myeongwon007',   'myeongwon007@sonline20.sen.go.kr'),
       ('qtbbo',          'qtbbo@sonline20.sen.go.kr'),
       ('rladuswn2',      'rladuswn2@sonline20.sen.go.kr'),
       ('ssetcysm',       'ssetcysm@sonline20.sen.go.kr'),
       ('teach',          'teach@senedu.kr'),
       ('theprocess',     'theprocess@sonline20.sen.go.kr'),
       ('unite23',        'unite23@sonline20.sen.go.kr'),
       ('wbpark3355',     'wbpark3355@sonline20.sen.go.kr'),
       ('wildberry912',   'wildberry912@sonline20.sen.go.kr'),
       ('yoonjw823',      'yoonjw823@sonline20.sen.go.kr')
     ) AS v(name, email)
WHERE NOT EXISTS (
  SELECT 1 FROM teachers t WHERE t.email = v.email AND t.school_id = s.id
);
