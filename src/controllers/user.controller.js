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
 * (수정됨: 이메일 중복 사전 확인 로직 추가)
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
    
    // [사전 확인 1] 이메일 인증 여부 확인
    const emailVerifySql = 'SELECT verified FROM email_verifications WHERE email = ? AND verified = true';
    const [verifyRows] = await connection.query(emailVerifySql, [email]);
    if (verifyRows.length === 0) {
      return fail(res, '이메일 인증이 완료되지 않았습니다.', 403);
    }

    // [사전 확인 2] 아이디 중복 확인 (users 테이블)
    const userCheckSql = 'SELECT 1 FROM users WHERE userid = ?';
    const [userRows] = await connection.query(userCheckSql, [userid]);
    if (userRows.length > 0) {
      return fail(res, '이미 사용중인 아이디입니다.', 409);
    }

    // --- [사전 확인 3: 추가됨] ---
    // 이메일 중복 확인 (users 테이블)
    const emailCheckSql = 'SELECT 1 FROM users WHERE email = ?';
    const [emailRows] = await connection.query(emailCheckSql, [email]);
    if (emailRows.length > 0) {
        return fail(res, '이미 가입된 이메일입니다.', 409);
    }
    // ----------------------------

    // --- 트랜잭션 시작 ---
    await connection.beginTransaction();

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // 'has_logged_in' 필드는 DB에서 DEFAULT FALSE로 자동 설정됨
    const userSql = 'INSERT INTO users (user_type, userid, password, email) VALUES (?, ?, ?, ?)';
    const [userInsertResult] = await connection.query(userSql, ['INDIVIDUAL', userid, hashedPassword, email]);
    const newUserId = userInsertResult.insertId;

    const profileSql = 'INSERT INTO individual_profiles (user_id, nickname, email_consent) VALUES (?, ?, ?)';
    await connection.query(profileSql, [newUserId, nickname, email_consent]);

    await connection.commit();

    return success(res, '개인 회원가입 성공', { email, userid, nickname }, 201);
  } catch (error) {
    if (connection) await connection.rollback();
    
    // [수정] 사전 확인을 했음에도 동시성 문제로 중복이 발생한 경우
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
 * (수정됨: 이메일 중복 사전 확인 로직 추가)
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

    // [사전 확인 1] 이메일 인증 여부 확인
    const emailVerifySql = 'SELECT verified FROM email_verifications WHERE email = ? AND verified = true';
    const [verifyRows] = await connection.query(emailVerifySql, [email]);
    if (verifyRows.length === 0) {
      return fail(res, '이메일 인증이 완료되지 않았습니다.', 403);
    }
    
    // [사전 확인 2] 아이디 중복 확인 (users 테이블)
    const userCheckSql = 'SELECT 1 FROM users WHERE userid = ?';
    const [userRows] = await connection.query(userCheckSql, [userid]);
    if (userRows.length > 0) {
      return fail(res, '이미 사용중인 아이디입니다.', 409);
    }

    // --- [사전 확인 3: 추가됨] ---
    // 이메일 중복 확인 (users 테이블)
    const emailCheckSql = 'SELECT 1 FROM users WHERE email = ?';
    const [emailRows] = await connection.query(emailCheckSql, [email]);
    if (emailRows.length > 0) {
        return fail(res, '이미 가입된 이메일입니다.', 409);
    }
    // ----------------------------

    // --- 트랜잭션 시작 ---
    await connection.beginTransaction();

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // 'has_logged_in' 필드는 DB에서 DEFAULT FALSE로 자동 설정됨
    const userSql = 'INSERT INTO users (user_type, userid, password, email) VALUES (?, ?, ?, ?)';
    const [userInsertResult] = await connection.query(userSql, ['ORGANIZATION', userid, hashedPassword, email]);
    const newUserId = userInsertResult.insertId;

    const profileSql = `
      INSERT INTO organization_profiles (user_id, org_name, sns_link, contact_number, address) 
      VALUES (?, ?, ?, ?, ?)
    `;
    await connection.query(profileSql, [newUserId, org_name, sns_link, contact_number, address]);

    await connection.commit();

    return success(res, '단체 회원가입 성공', { email, userid, org_name }, 201);
  } catch (error) {
    if (connection) await connection.rollback();
    
    // [수정] 사전 확인을 했음에도 동시성 문제로 중복이 발생한 경우
    if (error.code === 'ER_DUP_ENTRY') {
      return fail(res, '이미 사용 중인 아이디 또는 이메일입니다.', 409);
    }
    console.error('Server Error:', error);
    return fail(res, '서버 에러가 발생했습니다.', 500);
  } finally {
    if (connection) connection.release();
  }
};


// --- 로그인 및 프로필 (수정) ---

/**
 * 7. 로그인 (공통)
 * (has_logged_in 로직 포함)
 */
exports.login = async (req, res) => {
  let connection;
  try {
    const { userid, password } = req.body;
    if (!userid || !password) {
      return fail(res, '모든 필드를 입력해주세요.', 400);
    }

    connection = await pool.getConnection();
    
    // 1. 공통 users 테이블에서 사용자 조회 (has_logged_in 컬럼 포함)
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

    // --- 최초 로그인 처리 (사용자님 로직: false=최초, true=최초아님) ---
    // user.has_logged_in이 false이면 (DB 기본값) => 최초 로그인임.
    const isFirstLogin = (user.has_logged_in === 0 || user.has_logged_in === false);

    // 만약 최초 로그인(isFirstLogin = true)이라면, DB 값을 true로 업데이트
    if (isFirstLogin) {
      const updateSql = 'UPDATE users SET has_logged_in = true WHERE id = ?';
      // (비동기 처리, 로그인 응답을 기다리게 하지 않음)
      connection.query(updateSql, [user.id]).catch(err => {
          console.error("최초 로그인 상태 업데이트 실패:", err);
      });
    }
    // ----------------------------
    
    // 3. JWT 페이로드 생성
    const payload = {
      id: user.id,
      email: user.email,
      userid: user.userid,
      user_type: user.user_type,
      is_first_login: isFirstLogin, // 최초 로그인 여부 포함 (true/false)
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '1h', // 1시간 유효
    });

    success(res, '로그인 성공', { token });
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
  // req.user는 인증 미들웨어에서 주입된 JWT 페이로드
  const { id, user_type } = req.user;
  let connection;

  try {
    connection = await pool.getConnection();
    let profileSql = '';
    
    if (user_type === 'INDIVIDUAL') {
      profileSql = `
        SELECT u.id, u.userid, u.email, u.user_type, ip.nickname, ip.email_consent 
        FROM users u
        LEFT JOIN individual_profiles ip ON u.id = ip.user_id
        WHERE u.id = ?
      `;
    } else if (user_type === 'ORGANIZATION') {
      profileSql = `
        SELECT u.id, u.userid, u.email, u.user_type, op.org_name, op.sns_link, op.contact_number, op.address
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