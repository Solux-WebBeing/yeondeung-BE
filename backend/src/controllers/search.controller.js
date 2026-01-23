const { Client } = require('@elastic/elasticsearch');
const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });
const pool = require('../../db');

// [Helper] 날짜 포맷 변환 (yyyy-MM-dd HH:mm:ss)
const toEsDate = (dateStr) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    const pad = (n) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/**
 * [Helper] MySQL 데이터 보강 및 UI 가공 공통 함수
 */
async function enrichDataWithMySQL(results, currentUserId = null) {
    if (!results || results.length === 0) return [];
    
    const boardIds = results.map(post => post.id);
    // user_id만 뽑아서 중복 제거 (작성자 정보 조회용)
    const userIds = [...new Set(results.map(post => post.user_id).filter(id => id))];

    // ---------------------------------------------------------
    // 1. [기존] 전체 응원수 조회 (cheerCount 표시용)
    // ---------------------------------------------------------
    const [totalCheers] = await pool.query(
        `SELECT board_id, COUNT(*) as count FROM cheers WHERE board_id IN (?) GROUP BY board_id`,
        [boardIds]
    );
    const cheerMap = totalCheers.reduce((acc, cur) => { acc[cur.board_id] = cur.count; return acc; }, {});

    // ---------------------------------------------------------
    // 2. [신규] 응원한 사람들의 관심사(Topics) 정보 조회 (interestMessage 카운팅용)
    // ---------------------------------------------------------
    const [cheerDetails] = await pool.query(
        `SELECT c.board_id, u.topics 
         FROM cheers c 
         JOIN users u ON c.user_id = u.id 
         WHERE c.board_id IN (?)`,
        [boardIds]
    );

    // 게시글별로 [ ['여성', '기후'], ['노동'], ... ] 형태의 관심사 맵 생성
    const boardCheerTopicsMap = {};
    cheerDetails.forEach(row => {
        if (!boardCheerTopicsMap[row.board_id]) boardCheerTopicsMap[row.board_id] = [];
        
        if (row.topics) {
            // DB 문자열 -> 배열 변환
            const userTopicsArray = Array.isArray(row.topics) 
                ? row.topics 
                : row.topics.split(',').map(t => t.trim());
            boardCheerTopicsMap[row.board_id].push(userTopicsArray);
        } else {
            // 관심사 없는 유저는 빈 배열
            boardCheerTopicsMap[row.board_id].push([]);
        }
    });

    // ---------------------------------------------------------
    // 3. [로그인 시 전용] 
    //    A. 사용자가 응원했는지 여부 조회
    //    B. 사용자의 관심사(Topics) 조회 (맞춤 메시지용)
    // ---------------------------------------------------------
    let userCheerSet = new Set();
    let myInterestTopics = []; // 로그인한 유저의 관심사 목록

    if (currentUserId) {
        // A. 응원 여부
        const [userCheers] = await pool.query(
            `SELECT board_id FROM cheers WHERE user_id = ? AND board_id IN (?)`,
            [currentUserId, boardIds]
        );
        userCheerSet = new Set(userCheers.map(c => c.board_id));

        // B. 사용자 관심사 조회
        try {
            const [userInfo] = await pool.query(
                `SELECT topics FROM users WHERE id = ?`, 
                [currentUserId]
            );
            
            if (userInfo.length > 0 && userInfo[0].topics) {
                myInterestTopics = Array.isArray(userInfo[0].topics)
                    ? userInfo[0].topics
                    : userInfo[0].topics.split(',').map(t => t.trim());
            }
        } catch (err) {
            console.error("User Interest Fetch Error:", err);
        }
    }

    // 4. 썸네일 이미지 조회
    const [boardImages] = await pool.query(
        `SELECT board_id, image_url FROM board_images WHERE board_id IN (?) ORDER BY id ASC`,
        [boardIds]
    );
    const imageMap = {};
    boardImages.forEach(img => { if (!imageMap[img.board_id]) imageMap[img.board_id] = img.image_url; });

    // 5. 작성자(Users) 정보 조회
    const userMap = {};
    if (userIds.length > 0) {
        const [users] = await pool.query(
            `SELECT id, user_type FROM users WHERE id IN (?)`, 
            [userIds]
        );
        
        users.forEach(u => {
            let typeStr = "기타";
            if (u.user_type === 0) typeStr = "individual";
            else if (u.user_type === 1) typeStr = "organization";
            else if (u.user_type === "individual") typeStr = "individual";
            else if (u.user_type === "organization") typeStr = "organization";
            else if (u.user_type) typeStr = u.user_type; 

            userMap[u.id] = typeStr;
        });
    }

    const today = new Date();
    const todayCompare = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

    return results.map(post => {
        // 게시글의 주제 목록 파싱
        const currentTopics = Array.isArray(post.topics) 
            ? post.topics 
            : (post.topics ? post.topics.split(',').map(t => t.trim()) : []);
        
        // (A) Interest Message용 주제(topicName) 선정
        let topicName = "사회"; 
        
        if (currentTopics.length > 0) {
            // 1순위: 내 관심사와 게시글 주제의 교집합 찾기
            const matchingTopics = currentTopics.filter(topic => myInterestTopics.includes(topic));
            
            if (matchingTopics.length > 0) {
                // 교집합이 있다면 그 중에서 하나 선택
                const randomIndex = Math.floor(Math.random() * matchingTopics.length);
                topicName = matchingTopics[randomIndex];
            } else {
                // 2순위: 교집합이 없다면 게시글 주제 중 랜덤 선택
                const randomIndex = Math.floor(Math.random() * currentTopics.length);
                topicName = currentTopics[randomIndex];
            }
        }

        // (B) 전체 응원 수
        const totalCount = cheerMap[post.id] || 0;

        // (C) [핵심] 해당 topicName에 관심이 있는 응원자 수 카운트
        const cheerersTopics = boardCheerTopicsMap[post.id] || [];
        const interestedCheerCount = cheerersTopics.filter(userTopics => 
            userTopics.includes(topicName)
        ).length;
        
        // 날짜 계산 (D-Day)
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
            topics: currentTopics,
            location: post.region ? `${post.region}${post.district ? ` > ${post.district}` : ""}` : "온라인",
            region: post.region || "온라인",
            district: post.district || "",
            dateDisplay: (post.start_date && post.end_date) ? `${format(post.start_date, post.is_start_time_set)} ~ ${format(post.end_date, post.is_end_time_set)}` : "상시 진행",
            start_date: post.start_date,
            end_date: post.end_date,
            
            // 1. 단순 응원 숫자 (아이콘 옆 표시용)
            cheerCount: totalCount,
            
            is_cheered: userCheerSet.has(post.id), 
            is_author: currentUserId === post.user_id, 
            host_type: finalHostType,
            dDay,
            isTodayEnd, 
            
            // 2. 관심사 기반 텍스트 (해당 의제에 관심있는 사람 수만 표기)
            interestMessage: `${topicName} 의제에 관심이 있는 ${interestedCheerCount}명이 연대합니다!`
        };
    });
}

/**
 * 정렬 스크립트 파라미터 생성 헬퍼
 */
const getSortParams = () => {
    const now = new Date();
    return {
        now: now.getTime(),
        dayStart: new Date(now.setHours(0, 0, 0, 0)).getTime(),
        dayEnd: new Date(now.setHours(23, 59, 59, 999)).getTime()
    };
};

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

        // 일반 필터 처리
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

        // 지역/구 세트 필터
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
            sort: [
                {
                    _script: {
                        type: "number",
                        script: {
                            lang: "painless",
                            source: `
                                if (doc['end_date'].size() == 0) return 2;
                                long end = doc['end_date'].value.toInstant().toEpochMilli();
                                if (end >= params.dayStart && end <= params.dayEnd) return 0; // 오늘 종료
                                if (end > params.dayEnd) return 1; // 미래 종료
                                return 3; // 마감됨
                            `,
                            params: getSortParams()
                        },
                        order: "asc"
                    }
                },
                { "created_at": { "order": "desc" } } // 그 외 최신순
            ]
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
            sort: [
                {
                    _script: {
                        type: "number",
                        script: {
                            lang: "painless",
                            source: `
                                if (doc['end_date'].size() == 0) return 2;
                                long end = doc['end_date'].value.toInstant().toEpochMilli();
                                if (end >= params.dayStart && end <= params.dayEnd) return 0;
                                if (end > params.dayEnd) return 1;
                                return 3;
                            `,
                            params: getSortParams()
                        },
                        order: "asc"
                    }
                },
                { "created_at": { "order": "desc" } }
            ]
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