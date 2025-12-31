const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { auth, isAdmin } = require('../middlewares/auth.middleware');

/**
 * @swagger
 * tags:
 *   - name: Admin
 *     description: 관리자 기능 API (기관 승인, 신고 관리 등)
 */

/**
 * @swagger
 * /api/admin/pending-organizations:
 *   get:
 *     summary: (관리자) 승인 대기중인 기관 목록 조회
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 승인 대기 목록 조회 성공
 */

// src/routes/admin.routes.js
console.log('1. auth:', typeof auth);
console.log('2. isAdmin:', typeof isAdmin);
console.log('3. controller:', typeof adminController.getPendingOrganizations);


router.get(
  '/pending-organizations',
  auth,
  isAdmin,
  adminController.getPendingOrganizations
);

/**
 * @swagger
 * /api/admin/approve-organization:
 *   post:
 *     summary: (관리자) 기관 회원가입 승인
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 기관 회원가입을 승인했습니다.
 */
router.post(
  '/approve-organization',
  auth,
  isAdmin,
  adminController.approveOrganization
);

/**
 * @swagger
 * /api/admin/reject-organization:
 *   post:
 *     summary: (관리자) 기관 회원가입 거절
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 기관 회원가입을 거절했습니다.
 */
router.post(
  '/reject-organization',
  auth,
  isAdmin,
  adminController.rejectOrganization
);

/**
 * @swagger
 * /api/admin/reports:
 *   get:
 *     summary: (관리자) 신고된 게시글 목록 조회
 *     description: 상태가 RECEIVED인 모든 신고 내역과 게시글 정보를 조회합니다.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 신고 목록 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   report_id:
 *                     type: integer
 *                   report_reason:
 *                     type: string
 *                   board_id:
 *                     type: integer
 *                   board_title:
 *                     type: string
 *                   author_email:
 *                     type: string
 *                   reported_at:
 *                     type: string
 *                     format: date-time
 *       401:
 *         description: 관리자 권한이 없습니다.
 */
router.get(
  '/reports',
  auth,
  isAdmin,
  adminController.getReportedPosts
);

/**
 * @swagger
 * /api/admin/reports/delete:
 *   post:
 *     summary: (관리자) 신고 게시글 강제 삭제
 *     description: 신고된 게시글을 삭제하고 신고 상태를 RESOLVED로 변경합니다.
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
 *               - reportId
 *               - boardId
 *               - adminReason
 *             properties:
 *               reportId:
 *                 type: integer
 *                 description: 처리할 신고 ID
 *               boardId:
 *                 type: integer
 *                 description: 삭제할 게시글 ID
 *               adminReason:
 *                 type: string
 *                 description: 관리자 삭제 사유
 *     responses:
 *       200:
 *         description: 게시글 삭제 및 신고 처리 완료
 *       400:
 *         description: 필수 데이터 누락
 *       404:
 *         description: 게시글을 찾을 수 없음
 */
router.post(
  '/reports/delete',
  auth,
  isAdmin,
  adminController.deleteReportedPost
);

/**
 * @swagger
 * /api/admin/reports/reject:
 *   post:
 *     summary: (관리자) 신고 기각 처리
 *     description: 신고 내용이 타당하지 않다고 판단될 경우, 게시글을 유지한 채 신고를 기각합니다.
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
 *               - reportId
 *               - adminReason
 *             properties:
 *               reportId:
 *                 type: integer
 *                 description: 기각할 신고 내역의 ID
 *               adminReason:
 *                 type: string
 *                 description: 기각 사유 (관리자 메모)
 *     responses:
 *       200:
 *         description: 신고가 성공적으로 기각되었습니다.
 *       400:
 *         description: 필수 데이터 누락
 *       404:
 *         description: 신고 내역을 찾을 수 없음
 */
router.post(
  '/reports/reject',
  auth,
  isAdmin,
  adminController.rejectReport
);


module.exports = router;
