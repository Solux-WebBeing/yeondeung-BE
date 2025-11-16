const pool = require('../../db');
const { success, fail } = require('../util/response.util.js');
const emailService = require('../util/email.service.js');

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