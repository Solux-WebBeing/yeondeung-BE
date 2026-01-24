-- 빠띰 -> 빠띠 이름 수정
UPDATE allowed_domains SET site_name = '빠띠' WHERE site_name = '빠띰';

-- allowed_types 컬럼 추가
ALTER TABLE allowed_domains ADD COLUMN allowed_types VARCHAR(255);

-- 청원용 도메인 설정
UPDATE allowed_domains SET allowed_types = '청원'
WHERE site_name IN ('청원24', '국회전자청원', '국회입법예고');

-- 서명/탄원용 도메인 설정
UPDATE allowed_domains SET allowed_types = '서명,탄원'
WHERE site_name IN ('빠띠', '구글 폼', '구글 폼(단축주소)');
