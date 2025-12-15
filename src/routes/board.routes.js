const express = require('express');
const router = express.Router();
const boardController = require('../controllers/board.controller');
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
 *     summary: 게시글 생성 & 검증
 *     tags: [Board]
 *     requestBody:
 *         required: true
 *         content:
 *             application/json:
 *                 schema:
 *                     type: object
 *                     required:
 *                         - user_id
 *                         - participation_type
 *                         - topic
 *                         - content
 *                     properties:
 *                         user_id:
 *                             type: integer
 *                             description: 작성자 ID
 *                         participation_type:
 *                             type: string
 *                             description: 참여 방식
 *                         topic:
 *                             type: string
 *                             description: 의제
 *                         content:
 *                             type: string
 *                             description: 본문
 *                         link:
 *                             type: string
 *                             description: 청원/서명/탄원 링크
 *                         start_date:
 *                             type: string
 *                             format: date-time
 *                             description: 시작일 (YYYY-MM-DD HH:mm:ss)
 *                         end_date:
 *                             type: string
 *                             format: date-time
 *                             description: 종료일 (YYYY-MM-DD HH:mm:ss)
 *     responses:
 *       '201':
 *          description: 게시글 생성 성공
 *       '400':
 *          description: 검증 실패
 *       '500':
 *          description: 서버 에러
 */
router.post('/', validateBoardCreate, boardController.createPost);

module.exports = router;