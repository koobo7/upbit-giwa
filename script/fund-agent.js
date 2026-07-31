/**
 * 에이전트 지갑에 가스비를 보낸다.
 *
 *   node script/fund-agent.js [금액ETH]     기본 0.001
 *
 * 금고에 예치한 자금은 "결제에 쓰이는 돈"이고, 트랜잭션 수수료는 에이전트가
 * 직접 낸다. 둘은 별개다. 이 구조 자체가 설계 의도이기도 하다 —
 * 에이전트는 결제 권한만 위임받을 뿐 위임자의 지갑을 직접 쓰지 못한다.
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const deployed = require(path.join(ROOT, 'web', 'deployed.json'));
const actors = require(path.join(ROOT, 'web', 'demo-actors.json'));

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

async function main() {
  const amount = ethers.parseEther(process.argv[2] || '0.001');
  const provider = new ethers.JsonRpcProvider(
    deployed.rpc, { chainId: deployed.chainId, name: 'giwa-sepolia' }, { staticNetwork: true }
  );

  let pk = process.env.PRIVATE_KEY;
  if (!pk) {
    console.log('위임자(금고 주인) 개인키를 입력하세요. 화면에서 지워지며 저장되지 않습니다.\n');
    pk = await askSecret('개인키: ');
  }
  if (!pk) { console.error('입력이 없습니다.'); process.exit(1); }
  if (!pk.startsWith('0x')) pk = '0x' + pk;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    console.error(`개인키 형식이 아닙니다 (입력 길이 ${pk.length}). 42자면 주소를 붙여넣은 것입니다.`);
    process.exit(1);
  }

  const wallet = new ethers.Wallet(pk, provider);
  const to = actors.agent.address;

  console.log(`보내는 이  ${wallet.address}`);
  console.log(`받는 이    ${to}  (에이전트)`);
  console.log(`금액       ${ethers.formatEther(amount)} ETH\n`);

  const bal = await provider.getBalance(wallet.address);
  if (bal < amount) {
    console.error(`잔액 부족: ${ethers.formatEther(bal)} ETH`);
    process.exit(1);
  }

  const tx = await wallet.sendTransaction({ to, value: amount });
  console.log(`  tx  ${tx.hash}`);
  await tx.wait();

  const after = await provider.getBalance(to);
  console.log(`\n완료. 에이전트 잔액 ${ethers.formatEther(after)} ETH`);
  console.log('이제 데모를 실행할 수 있습니다:  node script/daemon.js');
}

main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
