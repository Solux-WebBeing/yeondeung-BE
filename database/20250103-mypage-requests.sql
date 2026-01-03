-- 외래 키 검사 비활성화
SET FOREIGN_KEY_CHECKS = 0;

-- 기존 테이블 삭제
DROP TABLE IF EXISTS organization_edit_requests;

-- 단체 정보 수정 요청 테이블 생성
CREATE TABLE organization_edit_requests (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL COMMENT '요청한 단체 사용자 ID',
    
    new_introduction TEXT COMMENT '변경할 단체 소개',
    new_email VARCHAR(255) COMMENT '변경할 공식 이메일',
    new_sns_link VARCHAR(255) COMMENT '변경할 SNS/웹사이트 주소',
    new_contact_number VARCHAR(50) COMMENT '변경할 연락처',
    
    status ENUM('PENDING', 'APPROVED', 'REJECTED') DEFAULT 'PENDING' COMMENT '검토 상태',
    reject_reason TEXT COMMENT '반려 사유',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_edit_request_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) COMMENT '단체 정보 수정 승인 요청 관리';

-- 외래 키 검사 재활성화
SET FOREIGN_KEY_CHECKS = 1;