// [수정] db로 통일 (pool 변수명 에러 해결)
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
    const userIds = [...new Set(results.map(post => post.user_id).filter(id => id))];

    // ==================================================================================
    // 1. [게시글 주제] board_topics + topics 조인
    // ==================================================================================
    // pool.query -> db.query로 변경
    const [boardTopicRows] = await db.query(
        `SELECT bt.board_id, t.name 
         FROM board_topics bt
         JOIN topics t ON bt.topic_id = t.id
         WHERE bt.board_id IN (?)`,
        [boardIds]
    );

    const boardTopicsMap = {};
    boardTopicRows.forEach(row => {
        if (!boardTopicsMap[row.board_id]) boardTopicsMap[row.board_id] = [];
        boardTopicsMap[row.board_id].push(row.name);
    });

    // ==================================================================================
    // 2. [응원 통계] 
    //    A. 전체 응원 수
    //    B. 특정 주제에 관심있는 응원자 수 (Interest Message용)
    // ==================================================================================
    
    // A. 전체 응원 수
    const [totalCheers] = await db.query(
        `SELECT board_id, COUNT(*) as count FROM cheers WHERE board_id IN (?) GROUP BY board_id`,
        [boardIds]
    );
    const cheerMap = totalCheers.reduce((acc, cur) => { acc[cur.board_id] = cur.count; return acc; }, {});

    

    // B. "게시글별" + "주제별" 응원자 수 카운트
    // 로직: cheers(응원한 사람) -> user_interests(그 사람의 관심사) -> topics(이름)
    const [cheererInterestRows] = await db.query(
        `SELECT c.board_id, t.name as topic_name, COUNT(DISTINCT c.user_id) as count
         FROM cheers c
         JOIN user_interests ui ON c.user_id = ui.user_id
         JOIN topics t ON ui.topic_id = t.id
         WHERE c.board_id IN (?)
         GROUP BY c.board_id, t.name`,
        [boardIds]
    );

    // Map 구조: { board_id: { '여성': 5, '기후': 2 } }
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
        // A. 내 응원 여부
        const [userCheers] = await db.query(
            `SELECT board_id FROM cheers WHERE user_id = ? AND board_id IN (?)`,
            [currentUserId, boardIds]
        );
        userCheerSet = new Set(userCheers.map(c => c.board_id));

        // B. 내 관심사 (user_interests 테이블)
        try {
            const [myInterests] = await db.query(
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
    // 4. 기타 정보
    // ==================================================================================
    const [boardImages] = await db.query(
        `SELECT board_id, image_url FROM board_images WHERE board_id IN (?) ORDER BY id ASC`,
        [boardIds]
    );
    const imageMap = {};
    boardImages.forEach(img => { if (!imageMap[img.board_id]) imageMap[img.board_id] = img.image_url; });

    const userMap = {};
    if (userIds.length > 0) {
        const [users] = await db.query(
            `SELECT id, user_type FROM users WHERE id IN (?)`, 
            [userIds]
        );
        users.forEach(u => {
            let typeStr = "기타";
            if (u.user_type === 0 || u.user_type === 'individual') typeStr = "individual";
            else if (u.user_type === 1 || u.user_type === 'organization') typeStr = "organization";
            else typeStr = u.user_type || "기타";
            userMap[u.id] = typeStr;
        });
    }

    const today = new Date();
    const todayCompare = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

    // ==================================================================================
    // 5. 데이터 병합
    // ==================================================================================
    return results.map(post => {
        const currentTopics = boardTopicsMap[post.id] || [];
        
        // [주제 선정 로직]
        let displayTopic = "사회"; 
        
        if (currentTopics.length > 0) {
            // 1순위: 내 관심사와 겹치는 주제
            const matchingTopics = currentTopics.filter(topic => myInterestTopics.includes(topic));
            
            if (matchingTopics.length > 0) {
                const randomIndex = Math.floor(Math.random() * matchingTopics.length);
                displayTopic = matchingTopics[randomIndex];
            } else {
                // 2순위: 겹치는게 없으면 게시글 주제 중 랜덤
                const randomIndex = Math.floor(Math.random() * currentTopics.length);
                displayTopic = currentTopics[randomIndex];
            }
        }

        const totalCount = cheerMap[post.id] || 0;
        
        // [카운트 매칭]
        // "여성"이 displayTopic으로 선정되었다면, cheererInterestMap에서 "여성" 관심사 보유 응원자 수를 찾음
        const specificInterestCount = (cheererInterestMap[post.id] && cheererInterestMap[post.id][displayTopic]) 
            ? cheererInterestMap[post.id][displayTopic] 
            : 0;

        // D-Day
        /*
        let dDay = "상시";
        let isTodayEnd = false;
        if (post.end_date) {
            const endDate = new Date(post.end_date);
            const endDateCompare = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime();
            const diffDays = Math.ceil((endDateCompare - todayCompare) / (1000 * 60 * 60 * 24));
            
            if (diffDays === 0) { dDay = "D-0"; isTodayEnd = true; } 
            else if (diffDays < 0) { dDay = "마감"; } 
            else { dDay = `D-${diffDays}`; }
        }*/
        // D-Day (정확한 현재 시각 기준 계산)


        let dDay = "상시";
        let isTodayEnd = false;

        if (post.end_date) {
            const now = new Date();                  // 지금 시각
            const endDate = new Date(post.end_date); // 종료 시각

            const diffMs = endDate.getTime() - now.getTime();

            // 🔴 이미 지난 경우 → 무조건 마감
            if (diffMs <= 0) {
                dDay = "마감";
                isTodayEnd = false;
            } 
            else {
                const oneDayMs = 1000 * 60 * 60 * 24;

                // 🔹 24시간 이내 남았으면 "오늘 마감"
                if (diffMs <= oneDayMs) {
                    dDay = "D-0";
                    isTodayEnd = true;
                } 
                else {
                    const diffDays = Math.ceil(diffMs / oneDayMs);
                    dDay = `D-${diffDays}`;
                    isTodayEnd = false;
                }
            }
        }


        const format = (d, t) => {
            if (!d) return "";
            try {
                const dateObj = new Date(d);
                const isoStr = dateObj.toISOString();
                const datePart = isoStr.split('T')[0].replace(/-/g, '. ');
                const timePart = t ? ' ' + isoStr.substring(11, 16) : '';
                return `${datePart}${timePart}`;
            } catch (e) {
                return ""; // 날짜 형식이 잘못되었을 경우 대비
            }
        };
        
        const finalHostType = post.host_type || userMap[post.user_id] || "기타";
        return {
            id: post.id,
            title: post.title,
            thumbnail: imageMap[post.id] || "none",
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
            interestMessage: `${displayTopic} 의제에 관심이 있는 ${specificInterestCount}명이 연대합니다!`,
            interestTopic: displayTopic,
            interestCounts: specificInterestCount
        };
    });
}

/**
 * 1. 우리들의 연대
 */
exports.getOursByTopic = async (topicName, userId = null) => {
    if (!topicName) return [];
    try {
        const topicList = topicName.split(',').map(t => t.trim()).filter(Boolean);
        
        const response = await esClient.search({
            index: 'boards',
            size: 4,
            query: {
                bool: {
                    filter: [ { range: { end_date: { gte: "now-30d/d" } } } ],
                    must: [
                        {
                            bool: {
                                should: topicList.map(topic => ({ match_phrase: { topics: topic } })),
                                minimum_should_match: 1
                            }
                        }
                    ]
                }
            },
            sort: [ { "created_at": { "order": "desc" } } ]
        });

        // 여기서 enrichData를 호출할 때 이제 에러가 나지 않습니다.
        return await enrichData(response.hits.hits.map(hit => hit._source), userId);
    } catch (error) {
        console.error('getOursByTopic ES Error:', error);
        return [];
    }
};

/**
 * 2. 실시간/마감 연대
 */
exports.getGlobalSolidarity = async (type, userId = null) => {
    const cacheKey = `cache:main:${type}:global`;
    if (!userId) {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
    }

    let query = (type === 'imminent') 
        ? `SELECT * FROM boards 
           WHERE end_date > NOW() AND DATE(end_date) = CURDATE() 
           ORDER BY end_date ASC`
        : `SELECT b.*, COUNT(c.id) AS recent_cheer_count FROM boards b 
           LEFT JOIN cheers c ON b.id = c.board_id AND c.created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) 
           WHERE b.end_date > NOW() GROUP BY b.id ORDER BY recent_cheer_count DESC, b.created_at DESC LIMIT 6`;

    // [수정] db.execute -> db.query로 통일 (일관성 유지 및 에러 방지)
    let [rows] = await db.query(query);

    if (type === 'realtime' && rows.length === 0) {
        const fallbackQuery = `SELECT b.*, COUNT(c.id) AS total_cheer_count FROM boards b 
                               LEFT JOIN cheers c ON b.id = c.board_id WHERE b.end_date > NOW()
                               GROUP BY b.id ORDER BY total_cheer_count DESC LIMIT 6`;
        [rows] = await db.query(fallbackQuery);
    }

    const result = await enrichData(rows, userId);

    if (!userId && result.length > 0) {
        await redis.setex(cacheKey, (type === 'realtime' ? 3600 : 600), JSON.stringify(result));
    }
    return result;
};