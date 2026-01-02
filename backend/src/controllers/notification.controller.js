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