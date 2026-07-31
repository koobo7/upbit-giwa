/**
 * Ethereum Sepolia -> GIWA Sepolia ETH 브릿지 (CLI)
 *
 *   PRIVATE_KEY=0x... node script/bridge.js [금액ETH]
 *   기본 금액 0.03
 *
 * 웹 브릿지 UI가 동작하지 않을 때 쓰는 우회 경로.
 * OP Stack의 OptimismPortal은 receive()에서 depositTransaction을 호출하므로
 * 단순 송금만으로 L2 입금이 성립한다. 별도 컨트랙트 호출이 필요 없다.
 *
 * 주의: 이 스크립트는 L1(Sepolia)에서 트랜잭션을 보낸다.
 *       PRIVATE_KEY는 환경변수로만 넘기고 파일에 저장하지 말 것.
 */
const { ethers } = require('ethers');

// GIWA Sepolia의 L1 OptimismPortal (Ethereum Sepolia에 배포됨).
// 체인에서 코드 존재와 예치 잔액을 확인한 주소다.
const PORTAL = '0x956962C34687A954e611A83619ABaA37Ce6bC78A';
const L1_RPC = process.env.L1_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';
const L2_RPC = 'https://sepolia-rpc.giwa.io';
const L2_EXPLORER = 'https://sepolia-explorer.giwa.io';

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) {
    console.error('PRIVATE_KEY 환경변수가 필요합니다.');
    console.error('  PowerShell:  $env:PRIVATE_KEY="0x..."; node script/bridge.js');
    process.exit(1);
  }
  const amount = ethers.parseEther(process.argv[2] || '0.03');

  const l1 = new ethers.JsonRpcProvider(L1_RPC);
  const l2 = new ethers.JsonRpcProvider(L2_RPC);
  const wallet = new ethers.Wallet(pk, l1);

  console.log(`지갑        ${wallet.address}`);

  const [balL1, balL2] = await Promise.all([
    l1.getBalance(wallet.address),
    l2.getBalance(wallet.address),
  ]);
  console.log(`Sepolia     ${ethers.formatEther(balL1)} ETH`);
  console.log(`GIWA        ${ethers.formatEther(balL2)} ETH`);
  console.log(`브릿지 금액  ${ethers.formatEther(amount)} ETH\n`);

  // 가스비를 남기고도 보낼 수 있는지 확인한다.
  const fee = await l1.getFeeData();
  const gasPrice = fee.maxFeePerGas ?? fee.gasPrice;
  const gasLimit = 200000n; // Portal receive()는 여유 있게 잡는다
  const reserve = gasPrice * gasLimit;

  if (balL1 < amount + reserve) {
    const max = balL1 > reserve ? balL1 - reserve : 0n;
    console.error('잔액이 부족합니다 (가스비 포함).');
    console.error(`  현재 ${ethers.formatEther(balL1)} / 필요 ${ethers.formatEther(amount + reserve)}`);
    if (max > 0n) console.error(`  최대 가능 금액: ${ethers.formatEther(max)} ETH`);
    process.exit(1);
  }

  console.log('브릿지 트랜잭션 전송 중...');
  const tx = await wallet.sendTransaction({ to: PORTAL, value: amount, gasLimit });
  console.log(`  L1 tx  ${tx.hash}`);
  console.log(`  https://sepolia.etherscan.io/tx/${tx.hash}`);

  const rc = await tx.wait();
  console.log(`  L1 확정 (블록 ${rc.blockNumber})\n`);

  // L2 도착까지 폴링한다. OP Stack 예치는 보통 1~3분.
  console.log('GIWA 도착 대기 중 (최대 10분)...');
  const before = balL2;
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10000));
    const now = await l2.getBalance(wallet.address);
    if (now > before) {
      console.log(`\n도착 완료  GIWA 잔액 ${ethers.formatEther(now)} ETH`);
      console.log(`${L2_EXPLORER}/address/${wallet.address}`);
      console.log('\n이제 배포할 수 있습니다:  npm run deploy');
      return;
    }
    process.stdout.write('.');
  }
  console.log('\n10분 내에 도착하지 않았습니다. 익스플로러에서 확인하세요:');
  console.log(`${L2_EXPLORER}/address/${wallet.address}`);
}

main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
