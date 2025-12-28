const mysql = require('mysql2/promise');
const { Client } = require('@elastic/elasticsearch');
require('dotenv').config({ path: '../.env' });

const esClient = new Client({ node: 'http://elasticsearch:9200' });

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

    const operations = rows.flatMap(doc => [
      { index: { _index: 'boards', _id: doc.id } },
      {
        ...doc,
        // 1. 불리언 타입 변환 (안전하게 !! 사용)
        is_verified: !!doc.is_verified,
        ai_verified: !!doc.ai_verified,
        
        // 2. 모든 날짜 필드를 "yyyy-MM-dd HH:mm:ss" 형식으로 강제 변환
        start_date: doc.start_date ? new Date(doc.start_date).toISOString().replace('T', ' ').substring(0, 19) : null,
        end_date: doc.end_date ? new Date(doc.end_date).toISOString().replace('T', ' ').substring(0, 19) : null,
        
        // [추가된 부분] created_at과 updated_at도 형식을 맞춰야 에러가 안 납니다.
        created_at: doc.created_at ? new Date(doc.created_at).toISOString().replace('T', ' ').substring(0, 19) : null,
        updated_at: doc.updated_at ? new Date(doc.updated_at).toISOString().replace('T', ' ').substring(0, 19) : null
      }
    ]);

    const response = await esClient.bulk({ 
      refresh: true, 
      operations: operations 
    });
    
    if (response.errors) {
      // 에러가 발생한 구체적인 이유를 확인하기 위해 필터링 로그 출력
      const errorItems = response.items.filter(i => i.index && i.index.error);
      console.error('동기화 중 에러 발생 상세:', JSON.stringify(errorItems, null, 2));
    } else {
      console.log(`${rows.length}개 데이터 동기화 완료!`);
    }

  } catch (err) {
    console.error('동기화 실패:', err.message);
  } finally {
    if (connection) await connection.end();
  }
}

sync();