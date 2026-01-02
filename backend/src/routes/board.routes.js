const express = require('express');
const router = express.Router();
const multer = require('multer'); // [추가]
const boardController = require('../controllers/board.controller');
const { verifyToken, verifyTokenWithMsg, verifyTokenOptional } = require('../middlewares/auth.middleware');
const { validateBoardCreate } = require('../middlewares/validate.middleware');

// [추가] Multer 설정 (메모리 저장 -> Controller에서 ImgBB로 전송)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB 제한
});

/**
 * @swagger
 * tags:
 *   - name: Board
 *     description: "게시글 관리 API"
 */

/**
 * @swagger
 * /api/boards:
 *   post:
 *     summary: "게시글 생성 (이미지 업로드 포함)"
 *     description: "로그인한 사용자가 게시글을 작성합니다. 참여 방식에 따라 필수 입력값이 다르며, 링크 입력 시 AI 검증이 수행됩니다. (multipart/form-data)"
 *     tags: [Board]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
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
 *                 description: "참여 방식 (집회, 행사, 서명, 청원, 탄원)"
 *                 example: "서명"
 *               title:
 *                 type: string
 *                 description: "게시글 제목"
 *                 example: "강남역 환경 정화 활동 모집"
 *               topics:
 *                 type: string
 *                 description: "의제 (콤마로 구분, 최대 2개)"
 *                 example: "환경,인권"
 *               content:
 *                 type: string
 *                 description: "본문 (공백 제외 50자 이상)"
 *                 example: "이 게시글은 환경 보호를 위한 서명 운동입니다."
 *               start_date:
 *                 type: string
 *                 format: date
 *                 description: "시작일 (YYYY-MM-DD)"
 *                 example: "2023-11-01"
 *               start_time:
 *                 type: string
 *                 description: "시작 시간 (HH:MM, 24시간제, 5분 단위)"
 *                 example: "10:00"
 *               end_date:
 *                 type: string
 *                 format: date
 *                 description: "종료일 (YYYY-MM-DD)"
 *                 example: "2023-11-30"
 *               end_time:
 *                 type: string
 *                 description: "종료 시간 (HH:MM, 24시간제, 5분 단위)"
 *                 example: "18:35"
 *               link:
 *                 type: string
 *                 description: "참여 링크 (서명/청원/탄원 시 필수, 화이트리스트 도메인만 허용)"
 *                 example: "https://petitions.assembly.go.kr/example"
 *               region:
 *                 type: string
 *                 description: "시/도 (집회/행사 시 필수)"
 *                 example: "서울"
 *               district:
 *                 type: string
 *                 description: "시/군/구 (집회/행사 시 필수)"
 *                 example: "종로구"
 *               images:
 *                 type: array
 *                 description: "업로드할 이미지 파일 (최대 2개)"
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       '201':
 *         description: "게시글 생성 성공"
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
 *                 imageUrls:
 *                   type: array
 *                   items:
 *                     type: string
 *       '400':
 *         description: "유효성 검사 실패"
 *       '401':
 *         description: "인증 실패"
 *       '500':
 *         description: "서버 에러"
 */
router.post('/', verifyToken, upload.array('images', 2), validateBoardCreate, boardController.createPost);

/**
 * @swagger
 * /api/boards/{id}:
 *   put:
 *     summary: "게시글 수정"
 *     description: "본인이 작성한 게시글을 수정합니다. (multipart/form-data)"
 *     tags: [Board]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: "게시글 ID"
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               participation_type:
 *                 type: string
 *               title:
 *                 type: string
 *                 description: "게시글 제목"
 *                 example: "강남역 환경 정화 활동 모집"
 *               topics:
 *                 type: string
 *               content:
 *                 type: string
 *               start_date:
 *                 type: string
 *                 format: date
 *                 description: "시작일 (YYYY-MM-DD)"
 *               start_time:
 *                 type: string
 *                 description: "시작 시간 (HH:MM)"
 *               end_date:
 *                 type: string
 *                 format: date
 *                 description: "종료일 (YYYY-MM-DD)"
 *               end_time:
 *                 type: string
 *                 description: "종료 시간 (HH:MM)"
 *               link:
 *                 type: string
 *               region:
 *                 type: string
 *               district:
 *                 type: string
 *               images:
 *                 type: array
 *                 description: "새로 추가할 이미지 파일"
 *                 items:
 *                   type: string
 *                   format: binary
 *               existing_images:
 *                 type: array
 *                 description: "유지할 기존 이미지 URL 리스트"
 *                 items:
 *                   type: string
 *     responses:
 *       '200':
 *         description: "게시글이 수정되었습니다."
 *       '400':
 *         description: "권한 없음 또는 유효성 검사 실패"
 */
router.put('/:id', verifyToken, upload.array('images', 2), boardController.updatePost);

/**
 * @swagger
 * /api/boards/{id}:
 *   delete:
 *     summary: "게시글 삭제"
 *     description: "본인이 작성한 게시글을 삭제합니다."
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
 *         description: "게시글이 삭제되었습니다."
 *       '400':
 *         description: "삭제 실패"
 */
router.delete('/:id', verifyToken, boardController.deletePost);

/**
 * @swagger
 * /api/boards/{id}/report:
 *   post:
 *     summary: "게시글 신고"
 *     description: "부적절한 게시글을 신고합니다."
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
 *                 description: "신고 사유 (10자 이상)"
 *     responses:
 *       '200':
 *         description: "신고가 접수되었습니다."
 *       '400':
 *         description: "신고 사유 미입력"
 *       '409':
 *         description: "이미 신고한 게시글"
 */
router.post('/:id/report', verifyTokenWithMsg('로그인 후 신고할 수 있습니다'), boardController.reportPost);

/**
 * @swagger
 * /api/boards/{id}/share:
 *   get:
 *     summary: "게시글 공유 링크 조회"
 *     tags: [Board]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       '200':
 *         description: "공유 링크 반환 성공"
 */
router.get('/:id/share', boardController.sharePost);

/**
 * @swagger
 * /api/boards/{id}:
 *   get:
 *     summary: "게시글 상세 조회"
 *     description: "비회원도 조회 가능"
 *     tags: [Board]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       '200':
 *         description: "조회 성공"
 *       '404':
 *         description: "게시글 없음"
 */
router.get('/:id', verifyTokenOptional, boardController.getBoardDetail);

/**
 * @swagger
 * /api/boards/{id}/cheer:
 *   post:
 *     summary: "응원 토글"
 *     description: "게시글 응원/취소"
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
 *         description: "처리 성공"
 */
router.post('/:id/cheer', verifyTokenWithMsg('로그인 후 응원할 수 있습니다'), boardController.toggleCheer);

module.exports = router;
