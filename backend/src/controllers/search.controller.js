const { Client } = require('@elastic/elasticsearch');
const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });
const pool = require('../../db');

/**
 * 1. 게시글 통합 검색 API
 * - 로그인 필수
 * - 의제 다중 선택 시 OR 연산
 * - UI 카드 최적화 포맷팅
 */
exports.searchPosts = async (req, res) => {
    try {
        // [인증] 로그인 여부 확인
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

        // Elasticsearch 쿼리 빌드
        const esQuery = {
            bool: {
                must: [],
                filter: []
            }
        };

        // 키워드 검색 (제목 가중치 10배)
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

        // 의제(Topics) OR 연산 필터
        if (topics) {
            const topicList = topics.split(',')
                .map(t => t.trim())
                .filter(t => t !== ""); // 공백 제거
            
            if (topicList.length > 0) {
                esQuery.bool.filter.push({
                    bool: {
                        should: topicList.map(topic => ({
                            match_phrase: { topics: topic }
                        })),
                        minimum_should_match: 1
                    }
                });
            }
        }

        // 지역 필터 (정확도 일치)
        if (region) {
            esQuery.bool.filter.push({ term: { region: region } });
            if (district) esQuery.bool.filter.push({ term: { district: district } });
        }

        // 기타 필터 (참여방식, 주최유형)
        if (participation_type) esQuery.bool.filter.push({ term: { participation_type: participation_type } });
        if (host_type) esQuery.bool.filter.push({ term: { host_type: host_type } });

        // 날짜 범위 필터
        if (start_date || end_date) {
            esQuery.bool.filter.push({
                range: {
                    start_date: { gte: start_date || "2000-01-01 00:00:00" },
                    end_date: { lte: end_date || "2099-12-31 23:59:59" }
                }
            });
        }

        // ES 검색 실행 (정렬 스크립트 포함)
        const response = await esClient.search({
            index: 'boards',
            from: from,
            size: size,
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

        // MySQL 실시간 응원수 병합
        const boardIds = results.map(post => post.id);
        const [cheerCounts] = await pool.query(
            `SELECT board_id, COUNT(*) as count FROM cheers WHERE board_id IN (?) GROUP BY board_id`,
            [boardIds]
        );
        const cheerMap = cheerCounts.reduce((acc, cur) => {
            acc[cur.board_id] = cur.count;
            return acc;
        }, {});

        // 최종 데이터 UI 가공
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const cardData = results.map(post => {
            const count = cheerMap[post.id] || 0;
            
            // D-Day 계산
            let dDay = "상시";
            let isTodayEnd = false;
            if (post.end_date) {
                const endDate = new Date(post.end_date);
                const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
                const diffDays = Math.ceil((endDateOnly - today) / (1000 * 60 * 60 * 24));
                dDay = diffDays < 0 ? "마감" : diffDays === 0 ? "D-0" : `D-${diffDays}`;
                isTodayEnd = diffDays === 0;
            }

            // 날짜 포맷팅 (2025. 12. 30)
            const formatDate = (dateVal) => {
                if (!dateVal) return "";
                const d = new Date(dateVal);
                return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}`;
            };

            const topicList = post.topics ? post.topics.split(',').map(t => t.trim()).filter(t => t !== "") : [];

            return {
                id: post.id,
                title: post.title,
                topics: topicList,
                location: post.region ? `${post.region}${post.district ? ` > ${post.district}` : ""}` : "온라인",
                dateDisplay: (post.start_date && post.end_date) ? `${formatDate(post.start_date)} ~ ${formatDate(post.end_date)}` : "상시 진행",
                cheerCount: count,
                dDay: dDay,
                isTodayEnd: isTodayEnd,
                interestMessage: `${topicList[0] || '사회'} 의제에 관심이 있는 ${count}명이 연대합니다!`
            };
        });

        res.status(200).json({
            success: true,
            total,
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / size),
            data: cardData
        });

    } catch (error) {
        console.error('Search Controller Error:', error);
        res.status(500).json({ success: false, message: '검색 엔진 서버 오류' });
    }
};

/**
 * 2. 실시간 추천 검색어 API (로그인 필수)
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