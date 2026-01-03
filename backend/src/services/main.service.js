const db = require('../../db');
const redis = require('../../src/config/redis.client');
const { Client } = require('@elastic/elasticsearch');
const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });

/**
 * [공통] 데이터에 cheerCount, dDay, Thumbnail, isCheered 등을 병합하는 함수
 */
const enrichData = async (items, currentUserId = null) => {
    if (!items || items.length === 0) return [];

    const boardIds = items.map(item => item.id);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. 전체 응원수 조회
    const [cheerCounts] = await db.execute(
        `SELECT board_id, COUNT(*) as count FROM cheers WHERE board_id IN (${boardIds.join(',')}) GROUP BY board_id`
    );
    const cheerMap = cheerCounts.reduce((acc, cur) => { acc[cur.board_id] = cur.count; return acc; }, {});

    // 2. [추가] 로그인한 경우, 내가 응원한 글 목록 조회
    let myCheerSet = new Set();
    if (currentUserId) {
        const [myCheers] = await db.execute(
            `SELECT board_id FROM cheers WHERE user_id = ? AND board_id IN (${boardIds.join(',')})`,
            [currentUserId]
        );
        myCheerSet = new Set(myCheers.map(c => c.board_id));
    }

    // 3. 썸네일 이미지 조회
    const [images] = await db.execute(
        `SELECT board_id, image_url FROM board_images WHERE board_id IN (${boardIds.join(',')}) ORDER BY id ASC`
    );
    const imageMap = {};
    images.forEach(img => { if (!imageMap[img.board_id]) imageMap[img.board_id] = img.image_url; });

    const DEFAULT_THUMBNAIL = "https://your-domain.com/assets/default-thumbnail.png";

    // 4. UI 맞춤형 포맷팅
    return items.map(item => {
        const count = cheerMap[item.id] || 0;

        let dDay = "상시";
        let isTodayEnd = false;
        if (item.end_date) {
            const endDate = new Date(item.end_date);
            const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
            const diffDays = Math.ceil((endDateOnly - today) / (86400000));
            dDay = diffDays < 0 ? "마감" : diffDays === 0 ? "D-0" : `D-${diffDays}`;
            isTodayEnd = diffDays === 0;
        }

        const formatDate = (dateVal) => {
            if (!dateVal) return "";
            const d = new Date(dateVal);
            return isNaN(d.getTime()) ? "" : `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}`;
        };

        return {
            id: item.id,
            title: item.title,
            thumbnail: imageMap[item.id] || DEFAULT_THUMBNAIL,
            topics: item.topics ? (Array.isArray(item.topics) ? item.topics : item.topics.split(',')) : [],
            location: item.region ? `${item.region}${item.district ? ` > ${item.district}` : ""}` : "온라인/전국",
            dateDisplay: (item.start_date && item.end_date) 
                ? `${formatDate(item.start_date)} ~ ${formatDate(item.end_date)}`
                : (item.start_date ? formatDate(item.start_date) : "상시 진행"),
            cheerCount: count,
            isCheered: myCheerSet.has(item.id), // 로그인 유저 전용 필드
            isAuthor: currentUserId === item.user_id, // 본인 글 여부
            dDay,
            isTodayEnd,
            interestMessage: `${(item.topics && typeof item.topics === 'string' ? item.topics.split(',')[0] : (Array.isArray(item.topics) ? item.topics[0] : '사회'))} 의제 관심자 ${count}명이 연대합니다!`
        };
    });
};

/**
 * 1. 우리들의 연대 (userId 파라미터 추가)
 */
exports.getOursByTopic = async (topicName, userId = null) => {
    if (!topicName) return [];
    try {
        const topicList = topicName.split(',').map(t => t.trim());
        const response = await esClient.search({
            index: 'boards',
            size: 4,
            query: {
                bool: {
                    filter: [{ range: { end_date: { gte: "now-30d/d" } } }], // 검색과 동일하게 30일 여유
                    should: topicList.map(topic => ({ match_phrase: { topics: topic } })),
                    minimum_should_match: 1
                }
            },
            sort: [{ created_at: { order: "desc" } }]
        });
        return await enrichData(response.hits.hits.map(hit => hit._source), userId);
    } catch (error) {
        console.error('ES Error:', error);
        return [];
    }
};

/**
 * 2. 실시간/마감 연대 (userId 파라미터 추가 및 캐시 로직 수정)
 */
exports.getGlobalSolidarity = async (type, userId = null) => {
    // [중요] 로그인한 유저의 경우 isCheered가 달라지므로 캐시를 건너뛰거나 키를 분리해야 합니다.
    // 여기서는 간단하게 비로그인인 경우에만 레디스 캐시를 사용하도록 처리합니다.
    const cacheKey = `cache:main:${type}:global`;
    if (!userId) {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
    }

    let query = (type === 'imminent') 
        ? `SELECT * FROM boards WHERE end_date > NOW() AND DATE(end_date) <= DATE_ADD(CURDATE(), INTERVAL 1 DAY) ORDER BY end_date ASC`
        : `SELECT b.*, COUNT(c.id) AS recent_cheer_count FROM boards b 
           LEFT JOIN cheers c ON b.id = c.board_id AND c.created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) 
           WHERE b.end_date > NOW() GROUP BY b.id ORDER BY recent_cheer_count DESC, b.created_at DESC LIMIT 6`;

    let [rows] = await db.execute(query);

    // 실시간 HOT 데이터가 없을 경우 Fallback
    if (type === 'realtime' && rows.length === 0) {
        const fallbackQuery = `SELECT b.*, COUNT(c.id) AS total_cheer_count FROM boards b 
                               LEFT JOIN cheers c ON b.id = c.board_id WHERE b.end_date > NOW()
                               GROUP BY b.id ORDER BY total_cheer_count DESC LIMIT 6`;
        [rows] = await db.execute(fallbackQuery);
    }

    const result = await enrichData(rows, userId);

    if (!userId && result.length > 0) {
        await redis.setex(cacheKey, (type === 'realtime' ? 3600 : 600), JSON.stringify(result));
    }
    return result;
};