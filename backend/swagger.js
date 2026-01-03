const swaggerJsdoc = require('swagger-jsdoc');

// 환경 변수에 따라 기본 URL 설정 (없으면 로컬을 기본으로)
const serverUrl = process.env.NODE_ENV === 'production' 
  ? 'http://3.36.147.62:8000' 
  : 'http://localhost:8000';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Yeondeung-BE API',
      version: '1.0.0',
      description: '연등 : 연대의 등불 백엔드 API 문서입니다.',
    },
    // 서버 설정을 동적으로 변경
    servers: [
      {
        url: serverUrl,
        description: process.env.NODE_ENV === 'production' ? '실제 배포 서버' : '로컬 개발 서버',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: ['./src/routes/*.js'], 
};

const specs = swaggerJsdoc(options);
module.exports = specs;