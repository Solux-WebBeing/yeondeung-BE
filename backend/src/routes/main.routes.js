const express = require('express');
const router = express.Router();
const mainController = require('../controllers/main.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

/**
 * @swagger
 * tags:
 *   name: Main
 *   description: 메인 대시보드 API (분리형)
 */

/**
 * @swagger
 * /api/main/ours:
 *   get:
 *     summary: "우리들의 연대 (의제별 4건)"
 *     tags: [Main]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: topic
 *         required: true
 *         schema:
 *           type: string
 *         example: "환경"
 *     responses:
 *       200:
 *         description: "성공"
 */
router.get('/ours', verifyToken, mainController.getOurs);

/**
 * @swagger
 * /api/main/realtime:
 *   get:
 *     summary: "실시간 HOT 연대 (누적 응원순 6건)"
 *     tags: [Main]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "성공"
 */
router.get('/realtime', verifyToken, mainController.getRealtime);

/**
 * @swagger
 * /api/main/imminent:
 *   get:
 *     summary: "마감 임박 연대 (24시간 이내 마감 6건)"
 *     tags: [Main]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "성공"
 */
router.get('/imminent', verifyToken, mainController.getImminent);


module.exports = router;
