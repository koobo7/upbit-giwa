/**
 * INGAM 자율 결제 에이전트 (상시 실행)
 *
 * 위임받은 한도 안에서 스스로 결제를 이어가는 에이전트. 구독료·API 크레딧·
 * 생필품처럼 사람이 매번 승인하지 않는 반복 결제를 대신 처리하는 상황을 재현한다.
 *
 * 사람이 개입하지 않아도 결제가 계속되지만, 한도를 넘거나 등록되지 않은 곳으로
 * 가려는 시도는 컨트랙트가 거절한다. 그 거절도 로그에 그대로 남긴다.
 *
 *   node script/daemon.js              기본 간격(90초)으로 실행
 *   INTERVAL=30 node script/daemon.js  간격 지정 (초)
 *   ONCE=1 node script/daemon.js       한 번만 결제하고 종료
 *
 * 종료는 Ctrl+C. 상태는 web/agent-activity.json에 기록되어 대시보드가 읽는다.
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const deployed = require(path.join(ROOT, 'web', 'deployed.json'));
const artifact = require(path.join(ROOT, 'build', 'DelegationVault.json'));

const ACTIVITY = path.join(ROOT, 'web', 'agent-activity.json');
const INTERVAL = Number(process.env.INTERVAL || 90) * 1000;
const PRINCIPAL = process.env.PRINCIPAL || deployed.deployer;

const provider = new ethers.JsonRpcProvider(
  deployed.rpc, { chainId: deployed.chainId, name: 'giwa-sepolia' }, { staticNetwork: true }
);

function loadAgentKey() {
  if (process.env.AGENT_KEY) return process.env.AGENT_KEY;
  const f = path.join(ROOT, 'demo-wallets.json');
  if (!fs.existsSync(f)) {
    console.error('demo-wallets.json이 없습니다. AGENT_KEY 환경변수로 넘기세요.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(f, 'utf8'))[0].privateKey;
}

function loadMerchants() {
  const f = path.join(ROOT, 'demo-merchants.json');
  if (!fs.existsSync(f)) {
    console.error('demo-merchants.json이 없습니다.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

// 상점마다 결제 성격이 다르다. 금액과 메모를 그럴듯하게 만든다.
// 금액은 건당 한도(0.000002 ETH) 안에 들도록 잡았다. 테스트넷 잔액을 아끼면서도
// 일일 한도가 실제로 소진되어 컨트랙트가 차단하는 장면까지 보여주기 위함이다.
//
// rail: 결제 경로. 쿠팡 같은 곳은 ETH를 직접 받지 않으므로 정산 파트너를 거친다.
//   onchain  — 수취인이 직접 온체인 정산 (API 크레딧, 클라우드 등)
//   settled  — 정산 파트너가 법정통화로 대납하고 온체인에서 정산
const CATALOG = {
  '넷플릭스 구독':      ['월 구독료',        0.000000006,  'settled'],
  'OpenAI API 크레딧': ['API 사용료 정산',   0.000000009,  'onchain'],
  'AWS 사용료':        ['클라우드 사용료',   0.0000000075, 'onchain'],
  '쿠팡 생필품':        ['생필품 자동 주문',  0.000000005,  'settled'],
  '스포티파이 구독':     ['월 구독료',        0.000000004,  'settled'],
  '도메인 갱신':        ['도메인 연장',      0.000000006,  'onchain'],
  'GitHub Copilot':   ['월 구독료',        0.0000000055, 'settled'],
  '배달 주문':          ['점심 주문',        0.000000007,  'settled'],
};

// 에이전트가 수행 중인 구매 계획. 각 결제가 어느 항목에서 비롯됐는지 남긴다.
const PLAN = [
  { id: 'T-1', title: '구독 서비스 자동 갱신',   items: ['넷플릭스 구독', '스포티파이 구독', 'GitHub Copilot'] },
  { id: 'T-2', title: '개발 인프라 사용료 정산', items: ['OpenAI API 크레딧', 'AWS 사용료', '도메인 갱신'] },
  { id: 'T-3', title: '생활용품 정기 주문',     items: ['쿠팡 생필품', '배달 주문'] },
];
const planOf = (merchant) => PLAN.find((p) => p.items.includes(merchant)) ?? PLAN[0];

const fmt = (v) => ethers.formatEther(v);
const ts = () => new Date().toLocaleTimeString('ko-KR');

function readActivity() {
  try { return JSON.parse(fs.readFileSync(ACTIVITY, 'utf8')); } catch { return { events: [] }; }
}

function writeActivity(patch) {
  const cur = readActivity();
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  // 대시보드 전체보기에서 페이지를 넘겨볼 수 있도록 넉넉히 남긴다.
  next.events = (patch.events ?? cur.events ?? []).slice(-500);
  fs.writeFileSync(ACTIVITY, JSON.stringify(next, null, 2));
}

async function main() {
  const wallet = new ethers.Wallet(loadAgentKey(), provider);
  const vault = new ethers.Contract(deployed.address, artifact.abi, wallet);
  const merchants = loadMerchants();

  console.log('INGAM 자율 결제 에이전트');
  console.log(`  컨트랙트  ${deployed.address}`);
  console.log(`  위임자    ${PRINCIPAL}`);
  console.log(`  에이전트  ${wallet.address}`);
  console.log(`  결제 간격  ${INTERVAL / 1000}초\n`);

  const d = await vault.getDelegation(PRINCIPAL, wallet.address);
  if (d.expiry === 0n) {
    console.error('위임이 없습니다. 대시보드에서 이 에이전트에게 먼저 위임장을 발급하세요.');
    console.error(`  에이전트 주소: ${wallet.address}`);
    process.exit(1);
  }

  let running = true;
  process.on('SIGINT', () => {
    running = false;
    console.log('\n중지합니다.');
    writeActivity({ running: false });
    process.exit(0);
  });

  while (running) {
    let m = merchants[Math.floor(Math.random() * merchants.length)];
    const [memoBase, base, rail] = CATALOG[m.name] ?? ['자동 결제', 0.000000006, 'onchain'];
    const plan = planOf(m.name);
    // 금액에 약간의 편차를 줘서 매번 같은 값이 찍히지 않게 한다.
    let amount = ethers.parseEther((base * (0.8 + Math.random() * 0.4)).toFixed(12));

    /* 10건 중 1~2건은 에이전트가 규칙을 벗어난 시도를 하게 만든다.
       실제 운영에서 오작동·프롬프트 인젝션·잘못된 계획으로 일어나는 일이고,
       컨트랙트가 그것을 실제로 거절하는 모습이 이 제품의 핵심이다.
       로그를 꾸며내는 것이 아니라 진짜 트랜잭션을 보내 진짜로 거절당한다. */
    const roll = Math.random();
    let anomaly = null;
    let merchantHash = m.merchantId ?? ethers.ZeroHash;
    if (roll < 0.06) {
      // 등록되지 않은 수취인으로 송금 시도 -> RecipientNotAllowed
      anomaly = 'recipient';
      m = { name: `미등록 수취처 (${m.name} 사칭)`, address: ethers.Wallet.createRandom().address };
      merchantHash = ethers.ZeroHash;
    } else if (roll < 0.11) {
      // 건당 한도를 크게 넘는 금액 -> PerTxLimitExceeded
      anomaly = 'pertx';
      amount = ethers.parseEther('0.01');
    } else if (roll < 0.16) {
      // 수취인은 허용됐지만 가맹점이 미등록 -> MerchantNotAllowed
      // 정산 파트너 경로에서 "어디에 쓸지"가 통제된다는 것을 보여주는 케이스다.
      anomaly = 'merchant';
      merchantHash = ethers.id('casino-online');
      m = { ...m, name: `${m.name} → 미등록 가맹점` };
    }

    // 메모는 온체인에 남으므로 어떤 계획에서 나온 결제인지 여기 새긴다.
    const memo = anomaly
      ? `[${plan.id}] 비정상 시도 · ${m.name}`
      : `[${plan.id}] ${m.name} · ${memoBase}`;

    let entry;
    try {
      // 가맹점까지 넘겨 조회한다. 정산 파트너가 승인 전에 하는 것과 같은 호출이다.
      const [ok, reason] = await vault.canSpendAt(
        PRINCIPAL, wallet.address, m.address, amount, merchantHash);
      if (!ok) {
        console.log(`${ts()}  차단  ${m.name.padEnd(18)} ${fmt(amount)} ETH  <- ${reason}`);
        entry = { at: Date.now(), merchant: m.name, amount: fmt(amount), status: 'blocked', reason, planId: plan.id, planTitle: plan.title, rail, anomaly };
      } else {
        const tx = await vault.spendAt(PRINCIPAL, m.address, amount, memo, merchantHash);
        await tx.wait();
        console.log(`${ts()}  결제  ${m.name.padEnd(18)} ${fmt(amount)} ETH  ${tx.hash.slice(0, 14)}…`);
        entry = { at: Date.now(), merchant: m.name, amount: fmt(amount), status: 'paid', txHash: tx.hash, planId: plan.id, planTitle: plan.title, rail, anomaly };
      }
    } catch (e) {
      const reason = e.revert?.name ?? e.shortMessage ?? String(e);
      console.log(`${ts()}  차단  ${m.name.padEnd(18)} ${fmt(amount)} ETH  <- ${reason}`);
      entry = { at: Date.now(), merchant: m.name, amount: fmt(amount), status: 'blocked', reason, planId: plan.id, planTitle: plan.title, rail, anomaly };
    }

    const [today, total] = await vault.remaining(PRINCIPAL, wallet.address).catch(() => [0n, 0n]);
    const events = [...readActivity().events, entry];
    writeActivity({
      running: true,
      agent: wallet.address,
      principal: PRINCIPAL,
      contract: deployed.address,
      intervalSec: INTERVAL / 1000,
      plan: PLAN,
      remainingToday: fmt(today),
      remainingTotal: fmt(total),
      events,
    });

    if (process.env.ONCE) break;
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
}

main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
