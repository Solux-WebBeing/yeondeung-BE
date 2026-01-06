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
 * @param {Array} results - Elasticsearch 검색 결과 리스트
 * @param {Number|null} currentUserId - 로그인한 사용자의 ID (비로그인 시 null)
 */
async function enrichDataWithMySQL(results, currentUserId = null) {
    if (!results || results.length === 0) return [];
    
    const boardIds = results.map(post => post.id);

    // 1. 전체 응원수 조회
    const [totalCheers] = await pool.query(
        `SELECT board_id, COUNT(*) as count FROM cheers WHERE board_id IN (?) GROUP BY board_id`,
        [boardIds]
    );
    const cheerMap = totalCheers.reduce((acc, cur) => { acc[cur.board_id] = cur.count; return acc; }, {});

    // 2. [로그인 시 전용] 사용자가 응원했는지 여부 조회
    let userCheerSet = new Set();
    if (currentUserId) {
        const [userCheers] = await pool.query(
            `SELECT board_id FROM cheers WHERE user_id = ? AND board_id IN (?)`,
            [currentUserId, boardIds]
        );
        userCheerSet = new Set(userCheers.map(c => c.board_id));
    }

    // 3. 의제별 연대자 통계 조회
    const [topicStats] = await pool.query(`
        SELECT bt.board_id, t.name AS topic_name, COUNT(DISTINCT c.user_id) AS individual_topic_count
        FROM board_topics bt JOIN topics t ON bt.topic_id = t.id
        LEFT JOIN user_interests ui ON bt.topic_id = ui.topic_id
        LEFT JOIN cheers c ON ui.user_id = c.user_id AND bt.board_id = c.board_id
        WHERE bt.board_id IN (?) GROUP BY bt.board_id, bt.topic_id`, [boardIds]);

    const topicStatsMap = topicStats.reduce((acc, cur) => {
        if (!acc[cur.board_id]) acc[cur.board_id] = [];
        acc[cur.board_id].push({ name: cur.topic_name, count: cur.individual_topic_count });
        return acc;
    }, {});

    // 4. 썸네일 이미지 조회
    const [boardImages] = await pool.query(
        `SELECT board_id, image_url FROM board_images WHERE board_id IN (?) ORDER BY id ASC`,
        [boardIds]
    );
    const imageMap = {};
    boardImages.forEach(img => { if (!imageMap[img.board_id]) imageMap[img.board_id] = img.image_url; });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return results.map(post => {
        // 1. 게시글 자체의 topics 가공 (배열로 변환)
        const currentTopics = Array.isArray(post.topics) 
            ? post.topics 
            : (post.topics ? post.topics.split(',').map(t => t.trim()) : []);
        
        // 2. [핵심] 게시글의 topics 배열 내에서 랜덤하게 하나 선택
        let topicName = "사회"; 
        if (currentTopics.length > 0) {
            // 배열의 길이만큼 범위 내에서 랜덤 인덱스 추출
            const randomIndex = Math.floor(Math.random() * currentTopics.length);
            topicName = currentTopics[randomIndex];
        }

        // 3. 응원 수 및 기타 변수 설정
        const totalCount = cheerMap[post.id] || 0;
        let dDay = "상시";
        if (post.end_date) {
            const endDate = new Date(post.end_date);
            const diffDays = Math.ceil((new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()) - today) / (1000 * 60 * 60 * 24));
            dDay = diffDays < 0 ? "마감" : diffDays === 0 ? "D-0" : `D-${diffDays}`;
        }

        const format = (d, t) => d ? `${new Date(d).toISOString().split('T')[0].replace(/-/g, '. ')}${t ? ' ' + d.substring(11, 16) : ''}` : "";

        return {
            id: post.id,
            title: post.title,
            thumbnail: imageMap[post.id] || "none",
            topics: currentTopics,
            location: post.region ? `${post.region}${post.district ? ` > ${post.district}` : ""}` : "온라인",
            dateDisplay: (post.start_date && post.end_date) ? `${format(post.start_date, post.is_start_time_set)} ~ ${format(post.end_date, post.is_end_time_set)}` : "상시 진행",
            cheerCount: totalCount,
            is_cheered: userCheerSet.has(post.id), 
            is_author: currentUserId === post.user_id, 
            dDay,
            // 4. 게시글 topics에서 뽑은 랜덤 topicName 적용
            interestMessage: `${topicName} 의제에 관심이 있는 ${totalCount}명이 연대합니다!`
        };
    });
}

/**
 * 1. 게시글 통합 검색 (기간 필터 강화 + 비로그인 허용)
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

        // 1. 일반 다중 선택 필터 (토픽, 참여 형태, 주최 형태)
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

        // 2. [수정 포인트] 지역(Region) 및 상세 구(District) 세트 필터
        // Region이 있으면 필수 조건으로 걸고, District가 여러 개면 그 안에서 '합집합(OR)' 처리
        if (region) {
            esQuery.bool.filter.push({ match_phrase: { region: region.trim() } });
        }

        if (district) {
            const districts = district.split(',').map(v => v.trim()).filter(Boolean);
            if (districts.length > 0) {
                esQuery.bool.filter.push({
                    bool: {
                        // 여러 구 중 하나라도 일치하면 결과에 포함 (합집합)
                        should: districts.map(d => ({ match_phrase: { district: d } })),
                        minimum_should_match: 1
                    }
                });
            }
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
                                if (doc['end_date'].size() == 0) return 1;
                                long now = params.now;
                                long end = doc['end_date'].value.toInstant().toEpochMilli();
                                return end >= now ? 0 : 2;
                            `,
                            params: { now: new Date().getTime() }
                        },
                        order: "asc"
                    }
                },
                { "end_date": { "order": "asc", "missing": "_last", "unmapped_type": "date" } },
                { "_score": { "order": "desc" } }
            ]
        });

        // req.user가 있으면 그 ID를, 없으면 null을 넘깁니다.
        const cardData = await enrichDataWithMySQL(response.hits.hits.map(hit => hit._source), req.user?.id);
        res.status(200).json({ success: true, total: response.hits.total.value, currentPage: parseInt(page), totalPages: Math.ceil(response.hits.total.value / size), data: cardData });

    } catch (error) {
        console.error('Search Error:', error);
        res.status(500).json({ success: false, message: '검색 엔진 오류' });
    }
};

/**
 * 2. 전체 게시글 조회 (8개 페이징 + 마감순 정렬 + 비로그인 허용)
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
                                if (doc['end_date'].size() == 0) return 1;
                                long now = params.now;
                                long end = doc['end_date'].value.toInstant().toEpochMilli();
                                return end >= now ? 0 : 2;
                            `,
                            params: { now: new Date().getTime() }
                        },
                        order: "asc"
                    }
                },
                { "end_date": { "order": "asc", "missing": "_last" } },
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