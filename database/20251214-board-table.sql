-- 외래 키 검사 비활성화
SET FOREIGN_KEY_CHECKS = 0;

-- 기존 테이블 삭제 (충돌 방지)
DROP TABLE IF EXISTS board_images;
DROP TABLE IF EXISTS boards;

-- 1. Boards 테이블 (누락된 link, ai_verified 및 시간 관련 필드 통합)
CREATE TABLE boards (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    
    user_id BIGINT NOT NULL,
    
    participation_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL COMMENT '게시글 제목',
    topics VARCHAR(200) NOT NULL COMMENT '의제',
    content TEXT NOT NULL,
    
    link VARCHAR(500) COMMENT '참여 링크', -- [필수] 링크 및 검증 관련 컬럼 추가
    is_verified BOOLEAN DEFAULT FALSE COMMENT '관리자 검증 여부',
    ai_verified BOOLEAN DEFAULT FALSE COMMENT 'AI 검증 여부',

    start_date DATETIME, -- 시작/종료 일시 및 시간 설정 여부
    end_date DATETIME,
    is_start_time_set BOOLEAN DEFAULT FALSE,
    is_end_time_set BOOLEAN DEFAULT FALSE,
    
    region VARCHAR(100) COMMENT '시/도 (집회/행사 시 필수)',
    district VARCHAR(100) COMMENT '시/군/구 (집회/행사 시 필수)',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_boards_user 
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) COMMENT '게시글 및 행사 정보';

-- 2. Board Images 테이블
CREATE TABLE board_images (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    board_id BIGINT NOT NULL,
    image_url VARCHAR(2048) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_board_images_board 
        FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
) COMMENT '게시글 첨부 이미지';

-- link에 인덱스 추가 (중복 검사 성능 향상)
CREATE INDEX idx_boards_link ON boards(link);

-- 외래 키 검사 재활성화
SET FOREIGN_KEY_CHECKS = 1;