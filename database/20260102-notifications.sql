-- 외래 키 검사 비활성화
SET FOREIGN_KEY_CHECKS = 0;

-- 기존 테이블 삭제 (초기화)
DROP TABLE IF EXISTS notifications;

-- 알림 테이블 생성
CREATE TABLE notifications (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL COMMENT '알림을 받을 사용자 ID',
    board_id BIGINT NOT NULL COMMENT '연결된 게시글 ID',
    
    participation_type VARCHAR(50) NOT NULL COMMENT '활동 유형 (집회/행사 등)',
    title VARCHAR(255) NOT NULL COMMENT '게시글 제목',
    thumbnail_url VARCHAR(2048) COMMENT '게시글 썸네일 (첫 번째 이미지)',
    
    start_date DATETIME COMMENT '시작 일시',
    end_date DATETIME COMMENT '종료 일시',
    region VARCHAR(100) COMMENT '시/도',
    district VARCHAR(100) COMMENT '시/군/구',
    
    message TEXT NOT NULL COMMENT '알림 문구',
    is_read BOOLEAN DEFAULT FALSE COMMENT '읽음 여부',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_notifications_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
) COMMENT '사용자별 활동 알림 내역';

-- 사용자별 최신 10개 조회를 위한 인덱스 추가
CREATE INDEX idx_user_notifications ON notifications (user_id, created_at DESC);

-- 알림 테이블 제약 조건 완화 (게시글 외 알림 지원)
ALTER TABLE notifications 
MODIFY COLUMN board_id BIGINT NULL COMMENT '연결된 게시글 ID (시스템 알림의 경우 NULL)',
MODIFY COLUMN participation_type VARCHAR(50) NULL COMMENT '활동 유형',
MODIFY COLUMN title VARCHAR(255) NULL COMMENT '게시글 제목';

-- 알림 테이블에 반려 사유 컬럼 추가
ALTER TABLE notifications 
ADD COLUMN reject_reason TEXT NULL COMMENT '반려 사유 (시스템 알림용)';

-- 외래 키 검사 재활성화
SET FOREIGN_KEY_CHECKS = 1;