const cron = require('node-cron');
const { Client } = require('@elastic/elasticsearch');
const esClient = new Client({ node: process.env.ELASTICSEARCH_NODE || 'http://elasticsearch:9200' });

/**
 * 정기 데이터 정리 작업 (매일 00:00 자정 실행)
 */
const startCleanupTask = () => {
    // 크론 표현식 수정: 분(0) 시(0) 일(*) 월(*) 요일(*)
    // '0 0 * * *' 은 매일 밤 12시 0분 0초를 의미합니다.
    cron.schedule('0 0 * * *', async () => {
        try {
            console.log(`[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] 자정 데이터 정리 시작 (30일 경과 데이터 삭제)`);

            const response = await esClient.deleteByQuery({
                index: 'boards',
                refresh: true,
                body: {
                    query: {
                        range: {
                            end_date: {
                                lt: "now-30d/d" // 종료일로부터 30일이 지난 데이터 삭제
                            }
                        }
                    }
                }
            });

            console.log(`정리 완료: ${response.deleted}개의 만료된 게시글이 삭제되었습니다.`);
        } catch (error) {
            console.error('자정 스케줄러 작업 중 오류 발생:', error);
        }
    }, {
        scheduled: true,
        timezone: "Asia/Seoul" // 반드시 한국 시간 기준으로 설정
    });

    console.log('매일 자정(00:00) ELK 데이터 정리 스케줄러가 활성화되었습니다.');
};

module.exports = { startCleanupTask };