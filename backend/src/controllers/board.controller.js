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
 * elk update util
 */
const calculateSortFields = (endDateISO) => {
  // 상시
  if (!endDateISO) return { sort_group: 2, sort_end: 9223372036854775807 };

  const now = Date.now(); // UTC ms
  const end = new Date(endDateISO).getTime();

  // KST 오늘 범위(UTC로 환산)
  const kstNow = now + 9 * 60 * 60 * 1000;
  const d = new Date(kstNow);
  const kstTodayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0) - 9*60*60*1000;
  const kstTodayEnd = kstTodayStart + 24*60*60*1000 - 1;

  // 마감
  if (end < now) return { sort_group: 3, sort_end: end };

  // 오늘 마감
  if (end >= kstTodayStart && end <= kstTodayEnd) return { sort_group: 0, sort_end: end };

  // 미래``
  return { sort_group: 1, sort_end: end };
};




/**
 * [Helper] ImgBB 이미지 업로드 함수
 */
/*const uploadToImgBB = async (fileBuffer) => {
    try {
        const apiKey = process.env.IMGBB_API_KEY;
        if (!apiKey) throw new Error('ImgBB API Key가 설정되지 않았습니다.');

        const formData = new FormData(); 
        formData.append('image', fileBuffer.toString('base64'));

        const response = await axios.post(`https://api.imgbb.com/1/upload?key=${apiKey}`, formData, {
            headers: formData.getHeaders(),
        });

        return response.data.data.url;
    } catch (error) {
        console.error('ImgBB Upload Error:', error.response?.data || error.message);
        throw new Error('이미지 업로드 중 오류가 발생했습니다.');
    }
};*/

const uploadToImgBB = async (fileBuffer) => {
    try {
        const apiKey = process.env.IMGBB_API_KEY;
        if (!apiKey) throw new Error('ImgBB API Key가 설정되지 않았습니다.');

        const formData = new FormData();
        
        // [수정 1] Base64로 변환하지 말고 Buffer를 직접 전송 (파일명 옵션 필수)
        // 이렇게 해야 서버가 원본 파일 그대로 인식하며, 속도도 훨씬 빠릅니다.
        formData.append('image', fileBuffer, {
            filename: 'upload.jpg', // 파일명이 없으면 API가 거부할 수 있음
            contentType: 'image/jpeg' // 필요시 mime type 지정
        });

        // (선택) 180일 후 자동 삭제 등 옵션이 필요하면 추가
        // formData.append('expiration', 15552000); 

        const response = await axios.post(`https://api.imgbb.com/1/upload?key=${apiKey}`, formData, {
            headers: formData.getHeaders(),
            maxContentLength: Infinity, // 큰 이미지 업로드 시 axios 제한 해제
            maxBodyLength: Infinity
        });

        // [디버깅용 로그] 실제로 업로드된 크기가 몇인지 확인해보세요
        console.log(`Uploaded Size: ${response.data.data.width}x${response.data.data.height}`);

        // [수정 2] data.url 대신 data.image.url 사용
        // data.url도 원본을 가리키지만, data.image.url이 '원본 파일'을 더 명시적으로 가리킵니다.
        return response.data.data.image.url; 

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
        const tList = Array.isArray(topics) ? topics : topics.split(',');
        tList.forEach(t => {
            const trimmed = t.trim();
            if (trimmed.length >= 1) suggestSet.add(trimmed);
        });
    }
    return { input: Array.from(suggestSet).filter(Boolean), weight: 10 };
};

/**
 * [Helper] 날짜 포맷팅 - ISO 8601 표준 (KST 보정 적용)
 * MySQL 저장용 문자열("2026-01-24 18:00:00")이 들어오면
 * 이를 KST("2026-01-24T18:00:00+09:00")로 해석하여 정확한 ISO 표준으로 변환
 */
// MySQL "YYYY-MM-DD HH:mm:ss" 는 'KST 기준'이라고 가정
const toEsDate = (dateStr) => {
    if (!dateStr) return null;

    try {
        // 이미 Date 객체
        if (dateStr instanceof Date) {
            return dateStr.toISOString(); // UTC
        }

        // "2026-02-02 00:00:00" → KST 기준으로 해석 후 UTC 변환
        if (typeof dateStr === 'string' && dateStr.includes(' ') && !dateStr.includes('T')) {
            const kst = dateStr.replace(' ', 'T') + '+09:00'; 
            return new Date(kst).toISOString();  // 🔥 정확한 UTC
        }

        // 이미 ISO면 그대로
        return new Date(dateStr).toISOString();
    } catch (e) {
        console.error("Date Parsing Error:", e);
        return null;
    }
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
            region, district, link 
        } = req.body;

        const { aiVerified } = req.validatedData || { aiVerified: false };

        // [0] 이미지 처리
        let imageUrls = [];
        if (req.files && req.files.length > 0) {
            if (req.files.length > 2) throw new Error("사진은 최대 2장까지만 첨부할 수 있습니다.");
            imageUrls = await Promise.all(req.files.map(file => uploadToImgBB(file.buffer)));
        } else if (req.body.images) {
            const bodyImages = Array.isArray(req.body.images) ? req.body.images : [req.body.images];
            if (bodyImages.length > 2) throw new Error("사진은 최대 2장까지만 첨부할 수 있습니다.");
            imageUrls = bodyImages;
        }

        // [1] 시간 검증 및 조합 (MySQL 저장용 문자열 생성)
        if (!validateTimeFormat(start_time) || !validateTimeFormat(end_time)) {
            throw new Error("시간 형식이 올바르지 않거나 5분 단위가 아닙니다. (HH:MM)");
        }
        const is_start_time_set = !!start_time;
        const is_end_time_set = !!end_time;
        const finalStartDate = is_start_time_set 
        ? `${start_date} ${start_time}:00` 
        : `${start_date} 00:00:00`;
            const finalEndDate = is_end_time_set 
        ? `${end_date} ${end_time}:00` 
        : `${end_date} 23:59:59`; 

        // [2] 의제 유효성 검사
        const topicList = topics.split(',').map(t => t.trim()).filter(t => t !== '');
        if (topicList.length < 1 || topicList.length > 2) throw new Error("의제는 1~2개만 선택 가능합니다.");

        // [3] MySQL Insert
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

        // [4] 의제(Topics) 매핑
        const [topicRows] = await connection.query('SELECT id, name FROM topics');
        const topicMap = {};
        topicRows.forEach(row => { topicMap[row.name.trim()] = row.id; });

        const topicValues = [];
        topicList.forEach(name => {
            const topicId = topicMap[name.trim()];
            if (topicId) topicValues.push([newBoardId, topicId]);
        });

        if (topicValues.length === 0) throw new Error("유효하지 않은 의제입니다.");
        await connection.query('INSERT INTO board_topics (board_id, topic_id) VALUES ?', [topicValues]);

        // [5] 이미지 저장
        if (imageUrls.length > 0) {
            const imageValues = imageUrls.map(imgUrl => [newBoardId, imgUrl]);
            await connection.query(`INSERT INTO board_images (board_id, image_url) VALUES ?`, [imageValues]);
        }

        // [6] 알림 전송
        await sendActivityNotifications(connection, {
            id: newBoardId,
            author_id: user_id,
            participation_type, title, topics, 
            start_date: finalStartDate, end_date: finalEndDate, 
            region, district, images: imageUrls
        });

        await connection.commit();

        // 게시글 생성 or 수정 API 안
        console.log("===== DATE SAVE CHECK =====");
        console.log("MySQL raw end_date:", end_date);
        console.log("ES save end_date:", toEsDate(end_date));
        console.log("===========================");


        // [7] ELK 실시간 인덱싱 (수정된 toEsDate 사용)
        try {
            const esEndDate = toEsDate(finalEndDate);
            const { sort_group, sort_end } = calculateSortFields(esEndDate);

            await esClient.index({
                index: 'boards',
                id: newBoardId.toString(),
                refresh: true,
                document: {
                    id: newBoardId,
                    user_id,
                    host_type: req.user.user_type,
                    participation_type,
                    title,
                    topics: topicList,
                    content,

                    start_date: toEsDate(finalStartDate),
                    end_date: esEndDate,

                    is_start_time_set,
                    is_end_time_set,
                    region: isOfflineEvent ? region : null,
                    district: isOfflineEvent ? district : null,
                    link: link || null,

                    is_verified: false,
                    ai_verified: !!aiVerified,

                    suggest: buildSuggestInput(title, topics),
                    thumbnail: imageUrls.length > 0 ? imageUrls[0] : null,

                    // ✅🔥 이 두 줄이 핵심
                    sort_group,
                    sort_end,

                    created_at: new Date().toISOString()
                }
            });


            console.log(`✅ ELK Indexing Success: ID ${newBoardId}`);
        } catch (esErr) { 
            console.error('❌ ELK Indexing Error:', esErr.meta?.body?.error || esErr.message); 
        }

        return success(res, { postId: newBoardId }, '등록되었습니다.');
    } catch (error) {
        if (connection) await connection.rollback();
        const userMessages = ["하루 게시글 등록 가능 개수를 초과했습니다.", "유효하지 않은 의제입니다.", "사진은 최대 2장까지만 첨부할 수 있습니다."];
        const finalMessage = userMessages.some(msg => error.message.includes(msg)) ? error.message : "일시적인 오류로 게시글을 등록하지 못했습니다.";
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
        
        const { 
            participation_type, title, topics, content, 
            start_date, start_time, end_date, end_time, 
            region, district, link, existing_images 
        } = req.body;

        const [board] = await connection.query('SELECT user_id, ai_verified FROM boards WHERE id = ?', [id]);
        if (board.length === 0) throw new Error('게시글을 찾을 수 없습니다.');
        if (board[0].user_id !== userId) throw new Error('수정 권한이 없습니다.');
        
        const existingAiVerified = board[0].ai_verified;

        // [이미지 처리]
        let finalImageUrls = [];
        if (existing_images) {
            const keepList = Array.isArray(existing_images) ? existing_images : [existing_images];
            finalImageUrls.push(...keepList);
        }
        if (req.files && req.files.length > 0) {
            const newImageUrls = await Promise.all(req.files.map(file => uploadToImgBB(file.buffer)));
            finalImageUrls.push(...newImageUrls);
        }
        if (finalImageUrls.length > 2) throw new Error("사진은 최대 2장까지만 등록 가능합니다.");

        // [시간 조합]
        if (!validateTimeFormat(start_time) || !validateTimeFormat(end_time)) throw new Error("시간 형식이 올바르지 않습니다.");
        const is_start_time_set = !!start_time;
        const is_end_time_set = !!end_time;
        const finalStartDate = is_start_time_set 
        ? `${start_date} ${start_time}:00` 
        : `${start_date} 00:00:00`;
            const finalEndDate = is_end_time_set 
        ? `${end_date} ${end_time}:00` 
        : `${end_date} 23:59:59`; 
        
        // [MySQL Update]
        const isOfflineEvent = ['집회', '행사'].includes(participation_type);
        await connection.query(`
            UPDATE boards SET 
            participation_type = ?, title = ?, topics = ?, content = ?, 
            start_date = ?, end_date = ?, is_start_time_set = ?, is_end_time_set = ?,
            region = ?, district = ?, link = ?, updated_at = NOW()
            WHERE id = ?
        `, [participation_type, title, topics, content, finalStartDate, finalEndDate, is_start_time_set, is_end_time_set, isOfflineEvent ? region : null, isOfflineEvent ? district : null, link || null, id]);

        // [의제 매핑 갱신]
        await connection.query('DELETE FROM board_topics WHERE board_id = ?', [id]);
        const [topicRows] = await connection.query('SELECT id, name FROM topics');
        const topicMap = {};
        topicRows.forEach(row => { topicMap[row.name.trim()] = row.id; });

        const rawTopics = Array.isArray(topics) ? topics.join(',') : topics;
        const topicList = rawTopics.split(',').map(t => t.trim()).filter(Boolean);
        const topicValues = [];
        topicList.forEach(name => {
            const topicId = topicMap[name];
            if (topicId) topicValues.push([id, topicId]);
        });

        if (topicValues.length > 0) {
            await connection.query('INSERT INTO board_topics (board_id, topic_id) VALUES ?', [topicValues]);
        } else {
            throw new Error("유효한 의제를 최소 하나 이상 선택해야 수정이 가능합니다.");
        }

        // [이미지 URL 갱신]
        await connection.query('DELETE FROM board_images WHERE board_id = ?', [id]);
        if (finalImageUrls.length > 0) {
            const imageValues = finalImageUrls.map(imgUrl => [id, imgUrl]);
            await connection.query(`INSERT INTO board_images (board_id, image_url) VALUES ?`, [imageValues]);
        }

        await connection.commit();

        // 게시글 생성 or 수정 API 안
        console.log("===== DATE SAVE CHECK =====");
        console.log("MySQL raw end_date:", end_date);
        console.log("ES save end_date:", toEsDate(end_date));
        console.log("===========================");


        // [ELK Update]
        // [ELK Update]
        try {
            const boardId = id;

            const esStartDate = toEsDate(finalStartDate);
            const esEndDate   = toEsDate(finalEndDate);

            const { sort_group, sort_end } = calculateSortFields(esEndDate);

            const resp = await esClient.update({
                index: 'boards',
                id: String(boardId),
                refresh: true,
                doc_as_upsert: true,
                doc: {
                id: Number(boardId),
                user_id: userId,
                host_type: req.user.user_type,
                participation_type,
                title,
                topics: topicList,
                content,

                start_date: esStartDate,
                end_date: esEndDate,

                is_start_time_set,
                is_end_time_set,
                region: isOfflineEvent ? region : null,
                district: isOfflineEvent ? district : null,
                link: link || null,

                ai_verified: !!existingAiVerified,

                suggest: buildSuggestInput(title, topics),
                thumbnail: finalImageUrls.length > 0 ? finalImageUrls[0] : null,

                sort_group,
                sort_end,

                updated_at: new Date().toISOString()
                }
            });

            console.log('✅ ES update result:', resp.result); // updated / noop / created
            } catch (esErr) {
            console.error('❌ ELK Update Error:', esErr?.meta?.body?.error || esErr);
            }


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

        await connection.query('DELETE FROM board_images WHERE board_id = ?', [id]);
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
/**
 * 6. 응원봉 클릭 (토글)
 */
exports.toggleCheer = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const userId = req.user.id;
        const { id } = req.params;

        // [1] 게시글 존재 여부 및 작성자 ID 확인
        const [boardRows] = await connection.query('SELECT user_id FROM boards WHERE id = ?', [id]);
        if (boardRows.length === 0) throw new Error('NOT_FOUND_BOARD');
        
        const boardAuthorId = boardRows[0].user_id;

        // [추가] 본인 게시글인 경우 응원봉 클릭 차단
        if (boardAuthorId === userId) {
            await connection.rollback();
            return res.status(403).json({ 
                success: false, 
                message: '본인이 작성한 게시글에는 응원봉을 켤 수 없습니다.' 
            });
        }

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
        if (connection) await connection.rollback();
        console.error('응원봉 처리 에러:', error);
        
        if (error.message === 'NOT_FOUND_BOARD') {
            return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다.' });
        }
        
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
