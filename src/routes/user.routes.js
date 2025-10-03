const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
// const authMiddleware = require('../middlewares/auth.middleware');

/**
 * @swagger
 * tags:
 *   - name: Users
 *     description: 사용자 인증 및 정보 관련 API
 */

/**
 * @swagger
 * /api/users/register:
 *   post:
 *     summary: 회원가입
 *     description: 새로운 사용자를 등록합니다.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - userid
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 description: 사용자 이메일
 *               userid:
 *                 type: string
 *                 description: 사용자 아이디
 *               password:
 *                 type: string
 *                 description: 사용자 비밀번호
 *     responses:
 *       '201':
 *         description: 회원가입 성공
 *       '409':
 *         description: 이미 사용 중인 이메일 또는 아이디
 */


router.post('/register', userController.register);

/**
 * @swagger
 * /api/users/login:
 *   post:
 *     summary: 로그인
 *     description: 사용자 이메일과 비밀번호로 로그인하여 JWT 토큰을 발급받습니다.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userid
 *               - password
 *             properties:
 *               userid:
 *                 type: string
 *                 description: 사용자 아이디
 *               password:
 *                 type: string
 *                 description: 사용자 비밀번호
 *     responses:
 *       '200':
 *         description: 로그인 성공. 응답 본문에 토큰 포함.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 token:
 *                   type: string
 *       '401':
 *         description: 인증 실패 (아이디 또는 비밀번호 오류)
 */

router.post('/login', userController.login);

// router.get('/me', authMiddleware, userController.getMyProfile);

module.exports = router;

