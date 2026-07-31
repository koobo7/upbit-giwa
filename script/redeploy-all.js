/**
 * 재배포 전 과정을 한 번에 수행한다.
 *
 *   node script/redeploy-all.js
 *
 * 개인키를 한 번만 입력하면 아래를 전부 처리한다.
 *   1. 새 컨트랙트 배포
 *   2. canSpendAt 존재 검증
 *   3. 활동 기록 초기화
 *   4. 금고 예치
 *   5. 위임장 발급 (가맹점 정책 포함)
 *   6. 에이전트 가스비 충전 (부족할 때만)
 *
 * 키는 stdin으로만 받고 어디에도 저장하지 않는다.
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const artifact = require(path.join(ROOT, 'build', 'DelegationVault.json'));
const actors = require(path.join(ROOT, 'web', 'demo-actors.json'));

const RPC = process.env.RPC_URL || 'https://sepolia-rpc.giwa.io';
const EXPLORER = 'https://sepolia-explorer.giwa.io';
const CHAIN_ID = 91342;

// 데모 기본값. 테스트넷 잔액을 아끼면서 한도가 실제로 작동하는 것을 보여주는 선.
const DEPOSIT = '0.0002';
const PER_TX = '0.000002';
const DAILY = '0.00002';
const TOTAL = '0.0002';
const DAYS = 30;
const AGENT_GAS = '0.001';

function askSecret(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => {
      rl.close();
      try {
        readline.moveCursor(process.stdout, 0, -1);
        readline.clearLine(process.stdout, 0);
        process.stdout.write(question + '************' + String.fromCharCode(10));
      } catch {}
      resolve(ans.trim());
    });
  });
}

const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

async function main() {
  let pk = process.env.PRIVATE_KEY;
  if (!pk) {
    console.log('INGAM 재배포\n');
    console.log('개인키를 붙여넣고 엔터를 누르세요. 입력 후 화면에서 지워지며 저장되지 않습니다.\n');
    pk = await askSecret('개인키: ');
  }
  if (!pk) { console.error('입력이 없습니다.'); process.exit(1); }
  if (!pk.startsWith('0x')) pk = '0x' + pk;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    console.error(`개인키 형식이 아닙니다 (길이 ${pk.length}). 42자면 주소를 붙여넣은 것입니다.`);
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(
    RPC, { chainId: CHAIN_ID, name: 'giwa-sepolia' }, { staticNetwork: true });
  const wallet = new ethers.Wallet(pk, provider);
  const agent = actors.agent.address;

  console.log(`\n지갑      ${wallet.address}`);
  console.log(`에이전트   ${agent}`);
  const bal = await provider.getBalance(wallet.address);
  console.log(`잔액      ${ethers.formatEther(bal)} ETH`);
  if (bal === 0n) { console.error('잔액이 0입니다.'); process.exit(1); }

  /* 1. 배포 */
  step(1, '컨트랙트 배포');
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const vault = await factory.deploy();
  const dtx = vault.deploymentTransaction();
  await vault.waitForDeployment();
  const address = await vault.getAddress();
  const rc = await provider.getTransactionReceipt(dtx.hash);
  console.log(`    ${address}  (블록 ${rc.blockNumber})`);

  /* 2. 검증 */
  step(2, '가맹점 정책 지원 확인');
  const code = await provider.getCode(address);
  console.log(`    코드 ${(code.length - 2) / 2} bytes`);
  await vault.canSpendAt(ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress, 1n, ethers.ZeroHash);
  console.log('    canSpendAt 정상');

  /* 3. deployed.json 갱신 + 활동 기록 초기화 */
  step(3, '설정 파일 갱신');
  const out = {
    address, chainId: CHAIN_ID, rpc: RPC,
    deployer: wallet.address, txHash: dtx.hash,
    blockNumber: rc.blockNumber, deployedAt: new Date().toISOString(),
  };
  const json = JSON.stringify(out, null, 2);
  fs.writeFileSync(path.join(ROOT, 'deployed.json'), json);
  fs.writeFileSync(path.join(ROOT, 'web', 'deployed.json'), json);
  fs.writeFileSync(path.join(ROOT, 'web', 'agent-activity.json'), JSON.stringify({
    running: false, contract: address, events: [], updatedAt: new Date().toISOString(),
  }, null, 2));
  console.log('    deployed.json · agent-activity.json');

  /* 4. 예치 */
  step(4, `금고 예치 ${DEPOSIT} ETH`);
  await (await vault.deposit({ value: ethers.parseEther(DEPOSIT) })).wait();
  console.log(`    잔액 ${ethers.formatEther(await vault.balanceOf(wallet.address))} ETH`);

  /* 5. 위임 + 가맹점 정책 */
  step(5, '위임장 발급');
  const recipients = [actors.shopA.address, ...(actors.merchants ?? []).map(m => m.address)];
  const expiry = Math.floor(Date.now() / 1000) + DAYS * 86400;
  await (await vault.createDelegation(
    agent, ethers.parseEther(PER_TX), ethers.parseEther(DAILY), ethers.parseEther(TOTAL),
    expiry, true, recipients)).wait();
  console.log(`    건당 ${PER_TX} / 일일 ${DAILY} / 총 ${TOTAL} ETH · 수취인 ${recipients.length}곳`);

  const hashes = (actors.merchants ?? []).map(m => m.merchantId).filter(Boolean);
  if (hashes.length) {
    await (await vault.setMerchants(agent, hashes, true)).wait();
    await (await vault.setMerchantPolicy(agent, true)).wait();
    console.log(`    가맹점 정책 활성화 · 상점 ${hashes.length}곳 등록`);
  }

  /* 6. 에이전트 가스비 */
  step(6, '에이전트 가스비 확인');
  const agentBal = await provider.getBalance(agent);
  if (agentBal < ethers.parseEther('0.0002')) {
    await (await wallet.sendTransaction({
      to: agent, value: ethers.parseEther(AGENT_GAS) })).wait();
    console.log(`    ${AGENT_GAS} ETH 충전 → ${ethers.formatEther(await provider.getBalance(agent))} ETH`);
  } else {
    console.log(`    충분함 (${ethers.formatEther(agentBal)} ETH)`);
  }

  console.log('\n완료');
  console.log(`  익스플로러  ${EXPLORER}/address/${address}`);
  console.log('\n이제 에이전트를 실행할 수 있습니다:  node script/daemon.js');
}

main().catch((e) => { console.error('\n실패:', e.shortMessage || e.message || e); process.exit(1); });
