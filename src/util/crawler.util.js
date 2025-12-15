const axios = require('axios');
const cheerio = require('cheerio');
const MAX_TEXT_LENGTH = 5000;

async function fetchHTML(url) {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    timeout: 10000
  });
  return response.data;
}

function extractContent($, selector) {
  const paragraphs = [];
  $(selector).each((i, el) => {
    const text = $(el).text().trim();
    if (text && text !== '\u00A0') { paragraphs.push(text);}
  });
  return paragraphs.join('\n').replace(/[ \t]+/g, ' ').trim();
}

/**
 * 청원24
 */
async function crawl청원24(url) {
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const title = $('#titles').text().trim();
  const content = extractContent($, '#ptnCns p');

  return { title, content };
}

/**
 * 구글 폼
 */
async function crawl구글폼(url) {
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const title = $('.F9yp7e.ikZYwf.LgNcQe').text().trim();
  const content = $('.cBGGJ.OIC90c').text().trim();

  return { title, content };
}

/**
 * 국회입법예고
 */
async function crawl입법(url) {
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const title = $('.legislation-heading h3').text().trim();
  const content = $('.desc').text().replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n').trim();

  return { title, content };
}

/**
 * 메인 크롤링
 */
const pickcrawler = {
  '청원24': crawl청원24,
  '구글 폼': crawl구글폼,
  '구글 폼(단축주소)': crawl구글폼,
  '국회입법예고': crawl입법,
  '국회전자청원': crawl입법
};

async function crawlUrl(url, domainInfo = null) {
  try {
    console.log(`크롤링 시작: ${url}`);

    const crawlerFn = pickcrawler[domainInfo.site_name];
    const result = await crawlerFn(url);

    const parts = [];
    if (result.title?.length) parts.push(`제목: ${result.title}`);
    if (result.content?.length) parts.push(`내용: ${result.content}`);

    let text = parts.join('\n');

    if (!text || text.length < 10) {
      return { success: false, error: '유효한 텍스트를 크롤링하지 못했습니다.' };
    }

    if (text.length > MAX_TEXT_LENGTH) {
      text = text.substring(0, MAX_TEXT_LENGTH) + '...(이하 생략)';
    }

    console.log(`크롤링 성공`);
    return { success: true, text };

  } catch (error) {
    console.error('크롤링 오류:', error);

    if (error.code === 'ECONNABORTED') {
      return { success: false, error: '크롤링 시간이 초과되었습니다.' };
    }
    return { success: false, error: error.message || '크롤링 오류' };
  }
}

module.exports = {
  crawlUrl
};
