# 제출까지 남은 순서 (오늘 21:00 목표)

## 1. 로컬에서 빌드 & 테스트 (5분)
```bash
cd C:\Users\metab\Desktop\dev\giwa
npm install
npm test        # 컴파일 + 규칙 테스트
npm run demo    # 로컬 체인에서 4장면 시나리오 재생
```
`npm test` 통과 화면을 캡처해 두세요. 신청서 첨부용입니다.

## 2. GIWA Sepolia 배포 (15분)
1. 메타마스크에 GIWA Sepolia 추가 — Chain ID `91342`, RPC `https://sepolia-rpc.giwa.io`
   (익스플로러 https://sepolia-explorer.giwa.io 하단 버튼으로 한 번에 추가 가능)
2. Ethereum Sepolia 포시트에서 테스트 ETH를 받고 GIWA 브릿지로 넘깁니다.
3. 배포:
```bash
set PRIVATE_KEY=0x...        # PowerShell: $env:PRIVATE_KEY="0x..."
npm run deploy
```
4. 출력된 익스플로러 링크를 복사해 둡니다. **이게 신청서의 핵심 증거입니다.**

## 3. 데모 영상 2분 (30분)
`PAUSE=1500 npm run demo` 를 화면 녹화하면 그대로 영상이 됩니다.
대시보드(`npm run web`)를 함께 보여주면 더 좋습니다.
마지막 20초에 반드시 "왜 GIWA인가" — 도장 KYC / 업비트 온램프 / L2 수수료.

## 4. 깃허브 공개 (10분)
```bash
git init && git add -A && git commit -m "INGAM: delegation payment layer for AI agents on GIWA"
```
`build/`, `node_modules/`, `deployed.json`은 .gitignore 처리했습니다.
**PRIVATE_KEY는 절대 커밋하지 마세요.**

## 5. 신청서 작성 (60분)
`APPLICATION_KO.md`를 열고 항목별로 옮겨 붙이되, **본인 말투로 고쳐 쓰세요.**
직접 채워야 하는 항목(팀 소개, 링크, 연락처)이 문서 하단에 체크리스트로 있습니다.

신청: https://ds.fdback.me/r/bLHPv694o6Au3
문의: support@giwa.io

## 6. 21:00 제출
마감은 23:59:59이지만 마감 직전 트래픽을 피하세요.
중복 신청이 허용되므로, 여유가 있으면 예비 아이디어도 별도 제출 가능합니다.
