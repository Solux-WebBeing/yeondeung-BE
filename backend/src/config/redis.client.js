const Redis = require('ioredis');
require('dotenv').config();

// 도커 컴포즈의 서비스 이름인 'redis'를 host로 사용합니다.
const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: process.env.REDIS_PORT || 6379,
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

redis.on('connect', () => console.log('Redis 연결 성공'));
redis.on('error', (err) => console.error('Redis 에러:', err));

module.exports = redis;