const { faker } = require('@faker-js/faker');
const pool = require('./db');

// --- 설정값 ---
const CONFIG = {
  USER_COUNT: 20,       // 생성할 유저 수
  BOARD_COUNT: 50,      // 생성할 게시글 수
  MAX_CHEERS: 20,       // 게시글 당 최대 응원 수
  // 주제(Topic) 목록
  TOPIC_NAMES: [
    '여성', '청소년', '노동자', '성소수자', '농민', '장애인', '교육', 
    '환경', '의료', '인권', '동물권', '복지', '추모/기억', '범죄/사법'
  ],
  // 테이블 이름 설정 (혹시 다르면 여기서 변경)
  TABLE_TOPICS: 'topics', // 주제 마스터 테이블 이름 (DESC에는 없었으나 board_topics가 참조하는 테이블)
};

async function seed() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    console.log('🚀 더미 데이터 생성을 시작합니다...');

    // ---------------------------------------------------------
    // 1. 주제(Topics) 데이터 확보
    // ---------------------------------------------------------
    console.log('🏷️  주제(Topics) 데이터 준비 중...');
    const topicIds = []; // { id: 1, name: '환경' } 형태 저장

    for (const name of CONFIG.TOPIC_NAMES) {
      // 1) 주제 입력 (없으면 생성) - 테이블명이 topics 라고 가정
      // 만약 에러가 난다면 테이블 이름을 확인해주세요.
      await connection.query(`INSERT IGNORE INTO ${CONFIG.TABLE_TOPICS} (name) VALUES (?)`, [name]);
      
      // 2) ID 가져오기
      const [rows] = await connection.query(`SELECT id, name FROM ${CONFIG.TABLE_TOPICS} WHERE name = ?`, [name]);
      if (rows.length > 0) {
        topicIds.push(rows[0]);
      }
    }

    // ---------------------------------------------------------
    // 2. 유저 및 프로필 생성 (INDIVIDUAL / ORGANIZATION)
    // ---------------------------------------------------------
    console.log(`👤 유저 ${CONFIG.USER_COUNT}명 생성 중 (개인/단체 분기)...`);
    const userIds = [];
    
    for (let i = 0; i < CONFIG.USER_COUNT; i++) {
      // 20% 확률로 단체, 80% 확률로 개인
      const isOrg = Math.random() < 0.2;
      const userType = isOrg ? 'ORGANIZATION' : 'INDIVIDUAL';
      
      const userid = faker.internet.username() + Math.floor(Math.random() * 1000); // Unique ID
      const email = faker.internet.email();
      const password = '$2b$10$abcdefghijklmnopqrstuv'; // 더미 패스워드
      
      // 2-1. users 테이블 INSERT
      const [userRes] = await connection.query(
        `INSERT INTO users (user_type, userid, password, email, role, approval_status, created_at) 
         VALUES (?, ?, ?, ?, 'USER', 'APPROVED', NOW())`,
        [userType, userid, password, email]
      );
      const newUserId = userRes.insertId;
      userIds.push(newUserId);

      // 2-2. 프로필 테이블 INSERT (타입에 따라 분기)
      if (userType === 'INDIVIDUAL') {
        const nickname = faker.person.fullName();
        await connection.query(
          `INSERT INTO individual_profiles (user_id, nickname, mailing_consent) VALUES (?, ?, ?)`,
          [newUserId, nickname, 1]
        );
      } else {
        // ORGANIZATION
        const orgName = faker.company.name();
        const contact = faker.phone.number();
        const address = faker.location.streetAddress(true);
        await connection.query(
          `INSERT INTO organization_profiles (user_id, org_name, contact_number, address, introduction) 
           VALUES (?, ?, ?, ?, ?)`,
          [newUserId, orgName, contact, address, faker.lorem.sentence()]
        );
      }
    }

    // ---------------------------------------------------------
    // 3. 게시글 생성 (Boards)
    // ---------------------------------------------------------
    console.log(`📝 게시글 ${CONFIG.BOARD_COUNT}개 생성 중...`);
    const boardIds = [];

    for (let i = 0; i < CONFIG.BOARD_COUNT; i++) {
      const randomOwnerId = userIds[Math.floor(Math.random() * userIds.length)];
      
      const title = faker.lorem.sentence();
      const content = faker.lorem.paragraphs(2);
      const participationType = Math.random() > 0.5 ? 'ONLINE' : 'OFFLINE'; // 임의 값
      
      // 랜덤 주제 1~2개 선택
      const shuffledTopics = topicIds.sort(() => 0.5 - Math.random());
      const selectedTopics = shuffledTopics.slice(0, Math.floor(Math.random() * 2) + 1);
      
      // boards 테이블의 topics 컬럼(varchar)용 문자열 생성 (예: "환경,인권")
      const topicString = selectedTopics.map(t => t.name).join(',');

      // 날짜 로직 (20% 오늘 마감, 80% 미래)
      const isTodayEnding = Math.random() < 0.2;
      let endDate = new Date();
      if (isTodayEnding) {
        endDate.setHours(23, 59, 59, 999); 
      } else {
        const daysLater = Math.floor(Math.random() * 10) + 1;
        endDate.setDate(endDate.getDate() + daysLater);
      }

      // 3-1. boards 테이블 INSERT
      const [boardRes] = await connection.query(
        `INSERT INTO boards 
        (user_id, participation_type, title, topics, content, end_date, created_at, is_start_time_set, is_end_time_set) 
        VALUES (?, ?, ?, ?, ?, ?, NOW(), 0, 1)`,
        [randomOwnerId, participationType, title, topicString, content, endDate]
      );
      const newBoardId = boardRes.insertId;
      boardIds.push(newBoardId);

      // 3-2. board_topics 테이블 INSERT (N:M 관계)
      for (const topic of selectedTopics) {
        await connection.query(
          `INSERT IGNORE INTO board_topics (board_id, topic_id) VALUES (?, ?)`,
          [newBoardId, topic.id]
        );
      }
    }

    // ---------------------------------------------------------
    // 4. 응원(Cheers) 생성
    // ---------------------------------------------------------
    console.log('🔥 응원(Cheers) 데이터 생성 중...');
    
    for (const boardId of boardIds) {
      const cheerCount = Math.floor(Math.random() * CONFIG.MAX_CHEERS);
      
      // 중복 방지를 위해 유저 목록 섞기
      const potentialCheerers = [...userIds].sort(() => 0.5 - Math.random());
      const actualCheerers = potentialCheerers.slice(0, cheerCount);

      for (const cheererId of actualCheerers) {
        // 날짜 랜덤 (최근 / 과거)
        const isRecent = Math.random() > 0.4; 
        const createdAt = isRecent 
          ? faker.date.recent({ days: 1 }) 
          : faker.date.past();

        await connection.query(
          `INSERT IGNORE INTO cheers (user_id, board_id, created_at) VALUES (?, ?, ?)`,
          [cheererId, boardId, createdAt]
        );
      }
    }

    await connection.commit();
    console.log('✅ 모든 더미 데이터 생성 완료!');

  } catch (err) {
    await connection.rollback();
    console.error('❌ 에러 발생 (롤백됨):', err);
  } finally {
    connection.release();
    process.exit();
  }
}

seed();