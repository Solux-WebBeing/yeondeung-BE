const db = require('../../db');
const redis = require('../../src/config/redis.client');
const { Client } = require('@elastic/elasticsearch');
const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });

/**
 * [공통] 데이터에 cheerCount, dDay, Thumbnail, isCheered, host_type 등을 병합하는 함수
 */
const enrichData = async (items, currentUserId = null) => {
    if (!items || items.length === 0) return [];

    const boardIds = items.map(item => item.id);
    const userIds = [...new Set(items.map(item => item.user_id).filter(id => id))];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. 전체 응원수 조회
    const [cheerCounts] = await db.execute(
        `SELECT board_id, COUNT(*) as count FROM cheers WHERE board_id IN (${boardIds.join(',')}) GROUP BY board_id`
    );
    const cheerMap = cheerCounts.reduce((acc, cur) => { acc[cur.board_id] = cur.count; return acc; }, {});

    // 2. [로그인 시 전용] 
    //    A. 내가 응원한 글 목록 조회
    //    B. [추가] 나의 관심사(Topics) 조회
    let myCheerSet = new Set();
    let myInterestTopics = []; // 로그인한 유저의 관심사 저장

    if (currentUserId) {
        // A. 응원 여부 확인
        const [myCheers] = await db.execute(
            `SELECT board_id FROM cheers WHERE user_id = ? AND board_id IN (${boardIds.join(',')})`,
            [currentUserId]
        );
        myCheerSet = new Set(myCheers.map(c => c.board_id));

        // B. 내 관심사 조회 (users 테이블에 topics 컬럼이 있다고 가정)
        try {
            const [userInfo] = await db.execute(
                `SELECT topics FROM users WHERE id = ?`,
                [currentUserId]
            );
            if (userInfo.length > 0 && userInfo[0].topics) {
                // DB에 '여성,기후' 처럼 저장된 경우 배열로 변환
                myInterestTopics = Array.isArray(userInfo[0].topics)
                    ? userInfo[0].topics
                    : userInfo[0].topics.split(',').map(t => t.trim());
            }
        } catch (err) {
            console.error("User Interest Fetch Error:", err);
        }
    }

    // 3. 썸네일 이미지 조회
    const [images] = await db.execute(
        `SELECT board_id, image_url FROM board_images WHERE board_id IN (${boardIds.join(',')}) ORDER BY id ASC`
    );
    const imageMap = {};
    images.forEach(img => { if (!imageMap[img.board_id]) imageMap[img.board_id] = img.image_url; });

    // 4. 작성자(Users) 정보 조회 (host_type 해결)
    const userMap = {};
    if (userIds.length > 0) {
        const [users] = await db.execute(
            `SELECT id, user_type FROM users WHERE id IN (${userIds.join(',')})`
        );
        
        users.forEach(u => {
            let typeStr = "기타";
            if (u.user_type === 0 || u.user_type === "individual") typeStr = "individual";
            else if (u.user_type === 1 || u.user_type === "organization") typeStr = "organization";
            else if (u.user_type) typeStr = u.user_type; 

            userMap[u.id] = typeStr;
        });
    }

    const DEFAULT_THUMBNAIL = "https://your-domain.com/assets/default-thumbnail.png";

    // 5. UI 맞춤형 포맷팅
    return items.map(item => {
        const count = cheerMap[item.id] || 0;

        // 게시글 토픽 파싱
        const topicArray = item.topics 
            ? (Array.isArray(item.topics) ? item.topics : item.topics.split(',').map(t => t.trim())) 
            : [];

        // [로직 수정] 맞춤형 토픽 선정
        let displayTopic = "사회";
        
        if (topicArray.length > 0) {
            // 1순위: 내 관심사와 게시글 주제의 교집합 확인
            const matchingTopics = topicArray.filter(t => myInterestTopics.includes(t));

            if (matchingTopics.length > 0) {
                // 교집합 중 하나 선택 (예: 내가 '여성' 관심 있고, 글도 '여성'이면 '여성' 선택)
                const randomIndex = Math.floor(Math.random() * matchingTopics.length);
                displayTopic = matchingTopics[randomIndex];
            } else {
                // 2순위: 겹치는게 없으면 게시글 주제 중 랜덤 선택
                const randomIndex = Math.floor(Math.random() * topicArray.length);
                displayTopic = topicArray[randomIndex];
            }
        }

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

        const finalHostType = userMap[item.user_id] || item.host_type || "기타";

        return {
            id: item.id,
            title: item.title,
            thumbnail: imageMap[item.id] || DEFAULT_THUMBNAIL,
            topics: topicArray, 
            location: item.region ? `${item.region}${item.district ? ` > ${item.district}` : ""}` : "온라인/전국",
            region: item.region || "온라인",
            district: item.district || "",
            dateDisplay: (item.start_date && item.end_date) 
                ? `${formatDate(item.start_date)} ~ ${formatDate(item.end_date)}`
                : (item.start_date ? formatDate(item.start_date) : "상시 진행"),
            start_date: item.start_date,
            end_date: item.end_date,
            cheerCount: count,
            isCheered: myCheerSet.has(item.id),
            isAuthor: currentUserId === item.user_id,
            host_type: finalHostType,
            dDay,
            isTodayEnd,
            // [결과] 우선순위에 따라 선정된 displayTopic 사용
            interestMessage: `${displayTopic} 의제에 관심이 있는 ${count}명이 연대합니다!`
        };
    });
};

/**
 * 1. 우리들의 연대 (userId 파라미터 추가)
 * 주제(topicName)들 중 하나라도 포함된 게시글을 최신순으로 가져옵니다. (OR 연산)
 */
exports.getOursByTopic = async (topicName, userId = null) => {
    if (!topicName) return [];
    try {
        // 쉼표로 구분된 토픽들을 배열로 변환
        const topicList = topicName.split(',').map(t => t.trim()).filter(Boolean);
        
        const response = await esClient.search({
            index: 'boards',
            size: 4,
            query: {
                bool: {
                    // 1. 기간 필터 (최근 30일 이내 마감된 것부터 미래 마감까지)
                    filter: [
                        { range: { end_date: { gte: "now-30d/d" } } }
                    ],
                    // 2. [핵심] 토픽 합집합(OR) 연산
                    must: [
                        {
                            bool: {
                                // topicList 중 하나라도 포함되면 매칭
                                should: topicList.map(topic => ({
                                    match_phrase: { topics: topic }
                                })),
                                minimum_should_match: 1
                            }
                        }
                    ]
                }
            },
            // 3. 정렬: 무조건 등록일 최신순
            sort: [
                { "created_at": { "order": "desc" } }
            ]
        });

        // 데이터 가공 및 반환
        return await enrichData(response.hits.hits.map(hit => hit._source), userId);
    } catch (error) {
        console.error('getOursByTopic ES Error:', error);
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
        ? `SELECT * FROM boards 
        WHERE end_date > NOW() 
        AND DATE(end_date) = CURDATE() 
        ORDER BY end_date ASC`
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