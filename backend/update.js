const pool = require('./db'); // backend/db.js 파일을 참조함

async function runUpdate() {
  try {
    // 1. 첫 번째 업데이트: 범죄·사법
    const [result1] = await pool.query(
      "UPDATE topics SET name = '범죄·사법' WHERE name = '범죄/사법'"
    );
    console.log('범죄·사법 업데이트 완료:', result1.affectedRows, '행 변경됨');

    // 2. 두 번째 업데이트: 추모·기억
    const [result2] = await pool.query(
      "UPDATE topics SET name = '추모·기억' WHERE name = '추모/기억'"
    );
    console.log('추모·기억 업데이트 완료:', result2.affectedRows, '행 변경됨');

    console.log('전체 데이터베이스 업데이트가 성공적으로 완료되었습니다.');
    process.exit(0); // 모든 작업이 끝난 후 종료
  } catch (err) {
    console.error('업데이트 도중 에러 발생:', err);
    process.exit(1); // 에러 발생 시 비정상 종료 코드 반환
  }
}

runUpdate();