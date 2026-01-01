const mysql = require('mysql2/promise');
const { Client } = require('@elastic/elasticsearch');
require('dotenv').config({ path: '../.env' });

const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });
const INDEX_NAME = 'boards';

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

    console.log('도커 내부 MySQL 연결 성공. 데이터를 조회합니다...');
    const [rows] = await connection.execute('SELECT * FROM boards');

    if (rows.length === 0) {
      console.log('동기화할 데이터가 없습니다.');
      return;
    }

    const operations = rows.flatMap(doc => {
    const suggestSet = new Set(); // 중복 제거를 위한 Set

    if (doc.title) {
      // 1. 특수문자 제거 및 공백 기준 단어 분리
      const words = doc.title.replace(/[^\w\sㄱ-ㅎ가-힣]/g, '').split(/\s+/).filter(w => w.length >= 2);

      // 2. 개별 단어 추가 (예: "기후위기", "대응")
      words.forEach(word => suggestSet.add(word));

      // 3. [핵심] 두 단어 조합 추가 (예: "기후위기 대응", "대응 촉구")
      for (let i = 0; i < words.length - 1; i++) {
        const combined = `${words[i]} ${words[i+1]}`;
        suggestSet.add(combined);
      }
    }

    // 4. 의제(topics) 추가
    if (doc.topics) {
      doc.topics.split(',').forEach(t => {
        const trimmed = t.trim();
        if (trimmed.length >= 2) suggestSet.add(trimmed);
      });
    }

    return [
      { index: { _index: INDEX_NAME, _id: doc.id } },
      {
        ...doc,
        suggest: {
          input: Array.from(suggestSet), // 가공된 키워드 배열
          weight: 10
        },
        // ... 날짜 및 불리언 변환 로직은 기존과 동일
        is_verified: !!doc.is_verified,
        ai_verified: !!doc.ai_verified,
        start_date: doc.start_date ? new Date(doc.start_date).toISOString().replace('T', ' ').substring(0, 19) : null,
        end_date: doc.end_date ? new Date(doc.end_date).toISOString().replace('T', ' ').substring(0, 19) : null,
        is_start_time_set: !!doc.is_start_time_set, // 플래그 추가
        is_end_time_set: !!doc.is_end_time_set,     // 플래그 추가
        created_at: doc.created_at ? new Date(doc.created_at).toISOString().replace('T', ' ').substring(0, 19) : null,
        updated_at: doc.updated_at ? new Date(doc.updated_at).toISOString().replace('T', ' ').substring(0, 19) : null
      }
    ];
  });

    const response = await esClient.bulk({ 
      refresh: true, 
      operations: operations 
    });
    
    if (response.errors) {
      const errorItems = response.items.filter(i => i.index && i.index.error);
      console.error('동기화 중 에러 발생 상세:', JSON.stringify(errorItems, null, 2));
    } else {
      console.log(`${rows.length}개 데이터 동기화 완료! (추천어 포함)`);
    }

  } catch (err) {
    console.error('동기화 실패:', err.message);
  } finally {
    if (connection) await connection.end();
  }
}

sync();