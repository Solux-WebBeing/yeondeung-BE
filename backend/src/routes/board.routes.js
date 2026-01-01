const express = require('express');
const router = express.Router();
const boardController = require('../controllers/board.controller');
const { verifyToken, verifyTokenWithMsg, verifyTokenOptional } = require('../middlewares/auth.middleware');
const { validateBoardCreate } = require('../middlewares/validate.middleware');

/**
 * @swagger
 * tags:
 *   - name: Board
 *     description: 게시글 관리 API
 */

/**
 * @swagger
 * /api/boards:
 *   post:
 *     summary: 게시글 생성 (AI 검증 포함)
 *     description: 로그인한 사용자가 게시글을 작성합니다. 참여 방식에 따라 필수 입력값이 다르며, 링크 입력 시 AI 검증이 수행됩니다.
 *     tags: [Board]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - participation_type
 *               - title
 *               - topics
 *               - content
 *               - start_date
 *               - end_date
 *             properties:
 *               participation_type:
 *                 type: string
 *                 description: '참여 방식 (집회, 행사, 서명, 청원, 탄원)'
 *                 example: '서명'
 *               title:
 *                 type: string
 *                 description: '게시글 제목'
 *                 example: '강남역 환경 정화 활동 모집'
 *               topics:
 *                 type: string
 *                 description: '의제 (콤마로 구분, 최대 2개)'
 *                 example: '환경,인권'
 *               content:
 *                 type: string
 *                 description: '본문 (공백 제외 50자 이상)'
 *                 example: '이 게시글은 환경 보호를 위한 서명 운동입니다. 많은 참여 부탁드립니다. 많은 참여 부탁드립니다. 많은 참여 부탁드립니다. 많은 참여 부탁드립니다.'
 *               start_date:
 *                 type: string
 *                 format: date
 *                 description: '시작일 (YYYY-MM-DD)'
 *                 example: '2023-11-01'
 *               start_time:
 *                 type: string
 *                 description: '시작 시간 (HH:MM, 24시간제, 5분 단위)'
 *                 example: '10:00'
 *               end_date:
 *                 type: string
 *                 format: date
 *                 description: '종료일 (YYYY-MM-DD)'
 *                 example: '2023-11-30'
 *               end_time:
 *                 type: string
 *                 description: '종료 시간 (HH:MM, 24시간제, 5분 단위)'
 *                 example: '18:35'
 *               link:
 *                 type: string
 *                 description: '참여 링크 (서명/청원/탄원 시 필수, 화이트리스트 도메인만 허용)'
 *                 example: 'https://petitions.assembly.go.kr/example'
 *               region:
 *                 type: string
 *                 description: '시/도 (집회/행사 시 필수)'
 *                 example: '서울'
 *               district:
 *                 type: string
 *                 description: '시/군/구 (집회/행사 시 필수)'
 *                 example: '종로구'
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: '업로드된 이미지 URL 배열'
 *                 example: ['https://s3.aws.com/img1.jpg', 'https://s3.aws.com/img2.jpg']
 *     responses:
 *       '201':
 *         description: 게시글 생성 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 postId:
 *                   type: integer
 *       '400':
 *         description: 유효성 검사 실패 (필수값 누락, 도메인 불허, AI 검증 실패 등)
 *       '401':
 *         description: 인증 실패 (토큰 없음 또는 만료)
 *       '500':
 *         description: 서버 에러
 */
router.post('/', verifyToken, validateBoardCreate, boardController.createPost);

/**
 * @swagger
 * /api/boards/{id}:
 *   put:
 *     summary: 게시글 수정
 *     description: 본인이 작성한 게시글을 수정합니다.
 *     tags: [Board]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 게시글 ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               participation_type:
 *                 type: string
 *               title:
 *                 type: string
 *                 description: '게시글 제목'
 *                 example: '강남역 환경 정화 활동 모집'
 *               topics:
 *                 type: string
 *               content:
 *                 type: string
 *               start_date:
 *                 type: string
 *                 format: date
 *                 description: '시작일 (YYYY-MM-DD)'
 *                 example: '2023-11-01'
 *               start_time:
 *                 type: string
 *                 description: '시작 시간 (HH:MM, 24시간제, 5분 단위)'
 *                 example: '10:00'
 *               end_date:
 *                 type: string
 *                 format: date
 *                 description: '종료일 (YYYY-MM-DD)'
 *                 example: '2023-11-30'
 *               end_time:
 *                 type: string
 *                 description: '종료 시간 (HH:MM, 24시간제, 5분 단위)'
 *                 example: '18:35'
 *               link:
 *                 type: string
 *               region:
 *                 type: string
 *               district:
 *                 type: string
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       '200':
 *         description: 게시글이 수정되었습니다.
 *       '400':
 *         description: 권한 없음 또는 유효성 검사 실패
 */
router.put('/:id', verifyToken, boardController.updatePost);

/**
 * @swagger
 * /api/boards/{id}:
 *   delete:
 *     summary: 게시글 삭제
 *     description: 본인이 작성한 게시글을 삭제합니다.
 *     tags: [Board]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       '200':
 *         description: 게시글이 삭제되었습니다.
 *       '400':
 *         description: 삭제 실패 (권한 없음 등)
 */
router.delete('/:id', verifyToken, boardController.deletePost);

/**
 * @swagger
 * /api/boards/{id}/report:
 *   post:
 *     summary: 게시글 신고
 *     description: 부적절한 게시글을 신고합니다. (중복 신고 불가, 10자 이상)
 *     tags: [Board]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 description: 신고 사유 (10자 이상)
 *                 example: "이 게시글은 부적절한 내용을 포함하고 있습니다."
 *     responses:
 *       '200':
 *         description: 신고가 접수되었습니다.
 *       '400':
 *         description: 신고 사유 미입력 (10자 미만)
 *       '409':
 *         description: 이미 신고하신 게시글입니다.
 */
router.post('/:id/report', verifyTokenWithMsg('로그인 후 신고할 수 있습니다'), boardController.reportPost);

/**
 * @swagger
 * /api/boards/{id}/share:
 *   get:
 *     summary: 게시글 공유 링크 조회
 *     tags: [Board]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       '200':
 *         description: 공유 링크 반환 성공
 */
router.get('/:id/share', boardController.sharePost);

/**
 * @swagger
 * /api/boards/{id}:
 *   get:
 *     summary: 게시글 상세 조회 (응원 정보 포함)
 *     description: 비회원도 조회 가능하며, 로그인 시 본인의 응원 여부(is_cheered)를 함께 반환합니다.
 *     tags: [Board]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 게시글 ID
 *     responses:
 *       '200':
 *         description: 조회 성공 (cheer_count, is_cheered 포함)
 *       '404':
 *         description: 게시글을 찾을 수 없음
 */
router.get('/:id', verifyTokenOptional, boardController.getBoardDetail);

/**
 * @swagger
 * /api/boards/{id}/cheer:
 *   post:
 *     summary: 응원봉 클릭 (토글)
 *     description: 게시글에 응원을 보내거나 취소합니다. (로그인 필수)
 *     tags: [Board]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: 게시글 ID
 *     responses:
 *       '200':
 *         description: 처리 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 isCheered:
 *                   type: boolean
 *                   description: true(응원됨), false(취소됨)
 *                 cheerCount:
 *                   type: integer
 *                   description: 변경된 총 응원 수
 */
router.post('/:id/cheer', verifyTokenWithMsg('로그인 후 응원할 수 있습니다'), boardController.toggleCheer);

module.exports = router;