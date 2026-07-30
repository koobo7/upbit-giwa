/**
 * INGAM 데모 — 데모데이 영상용 시나리오
 *
 *   로컬(설치 없이 바로):   node script/demo.js
 *   GIWA 테스트넷:          RPC_URL=... PRIVATE_KEY=0x... AGENT_KEY=0x... node script/demo.js
 *
 * 보여주는 것:
 *   1) 한도 안에서는 에이전트가 사람 없이 알아서 결제한다
 *   2) 한도를 넘으면 컨트랙트가 직접 거절한다 (앱이 아니라 체인이)
 *   3) 등록되지 않은 곳으로는 보낼 수 없다
 *   4) 사람이 회수하면 그 즉시 에이전트는 아무것도 못 한다
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const artifact = require('../build/DelegationVault.json');

const E = ethers.parseEther;
const F = (v) => ethers.formatEther(v);
const iface = new ethers.Interface(artifact.abi);
const PAUSE = Number(process.env.PAUSE ?? 900);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
};

function scene(n, title) {
  console.log(`\n${c.dim('─'.repeat(58))}`);
  console.log(`${c.bold(`  ${n}. ${title}`)}`);
  console.log(c.dim('─'.repeat(58)));
}

function revertName(e) {
  if (e.revert?.name) return { name: e.revert.name, args: e.revert.args };
  const raw = e.info?.error?.data?.result ?? e.data;
  if (typeof raw === 'string' && raw.startsWith('0x') && raw.length >= 10) {
    const parsed = iface.parseError(raw);
    if (parsed) return { name: parsed.name, args: parsed.args };
  }
  return { name: e.shortMessage ?? 'unknown', args: null };
}

/** 결제를 시도하고 성공/차단을 보기 좋게 출력한다. */
async function attempt(vaultAsAgent, label, principal, to, amount, memo) {
  console.log(`\n  ${c.blue('AGENT')}  ${label}`);
  console.log(`         ${c.dim(`${F(amount)} → ${to.slice(0, 10)}…`)}`);
  await sleep(PAUSE);
  try {
    const tx = await vaultAsAgent.spend(principal, to, amount, memo);
    await tx.wait();
    console.log(`  ${c.green('통과')}   결제 완료  ${c.dim(tx.hash.slice(0, 18) + '…')}`);
    return true;
  } catch (e) {
    const { name, args } = revertName(e);
    let detail = '';
    if (args && args.length === 2) detail = `  ${c.dim(`한도 ${F(args[0])} / 요청 ${F(args[1])}`)}`;
    console.log(`  ${c.red('차단')}   ${c.bold(name)}${detail}`);
    console.log(`         ${c.dim('컨트랙트가 거절했습니다. 앱이 아니라 체인이 막은 것입니다.')}`);
    return false;
  }
}

async function connect() {
  if (process.env.RPC_URL) {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const owner = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const agent = new ethers.Wallet(process.env.AGENT_KEY, provider);
    const dep = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'deployed.json')));
    const vault = new ethers.Contract(dep.address, artifact.abi, owner);
    console.log(c.dim(`  GIWA 테스트넷 · ${dep.address}`));
    return { provider, owner, agent, vault, shop: ethers.Wallet.createRandom().address };
  }

  const ganache = require('ganache');
  const provider = new ethers.BrowserProvider(
    ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 4, defaultBalance: 100 } })
  );
  const owner = await provider.getSigner(0);
  const agent = await provider.getSigner(1);
  const shop = await (await provider.getSigner(2)).getAddress();
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, owner);
  const vault = await factory.deploy();
  await vault.waitForDeployment();
  console.log(c.dim(`  로컬 체인 · ${await vault.getAddress()}`));
  return { provider, owner, agent, vault, shop };
}

async function main() {
  console.log(`\n${c.bold('  INGAM')}  ${c.dim('AI 에이전트를 위한 위임 결제 레이어')}`);
  const { provider, owner, agent, vault, shop } = await connect();

  const ownerAddr = await owner.getAddress();
  const agentAddr = await agent.getAddress();
  const asAgent = vault.connect(agent);
  const stranger = ethers.Wallet.createRandom().address;

  /* ── 1 ── */
  scene(1, '위임장 발급');
  await (await vault.deposit({ value: E('10') })).wait();
  console.log(`\n  금고 예치     ${c.bold(F(await vault.balanceOf(ownerAddr)))}`);

  const latest = await provider.getBlock('latest');
  const expiry = latest.timestamp + 30 * 86400;
  await (await vault.createDelegation(
    agentAddr, E('0.5'), E('1'), E('5'), expiry, true, [shop]
  )).wait();

  console.log(`  받는 에이전트  ${c.dim(agentAddr)}`);
  console.log(`  건당 한도      ${c.bold('0.5')}`);
  console.log(`  일일 한도      ${c.bold('1.0')}`);
  console.log(`  총 한도        ${c.bold('5.0')}`);
  console.log(`  허용 수취인    ${c.dim(shop.slice(0, 10) + '…')} ${c.dim('(1곳)')}`);
  console.log(`  만료           ${c.dim(new Date(expiry * 1000).toISOString().slice(0, 10))}`);
  console.log(`\n  ${c.dim('이 규칙은 지금 온체인에 새겨졌습니다. 서버에도, 앱에도 없습니다.')}`);
  await sleep(PAUSE);

  /* ── 2 ── */
  scene(2, '한도 안에서는 사람이 개입하지 않는다');
  await attempt(asAgent, '구독 자동 결제', ownerAddr, shop, E('0.3'), '뉴스레터 구독 8월');
  await attempt(asAgent, '추가 결제', ownerAddr, shop, E('0.4'), 'API 크레딧 충전');
  const [today, total] = await vault.remaining(ownerAddr, agentAddr);
  console.log(`\n  ${c.dim(`오늘 남은 한도 ${F(today)} · 총 남은 한도 ${F(total)}`)}`);
  await sleep(PAUSE);

  /* ── 3 ── */
  scene(3, '에이전트가 폭주해도 한도는 뚫리지 않는다');
  console.log(c.dim('\n  프롬프트 인젝션을 당했다고 가정합니다.'));
  await attempt(asAgent, '큰 금액 결제 시도', ownerAddr, shop, E('3'), '탈취된 요청');
  await attempt(asAgent, '모르는 주소로 송금 시도', ownerAddr, stranger, E('0.2'), '탈취된 요청');
  await sleep(PAUSE);

  /* ── 4 ── */
  scene(4, '회수는 즉시, 그리고 완전하다');
  console.log(c.dim('\n  사용자가 앱에서 회수 버튼을 누릅니다.'));
  const rtx = await vault.revoke(agentAddr);
  await rtx.wait();
  console.log(`  ${c.yellow('회수 완료')}  ${c.dim(rtx.hash.slice(0, 18) + '…')}`);
  await attempt(asAgent, '회수 후 결제 시도', ownerAddr, shop, E('0.1'), '아직 살아있나?');

  /* ── 정산 ── */
  console.log(`\n${c.dim('─'.repeat(58))}`);
  const d = await vault.getDelegation(ownerAddr, agentAddr);
  console.log(`  에이전트가 쓴 총액   ${c.bold(F(d.totalSpent))}`);
  console.log(`  금고에 남은 잔액     ${c.bold(F(await vault.balanceOf(ownerAddr)))}`);
  console.log(`  ${c.dim('모든 결제 내역이 온체인에 남아 언제든 감사할 수 있습니다.')}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
