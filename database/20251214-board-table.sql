-- 외래 키 검사 비활성화
SET FOREIGN_KEY_CHECKS = 0;

-- 기존 테이블 삭제 (충돌 방지)
DROP TABLE IF EXISTS board_images;
DROP TABLE IF EXISTS boards;

-- 1. Boards 테이블
CREATE TABLE boards (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    
    user_id BIGINT NOT NULL,
    
    participation_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL COMMENT '게시글 제목',
    topics VARCHAR(200) NOT NULL COMMENT '의제',
    is_verified BOOLEAN DEFAULT FALSE,
    start_date DATETIME,
    end_date DATETIME,
    content TEXT NOT NULL,
    
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

-- 외래 키 검사 재활성화
SET FOREIGN_KEY_CHECKS = 1;