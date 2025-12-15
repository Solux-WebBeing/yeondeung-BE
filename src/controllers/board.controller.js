const pool = require('../../db');
const { success, fail } = require('../util/response.util');

/* 
* 1.게시글 생성 (Create)
*/
exports.createPost = async (req, res) => {
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const user_id = req.user.id;
        const { 
            participation_type, 
            title,
            topics, 
            content, 
            start_date, 
            end_date,
            region, 
            district, 
            link, 
            images 
        } = req.body;

        const { aiVerified } = req.validatedData || { aiVerified: false };

        // 1. 날짜 검증
        if (new Date(end_date) < new Date(start_date)) {
            throw new Error("종료 일시가 시작 일시보다 빠릅니다");
        }

        // 2. 제목, 본문 길이 검증
        if (!title || title.trim().length < 2) {
            throw new Error("제목을 2자 이상 입력해주세요.");
        }

        const cleanContent = content ? content.replace(/\s+/g, '') : '';
        if (cleanContent.length < 50) {
            throw new Error("본문 내용은 공백 제외 50자 이상이어야 합니다.");
        }

        // 3. 의제 개수 검증
        const topicList = topics.split(',').filter(t => t.trim() !== '');
        if (topicList.length < 1 || topicList.length > 2) {
            throw new Error("의제는 최대 2개까지 선택할 수 있어요.");
        }

        // 4. 사용자 권한 및 제한 확인
        const [userInfo] = await connection.query(
            `SELECT 
                u.user_type,
                (SELECT COUNT(*) FROM boards b WHERE b.user_id = u.id AND DATE(b.created_at) = CURDATE()) as daily_count
             FROM users u 
             WHERE u.id = ?`, 
            [user_id]
        );

        if (!userInfo || userInfo.length === 0) throw new Error("사용자 정보를 찾을 수 없습니다.");
        const { user_type, daily_count } = userInfo[0];

        // 하루 제한 체크
        if (daily_count >= 2) throw new Error("하루 게시글 등록 가능 개수를 초과했습니다.");

        // 개인 회원 권한 체크
        if (user_type === 'INDIVIDUAL' && ['집회', '행사'].includes(participation_type)) {
            throw new Error("개인 회원은 집회/행사 게시글을 등록할 수 없습니다.");
        }

        // 5. 조건부 필수값 체크
        const isOfflineEvent = ['집회', '행사'].includes(participation_type);
        if (isOfflineEvent && (!region || !district)) {
            throw new Error("진행 장소(시/도, 시/군/구)가 누락되었습니다.");
        }

        // 6. URL 중복 검사
        if (link) {
             const [dupCheck] = await connection.query('SELECT id FROM boards WHERE link = ?', [link]);
             if (dupCheck.length > 0) throw new Error("이미 등록된 활동이에요!");
        }

        const sql = `
            INSERT INTO boards 
            (user_id, participation_type, title, topics, content, start_date, end_date, region, district, link, is_verified, ai_verified) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const isVerified = false; 

        const [result] = await connection.query(sql, [
            user_id, 
            participation_type, 
            title,
            topics, 
            content, 
            start_date, 
            end_date,
            isOfflineEvent ? region : null,
            isOfflineEvent ? district : null,
            link || null,
            isVerified,
            aiVerified
        ]);
        
        const newBoardId = result.insertId;

        // 이미지 저장
        if (images && Array.isArray(images) && images.length > 0) {
            const imageValues = images.map(imgUrl => [newBoardId, imgUrl]);
            await connection.query(
                `INSERT INTO board_images (board_id, image_url) VALUES ?`,
                [imageValues]
            );
        }

        await connection.commit();

        res.status(201).json({
            success: true,
            message: '게시글이 성공적으로 등록되었습니다.',
            postId: newBoardId
        });

    } catch (error) {
        await connection.rollback();
        console.error('게시글 등록 에러: ', error);
        
        res.status(400).json({
            success: false,
            message: error.message || '게시글 등록 중 오류가 발생했습니다.'
        });
    } finally {
        connection.release();
    }
};

/**
 * 2. 게시글 수정 (Update)
 * - 작성자 본인만 가능
 * - 이미지 수정 시 기존 이미지 삭제 후 재등록 (간편 구현)
 */
exports.updatePost = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { id } = req.params; // boardId
        const userId = req.user.id;
        const { 
            participation_type, title, topics, content, start_date, end_date, 
            region, district, link, images 
        } = req.body;

        // 1. 게시글 존재 여부 및 작성자 권한 확인
        const [board] = await connection.query('SELECT user_id FROM boards WHERE id = ?', [id]);
        
        if (board.length === 0) {
            throw new Error('게시글을 찾을 수 없습니다.');
        }
        if (board[0].user_id !== userId) {
            throw new Error('게시글을 수정할 권한이 없습니다.');
        }

        // 2. 유효성 검사
        const cleanContent = content ? content.replace(/\s+/g, '') : '';
        if (cleanContent.length < 50) {
            throw new Error("본문 내용은 공백 제외 50자 이상이어야 합니다.");
        }

        // 3. 게시글 업데이트
        const updateSql = `
            UPDATE boards 
            SET participation_type = ?, title = ?, topics = ?, content = ?, start_date = ?, end_date = ?, 
                region = ?, district = ?, link = ?
            WHERE id = ?
        `;
        
        const isOfflineEvent = ['집회', '행사'].includes(participation_type);
        const isOnlineAction = ['서명', '청원', '탄원'].includes(participation_type);

        await connection.query(updateSql, [
            participation_type, title, topics, content, start_date, end_date,
            isOfflineEvent ? region : null,
            isOfflineEvent ? district : null,
            isOnlineAction ? link : null,
            id
        ]);

        // 4. 이미지 업데이트 (기존 이미지 삭제 -> 새 이미지 삽입 전략)
        if (images && Array.isArray(images)) {
            // 기존 이미지 삭제
            await connection.query('DELETE FROM board_images WHERE board_id = ?', [id]);

            // 새 이미지 삽입
            if (images.length > 0) {
                const imageValues = images.map(imgUrl => [id, imgUrl]);
                await connection.query(
                    `INSERT INTO board_images (board_id, image_url) VALUES ?`,
                    [imageValues]
                );
            }
        }

        await connection.commit();
        
        // 성공 응답
        res.status(200).json({ success: true, message: '게시글이 수정되었습니다.' });

    } catch (error) {
        await connection.rollback();
        console.error('게시글 수정 에러:', error);
        res.status(400).json({ success: false, message: error.message || '게시글 수정 실패' });
    } finally {
        connection.release();
    }
};

/**
 * 3. 게시글 삭제 (Delete)
 * - 작성자 본인만 가능
 * - ON DELETE CASCADE 설정이 되어 있다면 board_images는 자동 삭제됨
 */
exports.deletePost = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // 1. 권한 확인
        const [board] = await connection.query('SELECT user_id FROM boards WHERE id = ?', [id]);
        if (board.length === 0) throw new Error('게시글을 찾을 수 없습니다.');
        if (board[0].user_id !== userId) throw new Error('게시글을 삭제할 권한이 없습니다.');

        // 2. 삭제 실행
        await connection.query('DELETE FROM boards WHERE id = ?', [id]);

        res.status(200).json({ success: true, message: '게시글이 삭제되었습니다.' });

    } catch (error) {
        console.error('게시글 삭제 에러:', error);
        res.status(400).json({ success: false, message: '일시적인 오류로 삭제하지 못했습니다. 다시 시도해주세요.' });
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