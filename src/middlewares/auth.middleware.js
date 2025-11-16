
const jwt = require('jsonwebtoken');

// 토큰을 검증하는 미들웨어
const verifyToken = (req, res, next) => {
    try {
        // 1. 헤더에서 토큰 가져오기
        // 'Bearer ' 부분을 잘라내고 토큰 값만 추출
        const token = req.headers.authorization.split(' ')[1]; 
        
        if (!token) {
            return res.status(401).json({ message: '인증 토큰이 없습니다.' });
        }

        // 2. 토큰 검증 (비밀키는 .env 파일에 보관해야 합니다)
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // 3. 검증된 사용자 정보를 req 객체에 저장
        req.user = decoded; // 예: { userId: 1, email: '...' }
        
        next(); // 4. 다음 미들웨어 또는 컨트롤러로 이동

    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(419).json({ message: '토큰이 만료되었습니다.' });
        }
        return res.status(401).json({ message: '유효하지 않은 토큰입니다.' });
    }
};

module.exports = { verifyToken };