# caffeineworks-mcp

카페인웍스 MCP 서버 — Cloudflare Workers 기반

## 기능

- 세션 내 서비스 소개 (회사 정보, 로고, 서비스 체계 다이어그램)
- 세션 내 폼 렌더링을 통한 서비스 문의 접수
- 접수번호 발급 및 Google Sheets 저장
- 접수번호로 피드백 조회

## 서비스 구조

- **Deep Exploration** — 시장·산업·사용자·경쟁 심층 조사분석 (건별 계약)
- **Business Redesign** — 상품경쟁력·개발체계·AX 혁신 컨설팅 (건별 계약)
- **Brain Reshoring** — AI 의존 인지 외주화 대응 오프라인 훈련 (인당 15만원, VAT 별도, 20명 이상)

## 파일 구조

```
caffeineworks-mcp/
├── README.md
├── wrangler.toml
├── package.json
├── src/
│   └── index.js
├── assets/
│   ├── logo_old.png
│   ├── logo_new.png
│   └── services.mmd
└── data/
    └── company.json
```

## 환경변수 (Cloudflare Dashboard에서 설정)

- `SHEETS_API_KEY` — Google Sheets API 키
- `INQUIRY_SHEET_ID` — customer_inquiry 시트 ID
- `FEEDBACK_SHEET_ID` — customer_feedback 시트 ID

## 배포

```bash
npm install
npx wrangler deploy
```
