const pool = require('../../db');
const redis = require('../config/redis.client');
const { success, fail } = require('../util/response.util');
const { Client } = require('@elastic/elasticsearch');

const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });

/**
 * 1. 게시글 생성 (Create) + 정규화 매핑 + ELK 인덱싱
 */
exports.createPost = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const user_id = req.user.id;
        const { 
            participation_type, title, topics, content, 
            start_date, end_date, region, district, 
            link, images 
        } = req.body;

        // [추가된 필드] AI 검증 결과 (미들웨어 등에서 넘어온 값)
        const { aiVerified } = req.validatedData || { aiVerified: false };

        // [검증] 의제 개수 및 유효성
        const topicList = topics.split(',').map(t => t.trim()).filter(t => t !== '');
        if (topicList.length < 1 || topicList.length > 2) throw new Error("의제는 1~2개만 선택 가능합니다.");

        // (1) 의제 ID 매핑 정보 로드
        const [topicRows] = await connection.query('SELECT id, name FROM topics');
        const topicMap = {};
        topicRows.forEach(row => topicMap[row.name] = row.id);

        // (2) MySQL boards 테이블 삽입
        const isOfflineEvent = ['집회', '행사'].includes(participation_type);
        const sql = `
            INSERT INTO boards 
            (user_id, participation_type, title, topics, content, start_date, end_date, region, district, link, is_verified, ai_verified) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const [result] = await connection.query(sql, [
            user_id, participation_type, title, topics, content, start_date, end_date, 
            isOfflineEvent ? region : null, isOfflineEvent ? district : null, 
            link || null, false, aiVerified
        ]);
        const newBoardId = result.insertId;

        // (3) [정규화] board_topics 삽입 (매핑 테이블)
        const topicValues = topicList
            .map(name => topicMap[name])
            .filter(tid => tid)
            .map(tid => [newBoardId, tid]);

        if (topicValues.length > 0) {
            await connection.query('INSERT INTO board_topics (board_id, topic_id) VALUES ?', [topicValues]);
        }

        // (4) 이미지 저장
        if (images?.length > 0) {
            const imageValues = images.map(imgUrl => [newBoardId, imgUrl]);
            await connection.query(`INSERT INTO board_images (board_id, image_url) VALUES ?`, [imageValues]);
        }

        await connection.commit();

        // (5) ELK 실시간 인덱싱
        try {
            await esClient.index({
                index: 'boards',
                id: newBoardId.toString(),
                refresh: true,
                document: {
                    id: newBoardId,
                    user_id, participation_type, title, topics, content,
                    start_date: start_date ? new Date(start_date).toISOString().replace('T', ' ').substring(0, 19) : null,
                    end_date: end_date ? new Date(end_date).toISOString().replace('T', ' ').substring(0, 19) : null,
                    region: isOfflineEvent ? region : null,
                    district: isOfflineEvent ? district : null,
                    link: link || null,
                    is_verified: false, ai_verified: !!aiVerified,
                    created_at: new Date().toISOString().replace('T', ' ').substring(0, 19)
                }
            });
        } catch (esErr) { console.error('ELK Indexing Error:', esErr); }

        return success(res, { postId: newBoardId }, '게시글이 성공적으로 등록되었습니다.');
    } catch (error) {
        if (connection) await connection.rollback();
        return fail(res, error.message, 400);
    } finally {
        connection.release();
    }
};

/**
 * 2. 게시글 수정 (Update) + 매핑 갱신 + ELK 업데이트
 */
exports.updatePost = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const { id } = req.params;
        const userId = req.user.id;
        const { participation_type, title, topics, content, start_date, end_date, region, district, link, images } = req.body;

        // (1) 권한 확인 및 기존 ai_verified 값 조회
        const [board] = await connection.query('SELECT user_id, ai_verified FROM boards WHERE id = ?', [id]);
        if (board.length === 0) throw new Error('게시글을 찾을 수 없습니다.');
        if (board[0].user_id !== userId) throw new Error('수정 권한이 없습니다.');
        
        const existingAiVerified = board[0].ai_verified;

        // (2) MySQL 업데이트
        const isOfflineEvent = ['집회', '행사'].includes(participation_type);
        await connection.query(`
            UPDATE boards SET 
            participation_type = ?, title = ?, topics = ?, content = ?, start_date = ?, end_date = ?, 
            region = ?, district = ?, link = ?, updated_at = NOW()
            WHERE id = ?
        `, [participation_type, title, topics, content, start_date, end_date, isOfflineEvent ? region : null, isOfflineEvent ? district : null, link || null, id]);

        // (3) [정규화] 매핑 갱신 (Delete then Insert)
        await connection.query('DELETE FROM board_topics WHERE board_id = ?', [id]);
        const [topicRows] = await connection.query('SELECT id, name FROM topics');
        const topicMap = {};
        topicRows.forEach(row => topicMap[row.name] = row.id);

        const topicList = topics.split(',').map(t => t.trim()).filter(t => t !== '');
        const topicValues = topicList.map(name => topicMap[name]).filter(tid => tid).map(tid => [id, tid]);
        if (topicValues.length > 0) {
            await connection.query('INSERT INTO board_topics (board_id, topic_id) VALUES ?', [topicValues]);
        }

        // (4) 이미지 갱신
        await connection.query('DELETE FROM board_images WHERE board_id = ?', [id]);
        if (images?.length > 0) {
            const imageValues = images.map(imgUrl => [id, imgUrl]);
            await connection.query(`INSERT INTO board_images (board_id, image_url) VALUES ?`, [imageValues]);
        }

        await connection.commit();

        // (5) ELK 실시간 업데이트
        try {
            await esClient.update({
                index: 'boards', id: id.toString(),
                doc: { 
                    participation_type, title, topics, content, 
                    start_date: new Date(start_date).toISOString().replace('T', ' ').substring(0, 19),
                    end_date: new Date(end_date).toISOString().replace('T', ' ').substring(0, 19),
                    region: isOfflineEvent ? region : null,
                    district: isOfflineEvent ? district : null,
                    ai_verified: !!existingAiVerified, // 기존 값 유지
                    updated_at: new Date().toISOString().replace('T', ' ').substring(0, 19)
                }
            });
        } catch (esErr) { console.error('ELK Update Error:', esErr); }

        return success(res, null, '수정 완료되었습니다.');
    } catch (error) {
        if (connection) await connection.rollback();
        return fail(res, error.message, 400);
    } finally {
        connection.release();
    }
};

/**
 * 3. 게시글 삭제 (Delete) + ELK 삭제
 */
exports.deletePost = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const [board] = await connection.query('SELECT user_id FROM boards WHERE id = ?', [id]);
        if (board.length === 0) throw new Error('게시글을 찾을 수 없습니다.');
        if (board[0].user_id !== userId) throw new Error('삭제 권한이 없습니다.');

        // MySQL 삭제 (FK CASCADE 설정 필수)
        await connection.query('DELETE FROM boards WHERE id = ?', [id]);

        // ELK 삭제
        try {
            await esClient.delete({ index: 'boards', id: id.toString() });
        } catch (esErr) { console.error('ELK Delete Error:', esErr); }

        return success(res, null, '게시글이 삭제되었습니다.');
        } catch (error) {
            return fail(res, error.message, 400);
        } finally {
            connection.release();
        }
    };

/**
 * 4. 게시글 신고 (Report)
 * - 중복 신고 방지 (DB Unique Key 활용)
 * - 10자 이상 검사
 */
exports.reportPost = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const reporterId = req.user.id; 
        const { id } = req.params;
        const { reason } = req.body;

        if (!reason || reason.trim().length < 10) {
            return res.status(400).json({ success: false, message: '신고 사유를 10자 이상 입력해 주세요.' });
        }

        const sql = `INSERT INTO reports (reporter_id, board_id, reason, status) VALUES (?, ?, ?, 'RECEIVED')`;
        await connection.query(sql, [reporterId, id, reason]);

        res.status(200).json({ success: true, message: '신고가 접수되었습니다.' });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: '이미 신고하신 게시글입니다.' });
        }
        console.error('신고 에러:', error);
        res.status(500).json({ success: false, message: '일시적인 오류로 신고를 접수하지 못했습니다.' });
    } finally {
        connection.release();
    }
};

/**
 * 5. 게시글 공유 (Share)
 * - 공유 링크 생성 및 반환
 */
exports.sharePost = async (req, res) => {
    try {
        const { id } = req.params;
        // 실제 서비스 도메인으로 변경 필요
        const shareUrl = `https://yeondeung.com/boards/${id}`; 
        
        res.status(200).json({ 
            success: true, 
            message: '공유 링크가 생성되었습니다.',
            url: shareUrl 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: '공유 링크 생성 실패' });
    }
};

/**
 * 6. 응원봉 클릭 (토글: 등록/취소)
 * - 응원 미등록 시 -> 등록 (+1)
 * - 응원 등록 시 -> 취소 (-1)
 */
exports.toggleCheer = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const userId = req.user.id;
        const { id } = req.params;

        const [boardExists] = await connection.query('SELECT id FROM boards WHERE id = ?', [id]);
        if (boardExists.length === 0) {
            throw new Error('NOT_FOUND_BOARD');
        }
        
        // 1. 이미 응원했는지 확인
        const [exists] = await connection.query(
            'SELECT id FROM cheers WHERE user_id = ? AND board_id = ?',
            [userId, id]
        );

        let isCheered = false;
        if (exists.length > 0) {
            // 취소
            await connection.query('DELETE FROM cheers WHERE user_id = ? AND board_id = ?', [userId, id]);
            isCheered = false;
        } else {
            // 등록
            await connection.query('INSERT INTO cheers (user_id, board_id) VALUES (?, ?)', [userId, id]);
            isCheered = true;
        }

        // 2. 최신 개수 조회
        const [countResult] = await connection.query('SELECT COUNT(*) as count FROM cheers WHERE board_id = ?', [id]);
        
        await connection.commit();

        if (typeof redis !== 'undefined') {
            await redis.del('cache:main:realtime:global');
        }

        res.status(200).json({
            success: true,
            isCheered: isCheered,
            cheerCount: countResult[0].count,
            message: isCheered ? '응원봉을 켰습니다!' : '응원봉을 껐습니다.'
        });

    } catch (error) {
        await connection.rollback();
        console.error('응원봉 처리 에러:', error);
        res.status(500).json({ success: false, message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.' });
    } finally {
        connection.release();
    }
};

/**
 * 7. 게시글 상세 조회 (Read - Detail)
 * - 게시글 정보, 이미지, 응원 수, 내 응원 여부 포함
 */
// src/controllers/board.controller.js

exports.getBoardDetail = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;
        const currentUserId = req.user ? req.user.id : null; 

        const boardSql = `
            SELECT 
                b.id, b.user_id, b.participation_type, 
                b.title,
                b.topics,
                b.content, b.start_date, b.end_date, b.region, b.district, b.link, b.is_verified, b.ai_verified, b.created_at, b.updated_at, 
                u.email as writer_email, 
                u.user_type,
                CASE 
                    WHEN u.user_type = 'INDIVIDUAL' THEN ip.nickname
                    WHEN u.user_type = 'ORGANIZATION' THEN op.org_name
                    ELSE u.userid
                END as writer_name,
                op.introduction as writer_intro,
                op.org_name, 
                ip.nickname,
                (SELECT COUNT(*) FROM cheers c WHERE c.board_id = b.id) as cheer_count
            FROM boards b
            JOIN users u ON b.user_id = u.id
            LEFT JOIN individual_profiles ip ON u.id = ip.user_id
            LEFT JOIN organization_profiles op ON u.id = op.user_id
            WHERE b.id = ?
        `;
        
        const [boardRows] = await connection.query(boardSql, [id]);

        if (boardRows.length === 0) {
            return res.status(404).json({ success: false, message: '존재하지 않는 게시글입니다.' });
        }

        const board = boardRows[0];

        // 본인 글 여부 (수정/삭제 버튼 노출용)
        board.is_author = currentUserId === board.user_id;

        // 2. 응원 여부 확인
        let isCheered = false;
        if (currentUserId) {
            const [cheerRows] = await connection.query(
                'SELECT 1 FROM cheers WHERE user_id = ? AND board_id = ?',
                [currentUserId, id]
            );
            isCheered = cheerRows.length > 0;
        }
        
        // 3. 이미지 조회
        const imageSql = `SELECT image_url FROM board_images WHERE board_id = ?`;
        const [imageRows] = await connection.query(imageSql, [id]);

        board.images = imageRows.map(img => img.image_url);
        board.is_cheered = isCheered;

        res.status(200).json({
            success: true,
            data: board
        });

    } catch (error) {
        console.error('게시글 상세 조회 에러:', error);
        res.status(500).json({ success: false, message: '게시글 정보를 불러오지 못했습니다.' });
    } finally {
        connection.release();
    }
};