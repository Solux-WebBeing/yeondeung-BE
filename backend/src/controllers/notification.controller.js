const pool = require('../../db');
const { success, fail } = require('../util/response.util');

exports.getMyNotifications = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const userId = req.user.id;

        const sql = `
            SELECT 
                id, board_id, participation_type, title, thumbnail_url,
                DATE_FORMAT(start_date, '%Y.%m.%d') as start_date,
                DATE_FORMAT(end_date, '%Y.%m.%d') as end_date,
                region, district, message, created_at
            FROM notifications 
            WHERE user_id = ? 
            ORDER BY created_at DESC
        `;
        const [rows] = await connection.query(sql, [userId]);

        if (rows.length === 0) {
            return success(res, [], '새로운 활동 알림이 없습니다.');
        }

        return success(res, rows, '알림 조회 성공');
    } catch (error) {
        return fail(res, '알림을 불러오는데 실패했습니다.', 500);
    } finally {
        if (connection) connection.release();
    }
};

/**
 * 모든 알림 일괄 읽음 처리
 */
exports.markAllNotificationsAsRead = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        const userId = req.user.id;

        // 해당 사용자의 아직 읽지 않은(is_read = false) 알림을 모두 true로 변경
        const sql = `
            UPDATE notifications 
            SET is_read = true 
            WHERE user_id = ? AND is_read = false
        `;
        
        await connection.query(sql, [userId]);

        return success(res, null, '모든 알림이 읽음 처리되었습니다.');
    } catch (error) {
        console.error('알림 읽음 처리 에러:', error);
        return fail(res, '알림 상태를 업데이트하지 못했습니다.', 500);
    } finally {
        if (connection) connection.release();
    }
};