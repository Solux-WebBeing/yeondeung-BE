const { link_validate } = require('../util/domain.util');
const { crawlUrl } = require('../util/crawler.util');
const { ai_validate } = require('../util/ai.util');
const responseUtil = require('../util/response.util');

/**
 * 게시글 등록 시 검사 미들웨어
 * 링크 도메인 검사 -> AI 검사 1, 2, 3차
 */
async function validateBoardCreate(req, res, next) {
  try {
    const { topic: title, content, link, participation_type } = req.body;

    // 1. 기본 필드 검증
    if (!title || !content) {
      return responseUtil.fail(res, '제목과 내용은 필수 입력 항목입니다.', 400);
    }

    // 2. 링크가 없는 경우
    const requiresLink = ['서명', '청원', '탄원'].includes(participation_type);

    if (requiresLink && !link) {
      return responseUtil.fail(res, '청원/서명/탄원 링크를 입력해야 게시글을 등록할 수 있습니다', 400);
    }

    // 3. 링크가 있는 경우
    let domainInfo = null;
    if (link) {
      const linkValidation = await link_validate(link); // 도메인 검사

      if (!linkValidation.valid) {
        return responseUtil.fail(res, linkValidation.message, 400);
      }

      domainInfo = linkValidation.domain;
    }

    // 4. AI 검사
    if (requiresLink && link) {
      // 크롤링
      let crawledText = null;
      const crawlResult = await crawlUrl(link);

      if (crawlResult.success) {
        crawledText = crawlResult.text;
        console.log(`[✅Validation] 크롤링 성공: ${link}`);
      } else {
        console.log(`[⚠️Validation] 크롤링 실패: ${crawlResult.error}`);
      }

      // AI 검사
      const aiValidation = await ai_validate({title, content, link, crawledText, boardId: null});

      if (!aiValidation.pass) {
        return responseUtil.fail(
          res,
          aiValidation.message,
          400,
          { verification_step: aiValidation.step }
        );
      }

      console.log('\n[✅AI 검사 완료]\n');
    } else {
      console.log('\n[⚠️AI 검사 스킵]\n');
    }

    // 검증 완료
    req.validatedData = {domainInfo, aiVerified: !!(requiresLink && link)};

    next();

  } catch (error) {
    console.error('[⚠️Validation 오류]', error);
    return responseUtil.fail(res, '미들웨어 오류가 발생했습니다', 500);
  }
}

module.exports = {
  validateBoardCreate
};
