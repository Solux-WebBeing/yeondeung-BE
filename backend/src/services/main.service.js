const db = require('../../db');
const redis = require('../../src/config/redis.client');
const { Client } = require('@elastic/elasticsearch');
const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });

/**
 * [Helper] MySQL 데이터 보강 및 UI 가공 공통 함수 (정규화된 스키마 대응)
 */
async function enrichData(results, currentUserId = null) {
    if (!results || results.length === 0) return [];
    
    const boardIds = results.map(post => post.id);
    // user_id만 뽑아서 중복 제거 (작성자 정보 조회용)
    const userIds = [...new Set(results.map(post => post.user_id).filter(id => id))];

    // ==================================================================================
    // 1. [게시글 주제] board_topics + topics 테이블 조인하여 게시글별 주제 목록 가져오기
    // ==================================================================================
    const [boardTopicRows] = await pool.query(
        `SELECT bt.board_id, t.name 
         FROM board_topics bt
         JOIN topics t ON bt.topic_id = t.id
         WHERE bt.board_id IN (?)`,
        [boardIds]
    );

    // Map 구조로 변환: { board_id: ['여성', '노동'], ... }
    const boardTopicsMap = {};
    boardTopicRows.forEach(row => {
        if (!boardTopicsMap[row.board_id]) boardTopicsMap[row.board_id] = [];
        boardTopicsMap[row.board_id].push(row.name);
    });

    // ==================================================================================
    // 2. [응원 통계] 
    //    A. 전체 응원 수 (cheerCount)
    //    B. 특정 주제에 관심있는 응원자 수 (interestMessage 계산용)
    // ==================================================================================
    
    // A. 전체 응원 수
    const [totalCheers] = await pool.query(
        `SELECT board_id, COUNT(*) as count FROM cheers WHERE board_id IN (?) GROUP BY board_id`,
        [boardIds]
    );
    const cheerMap = totalCheers.reduce((acc, cur) => { acc[cur.board_id] = cur.count; return acc; }, {});

    // B. "게시글별" + "주제별" 응원자 수 카운트 (중복 제거)
    // 설명: cheers 테이블에서 해당 글에 응원한 사람을 찾고 -> user_interests를 통해 그 사람의 관심사를 찾음
    const [cheererInterestRows] = await pool.query(
        `SELECT c.board_id, t.name as topic_name, COUNT(DISTINCT c.user_id) as count
         FROM cheers c
         JOIN user_interests ui ON c.user_id = ui.user_id
         JOIN topics t ON ui.topic_id = t.id
         WHERE c.board_id IN (?)
         GROUP BY c.board_id, t.name`,
        [boardIds]
    );

    // Map 구조로 변환: { board_id: { '여성': 5, '기후': 2 } }
    const cheererInterestMap = {};
    cheererInterestRows.forEach(row => {
        if (!cheererInterestMap[row.board_id]) cheererInterestMap[row.board_id] = {};
        cheererInterestMap[row.board_id][row.topic_name] = row.count;
    });

    // ==================================================================================
    // 3. [로그인 유저] 내 응원 여부 & 내 관심사 조회
    // ==================================================================================
    let userCheerSet = new Set();
    let myInterestTopics = []; 

    if (currentUserId) {
        // A. 내가 응원했는지
        const [userCheers] = await pool.query(
            `SELECT board_id FROM cheers WHERE user_id = ? AND board_id IN (?)`,
            [currentUserId, boardIds]
        );
        userCheerSet = new Set(userCheers.map(c => c.board_id));

        // B. 내 관심사 조회 (user_interests 테이블 사용)
        try {
            const [myInterests] = await pool.query(
                `SELECT t.name 
                 FROM user_interests ui
                 JOIN topics t ON ui.topic_id = t.id
                 WHERE ui.user_id = ?`,
                [currentUserId]
            );
            myInterestTopics = myInterests.map(row => row.name);
        } catch (err) {
            console.error("User Interest Fetch Error:", err);
        }
    }

    // ==================================================================================
    // 4. 기타 정보 (이미지, 작성자 타입)
    // ==================================================================================
    // 썸네일
    const [boardImages] = await pool.query(
        `SELECT board_id, image_url FROM board_images WHERE board_id IN (?) ORDER BY id ASC`,
        [boardIds]
    );
    const imageMap = {};
    boardImages.forEach(img => { if (!imageMap[img.board_id]) imageMap[img.board_id] = img.image_url; });

    // 작성자 정보
    const userMap = {};
    if (userIds.length > 0) {
        const [users] = await pool.query(
            `SELECT id, user_type FROM users WHERE id IN (?)`, 
            [userIds]
        );
        users.forEach(u => {
            let typeStr = "기타";
            // DB 값에 따라 매핑 (환경에 맞게 수정하세요)
            if (u.user_type === 0 || u.user_type === 'individual') typeStr = "individual";
            else if (u.user_type === 1 || u.user_type === 'organization') typeStr = "organization";
            else typeStr = u.user_type || "기타";
            userMap[u.id] = typeStr;
        });
    }

    const today = new Date();
    const todayCompare = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

    // ==================================================================================
    // 5. 데이터 병합 및 UI 로직 적용
    // ==================================================================================
    return results.map(post => {
        // 1) 게시글 주제 가져오기 (DB에서 가져온 Map 사용)
        const currentTopics = boardTopicsMap[post.id] || [];
        
        // 2) 표시할 주제(Display Topic) 선정
        let displayTopic = "사회"; 
        
        if (currentTopics.length > 0) {
            // 내 관심사와 교집합 확인
            const matchingTopics = currentTopics.filter(topic => myInterestTopics.includes(topic));
            
            if (matchingTopics.length > 0) {
                // 교집합 중 랜덤 선택
                const randomIndex = Math.floor(Math.random() * matchingTopics.length);
                displayTopic = matchingTopics[randomIndex];
            } else {
                // 교집합 없으면 게시글 주제 중 랜덤 선택
                const randomIndex = Math.floor(Math.random() * currentTopics.length);
                displayTopic = currentTopics[randomIndex];
            }
        }

        // 3) 카운트 로직
        const totalCount = cheerMap[post.id] || 0;
        
        // 해당 게시글(post.id)에서 displayTopic에 관심있는 응원자 수 조회
        // cheererInterestMap 구조: { board_id: { '여성': 5, '노동': 3 } }
        const specificInterestCount = (cheererInterestMap[post.id] && cheererInterestMap[post.id][displayTopic]) 
            ? cheererInterestMap[post.id][displayTopic] 
            : 0; // 없으면 0명 (단, 기획 의도에 따라 totalCount로 대체할 수도 있음)

        // D-Day 계산
        let dDay = "상시";
        let isTodayEnd = false;
        if (post.end_date) {
            const endDate = new Date(post.end_date);
            const endDateCompare = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime();
            const diffDays = Math.ceil((endDateCompare - todayCompare) / (1000 * 60 * 60 * 24));
            
            if (diffDays === 0) {
                dDay = "D-0";
                isTodayEnd = true;
            } else if (diffDays < 0) {
                dDay = "마감";
            } else {
                dDay = `D-${diffDays}`;
            }
        }

        const format = (d, t) => d ? `${new Date(d).toISOString().split('T')[0].replace(/-/g, '. ')}${t ? ' ' + d.substring(11, 16) : ''}` : "";
        const finalHostType = post.host_type || userMap[post.user_id] || "기타";

        return {
            id: post.id,
            title: post.title,
            thumbnail: imageMap[post.id] || "none",
            
            // 이제 topics는 배열로 내려갑니다 (프론트에서 처리 용이)
            topics: currentTopics, 
            
            location: post.region ? `${post.region}${post.district ? ` > ${post.district}` : ""}` : "온라인",
            region: post.region || "온라인",
            district: post.district || "",
            dateDisplay: (post.start_date && post.end_date) ? `${format(post.start_date, post.is_start_time_set)} ~ ${format(post.end_date, post.is_end_time_set)}` : "상시 진행",
            start_date: post.start_date,
            end_date: post.end_date,
            
            cheerCount: totalCount,
            is_cheered: userCheerSet.has(post.id), 
            is_author: currentUserId === post.user_id, 
            host_type: finalHostType,
            dDay,
            isTodayEnd, 
            
            // [최종 메시지]
            // 예: "여성 의제에 관심이 있는 5명이 연대합니다!"
            interestMessage: `${displayTopic} 의제에 관심이 있는 ${specificInterestCount}명이 연대합니다!`
        };
    });
}

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