const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
// const adminAuthMiddleware = require('../middlewares/adminAuth.middleware'); // (관리자 인증 미들웨어 - 구현 필요)

// (중요) 아래 모든 라우트는 실제 운영 시 관리자 인증 미들웨어를 통과해야 합니다.
// 예: router.use(adminAuthMiddleware);

/**
 * @swagger
 * tags:
 *   - name: Admin
 *     description: 관리자 기능 API (기관 승인 등)
 */

/**
 * @swagger
 * /api/admin/pending-organizations:
 *   get:
 *     summary: (관리자) 승인 대기중인 기관 목록 조회
 *     description: 'approval_status가 PENDING인 모든 기관 회원 목록을 조회합니다. (관리자 인증 필요)'
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: [] # (adminAuthMiddleware 적용 시)
 *     responses:
 *       '200':
 *         description: 승인 대기 목록 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   email:
 *                     type: string
 *                   userid:
 *                     type: string
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *                   org_name:
 *                     type: string
 *                   contact_number:
 *                     type: string
 *       '401':
 *         description: 관리자 권한이 없습니다.
 *       '500':
 *         description: 서버 에러
 */
router.get('/pending-organizations', adminController.getPendingOrganizations); // 이 부분이 50번째 줄 근처일 것입니다.

/**
 * @swagger
 * /api/admin/approve-organization:
 *   post:
 *     summary: (관리자) 기관 회원가입 승인
 *     description: 'PENDING 상태의 기관 회원을 APPROVED로 변경하고, 승인 이메일을 발송합니다. (관리자 인증 필요)'
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *             properties:
 *               userId:
 *                 type: integer
 *                 description: 승인할 기관 회원의 users.id
 *     responses:
 *       '200':
 *         description: 기관 회원가입을 승인했습니다.
 *       '400':
 *         description: 사용자 ID가 필요합니다.
 *       '404':
 *         description: 해당 기관 회원을 찾을 수 없습니다.
 *       '409':
 *         description: 이미 승인된 회원입니다.
 */
router.post('/approve-organization', adminController.approveOrganization);

/**
 * @swagger
 * /api/admin/reject-organization:
 *   post:
 *     summary: (관리자) 기관 회원가입 거절
 *     description: 'PENDING 상태의 기관 회원을 REJECTED로 변경하고, 거절 사유 이메일을 발송합니다. (관리자 인증 필요)'
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - reason
 *             properties:
 *               userId:
 *                 type: integer
 *                 description: 거절할 기관 회원의 users.id
 *               reason:
 *                 type: string
 *                 description: 거절 사유 (이메일 발송용)
 *     responses:
 *       '200':
 *         description: 기관 회원가입을 거절했습니다.
 *       '400':
 *         description: 사용자 ID와 거절 사유가 필요합니다.
 *       '404':
 *         description: 해당 기관 회원을 찾을 수 없습니다.
 *       '409':
 *         description: 이미 거절된 회원입니다.
 */
router.post('/reject-organization', adminController.rejectOrganization);

module.exports = router;
