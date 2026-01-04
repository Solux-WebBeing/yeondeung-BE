// 1. dotenv 설정
require('dotenv').config();

// 2. 필요한 모듈들
const express = require('express');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const specs = require('./swagger'); 
const cors = require('cors');

// 3. Express 앱 생성
const app = express();
const port = process.env.PORT || 8000;
const { startCleanupTask, startMailingTask } = require('./src/util/scheduler');
startCleanupTask();
startMailingTask();

// 4. [수정] CORS 설정: .env의 ALLOWED_ORIGINS를 읽어서 처리
const rawOrigins = process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:8000';
const allowedOrigins = rawOrigins.split(',').map(origin => origin.trim());

const corsOptions = {
  origin: function (origin, callback) {
    // origin이 없거나(Postman 등), 허용 목록에 있으면 통과
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS 정책에 의해 차단된 출처입니다.'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

// 5. 정적 파일 제공
app.use(express.static(path.join(__dirname, 'public')));

// 6. Swagger UI 설정
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

// 7. 라우터 설정
const userRoutes = require('./src/routes/user.routes');
const adminRoutes = require('./src/routes/admin.routes'); 
const boardRoutes = require('./src/routes/board.routes');
const searchRoutes = require('./src/routes/search.routes');
const mainRouter = require('./src/routes/main.routes');

app.use('/api/search', searchRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/boards', boardRoutes);
app.use('/api/main', mainRouter);

// 8. 서버 실행
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Allowed Origins: ${allowedOrigins.join(', ')}`);
});