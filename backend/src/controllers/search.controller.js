const { Client } = require('@elastic/elasticsearch');
const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });

/**
 * 게시글 통합 검색 API
 * 수정사항: 멀티 필드 전략(.partial) 및 가중치(Boosting) 반영
 */
exports.searchPosts = async (req, res) => {
    try {
        const { 
            q, topics, region, district, 
            participation_type, host_type, 
            start_date, end_date, 
            page = 1 
        } = req.query;

        const size = 8; // 명세서: 한 페이지에 8개 카드 노출 [cite: 1671]
        const from = (page - 1) * size;

        const esQuery = {
            bool: {
                must: [],   // 키워드 검색 (Score 영향) [cite: 1038]
                filter: []  // 정확한 조건 필터링 [cite: 1097]
            }
        };

        // [수정 포인트] 키워드 검색 시 .partial 필드 추가 및 가중치 적용
        if (q && q.trim() !== "") {
            esQuery.bool.must.push({
                multi_match: {
                    query: q,
                    fields: [
                        "title^10",         // 제목 정확도 가중치를 대폭 높임 (가장 중요)
                        "title.partial^1",  // 부분 일치는 보조적으로만 (점수 낮춤)
                        "content^3",        // 본문 형태소 일치
                        "content.partial^0.5" // 본문 부분 일치는 아주 낮게
                    ],
                    type: "most_fields", 
                    operator: "and",         // '기후'와 '위기'가 모두 포함된 것만!
                    minimum_should_match: "2<75%" // 2단어 이상일 때 75% 이상 매칭 필요
                }
            });
        }

        // 의제(Topic) 필터 [cite: 1103]
        if (topics) {
            esQuery.bool.filter.push({ term: { topics: topics } });
        }

        // 지역(Region/District) 필터 [cite: 1106, 1107]
        if (region) {
            esQuery.bool.filter.push({ term: { region: region } });
            if (district) {
                esQuery.bool.filter.push({ term: { district: district } });
            }
        }

        // 참여 방식 및 주최 유형 필터 [cite: 1275]
        if (participation_type) {
            esQuery.bool.filter.push({ term: { participation_type: participation_type } });
        }
        if (host_type) {
            esQuery.bool.filter.push({ term: { host_type: host_type } });
        }

        // 기간 필터 (시작일 ~ 종료일) [cite: 1275]
        if (start_date || end_date) {
            esQuery.bool.filter.push({
                range: {
                    start_date: { gte: start_date || "2000-01-01 00:00:00" },
                    end_date: { lte: end_date || "2099-12-31 23:59:59" }
                }
            });
        }

        const response = await esClient.search({
            index: 'boards',
            from: from,
            size: size,
            query: esQuery.bool.must.length > 0 || esQuery.bool.filter.length > 0 ? esQuery : { match_all: {} },
            sort: [
                // 1순위: 오늘 종료 활동 
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
                // 2순위: 연관성 점수 
                { _score: { order: "desc" } },
                // 3순위: 최신순
                { created_at: { order: "desc" } }
            ]
        });

        const total = response.hits.total.value;
        const results = response.hits.hits.map(hit => hit._source);

        if (total === 0) {
            return res.status(200).json({
                success: true,
                total: 0,
                message: "검색 결과가 존재하지 않습니다.", // [cite: 1042]
                data: []
            });
        }

        res.status(200).json({
            success: true,
            total: total,
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / size),
            data: results
        });

    } catch (error) {
        console.error('Search Controller Error:', error);
        res.status(500).json({ success: false, message: '검색 엔진 서버 오류' });
    }
};


/**
 * 실시간 추천 검색어 API
 * - 사용자가 입력한 접두어(prefix)를 바탕으로 완성된 단어 제안
 */
exports.getSuggestions = async (req, res) => {
    try {
        const { q } = req.query; // 사용자가 입력 중인 텍스트

        if (!q || q.trim().length < 1) {
            return res.status(200).json({ success: true, data: [] });
        }

        const response = await esClient.search({
            index: 'boards',
            _source: false, // 성능 최적화를 위해 본문 데이터는 제외
            suggest: {
                "board-suggestions": {
                    prefix: q,
                    completion: {
                        field: "suggest", // init-es.js에서 만든 필드명
                        size: 5,          // 추천어 5개 노출
                        skip_duplicates: true, // 중복된 추천어 제거
                        fuzzy: {          // 오타 교정 기능 (예: '기휴' -> '기후')
                            fuzziness: "AUTO"
                        }
                    }
                }
            }
        });

        // Elasticsearch 응답에서 텍스트만 추출
        const suggestions = response.suggest["board-suggestions"][0].options.map(
            option => option.text
        );

        res.status(200).json({
            success: true,
            data: suggestions
        });
    } catch (error) {
        console.error('Suggestion Error:', error);
        res.status(500).json({ success: false, message: '추천 검색어 로드 오류' });
    }
};


