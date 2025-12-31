const pool = require('../../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { success, fail } = require('../util/response.util.js');
const crypto = require('crypto');
const emailService = require('../util/email.service.js');

// --- 유틸리티 함수 ---
const validatePassword = (password) => {
  const minLength = 8;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  return password.length >= minLength && hasLetter && hasNumber;
};

const generateVerificationCode = () => {
  return crypto.randomInt(100000, 1000000).toString();
};

// --- 공통 API ---

/**
 * 1. 아이디 중복 확인 (공통)
 */
exports.checkUseridExists = async (req, res) => {
  let connection;
  try {
    const { userid } = req.query;
    if (!userid) {
      return fail(res, '아이디를 입력해주세요.', 400);
    }
    connection = await pool.getConnection();
    const sql = 'SELECT 1 FROM users WHERE userid = ?';
    const [users] = await connection.query(sql, [userid]);
    if (users.length > 0) {
      return fail(res, '이미 사용중인 아이디입니다.', 409);
    }
    return success(res, '사용 가능한 아이디입니다.');
  } catch (error) {
    console.error('Server Error:', error);
    return fail(res, '서버 에러가 발생했습니다.', 500);
  } finally {
    if (connection) connection.release();
  }
};

/**
 * 2. 이메일 중복 확인 (공통)
 */
exports.checkEmailExists = async (req, res) => {
  let connection;
  try {
    const { email } = req.query;
    if (!email) {
      return fail(res, '이메일을 입력해주세요.', 400);
    }
    connection = await pool.getConnection();
    const sql = 'SELECT 1 FROM users WHERE email = ?';
    const [users] = await connection.query(sql, [email]);
    if (users.length > 0) {
      return fail(res, '이미 사용중인 이메일입니다.', 409);
    }
    return success(res, '사용 가능한 이메일입니다.');
  } catch (error) {
    console.error('Server Error:', error);
    return fail(res, '서버 에러가 발생했습니다.', 500);
  } finally {
    if (connection) connection.release();
  }
};

/**
 * 2-1. 단체명 중복 확인 (단체 회원가입용)
 */
exports.checkOrgNameExists = async (req, res) => {
  let connection;
  try {
    const { org_name } = req.query;
    if (!org_name) {
      return fail(res, '단체명을 입력해주세요.', 400);
    }
    connection = await pool.getConnection();
    
    const sql = 'SELECT 1 FROM organization_profiles WHERE org_name = ?';
    const [rows] = await connection.query(sql, [org_name]);
    
    if (rows.length > 0) {
      return fail(res, '이미 등록된 단체명입니다.', 409);
    }
    return success(res, '사용 가능한 단체명입니다.');
  } catch (error) {
    console.error('Server Error:', error);
    return fail(res, '서버 에러가 발생했습니다.', 500);
  } finally {
    if (connection) connection.release();
  }
};

/**
 * 3. 이메일 인증번호 발송 (공통)
 */
exports.sendEmailVerification = async (req, res) => {
  let connection;
  try {
    const { email } = req.body;
    if (!email) {
      return fail(res, '이메일을 입력해주세요.', 400);
    }
    connection = await pool.getConnection();
    const userSql = 'SELECT 1 FROM users WHERE email = ?';
    const [users] = await connection.query(userSql, [email]);
    if (users.length > 0) {
      return fail(res, '이미 가입된 이메일입니다.', 409);
    }
    const code = generateVerificationCode();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000); // 10분 후 만료
    const upsertSql = `
      INSERT INTO email_verifications (email, code, expires_at, verified) 
      VALUES (?, ?, ?, false)
      ON DUPLICATE KEY UPDATE code = ?, expires_at = ?, verified = false
    `;
    await connection.query(upsertSql, [email, code, expires_at, code, expires_at]);
    await emailService.sendVerificationEmail(email, code);
    return success(res, '인증번호가 발송되었습니다. 10분 이내에 입력해주세요.');
  } catch (error) {
    console.error('Server Error:', error);
    if (error.message.includes('인증 이메일 발송에 실패')) {
      return fail(res, '이메일 발송 중 오류가 발생했습니다. 관리자에게 문의하세요.', 500);
    }
    return fail(res, '서버 에러가 발생했습니다.', 500);
  } finally {
    if (connection) connection.release();
  }
};

/**
 * 4. 이메일 인증번호 확인 (공통)
 */
exports.verifyEmailCode = async (req, res) => {
  let connection;
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return fail(res, '이메일과 인증번호를 모두 입력해주세요.', 400);
    }
    connection = await pool.getConnection();
    const sql = 'SELECT * FROM email_verifications WHERE email = ?';
    const [rows] = await connection.query(sql, [email]);
    if (rows.length === 0) return fail(res, '인증번호 요청 내역이 없습니다.', 404);
    const verification = rows[0];
    if (verification.code !== code) return fail(res, '인증번호가 올바르지 않습니다.', 400);
    if (new Date() > new Date(verification.expires_at)) {
      return fail(res, '인증번호가 만료되었습니다. 재전송해주세요.', 410);
    }
    if (verification.verified) return success(res, '이미 인증된 이메일입니다.');
    const updateSql = 'UPDATE email_verifications SET verified = true WHERE email = ?';
    await connection.query(updateSql, [email]);
    return success(res, '이메일 인증에 성공했습니다.');
  } catch (error) {
    console.error('Server Error:', error);
    return fail(res, '서버 에러가 발생했습니다.', 500);
  } finally {
    if (connection) connection.release();
  }
};


// --- 개인 회원가입 (Individual) ---

/**
 * 5. 개인 회원가입
 */
exports.registerIndividual = async (req, res) => {
  const { email, userid, password, password_confirm, nickname, email_consent = false } = req.body;
  
  // 1. 유효성 검사
  if (!email || !userid || !password || !password_confirm || !nickname) {
    return fail(res, '모든 필수 필드를 입력해주세요.', 400);
  }
  if (password !== password_confirm) {
    return fail(res, '비밀번호가 일치하지 않습니다.', 400);
  }
  if (!validatePassword(password)) {
    return fail(res, '비밀번호는 영문, 숫자를 포함하여 최소 8자 이상이어야 합니다.', 400);
  }

  let connection;
  try {
    connection = await pool.getConnection();
    
    // [사전 확인 1] 이메일 인증 여부
    const emailVerifySql = 'SELECT verified FROM email_verifications WHERE email = ? AND verified = true';
    const [verifyRows] = await connection.query(emailVerifySql, [email]);
    if (verifyRows.length === 0) {
      return fail(res, '이메일 인증이 완료되지 않았습니다.', 403);
    }

    // [사전 확인 2] 아이디 중복
    const userCheckSql = 'SELECT 1 FROM users WHERE userid = ?';
    const [userRows] = await connection.query(userCheckSql, [userid]);
    if (userRows.length > 0) {
      return fail(res, '이미 사용중인 아이디입니다.', 409);
    }

    // [사전 확인 3] 이메일 중복
    const emailCheckSql = 'SELECT 1 FROM users WHERE email = ?';
    const [emailRows] = await connection.query(emailCheckSql, [email]);
    if (emailRows.length > 0) {
        return fail(res, '이미 가입된 이메일입니다.', 409);
    }

    // --- 트랜잭션 시작 ---
    await connection.beginTransaction();

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    const userSql = 'INSERT INTO users (user_type, userid, password, email) VALUES (?, ?, ?, ?)';
    const [userInsertResult] = await connection.query(userSql, ['INDIVIDUAL', userid, hashedPassword, email]);
    const newUserId = userInsertResult.insertId;

    const profileSql = 'INSERT INTO individual_profiles (user_id, nickname, email_consent) VALUES (?, ?, ?)';
    await connection.query(profileSql, [newUserId, nickname, email_consent]);

    await connection.commit();

    return success(res, '개인 회원가입 성공', { email, userid, nickname }, 201);
  } catch (error) {
    if (connection) await connection.rollback();
    
    if (error.code === 'ER_DUP_ENTRY') {
      return fail(res, '이미 사용 중인 아이디 또는 이메일입니다.', 409);
    }
    console.error('Server Error:', error);
    return fail(res, '서버 에러가 발생했습니다.', 500);
  } finally {
    if (connection) connection.release();
  }
};


// --- 단체 회원가입 (Organization) ---

/**
 * 6. 단체 회원가입
 * approval_status를 'PENDING'으로 설정
 * 단체명 중복 확인 로직 포함
 */
exports.registerOrganization = async (req, res) => {
  const { 
    org_name, email, sns_link, contact_number, 
    userid, password, password_confirm, address 
  } = req.body;

  // 1. 유효성 검사
  if (!org_name || !email || !userid || !password || !password_confirm || !contact_number || !address) {
    return fail(res, '모든 필수 필드를 입력해주세요.', 400);
  }
  if (password !== password_confirm) {
    return fail(res, '비밀번호가 일치하지 않습니다.', 400);
  }
  if (!validatePassword(password)) {
    return fail(res, '비밀번호는 영문, 숫자를 포함하여 최소 8자 이상이어야 합니다.', 400);
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // [사전 확인 1] 이메일 인증 여부
    const emailVerifySql = 'SELECT verified FROM email_verifications WHERE email = ? AND verified = true';
    const [verifyRows] = await connection.query(emailVerifySql, [email]);
    if (verifyRows.length === 0) {
      return fail(res, '이메일 인증이 완료되지 않았습니다.', 403);
    }
    
    // [사전 확인 2] 아이디 중복
    const userCheckSql = 'SELECT 1 FROM users WHERE userid = ?';
    const [userRows] = await connection.query(userCheckSql, [userid]);
    if (userRows.length > 0) {
      return fail(res, '이미 사용중인 아이디입니다.', 409);
    }

    // [사전 확인 3] 이메일 중복
    const emailCheckSql = 'SELECT 1 FROM users WHERE email = ?';
    const [emailRows] = await connection.query(emailCheckSql, [email]);
    if (emailRows.length > 0) {
        return fail(res, '이미 가입된 이메일입니다.', 409);
    }

    // [사전 확인 4] 단체명 중복 확인 (Safety Net)
    const orgNameCheckSql = 'SELECT 1 FROM organization_profiles WHERE org_name = ?';
    const [orgRows] = await connection.query(orgNameCheckSql, [org_name]);
    if (orgRows.length > 0) {
        return fail(res, '이미 등록된 단체명입니다.', 409);
    }
    // ----------------------------

    // --- 트랜잭션 시작 ---
    await connection.beginTransaction();

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // approval_status = 'PENDING' 설정
    const userSql = `
      INSERT INTO users (user_type, userid, password, email, approval_status) 
      VALUES (?, ?, ?, ?, 'PENDING')
    `;
    
    const [userInsertResult] = await connection.query(userSql, ['ORGANIZATION', userid, hashedPassword, email]);
    const newUserId = userInsertResult.insertId;

    const profileSql = `
      INSERT INTO organization_profiles (user_id, org_name, sns_link, contact_number, address) 
      VALUES (?, ?, ?, ?, ?)
    `;
    await connection.query(profileSql, [newUserId, org_name, sns_link, contact_number, address]);

    await connection.commit();

    return success(res, '단체 회원가입 신청이 완료되었습니다. 관리자 승인 후 로그인이 가능합니다.', { email, userid, org_name }, 201);
  } catch (error) {
    if (connection) await connection.rollback();
    
    if (error.code === 'ER_DUP_ENTRY') {
      return fail(res, '이미 사용 중인 정보(아이디, 이메일, 단체명 등)가 있습니다.', 409);
    }
    console.error('Server Error:', error);
    return fail(res, '서버 에러가 발생했습니다.', 500);
  } finally {
    if (connection) connection.release();
  }
};


// --- 로그인 및 프로필 ---

/**
 * 7. 로그인 (공통)
 */
exports.login = async (req, res) => {
  let connection;
  try {
    const { userid, password } = req.body;
    if (!userid || !password) {
      return fail(res, '모든 필드를 입력해주세요.', 400);
    }

    connection = await pool.getConnection();
    
    // 1. users 테이블에서 기본 정보 조회
    const sql = 'SELECT * FROM users WHERE userid = ?';
    const [users] = await connection.query(sql, [userid]);

    if (users.length === 0) {
      return fail(res, '아이디 또는 비밀번호가 올바르지 않습니다.', 401);
    }

    const user = users[0];
    
    // 2. 비밀번호 검증
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return fail(res, '아이디 또는 비밀번호가 올바르지 않습니다.', 401);
    }

    // 3. 닉네임(또는 단체명) 가져오기
    let nickname = ''; 

    if (user.user_type === 'INDIVIDUAL') {
      const [profiles] = await connection.query(
        'SELECT nickname FROM individual_profiles WHERE user_id = ?', 
        [user.id]
      );
      if (profiles.length > 0) nickname = profiles[0].nickname;

    } else if (user.user_type === 'ORGANIZATION') {
      const [profiles] = await connection.query(
        'SELECT org_name FROM organization_profiles WHERE user_id = ?', 
        [user.id]
      );
      
      // 승인 상태 체크
      if (user.approval_status === 'PENDING') {
        return fail(res, '관리자 승인 대기 중인 계정입니다.', 403);
      }
      if (user.approval_status === 'REJECTED') {
        return fail(res, '가입이 거절된 계정입니다. 관리자에게 문의하세요.', 403);
      }
      
      if (profiles.length > 0) nickname = profiles[0].org_name;
    }

    // --- 최초 로그인 여부 확인 (is_first_login 값 그대로 반환) ---
    const isFirstLogin = (user.is_first_login === 0 || user.is_first_login === false);
    
    // 4. JWT 페이로드 생성
    const payload = {
      id: user.id,
      role: user.role,
      nickname: nickname, 
      email: user.email,
      userid: user.userid,
      user_type: user.user_type,
      is_first_login: isFirstLogin
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });

    console.log('=== 로그인 성공 ===');
    console.log('ID:', user.userid);
    console.log('Type:', user.user_type);
    console.log('Nickname:', nickname); 

    success(res, '로그인 성공', { 
        token, 
        nickname: nickname,
        user_type: user.user_type,
        is_first_login: isFirstLogin 
    });

  } catch (error) {
    console.error('Server Error:', error);
    fail(res, '서버 에러가 발생했습니다.', 500);
  } finally {
    if (connection) connection.release();
  }
};

/**
 * 8. 내 정보 보기 (공통)
 */
exports.getMyProfile = async (req, res) => {
  const { id, user_type } = req.user;
  let connection;

  try {
    connection = await pool.getConnection();
    let profileSql = '';
    
    if (user_type === 'INDIVIDUAL') {
      profileSql = `
        SELECT u.id, u.userid, u.email, u.user_type, u.role, ip.nickname, ip.email_consent 
        FROM users u
        LEFT JOIN individual_profiles ip ON u.id = ip.user_id
        WHERE u.id = ?
      `;
    } else if (user_type === 'ORGANIZATION') {
      profileSql = `
        SELECT u.id, u.userid, u.email, u.user_type, u.role, op.org_name, op.sns_link, op.contact_number, op.address
        FROM users u
        LEFT JOIN organization_profiles op ON u.id = op.user_id
        WHERE u.id = ?
      `;
    } else {
      return fail(res, '알 수 없는 사용자 유형입니다.', 400);
    }

    const [profileRows] = await connection.query(profileSql, [id]);

    if (profileRows.length === 0) {
      return fail(res, '사용자 정보를 찾을 수 없습니다.', 404);
    }

    return success(res, '내 정보 조회 성공', profileRows[0]);
  } catch (error) {
    console.error('Server Error:', error);
    return fail(res, '서버 에러가 발생했습니다.', 500);
  } finally {
    if (connection) connection.release();
  }
};


/**
 * 9. 단체 회원 최초 정보 설정
 * - 설정 후 is_first_login = true 변경
 */
exports.setupOrganization = async (req, res) => {
  const { id } = req.user;
  const { introduction } = req.body;
  let connection;

  try {
    if (!introduction || introduction.length < 50 || introduction.length > 200) {
      return fail(res, '소개글은 50자 이상 200자 이하로 작성해야 합니다.', 400);
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const updateProfileSql = 'UPDATE organization_profiles SET introduction = ? WHERE user_id = ?';
    const [result] = await connection.query(updateProfileSql, [introduction, id]);

    if (result.affectedRows === 0) {
      await connection.rollback();
      return fail(res, '프로필 정보를 찾을 수 없습니다.', 404);
    }

    // 설정 완료 시 is_first_login = true
    const updateUserSql = 'UPDATE users SET is_first_login = true WHERE id = ?';
    await connection.query(updateUserSql, [id]);

    await connection.commit();
    return success(res, '단체 정보 설정이 완료되었습니다.');

  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Server Error:', error);
    return fail(res, '서버 에러가 발생했습니다.', 500);
  } finally {
    if (connection) connection.release();
  }
};

/**
 * 10. 개인 회원 최초 정보 설정
 */
exports.setupIndividual = async (req, res) => {
    const { id } = req.user;
    const { interests, mailing_consent, mailing_days, mailing_time } = req.body;
    let connection;

    // DB 마스터 데이터와 일치하도록 수정 (/, / 포함)
    const ALLOWED_INTERESTS = [
        '여성', '청소년', '노동자', '성소수자', '농민', '장애인', 
        '교육', '범죄/사법', '복지', '의료', '환경', '인권', 
        '추모/기억', '동물권'
    ];
    const ALLOWED_DAYS = ['월', '화', '수', '목', '금', '토', '일'];

    try {
        if (!Array.isArray(interests) || interests.length === 0) {
            return res.status(400).json({ success: false, message: '관심 분야를 최소 1개 이상 선택해야 합니다.' });
        }
        const invalidInterest = interests.find(item => !ALLOWED_INTERESTS.includes(item));
        if (invalidInterest) {
            return res.status(400).json({ success: false, message: `유효하지 않은 관심 분야: ${invalidInterest}` });
        }

        let daysJson = null;
        let dbTime = null;

        if (mailing_consent === true) {
            if (!Array.isArray(mailing_days) || mailing_days.length !== 2) {
                return res.status(400).json({ success: false, message: '메일링 요일 2개를 선택해야 합니다.' });
            }
            const timeRegex = /^(AM|PM)\s(1[0-2]|[1-9])시$/;
            if (!mailing_time || !timeRegex.test(mailing_time)) {
                return res.status(400).json({ success: false, message: '시간 형식이 올바르지 않습니다.' });
            }

            const [amPm, timePart] = mailing_time.split(' ');
            let hour = parseInt(timePart.replace('시', ''));
            if (amPm === 'PM' && hour !== 12) hour += 12;
            else if (amPm === 'AM' && hour === 12) hour = 0;
            dbTime = `${String(hour).padStart(2, '0')}:00:00`;
            daysJson = JSON.stringify(mailing_days);
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. 의제 ID 매핑 정보 로드
        const [topicRows] = await connection.query('SELECT id, name FROM topics');
        const topicMap = {};
        topicRows.forEach(row => topicMap[row.name] = row.id);

        // 2. 프로필 업데이트 (기존 JSON 필드 유지)
        const interestsJson = JSON.stringify(interests);
        await connection.query(`
            UPDATE individual_profiles 
            SET interests = ?, mailing_consent = ?, mailing_days = ?, mailing_time = ? 
            WHERE user_id = ?
        `, [interestsJson, mailing_consent, daysJson, dbTime, id]);

        // 3. [정규화] user_interests 매핑 갱신
        await connection.query('DELETE FROM user_interests WHERE user_id = ?', [id]);
        const interestValues = interests
            .map(name => topicMap[name])
            .filter(tid => tid)
            .map(tid => [id, tid]);

        if (interestValues.length > 0) {
            await connection.query('INSERT INTO user_interests (user_id, topic_id) VALUES ?', [interestValues]);
        }

        // 4. 첫 로그인 상태 변경
        await connection.query('UPDATE users SET is_first_login = true WHERE id = ?', [id]);

        await connection.commit();
        return res.status(200).json({ success: true, message: '개인 맞춤 정보 설정이 완료되었습니다.' });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Setup Error:', error);
        return res.status(500).json({ success: false, message: '서버 에러가 발생했습니다.' });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * 11. 로그아웃
 * JWT 특성상 서버에서 토큰을 삭제할 수는 없습니다.
 * 클라이언트에게 "로그아웃 처리됨" 응답을 보내면, 
 * 클라이언트가 스스로 로컬 스토리지 등의 토큰을 삭제해야 합니다.
 */
exports.logout = async (req, res) => {
  try {
    return success(res, '로그아웃 되었습니다.');
  } catch (error) {
    console.error('Server Error:', error);
    return fail(res, '서버 에러가 발생했습니다.', 500);
  }
};