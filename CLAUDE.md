# INGAM (인감) — 프로젝트 컨텍스트

Claude Code 인수인계 문서. 새 세션은 이 파일부터 읽으세요.

## 무엇을 하는 프로젝트인가

AI 에이전트에게 결제 권한을 위임하되, **얼마까지 · 어디에 · 언제까지** 쓸 수 있는지를
스마트 컨트랙트가 강제하고, 위임자가 언제든 트랜잭션 1건으로 회수하는 레이어.

핵심 주장: **규칙이 앱이나 서버가 아니라 체인에 있다.**
에이전트가 프롬프트 인젝션으로 탈취돼도, 서버가 죽어도, 만든 사람이 사라져도 한도는 뚫리지 않는다.

## 왜 하고 있나 — 마감이 걸린 작업

**UPBIT x GIWA 빌더 성장지원 프로그램 GASOK(가속)** 지원용.

| 항목 | 값 |
|---|---|
| 트랙 | 4. AI / Web3 |
| 신청 마감 | **2026-07-31 23:59:59 KST** (제출 목표 21:00) |
| 신청 링크 | https://ds.fdback.me/r/bLHPv694o6Au3 |
| 소개 페이지 | https://giwa.io/gasok |
| 선발 발표 | 2026-08-14 이내 |
| 혜택 | 팀당 최대 10만 달러 (데모데이 우승 시 초기 2만 + KPI 달성 시 최대 8만) |
| 문의 | support@giwa.io |

중복 신청 허용. 예비 아이디어는 "AI 생성물 출처 증명 레지스트리".

## 심사에서 갈리는 지점 — 이걸 놓치면 다 무너짐

**"왜 하필 GIWA여야 하는가."** 다른 체인에서도 되는 아이디어면 떨어집니다.
INGAM은 네 가지가 동시에 필요해서 GIWA에서만 성립한다고 주장합니다:

1. **도장(Dojang)** — KYC 라이선스 기관이 발급하는 온체인 검증. 위임의 뿌리.
   다른 체인은 익명 지갑이 익명 지갑에 권한을 넘기는 것이라 '위임'이 성립하지 않음.
2. **업비트 온램프** — 위임 금고 첫 충전의 마찰 제거.
3. **L2 수수료** — 에이전트 결제는 소액·고빈도. 메인넷은 수수료가 결제액보다 큼.
4. **기와 월렛** — 회수 버튼이 사용자가 매일 여는 앱 안에 있어야 의미가 있음.

문서를 고칠 때 이 논리를 약화시키지 마세요.

## 네트워크 (공식 문서 확인 완료)

| 항목 | 값 |
|---|---|
| 체인 | GIWA Sepolia (OP Stack 기반 이더리움 L2) |
| Chain ID | `91342` |
| RPC | `https://sepolia-rpc.giwa.io` |
| 익스플로러 | `https://sepolia-explorer.giwa.io` |
| 통화 | ETH |

출처: https://docs.giwa.io/giwa-chain/en/get-started/connect-to-giwa

## 파일 구조

```
contracts/DelegationVault.sol   핵심 컨트랙트 (331줄, 외부 의존성 0)
compile.js                      solc 컴파일 → build/DelegationVault.json
test.js                         규칙 검증 스위트 (ganache 기반, 28개 단언)
script/deploy.js                GIWA Sepolia 배포 → deployed.json + web/deployed.json
script/demo.js                  데모데이 4장면 시나리오 (영상용)
script/serve.js                 web/ 정적 서버 (포트 5173)
web/index.html                  대시보드 단일 파일 (ethers esm.sh CDN, 메타마스크)
APPLICATION_KO.md               지원서 본문 초안 ← 제출의 핵심
TEAM.md                         팀 소개 (대괄호 [ ] 부분 미기입)
SUBMIT.md                       제출까지 6단계 체크리스트
```

## 컨트랙트 설계에서 신경 쓴 것

- **위임 회차(nonce)** — 재발급 시 `delegationId`가 바뀌어 예전 화이트리스트가 되살아나지 않음
- **위임자 출금 우선권** — 위임이 살아 있어도 위임자는 언제든 자금 회수 가능
- **재진입 가드 + Checks-Effects-Interactions** — 상태 갱신 후 송금
- **커스텀 에러** — 왜 막혔는지가 숫자와 함께 반환됨. 데모에서 이게 잘 보임
- **`canSpend()`** — 실행 전 사전 조회. 에이전트와 UI가 호출
- **MVP 범위** — 네이티브 코인만. ERC20 / 도장 연동 / 기와 월렛 연동은 Phase 1

## 명령어

```bash
npm install
npm test           # 컴파일 + 규칙 테스트
npm run demo       # 로컬 체인에서 4장면 재생 (PAUSE=1500 으로 속도 조절)
npm run web        # http://localhost:5173
PRIVATE_KEY=0x... npm run deploy    # GIWA Sepolia 배포
```

## 현재 상태 (2026-07-31 기준)

**완료**

- 컨트랙트, 테스트, 배포 스크립트, 데모 스크립트, 대시보드, 지원서 초안, 팀 문서
- git 초기화 + 커밋 1개 (`main` 브랜치), remote `origin` = `https://github.com/koobo7/upbit-giwa.git`
- 도메인 `upbit-giwa.metabox.pro` — DNS/프록시는 응답하나 **본문이 비어 있음** (배포 전)

**미완료 — 다음 세션이 할 일**

1. `git push -u origin main` — 아직 푸시 안 됨
2. Cloudflare Pages 설정 확인
   - Build command: 비움 / Output directory: `web` / Production branch: `main`
3. `npm install && npm test` 실제 통과 확인 (아직 로컬에서 안 돌려봄)
4. **`TEAM.md`의 대괄호 `[ ]` 채우기** — 이름, 경력, GitHub 아이디, 링크
5. `APPLICATION_KO.md` 하단 체크리스트 항목 채우기
6. 데모 영상 2분 녹화
7. 신청서 제출 (21:00 목표)
8. *(선택, 제출 후로 미룸)* 컨트랙트를 GIWA Sepolia에 배포하고 `web/deployed.json` 커밋

## 작업 시 지켜야 할 것

- **프라이빗 키를 파일에 쓰거나 커밋하지 마세요.** `.gitignore`에 `.env` 포함돼 있음.
  배포는 사용자가 직접 환경변수로 실행합니다.
- **지원서 문장을 사용자 말투로 고치라고 안내하세요.** 심사위원은 기계가 쓴 글을 알아봅니다.
  더 중요한 건 선발 시 KBW에서 직접 발표해야 한다는 점 — 본인이 설명 못 할 문장은 빼야 합니다.
- **KPI 숫자는 지킬 수 있는 선으로.** 보너스 그랜트 8만 달러가 KPI 달성에 걸려 있어
  과하게 부르면 나중에 못 받습니다.
- `deployed.json`은 루트 사본은 gitignore, `web/` 사본은 커밋 (Pages가 읽어야 함).

## 알려진 환경 제약

이 프로젝트를 만든 Cowork 세션의 샌드박스는 npm 레지스트리와 github.com이 차단돼 있었습니다.
그래서 **컴파일·테스트·푸시가 실제로 실행된 적이 없습니다.**
JS 문법 검사(`node --check`)와 Solidity 코드 리뷰만 마친 상태입니다.
Claude Code에서는 로컬 네트워크를 쓸 수 있으니 `npm test`를 가장 먼저 돌려서
실제로 통과하는지 확인하세요. 여기서 실패가 나올 가능성이 있습니다.
