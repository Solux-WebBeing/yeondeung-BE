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

// [Helper] MySQL 데이터 보강 및 UI 가공 공통 함수
async function enrichDataWithMySQL(results) {
    if (!results || results.length === 0) return [];
    
    const boardIds = results.map(post => post.id);

    // 1. 응원수 조회
    const [totalCheers] = await pool.query(
        `SELECT board_id, COUNT(*) as count FROM cheers WHERE board_id IN (?) GROUP BY board_id`,
        [boardIds]
    );
    const cheerMap = totalCheers.reduce((acc, cur) => { acc[cur.board_id] = cur.count; return acc; }, {});

    // 2. 의제별 연대자 통계 조회
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

    // 3. 썸네일 이미지 조회
    const [boardImages] = await pool.query(
        `SELECT board_id, image_url FROM board_images WHERE board_id IN (?) ORDER BY id ASC`,
        [boardIds]
    );
    const imageMap = {};
    boardImages.forEach(img => { if (!imageMap[img.board_id]) imageMap[img.board_id] = img.image_url; });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return results.map(post => {
        const stats = topicStatsMap[post.id] || [];
        const selected = stats.length > 0 ? stats[Math.floor(Math.random() * stats.length)] : { name: "사회", count: 0 };
        
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
            thumbnail: imageMap[post.id] || "https://your-domain.com/assets/default-thumbnail.png",
            topics: post.topics ? (Array.isArray(post.topics) ? post.topics : post.topics.split(',').map(t => t.trim())) : [],
            location: post.region ? `${post.region}${post.district ? ` > ${post.district}` : ""}` : "온라인",
            dateDisplay: (post.start_date && post.end_date) ? `${format(post.start_date, post.is_start_time_set)} ~ ${format(post.end_date, post.is_end_time_set)}` : "상시 진행",
            cheerCount: cheerMap[post.id] || 0,
            dDay,
            interestMessage: `${selected.name} 의제에 관심이 있는 ${selected.count}명이 연대합니다!`
        };
    });
}

/**
 * 1. 게시글 통합 검색 (기간 필터 강화 버전)
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
        ['topics', 'region', 'district', 'participation_type', 'host_type'].forEach(f => addMultiFilter(f, req.query[f]));

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

        const cardData = await enrichDataWithMySQL(response.hits.hits.map(hit => hit._source));
        res.status(200).json({ success: true, total: response.hits.total.value, currentPage: parseInt(page), totalPages: Math.ceil(response.hits.total.value / size), data: cardData });

    } catch (error) {
        console.error('Search Error:', error);
        res.status(500).json({ success: false, message: '검색 엔진 오류' });
    }
};

/**
 * 2. 전체 게시글 조회 API (8개 페이징 + 마감순 정렬)
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

        const cardData = await enrichDataWithMySQL(response.hits.hits.map(hit => hit._source));
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