const db = require('../../db');
const redis = require('../../src/config/redis.client');
const { Client } = require('@elastic/elasticsearch');
const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });

/**
 * [ELK] 우리들의 연대: 의제별 최신 4건
 * 해당 의제가 포함된 게시글들 중 작성일자 기준 내림차순으로 4개 조회
 */
exports.getOursByTopic = async (topicName) => {
    // 의제명이 들어오지 않으면 빈 배열 반환
    if (!topicName) return [];

    try {
        const response = await esClient.search({
            index: 'boards',
            size: 4, // 상위 4건만 추출
            query: {
                // 'match' 쿼리는 topics 필드 내에 해당 의제명이 포함되어 있는지 검색합니다.
                // (예: '복지,의료' 필드에서 '복지' 검색 시 매칭됨)
                match: { 
                    topics: topicName 
                }
            },
            // 최신순 정렬 (created_at 기준 내림차순)
            sort: [
                { created_at: { order: "desc" } }
            ]
        });

        // Elasticsearch 검색 결과에서 실제 데이터(_source)만 배열로 가공하여 반환
        return response.hits.hits.map(hit => hit._source);
    } catch (error) {
        console.error('Elasticsearch Search Error:', error);
        // 에러 발생 시 시스템 중단을 방지하기 위해 빈 배열 반환
        return [];
    }
};

/**
 * [Redis/MySQL] 글로벌 임박/실시간 연대 6건
 */
exports.getGlobalSolidarity = async (type) => {
    const cacheKey = `cache:main:${type}:global`;
    
    // 실시간(누적)은 1시간, 임박은 날짜 변경 대응을 위해 10분 유지
    const ttl = type === 'realtime' ? 3600 : 600;

    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    let query = '';
    if (type === 'imminent') {
        /**
         * [수정] 날짜 기준 마감 임박 로직
         * 1. end_date > NOW(): 이미 마감된 건 제외
         * 2. DATE(end_date) <= DATE_ADD(CURDATE(), INTERVAL 1 DAY): 
         * 오늘(CURDATE)부터 내일(INTERVAL 1 DAY) 날짜 끝까지 포함
         */
        query = `
            SELECT * FROM boards 
            WHERE end_date > NOW() 
              AND DATE(end_date) <= DATE_ADD(CURDATE(), INTERVAL 1 DAY)
            ORDER BY end_date ASC 
            LIMIT 6`;
    } else {
        // 전체 누적 응원순 (HOT 연대)
        query = `
            SELECT b.*, COUNT(c.id) AS cheer_count 
            FROM boards b
            LEFT JOIN cheers c ON b.id = c.board_id 
            GROUP BY b.id 
            ORDER BY cheer_count DESC, b.created_at DESC 
            LIMIT 6`;
    }

    const [rows] = await db.execute(query);
    await redis.setex(cacheKey, ttl, JSON.stringify(rows));
    return rows;
};

/**
 * [추가] 응원하기 (중복 체크 포함)
 */
exports.addCheer = async (userId, boardId) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const [existing] = await conn.execute(
            'SELECT id FROM cheers WHERE user_id = ? AND board_id = ?',
            [userId, boardId]
        );

        if (existing.length > 0) {
            throw new Error('ALREADY_CHEERED');
        }

        await conn.execute(
            'INSERT INTO cheers (user_id, board_id) VALUES (?, ?)',
            [userId, boardId]
        );

        // [핵심] 누적 응원순 캐시 즉시 삭제
        await redis.del('cache:main:realtime:global');

        await conn.commit();
        return { success: true };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
};

/**
 * [추가] 응원 취소
 */
exports.removeCheer = async (userId, boardId) => {
    try {
        const [result] = await db.execute(
            'DELETE FROM cheers WHERE user_id = ? AND board_id = ?',
            [userId, boardId]
        );

        if (result.affectedRows === 0) {
            throw new Error('NOT_CHEERED_YET');
        }

        // [핵심] 누적 응원순 캐시 즉시 삭제
        await redis.del('cache:main:realtime:global');

        return { success: true };
    } catch (error) {
        throw error;
    }
};