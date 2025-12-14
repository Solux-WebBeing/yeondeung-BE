const express = require('express');
const router = express.Router();
const boardController = require('../controllers/board.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
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
 *               - topic
 *               - content
 *               - start_date
 *               - end_date
 *             properties:
 *               participation_type:
 *                 type: string
 *                 description: '참여 방식 (집회, 행사, 서명, 청원, 탄원)'
 *                 example: '서명'
 *               topic:
 *                 type: string
 *                 description: '의제 (콤마로 구분, 최대 2개)'
 *                 example: '환경,인권'
 *               content:
 *                 type: string
 *                 description: '본문 (공백 제외 50자 이상)'
 *                 example: '이 게시글은 환경 보호를 위한 서명 운동입니다. 많은 참여 부탁드립니다...'
 *               start_date:
 *                 type: string
 *                 format: date-time
 *                 description: '시작일 (YYYY-MM-DD HH:mm:ss)'
 *                 example: '2023-11-01 10:00:00'
 *               end_date:
 *                 type: string
 *                 format: date-time
 *                 description: '종료일 (YYYY-MM-DD HH:mm:ss)'
 *                 example: '2023-11-30 18:00:00'
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

module.exports = router;