const { Client } = require('@elastic/elasticsearch');
const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });
const pool = require('../../db');

/**
 * 1. 게시글 통합 검색 API (정밀 랜덤 의제 버전)
 */
exports.searchPosts = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ success: false, message: "로그인이 필요한 서비스입니다." });
        }

        const { 
            q, topics, region, district, 
            participation_type, host_type, 
            start_date, end_date, 
            page = 1 
        } = req.query;

        const size = 8; 
        const from = (page - 1) * size;

        // --- (1) Elasticsearch 쿼리 빌드 (검색 엔진 조회) ---
        const esQuery = { bool: { must: [], filter: [] } };

        esQuery.bool.filter.push({
            range: {
                end_date: {
                    gte: "now-30d/d" // 현재 시각에서 30일 전까지 (날짜 단위로 계산)
                }
            }
        });        

        if (q && q.trim() !== "") {
            esQuery.bool.must.push({
                multi_match: {
                    query: q,
                    fields: ["title^10", "title.partial^1", "content^3", "content.partial^0.5"],
                    type: "most_fields", 
                    operator: "and",
                    minimum_should_match: "2<75%"
                }
            });
        }

        // 필터 로직 생략 없이 유지 (topics, region 등)
        if (topics) {
            const topicList = topics.split(',').map(t => t.trim()).filter(t => t !== "");
            if (topicList.length > 0) {
                esQuery.bool.filter.push({
                    bool: { should: topicList.map(topic => ({ match_phrase: { topics: topic } })), minimum_should_match: 1 }
                });
            }
        }
        if (region) {
            esQuery.bool.filter.push({ term: { region: region } });
            if (district) esQuery.bool.filter.push({ term: { district: district } });
        }
        if (participation_type) esQuery.bool.filter.push({ term: { participation_type: participation_type } });
        if (host_type) esQuery.bool.filter.push({ term: { host_type: host_type } });

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
                                def end = doc['end_date'].value.toString().substring(0, 10);
                                return end == params.today ? 0 : 1;
                            `,
                            params: { today: new Date().toISOString().substring(0, 10) }
                        },
                        order: "asc"
                    }
                },
                { _score: { order: "desc" } },
                { created_at: { order: "desc" } }
            ]
        });

        const total = response.hits.total.value;
        const results = response.hits.hits.map(hit => hit._source);
        if (total === 0) return res.status(200).json({ success: true, total: 0, data: [] });

        const boardIds = results.map(post => post.id);

        // --- (2) MySQL 정규화 쿼리: 1) 전체 응원수 + 2) 의제별 정밀 응원수 ---
        
        // 2-1. 게시글별 전체 응원수 (cheerCount용)
        const [totalCheers] = await pool.query(
            `SELECT board_id, COUNT(*) as count FROM cheers WHERE board_id IN (?) GROUP BY board_id`,
            [boardIds]
        );
        const cheerMap = totalCheers.reduce((acc, cur) => { acc[cur.board_id] = cur.count; return acc; }, {});

        // 2-2. [핵심] 의제별 정밀 응원수 조회 (interestMessage용)
        // 각 게시글에 연결된 모든 의제에 대해, 해당 의제를 관심사로 둔 유저의 응원만 카운트
        const [topicStats] = await pool.query(`
            SELECT 
                bt.board_id,
                t.name AS topic_name,
                COUNT(DISTINCT c.user_id) AS individual_topic_count
            FROM board_topics bt
            JOIN topics t ON bt.topic_id = t.id
            LEFT JOIN user_interests ui ON bt.topic_id = ui.topic_id
            LEFT JOIN cheers c ON ui.user_id = c.user_id AND bt.board_id = c.board_id
            WHERE bt.board_id IN (?)
            GROUP BY bt.board_id, bt.topic_id
        `, [boardIds]);

        // 데이터를 Map 구조로 변환: board_id -> [ {name: '환경', count: 5}, {name: '인권', count: 3} ]
        const topicStatsMap = topicStats.reduce((acc, cur) => {
            if (!acc[cur.board_id]) acc[cur.board_id] = [];
            acc[cur.board_id].push({ name: cur.topic_name, count: cur.individual_topic_count });
            return acc;
        }, {});

        // --- (3) UI 데이터 가공 ---
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const cardData = results.map(post => {
            const totalCount = cheerMap[post.id] || 0;
            const stats = topicStatsMap[post.id] || [];

            // [랜덤 선택] 해당 게시글의 의제 통계 중 하나를 무작위로 선택
            const selected = stats.length > 0 
                ? stats[Math.floor(Math.random() * stats.length)] 
                : { name: "사회", count: 0 };

            // D-Day 및 날짜 포맷팅 로직
            let dDay = "상시";
            let isTodayEnd = false;
            if (post.end_date) {
                const endDate = new Date(post.end_date);
                const diffDays = Math.ceil((new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()) - today) / (1000 * 60 * 60 * 24));
                dDay = diffDays < 0 ? "마감" : diffDays === 0 ? "D-0" : `D-${diffDays}`;
                isTodayEnd = diffDays === 0;
            }
            // const formatDate = (d) => d ? new Date(d).toISOString().split('T')[0].replace(/-/g, '. ') : "";
            // 날짜/시간 포맷팅 함수 수정
            const formatDisplayDate = (dateStr, isTimeSet) => {
                if (!dateStr) return "";
                const date = new Date(dateStr);
                const ymd = date.toISOString().split('T')[0].replace(/-/g, '. ');
                if (isTimeSet) {
                    const hhmm = dateStr.substring(11, 16); // "YYYY-MM-DD HH:MM:SS"에서 HH:MM 추출
                    return `${ymd} ${hhmm}`;
                }
                return ymd;
            };

            return {
                id: post.id,
                title: post.title,
                topics: post.topics ? post.topics.split(',').map(t => t.trim()) : [],
                location: post.region ? `${post.region}${post.district ? ` > ${post.district}` : ""}` : "온라인",
                dateDisplay: (post.start_date && post.end_date) 
                    ? `${formatDisplayDate(post.start_date, post.is_start_time_set)} ~ ${formatDisplayDate(post.end_date, post.is_end_time_set)}` 
                    : "상시 진행",
                cheerCount: totalCount,
                dDay,
                isTodayEnd,
                interestMessage: `${selected.name} 의제에 관심이 있는 ${selected.count}명이 연대합니다!`
            };
        });

        res.status(200).json({ success: true, total, currentPage: parseInt(page), totalPages: Math.ceil(total / size), data: cardData });

    } catch (error) {
        console.error('Search Controller Error:', error);
        res.status(500).json({ success: false, message: '검색 엔진 서버 오류' });
    }
};

/**
 * 2. 실시간 추천 검색어 API (생략 없이 유지)
 */
exports.getSuggestions = async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
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