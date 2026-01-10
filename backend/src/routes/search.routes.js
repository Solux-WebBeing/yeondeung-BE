const express = require('express');
const router = express.Router();
const searchController = require('../controllers/search.controller');

// TODO: auth 미들웨어가 없다면 임시로 주석 처리하거나 가져오세요.
// const { verifyTokenOptional } = require('../src/util/auth.middleware'); 
const verifyTokenOptional = (req, res, next) => next(); // 임시 미들웨어 (테스트용)

/**
 * @swagger
 * tags:
 *   - name: Search
 *     description: Elasticsearch 기반 통합 검색 및 추천
 */


/**
 * @swagger
 * /api/search:
 *   get:
 *     summary: "게시글 통합 검색"
 *     tags:
 *       - Search
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: "검색어 (제목, 내용, 의제 대상)"
 *       - in: query
 *         name: topics
 *         schema:
 *           type: string
 *         description: "의제 필터 (쉼표 구분, 예: 성소수자,인권)"
 *       - in: query
 *         name: region
 *         schema:
 *           type: string
 *         description: "시/도 (예: 대구광역시)"
 *       - in: query
 *         name: district
 *         schema:
 *           type: string
 *         description: "구/군 (쉼표 구분, 예: 중구,남구)"
 *       - in: query
 *         name: participation_type
 *         schema:
 *           type: string
 *         description: "참여 방식 (예: 집회,행사)"
 *       - in: query
 *         name: host_type
 *         schema:
 *           type: string
 *         description: "주최 타입 (예: INDIVIDUAL)"
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date
 *         description: "시작일 (YYYY-MM-DD)"
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date
 *         description: "종료일 (YYYY-MM-DD)"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: "페이지 번호"
 *     responses:
 *       '200':
 *         description: "검색 결과 반환 성공"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 total:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 */
router.get('/', verifyTokenOptional, searchController.searchPosts);


/**
 * @swagger
 * /api/search/all:
 *   get:
 *     summary: 전체 게시글 조회 (ELK)
 *     tags:
 *       - Search
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *     responses:
 *       '200':
 *         description: 조회 성공
 */
router.get('/all', verifyTokenOptional, searchController.getAllPosts);

/**
 * @swagger
 * /api/search/suggest:
 *   get:
 *     summary: 실시간 추천 검색어 제안
 *     tags:
 *       - Search
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: 추천 목록 반환
 */
router.get('/suggest', verifyTokenOptional, searchController.getSuggestions);

module.exports = router;

