const { Client } = require('@elastic/elasticsearch');
require('dotenv').config({ path: '../.env' });

// Elasticsearch 클라이언트 설정
const esClient = new Client({ 
  node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' 
});

const INDEX_NAME = 'boards';

async function initIndex() {
  try {
    // 1. 기존 인덱스 존재 여부 확인 및 삭제
    const exists = await esClient.indices.exists({ index: INDEX_NAME });
    if (exists) {
      console.log(`기존 [${INDEX_NAME}] 인덱스를 삭제합니다...`);
      await esClient.indices.delete({ index: INDEX_NAME });
    }

    // 2. 인덱스 생성 (Settings + Mappings)
    console.log(`[${INDEX_NAME}] 인덱스를 생성합니다 (추천 검색어 필드 포함)...`);
    await esClient.indices.create({
      index: INDEX_NAME,
      body: {
        settings: {
          index: {
            analysis: {
              filter: {
                // 부분 일치 검색을 위한 Edge N-gram (2글자부터 10글자까지)
                edge_ngram_filter: {
                  type: "edge_ngram",
                  min_gram: 2,
                  max_gram: 10
                }
              },
              analyzer: {
                // 기본 한글 형태소 분석기
                nori_analyzer: {
                  type: "custom",
                  tokenizer: "nori_tokenizer",
                  filter: ["nori_readingform", "lowercase"]
                },
                // 부분 일치(Search-as-you-type) 분석기
                partial_analyzer: {
                  type: "custom",
                  tokenizer: "standard",
                  filter: ["lowercase", "edge_ngram_filter"]
                }
              },
              tokenizer: {
                // 한글 토크나이저 (복합명사 분해 모드: mixed)
                nori_tokenizer: {
                  type: "nori_tokenizer",
                  decompound_mode: "mixed"
                }
              }
            }
          }
        },
        mappings: {
          properties: {
            id: { type: "integer" },
            user_id: { type: "integer" },
            host_type: { type: "keyword" }, // INDIVIDUAL, ORGANIZATION
            participation_type: { type: "keyword" }, // 집회, 서명, 청원 등
            
            // 제목: 형태소 분석 + 부분 일치(partial) 지원
            title: { 
              type: "text", 
              analyzer: "nori_analyzer",
              fields: {
                partial: { type: "text", analyzer: "partial_analyzer" } 
              }
            },
            
            // [핵심] 실시간 추천 검색어 전용 필드 (Completion Suggester)
            suggest: {
              type: "completion",
              analyzer: "nori_analyzer",
              preserve_separators: true,
              preserve_position_increments: true
            },
            
            topics: { type: "keyword" }, // 의제 (여성, 환경 등)
            
            // 본문: 형태소 분석 + 부분 일치 지원
            content: { 
              type: "text", 
              analyzer: "nori_analyzer",
              fields: {
                partial: { type: "text", analyzer: "partial_analyzer" }
              }
            },
            
            region: { type: "keyword" }, // 시/도
            district: { type: "keyword" }, // 시/군/구
            link: { type: "keyword" },
            is_verified: { type: "boolean" },
            ai_verified: { type: "boolean" },
            
            // 날짜 포맷 지정
            start_date: { type: "date", format: "yyyy-MM-dd HH:mm:ss" },
            end_date: { type: "date", format: "yyyy-MM-dd HH:mm:ss" },
            created_at: { type: "date", format: "yyyy-MM-dd HH:mm:ss" },
            updated_at: { type: "date", format: "yyyy-MM-dd HH:mm:ss" }
          }
        }
      }
    });

    console.log("✅ 추천 검색어 기능이 포함된 인덱스 초기화가 완료되었습니다!");
  } catch (err) {
    console.error("❌ 인덱스 초기화 중 에러 발생:");
    console.error(JSON.stringify(err, null, 2));
    process.exit(1);
  }
}

initIndex();