const express = require('express');
const router = express.Router();
const boardController = require('../controllers/board.controller');

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
 *     summary: 게시글 생성
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
 *       '500':
 *          description: 서버 에러
 */
router.post('/', boardController.createPost);

module.exports = router;