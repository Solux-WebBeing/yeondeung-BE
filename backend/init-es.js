const { Client } = require('@elastic/elasticsearch');
require('dotenv').config({ path: '../.env' });

const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });
const INDEX_NAME = 'boards';

async function initIndex() {
  try {
    const exists = await esClient.indices.exists({ index: INDEX_NAME });
    if (exists) {
      await esClient.indices.delete({ index: INDEX_NAME });
    }

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
                // 검색용: 복합명사 분해
                nori_analyzer: {
                  type: "custom",
                  tokenizer: "nori_mixed_tokenizer",
                  filter: ["lowercase", "nori_readingform"]
                },
                // 추천용: 단어 원형 유지 및 정제
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
              fields: { partial: { type: "text", analyzer: "partial_analyzer" } }
            },
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
              fields: { partial: { type: "text", analyzer: "partial_analyzer" } }
            },
            region: { type: "keyword" },
            district: { type: "keyword" },
            link: { type: "keyword" },
            is_verified: { type: "boolean" },
            ai_verified: { type: "boolean" },
            start_date: { type: "date", format: "yyyy-MM-dd HH:mm:ss" },
            end_date: { type: "date", format: "yyyy-MM-dd HH:mm:ss" },
            created_at: { type: "date", format: "yyyy-MM-dd HH:mm:ss" },
            updated_at: { type: "date", format: "yyyy-MM-dd HH:mm:ss" }
          }
        }
      }
    });
    console.log("✅ 인덱스 초기화 완료!");
  } catch (err) {
    console.error("❌ 에러:", err);
    process.exit(1);
  }
}
initIndex();