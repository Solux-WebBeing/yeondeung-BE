const express = require('express');
const router = express.Router();
const searchController = require('../controllers/search.controller');
const { verifyTokenOptional } = require('../middlewares/auth.middleware');

/**
 * @swagger
 * /api/search:
 *   get:
 *     summary: 게시글 통합 검색 (ELK)
 *     description: >
 *       키워드 검색 및 의제, 지역, 참여 방식 등 다양한 필터를 조합하여 게시글을 검색합니다.
 *       기간 필터(start_date, end_date) 입력 시 해당 범위 내에 완전히 포함된 게시글만 반환합니다.
 *       각 필터 항목은 쉼표(,)를 통해 다중 선택(OR 연산)이 가능합니다. (로그인 필수)
 *     tags:
 *       - Search
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: 검색 키워드 (제목, 본문 대상)
 *
 *       - in: query
 *         name: topics
 *         schema:
 *           type: string
 *         description: 의제 필터 (쉼표로 구분)
 *
 *       - in: query
 *         name: region
 *         schema:
 *           type: string
 *         description: 시/도 지역 필터 (쉼표로 구분)
 *
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date
 *         description: 조회 범위 시작일 (YYYY-MM-DD)
 *
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date
 *         description: 조회 범위 종료일 (YYYY-MM-DD)
 *
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: 페이지 번호 (한 페이지당 8개)
 *
 *     responses:
 *       '200':
 *         description: 검색 성공
 *       '401':
 *         description: 인증 실패
 */
router.get('/',verifyTokenOptional, searchController.searchPosts);

/**
 * @swagger
 * /api/search/all:
 *   get:
 *     summary: 전체 게시글 조회 (ELK)
 *     description: >
 *       필터 없이 인덱스에 등록된 모든 게시글을 불러옵니다.
 *       마감 임박 활동이 최상단에 노출되도록 정렬되어 반환됩니다. (로그인 필수)
 *     tags:
 *       - Search
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: 페이지 번호 (한 페이지당 8개)
 *
 *     responses:
 *       '200':
 *         description: 조회 성공. 마감 임박 순으로 정렬된 게시글 리스트 반환
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 total:
 *                   type: integer
 *                 currentPage:
 *                   type: integer
 *                 totalPages:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *
 *       '401':
 *         description: 인증 실패
 *       '500':
 *         description: 서버 오류
 */
router.get('/all',verifyTokenOptional, searchController.getAllPosts);

/**
 * @swagger
 * /api/search/suggest:
 *   get:
 *     summary: 실시간 추천 검색어 제안
 *     description: 사용자가 입력 중인 텍스트(q)를 바탕으로 자동 완성된 검색어 목록을 반환합니다. (로그인 필수)
 *     tags:
 *       - Search
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: 입력 중인 검색어
 *         example: 환
 *
 *     responses:
 *       '200':
 *         description: 추천 검색어 목록 반환
 *       '401':
 *         description: 인증 실패
 */
router.get('/suggest',verifyTokenOptional, searchController.getSuggestions);

module.exports = router;
