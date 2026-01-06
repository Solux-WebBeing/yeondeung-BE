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
 *       - **지역 필터**: `region`은 단일 시/도, `district`는 쉼표로 구분된 여러 구를 입력하면 OR 결과를 반환합니다.
 *       - **기타 필터**: `topics`, `participation_type`, `host_type`은 쉼표로 다중 선택(OR) 가능합니다.
 *       - **인증**: 비로그인 접근 가능하며, 로그인 시 응원 여부(is_cheered) 등이 포함됩니다.
 *     tags:
 *       - Search
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: 검색 키워드 (제목, 본문, 의제 대상)
 *       - in: query
 *         name: topics
 *         schema:
 *           type: string
 *         description: 의제 필터 (쉼표로 구분, 예: 복지,인권)
 *       - in: query
 *         name: region
 *         schema:
 *           type: string
 *         description: 시/도 지역 필터 (단일 선택, 예: 서울특별시)
 *       - in: query
 *         name: district
 *         schema:
 *           type: string
 *         description: 상세 구/군 필터 (쉼표 구분 OR 검색, 예: 용산구,강서구)
 *       - in: query
 *         name: participation_type
 *         schema:
 *           type: string
 *         description: 참여 방식 필터 (쉼표 구분, 예: 오프라인,온라인)
 *       - in: query
 *         name: host_type
 *         schema:
 *           type: string
 *         description: 주최 대상 필터 (쉼표 구분, 예: 개인,단체)
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date
 *         description: 조회 범위 시작일 (YYYY-MM-DD)
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date
 *         description: 조회 범위 종료일 (YYYY-MM-DD)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: 페이지 번호 (한 페이지당 8개)
 *     responses:
 *       200:
 *         description: 검색 성공
 *       500:
 *         description: 검색 엔진 또는 서버 오류
 */
router.get('/', verifyTokenOptional, searchController.searchPosts);

/**
 * @swagger
 * /api/search/all:
 *   get:
 *     summary: 전체 게시글 조회 (ELK)
 *     description: >
 *       필터 없이 모든 게시글을 조회합니다.
 *       진행 중인 글이 우선 노출되며 마감 임박 순으로 정렬됩니다. (비로그인 허용)
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
 *     responses:
 *       200:
 *         description: 조회 성공
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
 *       500:
 *         description: 서버 오류
 */
router.get('/all', verifyTokenOptional, searchController.getAllPosts);

/**
 * @swagger
 * /api/search/suggest:
 *   get:
 *     summary: 실시간 추천 검색어 제안
 *     description: >
 *       사용자가 입력 중인 텍스트(q)를 기반으로
 *       Elasticsearch Completion Suggester 결과를 반환합니다. (비로그인 허용)
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
 *         example: 환경
 *     responses:
 *       200:
 *         description: 추천 검색어 목록 반환
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
 */
router.get('/suggest', verifyTokenOptional, searchController.getSuggestions);

module.exports = router;
