const { Client } = require('@elastic/elasticsearch');
const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });
const pool = require('../../db');

// [핵심 수정 1] 옛날 방식(yyyy-mm-dd) 버리고 ISO 표준(T, Z 포함)으로 변경
// 이렇게 해야 ES가 "아, 이건 전세계 공통 시간이구나" 하고 정확히 계산함
const toEsDate = (dateStr) => {
    if (!dateStr) return null;
    return new Date(dateStr).toISOString(); 
};

/**
 * [Helper] MySQL 데이터 보강 및 UI 가공 공통 함수
 */
async function enrichDataWithMySQL(results, currentUserId = null) {
    if (!results || results.length === 0) return [];
    
    const boardIds = results.map(post => post.id);
    const userIds = [...new Set(results.map(post => post.user_id).filter(id => id))];

    // 1. 게시글 주제 가져오기
    const [boardTopicRows] = await pool.query(
        `SELECT bt.board_id, t.name FROM board_topics bt JOIN topics t ON bt.topic_id = t.id WHERE bt.board_id IN (?)`,
        [boardIds]
    );
    const boardTopicsMap = {};
    boardTopicRows.forEach(row => {
        if (!boardTopicsMap[row.board_id]) boardTopicsMap[row.board_id] = [];
        boardTopicsMap[row.board_id].push(row.name);
    });

    // 2. 응원 통계
    const [totalCheers] = await pool.query(
        `SELECT board_id, COUNT(*) as count FROM cheers WHERE board_id IN (?) GROUP BY board_id`,
        [boardIds]
    );
    const cheerMap = totalCheers.reduce((acc, cur) => { acc[cur.board_id] = cur.count; return acc; }, {});

    const [cheererInterestRows] = await pool.query(
        `SELECT c.board_id, t.name as topic_name, COUNT(DISTINCT c.user_id) as count
         FROM cheers c
         JOIN user_interests ui ON c.user_id = ui.user_id
         JOIN topics t ON ui.topic_id = t.id
         WHERE c.board_id IN (?)
         GROUP BY c.board_id, t.name`,
        [boardIds]
    );
    const cheererInterestMap = {};
    cheererInterestRows.forEach(row => {
        if (!cheererInterestMap[row.board_id]) cheererInterestMap[row.board_id] = {};
        cheererInterestMap[row.board_id][row.topic_name] = row.count;
    });

    // 3. 유저 정보
    let userCheerSet = new Set();
    let myInterestTopics = []; 
    if (currentUserId) {
        const [userCheers] = await pool.query(
            `SELECT board_id FROM cheers WHERE user_id = ? AND board_id IN (?)`,
            [currentUserId, boardIds]
        );
        userCheerSet = new Set(userCheers.map(c => c.board_id));

        try {
            const [myInterests] = await pool.query(
                `SELECT t.name FROM user_interests ui JOIN topics t ON ui.topic_id = t.id WHERE ui.user_id = ?`,
                [currentUserId]
            );
            myInterestTopics = myInterests.map(row => row.name);
        } catch (err) { console.error("User Interest Fetch Error:", err); }
    }

    const [boardImages] = await pool.query(
        `SELECT board_id, image_url FROM board_images WHERE board_id IN (?) ORDER BY id ASC`,
        [boardIds]
    );
    const imageMap = {};
    boardImages.forEach(img => { if (!imageMap[img.board_id]) imageMap[img.board_id] = img.image_url; });

    const userMap = {};
    if (userIds.length > 0) {
        const [users] = await pool.query(`SELECT id, user_type FROM users WHERE id IN (?)`, [userIds]);
        users.forEach(u => {
            let typeStr = "기타";
            if (u.user_type === 0 || u.user_type === 'individual') typeStr = "individual";
            else if (u.user_type === 1 || u.user_type === 'organization') typeStr = "organization";
            else typeStr = u.user_type || "기타";
            userMap[u.id] = typeStr;
        });
    }

    // [UI용 포맷 함수] - 화면에 보여줄 때는 보기 좋게 가공
    const formatForUI = (dateStr, isTimeSet) => {
        if (!dateStr) return "";
        const d = new Date(dateStr);
        const pad = (n) => n.toString().padStart(2, '0');
        const datePart = `${d.getFullYear()}. ${pad(d.getMonth() + 1)}. ${pad(d.getDate())}`;
        const timePart = isTimeSet ? ` ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
        return `${datePart}${timePart}`;
    };

    return results.map(post => {
        const currentTopics = boardTopicsMap[post.id] || [];
        let displayTopic = "사회"; 
        if (currentTopics.length > 0) {
            const matchingTopics = currentTopics.filter(topic => myInterestTopics.includes(topic));
            displayTopic = matchingTopics.length > 0 
                ? matchingTopics[Math.floor(Math.random() * matchingTopics.length)] 
                : currentTopics[Math.floor(Math.random() * currentTopics.length)];
        }

        const totalCount = cheerMap[post.id] || 0;
        const specificInterestCount = (cheererInterestMap[post.id] && cheererInterestMap[post.id][displayTopic]) || 0;

        // D-Day 계산 (UI용)
        let dDay = "상시";
        let isTodayEnd = false;
        if (post.end_date) {
            const now = new Date();
            const endDate = new Date(post.end_date);
            const isPast = endDate < now;

            if (isPast) {
                dDay = "마감";
                isTodayEnd = false;
            } else {
                const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
                const endMidnight = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime();
                const diffDays = Math.ceil((endMidnight - todayMidnight) / (1000 * 60 * 60 * 24));

                if (diffDays === 0) {
                    dDay = "D-0";
                    isTodayEnd = true;
                } else {
                    dDay = `D-${diffDays}`;
                    isTodayEnd = false;
                }
            }
        }

        return {
            id: post.id,
            title: post.title,
            thumbnail: imageMap[post.id] || "none",
            topics: currentTopics,
            location: post.region ? `${post.region}${post.district ? ` > ${post.district}` : ""}` : "온라인",
            region: post.region || "온라인",
            district: post.district || "",
            dateDisplay: (post.start_date && post.end_date) 
                ? `${formatForUI(post.start_date, post.is_start_time_set)} ~ ${formatForUI(post.end_date, post.is_end_time_set)}` 
                : "상시 진행",
            start_date: formatForUI(post.start_date, post.is_start_time_set),
            end_date: formatForUI(post.end_date, post.is_end_time_set),
            cheerCount: totalCount,
            is_cheered: userCheerSet.has(post.id),
            is_author: currentUserId === post.user_id,
            host_type: post.host_type || userMap[post.user_id] || "기타",
            dDay,
            isTodayEnd,
            interestMessage: `${displayTopic} 의제에 관심이 있는 ${specificInterestCount}명이 연대합니다!`,
            interestTopic: displayTopic,
            interestCounts: specificInterestCount
        };
    });
}

// [핵심 수정 2] 정렬 파라미터 계산 (KST 기준을 UTC 숫자로 정확히 변환)
const getSortParams = () => {
    const now = new Date();
    // 1. 현재 시간을 기준으로 한국 시간(KST) 날짜 성분을 추출
    // toLocaleString을 써서 서버 타임존 무시하고 한국 시간 강제 추출
    const kstString = now.toLocaleString("en-US", { timeZone: "Asia/Seoul" });
    const kstDate = new Date(kstString);

    // 2. 한국 시간 기준 "오늘 00:00"과 "23:59"의 년/월/일 추출
    const y = kstDate.getFullYear();
    const m = kstDate.getMonth();
    const d = kstDate.getDate();

    // 3. 이를 UTC 타임스탬프로 변환 (한국 시간은 UTC-9니까 -9시간 적용된 값으로 생성)
    // Date.UTC(y, m, d, 0, 0, 0) -> 한국시간 0시가 아니라 UTC 0시임.
    // 그래서 한국시간 0시는 UTC 전날 15시. 
    // 복잡하니까 가장 확실한 방법: "한국시간 00시" 문자열을 만들어서 Date 객체로 변환
    
    // 더 쉬운 방법: 오프셋 수동 계산 (이게 제일 빠르고 정확함)
    const kstOffset = 9 * 60 * 60 * 1000;
    const utcNow = now.getTime() + (now.getTimezoneOffset() * 60000); // 순수 UTC 밀리초
    const kstNowMs = utcNow + kstOffset; // KST 밀리초
    
    const kstDateObj = new Date(kstNowMs);
    const kstTodayStart = new Date(kstDateObj.getFullYear(), kstDateObj.getMonth(), kstDateObj.getDate(), 0, 0, 0, 0).getTime();
    const kstTodayEnd = new Date(kstDateObj.getFullYear(), kstDateObj.getMonth(), kstDateObj.getDate(), 23, 59, 59, 999).getTime();
    
    // 4. ES에 보낼때는 다시 UTC 기준으로 맞춰서 보냄 (KST 값을 그대로 비교하면 안됨)
    return {
        now: now.getTime(),
        dayStart: kstTodayStart - kstOffset, // 한국 00시 -> UTC 15시(전날)
        dayEnd: kstTodayEnd - kstOffset      // 한국 23시 -> UTC 14시(오늘)
    };
};

// [공통 정렬 스크립트]
const commonSort = [
    {
        _script: {
            type: "number",
            script: {
                lang: "painless",
                source: `
                    if (doc['end_date'].size() == 0) return 2; // 상시 -> 그룹 2
                    
                    // 저장된 시간을 숫자로 변환 (타임존 무시하고 절대값 비교)
                    long end = doc['end_date'].value.toInstant().toEpochMilli();

                    // 1. 이미 마감된 글은 무조건 꼴찌 (그룹 3)
                    if (end < params.now) return 3; 

                    // 2. 오늘 마감되는 글은 최우선 (그룹 0)
                    if (end >= params.dayStart && end <= params.dayEnd) return 0;
                    
                    // 3. 그 외 미래 종료는 중간 (그룹 1)
                    return 1;
                `,
                params: getSortParams()
            },
            order: "asc"
        }
    },
    { "created_at": { "order": "desc" } } // 그룹 내에서는 최신순
];

/**
 * 1. 게시글 통합 검색
 */
exports.searchPosts = async (req, res) => {
    try {
        const { q, topics, region, district, participation_type, host_type, start_date, end_date, page = 1 } = req.query;
        const size = 8;
        const from = (page - 1) * size;

        const esQuery = { bool: { must: [], filter: [] } };

        if (start_date && end_date) {
            // 여기도 수정된 toEsDate(ISO 형식)가 적용됨
            esQuery.bool.filter.push({ range: { start_date: { gte: toEsDate(start_date) } } });
            esQuery.bool.filter.push({ range: { end_date: { lte: toEsDate(end_date) } } });
        } else {
            esQuery.bool.filter.push({ range: { end_date: { gte: "now-30d/d" } } });
        }

        const addMultiFilter = (field, valueString) => {
            if (valueString) {
                const values = valueString.split(',').map(v => v.trim()).filter(Boolean);
                if (values.length > 0) {
                    esQuery.bool.filter.push({
                        bool: { should: values.map(v => ({ match_phrase: { [field]: v } })), minimum_should_match: 1 }
                    });
                }
            }
        };
        ['topics', 'participation_type', 'host_type'].forEach(f => addMultiFilter(f, req.query[f]));

        if (region) esQuery.bool.filter.push({ match_phrase: { region: region.trim() } });
        if (district) {
            const districts = district.split(',').map(v => v.trim()).filter(Boolean);
            if (districts.length > 0) {
                esQuery.bool.filter.push({
                    bool: { should: districts.map(d => ({ match_phrase: { district: d } })), minimum_should_match: 1 }
                });
            }
        }

        if (q && q.trim() !== "") {
            esQuery.bool.must.push({
                multi_match: {
                    query: q,
                    fields: ["title^5", "topics^3", "content"],
                    type: "most_fields",
                    operator: "or"
                }
            });
        }

        const response = await esClient.search({
            index: 'boards',
            from, size,
            query: esQuery.bool.must.length > 0 || esQuery.bool.filter.length > 0 ? esQuery : { match_all: {} },
            sort: commonSort // [수정] 공통 정렬 로직 적용
        });

        const cardData = await enrichDataWithMySQL(response.hits.hits.map(hit => hit._source), req.user?.id);
        res.status(200).json({ success: true, total: response.hits.total.value, currentPage: parseInt(page), totalPages: Math.ceil(response.hits.total.value / size), data: cardData });

    } catch (error) {
        console.error('Search Error:', error);
        res.status(500).json({ success: false, message: '검색 엔진 오류' });
    }
};

/**
 * 2. 전체 게시글 조회
 */
exports.getAllPosts = async (req, res) => {
    try {
        const { page = 1 } = req.query;
        const size = 8;
        const from = (page - 1) * size;

        const response = await esClient.search({
            index: 'boards',
            from, size,
            query: { match_all: {} },
            sort: commonSort // [수정] 공통 정렬 로직 적용
        });

        const cardData = await enrichDataWithMySQL(response.hits.hits.map(hit => hit._source), req.user?.id);
        res.status(200).json({ success: true, total: response.hits.total.value, currentPage: parseInt(page), totalPages: Math.ceil(response.hits.total.value / size), data: cardData });
    } catch (error) {
        console.error('GetAllPosts Error:', error);
        res.status(500).json({ success: false, message: '전체 목록 로드 실패' });
    }
};

/**
 * 3. 실시간 추천 검색어 API
 */
exports.getSuggestions = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.trim().length < 1) return res.status(200).json({ success: true, data: [] });

        const response = await esClient.search({
            index: 'boards',
            _source: false,
            suggest: {
                "board-suggestions": {
                    prefix: q,
                    completion: { field: "suggest", size: 5, skip_duplicates: true, fuzzy: { fuzziness: "AUTO" } }
                }
            }
        });
        const suggestions = response.suggest["board-suggestions"][0].options.map(o => o.text);
        res.status(200).json({ success: true, data: suggestions });
    } catch (error) {
        res.status(500).json({ success: false, message: '추천 검색어 로드 오류' });
    }
};