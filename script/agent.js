/**
 * INGAM 에이전트 클라이언트
 *
 * 대시보드에서 발급한 위임을 실제로 사용하는 쪽. AI 에이전트가 위임받은
 * 권한으로 결제를 시도하는 과정을 그대로 재현한다.
 * 배포된 컨트랙트에 직접 트랜잭션을 보내므로 모든 판정이 온체인에서 일어난다.
 *
 *   node script/agent.js pay  <수취인> <금액> [메모]   결제 시도
 *   node script/agent.js check <수취인> <금액>          사전 조회만 (canSpend)
 *   node script/agent.js status                        현재 위임 상태
 *
 * 위임자(principal) 주소는 PRINCIPAL 환경변수나 demo-wallets.json 옆의
 * deployed.json deployer를 기본값으로 쓴다.
 */
require('./env');   // .env 로드 (있으면)
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const deployed = require(path.join(ROOT, 'web', 'deployed.json'));
const artifact = require(path.join(ROOT, 'build', 'DelegationVault.json'));

const RPC = deployed.rpc;
const EXPLORER = 'https://sepolia-explorer.giwa.io';

function loadAgent() {
  if (process.env.AGENT_KEY) return process.env.AGENT_KEY;
  const f = path.join(ROOT, 'demo-wallets.json');
  if (!fs.existsSync(f)) {
    console.error('demo-wallets.json이 없습니다. AGENT_KEY 환경변수로 넘기세요.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(f, 'utf8'))[0].privateKey;
}

// GIWA에는 ENS가 없으므로 네트워크를 고정해 불필요한 조회를 막는다.
const provider = new ethers.JsonRpcProvider(
  RPC, { chainId: deployed.chainId, name: 'giwa-sepolia' }, { staticNetwork: true }
);

const PRINCIPAL = process.env.PRINCIPAL || deployed.deployer;

const fmt = (v) => ethers.formatEther(v);
const short = (a) => a.slice(0, 8) + '…' + a.slice(-4);

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const wallet = new ethers.Wallet(loadAgent(), provider);
  const vault = new ethers.Contract(deployed.address, artifact.abi, wallet);

  console.log(`컨트랙트  ${deployed.address}`);
  console.log(`위임자    ${PRINCIPAL}`);
  console.log(`에이전트  ${wallet.address}\n`);

  if (cmd === 'status' || !cmd) {
    const d = await vault.getDelegation(PRINCIPAL, wallet.address);
    if (d.expiry === 0n) {
      console.log('위임이 없습니다. 대시보드에서 먼저 위임장을 발급하세요.');
      console.log(`  에이전트 주소로 이걸 넣으세요: ${wallet.address}`);
      return;
    }
    const [today, total] = await vault.remaining(PRINCIPAL, wallet.address);
    const expired = BigInt(Math.floor(Date.now() / 1000)) >= d.expiry;
    console.log(`상태        ${!d.active ? '회수됨' : expired ? '만료' : '활성'}`);
    console.log(`건당 한도    ${fmt(d.perTxLimit)} ETH`);
    console.log(`일일 한도    ${fmt(d.dailyLimit)} ETH  (오늘 남음 ${fmt(today)})`);
    console.log(`총 한도      ${fmt(d.totalCap)} ETH  (남음 ${fmt(total)})`);
    console.log(`사용 누적    ${fmt(d.totalSpent)} ETH`);
    console.log(`만료        ${new Date(Number(d.expiry) * 1000).toLocaleString('ko-KR')}`);
    console.log(`수취인 제한  ${d.whitelistOnly ? '화이트리스트 전용' : '없음'}`);
    console.log(`금고 잔액    ${fmt(await vault.balanceOf(PRINCIPAL))} ETH`);
    return;
  }

  const [to, amountStr, ...memoParts] = args;
  if (!ethers.isAddress(to)) {
    console.error('수취인 주소가 올바르지 않습니다.');
    process.exit(1);
  }
  const amount = ethers.parseEther(amountStr || '0');

  if (cmd === 'check') {
    const [ok, reason] = await vault.canSpend(PRINCIPAL, wallet.address, to, amount);
    console.log(`사전 조회  ${short(to)} <- ${fmt(amount)} ETH`);
    console.log(ok ? '  가능' : `  불가 · ${reason}`);
    return;
  }

  if (cmd !== 'pay') {
    console.error('명령: pay | check | status');
    process.exit(1);
  }

  const memo = memoParts.join(' ') || '에이전트 자동 결제';
  console.log(`결제 시도  ${short(to)} <- ${fmt(amount)} ETH  "${memo}"`);

  // 실행 전에 컨트랙트에 먼저 물어본다. 에이전트가 하는 일과 동일하다.
  const [ok, reason] = await vault.canSpend(PRINCIPAL, wallet.address, to, amount);
  if (!ok) {
    console.log(`\n  차단됨 · ${reason}`);
    console.log('  컨트랙트가 거절했습니다. 앱이 아니라 체인이 막은 것입니다.');
    return;
  }

  try {
    const tx = await vault.spend(PRINCIPAL, to, amount, memo);
    console.log(`  tx  ${tx.hash}`);
    await tx.wait();
    const [today, total] = await vault.remaining(PRINCIPAL, wallet.address);
    console.log(`\n  결제 완료`);
    console.log(`  오늘 남은 한도 ${fmt(today)} ETH · 총 남은 한도 ${fmt(total)} ETH`);
    console.log(`  ${EXPLORER}/tx/${tx.hash}`);
  } catch (e) {
    // 커스텀 에러를 사람이 읽을 수 있게 풀어준다.
    const name = e.revert?.name ?? e.shortMessage ?? String(e);
    console.log(`\n  차단됨 · ${name}`);
    if (e.revert?.args?.length) console.log(`  ${e.revert.args.map(String).join(' / ')}`);
    console.log('  컨트랙트가 거절했습니다. 앱이 아니라 체인이 막은 것입니다.');
  }
}

main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
