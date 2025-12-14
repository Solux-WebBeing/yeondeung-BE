const pool = require('../../db');

exports.createPost = async (req, res) => {
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const user_id = req.user.id;
        const { 
            participation_type, 
            topic, 
            content, 
            start_date, 
            end_date,
            region, 
            district, 
            link, 
            images 
        } = req.body;

        const { aiVerified } = req.validatedData || { aiVerified: false };

        // ----------------------------------------------------
        // [Controller 담당 검증] DB 조회나 비즈니스 규칙이 필요한 항목
        // ----------------------------------------------------

        // 1. 날짜 검증
        if (new Date(end_date) < new Date(start_date)) {
            throw new Error("종료 일시가 시작 일시보다 빠릅니다");
        }

        // 2. 본문 길이 검증
        const cleanContent = content ? content.replace(/\s+/g, '') : '';
        if (cleanContent.length < 50) {
            throw new Error("본문 내용은 공백 제외 50자 이상이어야 합니다.");
        }

        // 3. 의제 개수 검증
        const topicList = topic.split(',').filter(t => t.trim() !== '');
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
        if (user_type === 'personal' && ['집회', '행사'].includes(participation_type)) {
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

        // ----------------------------------------------------
        // [DB 저장]
        // ----------------------------------------------------
        
        const sql = `
            INSERT INTO boards 
            (user_id, participation_type, topic, content, start_date, end_date, region, district, link, is_verified, ai_verified) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const isVerified = false; 

        const [result] = await connection.query(sql, [
            user_id, 
            participation_type, 
            topic, 
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