const jwt = require('jsonwebtoken');

// [내부 함수] 실제 토큰 검증 로직
const validateToken = (req, res, next, customMessage, isOptional = false) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            if (isOptional) return next();
            return res.status(401).json({ 
                message: customMessage || '인증 토큰이 없습니다.' 
            });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; 
        next();

    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(419).json({ message: '토큰이 만료되었습니다.' });
        }
        return res.status(401).json({ 
            message: customMessage || '유효하지 않은 토큰입니다.' 
        });
    }
};

// 1. 기본 인증 미들웨어 (이름 두 개 다 지원)
const auth = (req, res, next) => validateToken(req, res, next, null, false);
const verifyToken = auth; 

// 2. 메시지 커스텀 인증 (기존 user.routes에서 사용할 수 있음)
const verifyTokenWithMsg = (message) => {
    return (req, res, next) => validateToken(req, res, next, message, false);
};

/**
 * 2. 관리자 권한 확인 미들웨어 (role 필드 참조)
 */
const isAdmin = (req, res, next) => {
    // auth 미들웨어를 거친 후이므로 req.user가 존재해야 함
    // 기존 user_type 대신 role 필드를 확인합니다.
    if (!req.user || req.user.role !== 'ADMIN') { 
        return res.status(403).json({ 
            success: false, 
            message: '관리자 권한이 필요합니다.' 
        });
    }
    next();
};

const verifyTokenOptional = (req, res, next) => validateToken(req, res, next, null, true);

// 모든 이름을 다 내보내서 에러 방지
module.exports = { 
    auth, 
    verifyToken, 
    verifyTokenWithMsg, 
    isAdmin, 
    verifyTokenOptional 
};