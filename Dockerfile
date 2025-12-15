# 1. 베이스 이미지 선택 (Node.js 18 버전 사용 예시)
FROM node:20-alpine

# 2. 앱 디렉터리 생성 및 작업 폴더로 지정
WORKDIR /usr/src/app

# 3. package.json 파일을 먼저 복사 (의존성 캐시 활용)
COPY package*.json ./

# 4. 의존성 설치
RUN npm install

# 5. 프로젝트의 모든 소스 코드 복사
COPY . .

# 6. (선택) 앱이 사용하는 포트 명시
EXPOSE 8000

# 7. 컨테이너가 시작될 때 실행할 명령어
CMD [ "node", "app.js" ]