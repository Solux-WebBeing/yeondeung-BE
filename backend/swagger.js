const swaggerJsdoc = require('swagger-jsdoc');

// 두 서버 정보를 모두 정의합니다.
const productionServer = {
  url: 'https://yeondeung-be.duckdns.org',
  description: '실제 배포 서버',
};

const localServer = {
  url: 'http://localhost:8000',
  description: '로컬 개발 서버',
};

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Yeondeung-BE API',
      version: '1.0.0',
      description: '연등 : 연대의 등불 백엔드 API 문서입니다.',
    },
    // servers 배열에 두 개를 모두 넣어야 토글이 생깁니다.
    // 현재 환경(production)에 따라 첫 번째 요소를 결정합니다.
    servers: process.env.NODE_ENV === 'production' 
      ? [productionServer, localServer] 
      : [localServer, productionServer],
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