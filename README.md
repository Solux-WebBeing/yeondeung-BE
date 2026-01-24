# 🕯️ 연등 - 백엔드 레포지토리
```textplain
〔  ＼│/  〕   흩어진 연대를 잇는 따뜻한 불빛
(  연  등  )   연대 활동 정보의 모든 것, 
 "*. __ .*"    지금 바로 [연등]에서 확인하세요.
```

## 👥 팀원 소개
| 홍서현 | 곽해림 | 송서현 |
| :---: | :---: | :---: |
| **BE Lead** | **BE** | **BE** |
| [@SH38038038](https://github.com/SH38038038) | [@Tulipurple](https://github.com/Tulipurple) | [@Hiimynameiss](https://github.com/Hiimynameiss) |
| <img src="https://avatars.githubusercontent.com/SH38038038" width="100"> | <img src="https://avatars.githubusercontent.com/Tulipurple" width="100"> | <img src="https://avatars.githubusercontent.com/Hiimynameiss" width="100"> |
| <small>🔎 인증 · 검색 · 배포</small> | <small>🤖 LLM · 크롤링 · 메일</small> | <small>📝 게시글 · 알림 · 관리자</small> |

---

## 🛠️ 기술 스택 (Tech Stack)

| Category                 | Technology                                                                                                                                                                                                                         | Reason                             |
| :----------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------- |
| 🧑‍💻 **Backend**        | <a><img src="https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white"/></a><br><a><img src="https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white"/></a> | REST API 서버 구성 및 비동기 기반 고성능 요청 처리  |
| 💾 **Database / Cache**  | <a><img src="https://img.shields.io/badge/MySQL-4479A1?style=flat-square&logo=mysql&logoColor=white"/></a><br><a><img src="https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white"/></a>           | 관계형 데이터 영속화 및 인메모리 캐시를 통한 응답 성능 개선 |
| 🔎 **Search**            | <a><img src="https://img.shields.io/badge/Elasticsearch-005571?style=flat-square&logo=elasticsearch&logoColor=white"/></a>                                                                                                         | 한글 형태소 분석 기반 대용량 텍스트 인덱싱 및 검색 최적화  |
| 🤖 **AI / Intelligence** | <a><img src="https://img.shields.io/badge/OpenAI-412991?style=flat-square&logo=openai&logoColor=white"/></a>                                                                                                                       | 사용자 입력 분석 및 자동 응답 · 가이드 생성 기능 구현   |
| ☁️ **Infra**             | <a><img src="https://img.shields.io/badge/AWS-FF9900?style=flat-square&logo=amazonaws&logoColor=white"/></a><br><a><img src="https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white"/></a>       | 컨테이너 기반 서비스 배포 및 격리된 실행 환경 구성      |
| 🌐 **Network**           | <a><img src="https://img.shields.io/badge/Firebase-FFCA28?style=flat-square&logo=firebase&logoColor=black"/></a>                                                                                                                   | 클라이언트 요청 프록시 처리로 백엔드 엔드포인트 은닉      |
| 🔒 **Security**          | <a><img src="https://img.shields.io/badge/Let's_Encrypt-0097A7?style=flat-square&logo=letsencrypt&logoColor=white"/></a>                                                                                                           | HTTPS 인증서 자동 발급 및 갱신을 통한 전 구간 암호화  |

---

## 🧩 시스템 아키텍처
```mermaid
flowchart TD
    %% --- 디자인 시스템 ---
    classDef edge fill:#E1F5FE,stroke:#01579B,stroke-width:2px
    classDef aws fill:#FFF3E0,stroke:#E65100,stroke-width:2px
    classDef logic fill:#F3E5F5,stroke:#7B1FA2,stroke-width:2px
    classDef data fill:#E8F5E9,stroke:#2E7D32,stroke-width:2px
    classDef ai fill:#E0F2F1,stroke:#00796B,stroke-width:2px,stroke-dasharray: 5 5

    subgraph Global_Edge ["🌍 Layer 7: Frontend & Masking"]
        User(("👤 User\n(Browser)"))
        FB_H["🔥 Firebase Hosting\n(Static Assets)"]:::edge
        FB_R["🛡️ Cloud Rewrites\n(API Masking Proxy)"]:::edge
    end

    subgraph AWS_EC2 ["☁️ AWS Hardened Host (Docker Engine)"]
        direction TB
        
        subgraph Security_Gate ["🔒 Security Layer"]
            Cert_Bot["🔒 Certbot\n(SSL Auto-Renewal)"]:::aws
            DuckDNS["🦆 DuckDNS\n(DDNS Endpoint)"]:::aws
        end

        subgraph Container_Mesh ["🐳 Isolated Docker Network"]
            direction TB
            subgraph App_Cluster ["🧠 Logic Tier"]
                Node_App["🧩 Node.js API\n(SSL Termination)"]:::logic
                AI_Logic["🤖 OpenAI Pipeline"]:::ai
            end
            
            subgraph Data_Tier ["💾 Persistence Tier"]
                direction LR
                MySQL[("🐬 MySQL 8.0")]:::data
                Redis[("🔴 Redis Cache")]:::data
                ES[("🔎 Elasticsearch")]:::data
            end
        end
    end

    Gemini_API[("🧠 OpenAI API")]:::ai

    %% --- 데이터 흐름 ---
    User -- "HTTPS / TLS 1.3" --> FB_H
    FB_H -- "Path Masking" --> FB_R
    FB_R == "Secure Tunnel" ==> DuckDNS
    
    DuckDNS --> Node_App
    Cert_Bot -. "SSL Certificate" .-> Node_App
    
    Node_App <--> AI_Logic
    AI_Logic -- "External Request" --> Gemini_API
    
    Node_App <--> MySQL
    Node_App <--> Redis
    Node_App <--> ES

    %% CI/CD
    GHA["⚙️ GH Actions"] -. "Deploy" .-> FB_H
    GHA -. "Docker Push/Up" .-> Node_App
```

