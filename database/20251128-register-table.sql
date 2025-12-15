-- 외래 키 검사 비활성화 (테이블 삭제 순서 무시)
SET FOREIGN_KEY_CHECKS = 0;

-- 1. 기존 테이블 삭제 (초기화)
DROP TABLE IF EXISTS email_verifications;
DROP TABLE IF EXISTS individual_profiles;
DROP TABLE IF EXISTS organization_profiles;
DROP TABLE IF EXISTS users;

-- 외래 키 검사 재활성화
SET FOREIGN_KEY_CHECKS = 1;


-- 2. Users 테이블 (공통 사용자) - ALTER 내용 통합됨
CREATE TABLE users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '사용자 고유 ID',
    user_type ENUM('INDIVIDUAL', 'ORGANIZATION') NOT NULL COMMENT '사용자 타입',
    userid VARCHAR(100) NOT NULL UNIQUE COMMENT '로그인 아이디',
    password VARCHAR(255) NOT NULL COMMENT '해시된 비밀번호',
    email VARCHAR(255) NOT NULL UNIQUE COMMENT '이메일 (개인/단체 공식)',
    
    -- [추가] 스크린샷에 있었으나 이번 텍스트에서 빠진 부분 보강
    role ENUM('USER', 'ADMIN') DEFAULT 'USER' COMMENT '권한',
    
    -- [통합] ALTER로 추가했던 컬럼들을 여기로 합침
    has_logged_in BOOLEAN DEFAULT FALSE COMMENT '로그인 여부 (0:없음, 1:있음)',
    approval_status ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'APPROVED' COMMENT '승인 상태 (기본값 APPROVED)',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '가입일'
) COMMENT '공통 사용자 인증 테이블';


-- 3. Individual Profiles (개인 프로필)
CREATE TABLE individual_profiles (
    user_id BIGINT PRIMARY KEY COMMENT 'users.id 외래 키',
    nickname VARCHAR(100) NOT NULL COMMENT '닉네임',
    email_consent BOOLEAN DEFAULT FALSE COMMENT '이메일 수신 동의 여부',
    
    -- 개인 회원 추가 정보 (이전 대화 내용 반영, 필요 시 주석 해제)
    -- interests TEXT COMMENT '관심사',
    -- mailing_days VARCHAR(50) COMMENT '메일링 요일',
    -- mailing_time TIME COMMENT '메일링 시간',

    CONSTRAINT fk_individual_user 
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) COMMENT '개인 회원 프로필';


-- 4. Organization Profiles (단체 프로필)
CREATE TABLE organization_profiles (
    user_id BIGINT PRIMARY KEY COMMENT 'users.id 외래 키',
    org_name VARCHAR(100) NOT NULL COMMENT '단체명',
    sns_link VARCHAR(255) NULL COMMENT '공식 SNS 혹은 웹사이트',
    contact_number VARCHAR(50) NOT NULL COMMENT '연락처',
    address VARCHAR(255) NOT NULL COMMENT '주소',
    
    -- 단체 회원 추가 정보 (이전 대화 내용 반영)
    -- introduction TEXT COMMENT '소개글',

    CONSTRAINT fk_organization_user 
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) COMMENT '단체 회원 프로필';


-- 5. Email Verifications (이메일 인증)
-- 보내주신대로 'email'을 PK로 설정 (이메일당 1개의 인증코드만 유효)
CREATE TABLE email_verifications (
    email VARCHAR(255) PRIMARY KEY COMMENT '인증할 이메일',
    code VARCHAR(6) NOT NULL COMMENT '인증번호 6자리',
    expires_at TIMESTAMP NOT NULL COMMENT '인증번호 만료 시간',
    verified BOOLEAN DEFAULT FALSE COMMENT '인증 성공 여부'
) COMMENT '이메일 인증번호 관리';