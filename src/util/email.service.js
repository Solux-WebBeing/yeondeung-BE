const nodemailer = require('nodemailer');

// 1. Nodemailer Transporter 설정
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT, // 587 (TLS) or 465 (SSL)
  secure: process.env.EMAIL_PORT == 465, 
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// --- 공통 스타일 상수 ---
const BRAND_COLOR = '#FF7972';
const TEXT_COLOR = '#333333';
const CONTAINER_STYLE = `
  font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', Arial, sans-serif; 
  max-width: 600px; 
  margin: 20px auto; 
  padding: 30px; 
  border: 1px solid #e0e0e0; 
  border-radius: 12px; 
  background-color: #ffffff;
`;

/**
 * 1. 인증번호 이메일 발송
 */
const sendVerificationEmail = async (toEmail, code) => {
  const mailOptions = {
    from: `"연등 : 연대의 등불" <${process.env.EMAIL_FROM_ADDRESS}>`,
    to: toEmail,
    subject: '[연등] 이메일 인증번호 안내',
    html: `
      <div style="${CONTAINER_STYLE}">
        <h2 style="color: ${BRAND_COLOR}; margin-bottom: 20px;">연등 이메일 인증 안내</h2>
        <p style="color: ${TEXT_COLOR}; line-height: 1.6;">
          안녕하세요, 회원가입을 위해 이메일 인증을 진행합니다.<br>
          아래 발급된 인증번호를 복사하거나 직접 입력하여 인증을 완료해주세요.
        </p>
        
        <!-- 인증번호 박스 -->
        <div style="
          background-color: #FFF0EF; 
          padding: 20px; 
          text-align: center; 
          border-radius: 8px; 
          margin: 30px 0; 
          border: 1px solid ${BRAND_COLOR};">
          <span style="
            font-size: 28px; 
            font-weight: bold; 
            letter-spacing: 4px; 
            color: ${BRAND_COLOR};">
            ${code}
          </span>
        </div>
        
        <p style="color: #888; font-size: 13px; line-height: 1.5;">
          인증번호는 발급 후 10분간만 유효합니다.
        </p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: ${TEXT_COLOR}; font-weight: bold;">감사합니다.<br>연등 드림</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[Email Service] Verification email sent to: ${toEmail}`);
  } catch (error) {
    console.error(`[Email Service] Error sending verification email: ${toEmail}`, error);
    throw new Error('인증 이메일 발송에 실패했습니다.');
  }
};

/**
 * 2. 가입 승인 이메일 발송
 */
const sendApprovalEmail = async (toEmail, orgName) => {
  // 로그인 페이지 URL (환경변수 또는 하드코딩)
  const loginUrl = process.env.CLIENT_URL ? `${process.env.CLIENT_URL}/login` : 'http://localhost:3000/login';

  const mailOptions = {
    from: `"연등 : 연대의 등불" <${process.env.EMAIL_FROM_ADDRESS}>`,
    to: toEmail,
    subject: `[연등] ${orgName} 님의 단체 회원 가입이 승인되었습니다.`,
    html: `
      <div style="${CONTAINER_STYLE}">
        <h2 style="color: ${BRAND_COLOR}; margin-bottom: 20px;">가입 승인 안내</h2>
        <p style="color: ${TEXT_COLOR}; line-height: 1.6;">
          안녕하세요, 연등 운영팀입니다.<br>
          <strong>‘${orgName}’</strong> 님의 단체 회원 가입이 승인되었습니다.<br>
          지금 바로 로그인하셔서 연등의 모든 서비스를 이용해 보세요.
        </p>
        
        <!-- 로그인 버튼 -->
        <div style="text-align: center; margin: 40px 0;">
          <a href="${loginUrl}" style="
            display: inline-block; 
            padding: 14px 30px; 
            font-size: 16px; 
            font-weight: bold;
            color: #ffffff; 
            background-color: ${BRAND_COLOR}; 
            text-decoration: none; 
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(255, 121, 114, 0.3);">
            로그인하러 가기
          </a>
        </div>
        
        <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: ${TEXT_COLOR}; font-weight: bold;">감사합니다.<br>연등 드림</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[Email Service] Approval email sent to: ${toEmail}`);
  } catch (error) {
    console.error(`[Email Service] Error sending approval email: ${toEmail}`, error);
    throw new Error('승인 이메일 발송에 실패했습니다.');
  }
};

/**
 * 3. 가입 반려(거절) 이메일 발송
 */
const sendRejectionEmail = async (toEmail, orgName, rejectionReason) => {
  const mailOptions = {
    from: `"연등 : 연대의 등불" <${process.env.EMAIL_FROM_ADDRESS}>`,
    to: toEmail,
    subject: `[연등] ${orgName} 님의 단체 회원 가입 신청이 반려되었습니다.`,
    html: `
      <div style="${CONTAINER_STYLE}">
        <h2 style="color: #555; margin-bottom: 20px;">가입 신청 반려 안내</h2>
        <p style="color: ${TEXT_COLOR}; line-height: 1.6;">
          안녕하세요, 연등 운영팀입니다.<br>
          연등 서비스에 단체 회원으로 가입 신청해 주셔서 감사합니다.<br><br>
          심사 결과, 귀하의 가입 신청이 아래 사유로 반려되었음을 안내드립니다.
        </p>
        
        <!-- 반려 사유 박스 -->
        <div style="
          background-color: #f5f5f5; 
          padding: 20px; 
          border-left: 5px solid #999; 
          margin: 25px 0;
          border-radius: 4px;">
          <strong style="color: #333;">[반려 사유]</strong><br>
          <span style="color: #555; margin-top: 5px; display: block;">${rejectionReason}</span>
        </div>
        
        <p style="color: ${TEXT_COLOR}; line-height: 1.6; font-size: 14px;">
          확인 후 추가 문의 사항이 있으시면 고객센터(<a href="mailto:contact@example.com" style="color: ${BRAND_COLOR}; text-decoration: underline;">contact@example.com</a>)으로 연락해 주시기 바랍니다.
        </p>
        
        <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: ${TEXT_COLOR}; font-weight: bold;">감사합니다.<br>연등 드림</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[Email Service] Rejection email sent to: ${toEmail}`);
  } catch (error) {
    console.error(`[Email Service] Error sending rejection email: ${toEmail}`, error);
    throw new Error('거절 이메일 발송에 실패했습니다.');
  }
};

module.exports = {
  sendVerificationEmail,
  sendApprovalEmail,
  sendRejectionEmail,
};

// 이메일 간편 테스트 용
/*
const BRAND_COLOR = '#FF7972';
const TEXT_COLOR = '#333333';
const CONTAINER_STYLE = `
  font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', Arial, sans-serif; 
  max-width: 600px; 
  margin: 20px auto; 
  padding: 30px; 
  border: 1px solid #e0e0e0; 
  border-radius: 12px; 
  background-color: #ffffff;
`;

const sendVerificationEmail = async (toEmail, code) => {
  console.log('\n==================================================');
  console.log('📬 [TEST MODE] 이메일 발송 시뮬레이션 (인증번호)');
  console.log(`➡ 받는 사람: ${toEmail}`);
  console.log(`➡ 인증 번호: ${code}`);
  console.log('==================================================\n');

  return true;
};


const sendApprovalEmail = async (toEmail, orgName) => {
  console.log('\n==================================================');
  console.log('📬 [TEST MODE] 이메일 발송 시뮬레이션 (가입 승인)');
  console.log(`➡ 받는 사람: ${toEmail}`);
  console.log(`➡ 내용: '${orgName}' 님의 단체 가입이 승인되었습니다.`);
  console.log('==================================================\n');

  return true;
};

const sendRejectionEmail = async (toEmail, orgName, rejectionReason) => {
  console.log('\n==================================================');
  console.log('📬 [TEST MODE] 이메일 발송 시뮬레이션 (가입 반려)');
  console.log(`➡ 받는 사람: ${toEmail}`);
  console.log(`➡ 대상 단체: ${orgName}`);
  console.log(`➡ 반려 사유: ${rejectionReason}`);
  console.log('==================================================\n');

  return true;
};

module.exports = {
  sendVerificationEmail,
  sendApprovalEmail,
  sendRejectionEmail,
};
*/