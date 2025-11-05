const nodemailer = require('nodemailer');

// 1. Nodemailer Transporter 설정
// .env 파일에서 이메일 서버 정보를 읽어옵니다.
// (예: SendGrid, Mailgun 또는 회사 SMTP 서버)
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT, // 587 (TLS), 465 (SSL)
  secure: process.env.EMAIL_PORT == 465, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER, // (예: SendGrid의 'apikey')
    pass: process.env.EMAIL_PASS, // (예: SendGrid API 키)
  },
});

/**
 * 인증번호 이메일 발송
 * @param {string} toEmail - 수신자 이메일
 * @param {string} code - 6자리 인증번호
 */
const sendVerificationEmail = async (toEmail, code) => {
  const mailOptions = {
    // 보내는 사람 주소. .env에 설정된 주소를 사용합니다.
    from: `"연등 : 연대의 등불" <${process.env.EMAIL_FROM_ADDRESS}>`,
    to: toEmail,
    subject: '[연등] 이메일 인증번호가 도착했습니다.',
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
        <h2 style="color: #333;">이메일 인증 안내</h2>
        <p>안녕하세요! 연등 서비스에 가입해 주셔서 감사합니다.</p>
        <p>회원가입을 완료하려면 아래 6자리 인증번호를 입력해 주세요.</p>
        <div style="background-color: #f4f4f4; padding: 15px; text-align: center; border-radius: 4px; margin: 25px 0;">
          <strong style="font-size: 24px; letter-spacing: 3px; color: #0056b3;">${code}</strong>
        </div>
        <p style="color: #777; font-size: 14px;">이 인증번호는 10분간 유효합니다.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #999; font-size: 12px;">본인이 요청하지 않은 경우 이 메일을 무시해 주세요.</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[Email Service] 인증 이메일 발송 성공: ${toEmail}`);
  } catch (error) {
    console.error(`[Email Service] 이메일 발송 실패: ${toEmail}`, error);
    // 컨트롤러가 에러를 잡을 수 있도록 에러를 다시 던집니다.
    throw new Error('인증 이메일 발송에 실패했습니다.');
  }
};

module.exports = {
  sendVerificationEmail,
};