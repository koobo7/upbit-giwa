<img src="web/seal.svg" alt="인감" width="110" align="right" />

# INGAM (인감)

**AI 에이전트를 위한 위임 결제 레이어** — GIWA 체인 위에서 동작합니다.

AI 에이전트에게 지갑을 맡기되, 얼마까지·어디에·언제까지 쓸 수 있는지를 스마트 컨트랙트가 강제합니다. 규칙이 앱이나 서버가 아니라 체인에 있기 때문에, 에이전트가 프롬프트 인젝션으로 탈취되어도, 서버가 죽어도, 만든 사람이 사라져도 한도는 뚫리지 않습니다.

GASOK(가속) 프로그램 · 트랙 4 (AI / Web3) 지원 프로젝트.

---

## 지금 당장 돌려보기

설치 없이 로컬 체인에서 전체 시나리오가 돌아갑니다.

```bash
npm install
npm run build      # 컨트랙트 컴파일
npm test           # 34개 규칙 테스트
npm run demo       # 로컬 체인에서 전체 시나리오 재생
```

## GIWA Sepolia 테스트넷에 배포

GIWA는 OP Stack 기반 EVM 체인이라 기존 이더리움 툴체인이 그대로 동작합니다.

| 항목 | 값 |
|---|---|
| 체인 이름 | GIWA Sepolia |
| Chain ID | `91342` |
| RPC | `https://sepolia-rpc.giwa.io` |
| 익스플로러 | `https://sepolia-explorer.giwa.io` |
| 통화 | ETH |

테스트 ETH는 Ethereum Sepolia 포시트에서 받아 GIWA 브릿지로 넘기거나,
익스플로러 하단의 브릿지/포시트 링크를 이용하세요.

```bash
PRIVATE_KEY=0x<배포 지갑 키> npm run deploy
```

RPC는 기본값이 GIWA Sepolia입니다. 다른 곳에 배포하려면 `RPC_URL`로 덮어쓰세요.
배포되면 `deployed.json`이 생기고, 데모와 대시보드가 그 주소를 읽습니다.

```bash
PRIVATE_KEY=0x<...> AGENT_KEY=0x<에이전트 지갑 키> npm run demo
```

## 웹 대시보드

```bash
npm run web        # http://localhost:5173   (PORT=8080 npm run web 로 변경 가능)
```

메타마스크를 연결하면 GIWA Sepolia로 자동 전환(없으면 추가)합니다.
위임 발급 → 실시간 한도 게이지 → 즉시 회수 → 온체인 감사 로그가 한 화면에 있습니다.
컨트랙트 주소는 `web/deployed.json`에서 자동으로 읽고, 없으면 `?vault=0x...` 쿼리로 넘길 수 있습니다.

### Cloudflare Pages 배포 (upbit-giwa.metabox.pro)

`web/`은 빌드가 필요 없는 정적 디렉터리입니다.

| 설정 | 값 |
|---|---|
| Framework preset | None |
| Build command | *(비움)* |
| Build output directory | `web` |
| Custom domain | `upbit-giwa.metabox.pro` |

배포 전에 `npm run deploy`를 먼저 돌려 `web/deployed.json`을 만들어 두세요.
그래야 방문자가 컨트랙트 주소를 직접 입력하지 않아도 됩니다.

---

## 구조

```
contracts/DelegationVault.sol   위임 규칙을 강제하는 핵심 컨트랙트
script/deploy.js                GIWA Sepolia 배포
script/demo.js                  로컬 체인 시나리오 재생
web/index.html                  위임 발급·회수·감사 로그 대시보드 (단일 파일)
test.js                         34개 규칙 검증
compile.js                      solc 컴파일 (빌드 산출물: build/)
SETTLEMENT.md                   암호화폐를 받지 않는 가맹점 정산 설계
web/deck.html                   피치덱
web/docs.html                   기술 문서
```

### DelegationVault가 강제하는 것

| 규칙 | 동작 |
|---|---|
| 건당 한도 | 1회 결제 상한. 넘으면 `PerTxLimitExceeded` |
| 일일 한도 | 하루 누적 상한. 날짜가 바뀌면 자동 회복 |
| 총 한도 | 위임 전체 기간 상한. 회복되지 않음 |
| 허용 수취인 | 화이트리스트 밖으로는 송금 불가 |
| 만료 | 시각이 지나면 아무 조치 없이도 자동 무효 |
| 즉시 회수 | 위임자가 트랜잭션 하나로 전체 권한 소멸 |
| 감사 로그 | 모든 결제가 메모와 함께 온체인 이벤트로 기록 |
| 금고 자기송금 차단 | 수취인을 금고 자신으로 지정하면 `SelfRecipient`. 회수 불가능한 자금 소각을 막습니다 |

설계 시 신경 쓴 부분:

- **재발급 시 화이트리스트 자동 무효화** — 위임을 다시 발급하면 회차(nonce)가 올라가면서 위임 ID가 바뀝니다. 예전 위임의 허용 수취인이 되살아나는 사고를 구조적으로 막습니다.
- **위임자 출금 우선권** — 위임이 살아 있어도 위임자는 언제든 자금을 빼갈 수 있습니다.
- **재진입 방어 + Checks-Effects-Interactions** — 상태를 먼저 갱신하고 송금합니다.
- **커스텀 에러** — 왜 막혔는지가 숫자와 함께 반환됩니다. 데모에서 이게 잘 보입니다.
- **`canSpend()` 사전 조회** — 에이전트와 UI가 실행 전에 가능 여부와 사유를 확인할 수 있습니다.

### MVP 범위

네이티브 코인 결제만 지원합니다. ERC20(스테이블코인) 결제, 도장(Dojang) KYC 검증 연동, 기와 월렛 연동은 Phase 1 과제입니다.

---

## 배포 정보

GIWA Sepolia에 배포되어 동작 중입니다.

| 항목 | 값 |
|---|---|
| 컨트랙트 | `0xfFFffF47dD6944c4d01d2cb4CF00ed83a90788fd` |
| 익스플로러 | [sepolia-explorer.giwa.io](https://sepolia-explorer.giwa.io/address/0xfFFffF47dD6944c4d01d2cb4CF00ed83a90788fd?tab=contract) (소스 검증 완료) |
| 대시보드 | [upbit-giwa.metabox.pro](https://upbit-giwa.metabox.pro) |
| 체인 | GIWA Sepolia (chainId 91342) |

대시보드를 열면 자율 결제 에이전트 세 개가 각자의 지갑으로 구독료·API 크레딧·
생필품을 결제하는 것을 실시간으로 볼 수 있습니다. 한도를 넘거나 등록되지 않은
곳으로 가려는 시도는 컨트랙트가 거절하며, 그 기록도 익스플로러 링크와 함께 남습니다.

에이전트마다 지갑이 다르므로 한도와 회수가 독립적으로 동작합니다.
하나가 탈취되어도 나머지는 영향을 받지 않습니다.

## 더 읽을거리

- [피치덱](https://koobo7.github.io/upbit-giwa/deck.html) — 프로젝트 개요 10장
- [기술 문서](https://koobo7.github.io/upbit-giwa/docs.html) — 상태 모델·판정 로직·보안 설계·정산 아키텍처
- [SETTLEMENT.md](SETTLEMENT.md) — 암호화폐를 받지 않는 가맹점은 어떻게 결제하는가

## 라이선스

MIT
