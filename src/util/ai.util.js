const { GoogleGenerativeAI } = require('@google/generative-ai');

const ai = new GoogleGenerativeAI(process.env.OPENAI_API_KEY);

/**
 * 1차 검사: 제목과 내용의 일치도 검증
 */
async function verifyTitleContentMatch(title, content) {
  try {
    const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

    const prompt = `당신은 게시글의 제목과 내용이 일치하는지 검증하는 전문가입니다.
    다음 게시글의 제목과 내용을 분석하여 유사도를 판단해주세요.
    제목과 내용의 주제가 완전히 다르거나, 서로 모순될 때, 서로 다른 이슈를 말할 때, 스팸, 광고, 무관한 홍보 글일 경우 낮은 일치 또는 불일치를 주세요.
    내용이 아주 짧거나, "자세한 내용은 링크를 참고"처럼 요약/안내만 있는 경우, 즉 제목과 모순되지는 않고 자연스럽게 이해되는 경우는 최소 0.4 이상을 부여하세요.
    0.4 미만이면 일치하지 않는 것으로 간주합니다.
    
    **제목**: ${title}

    **내용**: ${content}

    다음 JSON 형식으로만 응답해주세요:
    {
      "similarity_score": 0.0에서 1.0 사이의 숫자 (0: 전혀 관련없음, 1: 완전히 일치),
      "reason": "유사도 판단 이유를 한 문장으로 설명"
    }

    반드시 위 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요.`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('JSON 형식이 없습니다.');
    }

    const aiResponse = JSON.parse(jsonMatch[0]);
    const score = parseFloat(aiResponse.similarity_score);

    // 콘솔 로그 
    console.log('[AI 1차 검사] 제목-내용 일치도:', {
      score,
      result: score >= 0.4 ? 'PASS' : 'FAIL',
      reason: aiResponse.reason
    });

    // 결과
    if (score < 0.4) {
      return {
        pass: false,
        score,
        message: '게시글 제목과 내용이 일치하지 않습니다. 내용을 확인해주세요'
      };
    }

    return {
      pass: true,
      score
    };

  } catch (error) {
    console.error('[AI 1차 검사 실패]', error);

    return {
      pass: false,
      message: 'AI 검증 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
    };
  }
}

/**
 * 2차 검사: 첨부 링크 내용과 게시글 내용 비교
 */
async function verifyLinkContent(title, content, crawledText) {
  try {
    const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    const prompt = `
    당신은 게시글 내용과 첨부된 링크의 내용을 비교하여 일치 여부를 검증하는 전문가입니다.
    다음을 분석해주세요:

    **게시글 제목**: ${title}

    **게시글 내용**: ${content}

    **첨부된 링크의 내용** (크롤링): ${crawledText}

    다음 항목을 검증해주세요:
    1. **주제 일치**: 게시글과 링크의 주제가 같은가?
    2. **어조 왜곡**: 게시글이 링크의 의도를 왜곡하거나 과장했는가?

    다음 JSON 형식으로만 응답해주세요:
    {
      "topic_match": true 또는 false,
      "tone_distortion": true 또는 false (왜곡이 있으면 true),
      "reason": "판단 이유를 간단히 설명"
    }

    반드시 위 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요.`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('JSON 형식이 없습니다.');
    }

    const aiResponse = JSON.parse(jsonMatch[0]);

    const failed = !aiResponse.topic_match || aiResponse.tone_distortion;

    // 콘솔 로그 출력
    console.log('[AI 2차 검사] 게시글-링크 검증 ', {
      result: failed ? 'FAIL' : 'PASS',
      topicMatch: aiResponse.topic_match,
      toneDistortion: aiResponse.tone_distortion,
      reason: aiResponse.reason
    });

    if (failed) {
      return {
        pass: false,
        message: '첨부된 링크 내용이 게시글 내용과 다릅니다'
      };
    }

    return {
      pass: true
    };

  } catch (error) {
    console.error('[AI 2차 검사 실패]', error);

    return {
      pass: false,
      message: 'AI 검증 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
    };
  }
}

/**
 * 3차 검사: 게시물 내용의 독소조항/유해표현 검출
 */
async function verifyHarmfulContent(title, content, crawledText) {
  try {
    const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    const prompt = `당신은 게시글과 크롤링된 텍스트에서 독소 조항/유해 표현을 탐지하는 전문가입니다.
    다음 텍스트들을 분석해주세요:

    **게시글 제목**: ${title}

    **게시글 내용**: ${content}

    **크롤링된 링크 내용**: ${crawledText}

    다음 유해 표현을 탐지해주세요:
    1. **혐오 표현**: 특정 집단(성별, 인종, 종교, 지역 등)에 대한 혐오
    2. **차별 표현**: 부당한 차별을 조장하는 표현
    3. **폭력 표현**: 폭력을 조장하거나 미화하는 표현

    다음 JSON 형식으로만 응답해주세요:
    {
      "has_harmful_content": true 또는 false,
      "harmful_types": ["혐오", "차별", "폭력"] 중 해당하는 것만 배열로,
      "reason": "탐지 이유를 간단히 설명"
    }

    반드시 위 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요.
`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('JSON 형식이 없습니다.');
    }

    const aiResponse = JSON.parse(jsonMatch[0]);

    // 콘솔 로그
    console.log('[AI 3차 검사] 독소조항/유해표현 검출', {
      result: aiResponse.has_harmful_content ? 'FAIL' : 'PASS',
      hasHarmful: aiResponse.has_harmful_content,
      harmfulTypes: aiResponse.harmful_types,
      reason: aiResponse.reason
    });

    if (aiResponse.has_harmful_content) {
      return {
        pass: false,
        message: '부적절한 표현이 감지되어 등록이 제한되었습니다.'
      };
    }

    return {
      pass: true
    };

  } catch (error) {
    console.error('[AI 3차 검사 실패]', error);

    return {
      pass: false,
      message: 'AI 검증 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
    };
  }
}

/**
 * 전체 AI 검사 (1차 → 2차 → 3차)
 */
async function ai_validate(data) {
  const { title, content, link, crawledText } = data;

  console.log('[AI 검사 시작] ', { title, link });

  // 1차 검사
  const step1 = await verifyTitleContentMatch(title, content);
  if (!step1.pass) {
    return {
      pass: false,
      step: 1,
      message: step1.message
    };
  }

  // 2차 검사 - 크롤링 성공한 경우에만
  if (crawledText) {
    const step2 = await verifyLinkContent(title, content, crawledText);
    if (!step2.pass) {
      return {
        pass: false,
        step: 2,
        message: step2.message
      };
    }
    } else {
    console.log('[AI 검사] 크롤링 실패로 2차 검사 스킵');
  }

  // 3차 검사
  const step3 = await verifyHarmfulContent(title, content, crawledText);
  if (!step3.pass) {
    return {
      pass: false,
      step: 3,
      message: step3.message
    };
  }

  return {
    pass: true
  };
}

module.exports = {
  verifyTitleContentMatch,
  verifyLinkContent,
  verifyHarmfulContent,
  ai_validate
};
