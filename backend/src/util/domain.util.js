const pool = require('../../db');
const validator = require('validator');

/**
 * 링크(도메인) 검사
 */
async function validateDomain(url) {
  try {
    if (!url || typeof url !== 'string') {
      return { allowed: false, message: '청원/서명/탄원 링크를 입력해야 게시글을 등록할 수 있습니다.' };
    }

    if (!validator.isURL(url, { protocols: ['https'], require_protocol: true })) {
      return { allowed: false, message: '올바른 URL 형식이 아닙니다.' };
    }

    const [allowedDomains] = await pool.query('SELECT * FROM allowed_domains');
    const matchedDomain = allowedDomains.find(d => matchWildcard(d.domain_pattern, url));

    if (!matchedDomain) {
      return { allowed: false, message: '공식 청원/서명/탄원 링크만 등록할 수 있어요' };
    }

    return {
      allowed: true,
      domain: {
        site_name: matchedDomain.site_name // 크롤링 선택에 사용
      }
    };

  } catch (error) {
    console.error('[링크(도메인) 검사 실패]', error);
    return { allowed: false, message: '도메인 검사 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' };
  }
}

function matchWildcard(pattern, url) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(url);
}

/**
 * 링크 중복 검사
 */
async function checkDuplicateLink(link) {
  try {
    const [rows] = await pool.query(
      'SELECT id FROM boards WHERE link = ? LIMIT 1',
      [link]
    );
    if (rows.length > 0) {
      return {
        isDuplicate: true,
        message: '이미 등록된 활동이에요!'
      };
    }
    return {
      isDuplicate: false
    };
  } catch (error) {
    console.error('[중복 게시물 검사 실패]', error);
    throw error;
  }
}

/**
 * 전체 링크 검사
 */
async function link_validate(link) {
  // 도메인 패턴 검사
  const domainResult = await validateDomain(link);

  if (!domainResult.allowed) {
    return {
      valid: false,
      message: domainResult.message
    };
  }

  // 링크 중복 검사
  const duplicateResult = await checkDuplicateLink(link);

  if (duplicateResult.isDuplicate) {
    return {
      valid: false,
      message: duplicateResult.message
    };
  }

  return {
    valid: true,
    domain: domainResult.domain
  };
}

module.exports = {
  validateDomain,
  checkDuplicateLink,
  link_validate
};
