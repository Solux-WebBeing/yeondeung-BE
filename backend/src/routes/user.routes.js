const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const notificationController = require('../controllers/notification.controller');
const { verifyToken, verifyTokenOptional } = require('../middlewares/auth.middleware');

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
 * /api/users/check-orgname:
 *   get:
 *     summary: 단체명 중복 확인
 *     description: 이미 등록된 단체명인지 확인합니다.
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: org_name
 *         required: true
 *         schema:
 *           type: string
 *         description: 중복 확인할 단체명
 *     responses:
 *       '200':
 *         description: 사용 가능한 단체명입니다.
 *       '400':
 *         description: 단체명을 입력해주세요.
 *       '409':
 *         description: 이미 등록된 단체명입니다.
 */
router.get('/check-orgname', userController.checkOrgNameExists);

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

// --- 최초 로그인 추가 정보 설정 ---

/**
 * @swagger
 * /api/users/setup/organization:
 *   post:
 *     summary: 단체 회원 추가 정보 설정 (최초 로그인 시)
 *     description: '단체 소개글을 입력하고 최초 로그인 상태를 완료(true)로 변경합니다. (JWT 토큰 필수)'
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [introduction]
 *             properties:
 *               introduction:
 *                 type: string
 *                 description: '단체 소개글 (50자 이상 200자 이하)'
 *                 minLength: 50
 *                 maxLength: 200
 *                 example: "저희 단체는 비영리 목적으로 설립되어 사회적 약자를 돕고..."
 *     responses:
 *       '200':
 *         description: 단체 정보 설정 완료
 *       '400':
 *         description: 글자 수 제한(50~200자) 위반
 *       '401':
 *         description: 토큰이 없거나 만료됨
 */
router.post('/setup/organization', verifyToken, userController.setupOrganization);

/**
 * @swagger
 * /api/users/setup/individual:
 *   post:
 *     summary: 개인 회원 추가 정보 설정 (최초 로그인 시)
 *     description: '관심 분야와 메일링 설정을 입력하고 최초 로그인 상태를 완료(true)로 변경합니다. (JWT 토큰 필수)'
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [interests, mailing_consent]
 *             properties:
 *               interests:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: '관심 분야 (최소 1개, 예: ["환경", "인권"])'
 *               mailing_consent:
 *                 type: boolean
 *                 description: '메일링 수신 동의 여부 (true: 정보 입력 필수 / false: 정보 무시 및 null 저장)'
 *                 example: true
 *               mailing_days:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: '메일링 수신 요일 (필수 2개, 예: ["월", "목"])'
 *                 nullable: true
 *               mailing_time:
 *                 type: string
 *                 description: '메일링 수신 시간 (예: "AM 10시", "PM 2시")'
 *                 example: "PM 2시"
 *                 nullable: true
 *     responses:
 *       '200':
 *         description: 개인 맞춤 정보 설정 완료
 *       '400':
 *         description: 입력값 형식 오류 (요일 개수, 시간 포맷 등)
 *       '401':
 *         description: 토큰이 없거나 만료됨
 */
router.post('/setup/individual', verifyToken, userController.setupIndividual);

/**
 * @swagger
 * /api/users/withdraw:
 *   post:
 *     summary: "회원 탈퇴 (공통)"
 *     description: "비밀번호를 입력받아 일치할 경우 계정과 모든 활동 정보를 서버에서 영구적으로 삭제합니다."
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password:
 *                 type: string
 *                 description: "기존 비밀번호"
 *     responses:
 *       200:
 *         description: "회원 탈퇴 완료"
 *       400:
 *         description: "비밀번호 불일치: '비밀번호가 일치하지 않습니다.'"
 */
router.post('/withdraw', verifyToken, userController.withdrawMember);

/**
 * @swagger
 * /api/users/profile:
 *   get:
 *     summary: 내 정보 조회 (공통)
 *     description: 로그인한 사용자의 상세 프로필 정보를 조회합니다.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: 조회 성공
 *       '401':
 *         description: 인증 실패
 *       '404':
 *         description: 사용자 정보 없음
 */
router.get('/profile', verifyToken, userController.getMyProfile); // <--- 이 줄을 추가하세요

/**
 * @swagger
 * /api/users/profile/org/edit-request:
 *   post:
 *     summary: "단체 정보 수정 요청 (단체)"
 *     description: "관리자 검토 후 승인되면 정보가 반영됩니다. 검토 중에는 재요청할 수 없습니다."
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               introduction:
 *                 type: string
 *                 minLength: 50
 *                 maxLength: 200
 *                 description: "단체 소개 (50~200자)"
 *               email:
 *                 type: string
 *                 format: email
 *                 description: "공식 이메일 형식"
 *               sns_link:
 *                 type: string
 *                 description: "공식 SNS/웹사이트 주소 (유효한 URL)"
 *               contact_number:
 *                 type: string
 *                 description: "국내 전화번호 형식"
 *     responses:
 *       200:
 *         description: "수정 요청 접수: '수정 요청이 접수되었습니다. 검토 후 반영됩니다.'"
 *       400:
 *         description: "입력값 오류 또는 이미 검토 중인 요청 존재"
 */
router.post('/profile/org/edit-request', verifyToken, userController.requestOrgUpdate);

/**
 * @swagger
 * /api/users/activities/org:
 *   get:
 *     summary: "등록한 연대 활동 조회 (단체)"
 *     description: "단체가 등록한 게시글 목록을 최신순으로 조회합니다. 페이지당 4개씩 표시됩니다."
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: "페이지 번호"
 *     responses:
 *       200:
 *         description: "조회 성공"
 *       404:
 *         description: "게시글 없음: '아직 등록한 연대 활동이 없어요.'"
 */
router.get('/activities/org', verifyToken, userController.getOrgActivities);

/**
 * @swagger
 * /api/users/profile/indiv:
 *   patch:
 *     summary: "개인 프로필 수정 (개인)"
 *     description: "닉네임과 관심 분야를 수정합니다."
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nickname:
 *                 type: string
 *                 description: "수정할 닉네임"
 *               interests:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: "선택한 관심 분야 태그 목록"
 *     responses:
 *       200:
 *         description: "수정 완료: '정보가 수정되었습니다.'"
 *       409:
 *         description: "닉네임 중복: '이미 사용중인 닉네임입니다.'"
 */
router.patch('/profile/indiv', verifyToken, userController.updateIndivProfile);

/**
 * @swagger
 * /api/users/profile/indiv/mailing:
 *   patch:
 *     summary: "메일링 수신 설정 수정 (개인)"
 *     description: "메일링 수신 여부, 요일(2개), 시간 설정을 관리합니다."
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               mailing_consent:
 *                 type: boolean
 *                 description: "수신 여부 토글"
 *               mailing_days:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: "선택 요일 (2개)"
 *               mailing_time:
 *                 type: string
 *                 description: "수신 시간"
 *     responses:
 *       200:
 *         description: "설정 저장 완료: '메일링 설정이 저장되었습니다.'"
 */
router.patch('/profile/indiv/mailing', verifyToken, userController.updateMailing);

/**
 * @swagger
 * /api/users/activities/indiv:
 *   get:
 *     summary: "내 활동 정보 조회 (개인)"
 *     description: "내가 쓴 글 목록과 응원봉 참여 총 횟수를 조회합니다."
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "조회 성공"
 */
router.get('/activities/indiv', verifyToken, userController.getIndividualActivities);

/**
 * @swagger
 * /api/users/activities/cheered-calendar:
 *   get:
 *     summary: "응원한 활동 달력 조회 (개인)"
 *     description: "특정 년/월에 해당하는 사용자의 응원 활동 목록을 조회합니다."
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: year
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: month
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: "조회 성공"
 */
router.get('/activities/cheered-calendar', verifyToken, userController.getCheeredActivitiesForCalendar);

/**
 * @swagger
 * /api/users/notifications:
 *   get:
 *     summary: "알림 목록 조회"
 *     description: "사용자의 관심 분야와 일치하는 새 활동 게시글 알림 목록을 최신순으로 최대 10개 조회합니다."
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "알림 목록 조회 성공"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         example: 1
 *                       board_id:
 *                         type: integer
 *                         example: 101
 *                       participation_type:
 *                         type: string
 *                         example: "집회"
 *                       title:
 *                         type: string
 *                         example: "환경 보호를 위한 시민 모임"
 *                       thumbnail_url:
 *                         type: string
 *                         example: "https://example.com/image.jpg"
 *                       start_date:
 *                         type: string
 *                         example: "2025.12.20"
 *                       end_date:
 *                         type: string
 *                         example: "2025.12.21"
 *                       region:
 *                         type: string
 *                         example: "서울특별시"
 *                       district:
 *                         type: string
 *                         example: "종로구"
 *                       message:
 *                         type: string
 *                         example: "✨ 관심 가져주실만한 '환경' 의제 활동이에요!"
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                         example: "2025-12-14T10:00:00Z"
 *                 message:
 *                   type: string
 *                   example: "알림 조회 성공"
 *       401:
 *         description: "인증되지 않은 사용자"
 *       500:
 *         description: "서버 에러"
 */
router.get('/notifications', verifyToken, notificationController.getMyNotifications);

/**
 * @swagger
 * /api/users/notifications/read-all:
 *   patch:
 *     summary: "모든 알림 일괄 읽음 처리"
 *     description: "사용자의 모든 미확인 알림을 읽음 상태로 일괄 변경합니다. 알림 목록 조회가 완료된 시점에 프론트엔드에서 호출합니다."
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "성공"
 *       401:
 *         description: "인증 실패"
 */
router.patch('/notifications/read-all', verifyToken, notificationController.markAllNotificationsAsRead);

/**
 * @swagger
 * /api/users/logout:
 *   post:
 *     summary: 로그아웃
 *     description: '로그아웃 처리를 합니다. (클라이언트에서 저장된 토큰을 삭제해야 함)'
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: 로그아웃 성공
 *       '401':
 *         description: 토큰이 없거나 만료됨
 */
router.post('/logout', verifyToken, userController.logout);


module.exports = router;
