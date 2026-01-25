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

    // 🔥 ES에서 오는 값은 UTC → KST로 명시 변환
    const utc = new Date(dateStr);
    const kst = new Date(utc.getTime() + 9 * 60 * 60 * 1000);

    const pad = (n) => n.toString().padStart(2, '0');

    const datePart = `${kst.getFullYear()}. ${pad(kst.getMonth() + 1)}. ${pad(kst.getDate())}`;
    const timePart = isTimeSet ? ` ${pad(kst.getHours())}:${pad(kst.getMinutes())}` : '';

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
        // D-Day UI 계산 (UTC Epoch Shifting 방식)
        let dDay = "상시";
        let isTodayEnd = false;

        if (post.end_date) {
            // 1. 현재 시간 (순수 UTC 밀리초)
            const nowUtcMs = Date.now();

            // 2. 마감 시간 파싱 (KST 기준 해석 → UTC 밀리초 변환)
            let endUtcMs;
            // "YYYY-MM-DD HH:mm:ss" 형태 처리 (공백 -> T, +09:00 부착)
            if (typeof post.end_date === "string" && post.end_date.includes(" ")) {
                const kstIso = post.end_date.replace(" ", "T") + "+09:00";
                endUtcMs = new Date(kstIso).getTime();
            } else {
                // "YYYY-MM-DD" 형태 처리 (자정 마감으로 간주하고 싶다면 +09:00 붙여야 함)
                // 단순히 new Date(str)하면 UTC 00:00(한국 09:00)이 될 수 있음
                // 안전하게 날짜만 있는 경우도 KST 자정(00:00)으로 해석하려면:
                const dateStr = post.end_date.length === 10 ? post.end_date + "T00:00:00" : post.end_date;
                // ISO 포맷이 아니거나 시간대 없으면 강제 KST 간주
                if (!dateStr.includes("Z") && !dateStr.includes("+")) {
                    endUtcMs = new Date(dateStr + "+09:00").getTime();
                } else {
                    endUtcMs = new Date(dateStr).getTime();
                }
            }

            // 3. 절대 시간 비교 (마감 여부)
            if (endUtcMs < nowUtcMs) {
                dDay = "마감";
                isTodayEnd = false;
            } else {
                // 4. 날짜 경계 계산 (Epoch Shifting)
                // UTC 타임스탬프에 9시간(ms)을 더해 "가상의 KST 타임스탬프"를 만듦
                const KR_OFFSET = 9 * 60 * 60 * 1000;
                const ONE_DAY = 24 * 60 * 60 * 1000;

                const kstNowMs = nowUtcMs + KR_OFFSET;
                const endKstMs = endUtcMs + KR_OFFSET;

                // "KST 기준 오늘 자정" 구하기
                // (가상 타임스탬프에서 24시간으로 나눈 나머지를 빼면 정확히 00:00에 떨어짐)
                const kstTodayStart = kstNowMs - (kstNowMs % ONE_DAY);
                
                // D-Day 계산
                // (마감시각 - 오늘자정) / 24시간 -> 내림(Floor) 처리
                const diffDays = Math.floor((endKstMs - kstTodayStart) / ONE_DAY);

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
    const now = Date.now(); // UTC 기준 ms (ES end_date와 동일 기준)

    // KST 기준 오늘 00:00 / 23:59:59 → 다시 UTC로 환산
    const kstNow = new Date(now + 9 * 60 * 60 * 1000);

    const kstTodayStart = new Date(
        kstNow.getFullYear(),
        kstNow.getMonth(),
        kstNow.getDate(),
        0, 0, 0, 0
    ).getTime() - 9 * 60 * 60 * 1000;

    const kstTodayEnd = new Date(
        kstNow.getFullYear(),
        kstNow.getMonth(),
        kstNow.getDate(),
        23, 59, 59, 999
    ).getTime() - 9 * 60 * 60 * 1000;

    return {
        now,              // UTC now
        dayStart: kstTodayStart,
        dayEnd: kstTodayEnd
    };
};




// [핵심 정렬 로직]
const commonSort = [
  { "sort_group": { "order": "asc", "missing": 2 } },
  { "created_at": { "order": "desc", "missing": "_last" } },
  { "sort_end":   { "order": "asc", "missing": "_last" } }
  
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