const jwt = require('jsonwebtoken');

/**
 * [내부 함수] 실제 토큰 검증 로직
 */
const validateToken = (req, res, next, customMessage, isOptional = false) => {
    console.log(`[DEBUG] URL: ${req.url}, isOptional: ${isOptional}, AuthHeader: ${req.headers.authorization ? '있음' : '없음'}`);
    try {
        const authHeader = req.headers.authorization;
        
        // 1. 토큰이 아예 없는 경우
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            if (isOptional) return next(); // 선택적이면 무조건 통과
            return res.status(401).json({ 
                message: customMessage || '인증 토큰이 없습니다.' 
            });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; 
        next();

    } catch (error) {
        // 선택적 인증(isOptional)이라면 에러 종류와 상관없이 무조건 next()
        if (isOptional) {
            console.log(`[Optional Auth] 검증 실패(사유: ${error.name}), 하지만 다음으로 진행`);
            return next();
        }

        // 필수 인증일 때만 에러 응답 전달
        if (error.name === 'TokenExpiredError') {
            return res.status(419).json({ message: '토큰이 만료되었습니다.' });
        }
        return res.status(401).json({ 
            message: customMessage || '유효하지 않은 토큰입니다.' 
        });
    }
};

// 1. 필수 인증 미들웨어
const auth = (req, res, next) => validateToken(req, res, next, null, false);
const verifyToken = auth; 

// 2. 메시지 커스텀 인증
const verifyTokenWithMsg = (message) => {
    return (req, res, next) => validateToken(req, res, next, message, false);
};

// 3. 관리자 권한 확인
const isAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'ADMIN') { 
        return res.status(403).json({ 
            success: false, 
            message: '관리자 권한이 필요합니다.' 
        });
    }
    next();
};

// 4. 선택적 인증 미들웨어
const verifyTokenOptional = (req, res, next) => validateToken(req, res, next, null, true);

// [핵심] 모든 함수를 이 블록 안에 넣어야 합니다.
module.exports = { 
    auth, 
    verifyToken, 
    verifyTokenWithMsg, 
    isAdmin, 
    verifyTokenOptional 
};