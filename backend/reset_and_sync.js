const mysql = require('mysql2/promise');
const { Client } = require('@elastic/elasticsearch');
require('dotenv').config({ path: '../.env' }); // 경로 확인 필요!

const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });
const INDEX_NAME = 'boards';

// [날짜 변환기] 유효하지 않은 날짜(Invalid Date)가 들어오면 null 처리해서 에러 방지
const toEsDateSafe = (dateInput) => {
    if (!dateInput) return null;
    try {
        const d = new Date(dateInput);
        if (isNaN(d.getTime())) return null; // 날짜가 아니면 버림

        // KST 강제 변환 로직
        const pad = (n) => n.toString().padStart(2, '0');
        const y = d.getFullYear();
        const m = pad(d.getMonth() + 1);
        const day = pad(d.getDate());
        const h = pad(d.getHours());
        const min = pad(d.getMinutes());
        const s = pad(d.getSeconds());

        const kstString = `${y}-${m}-${day}T${h}:${min}:${s}+09:00`;
        return new Date(kstString).toISOString();
    } catch (e) {
        return null;
    }
};

async function resetAndSync() {
    let connection;
    try {
        console.log("🔥 [1단계] 기존 인덱스 삭제 중...");
        const exists = await esClient.indices.exists({ index: INDEX_NAME });
        if (exists) {
            await esClient.indices.delete({ index: INDEX_NAME });
            console.log("🗑️ 기존 인덱스 삭제 완료.");
        }

        console.log("🛠️ [2단계] 인덱스 및 매핑 새로 생성 중...");
        const dateFieldConfig = {
            type: "date",
            format: "strict_date_optional_time||epoch_millis" // ISO 8601 허용
        };

        await esClient.indices.create({
            index: INDEX_NAME,
            body: {
                settings: {
                    index: {
                        analysis: {
                            filter: { edge_ngram_filter: { type: "edge_ngram", min_gram: 2, max_gram: 10 } },
                            analyzer: {
                                nori_analyzer: { type: "custom", tokenizer: "nori_mixed_tokenizer", filter: ["lowercase", "nori_readingform"] },
                                suggest_analyzer: { type: "custom", tokenizer: "nori_none_tokenizer", filter: ["lowercase"] },
                                partial_analyzer: { type: "custom", tokenizer: "standard", filter: ["lowercase", "edge_ngram_filter"] }
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
                        title: { type: "text", analyzer: "nori_analyzer", fields: { partial: { type: "text", analyzer: "partial_analyzer" } } },
                        topics: { type: "keyword" },
                        content: { type: "text", analyzer: "nori_analyzer" },
                        region: { type: "keyword" },
                        district: { type: "keyword" },
                        start_date: dateFieldConfig,
                        end_date: dateFieldConfig,
                        created_at: dateFieldConfig,
                        updated_at: dateFieldConfig,
                        suggest: { type: "completion", analyzer: "suggest_analyzer" },
                        thumbnail: { type: "keyword" },
                        host_type: { type: "keyword" },
                        participation_type: { type: "keyword" }
                    }
                }
            }
        });
        console.log("✅ 인덱스 생성 완료.");

        console.log("📥 [3단계] MySQL 데이터 가져오기...");
        connection = await mysql.createConnection({
            host: 'db', // docker-compose service name 확인
            port: 3306,
            user: 'root',
            password: process.env.DB_PASSWORD,
            database: process.env.DB_DATABASE
        });

        const query = `
            SELECT b.*, u.user_type as host_type,
            (SELECT image_url FROM board_images WHERE board_id = b.id ORDER BY id ASC LIMIT 1) as thumbnail
            FROM boards b JOIN users u ON b.user_id = u.id
        `;
        const [rows] = await connection.execute(query);

        if (rows.length === 0) {
            console.log('ℹ️ 동기화할 데이터가 없습니다.');
            return;
        }

        console.log(`🚀 ${rows.length}개 데이터 변환 및 전송 중...`);
        const operations = rows.flatMap(doc => {
            // 날짜가 없거나 이상하면 건너뛰기 로직은 없고 일단 null로 들어감 -> 스크립트에서 size() == 0으로 처리됨
            const start = toEsDateSafe(doc.start_date);
            const end = toEsDateSafe(doc.end_date);
            const created = toEsDateSafe(doc.created_at) || new Date().toISOString();

            const topicArray = doc.topics ? doc.topics.split(',').map(t => t.trim()).filter(Boolean) : [];
            
            // Suggest 빌드
            const suggestSet = new Set();
            if (doc.title) {
                doc.title.replace(/[^\w\sㄱ-ㅎ가-힣]/g, ' ').split(/\s+/).forEach(w => { if(w.length>=2) suggestSet.add(w); });
                suggestSet.add(doc.title.trim());
            }
            topicArray.forEach(t => suggestSet.add(t));

            return [
                { index: { _index: INDEX_NAME, _id: doc.id.toString() } },
                {
                    id: doc.id,
                    user_id: doc.user_id,
                    host_type: doc.host_type,
                    participation_type: doc.participation_type,
                    title: doc.title,
                    content: doc.content,
                    topics: topicArray,
                    region: doc.region,
                    district: doc.district,
                    link: doc.link,
                    is_verified: !!doc.is_verified,
                    ai_verified: !!doc.ai_verified,
                    thumbnail: doc.thumbnail || null,
                    suggest: { input: Array.from(suggestSet).filter(Boolean), weight: 10 },
                    start_date: start,
                    end_date: end,
                    is_start_time_set: !!doc.is_start_time_set,
                    is_end_time_set: !!doc.is_end_time_set,
                    created_at: created,
                    updated_at: toEsDateSafe(doc.updated_at)
                }
            ];
        });

        const response = await esClient.bulk({ refresh: true, operations });

        if (response.errors) {
            console.error('⚠️ 일부 데이터 전송 실패. 에러 로그 확인:');
            response.items.forEach(item => {
                if (item.index && item.index.error) {
                    console.error(`ID ${item.index._id} 실패:`, item.index.error.reason);
                }
            });
        } else {
            console.log("🎉 모든 데이터가 성공적으로 초기화 및 동기화되었습니다!");
        }

    } catch (err) {
        console.error('❌ 치명적 오류:', err);
    } finally {
        if (connection) await connection.end();
    }
}

resetAndSync();
