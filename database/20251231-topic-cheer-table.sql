CREATE TABLE topics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

-- 14개 의제 초기 데이터 삽입
INSERT INTO topics (name) VALUES 
('여성'), ('청소년'), ('노동자'), ('성소수자'), ('농민'), ('장애인'), 
('교육'), ('범죄/사법'), ('복지'), ('의료'), ('환경'), ('인권'), 
('추모/기억'), ('동물권');
-- 2. 유저-관심사 연결 테이블 (user_id 참조)
CREATE TABLE IF NOT EXISTS user_interests (
    user_id BIGINT NOT NULL, 
    topic_id INT NOT NULL,
    PRIMARY KEY (user_id, topic_id),
    FOREIGN KEY (user_id) REFERENCES individual_profiles(user_id) ON DELETE CASCADE,
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
);

-- 3. 게시글-의제 연결 테이블 (id 참조)
CREATE TABLE IF NOT EXISTS board_topics (
    board_id BIGINT NOT NULL,
    topic_id INT NOT NULL,
    PRIMARY KEY (board_id, topic_id),
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
);

