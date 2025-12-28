const { Client } = require('@elastic/elasticsearch');
require('dotenv').config({ path: '../.env' });

const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });

const INDEX_NAME = 'boards';

async function initIndex() {
  try {
    // 1. 기존 인덱스 존재 여부 확인
    const exists = await esClient.indices.exists({ index: INDEX_NAME });

    if (exists) {
      console.log(`기존 [${INDEX_NAME}] 인덱스를 삭제합니다...`);
      await esClient.indices.delete({ index: INDEX_NAME });
    }

    // 2. 인덱스 생성 (Settings + Mappings 한 번에)
    console.log(`[${INDEX_NAME}] 인덱스를 새 매핑으로 생성합니다...`);
    await esClient.indices.create({
      index: INDEX_NAME,
      body: {
        settings: {
          index: {
            analysis: {
              analyzer: {
                nori_analyzer: {
                  type: "custom",
                  tokenizer: "nori_tokenizer",
                  filter: ["nori_readingform", "lowercase"]
                }
              },
              tokenizer: {
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
            participation_type: { type: "keyword" },
            title: { type: "text", analyzer: "nori_analyzer" },
            topics: { type: "keyword" },
            content: { type: "text", analyzer: "nori_analyzer" },
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

    console.log("인덱스 초기화가 완료되었습니다!");
  } catch (err) {
    console.error("인덱스 초기화 중 에러 발생:");
    console.error(JSON.stringify(err, null, 2));
    process.exit(1);
  }
}

initIndex();