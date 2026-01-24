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
    const { user_type } = req.user;
    const { title, topics, content, link, participation_type, start_date, start_time, end_date, end_time } = req.body;
    // 주제를 title로, 의제를 topics로 변경함에 따라 해당 코드 또한 변경

    // 1. 기본 필드 검증
    if (!title || !topics || !content || !participation_type || !start_date || !end_date) {
      return responseUtil.fail(res, '필수 입력 정보가 누락되었습니다', 400);
    }

    // 2. 사용자 타입에 따른 작성 권한 검사
    const isOfflineEvent = ['집회', '행사'].includes(participation_type);
    if (user_type === 'INDIVIDUAL' && isOfflineEvent) {
      return responseUtil.fail(res, '집회나 행사 게시글은 단체 회원만 작성할 수 있습니다.', 403);
    }

    // 3. 날짜 오류 검사
    const start = new Date(`${start_date} ${start_time || '00:00'}:00`);
    const end = new Date(`${end_date} ${end_time || '00:00'}:00`);
    
    if (end < start) {
      return responseUtil.fail(res, '종료 일시가 시작 일시보다 빠릅니다', 400); //
    }

    // 4. 링크 검사
    const requiresLink = ['서명', '청원', '탄원'].includes(participation_type);

    if (requiresLink && !link) {
      return responseUtil.fail(res, '청원/서명/탄원 링크를 입력해야 게시글을 등록할 수 있습니다', 400);
    }

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
      const crawlResult = await crawlUrl(link, domainInfo);

      if (crawlResult.success) {
        crawledText = crawlResult.text;
        console.log(`[✅Validation] 크롤링 성공: ${link}`);
      } else {
        console.log(`[⚠️Validation] 크롤링 실패: ${crawlResult.error}`);
      }

      // AI 검사
      const aiValidation = await ai_validate({title: title, content, link, crawledText, boardId: null});  // 위와 같은 이유로 변경

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

    console.log('그냥 통과');
    req.validatedData = { domainInfo: null, aiVerified: false };
    return next();

    // return responseUtil.fail(res, '미들웨어 오류가 발생했습니다', 500);
  }
}

module.exports = {
  validateBoardCreate
};

/**
 * [TEST MODE] 게시글 등록 시 검사 미들웨어 (AI/크롤링 스킵)
 * 무조건 검증을 통과시킵니다.
 */
/*
const responseUtil = require('../util/response.util');

async function validateBoardCreate(req, res, next) {
  try {
    console.log('\n==================================================');
    console.log('🚀 [TEST MODE] AI 검사 및 크롤링을 건너뜁니다.');
    console.log('==================================================\n');

    const { participation_type, link } = req.body;

    // 1. 필수값 체크 (기본적인 것만 수행)
    if (!req.body.title || !req.body.content) {
      return responseUtil.fail(res, '제목과 내용은 필수 입력 항목입니다.', 400);
    }

    // 2. 링크 필수 여부 체크
    const requiresLink = ['서명', '청원', '탄원'].includes(participation_type);
    if (requiresLink && !link) {
      return responseUtil.fail(res, '청원/서명/탄원 링크를 입력해야 게시글을 등록할 수 있습니다', 400);
    }

    // 3. [핵심] 실제 AI 검사 대신 가짜(Mock) 데이터 주입
    // 컨트롤러가 에러 없이 작동하도록 필요한 데이터를 채워줍니다.
    req.validatedData = {
        domainInfo: { site_name: '테스트사이트' }, // 가짜 도메인 정보
        aiVerified: true // "AI 검사 통과함"으로 설정
    };

    // 4. 다음 단계(Controller)로 이동
    next();

  } catch (error) {
    console.error('[⚠️Validation 오류]', error);
    return responseUtil.fail(res, '미들웨어 오류가 발생했습니다', 500);
  }
}

module.exports = {
  validateBoardCreate
};
*/