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
            page = 1 
        } = req.query;

        const size = 8; 
        const from = (page - 1) * size;

        const esQuery = { bool: { must: [], filter: [] } };

        // 1. 기본 필터: 최근 30일 데이터
        esQuery.bool.filter.push({
            range: { end_date: { gte: "now-30d/d" } }
        });         

        // 2. 검색어 처리 (Must)
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

        // --- 다중 선택(OR 연산) 처리 유틸리티 함수 ---
        const addMultiFilter = (field, valueString) => {
            if (valueString) {
                const values = valueString.split(',').map(v => v.trim()).filter(v => v !== "");
                if (values.length > 0) {
                    // terms 쿼리는 자동으로 해당 배열 내의 값 중 하나라도 일치하면 매칭(OR)합니다.
                    esQuery.bool.filter.push({ terms: { [field]: values } });
                }
            }
        };

        // 3. 의제(Topics) 필터 (기존 로직 유지 - 콤마 분리형 필드일 경우 대비)
        if (topics) {
            const topicList = topics.split(',').map(t => t.trim()).filter(t => t !== "");
            if (topicList.length > 0) {
                esQuery.bool.filter.push({
                    bool: { 
                        should: topicList.map(topic => ({ match_phrase: { topics: topic } })), 
                        minimum_should_match: 1 
                    }
                });
            }
        }

        // 4. 지역(Region/District) 다중 선택 처리
        addMultiFilter('region', region);
        addMultiFilter('district', district);

        // 5. 참여 방식 다중 선택 처리
        addMultiFilter('participation_type', participation_type);

        // 6. 주최자 유형 다중 선택 처리
        addMultiFilter('host_type', host_type);

        // --- [이하 Elasticsearch 실행 및 정렬 로직 동일] ---
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

        // --- [이하 MySQL 조인 및 가공 로직 동일] ---
        // (생략: 기존 코드와 동일하게 처리하시면 됩니다.)
        const total = response.hits.total.value;
        const results = response.hits.hits.map(hit => hit._source);
        if (total === 0) return res.status(200).json({ success: true, total: 0, data: [] });

        const boardIds = results.map(post => post.id);

        const [totalCheers] = await pool.query(
            `SELECT board_id, COUNT(*) as count FROM cheers WHERE board_id IN (?) GROUP BY board_id`,
            [boardIds]
        );
        const cheerMap = totalCheers.reduce((acc, cur) => { acc[cur.board_id] = cur.count; return acc; }, {});

        const [topicStats] = await pool.query(`
            SELECT bt.board_id, t.name AS topic_name, COUNT(DISTINCT c.user_id) AS individual_topic_count
            FROM board_topics bt
            JOIN topics t ON bt.topic_id = t.id
            LEFT JOIN user_interests ui ON bt.topic_id = ui.topic_id
            LEFT JOIN cheers c ON ui.user_id = c.user_id AND bt.board_id = c.board_id
            WHERE bt.board_id IN (?)
            GROUP BY bt.board_id, bt.topic_id
        `, [boardIds]);

        const topicStatsMap = topicStats.reduce((acc, cur) => {
            if (!acc[cur.board_id]) acc[cur.board_id] = [];
            acc[cur.board_id].push({ name: cur.topic_name, count: cur.individual_topic_count });
            return acc;
        }, {});

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const cardData = results.map(post => {
            const totalCount = cheerMap[post.id] || 0;
            const stats = topicStatsMap[post.id] || [];
            const selected = stats.length > 0 ? stats[Math.floor(Math.random() * stats.length)] : { name: "사회", count: 0 };
            
            let dDay = "상시";
            let isTodayEnd = false;
            if (post.end_date) {
                const endDate = new Date(post.end_date);
                const diffDays = Math.ceil((new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()) - today) / (1000 * 60 * 60 * 24));
                dDay = diffDays < 0 ? "마감" : diffDays === 0 ? "D-0" : `D-${diffDays}`;
                isTodayEnd = diffDays === 0;
            }

            const formatDisplayDate = (dateStr, isTimeSet) => {
                if (!dateStr) return "";
                const date = new Date(dateStr);
                const ymd = date.toISOString().split('T')[0].replace(/-/g, '. ');
                return isTimeSet ? `${ymd} ${dateStr.substring(11, 16)}` : ymd;
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