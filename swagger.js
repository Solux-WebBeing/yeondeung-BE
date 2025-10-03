const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Yeondeung-BE API',
      version: '1.0.0',
      description: '연등 : 연대의 등불 백엔드 API 문서입니다.',
    },
    servers: [
      {
        url: 'http://localhost:8000', // 개발 서버
      },
    ],
    // --- 인증 방식 정의 추가 ---
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

