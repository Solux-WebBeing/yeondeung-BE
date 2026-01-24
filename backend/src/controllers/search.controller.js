const { Client } = require('@elastic/elasticsearch');
const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });
const pool = require('../../db');

// [ISO 변환]
const toEsDate = (dateStr) => {
    if (!dateStr) return null;
    return new Date(dateStr).toISOString(); 
};

/**
 * [Helper] MySQL 데이터 보강 (기존 로직 유지)
 */
async function enrichDataWithMySQL(results, currentUserId = null) {
    if (!results || results.length === 0) return [];
    
    const boardIds = results.map(post => post.id);
    const userIds = [...new Set(results.map(post => post.user_id).filter(id => id))];

    const [boardTopicRows] = await pool.query(
        `SELECT bt.board_id, t.name FROM board_topics bt JOIN topics t ON bt.topic_id = t.id WHERE bt.board_id IN (?)`,
        [boardIds]
    );
    const boardTopicsMap = {};
    boardTopicRows.forEach(row => {
        if (!boardTopicsMap[row.board_id]) boardTopicsMap[row.board_id] = [];
        boardTopicsMap[row.board_id].push(row.name);
    });

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
        // D-Day UI 계산 (KST 강제 보정, 라이브러리 없이)
        // D-Day UI 계산 (KST 강제 보정, 라이브러리 없이)
        let dDay = "상시";
        let isTodayEnd = false;

        if (post.end_date) {
            // 🔥 한국 현재 시간 만들기 (KST)
            const now = new Date();
            const nowKST = new Date(now.getTime() + 9 * 60 * 60 * 1000);

            // 🔥 end_date 문자열을 KST 기준으로 안전 파싱
            // 예: "2026-01-24 15:00" → "2026-01-24T15:00:00"
            let endStr = post.end_date;
            if (typeof endStr === "string" && endStr.includes(" ")) {
                endStr = endStr.replace(" ", "T");
                if (endStr.length === 16) endStr += ":00"; // 초 없으면 추가
            }
            const endDate = new Date(endStr);

            // 🔴 이미 시간이 지난 경우 → 무조건 마감
            if (endDate.getTime() < nowKST.getTime()) {
                dDay = "마감";
                isTodayEnd = false;
            } else {
                // 날짜 단위 D-Day 계산 (KST 기준)
                const todayMidnight = new Date(
                    nowKST.getFullYear(),
                    nowKST.getMonth(),
                    nowKST.getDate(),
                    0, 0, 0, 0
                ).getTime();

                const endMidnight = new Date(
                    endDate.getFullYear(),
                    endDate.getMonth(),
                    endDate.getDate(),
                    0, 0, 0, 0
                ).getTime();

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

// [정렬 기준] 한국 시간(KST) 오늘 범위 계산
const getSortParams = () => {
    const now = new Date();

    // 현재 UTC ms
    const utcNow = now.getTime() + (now.getTimezoneOffset() * 60000);

    // KST = UTC + 9시간
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstNowMs = utcNow + kstOffset;
    const kstNow = new Date(kstNowMs);

    // KST 기준 오늘 00:00 / 23:59:59
    const kstTodayStart = new Date(
        kstNow.getFullYear(),
        kstNow.getMonth(),
        kstNow.getDate(),
        0, 0, 0, 0
    ).getTime();

    const kstTodayEnd = new Date(
        kstNow.getFullYear(),
        kstNow.getMonth(),
        kstNow.getDate(),
        23, 59, 59, 999
    ).getTime();

    return {
        now: utcNow,                              // 현재 시각 (UTC ms)
        dayStart: kstTodayStart - kstOffset,      // KST 00:00 → UTC
        dayEnd: kstTodayEnd - kstOffset           // KST 23:59 → UTC
    };
};


// [핵심 정렬 로직]
const commonSort = [
    {
        _script: {
            type: "number",
            script: {
                lang: "painless",
                source: `
                    if (doc['end_date'].size() == 0) return 2; // 상시

                    long end = doc['end_date'].value.toInstant().toEpochMilli();

                    // 이미 마감
                    if (end < params.now) return 3;

                    // 오늘(KST) 마감 예정
                    if (end >= params.dayStart && end <= params.dayEnd) return 0;

                    // 미래 마감
                    return 1;
                `,
                params: getSortParams()
            },
            order: "asc"
        }
    },

    // 🔹 2순위: 각 그룹 안에서 "최신 등록순"
    {
        "created_at": { "order": "desc", "missing": "_last" }
    }
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
            sort: commonSort // 수정된 정렬 적용
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
            sort: commonSort // 수정된 정렬 적용
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