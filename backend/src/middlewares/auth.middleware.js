const jwt = require('jsonwebtoken');

// [내부 함수] 실제 토큰 검증 로직
const validateToken = (req, res, next, customMessage, isOptional = false) => {
    try {
        const authHeader = req.headers.authorization;
        
        // 1. 헤더 체크
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            // [수정] 옵셔널 모드라면, 토큰이 없어도 에러 없이 통과
            if (isOptional) {
                return next();
            }
            return res.status(401).json({ 
                message: customMessage || '인증 토큰이 없습니다.' 
            });
        }

        const token = authHeader.split(' ')[1];
        
        // 2. 토큰 존재 체크
        if (!token) {
            if (isOptional) {
                return next();
            }
            return res.status(401).json({ 
                message: customMessage || '인증 토큰이 없습니다.' 
            });
        }

        // 3. 토큰 검증
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // 유저 정보 저장
        next();

    } catch (error) {
        // 토큰이 있는데 만료된 경우 -> 옵셔널이라도 알려주는 게 좋음 (클라이언트가 갱신하도록)
        if (error.name === 'TokenExpiredError') {
            return res.status(419).json({ message: '토큰이 만료되었습니다.' });
        }
        // 토큰이 깨진 경우
        return res.status(401).json({ 
            message: customMessage || '유효하지 않은 토큰입니다.' 
        });
    }
};

/**
 * 1. 기본 인증 미들웨어 (필수)
 */
const verifyToken = (req, res, next) => {
    validateToken(req, res, next, null, false);
};

/**
 * 2. 메시지 커스텀 인증 미들웨어 (필수)
 */
const verifyTokenWithMsg = (message) => {
    return (req, res, next) => {
        validateToken(req, res, next, message, false);
    };
};

/**
 * 3. 선택적 인증 미들웨어
 * - 토큰 있음: 검증 수행 (req.user 생성)
 * - 토큰 없음: 그냥 통과 (req.user 없음)
 */
const verifyTokenOptional = (req, res, next) => {
    validateToken(req, res, next, null, true);
};

module.exports = { verifyToken, verifyTokenWithMsg, verifyTokenOptional };