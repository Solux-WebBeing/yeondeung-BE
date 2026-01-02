const db = require('../../db');
const redis = require('../../src/config/redis.client');
const { Client } = require('@elastic/elasticsearch');
const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });

/**
 * [공통] 데이터에 cheerCount, dDay, Thumbnail을 병합하는 함수
 */
const enrichData = async (items) => {
    if (!items || items.length === 0) return [];

    const boardIds = items.map(item => item.id);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. 응원수 조회
    const [cheerCounts] = await db.execute(
        `SELECT board_id, COUNT(*) as count FROM cheers WHERE board_id IN (${boardIds.join(',')}) GROUP BY board_id`
    );

    const cheerMap = cheerCounts.reduce((acc, cur) => {
        acc[cur.board_id] = cur.count;
        return acc;
    }, {});

    // ============================================================
    // [추가] 2. 썸네일 이미지 조회
    // ============================================================
    // board_id에 해당하는 이미지를 id 오름차순(등록순)으로 가져옵니다.
    const [images] = await db.execute(
        `SELECT board_id, image_url FROM board_images WHERE board_id IN (${boardIds.join(',')}) ORDER BY id ASC`
    );

    const imageMap = {};
    images.forEach(img => {
        // 이미 해당 board_id의 이미지가 맵에 있다면 패스 (첫 번째 이미지만 저장)
        if (!imageMap[img.board_id]) {
            imageMap[img.board_id] = img.image_url;
        }
    });

    // 기본 이미지 URL (프로젝트 상황에 맞춰 수정)
    const DEFAULT_THUMBNAIL = "https://your-domain.com/assets/default-thumbnail.png";
    // ============================================================

    // 3. UI 맞춤형 포맷팅
    return items.map(item => {
        const count = cheerMap[item.id] || 0;

        // D-Day 및 오늘 종료 배지 계산
        let dDay = "상시";
        let isTodayEnd = false;
        if (item.end_date) {
            const endDate = new Date(item.end_date);
            const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
            const diffDays = Math.ceil((endDateOnly - today) / (1000 * 60 * 60 * 24));
            
            dDay = diffDays < 0 ? "마감" : diffDays === 0 ? "D-0" : `D-${diffDays}`;
            isTodayEnd = diffDays === 0;
        }

        const formatDate = (dateVal) => {
            if (!dateVal) return "";
            const d = new Date(dateVal);
            if (isNaN(d.getTime())) return "";
            
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            
            return `${year}. ${month}. ${day}`;
        };

        const dateRange = (item.start_date && item.end_date) 
            ? `${formatDate(item.start_date)} ~ ${formatDate(item.end_date)}`
            : (item.start_date ? formatDate(item.start_date) : "상시 진행");

        const locationDisplay = item.region 
            ? `${item.region}${item.district ? ` > ${item.district}` : ""}` 
            : "온라인/전국";

        return {
            id: item.id,
            title: item.title,
            // [추가] 썸네일 필드
            thumbnail: imageMap[item.id] || DEFAULT_THUMBNAIL,
            
            topics: item.topics ? (Array.isArray(item.topics) ? item.topics : item.topics.split(',')) : [],
            location: locationDisplay,
            dateDisplay: dateRange,
            cheerCount: count,
            dDay: dDay,
            isTodayEnd: isTodayEnd,
            interestMessage: `${(item.topics && typeof item.topics === 'string' ? item.topics.split(',')[0] : (Array.isArray(item.topics) ? item.topics[0] : '사회'))} 의제에 관심이 있는 ${count}명이 연대합니다!`
        };
    });
};

/**
 * 1. 우리들의 연대 (ELK 검색 후 데이터 보강)
 */
exports.getOursByTopic = async (topicName) => {
    if (!topicName) return [];

    try {
        const topicList = topicName.split(',').map(t => t.trim());

        const response = await esClient.search({
            index: 'boards',
            size: 4,
            query: {
                bool: {
                    filter: [
                        { range: { end_date: { gte: "now" } } }
                    ],
                    should: topicList.map(topic => ({
                        match_phrase: { topics: topic }
                    })),
                    minimum_should_match: 1
                }
            },
            sort: [
                { created_at: { order: "desc" } }
            ]
        });

        const results = response.hits.hits.map(hit => hit._source);
        return await enrichData(results); // 여기서 썸네일 포함됨
    } catch (error) {
        console.error('Elasticsearch Search Error:', error);
        return [];
    }
};

/**
 * 2. 실시간/마감 연대 (MySQL 조회 후 데이터 보강 및 캐싱)
 */
exports.getGlobalSolidarity = async (type) => {
    const cacheKey = `cache:main:${type}:global`;
    const ttl = type === 'realtime' ? 3600 : 600;

    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    let query = '';
    
    if (type === 'imminent') {
        query = `
            SELECT * FROM boards 
            WHERE end_date > NOW() 
              AND DATE(end_date) <= DATE_ADD(CURDATE(), INTERVAL 1 DAY)
            ORDER BY end_date ASC`;
    } else {
        query = `
            SELECT b.*, COUNT(c.id) AS recent_cheer_count
            FROM boards b
            LEFT JOIN cheers c ON b.id = c.board_id 
              AND c.created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) 
            WHERE b.end_date > NOW()
            GROUP BY b.id 
            ORDER BY recent_cheer_count DESC, b.created_at DESC 
            LIMIT 6`;
    }

    let [rows] = await db.execute(query);

    if (type === 'realtime') {
        const totalRecentCheers = rows.reduce((sum, row) => sum + Number(row.recent_cheer_count || 0), 0);
        
        if (totalRecentCheers === 0) {
            const fallbackQuery = `
                SELECT b.*, COUNT(c.id) AS total_cheer_count
                FROM boards b
                LEFT JOIN cheers c ON b.id = c.board_id 
                WHERE b.end_date > NOW()
                GROUP BY b.id 
                ORDER BY total_cheer_count DESC, b.created_at DESC 
                LIMIT 6`;
            [rows] = await db.execute(fallbackQuery);
        }
    }

    const enrichedDataResult = await enrichData(rows); // 여기서 썸네일 포함됨

    if (enrichedDataResult.length > 0) {
        await redis.setex(cacheKey, ttl, JSON.stringify(enrichedDataResult));
    }

    return enrichedDataResult;
};