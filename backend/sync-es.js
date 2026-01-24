const mysql = require('mysql2/promise');
const { Client } = require('@elastic/elasticsearch');
require('dotenv').config({ path: '../.env' });

const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });
const INDEX_NAME = 'boards';

// [핵심 수정] MySQL의 날짜를 무조건 한국 시간(+09:00)으로 해석해서 변환
// 이전 코드(toISOString)는 서버가 UTC면 시간을 9시간 뒤로 밀어버리는 문제가 있었음
const toEsDate = (dateInput) => {
    if (!dateInput) return null;
    try {
        const d = new Date(dateInput);
        
        // 날짜 객체에서 연, 월, 일, 시, 분, 초 추출 (서버 로컬 시간 기준 값)
        const pad = (n) => n.toString().padStart(2, '0');
        const y = d.getFullYear();
        const m = pad(d.getMonth() + 1);
        const day = pad(d.getDate());
        const h = pad(d.getHours());
        const min = pad(d.getMinutes());
        const s = pad(d.getSeconds());

        // 강제로 "+09:00" (KST) 정보를 붙여서 ISO 문자열 생성
        // 예: DB에 "22:00"이 있다면 -> "2026-01-24T22:00:00+09:00" -> UTC 13:00으로 정확히 변환됨
        const kstString = `${y}-${m}-${day}T${h}:${min}:${s}+09:00`;
        return new Date(kstString).toISOString();
    } catch (e) {
        return null;
    }
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
                    // [수정된 함수 적용] 9시간 오차를 바로잡음
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