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
 * [Helper] MySQL 데이터 보강 및 UI 가공 공통 함수 (정규화된 스키마 대응)
 */
async function enrichDataWithMySQL(results, currentUserId = null) {
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

        // [수정된 format 헬퍼]
        const format = (d, t) => {
            if (!d) return "";
            const dateObj = new Date(d);
            const isoStr = dateObj.toISOString(); // "2023-10-25T14:30:00.000Z"
            
            const datePart = isoStr.split('T')[0].replace(/-/g, '. '); // "2023. 10. 25"
            const timePart = t ? ' ' + isoStr.substring(11, 16) : '';  // t가 true면 " 14:30" 추가
            
            return `${datePart}${timePart}`;
        };
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