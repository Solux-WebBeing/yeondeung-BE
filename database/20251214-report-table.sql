-- 신고 테이블 생성
CREATE TABLE IF NOT EXISTS reports (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    reporter_id BIGINT NOT NULL COMMENT '신고자 ID',
    board_id BIGINT NOT NULL COMMENT '신고된 게시글 ID',
    reason TEXT NOT NULL COMMENT '신고 사유 (10자 이상)',
    status ENUM('RECEIVED', 'REVIEWING', 'RESOLVED', 'REJECTED') DEFAULT 'RECEIVED' COMMENT '처리 상태',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_reports_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
    
    UNIQUE KEY unique_report (reporter_id, board_id)
) COMMENT '게시글 신고 내역';