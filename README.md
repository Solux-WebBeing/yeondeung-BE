# YEONDEUNG-BE (연등 백엔드)


## 🚀 개발 환경 실행 방법

이 프로젝트는 Docker Compose를 사용하여 모든 개발 환경을 1분 안에 구축할 수 있습니다.

1.  **Docker Desktop**을 설치하고 실행합니다.

2.  이 저장소(repository)를 `git clone` 받습니다.
    ```bash
    git clone [https://github.com/your-username/yeondeung-BE.git](https://github.com/your-username/yeondeung-BE.git)
    cd yeondeung-BE
    ```

3.  **.env 파일 생성**
    `.env.example` 파일을 복사하여 `.env` 파일을 만듭니다.
    ```bash
    cp .env.example .env
    ```

4.  **.env 파일 수정**
    방금 생성한 `.env` 파일을 열어, 비어있는 `DB_PASSWORD`와 `JWT_SECRET` 값을 (팀원 간에 공유된) 실제 값으로 채워넣습니다.

5.  **Docker 컨테이너 실행**
    ```bash
    docker-compose up -d --build #코드 수정시 빌드 필요 (코드 수정 없이 그냥 확인만 필요하면 옵션 제거)
    ```

6.  완료! 브라우저에서 `http://localhost:8000/api-docs`으로 접속하세요. (swagger에서 api 테스트 가능)
