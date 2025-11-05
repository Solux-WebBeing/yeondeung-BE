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

// --- 회원가입 (분리) ---

/**
 * @swagger
 * /api/users/register/individual:
 *   post:
 *     summary: 개인 회원가입
 *     description: '새로운 개인 사용자를 등록합니다. (이메일 인증/아이디 중복 확인 필수)'
 *     tags: [Users]
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
 *               - password_confirm
 *               - nickname
 *             properties:
 *               email:
 *                 type: string
 *                 description: '사용자 이메일 (사전 인증 필요)'
 *               userid:
 *                 type: string
 *                 description: '사용자 아이디 (사전 중복 확인 필요)'
 *               password:
 *                 type: string
 *                 description: '비밀번호 (영문, 숫자 포함 8자 이상)'
 *               password_confirm:
 *                 type: string
 *                 description: 비밀번호 확인
 *               nickname:
 *                 type: string
 *                 description: 닉네임
 *               email_consent:
 *                 type: boolean
 *                 description: '이메일 수신 동의 여부 (기본값: false)'
 *     responses:
 *       '201':
 *         description: 개인 회원가입 성공
 *       '400':
 *         description: '입력값 오류 (필드 누락, 비밀번호 불일치/정책 위반)'
 *       '403':
 *         description: 이메일 인증 미완료
 *       '409':
 *         description: 이미 사용 중인 이메일 또는 아이디
 */
router.post('/register/individual', userController.registerIndividual);

/**
 * @swagger
 * /api/users/register/organization:
 *   post:
 *     summary: 단체 회원가입
 *     description: '새로운 단체 사용자를 등록합니다. (이메일 인증/아이디 중복 확인 필수)'
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - org_name
 *               - email
 *               - contact_number
 *               - userid
 *               - password
 *               - password_confirm
 *               - address
 *             properties:
 *               org_name:
 *                 type: string
 *                 description: 단체명
 *               email:
 *                 type: string
 *                 description: '공식 이메일 (사전 인증 필요)'
 *               sns_link:
 *                 type: string
 *                 description: '공식 SNS 혹은 웹사이트 (선택)'
 *               contact_number:
 *                 type: string
 *                 description: 연락처
 *               userid:
 *                 type: string
 *                 description: '로그인 아이디 (사전 중복 확인 필요)'
 *               password:
 *                 type: string
 *                 description: '비밀번호 (영문, 숫자 포함 8자 이상)'
 *               password_confirm:
 *                 type: string
 *                 description: 비밀번호 확인
 *               address:
 *                 type: string
 *                 description: 주소
 *     responses:
 *       '201':
 *         description: 단체 회원가입 성공
 *       '400':
 *         description: '입력값 오류 (필드 누락, 비밀번호 불일치/정책 위반)'
 *       '403':
 *         description: 이메일 인증 미완료
 *       '409':
 *         description: 이미 사용 중인 이메일 또는 아이디
 */
router.post('/register/organization', userController.registerOrganization);

// --- 공통 API (중복확인, 이메일 인증, 로그인, 내정보) ---

/**
 * @swagger
 * /api/users/check-userid:
 *   get:
 *     summary: 아이디 중복 확인
 *     description: 이미 사용 중인 아이디인지 확인합니다.
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: userid
 *         required: true
 *         schema:
 *           type: string
 *         description: 중복 확인할 아이디
 *     responses:
 *       '200':
 *         description: 사용 가능한 아이디입니다.
 *       '400':
 *         description: 아이디를 입력해주세요.
 *       '409':
 *         description: 이미 사용중인 아이디입니다.
 */
router.get('/check-userid', userController.checkUseridExists);

/**
 * @swagger
 * /api/users/check-email:
 *   get:
 *     summary: 이메일 중복 확인
 *     description: 이미 가입된 이메일인지 확인합니다.
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *         description: 중복 확인할 이메일
 *     responses:
 *       '200':
 *         description: 사용 가능한 이메일입니다.
 *       '400':
 *         description: 이메일을 입력해주세요.
 *       '409':
 *         description: 이미 사용중인 이메일입니다.
 */
router.get('/check-email', userController.checkEmailExists);

/**
 * @swagger
 * /api/users/email/send-verification:
 *   post:
 *     summary: 이메일 인증번호 발송
 *     description: '회원가입 전 이메일 인증을 위해 인증번호를 발송합니다. (10분 유효)'
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 description: 인증번호를 받을 이메일
 *     responses:
 *       '200':
 *         description: '인증번호가 발송되었습니다. 10분 이내에 입력해주세요.'
 *       '400':
 *         description: 이메일을 입력해주세요.
 *       '409':
 *         description: 이미 가입된 이메일입니다.
 */
router.post('/email/send-verification', userController.sendEmailVerification);

/**
 * @swagger
 * /api/users/email/verify-code:
 *   post:
 *     summary: 이메일 인증번호 확인
 *     description: 발송된 인증번호와 이메일을 검증합니다.
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, code]
 *             properties:
 *               email:
 *                 type: string
 *                 description: 인증한 이메일
 *               code:
 *                 type: string
 *                 description: 6자리 인증번호
 *     responses:
 *       '200':
 *         description: 이메일 인증에 성공했습니다.
 *       '400':
 *         description: 입력값 오류 또는 인증번호 불일치
 *       '404':
 *         description: 인증번호 요청 내역이 없습니다.
 *       '410':
 *         description: 인증번호가 만료되었습니다.
 */
router.post('/email/verify-code', userController.verifyEmailCode);

/**
 * @swagger
 * /api/users/login:
 *   post:
 *     summary: 로그인 (공통)
 *     description: '사용자 아이디와 비밀번호로 로그인하여 JWT 토큰을 발급받습니다. (최초 로그인 여부 포함)'
 *     tags: [Users]
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
 *         description: '로그인 성공. 응답 본문에 토큰 포함.'
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     token:
 *                       type: string
 *       '401':
 *         description: '인증 실패 (아이디 또는 비밀번호 오류)'
 */
router.post('/login', userController.login);

module.exports = router;
