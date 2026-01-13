const pool = require('../../db');
const redis = require('../config/redis.client');
const { success, fail } = require('../util/response.util');
const { Client } = require('@elastic/elasticsearch');
const { sendActivityNotifications } = require('../util/notification.util');
const axios = require('axios');
const FormData = require('form-data');

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
 * [Helper] ImgBB 이미지 업로드 함수
 */
const uploadToImgBB = async (fileBuffer) => {
    try {
        const apiKey = process.env.IMGBB_API_KEY;
        if (!apiKey) throw new Error('ImgBB API Key가 설정되지 않았습니다.');

        const formData = new FormData(); 
        formData.append('image', fileBuffer.toString('base64'));

        const response = await axios.post(`https://api.imgbb.com/1/upload?key=${apiKey}`, formData, {
            headers: formData.getHeaders(), // 'form-data' 패키지 객체에서 호출
        });

        return response.data.data.url;
    } catch (error) {
        console.error('ImgBB Upload Error:', error.response?.data || error.message);
        throw new Error('이미지 업로드 중 오류가 발생했습니다.');
    }
};

/**
 * [Helper] ELK 추천 검색어(suggest) 데이터 생성 함수
 */
const buildSuggestInput = (title, topics) => {
    const suggestSet = new Set();
    if (title) {
        const cleanTitle = title.replace(/[^\w\sㄱ-ㅎ가-힣]/g, ' ');
        const words = cleanTitle.split(/\s+/).filter(w => w.length >= 2);
        words.forEach(word => suggestSet.add(word));
        for (let i = 0; i < words.length - 1; i++) {
            suggestSet.add(`${words[i]} ${words[i + 1]}`);
        }
        suggestSet.add(title.trim());
    }
    if (topics) {
        // topics가 배열일 수도, 문자열일 수도 있으므로 방어적 처리
        const tList = Array.isArray(topics) ? topics : topics.split(',');
        tList.forEach(t => {
            const trimmed = t.trim();
            if (trimmed.length >= 1) suggestSet.add(trimmed);
        });
    }
    return { input: Array.from(suggestSet).filter(Boolean), weight: 10 };
};

// 날짜 포맷 강제 변환 함수 (yyyy-MM-dd HH:mm:ss)
const toEsDate = (dateStr) => {
    if (!dateStr) return null;
    try {
        const d = new Date(dateStr);
        return d.toISOString().replace('T', ' ').substring(0, 19);
    } catch (e) { return null; }
};

/**
 * 1. 게시글 생성 (Create)
 */
exports.createPost = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const user_id = req.user.id;

        // 하루 게시글 2개 초과 검사
        const [countRows] = await connection.query(
            'SELECT COUNT(*) as count FROM boards WHERE user_id = ? AND DATE(created_at) = CURDATE()',
            [user_id]
        );
        if (countRows[0].count >= 2) {
            throw new Error("하루 게시글 등록 가능 개수를 초과했습니다."); //
        }

        const { 
            participation_type, title, topics, content, 
            start_date, start_time, end_date, end_time, 
            region, district, link 
            // images는 req.body가 아니라 req.files에서 처리
        } = req.body;

        const { aiVerified } = req.validatedData || { aiVerified: false };

        // [0] 이미지 처리 (ImgBB) - 최대 2개 제한
        let imageUrls = [];
        
        // Multer를 통해 파일이 업로드된 경우 (req.files)
        if (req.files && req.files.length > 0) {
            if (req.files.length > 2) {
                throw new Error("사진은 최대 2장까지만 첨부할 수 있습니다.");
            }
            // 병렬로 이미지 업로드 진행
            imageUrls = await Promise.all(req.files.map(file => uploadToImgBB(file.buffer)));
        } 
        // 기존처럼 URL 문자열 배열로 들어온 경우 (req.body.images) 호환성 유지
        else if (req.body.images) {
            const bodyImages = Array.isArray(req.body.images) ? req.body.images : [req.body.images];
            if (bodyImages.length > 2) throw new Error("사진은 최대 2장까지만 첨부할 수 있습니다.");
            imageUrls = bodyImages;
        }

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

        // 입력된 의제 중 실제 DB에 존재하는 것들만 필터링
        const validTopicValues = topicList
        .map(name => topicMap[name])
        .filter(tid => tid);

        // 만약 입력된 의제 중 DB에 등록된 것이 하나도 없다면 에러 반환
        if (validTopicValues.length === 0) {
            throw new Error("유효하지 않은 의제입니다. 등록된 의제 중에서 선택해주세요.");
        }

        const topicValues = topicList
            .map(name => topicMap[name])
            .filter(tid => tid)
            .map(tid => [newBoardId, tid]);

        if (topicValues.length > 0) {
            await connection.query('INSERT INTO board_topics (board_id, topic_id) VALUES ?', [topicValues]);
        }

        // [5] 이미지 URL 저장 (ImgBB에서 받은 URL 사용)
        if (imageUrls.length > 0) {
            const imageValues = imageUrls.map(imgUrl => [newBoardId, imgUrl]);
            await connection.query(`INSERT INTO board_images (board_id, image_url) VALUES ?`, [imageValues]);
        }

        // [6] 알림 전송 로직 호출
        await sendActivityNotifications(connection, {
            id: newBoardId,
            author_id: user_id,
            participation_type, 
            title, 
            topics, 
            start_date: finalStartDate, 
            end_date: finalEndDate, 
            region, 
            district,
            images: imageUrls
        });

        await connection.commit();

        // [6] ELK 실시간 인덱싱 (수정본)
        try {
            await esClient.index({
                index: 'boards',
                id: newBoardId.toString(),
                refresh: true,
                document: {
                    id: newBoardId,
                    user_id, 
                    host_type: req.user.user_type, // [추가] 필터링을 위해 반드시 필요
                    participation_type, 
                    title, 
                    topics: topicList, 
                    content,
                    start_date: toEsDate(finalStartDate),
                    end_date: toEsDate(finalEndDate),
                    is_start_time_set,
                    is_end_time_set,
                    region: isOfflineEvent ? region : null,
                    district: isOfflineEvent ? district : null,
                    link: link || null,
                    is_verified: false,
                    ai_verified: !!aiVerified,
                    suggest: buildSuggestInput(title, topics),
                    // [추가] 검색 결과 썸네일을 위해 첫 번째 이미지 URL 저장
                    thumbnail: imageUrls.length > 0 ? imageUrls[0] : null,
                    created_at: toEsDate(new Date())
                }
            });
            console.log(`✅ ELK Indexing Success: ID ${newBoardId}`);
        } catch (esErr) { 
            console.error('❌ ELK Indexing Error 상세:', esErr.meta?.body?.error || esErr.message); 
        }

        return success(res, { postId: newBoardId }, '등록되었습니다.');
    } catch (error) {
        if (connection) await connection.rollback();
        // 예외 문구 처리
        const userMessages = [
            "하루 게시글 등록 가능 개수를 초과했습니다.",
            "유효하지 않은 의제입니다. 등록된 의제 중에서 선택해주세요."
        ];

        // 직접 정의한 에러 메시지가 아니면 서버 오류 메시지로 대체
        const finalMessage = userMessages.includes(error.message) 
            ? error.message 
            : "일시적인 오류로 게시글을 등록하지 못했습니다. 잠시 후 다시 시도해주세요.";
        return fail(res, finalMessage, 400);
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
        
        // existing_images: 클라이언트가 "삭제하지 않고 남겨둔" 기존 이미지 URL 리스트
        // req.files: 클라이언트가 "새로 추가한" 이미지 파일 리스트
        const { 
            participation_type, title, topics, content, 
            start_date, start_time, end_date, end_time, 
            region, district, link, existing_images 
        } = req.body;

        // [1] 권한 확인 및 기존 ai_verified 값 조회
        const [board] = await connection.query('SELECT user_id, ai_verified FROM boards WHERE id = ?', [id]);
        if (board.length === 0) throw new Error('게시글을 찾을 수 없습니다.');
        if (board[0].user_id !== userId) throw new Error('수정 권한이 없습니다.');
        
        const existingAiVerified = board[0].ai_verified;

        // [2] 이미지 처리 (기존 유지 + 신규 업로드)
        let finalImageUrls = [];

        // 2-1. 기존 유지할 이미지 처리
        if (existing_images) {
            const keepList = Array.isArray(existing_images) ? existing_images : [existing_images];
            finalImageUrls.push(...keepList);
        }

        // 2-2. 신규 이미지 업로드 (ImgBB)
        if (req.files && req.files.length > 0) {
            const newImageUrls = await Promise.all(req.files.map(file => uploadToImgBB(file.buffer)));
            finalImageUrls.push(...newImageUrls);
        }

        // 2-3. 개수 제한 검사 (최대 2개)
        if (finalImageUrls.length > 2) {
            throw new Error("사진은 최대 2장까지만 등록 가능합니다 (기존 포함).");
        }

        // [3] 시간 검증 및 조합
        if (!validateTimeFormat(start_time) || !validateTimeFormat(end_time)) {
            throw new Error("시간 형식이 올바르지 않거나 5분 단위가 아닙니다. (HH:MM)");
        }
        const is_start_time_set = !!start_time;
        const is_end_time_set = !!end_time;
        const finalStartDate = is_start_time_set ? `${start_date} ${start_time}:00` : `${start_date} 00:00:00`;
        const finalEndDate = is_end_time_set ? `${end_date} ${end_time}:00` : `${end_date} 00:00:00`;

        // [4] MySQL boards 업데이트
        const isOfflineEvent = ['집회', '행사'].includes(participation_type);
        await connection.query(`
            UPDATE boards SET 
            participation_type = ?, title = ?, topics = ?, content = ?, 
            start_date = ?, end_date = ?, is_start_time_set = ?, is_end_time_set = ?,
            region = ?, district = ?, link = ?, updated_at = NOW()
            WHERE id = ?
        `, [participation_type, title, topics, content, finalStartDate, finalEndDate, is_start_time_set, is_end_time_set, isOfflineEvent ? region : null, isOfflineEvent ? district : null, link || null, id]);

        // [5] 의제(Topics) 매핑 갱신
        await connection.query('DELETE FROM board_topics WHERE board_id = ?', [id]);
        const [topicRows] = await connection.query('SELECT id, name FROM topics');
        const topicMap = {};
        topicRows.forEach(row => topicMap[row.name] = row.id);

        const topicList = topics.split(',').map(t => t.trim()).filter(t => t !== '');
        const topicValues = topicList.map(name => topicMap[name]).filter(tid => tid).map(tid => [id, tid]);
        if (topicValues.length > 0) {
            await connection.query('INSERT INTO board_topics (board_id, topic_id) VALUES ?', [topicValues]);
        }

        // [6] 이미지 URL 갱신 (기존 것 다 지우고 최종 리스트로 다시 삽입)
        await connection.query('DELETE FROM board_images WHERE board_id = ?', [id]);
        if (finalImageUrls.length > 0) {
            const imageValues = finalImageUrls.map(imgUrl => [id, imgUrl]);
            await connection.query(`INSERT INTO board_images (board_id, image_url) VALUES ?`, [imageValues]);
        }

        await connection.commit();

        // [7] ELK 실시간 업데이트
        try {
            await esClient.update({
                index: 'boards', 
                id: id.toString(),
                refresh: true,
                doc: { 
                    participation_type, title, topics: topicList, content, 
                    start_date: toEsDate(finalStartDate),
                    end_date: toEsDate(finalEndDate),
                    is_start_time_set,
                    is_end_time_set,
                    region: isOfflineEvent ? region : null,
                    district: isOfflineEvent ? district : null,
                    ai_verified: !!existingAiVerified,
                    suggest: buildSuggestInput(title, topics),
                    // [추가] 수정된 이미지 중 첫 번째를 썸네일로 반영
                    thumbnail: finalImageUrls.length > 0 ? finalImageUrls[0] : null,
                    updated_at: toEsDate(new Date())
                }
            });
        } catch (esErr) { console.error('ELK Update Error:', esErr); }
            return success(res, { imageUrls: finalImageUrls }, '수정 완료되었습니다.');
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

        // [중요] DB FK 설정(ON DELETE CASCADE)이 없다면 이미지 테이블을 먼저 지워야 안전함
        await connection.query('DELETE FROM board_images WHERE board_id = ?', [id]);
        await connection.query('DELETE FROM boards WHERE id = ?', [id]);

        // 참고: ImgBB API를 통해 이미지를 삭제하려면 업로드 시 받은 delete_url이 필요함.
        // 현재 로직상 delete_url을 저장하지 않으므로 ImgBB 서버에는 이미지가 남음.

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
        const { id } = req.params; // 신고할 게시글 ID
        const { reason } = req.body;

        if (!reason || reason.trim().length < 10) {
            return res.status(400).json({ success: false, message: '신고 사유를 10자 이상 입력해 주세요.' });
        }

        // 1. 게시글이 실제로 존재하는지 먼저 확인
        const [boardExists] = await connection.query('SELECT id FROM boards WHERE id = ?', [id]);
        
        if (boardExists.length === 0) {
            // 게시글이 없으면 DB 에러를 내지 않고 404 응답을 보냄
            return res.status(404).json({ success: false, message: '존재하지 않거나 삭제된 게시글은 신고할 수 없습니다.' });
        }

        // 2. 게시글이 존재할 때만 신고 데이터 삽입
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
        if (boardRows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                code: 'BOARD_DELETED',
                message: '삭제된 게시글입니다.' 
            });
        }

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