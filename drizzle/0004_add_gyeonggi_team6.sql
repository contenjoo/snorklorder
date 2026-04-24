-- Add 경기 6팀 (Gyeonggi Team 6) schools + teachers
-- Source: MARKET GroupPurchaseTeam (cmo7xsmkk000104jmw8eykpqb), completed 2026-04-20
-- Note: MARKET의 '경기도교육청' 등록은 '경기도자동차과학고등학교'로 변경하여 등록
-- (실제 소속 학교가 경기도자동차과학고등학교임)

INSERT INTO schools (name, name_en, code, region, team, domain) VALUES
  ('경기도자동차과학고등학교', 'Gyeonggi Automotive Science High School', 'GGAUTOSCI', '경기', '경기6팀', NULL),
  ('위례중학교', 'Wirye Middle School', 'WIRYEMS', '경기', '경기6팀', NULL),
  ('초당고등학교', 'Chodang High School', 'CHODANGHS', '경기', '경기6팀', NULL),
  ('목암중학교', 'Mogam Middle School', 'MOGAM', '경기', '경기6팀', NULL),
  ('내촌중학교', 'Naechon Middle School', 'NAECHON', '경기', '경기6팀', 'goedu.kr')
ON CONFLICT (code) DO NOTHING;

-- Teachers (one per school)
INSERT INTO teachers (school_id, name, email, status)
SELECT s.id, v.name, v.email, 'pending'
FROM (VALUES
  ('GGAUTOSCI', '허영주', 'whatisaid85@gmail.com'),
  ('WIRYEMS',   '장경임', 'light9866@naver.com'),
  ('CHODANGHS', '권의선', 'kesiawase@gmail.com'),
  ('MOGAM',     '박희원', 'fadeout00@gmail.com'),
  ('NAECHON',   '송병찬', 'sbc1151@goedu.kr')
) AS v(code, name, email)
JOIN schools s ON s.code = v.code
WHERE NOT EXISTS (
  SELECT 1 FROM teachers t WHERE t.email = v.email AND t.school_id = s.id
);
