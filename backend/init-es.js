const { Client } = require('@elastic/elasticsearch');
require('dotenv').config({ path: '../.env' });

const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });
const INDEX_NAME = 'boards';

/**
 * 인덱스 초기화 및 매핑 업데이트 함수
 */
async function initIndex() {
  try {
    const exists = await esClient.indices.exists({ index: INDEX_NAME });

    // 공통 날짜 포맷 정의 (기존 포맷 + ISO 8601 + 타임스탬프 모두 허용)
    const dateFieldConfig = {
      type: "date",
      format: "yyyy-MM-dd HH:mm:ss||strict_date_optional_time||epoch_millis"
    };

    if (!exists) {
      // 1. 인덱스가 없는 경우: 신규 생성
      await esClient.indices.create({
        index: INDEX_NAME,
        body: {
          settings: {
            index: {
              analysis: {
                filter: {
                  edge_ngram_filter: { type: "edge_ngram", min_gram: 2, max_gram: 10 }
                },
                analyzer: {
                  nori_analyzer: {
                    type: "custom",
                    tokenizer: "nori_mixed_tokenizer",
                    filter: ["lowercase", "nori_readingform"]
                  },
                  suggest_analyzer: {
                    type: "custom",
                    tokenizer: "nori_none_tokenizer",
                    filter: ["lowercase"]
                  },
                  partial_analyzer: {
                    type: "custom",
                    tokenizer: "standard",
                    filter: ["lowercase", "edge_ngram_filter"]
                  }
                },
                tokenizer: {
                  nori_mixed_tokenizer: { type: "nori_tokenizer", decompound_mode: "mixed" },
                  nori_none_tokenizer: { type: "nori_tokenizer", decompound_mode: "none" }
                }
              }
            }
          },
          mappings: {
            properties: {
              id: { type: "integer" },
              user_id: { type: "integer" },
              host_type: { type: "keyword" },
              participation_type: { type: "keyword" },

              title: { 
                type: "text",
                analyzer: "nori_analyzer",
                fields: {
                  partial: { type: "text", analyzer: "partial_analyzer" }
                }
              },

              // 🔥 FIX 1: completion suggest
              suggest: {
                type: "completion",
                analyzer: "suggest_analyzer",
                preserve_separators: true,
                preserve_position_increments: true
              },

              topics: { type: "keyword" },

              content: { 
                type: "text",
                analyzer: "nori_analyzer",
                fields: {
                  partial: { type: "text", analyzer: "partial_analyzer" }
                }
              },

              region: { type: "keyword" },
              district: { type: "keyword" },
              link: { type: "keyword" },

              is_verified: { type: "boolean" },
              ai_verified: { type: "boolean" },

              start_date: dateFieldConfig,
              end_date: dateFieldConfig,
              created_at: dateFieldConfig,
              updated_at: dateFieldConfig,

              // 🔥 FIX 2: 정렬 필드
              sort_group: { type: "integer" },
              sort_end: { type: "long" }
            }
          }

        }
      });
      console.log("✅ 인덱스 신규 생성 완료!");
    } else {
      // 2. 인덱스가 있는 경우: 매핑만 업데이트 (기존 데이터 유지)
      await esClient.indices.putMapping({
        index: INDEX_NAME,
        body: {
          properties: {
            start_date: dateFieldConfig,
            end_date: dateFieldConfig,
            created_at: dateFieldConfig,
            updated_at: dateFieldConfig
          }
        }
      });
      console.log("✅ 인덱스 매핑 업데이트 완료 (데이터 유지)!");
    }
  } catch (err) {
    console.error("❌ 에러:", err.meta?.body?.error || err.message);
    process.exit(1);
  }
}

initIndex();