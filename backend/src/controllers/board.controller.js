const pool = require('../../db');
const redis = require('../config/redis.client');
const { success, fail } = require('../util/response.util');
const { Client } = require('@elastic/elasticsearch');

const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });

/**
 * 시간 유효성 검사 함수 (24시간제, 5분 단위)
 */
const validateTimeFormat = (time) => {
    if (!time) return true;
    const regex = /^([01]\d|2[0-3]):([0-5][05])$/;
    return regex.test(time);
};

/**
 * 1. 게시글 생성 (Create)
 */
exports.createPost = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const user_id = req.user.id;
        const { 
            participation_type, title, topics, content, 
            start_date, start_time, end_date, end_time, 
            region, district, link, images 
        } = req.body;

        const { aiVerified } = req.validatedData || { aiVerified: false };

        // [1] 시간 검증 및 조합
        if (!validateTimeFormat(start_time) || !validateTimeFormat(end_time)) {
            throw new Error("시간 형식이 올바르지 않거나 5분 단위가 아닙니다. (HH:MM)");
        }

        const is_start_time_set = !!start_time;
        const is_end_time_set = !!end_time;
        const finalStartDate = is_start_time_set ? `${start_date} ${start_time}:00` : `${start_date} 00:00:00`;
        const finalEndDate = is_end_time_set ? `${end_date} ${end_time}:00` : `${end_date} 00:00:00`;

        // [2] 의제 개수 및 유효성 확인
        const topicList = topics.split(',').map(t => t.trim()).filter(t => t !== '');
        if (topicList.length < 1 || topicList.length > 2) throw new Error("의제는 1~2개만 선택 가능합니다.");

        // [3] MySQL boards 테이블 삽입
        const isOfflineEvent = ['집회', '행사'].includes(participation_type);
        const sql = `
            INSERT INTO boards 
            (user_id, participation_type, title, topics, content, start_date, end_date, is_start_time_set, is_end_time_set, region, district, link, is_verified, ai_verified) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const [result] = await connection.query(sql, [
            user_id, participation_type, title, topics, content, finalStartDate, finalEndDate, is_start_time_set, is_end_time_set,
            isOfflineEvent ? region : null, isOfflineEvent ? district : null, 
            link || null, false, aiVerified
        ]);
        const newBoardId = result.insertId;

        // [4] 의제(Topics) 정규화 매핑 저장
        const [topicRows] = await connection.query('SELECT id, name FROM topics');
        const topicMap = {};
        topicRows.forEach(row => topicMap[row.name] = row.id);

        const topicValues = topicList
            .map(name => topicMap[name])
            .filter(tid => tid)
            .map(tid => [newBoardId, tid]);

        if (topicValues.length > 0) {
            await connection.query('INSERT INTO board_topics (board_id, topic_id) VALUES ?', [topicValues]);
        }

        // [5] 이미지 URL 저장
        if (images?.length > 0) {
            const imageValues = images.map(imgUrl => [newBoardId, imgUrl]);
            await connection.query(`INSERT INTO board_images (board_id, image_url) VALUES ?`, [imageValues]);
        }

        await connection.commit();

        // [6] ELK 실시간 인덱싱
        try {
            await esClient.index({
                index: 'boards',
                id: newBoardId.toString(),
                refresh: true,
                document: {
                    id: newBoardId,
                    user_id, participation_type, title, topics, content,
                    start_date: finalStartDate,
                    end_date: finalEndDate,
                    is_start_time_set,
                    is_end_time_set,
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
 * 2. 게시글 수정 (Update)
 */
exports.updatePost = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const { id } = req.params;
        const userId = req.user.id;
        const { 
            participation_type, title, topics, content, 
            start_date, start_time, end_date, end_time, 
            region, district, link, images 
        } = req.body;

        // [1] 권한 확인 및 기존 ai_verified 값 조회
        const [board] = await connection.query('SELECT user_id, ai_verified FROM boards WHERE id = ?', [id]);
        if (board.length === 0) throw new Error('게시글을 찾을 수 없습니다.');
        if (board[0].user_id !== userId) throw new Error('수정 권한이 없습니다.');
        
        const existingAiVerified = board[0].ai_verified;

        // [2] 시간 검증 및 조합
        if (!validateTimeFormat(start_time) || !validateTimeFormat(end_time)) {
            throw new Error("시간 형식이 올바르지 않거나 5분 단위가 아닙니다. (HH:MM)");
        }
        const is_start_time_set = !!start_time;
        const is_end_time_set = !!end_time;
        const finalStartDate = is_start_time_set ? `${start_date} ${start_time}:00` : `${start_date} 00:00:00`;
        const finalEndDate = is_end_time_set ? `${end_date} ${end_time}:00` : `${end_date} 00:00:00`;

        // [3] MySQL boards 업데이트
        const isOfflineEvent = ['집회', '행사'].includes(participation_type);
        await connection.query(`
            UPDATE boards SET 
            participation_type = ?, title = ?, topics = ?, content = ?, 
            start_date = ?, end_date = ?, is_start_time_set = ?, is_end_time_set = ?,
            region = ?, district = ?, link = ?, updated_at = NOW()
            WHERE id = ?
        `, [participation_type, title, topics, content, finalStartDate, finalEndDate, is_start_time_set, is_end_time_set, isOfflineEvent ? region : null, isOfflineEvent ? district : null, link || null, id]);

        // [4] 의제(Topics) 매핑 갱신
        await connection.query('DELETE FROM board_topics WHERE board_id = ?', [id]);
        const [topicRows] = await connection.query('SELECT id, name FROM topics');
        const topicMap = {};
        topicRows.forEach(row => topicMap[row.name] = row.id);

        const topicList = topics.split(',').map(t => t.trim()).filter(t => t !== '');
        const topicValues = topicList.map(name => topicMap[name]).filter(tid => tid).map(tid => [id, tid]);
        if (topicValues.length > 0) {
            await connection.query('INSERT INTO board_topics (board_id, topic_id) VALUES ?', [topicValues]);
        }

        // [5] 이미지 URL 갱신
        await connection.query('DELETE FROM board_images WHERE board_id = ?', [id]);
        if (images?.length > 0) {
            const imageValues = images.map(imgUrl => [id, imgUrl]);
            await connection.query(`INSERT INTO board_images (board_id, image_url) VALUES ?`, [imageValues]);
        }

        await connection.commit();

        // [6] ELK 실시간 업데이트
        try {
            await esClient.update({
                index: 'boards', id: id.toString(),
                doc: { 
                    participation_type, title, topics, content, 
                    start_date: finalStartDate,
                    end_date: finalEndDate,
                    is_start_time_set,
                    is_end_time_set,
                    region: isOfflineEvent ? region : null,
                    district: isOfflineEvent ? district : null,
                    ai_verified: !!existingAiVerified,
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
 * 3. 게시글 삭제 (Delete)
 */
exports.deletePost = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const [board] = await connection.query('SELECT user_id FROM boards WHERE id = ?', [id]);
        if (board.length === 0) throw new Error('게시글을 찾을 수 없습니다.');
        if (board[0].user_id !== userId) throw new Error('삭제 권한이 없습니다.');

        await connection.query('DELETE FROM boards WHERE id = ?', [id]);

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
 */
exports.sharePost = async (req, res) => {
    try {
        const { id } = req.params;
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
 * 6. 응원봉 클릭 (토글)
 */
exports.toggleCheer = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const userId = req.user.id;
        const { id } = req.params;

        const [boardExists] = await connection.query('SELECT id FROM boards WHERE id = ?', [id]);
        if (boardExists.length === 0) throw new Error('NOT_FOUND_BOARD');
        
        const [exists] = await connection.query('SELECT id FROM cheers WHERE user_id = ? AND board_id = ?', [userId, id]);

        let isCheered = false;
        if (exists.length > 0) {
            await connection.query('DELETE FROM cheers WHERE user_id = ? AND board_id = ?', [userId, id]);
            isCheered = false;
        } else {
            await connection.query('INSERT INTO cheers (user_id, board_id) VALUES (?, ?)', [userId, id]);
            isCheered = true;
        }

        const [countResult] = await connection.query('SELECT COUNT(*) as count FROM cheers WHERE board_id = ?', [id]);
        await connection.commit();

        if (typeof redis !== 'undefined') await redis.del('cache:main:realtime:global');

        res.status(200).json({
            success: true,
            isCheered: isCheered,
            cheerCount: countResult[0].count,
            message: isCheered ? '응원봉을 켰습니다!' : '응원봉을 껐습니다.'
        });
    } catch (error) {
        await connection.rollback();
        console.error('응원봉 처리 에러:', error);
        res.status(500).json({ success: false, message: '요청을 처리하지 못했습니다.' });
    } finally {
        connection.release();
    }
};

/**
 * 7. 게시글 상세 조회 (Read)
 */
exports.getBoardDetail = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;
        const currentUserId = req.user ? req.user.id : null; 

        const boardSql = `
            SELECT 
                b.*, 
                u.email as writer_email, u.user_type,
                CASE 
                    WHEN u.user_type = 'INDIVIDUAL' THEN ip.nickname
                    WHEN u.user_type = 'ORGANIZATION' THEN op.org_name
                    ELSE u.userid
                END as writer_name,
                op.introduction as writer_intro,
                (SELECT COUNT(*) FROM cheers c WHERE c.board_id = b.id) as cheer_count
            FROM boards b
            JOIN users u ON b.user_id = u.id
            LEFT JOIN individual_profiles ip ON u.id = ip.user_id
            LEFT JOIN organization_profiles op ON u.id = op.user_id
            WHERE b.id = ?
        `;
        
        const [boardRows] = await connection.query(boardSql, [id]);
        if (boardRows.length === 0) return res.status(404).json({ success: false, message: '존재하지 않는 게시글입니다.' });

        const board = boardRows[0];
        board.is_author = currentUserId === board.user_id;

        let isCheered = false;
        if (currentUserId) {
            const [cheerRows] = await connection.query('SELECT 1 FROM cheers WHERE user_id = ? AND board_id = ?', [currentUserId, id]);
            isCheered = cheerRows.length > 0;
        }
        
        const [imageRows] = await connection.query(`SELECT image_url FROM board_images WHERE board_id = ?`, [id]);
        board.images = imageRows.map(img => img.image_url);
        board.is_cheered = isCheered;

        res.status(200).json({ success: true, data: board });
    } catch (error) {
        console.error('상세 조회 에러:', error);
        res.status(500).json({ success: false, message: '정보를 불러오지 못했습니다.' });
    } finally {
        connection.release();
    }
};