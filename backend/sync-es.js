const mysql = require('mysql2/promise');
const { Client } = require('@elastic/elasticsearch');
require('dotenv').config({ path: '../.env' });

const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });
const INDEX_NAME = 'boards';

// 날짜를 "YYYY-MM-DD HH:mm:ss" 형식으로 안전하게 변환 (시차 방지)
const formatToLocalSql = (date) => {
    if (!date) return null;
    const d = new Date(date);
    const pad = (n) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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

        // rows.flatMap 내부로 로직을 이동해야 합니다.
        const operations = rows.flatMap(doc => {
            // [수정] 각 문서(doc)별로 토픽 배열 생성
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

            // suggestSet에도 배열화된 토픽들 추가
            topicArray.forEach(t => suggestSet.add(t));

            return [
                { index: { _index: INDEX_NAME, _id: doc.id } },
                {
                    id: doc.id,
                    user_id: doc.user_id,
                    host_type: doc.host_type,
                    participation_type: doc.participation_type,
                    title: doc.title,
                    content: doc.content,
                    topics: topicArray, // 가공된 배열 투입
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
                    start_date: formatToLocalSql(doc.start_date),
                    end_date: formatToLocalSql(doc.end_date),
                    is_start_time_set: !!doc.is_start_time_set,
                    is_end_time_set: !!doc.is_end_time_set,
                    created_at: formatToLocalSql(doc.created_at),
                    updated_at: formatToLocalSql(doc.updated_at)
                }
            ];
        });

        console.log(`🚀 ${rows.length}개의 데이터를 전송 중...`);
        const response = await esClient.bulk({ refresh: true, operations });
        
        if (response.errors) {
            console.error('❌ 동기화 중 에러 발생');
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