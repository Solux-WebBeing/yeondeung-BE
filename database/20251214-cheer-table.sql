CREATE TABLE IF NOT EXISTS cheers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    board_id BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_cheers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_cheers_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
    
    UNIQUE KEY unique_cheer (user_id, board_id)
) COMMENT '게시글 응원봉(좋아요) 관리';