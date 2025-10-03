const pool = require('../../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// 1. 회원가입
exports.register = async (req, res) => {
  let connection;
  try {
    const { email, userid, password } = req.body;
    if (!email || !userid || !password) {
      return res.status(400).json({ error: '모든 필드를 입력해주세요.' });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    connection = await pool.getConnection();
    const sql = 'INSERT INTO users (email, userid, password) VALUES (?, ?, ?)';
    await connection.query(sql, [email, userid, hashedPassword]);

    res.status(201).json({ message: '회원가입이 성공적으로 완료되었습니다.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: '이미 사용 중인 이메일 또는 아이디입니다.' });
    }
    console.error('Server Error:', error);
    res.status(500).json({ error: '서버 에러가 발생했습니다.' });
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
      return res.status(400).json({ error: '아이디와 비밀번호를 모두 입력해주세요.' });
    }

    connection = await pool.getConnection();
    
    // --- 핵심 로직: userid로 사용자를 조회합니다 ---
    const sql = 'SELECT * FROM users WHERE userid = ?';
    const [users] = await connection.query(sql, [userid]);

    if (users.length === 0) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }

    const payload = {
      id: user.id,
      email: user.email,
      userid: user.userid,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });

    res.status(200).json({
      message: '로그인 성공',
      token: token,
    });
  } catch (error) {
    console.error('Server Error:', error);
    res.status(500).json({ error: '서버 에러가 발생했습니다.' });
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
  res.status(200).send(userInfo);
};

