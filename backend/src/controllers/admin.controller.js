const pool = require('../../db');
const { success, fail } = require('../util/response.util.js');
const emailService = require('../util/email.service.js');
const { Client } = require('@elastic/elasticsearch');
const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });

/**
 * 1. (관리자) 승인 대기 중인 단체 회원 목록 조회
 */
exports.getPendingOrganizations = async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const sql = `
      SELECT u.id, u.email, u.userid, u.created_at, op.org_name, op.contact_number
      FROM users u
      JOIN organization_profiles op ON u.id = op.user_id
      WHERE u.user_type = 'ORGANIZATION' AND u.approval_status = 'PENDING'
    `;
    const [rows] = await connection.query(sql);
    return success(res, '승인 대기 목록 조회 성공', rows);
  } catch (error) {
    console.error('Server Error:', error);
    return fail(res, '서버 에러가 발생했습니다.', 500);
  } finally {
    if (connection) connection.release();
  }
};

/**
 * 2. (관리자) 단체 회원 승인
 */
exports.approveOrganization = async (req, res) => {
  let connection;
  try {
    const { userId } = req.body;
    if (!userId) {
      return fail(res, '사용자 ID가 필요합니다.', 400);
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. 유저 상태 'APPROVED'로 변경
    const updateSql = "UPDATE users SET approval_status = 'APPROVED' WHERE id = ? AND approval_status = 'PENDING'";
    const [updateResult] = await connection.query(updateSql, [userId]);

    if (updateResult.affectedRows === 0) {
      await connection.rollback();
      return fail(res, '사용자를 찾을 수 없거나 이미 처리된 요청입니다.', 404);
    }

    // 2. 승인된 사용자 정보(이메일, 단체명) 조회
    const userSql = `
      SELECT u.email, op.org_name 
      FROM users u
      JOIN organization_profiles op ON u.id = op.user_id
      WHERE u.id = ?
    `;
    const [userRows] = await connection.query(userSql, [userId]);
    if (userRows.length === 0) {
      await connection.rollback();
      return fail(res, '프로필 정보를 찾는 데 실패했습니다.', 404);
    }
    const { email, org_name } = userRows[0];

    // 3. 승인 이메일 발송
    await emailService.sendApprovalEmail(email, org_name);

    await connection.commit();
    return success(res, `'${org_name}'의 가입을 승인했습니다.`);

  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Server Error:', error);
    return fail(res, '서버 에러가 발생했습니다.', 500);
  } finally {
    if (connection) connection.release();
  }
};

/**
 * 3. (관리자) 단체 회원 거절 (수정: 'DELETE' 로직 적용)
 * '거절'은 가입 신청 기록을 완전히 삭제하여, 해당 이메일로 재가입이 가능하도록 합니다.
 */
exports.rejectOrganization = async (req, res) => {
  let connection;
  try {
    const { userId, rejectionReason } = req.body;

    if (!userId || !rejectionReason) {
      return fail(res, '사용자 ID와 거절 사유가 필요합니다.', 400);
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. 거절할 사용자 정보(이메일, 단체명) 조회 (삭제 전에 먼저 조회해야 함)
    const userSql = `
      SELECT u.email, op.org_name 
      FROM users u
      JOIN organization_profiles op ON u.id = op.user_id
      WHERE u.id = ? AND u.approval_status = 'PENDING'
    `;
    const [userRows] = await connection.query(userSql, [userId]);
    
    if (userRows.length === 0) {
      await connection.rollback();
      return fail(res, '사용자를 찾을 수 없거나 이미 처리된 요청입니다.', 404);
    }
    const { email, org_name } = userRows[0];

    // 2. (수정) 'users' 테이블에서 레코드 삭제 (ON DELETE CASCADE로 profiles도 자동 삭제됨)
    const deleteUserSql = "DELETE FROM users WHERE id = ?";
    const [deleteResult] = await connection.query(deleteUserSql, [userId]);

    if (deleteResult.affectedRows === 0) {
      // (조회 후 삭제 사이에 누군가 처리한 경우)
      await connection.rollback();
      return fail(res, '사용자 삭제에 실패했습니다. (이미 처리된 요청)', 404);
    }

    // 3. 'email_verifications' 테이블에서도 인증 기록 삭제 (선택 사항이지만 권장)
    // (이메일 인증을 다시 받도록 하기 위함)
    const deleteVerifySql = "DELETE FROM email_verifications WHERE email = ?";
    await connection.query(deleteVerifySql, [email]);

    // 4. 거절 이메일 발송 (사유 포함)
    await emailService.sendRejectionEmail(email, org_name, rejectionReason);

    await connection.commit();
    return success(res, `'${org_name}'의 가입을 거절(삭제)했습니다.`);

  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Server Error:', error);
    return fail(res, '서버 에러가 발생했습니다.', 500);
  } finally {
    if (connection) connection.release();
  }
};

/**
 * 4. (관리자) 신고된 게시글 목록 조회
 * - 처리 대기 중(RECEIVED)인 신고와 해당 게시글 정보를 함께 가져옵니다.
 */
exports.getReportedPosts = async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        
        // 신고 정보 + 게시글 제목 + 작성자 이메일을 조인해서 가져옵니다.
        const sql = `
            SELECT 
                r.id AS report_id, 
                r.reason AS report_reason, 
                r.created_at AS reported_at,
                b.id AS board_id, 
                b.title AS board_title, 
                u.email AS author_email
            FROM reports r
            JOIN boards b ON r.board_id = b.id
            JOIN users u ON b.user_id = u.id
            WHERE r.status = 'RECEIVED'
            ORDER BY r.created_at DESC
        `;
        
        const [rows] = await connection.query(sql);
        return success(res, '신고된 게시글 목록 조회 성공', rows);
    } catch (error) {
        console.error('Admin Get Reports Error:', error);
        return fail(res, '서버 에러가 발생했습니다.', 500);
    } finally {
        if (connection) connection.release();
    }
};

/**
 * 5. (관리자) 신고 게시글 강제 삭제
 * - MySQL: 게시글 삭제 (CASCADE로 인해 관련 데이터 자동 삭제)
 * - MySQL: 신고 상태 RESOLVED 변경 및 사유 저장
 * - ELK: 검색 인덱스에서 즉시 삭제
 */
exports.deleteReportedPost = async (req, res) => {
    let connection;
    const { reportId, boardId, adminReason } = req.body;

    if (!reportId || !boardId || !adminReason) {
        return fail(res, '신고 ID, 게시글 ID, 삭제 사유가 필요합니다.', 400);
    }

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. MySQL 게시글 삭제 
        // 테이블에 설정된 ON DELETE CASCADE 덕분에 이미지, 의제 매핑, 응원봉 데이터가 자동으로 함께 삭제됩니다.
        const [deleteResult] = await connection.query("DELETE FROM boards WHERE id = ?", [boardId]);

        if (deleteResult.affectedRows === 0) {
            await connection.rollback();
            return fail(res, '삭제할 게시글을 찾을 수 없거나 이미 삭제되었습니다.', 404);
        }

        // 2. 신고 상태 업데이트 및 사유(admin_comment) 기록
        // 추후 SSE 알림 구현 시 이 admin_comment를 불러와서 사용자에게 알림을 보낼 수 있습니다.
        const updateReportSql = `
            UPDATE reports 
            SET status = 'RESOLVED', admin_comment = ? 
            WHERE id = ?
        `;
        await connection.query(updateReportSql, [adminReason, reportId]);

        // 3. 트랜잭션 커밋
        await connection.commit();

        // 4. ELK 실시간 인덱스 삭제
        // 검색 결과에서 즉시 사라지게 처리합니다.
        try {
            await esClient.delete({
                index: 'boards',
                id: boardId.toString(),
                refresh: true
            });
            console.log(`[Admin] ELK Delete Success: Post ID ${boardId}`);
        } catch (esError) {
            // ELK 삭제 실패가 DB 트랜잭션 전체를 취소하지는 않도록 로그만 기록합니다.
            console.error('[Admin] ELK Delete Error:', esError);
        }

        return success(res, '게시글이 강제 삭제되었으며 신고 처리가 완료되었습니다.');

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Admin Delete Post Error:', error);
        return fail(res, '게시글 삭제 처리 중 서버 에러가 발생했습니다.', 500);
    } finally {
        if (connection) connection.release();
    }
};

/**
 * 6. (관리자) 신고 기각 처리
 * - 게시글은 그대로 유지하고, 신고 내역의 상태만 'REJECTED'로 변경합니다.
 * - 관리자의 기각 사유(admin_comment)를 기록합니다.
 */
exports.rejectReport = async (req, res) => {
    let connection;
    const { reportId, adminReason } = req.body;

    if (!reportId || !adminReason) {
        return fail(res, '신고 ID와 기각 사유가 필요합니다.', 400);
    }

    try {
        connection = await pool.getConnection();
        
        const sql = `
            UPDATE reports 
            SET status = 'REJECTED', admin_comment = ? 
            WHERE id = ? AND status = 'RECEIVED'
        `;
        
        const [result] = await connection.query(sql, [adminReason, reportId]);

        if (result.affectedRows === 0) {
            return fail(res, '신고 내역을 찾을 수 없거나 이미 처리된 신고입니다.', 404);
        }

        return success(res, null, '신고를 기각 처리했습니다.');
    } catch (error) {
        console.error('Admin Reject Report Error:', error);
        return fail(res, '서너 에러가 발생했습니다.', 500);
    } finally {
        if (connection) connection.release();
    }
};