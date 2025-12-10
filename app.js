// 1. dotenv 설정
require('dotenv').config();

// 2. 필요한 모듈들을 불러옵니다.
const express = require('express');
const path = require('path'); // path 모듈
const swaggerUi = require('swagger-ui-express'); // swagger-ui-express 불러오기
const specs = require('./swagger'); // swagger.js 파일에서 specs 가져오기 (경로는 실제 위치에 맞게 수정)

// 3. Express 앱을 생성하고 포트를 설정합니다.
const app = express();
const port = process.env.PORT || 8000;

// 4. 미들웨어 설정
app.use(express.json());

// --- 정적 파일 제공 ---
// 'public' 폴더를 정적 파일 디렉토리로 설정합니다.
// (예: http://localhost:8000/admin.html)
app.use(express.static(path.join(__dirname, 'public')));
// -----------------------------

// 5. Swagger UI 설정
// 이 경로로 접속하면 API 문서를 볼 수 있습니다.
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

// 6. 라우터 설정
// 기본 '/' 경로는 express.static이 처리하도록 주석 처리하거나 삭제합니다.
// app.get('/', (req, res) => {
//   res.send('Hello, World!');
// });

const userRoutes = require('./src/routes/user.routes');
const adminRoutes = require('./src/routes/admin.routes'); 
const boardRoutes = require('./src/routes/board.routes');
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes); // admin 라우터 연결
app.use('/api/boards', boardRoutes);

// 7. 서버 실행
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
  // [추가] 편의를 위한 접속 경로 안내
  console.log(`Admin panel available at http://localhost:${port}/admin.html`); 
  console.log(`API Docs available at http://localhost:${port}/api-docs`);
});