/**
 * 재배포 후 정리 작업.
 *
 *   node script/post-deploy.js
 *
 * 컨트랙트를 새로 배포하면 이전 기록과 위임이 따라오지 않는다.
 * 활동 기록을 비우고, 새 컨트랙트를 가리키는지 확인한다.
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const deployed = require(path.join(ROOT, 'web', 'deployed.json'));
const artifact = require(path.join(ROOT, 'build', 'DelegationVault.json'));
const ACTIVITY = path.join(ROOT, 'web', 'agent-activity.json');

async function main() {
  const provider = new ethers.JsonRpcProvider(
    deployed.rpc, { chainId: deployed.chainId, name: 'giwa-sepolia' }, { staticNetwork: true }
  );

  console.log(`컨트랙트  ${deployed.address}`);
  console.log(`배포 블록  ${deployed.blockNumber ?? '(없음)'}`);

  const code = await provider.getCode(deployed.address);
  if (code === '0x') {
    console.error('해당 주소에 컨트랙트가 없습니다. 배포가 끝났는지 확인하세요.');
    process.exit(1);
  }
  console.log(`코드 크기  ${(code.length - 2) / 2} bytes`);

  // 새 기능이 실제로 있는지 확인한다.
  const c = new ethers.Contract(deployed.address, artifact.abi, provider);
  const probe = ethers.ZeroAddress;
  try {
    await c.canSpendAt(probe, probe, probe, 1n, ethers.ZeroHash);
    console.log('canSpendAt  존재 확인');
  } catch (e) {
    console.error('canSpendAt 호출 실패 — 구버전 컨트랙트일 수 있습니다.');
    console.error(' ', e.shortMessage || e.message);
    process.exit(1);
  }

  // 활동 기록 초기화. 이전 컨트랙트의 결제는 새 주소와 무관하다.
  fs.writeFileSync(ACTIVITY, JSON.stringify({
    running: false,
    contract: deployed.address,
    events: [],
    updatedAt: new Date().toISOString(),
  }, null, 2));
  console.log('활동 기록 초기화 완료');

  console.log('\n다음 순서:');
  console.log('  1. 대시보드에서 금고에 예치 (0.0002)');
  console.log('  2. 위임장 발급 — "가맹점 정책도 함께 적용" 체크된 상태로');
  console.log('  3. node script/fund-agent.js  (에이전트 가스비, 이미 있으면 생략)');
  console.log('  4. node script/daemon.js');
}

main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
