const nodemailer = require('nodemailer');
const path = require('path');

// Base64 인코딩된 이미지 로드
const EMAIL_ASSETS = require('../../email-assets-base64.json');

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

/**
 * 4. 커스텀 안내 이메일 발송 (정보 수정 승인/반려 알림 등)
 */
const sendCustomEmail = async (toEmail, subject, textContent) => {
  const mailOptions = {
    from: `"연등 : 연대의 등불" <${process.env.EMAIL_FROM_ADDRESS}>`,
    to: toEmail,
    subject: subject,
    html: `
      <div style="${CONTAINER_STYLE}">
        <h2 style="color: ${BRAND_COLOR}; margin-bottom: 20px;">알림 안내</h2>
        <p style="color: ${TEXT_COLOR}; line-height: 1.6; white-space: pre-wrap;">
          ${textContent}
        </p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: ${TEXT_COLOR}; font-weight: bold;">감사합니다.<br>연등 드림</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[Email Service] Custom email sent to: ${toEmail}`);
  } catch (error) {
    console.error(`[Email Service] Error sending custom email: ${toEmail}`, error);
    throw new Error('안내 이메일 발송에 실패했습니다.');
  }
};

/**
 * 5. 정기 메일 발송 - 관심 분야 미응원 게시글
 */
const sendInterestPostEmail = async (toEmail, userName, posts) => {
  const mailOptions = {
    from: `"연등 : 연대의 등불" <${process.env.EMAIL_FROM_ADDRESS}>`,
    to: toEmail,
    subject: '[연등] 나의 관심 분야의 새로운 게시글',
    html: getInterestPostTemplate(userName, posts),
  };
  try {
    await transporter.sendMail(mailOptions);
    console.log(`[Email Service] Interest posts email sent to: ${toEmail}`);
  } catch (error) {
    console.error(`[Email Service] Error sending interest posts email: ${toEmail}`, error);
    throw error;
  }
};

/**
 * 6. 정기 메일 발송 - 인기 게시글
 */
const sendPopularPostEmail = async (toEmail, userName, posts) => {
  const mailOptions = {
    from: `"연등 : 연대의 등불" <${process.env.EMAIL_FROM_ADDRESS}>`,
    to: toEmail,
    subject: '[연등] 이번 주 인기 게시글',
    html: getPopularPostTemplate(userName, posts),
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[Email Service] Popular posts email sent to: ${toEmail}`);
  } catch (error) {
    console.error(`[Email Service] Error sending popular posts email: ${toEmail}`, error);
    throw error;
  }
};

/**
 * 제한 정책
 */
const stripHtmlImages = (html) => {
  if (!html) return '';
  return html.replace(/<img[^>]*>/gi, '');
};

const truncateHtmlContent = (html, maxLength = 600) => {
  if (!html) return '';

  let content = stripHtmlImages(html);
  const textOnly = content.replace(/<[^>]+>/g, '').trim();

  // 길이 제한
  if (textOnly.length > maxLength) {
    const truncated = textOnly.substring(0, maxLength);
    return `<p>${truncated}...</p><p style="color: #797979; font-size: 14px; margin-top: 16px;">일부 내용만 미리 보여드립니다. 전체 내용은 연등에서 확인하실 수 있어요!</p>`;
  }

  return `<p>${textOnly}</p>`;
};

/**
 * 관심 분야 미응원 게시글 이메일 템플릿
 */
const getInterestPostTemplate = (userName, posts) => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const post = posts[0];
  const startDate = post.start_date ? new Date(post.start_date).toLocaleDateString('ko-KR') : '';
  const endDate = post.end_date ? new Date(post.end_date).toLocaleDateString('ko-KR') : '';
  const truncatedContent = truncateHtmlContent(post.content, 600);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        @media only screen and (max-width: 600px) {
          .container { width: 100% !important; max-width: 100% !important; }
          .content { padding: 16px !important; }
          .logo { width: 120px !important; margin: 30px 0 0 16px !important; }
        }
      </style>
    </head>
    <body style="margin: 0; padding: 0; background: #f5f5f5;">
      <div style="transform: scale(0.8); transform-origin: top center; margin-bottom: -30%;">
        <div class="container" style="max-width: 1024px; margin: 0 auto; background: white; box-sizing: border-box;">
          <!-- 로고 -->
          <img class="logo" style="width: 176px; height: auto; margin: 60px 0 0 24px;" src="${EMAIL_ASSETS['rogo_short.png']}" alt="연등" />

        <!-- 날짜 -->
        <div style="text-align: right; padding-right: 24px; color: #797979; font-size: 16px; font-family: Inter, sans-serif; font-weight: 300; margin-top: -30px;">
          ${year}년 ${month}월 ${day}일
        </div>

        <!-- 안내글 -->
        <div class="content" style="margin: 30px 24px; color: #2E2E2E; font-size: 16px; font-family: Pretendard, sans-serif; font-weight: 400; line-height: 1.6;">
          ${userName}님이 관심 있게 지켜보시는 ${post.topics} 분야의 소식입니다.<br/>
          바쁜 일상 속에서 놓치지 않도록, 연등이 전해드립니다.
        </div>

        <!-- 요약 카드 -->
        <div style="max-width: 976px; margin: 0 auto 8px; overflow: hidden; border-radius: 10px; outline: 1px #E1E1E1 solid; outline-offset: -1px; padding: 20px; box-sizing: border-box;">
          <!-- 제목 -->
          <div style="color: #2E2E2E; font-size: 24px; font-family: Inter, sans-serif; font-weight: 700; margin-bottom: 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <span style="word-break: keep-all;">${post.title}</span>
            <img style="width: 32px; height: 32px;" src="${EMAIL_ASSETS['단체인증뱃지.png']}" alt="단체인증뱃지" />
          </div>

          <!-- 요약 정보 카드 -->
          <div style="display: flex; flex-direction: column; gap: 12px; color: #797979; font-size: 16px; font-family: Inter, sans-serif; font-weight: 300;">
            <div style="display: flex; flex-wrap: wrap; gap: 8px 24px;">
              <div style="flex: 1 1 200px;"><span style="font-weight: 400;">참여 방식:</span> ${post.participation_type}</div>
              ${post.organization_name ? `<div style="flex: 1 1 200px;"><span style="font-weight: 400;">주최:</span> ${post.organization_type === 'ORGANIZATION' ? '단체' : '개인'} | "${post.organization_name}"</div>` : ''}
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px 24px;">
              ${startDate && endDate ? `<div style="flex: 1 1 200px;"><span style="font-weight: 400;">진행 일자:</span> ${startDate} ~ ${endDate}</div>` : ''}
              ${post.region && post.district ? `<div style="flex: 1 1 200px;"><span style="font-weight: 400;">장소:</span> ${post.region} > ${post.district}</div>` : ''}
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px 24px;">
              <div style="flex: 1 1 200px;"><span style="font-weight: 400;">의제:</span> ${post.topics}</div>
              ${post.link ? `<div style="flex: 1 1 200px; word-break: break-all;"><span style="font-weight: 400;">참여 링크:</span> <a href="${post.link}" style="color: #797979; text-decoration: underline;">${post.link}</a></div>` : ''}
            </div>
          </div>
        </div>

        <!-- 본문 -->
        <div style="max-width: 976px; margin: 0 auto 32px; overflow: hidden; border-radius: 8px; outline: 1px #E1E1E1 solid; outline-offset: -1px; padding: 20px; font-family: Pretendard, sans-serif; line-height: 1.6; color: #2E2E2E; box-sizing: border-box;">
          ${truncatedContent}
        </div>

        <!-- 응원봉 안내글 -->
        <div style="text-align: center; margin: 32px auto 0; color: #2E2E2E; font-size: 16px; font-family: Pretendard, sans-serif; font-weight: 400;">
          이 목소리에 힘을 보태고 싶다면, 아래 버튼을 눌러 응원봉을 밝혀주세요.
        </div>

        <!-- 응원봉 버튼 -->
        <div style="text-align: center; margin: 16px auto 0;">
          <a href="${post.link || '#'}" style="display: inline-flex; padding: 12px 24px; background: #FF7972; border-radius: 8px; align-items: center; gap: 12px; text-decoration: none;">
            <img style="width: 48px; height: 48px;" src="${EMAIL_ASSETS['응원봉.png']}" alt="응원봉" />
            <span style="color: #F8F8F8; font-size: 18px; font-family: Inter, sans-serif; font-weight: 600;">이 소식에 응원봉 밝히기</span>
          </a>
        </div>
        
        <!-- 구분선 -->
        <div style="width: 972px; height: 1px; margin: 48px auto; background: #C3C3C3;"></div>

        <!-- 하단 로고 -->
        <div style="text-align: center; margin-top: 32px;">
          <img style="width: 217px; height: auto;" src="${EMAIL_ASSETS['rogo_long.png']}" alt="연등 로고" />
        </div>

        <!-- 하단 문구 -->
        <div style="text-align: center; color: #797979; font-size: 16px; font-family: Pretendard, sans-serif; font-weight: 400; margin-top: 16px;">
          각자의 불빛을 모아 거대한 행동의 물결로
        </div>
        <div style="text-align: center; color: #797979; font-size: 14px; font-family: Inter, sans-serif; font-weight: 300; margin-top: 8px;">
          yeondeung.official@gmail.com
        </div>

        <!-- 푸터 링크 -->
        <div style="text-align: center; margin: 16px auto 32px; display: flex; justify-content: center; align-items: center; gap: 8px;">
          <a href="#" style="color: #797979; font-size: 14px; font-family: Inter, sans-serif; font-weight: 300; text-decoration: underline;">메일링 설정 변경</a>
          <span style="color: #797979;">|</span>
          <a href="#" style="color: #797979; font-size: 14px; font-family: Inter, sans-serif; font-weight: 300; text-decoration: underline;">수신 거부</a>
        </div>
        </div>
      </div>
    </body>
    </html>
  `;
};

/**
 * 인기 게시글 이메일 템플릿
 */
const getPopularPostTemplate = (userName, posts) => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const post = posts[0];
  const startDate = post.start_date ? new Date(post.start_date).toLocaleDateString('ko-KR') : '';
  const endDate = post.end_date ? new Date(post.end_date).toLocaleDateString('ko-KR') : '';
  const truncatedContent = truncateHtmlContent(post.content, 600);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        @media only screen and (max-width: 600px) {
          .container { width: 100% !important; max-width: 100% !important; }
          .content { padding: 16px !important; }
          .logo { width: 120px !important; margin: 30px 0 0 16px !important; }
        }
      </style>
    </head>
    <body style="margin: 0; padding: 0; background: #f5f5f5;">
      <div style="transform: scale(0.8); transform-origin: top center; margin-bottom: -30%;">
        <div class="container" style="max-width: 1024px; margin: 0 auto; background: white; box-sizing: border-box;">
          <!-- 로고 -->
          <img class="logo" style="width: 176px; height: auto; margin: 60px 0 0 24px;" src="${EMAIL_ASSETS['rogo_short.png']}" alt="연등 로고" />

        <!-- 날짜 -->
        <div style="text-align: right; padding-right: 24px; color: #797979; font-size: 16px; font-family: Inter, sans-serif; font-weight: 300; margin-top: -30px;">
          ${year}년 ${month}월 ${day}일
        </div>

        <!-- 상단 설명 -->
        <div class="content" style="margin: 30px 24px; color: #2E2E2E; font-size: 16px; font-family: Pretendard, sans-serif; font-weight: 400; line-height: 1.6;">
          이번 주, 연등에서 가장 많은 분이 마음을 모아주신 소식입니다.<br/>
          ${userName}님께도 이 연대의 흐름을 전해드립니다.
        </div>

        <!-- 요약 카드 -->
        <div style="max-width: 976px; margin: 0 auto 8px; overflow: hidden; border-radius: 10px; outline: 1px #E1E1E1 solid; outline-offset: -1px; padding: 20px; box-sizing: border-box;">
          <!-- 제목 -->
          <div style="color: #2E2E2E; font-size: 24px; font-family: Inter, sans-serif; font-weight: 700; margin-bottom: 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <span style="word-break: keep-all;">${post.title}</span>
            <img style="width: 32px; height: 32px;" src="${EMAIL_ASSETS['단체인증뱃지.png']}" alt="단체인증뱃지" />
          </div>

          <!-- 요약 정보 카드 -->
          <div style="display: flex; flex-direction: column; gap: 12px; color: #797979; font-size: 16px; font-family: Inter, sans-serif; font-weight: 300;">
            <div style="display: flex; flex-wrap: wrap; gap: 8px 24px;">
              <div style="flex: 1 1 200px;"><span style="font-weight: 400;">참여 방식:</span> ${post.participation_type}</div>
              ${post.organization_name ? `<div style="flex: 1 1 200px;"><span style="font-weight: 400;">주최:</span> ${post.organization_type === 'ORGANIZATION' ? '단체' : '개인'} | "${post.organization_name}"</div>` : ''}
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px 24px;">
              ${startDate && endDate ? `<div style="flex: 1 1 200px;"><span style="font-weight: 400;">진행 일자:</span> ${startDate} ~ ${endDate}</div>` : ''}
              ${post.region && post.district ? `<div style="flex: 1 1 200px;"><span style="font-weight: 400;">장소:</span> ${post.region} > ${post.district}</div>` : ''}
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px 24px;">
              <div style="flex: 1 1 200px;"><span style="font-weight: 400;">의제:</span> ${post.topics}</div>
              ${post.link ? `<div style="flex: 1 1 200px; word-break: break-all;"><span style="font-weight: 400;">참여 링크:</span> <a href="${post.link}" style="color: #797979; text-decoration: underline;">${post.link}</a></div>` : ''}
            </div>
          </div>
        </div>

        <!-- 본문 -->
        <div style="max-width: 976px; margin: 0 auto 32px; overflow: hidden; border-radius: 8px; outline: 1px #E1E1E1 solid; outline-offset: -1px; padding: 20px; font-family: Pretendard, sans-serif; line-height: 1.6; color: #2E2E2E; box-sizing: border-box;">
          ${truncatedContent}
        </div>

        <!-- 응원봉 안내 -->
        <div style="text-align: center; margin: 32px auto 0; color: #2E2E2E; font-size: 16px; font-family: Pretendard, sans-serif; font-weight: 400;">
          현재 <span style="font-weight: 700;">${post.cheer_count || 0}명</span>이 함께 응원봉을 밝히고 있어요!<br/>
          ${userName}님의 마음도 함께 더해진다면 큰 변화가 시작될 거예요.
        </div>

        <!-- 응원봉 버튼 -->
        <div style="text-align: center; margin: 16px auto 0;">
          <a href="${post.link || '#'}" style="display: inline-flex; padding: 12px 24px; background: #FF7972; border-radius: 8px; align-items: center; gap: 12px; text-decoration: none;">
            <img style="width: 48px; height: 48px;" src="${EMAIL_ASSETS['응원봉.png']}" alt="응원봉" />
            <span style="color: #F8F8F8; font-size: 18px; font-family: Inter, sans-serif; font-weight: 600;">이 소식에 응원봉 밝히기</span>
          </a>
        </div>

        <!-- 더 많은 연대 안내 -->
        <div style="text-align: center; margin: 48px auto 0; color: #2E2E2E; font-size: 16px; font-family: Pretendard, sans-serif; font-weight: 400;">
          이 외에도 다른 연대 소식이 궁금하다면?
        </div>

        <!-- 더 많은 연대 버튼 -->
        <div style="text-align: center; margin: 12px auto 0;">
          <a href="#" style="display: inline-flex; padding: 16px 12px; border: 1px solid #FF7972; border-radius: 8px; align-items: center; gap: 4px; text-decoration: none;">
            <span style="color: #FF7972; font-size: 18px; font-family: Inter, sans-serif; font-weight: 600;">더 많은 연대 살펴보기</span>
          </a>
        </div>

        <!-- 구분선 -->
        <div style="width: 972px; height: 1px; margin: 48px auto; background: #C3C3C3;"></div>

        <!-- 하단 로고 -->
        <div style="text-align: center; margin-top: 32px;">
          <img style="width: 217px; height: auto;" src="${EMAIL_ASSETS['rogo_long.png']}" alt="연등 로고" />
        </div>

        <!-- 하단 문구 -->
        <div style="text-align: center; color: #797979; font-size: 16px; font-family: Pretendard, sans-serif; font-weight: 400; margin-top: 16px;">
          각자의 불빛을 모아 거대한 행동의 물결로
        </div>
        <div style="text-align: center; color: #797979; font-size: 14px; font-family: Inter, sans-serif; font-weight: 300; margin-top: 8px;">
          yeondeung.official@gmail.com
        </div>

        <!-- 푸터 링크 -->
        <div style="text-align: center; margin: 16px auto 32px; display: flex; justify-content: center; align-items: center; gap: 8px;">
          <a href="#" style="color: #797979; font-size: 14px; font-family: Inter, sans-serif; font-weight: 300; text-decoration: underline;">메일링 설정 변경</a>
          <span style="color: #797979;">|</span>
          <a href="#" style="color: #797979; font-size: 14px; font-family: Inter, sans-serif; font-weight: 300; text-decoration: underline;">수신 거부</a>
        </div>
        </div>
      </div>
    </body>
    </html>
  `;
};

module.exports = {
  sendVerificationEmail,
  sendApprovalEmail,
  sendRejectionEmail,
  sendInterestPostEmail,
  sendPopularPostEmail,
  sendCustomEmail,
};