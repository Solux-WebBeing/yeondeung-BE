const pool = require('../../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const {success, fail} = require('../util/response.util.js');

// 1. 회원가입
exports.register = async (req, res) => {
  let connection;
  try {
    const { email, userid, password } = req.body;
    if (!email || !userid || !password) {
      return fail(res, '모든 필드를 입력해주세요.', 400);
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    connection = await pool.getConnection();
    const sql = 'INSERT INTO users (email, userid, password) VALUES (?, ?, ?)';
    await connection.query(sql, [email, userid, hashedPassword]);
    
    return success(res, '회원가입 성공', { email, userid }, 201);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return fail(res, '이미 존재하는 이메일 또는 아이디입니다.', 409);
    }
    console.error('Server Error:', error);
    return fail(res, '서버 에러가 발생했습니다.', 500);
  } finally {
    if (connection) connection.release();
  }
};

// 2. 로그인
exports.login = async (req, res) => {
  let connection;
  try {
    const { userid, password } = req.body;
    if (!userid || !password) {
      return fail(res, '모든 필드를 입력해주세요.', 400);
    }

    connection = await pool.getConnection();
    
    // --- 핵심 로직: userid로 사용자를 조회합니다 ---
    const sql = 'SELECT * FROM users WHERE userid = ?';
    const [users] = await connection.query(sql, [userid]);

    if (users.length === 0) {
      return fail(res, '아이디 또는 비밀번호가 올바르지 않습니다.', 401);
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return fail(res, '아이디 또는 비밀번호가 올바르지 않습니다.', 401);
    }
    const payload = {
      id: user.id,
      email: user.email,
      userid: user.userid,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });

    success(res, '로그인 성공', { token });
  } catch (error) {
    console.error('Server Error:', error);
    fail(res, '서버 에러가 발생했습니다.', 500);
  } finally {
    if (connection) connection.release();
  }
};

// 3. 내 정보 보기
exports.getMyProfile = (req, res) => {
  const userInfo = {
    id: req.user.id,
    userid: req.user.userid
  };
  res.success(200).json({
    message: '내 정보 조회 성공',
    data: userInfo
  });
};

