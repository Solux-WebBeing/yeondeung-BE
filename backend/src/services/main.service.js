const db = require('../../db');
const redis = require('../../src/config/redis.client');
const { Client } = require('@elastic/elasticsearch');
const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });

/**
 * [공통] 데이터에 cheerCount와 dDay를 병합하는 함수
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

    // 2. UI 맞춤형 포맷팅
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

        /**
         * [수정 포인트] 날짜 포맷팅 함수
         * substring 대신 Date 객체 메서드를 사용하여 안전하게 변환합니다.
         */
        const formatDate = (dateVal) => {
            if (!dateVal) return "";
            const d = new Date(dateVal); // 어떤 형식이든 Date 객체로 변환
            if (isNaN(d.getTime())) return ""; // 유효하지 않은 날짜 처리
            
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            
            return `${year}. ${month}. ${day}`; // "2025. 12. 30"
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
            // [추가 수정] topics가 이미 배열인 경우(ELK)와 문자열인 경우(MySQL) 모두 대응
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
 * 수정사항: 검색 컨트롤러와 동일하게 다중 의제에 대한 OR 연산 적용
 */
exports.getOursByTopic = async (topicName) => {
    // 의제명이 들어오지 않으면 빈 배열 반환
    if (!topicName) return [];

    try {
        // 쉼표로 구분된 의제들을 배열로 분리
        const topicList = topicName.split(',').map(t => t.trim());

        const response = await esClient.search({
            index: 'boards',
            size: 4, // 상위 4건만 추출
            query: {
                bool: {
                    // should 내의 조건 중 하나라도 매칭되면 결과에 포함 (OR 연산)
                    should: topicList.map(topic => ({
                        match_phrase: { topics: topic }
                    })),
                    minimum_should_match: 1
                }
            },
            // 최신순 정렬 (created_at 기준 내림차순)
            sort: [
                { created_at: { order: "desc" } }
            ]
        });

        const results = response.hits.hits.map(hit => hit._source);
        
        // 결과 데이터에 응원수와 디데이 및 UI 포맷 추가
        return await enrichData(results); 
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
            SELECT b.* FROM boards b
            LEFT JOIN cheers c ON b.id = c.board_id 
            GROUP BY b.id 
            ORDER BY COUNT(c.id) DESC, b.created_at DESC 
            LIMIT 6`;
    }

    const [rows] = await db.execute(query);

    // [수정] DB에서 가져온 로우 데이터를 가공함
    const enrichedDataResult = await enrichData(rows);

    // [수정] 가공된(응원수와 디데이가 포함된) 데이터를 Redis에 저장
    if (enrichedDataResult.length > 0) {
        await redis.setex(cacheKey, ttl, JSON.stringify(enrichedDataResult));
    }

    return enrichedDataResult;
};