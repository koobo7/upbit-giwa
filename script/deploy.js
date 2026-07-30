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

const artifact = require('../build/DelegationVault.json');

const GIWA_SEPOLIA_RPC = 'https://sepolia-rpc.giwa.io';
const GIWA_SEPOLIA_EXPLORER = 'https://sepolia-explorer.giwa.io';

async function main() {
  const rpc = process.env.RPC_URL || GIWA_SEPOLIA_RPC;
  const pk = process.env.PRIVATE_KEY;

  if (!pk) {
    console.error('PRIVATE_KEY 환경변수가 필요합니다.');
    console.error('예) PRIVATE_KEY=0xabc... npm run deploy');
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
