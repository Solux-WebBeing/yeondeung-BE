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
  const { email, userid, password, password_confirm, nickname, mailing_consent = false } = req.body;
  
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

    const profileSql = 'INSERT INTO individual_profiles (user_id, nickname, mailing_consent) VALUES (?, ?, ?)';
    await connection.query(profileSql, [newUserId, nickname, mailing_consent]);

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
        SELECT u.id, u.userid, u.email, u.user_type, u.role, ip.nickname, ip.mailing_consent 
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
 * 단체 정보 수정 요청
 */
exports.requestOrgUpdate = async (req, res) => {
  const { id } = req.user;
  const { introduction, email, sns_link, contact_number } = req.body;
  let connection;

  try {
    connection = await pool.getConnection();

    // 1. DB에서 현재 저장된 최신 단체 정보 조회 (비교용)
    const [currentRows] = await connection.query(
      `SELECT op.introduction, u.email, op.sns_link, op.contact_number 
       FROM organization_profiles op 
       JOIN users u ON op.user_id = u.id 
       WHERE u.id = ?`, [id]
    );

    if (currentRows.length === 0) {
      return fail(res, '사용자 정보를 찾을 수 없습니다.', 404);
    }

    const current = currentRows[0];

    // 2. 변경 사항 없음 체크 로직
    const isChanged = (newVal, oldVal) => {
      const normalizedNew = newVal ? String(newVal).trim() : "";
      const normalizedOld = oldVal ? String(oldVal).trim() : "";
      return normalizedNew !== normalizedOld;
    };

    const hasChanges = 
      isChanged(introduction, current.introduction) ||
      isChanged(email, current.email) ||
      isChanged(sns_link, current.sns_link) ||
      isChanged(contact_number, current.contact_number);

    if (!hasChanges) {
      return fail(res, '변경된 내용이 없습니다.', 400);
    }

    // 3. 데이터 유효성 검증

    // [단체 소개] 50자 이상 200자 이하
    const introLen = introduction ? introduction.trim().length : 0;
    if (introLen < 50 || introLen > 200) {
      return fail(res, '최소 50자 이상, 최대 200자 이하로 입력해주세요', 400);
    }

    // [공식 이메일] 형식 검증
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (email && !emailRegex.test(email)) {
      return fail(res, '유효한 이메일 형식이 아닙니다.', 400);
    }

    // [SNS/웹사이트] https:// 시작 및 URL 형식 (1개만 허용은 문자열 입력으로 처리)
    const urlRegex = /^https:\/\/[^\s/$.?#].[^\s]*$/;
    if (sns_link && !urlRegex.test(sns_link)) {
      return fail(res, '유효한 URL 형식이 아닙니다. (https://... 시작)', 400);
    }

    // [연락처] 국내 전화번호 형식 (010-1234-5678 또는 02-123-4567 등)
    const phoneRegex = /^(01[016789]{1}|02|0[3-9]{1}[0-9]{1})-?[0-9]{3,4}-?[0-9]{4}$/;
    if (contact_number && !phoneRegex.test(contact_number)) {
      return fail(res, '유효한 국내 전화번호 형식이 아닙니다.', 400);
    }

    // 4. 검토 중 상태 확인 (중복 요청 방지)
    const [pending] = await connection.query(
      'SELECT id FROM organization_edit_requests WHERE user_id = ? AND status = "PENDING"', [id]
    );
    if (pending.length > 0) {
      return fail(res, '이미 검토 중인 수정 요청이 있습니다.', 400);
    }

    // 5. 수정 요청 등록
    await connection.query(
      `INSERT INTO organization_edit_requests (user_id, new_introduction, new_email, new_sns_link, new_contact_number)
       VALUES (?, ?, ?, ?, ?)`, [id, introduction, email, sns_link, contact_number]
    );

    return success(res, '수정 요청이 접수되었습니다. 검토 후 반영됩니다.');
  } catch (error) {
    console.error('Request Org Update Error:', error);
    return fail(res, '서버 에러가 발생했습니다.', 500);
  } finally {
    if (connection) connection.release();
  }
};

/**
 * '내 활동' - 단체 활동 게시글 조회
 */
exports.getOrgActivities = async (req, res) => {
  const { id } = req.user;
  const page = parseInt(req.query.page) || 1;
  const limit = 4; // 한 페이지 당 최대 4개
  const offset = (page - 1) * limit;

  try {
    const [rows] = await pool.query(
      'SELECT id, title, created_at FROM boards WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [id, limit, offset]
    );
    
    if (rows.length === 0 && page === 1) {
      return success(res, '아직 등록한 연대 활동이 없어요.', { posts: [] });
    }

    return success(res, '활동 조회 성공', { posts: rows });
  } catch (error) {
    return fail(res, '서버 에러가 발생했습니다.', 500);
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
 * '내 정보' - 프로필 수정 (닉네임, 관심분야)
 */
exports.updateIndivProfile = async (req, res) => {
  const { id } = req.user;
  const { nickname, interests } = req.body;
  let connection;

  try {
    if (!nickname) return fail(res, '닉네임을 입력해주세요.', 400);
    if (!interests || interests.length === 0) return fail(res, '관심 분야를 최소 1개 이상 선택해 주세요.', 400);

    // 중복 제거 및 유효성 검사
    const uniqueInterests = [...new Set(interests)];

    connection = await pool.getConnection();
    
    // id 대신 user_id를 조회하거나 존재 여부만 확인
    const [existing] = await connection.query(
      'SELECT user_id FROM individual_profiles WHERE nickname = ? AND user_id != ?', 
      [nickname, id]
    );
    if (existing.length > 0) return fail(res, '이미 사용중인 닉네임입니다.', 409);

    await connection.beginTransaction();

    // 1. 프로필 테이블 업데이트 (닉네임 + interests JSON 컬럼 동시 업데이트)
    const interestsJson = JSON.stringify(uniqueInterests);
    await connection.query(
      'UPDATE individual_profiles SET nickname = ?, interests = ? WHERE user_id = ?', 
      [nickname, interestsJson, id]
    );
    
    // 2. [정규화 테이블] user_interests 매핑 갱신
    await connection.query('DELETE FROM user_interests WHERE user_id = ?', [id]);
    
    const topicSql = 'INSERT INTO user_interests (user_id, topic_id) SELECT ?, id FROM topics WHERE name IN (?)';
    await connection.query(topicSql, [id, uniqueInterests]);

    await connection.commit();
    return success(res, '정보가 수정되었습니다.');
  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Update Profile Error:', error);
    return fail(res, '서버 에러가 발생했습니다.', 500);
  } finally {
    if (connection) connection.release();
  }
};

/**
 * '내 정보' - 메일링 수신 설정
 */
exports.updateMailing = async (req, res) => {
  const { id } = req.user;
  const { mailing_consent, mailing_days, mailing_time } = req.body;

  try {
    let sql, params;
    if (mailing_consent) {
      // 시간 형식 변환 로직 (AM/PM -> HH:mm:ss)
      const timeRegex = /^(AM|PM)\s(1[0-2]|[1-9])시$/;
      if (!mailing_time || !timeRegex.test(mailing_time)) {
          return fail(res, '시간 형식이 올바르지 않습니다.', 400);
      }

      const [amPm, timePart] = mailing_time.split(' ');
      let hour = parseInt(timePart.replace('시', ''));
      if (amPm === 'PM' && hour !== 12) hour += 12;
      else if (amPm === 'AM' && hour === 12) hour = 0;
      const dbTime = `${String(hour).padStart(2, '0')}:00:00`;

      // 수신 켜기 및 수정
      sql = 'UPDATE individual_profiles SET mailing_consent = true, mailing_days = ?, mailing_time = ? WHERE user_id = ?';
      params = [JSON.stringify(mailing_days), dbTime, id];
    } else {
      // 수신 끄기 (초기화)
      sql = 'UPDATE individual_profiles SET mailing_consent = false, mailing_days = NULL, mailing_time = NULL WHERE user_id = ?';
      params = [id];
    }

    await pool.query(sql, params);
    return success(res, mailing_consent ? '메일링 설정이 저장되었습니다.' : '메일링 수신이 해제되었습니다.');
  } catch (error) {
    console.error('Update Mailing Error:', error);
    return fail(res, '서버 에러가 발생했습니다.', 500);
  }
};

// 개인 활동 조회
exports.getIndividualActivities = async (req, res) => {
  const { id } = req.user;
  try {
    const [posts] = await pool.query(
      'SELECT id, title, created_at FROM boards WHERE user_id = ? ORDER BY created_at DESC LIMIT 4', [id]
    );
    const [cheers] = await pool.query(
      'SELECT COUNT(*) as count FROM cheers WHERE user_id = ?', [id]
    );
    return success(res, '활동 조회 성공', { written_posts: posts, cheer_count: cheers[0].count });
  } catch (error) {
    return fail(res, '서버 에러', 500);
  }
};

/**
 * '내 정보' - 응원한 활동 달력 데이터 조회
 * Query Params: year, month
 */
exports.getCheeredActivitiesForCalendar = async (req, res) => {
  const { id } = req.user;
  const { year, month } = req.query;

  if (!year || !month) {
    return fail(res, '년도(year)와 월(month) 정보를 입력해주세요.', 400);
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // 1. 조회할 달의 시작일 설정 (YYYY-MM-01)
    const targetMonth = `${year}-${String(month).padStart(2, '0')}-01`;

    /**
     * 2. SQL 쿼리 실행
     * - LAST_DAY(?): 입력된 날짜가 속한 달의 마지막 날을 자동으로 계산
     * - CASE 문: '서명·청원·탄원' 유형인 경우에만 디데이를 계산하고 나머지는 NULL 반환
     */
    const sql = `
      SELECT 
        b.id, 
        b.participation_type, 
        b.title, 
        b.topics, 
        b.start_date, 
        b.end_date, 
        b.is_start_time_set, 
        b.is_end_time_set,
        b.region, 
        b.district, 
        b.link,
        CASE 
          WHEN b.participation_type IN ('서명', '청원', '탄원') THEN DATEDIFF(b.end_date, CURDATE())
          ELSE NULL 
        END as d_day
      FROM cheers c
      JOIN boards b ON c.board_id = b.id
      WHERE c.user_id = ? 
        AND b.start_date <= LAST_DAY(?)
        AND b.end_date >= ?
      ORDER BY b.start_date ASC
    `;

    const [activities] = await connection.query(sql, [id, targetMonth, targetMonth]);

    if (activities.length === 0) {
      return success(res, { activities: [] }, '이 날짜에는 응원한 활동이 없습니다.');
    }

    return success(res, { activities }, '응원 활동 달력 조회 성공');
  } catch (error) {
    console.error('Calendar Fetch Error:', error);
    return fail(res, '서버 에러가 발생했습니다.', 500);
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

/**
 * 12. 회원 탈퇴
 */
exports.withdrawMember = async (req, res) => {
  const { id } = req.user;
  const { password } = req.body;
  let connection;

  try {
    if (!password) return fail(res, '비밀번호를 입력해주세요.', 400);

    connection = await pool.getConnection();
    const [users] = await connection.query('SELECT password FROM users WHERE id = ?', [id]);

    // 1. 비밀번호 일치 확인
    const isMatch = await bcrypt.compare(password, users[0].password);
    if (!isMatch) return fail(res, '비밀번호가 일치하지 않습니다.', 400);

    // 2. 최종 처리 (계정 및 활동 정보 영구 삭제)
    await connection.beginTransaction();
    await connection.query('DELETE FROM users WHERE id = ?', [id]);
    await connection.commit();

    return success(res, '회원 탈퇴가 완료되었습니다.');
  } catch (error) {
    if (connection) await connection.rollback();
    return fail(res, '서버 에러가 발생했습니다.', 500);
  } finally {
    if (connection) connection.release();
  }
};

/**
 * 13. 아이디 찾기
 */
exports.findUserid = async (req, res) => {
  let connection;
  try {
    const { email } = req.body;
    if (!email) {
      return fail(res, '이메일을 입력해주세요.', 400);
    }
    connection = await pool.getConnection();
    const sql = 'SELECT userid FROM users WHERE email = ?';
    const [rows] = await connection.query(sql, [email]);
    if (rows.length === 0) {
      return fail(res, '입력하신 정보와 일치하는 회원이 없습니다.', 404);
    }
    return success(res, '아이디:', { userid: rows[0].userid });
  } catch (error) {
    console.error('Server Error:', error);
    return fail(res, '서버 에러가 발생했습니다.', 500);
  } finally {
    if (connection) connection.release();
  }
};

/**
 * 14. 비밀번호 재설정 - 인증번호 발송
 */
exports.sendPasswordResetCode = async (req, res) => {
  let connection;
  try {
    const { userid, email } = req.body;
    if (!userid || !email) {
      return fail(res, '아이디와 이메일을 모두 입력해주세요.', 400);
    }
    connection = await pool.getConnection();
    const userSql = 'SELECT 1 FROM users WHERE userid = ? AND email = ?';
    const [users] = await connection.query(userSql, [userid, email]);
    if (users.length === 0) {
      return fail(res, '아이디 또는 이메일을 잘못 입력했습니다. 입력하신 내용을 다시 확인해주세요.', 404);
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
 * 15. 비밀번호 재설정 - 새 비밀번호 설정
 */
exports.resetPassword = async (req, res) => {
  let connection;
  try {
    const { email, password, password_confirm } = req.body;
    if (!email || !password || !password_confirm) {
      return fail(res, '모든 필드를 입력해주세요.', 400);
    }
    if (password !== password_confirm) {
      return fail(res, '비밀번호가 일치하지 않습니다.', 400);
    }
    if (!validatePassword(password)) {
      return fail(res, '영문, 숫자 포함 최소 8자로 입력해주세요.', 400);
    }
    connection = await pool.getConnection();
    const sql = 'SELECT * FROM email_verifications WHERE email = ?';
    const [rows] = await connection.query(sql, [email]);
    if (rows.length === 0) return fail(res, '인증번호 요청 내역이 없습니다.', 404);
    const verification = rows[0];
    if (!verification.verified) {
      return fail(res, '이메일 인증이 완료되지 않았습니다.', 403);
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // 비밀번호 업데이트 및 인증 정보 삭제
    await connection.query('UPDATE users SET password = ? WHERE email = ?', [hashedPassword, email]);
    await connection.query('DELETE FROM email_verifications WHERE email = ?', [email]);

    return success(res, '비밀번호가 재설정되었습니다.');
  } catch (error) {
    console.error('Server Error:', error);
    return fail(res, '서버 에러가 발생했습니다.', 500);
  } finally {
    if (connection) connection.release();
  }
};