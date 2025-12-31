// md.js
const pool = require('./db'); // 본인의 db 연결 파일 경로에 맞게 수정

async function migrateData() {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        console.log('데이터 이관을 시작합니다...');

        // 1. 의제 ID 매핑 정보 가져오기
        const [topicRows] = await connection.query('SELECT id, name FROM topics');
        const topicMap = {};
        topicRows.forEach(row => topicMap[row.name] = row.id);

        // 2. 유저 관심사 이관 (JSON 형태 대응)
        const [users] = await connection.query('SELECT user_id, interests FROM individual_profiles WHERE interests IS NOT NULL');
        for (const user of users) {
            let interestList = [];
            try {
                // 데이터가 '["여성"]' 형태면 JSON.parse, 아니면 콤마 분리
                const rawInterests = user.interests.trim();
                interestList = rawInterests.startsWith('[') ? JSON.parse(rawInterests) : rawInterests.split(',').map(i => i.trim());
                
                for (const name of interestList) {
                    const tid = topicMap[name];
                    if (tid) {
                        await connection.query(
                            'INSERT IGNORE INTO user_interests (user_id, topic_id) VALUES (?, ?)',
                            [user.user_id, tid]
                        );
                    }
                }
            } catch (e) {
                console.warn(`유저(${user.user_id}) 데이터 파싱 스킵: ${user.interests}`);
            }
        }

        // 3. 게시글 의제 이관 (콤마 형태 대응)
        const [boards] = await connection.query('SELECT id, topics FROM boards WHERE topics IS NOT NULL');
        for (const board of boards) {
            const topicList = board.topics.split(',').map(t => t.trim());
            for (const name of topicList) {
                const tid = topicMap[name];
                if (tid) {
                    await connection.query(
                        'INSERT IGNORE INTO board_topics (board_id, topic_id) VALUES (?, ?)',
                        [board.id, tid]
                    );
                }
            }
        }

        await connection.commit();
        console.log('이관 성공! 이제 새 테이블을 사용할 수 있습니다.');
    } catch (err) {
        await connection.rollback();
        console.error('이관 실패:', err);
    } finally {
        connection.release();
        process.exit(); // 작업 완료 후 프로세스 종료
    }
}

migrateData();