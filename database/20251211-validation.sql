-- 허용된 도메인 테이블
CREATE TABLE IF NOT EXISTS allowed_domains (
    id INT PRIMARY KEY AUTO_INCREMENT,
    site_name VARCHAR(100) NOT NULL,
    domain_pattern VARCHAR(255) NOT NULL UNIQUE,
    detail_page_pattern VARCHAR(255)
);


INSERT INTO allowed_domains (site_name, domain_pattern, detail_page_pattern) VALUES
('구글 폼', 'https://docs.google.com/forms/*', 'https://docs.google.com/forms/*'),
('구글 폼(단축주소)', 'https://forms.gle/*', 'https://forms.gle/*'),
('청원24', 'https://www.cheongwon.go.kr/*', 'https://www.cheongwon.go.kr/portal/petition/open/viewdetail/*'),
('국회전자청원', 'https://petitions.assembly.go.kr/*', 'https://petitions.assembly.go.kr/proceed/onGoingAll/*'),
('국회입법예고', 'https://pal.assembly.go.kr/*', 'https://pal.assembly.go.kr/napal/lgsltpa/lgsltpaOngoing/*');


-- boards 테이블에 link, AI검사 추가
ALTER TABLE boards
    ADD COLUMN link VARCHAR(500),
    ADD COLUMN ai_verified BOOLEAN DEFAULT FALSE,
    MODIFY COLUMN is_verified BOOLEAN DEFAULT FALSE;

-- link에 인덱스 추가
CREATE INDEX idx_boards_link ON boards(link);
