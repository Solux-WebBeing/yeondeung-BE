// controllers/board.controller.js
const pool = require('../../db');

/**
 * 1. 게시글 생성 (Create)
 */
exports.createPost = async(req, res) => {
    try {
        // 로그인 기능과 연동 필요
        const { user_id, participation_type, topic, content, start_date, end_date } = req.body;
        // SQL 쿼리
        const sql = `
            INSERT INTO boards 
            (user_id, participation_type, topic, content, start_date, end_date, is_verified) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        
        const isVerified = false;   // 일단 크롤링 여부 false로 설정, 연결 필요

        // 쿼리 실행
        const [result] = await pool.query(sql, [
            user_id, 
            participation_type, 
            topic, 
            content, 
            start_date, 
            end_date,
            isVerified
          ]
        );

        res.status(201).json({
            success: true,
            message: '게시글이 성공적으로 등록되었습니다.',
            postId: result.insertId
        });
    } catch (error) {
        console.error('게시글 등록 에러: ', error);
        res.status(500).json({
            success: false,
            message: '서버 에러가 발생했습니다.',
            error: error.message
        });
    }
};