const mysql = require('mysql2/promise');
const { Client } = require('@elastic/elasticsearch');
require('dotenv').config({ path: '../.env' });

const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });
const INDEX_NAME = 'boards';

// [수정] ISO 8601 형식으로 변환하여 타임존 오차 및 파싱 에러 방지
const toEsDate = (date) => {
    if (!date) return null;
    return new Date(date).toISOString(); 
};

async function sync() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: 'db',
            port: 3306,
            user: 'root',
            password: process.env.DB_PASSWORD,
            database: process.env.DB_DATABASE
        });

        console.log('✅ MySQL 연결 성공. 데이터를 조회합니다...');

        const query = `
            SELECT 
                b.*, 
                u.user_type as host_type,
                (SELECT image_url FROM board_images WHERE board_id = b.id ORDER BY id ASC LIMIT 1) as thumbnail
            FROM boards b
            JOIN users u ON b.user_id = u.id
        `;
        const [rows] = await connection.execute(query);

        if (rows.length === 0) {
            console.log('ℹ️ 동기화할 데이터가 없습니다.');
            return;
        }

        const operations = rows.flatMap(doc => {
            const topicArray = doc.topics 
                ? doc.topics.split(',').map(t => t.trim()).filter(Boolean) 
                : [];

            const suggestSet = new Set();
            if (doc.title) {
                const cleanTitle = doc.title.replace(/[^\w\sㄱ-ㅎ가-힣]/g, ' ');
                const words = cleanTitle.split(/\s+/).filter(w => w.length >= 2);
                words.forEach(word => suggestSet.add(word));
                for (let i = 0; i < words.length - 1; i++) {
                    suggestSet.add(`${words[i]} ${words[i + 1]}`);
                }
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
                    suggest: {
                        input: Array.from(suggestSet).filter(Boolean),
                        weight: 10
                    },
                    // [수정] 모든 날짜 필드를 ISO 표준으로 변경
                    start_date: toEsDate(doc.start_date),
                    end_date: toEsDate(doc.end_date),
                    is_start_time_set: !!doc.is_start_time_set,
                    is_end_time_set: !!doc.is_end_time_set,
                    created_at: toEsDate(doc.created_at),
                    updated_at: toEsDate(doc.updated_at)
                }
            ];
        });

        console.log(`🚀 ${rows.length}개의 데이터를 전송 중...`);
        const response = await esClient.bulk({ refresh: true, operations });
        
        if (response.errors) {
            console.error('❌ 동기화 중 에러 발생');
            // 상세 에러 확인용
            response.items.forEach(item => {
                if (item.index && item.index.error) console.error(item.index.error);
            });
        } else {
            console.log(`✅ ${rows.length}개 데이터 동기화 완료!`);
        }
    } catch (err) {
        console.error('❌ 실패:', err.message);
    } finally {
        if (connection) await connection.end();
    }
}
sync();