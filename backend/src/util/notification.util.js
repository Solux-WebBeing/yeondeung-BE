const pool = require('../../db');

/**
 * 날짜 포맷 변환 (YYYY.MM.DD)
 */
const formatDate = (date) => {
    if (!date) return '';
    const d = new Date(date);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * 랜덤 알림 문구 생성
 */
const getRandomMessage = (topicName) => {
    const templates = [
        `✨ 관심 가져주실만한 ‘${topicName}’ 의제 활동이에요!`,
        `📢 우리의 목소리에 힘을 더해주세요`,
        `🏃 새로운 ‘${topicName}’ 의제 활동이 등록됐어요!`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
};

/**
 * 게시글 등록 시 관련 유저들에게 알림 생성
 */
exports.sendActivityNotifications = async (connection, boardData) => {
    // boardData에서 작성자 ID(author_id)를 추가로 받습니다.
    const { id, author_id, participation_type, title, topics, start_date, end_date, region, district, images } = boardData;
    
    // 1. 해당 게시글의 의제 ID 목록 가져오기
    const topicNames = topics.split(',').map(t => t.trim());
    const [topicRows] = await connection.query('SELECT id, name FROM topics WHERE name IN (?)', [topicNames]);
    const topicIds = topicRows.map(r => r.id);
    const firstTopicName = topicRows[0]?.name || '';

    // 2. 관심 분야가 일치하는 사용자 조회 (작성자 본인 제외 추가)
    const [targetUsers] = await connection.query(
        `SELECT DISTINCT user_id FROM user_interests 
         WHERE topic_id IN (?) AND user_id != ?`, // 작성자 제외 조건 추가
        [topicIds, author_id]
    );

    if (targetUsers.length === 0) return;

    const thumbnailUrl = images && images.length > 0 ? images[0] : null;
    const message = getRandomMessage(firstTopicName);

    for (const user of targetUsers) {
        // 3. 알림 삽입
        await connection.query(
            `INSERT INTO notifications 
            (user_id, board_id, participation_type, title, thumbnail_url, start_date, end_date, region, district, message) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [user.user_id, id, participation_type, title, thumbnailUrl, start_date, end_date, region, district, message]
        );

        // 4. 사용자별 최대 10개 유지 (생략 가능, 기존 로직 유지)
        await connection.query(
            `DELETE FROM notifications 
             WHERE user_id = ? 
             AND id NOT IN (
                 SELECT id FROM (
                     SELECT id FROM notifications 
                     WHERE user_id = ? 
                     ORDER BY created_at DESC 
                     LIMIT 10
                 ) as tmp
             )`,
            [user.user_id, user.user_id]
        );
    }
};