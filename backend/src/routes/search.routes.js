const express = require('express');
const router = express.Router();
const searchController = require('../controllers/search.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

/**
 * @swagger
 * /api/search:
 *   get:
 *     summary: 게시글 통합 검색 (ELK)
 *     description: >
 *       키워드 검색 및 의제, 지역, 참여 방식 등 다양한 필터를 조합하여 게시글을 검색합니다.
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
 *         description: 의제 필터 (쉼표로 구분하여 다중 선택 가능, OR 연산)
 *         example: 복지,의료,환경
 *
 *       - in: query
 *         name: region
 *         schema:
 *           type: string
 *         description: 시/도 지역 필터 (쉼표로 구분하여 다중 선택 가능, OR 연산)
 *         example: 서울,경기,제주
 *
 *       - in: query
 *         name: district
 *         schema:
 *           type: string
 *         description: 시/군/구 상세 지역 필터 (쉼표로 구분하여 다중 선택 가능, OR 연산)
 *         example: 강남구,수원시,서귀포시
 *
 *       - in: query
 *         name: participation_type
 *         schema:
 *           type: string
 *         description: 참여 방식 필터 (집회, 서명, 청원, 탄원, 행사 중 쉼표로 다중 선택 가능)
 *         example: 집회,서명
 *
 *       - in: query
 *         name: host_type
 *         schema:
 *           type: string
 *         description: 주최자 유형 필터 (INDIVIDUAL, ORGANIZATION 중 쉼표로 다중 선택 가능)
 *         example: INDIVIDUAL,ORGANIZATION
 *
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date-time
 *         description: 조회 시작 일시 (yyyy-MM-dd HH:mm:ss)
 *
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date-time
 *         description: 조회 종료 일시 (yyyy-MM-dd HH:mm:ss)
 *
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: 페이지 번호 (한 페이지당 8개 노출)
 *
 *     responses:
 *       '200':
 *         description: 검색 성공. 오늘 종료 활동이 최상단에 고정된 리스트를 반환합니다.
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
 *         description: 인증 실패 (토큰 누락 또는 유효하지 않음)
 *
 *       '500':
 *         description: 검색 엔진 서버 오류
 */
router.get('/', verifyToken, searchController.searchPosts);

/**
 * @swagger
 * /api/search/suggest:
 *   get:
 *     summary: "실시간 추천 검색어 제안"
 *     description: "사용자가 입력 중인 텍스트(q)를 바탕으로 자동 완성된 검색어 목록을 반환합니다. (로그인 필수)"
 *     tags: [Search]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: "입력 중인 검색어"
 *         example: "환"
 *     responses:
 *       200:
 *         description: "추천 검색어 목록 반환"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: ["환경 보호", "환경 캠페인", "환경 집회"]
 *       401:
 *         description: "인증 실패"
 *       500:
 *         description: "검색 엔진 서버 오류"
 */
router.get('/suggest', verifyToken, searchController.getSuggestions);

module.exports = router;
