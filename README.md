# 🕯️ 연등 - 백엔드 레포지토리
```textplain
〔  ＼│/  〕   흩어진 연대를 잇는 따뜻한 불빛
(  연  등  )   연대 활동 정보의 모든 것, 
 "*. __ .*"    지금 바로 [연등]에서 확인하세요.
```
## 팀원 소개
| 홍서현 | 곽해림 | 송서현 |
|--------|--------|--------|
| BE Lead     | BE     | BE     |
| [@SH38038038](https://github.com/SH38038038) | [@Tulipurple](https://github.com/Tulipurple) | [@Hiimynameiss](https://github.com/Hiimynameiss) |
| <img src="https://avatars.githubusercontent.com/SH38038038" width="100"> | <img src="https://avatars.githubusercontent.com/Tulipurple" width="100"> | <img src="https://avatars.githubusercontent.com/Hiimynameiss" width="100"> 

# 시스템 아키텍처
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
