/**
 * INGAM DelegationVault 배포 스크립트
 *
 *   PRIVATE_KEY=0x... npm run deploy
 *
 * 기본값은 GIWA Sepolia (chainId 91342, https://sepolia-rpc.giwa.io).
 * 다른 RPC를 쓰려면 RPC_URL 환경변수로 덮어쓰세요.
 * 배포가 끝나면 deployed.json에 주소가 저장되고, 데모/대시보드가 그걸 읽습니다.
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

/** 키를 화면에 찍지 않고 입력받는다. 명령줄에 남지 않으므로 셸 히스토리에도 안 남는다. */
function askSecret(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (ch) => {
      if (['\n', '\r', ''].includes(ch.toString())) return;
      readline.moveCursor(process.stdout, -1000, 0);
      readline.clearLine(process.stdout, 1);
      process.stdout.write(question);
    };
    process.stdin.on('data', onData);
    rl.question(question, (ans) => {
      process.stdin.removeListener('data', onData);
      rl.close();
      process.stdout.write('\n');
      resolve(ans.trim());
    });
  });
}

const artifact = require('../build/DelegationVault.json');

const GIWA_SEPOLIA_RPC = 'https://sepolia-rpc.giwa.io';
const GIWA_SEPOLIA_EXPLORER = 'https://sepolia-explorer.giwa.io';

async function main() {
  const rpc = process.env.RPC_URL || GIWA_SEPOLIA_RPC;

  // 환경변수가 있으면 그걸 쓰고, 없으면 직접 물어본다.
  let pk = process.env.PRIVATE_KEY;
  if (!pk) {
    console.log('개인키를 입력하세요. 화면에 표시되지 않고 어디에도 저장되지 않습니다.\n');
    pk = await askSecret('개인키: ');
  }
  if (!pk) { console.error('입력이 없습니다.'); process.exit(1); }
  if (!pk.startsWith('0x')) pk = '0x' + pk;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    console.error(`개인키 형식이 아닙니다. 0x를 포함해 66자여야 합니다 (입력된 길이: ${pk.length}).`);
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk, provider);
  const net = await provider.getNetwork();

  console.log(`체인 ID   ${net.chainId}`);
  console.log(`배포 지갑  ${wallet.address}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`잔액      ${ethers.formatEther(balance)}\n`);
  if (balance === 0n) {
    console.error('잔액이 0입니다. 테스트넷 포시트에서 먼저 받아오세요.');
    process.exit(1);
  }

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  console.log('배포 중...');
  const vault = await factory.deploy();
  const tx = vault.deploymentTransaction();
  console.log(`  tx  ${tx.hash}`);

  await vault.waitForDeployment();
  const address = await vault.getAddress();
  console.log(`\n배포 완료  ${address}`);

  const out = {
    address,
    chainId: Number(net.chainId),
    rpc,
    deployer: wallet.address,
    txHash: tx.hash,
    deployedAt: new Date().toISOString(),
  };
  const json = JSON.stringify(out, null, 2);
  fs.writeFileSync(path.join(__dirname, '..', 'deployed.json'), json);
  // 대시보드가 같은 디렉터리에서 읽을 수 있게 web/에도 복사한다 (Cloudflare Pages 배포 포함)
  fs.writeFileSync(path.join(__dirname, '..', 'web', 'deployed.json'), json);
  console.log('deployed.json 저장 완료 (루트 + web/)');

  if (Number(net.chainId) === 91342) {
    console.log(`\n익스플로러  ${GIWA_SEPOLIA_EXPLORER}/address/${address}`);
  }
  console.log('이 화면(또는 익스플로러 링크)을 신청서에 첨부하세요.');
}

main().catch((e) => { console.error(e); process.exit(1); });
