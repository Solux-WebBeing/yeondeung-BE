const mysql = require('mysql2/promise');

// createPool을 사용하면 매번 새로운 연결을 생성하는 대신, 기존 연결을 재사용하여 효율적입니다.
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;