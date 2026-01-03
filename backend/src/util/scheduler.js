const cron = require('node-cron');
const { Client } = require('@elastic/elasticsearch');
const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });
const pool = require('../../db');
const emailService = require('./email.service');

/**
 * 정기 데이터 정리 작업 (매일 00:00 자정 실행)
 */
const startCleanupTask = () => {
    // 크론 표현식 수정: 분(0) 시(0) 일(*) 월(*) 요일(*)
    // '0 0 * * *' 은 매일 밤 12시 0분 0초를 의미합니다.
    cron.schedule('0 0 * * *', async () => {
        try {
            console.log(`[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] 자정 데이터 정리 시작 (30일 경과 데이터 삭제)`);

            const response = await esClient.deleteByQuery({
                index: 'boards',
                refresh: true,
                body: {
                    query: {
                        range: {
                            end_date: {
                                lt: "now-30d/d" // 종료일로부터 30일이 지난 데이터 삭제
                            }
                        }
                    }
                }
            });

            console.log(`정리 완료: ${response.deleted}개의 만료된 게시글이 삭제되었습니다.`);
        } catch (error) {
            console.error('자정 스케줄러 작업 중 오류 발생:', error);
        }
    }, {
        scheduled: true,
        timezone: "Asia/Seoul" // 반드시 한국 시간 기준으로 설정
    });

    console.log('매일 자정(00:00) ELK 데이터 정리 스케줄러가 활성화되었습니다.');
};

/**
 * 메일 발송 작업 (매일 10:00 실행)
 */
const startMailingTask = () => {
    // 매일 오전 10시 실행
    cron.schedule('0 10 * * *', async () => {
        try {
            const now = new Date();
            const dayOfWeek = ['일', '월', '화', '수', '목', '금', '토'][now.getDay()];

            console.log(`[${now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] 메일링 작업 시작 (${dayOfWeek}요일)`);

            const connection = await pool.getConnection();

            try {
                // 1. 메일 수신 동의한 개인 사용자 조회
                const usersSql = `
                    SELECT
                        u.id,
                        u.email,
                        ip.nickname,
                        ip.mailing_days,
                        ip.interests
                    FROM users u
                    INNER JOIN individual_profiles ip ON u.id = ip.user_id
                    WHERE ip.mailing_consent = true
                      AND ip.mailing_days IS NOT NULL
                      AND u.user_type = 'INDIVIDUAL'
                `;

                const [users] = await connection.query(usersSql);

                if (users.length === 0) {
                    console.log('메일 수신 동의한 사용자가 없습니다.');
                    return;
                }

                let interestMailCount = 0;
                let popularMailCount = 0;

                for (const user of users) {
                    try {
                        let mailingDays = [];
                        try {
                            mailingDays = JSON.parse(user.mailing_days);
                        } catch (e) {
                            console.error(`사용자 ${user.id}의 mailing_days 파싱 실패:`, e);
                            continue;
                        }

                        if (!Array.isArray(mailingDays) || mailingDays.length !== 2) {
                            console.log(`사용자 ${user.id}: 요일이 2개가 아님 (${mailingDays.length}개)`);
                            continue;
                        }

                        const [firstDay, secondDay] = mailingDays;

                        // 오늘이 첫 번째 요일인 경우: 관심 분야 미응원 게시글
                        if (dayOfWeek === firstDay) {
                            const posts = await getInterestPostsForUser(connection, user.id, user.interests);

                            if (posts.length > 0) {
                                // 랜덤으로 1개만 선택
                                const randomPost = posts[Math.floor(Math.random() * posts.length)];
                                await emailService.sendInterestPostsEmail(user.email, user.nickname, [randomPost]);
                                interestMailCount++;
                                console.log(`관심 분야 메일 발송: ${user.email}`);
                            } else {
                                console.log(`메일 발송 실패 사용자 ${user.email}: 발송할 관심 분야 게시글 없음`);
                            }
                        }
                        // 오늘이 두 번째 요일인 경우: 인기 게시글
                        else if (dayOfWeek === secondDay) {
                            const posts = await getPopularPostsForUser(connection, user.id, user.interests);

                            if (posts.length > 0) {
                                // 랜덤으로 1개만 선택
                                const randomPost = posts[Math.floor(Math.random() * posts.length)];
                                await emailService.sendPopularPostsEmail(user.email, user.nickname, [randomPost]);
                                popularMailCount++;
                                console.log(`인기 게시글 메일 발송: ${user.email}`);
                            } else {
                                console.log(`메일 발송 실패 사용자 ${user.email}: 발송할 인기 게시글 없음`);
                            }
                        }

                    } catch (userError) {
                        console.error(`사용자 ${user.email} 메일 발송 실패:`, userError);
                    }
                }

                console.log(`메일링 작업 완료: 관심분야 ${interestMailCount}건, 인기글 ${popularMailCount}건`);

            } finally {
                connection.release();
            }

        } catch (error) {
            console.error('메일링 스케줄러 작업 중 오류 발생:', error);
        }
    }, {
        scheduled: true,
        timezone: "Asia/Seoul"
    });

    console.log('매일 오전 10시 메일링 스케줄러가 활성화되었습니다.');
};

/**
 * 사용자의 관심 분야 중 응원하지 않은 게시글 조회
 */
async function getInterestPostsForUser(connection, userId, interests) {
    try {
        let interestArray = [];
        try {
            interestArray = JSON.parse(interests);
        } catch (e) {
            console.error(`사용자 ${userId}의 interests 파싱 실패:`, e);
            return [];
        }

        if (!Array.isArray(interestArray) || interestArray.length === 0) {
            return [];
        }

        const topicSql = `SELECT id FROM topics WHERE name IN (?)`;
        const [topics] = await connection.query(topicSql, [interestArray]);

        if (topics.length === 0) {
            return [];
        }

        const topicIds = topics.map(t => t.id);

        // 관심 분야 게시글 중 응원하지 않은 게시글 조회 (최근 7일)
        const postsSql = `
            SELECT DISTINCT
                b.id,
                b.title,
                b.content,
                b.link,
                b.created_at,
                GROUP_CONCAT(DISTINCT t.name SEPARATOR ', ') as topics
            FROM boards b
            INNER JOIN board_topics bt ON b.id = bt.board_id
            INNER JOIN topics t ON bt.topic_id = t.id
            LEFT JOIN cheers c ON b.id = c.board_id AND c.user_id = ?
            WHERE bt.topic_id IN (?)
              AND c.id IS NULL
              AND b.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY b.id
            ORDER BY b.created_at DESC
            LIMIT 5
        `;

        const [posts] = await connection.query(postsSql, [userId, topicIds]);

        return posts;

    } catch (error) {
        console.error('관심 분야 게시글 조회 실패:', error);
        return [];
    }
}

/**
 * 관심 분야 외의 인기 게시글 조회
 */
async function getPopularPostsForUser(connection, userId, interests) {
    try {
        let interestArray = [];
        try {
            interestArray = JSON.parse(interests);
        } catch (e) {
            console.error(`사용자 ${userId}의 interests 파싱 실패:`, e);
            return [];
        }

        let excludeTopicIds = [];

        if (Array.isArray(interestArray) && interestArray.length > 0) {
            // 사용자의 관심 분야에 해당하는 topic_id 조회
            const topicSql = `SELECT id FROM topics WHERE name IN (?)`;
            const [topics] = await connection.query(topicSql, [interestArray]);
            excludeTopicIds = topics.map(t => t.id);
        }

        // 관심 분야 외 게시글 중 최근 7일간 응원봉이 많은 게시글 조회
        let postsSql = `
            SELECT
                b.id,
                b.title,
                b.content,
                b.link,
                b.created_at,
                GROUP_CONCAT(DISTINCT t.name SEPARATOR ', ') as topics,
                COUNT(DISTINCT c.id) as cheer_count
            FROM boards b
            INNER JOIN board_topics bt ON b.id = bt.board_id
            INNER JOIN topics t ON bt.topic_id = t.id
            LEFT JOIN cheers c ON b.id = c.board_id
            WHERE b.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        `;

        let params = [];

        if (excludeTopicIds.length > 0) {
            postsSql += ` AND b.id NOT IN (
                SELECT board_id FROM board_topics WHERE topic_id IN (?)
            )`;
            params.push(excludeTopicIds);
        }

        postsSql += `
            GROUP BY b.id
            HAVING cheer_count > 0
            ORDER BY cheer_count DESC, b.created_at DESC
            LIMIT 3
        `;

        const [posts] = await connection.query(postsSql, params);

        return posts;

    } catch (error) {
        console.error('인기 게시글 조회 실패:', error);
        return [];
    }
}

module.exports = { startCleanupTask, startMailingTask };