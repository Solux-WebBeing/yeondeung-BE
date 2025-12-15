// controllers/board.controller.js
const pool = require('../../db');
const { success, fail } = require('../util/response.util');

/**
 * 1. 게시글 생성 (Create)
 */
exports.createPost = async(req, res) => {
    try {
        // 로그인 기능과 연동 필요
        const { user_id, participation_type, topic, content, start_date, end_date, link } = req.body;

        const { aiVerified } = req.validatedData || {};

        // SQL 쿼리
        const sql = `
            INSERT INTO boards
            (user_id, participation_type, topic, content, start_date, end_date, link, ai_verified)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const isVerified = false;   // 관리자 검증

        const aiVerifiedBool = aiVerified || false; // AI 겸증

        // 쿼리 실행
        const [result] = await pool.query(sql, [
            user_id,
            participation_type,
            topic,
            content,
            start_date,
            end_date,
            link,
            aiVerifiedBool
          ]
        );

        return success(res, '게시글이 성공적으로 등록되었습니다.', {
            postId: result.insertId,
        }, 201);
    } catch (error) {
        console.error('게시글 등록 에러: ', error);
        return fail(res, '서버 에러가 발생했습니다.', 500, error.message);
    }
};