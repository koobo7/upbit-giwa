const ganache = require('ganache');
const { ethers } = require('ethers');
const artifact = require('./build/DelegationVault.json');

const E = ethers.parseEther;
let pass = 0, fail = 0;

function ok(cond, label) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
}

const iface = new ethers.Interface(artifact.abi);

function revertName(e) {
  if (e.revert?.name) return e.revert.name;
  const raw = e.info?.error?.data?.result ?? e.data;
  if (typeof raw === 'string' && raw.startsWith('0x') && raw.length >= 10) {
    const parsed = iface.parseError(raw);
    if (parsed) return parsed.name;
  }
  return e.shortMessage ?? String(e);
}

async function expectRevert(promise, errName, label) {
  try {
    await promise;
    fail++; console.log(`  FAIL  ${label}  (기대: ${errName}, 실제: 성공해버림)`);
  } catch (e) {
    const name = revertName(e);
    if (name === errName) { pass++; console.log(`  PASS  ${label}  -> ${errName}`); }
    else { fail++; console.log(`  FAIL  ${label}  (기대: ${errName}, 실제: ${name})`); }
  }
}

async function main() {
  const g = ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 6, defaultBalance: 1000 } });
  const provider = new ethers.BrowserProvider(g);

  const owner = await provider.getSigner(0);   // 위임자 (principal)
  const agent = await provider.getSigner(1);   // AI 에이전트
  const shop = await provider.getSigner(2);    // 허용된 수취인
  const stranger = await provider.getSigner(3); // 허용되지 않은 수취인
  const other = await provider.getSigner(4);   // 무관한 제3자

  const A = {
    owner: await owner.getAddress(),
    agent: await agent.getAddress(),
    shop: await shop.getAddress(),
    stranger: await stranger.getAddress(),
    other: await other.getAddress(),
  };

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, owner);
  const vault = await factory.deploy();
  await vault.waitForDeployment();
  console.log('배포 완료:', await vault.getAddress(), '\n');

  const asAgent = vault.connect(agent);
  const asOther = vault.connect(other);
  const now = () => Math.floor(Date.now() / 1000);
  const chainNow = async () => (await provider.getBlock('latest')).timestamp;

  /* ── 1. 예치 ── */
  console.log('1. 금고 예치');
  await (await vault.deposit({ value: E('100') })).wait();
  ok(await vault.balanceOf(A.owner) === E('100'), '예치 후 잔액 100');
  await expectRevert(vault.deposit({ value: 0 }), 'ZeroAmount', '0원 예치는 거절');

  /* ── 2. 위임 생성 ── */
  console.log('\n2. 위임 생성 (건당 1 / 일일 3 / 총 10, 화이트리스트 ON)');
  const expiry = (await chainNow()) + 365 * 86400;
  await (await vault.createDelegation(
    A.agent, E('1'), E('3'), E('10'), expiry, true, [A.shop]
  )).wait();
  const d = await vault.getDelegation(A.owner, A.agent);
  ok(d.active === true, '위임 활성화됨');
  ok(d.perTxLimit === E('1'), '건당 한도 1');

  await expectRevert(
    vault.createDelegation(A.agent, E('5'), E('3'), E('10'), expiry, false, []),
    'InvalidLimits', '건당 한도 > 일일 한도면 거절'
  );
  await expectRevert(
    vault.createDelegation(A.agent, E('1'), E('3'), E('10'), (await chainNow()) - 1, false, []),
    'ExpiryInPast', '과거 만료일은 거절'
  );

  /* ── 3. 한도 내 결제 성공 ── */
  console.log('\n3. 한도 안에서는 에이전트가 자유롭게 결제');
  const shopBefore = await provider.getBalance(A.shop);
  await (await asAgent.spend(A.owner, A.shop, E('0.8'), '구독 결제 8월분')).wait();
  ok((await provider.getBalance(A.shop)) - shopBefore === E('0.8'), '수취인이 0.8 수령');
  ok(await vault.balanceOf(A.owner) === E('99.2'), '위임자 잔액 99.2로 차감');

  const [rToday, rTotal] = await vault.remaining(A.owner, A.agent);
  ok(rToday === E('2.2'), '오늘 남은 한도 2.2');
  ok(rTotal === E('9.2'), '총 남은 한도 9.2');

  /* ── 4. 건당 한도 ── */
  console.log('\n4. 건당 한도 초과는 컨트랙트가 거절');
  await expectRevert(
    asAgent.spend(A.owner, A.shop, E('1.5'), '한도 초과 시도'),
    'PerTxLimitExceeded', '1.5 결제 시도 (건당 한도 1)'
  );
  const [canA, reasonA] = await vault.canSpend(A.owner, A.agent, A.shop, E('1.5'));
  ok(canA === false && reasonA === 'PER_TX_LIMIT', 'canSpend가 사전에 PER_TX_LIMIT 통보');

  /* ── 5. 화이트리스트 ── */
  console.log('\n5. 허용되지 않은 수취인은 차단');
  await expectRevert(
    asAgent.spend(A.owner, A.stranger, E('0.5'), '모르는 곳으로 송금'),
    'RecipientNotAllowed', '화이트리스트에 없는 주소로 결제 시도'
  );

  /* ── 6. 일일 한도 ── */
  console.log('\n6. 일일 누적 한도');
  await (await asAgent.spend(A.owner, A.shop, E('1'), '두번째')).wait();
  await (await asAgent.spend(A.owner, A.shop, E('1'), '세번째')); // 누적 2.8
  await expectRevert(
    asAgent.spend(A.owner, A.shop, E('0.5'), '오늘 네번째'),
    'DailyLimitExceeded', '누적 2.8 상태에서 0.5 추가 시도 (일일 3)'
  );

  console.log('\n7. 하루가 지나면 일일 한도는 자동 회복');
  await provider.send('evm_increaseTime', [86400]);
  await provider.send('evm_mine', []);
  await (await asAgent.spend(A.owner, A.shop, E('1'), '다음날 첫 결제')).wait();
  ok(await vault.balanceOf(A.owner) === E('96.2'), '다음날 결제 성공, 잔액 96.2');

  /* ── 8. 총 한도 ── */
  console.log('\n8. 총 한도는 회복되지 않는다');
  for (let i = 0; i < 6; i++) {
    await provider.send('evm_increaseTime', [86400]);
    await provider.send('evm_mine', []);
    await (await asAgent.spend(A.owner, A.shop, E('1'), `누적 소진 ${i}`)).wait();
  }
  const dd = await vault.getDelegation(A.owner, A.agent);
  ok(dd.totalSpent === E('9.8'), '누적 사용액 9.8');
  await expectRevert(
    asAgent.spend(A.owner, A.shop, E('0.5'), '총 한도 초과'),
    'TotalCapExceeded', '누적 9.8 상태에서 0.5 시도 (총 10)'
  );

  /* ── 9. 권한 없는 호출자 ── */
  console.log('\n9. 위임받지 않은 주소는 아예 접근 불가');
  await expectRevert(
    asOther.spend(A.owner, A.shop, E('0.1'), '나는 에이전트가 아님'),
    'NoDelegation', '제3자가 남의 금고에서 결제 시도'
  );

  /* ── 10. 즉시 회수 ── */
  console.log('\n10. 회수 버튼');
  const expiry2 = (await chainNow()) + 7 * 86400;
  await (await vault.createDelegation(A.agent, E('1'), E('3'), E('10'), expiry2, true, [A.shop])).wait();
  await (await asAgent.spend(A.owner, A.shop, E('0.5'), '재발급 후 결제')).wait();
  ok(true, '재발급 후 정상 결제');

  await (await vault.revoke(A.agent)).wait();
  await expectRevert(
    asAgent.spend(A.owner, A.shop, E('0.1'), '회수된 뒤 결제 시도'),
    'DelegationInactive', '회수 직후 결제 완전 차단'
  );
  const [canB, reasonB] = await vault.canSpend(A.owner, A.agent, A.shop, E('0.1'));
  ok(canB === false && reasonB === 'REVOKED', 'canSpend가 REVOKED 통보');

  /* ── 11. 재발급 시 옛 화이트리스트 무효화 ── */
  console.log('\n11. 재발급하면 예전 화이트리스트는 되살아나지 않는다');
  const idBefore = await vault.delegationId(A.owner, A.agent);
  const expiry3 = (await chainNow()) + 7 * 86400;
  await (await vault.createDelegation(A.agent, E('1'), E('3'), E('10'), expiry3, true, [])).wait();
  const idAfter = await vault.delegationId(A.owner, A.agent);
  ok(idBefore !== idAfter, '위임 ID가 새로 발급됨');
  await expectRevert(
    asAgent.spend(A.owner, A.shop, E('0.1'), '예전 허용처로 결제'),
    'RecipientNotAllowed', '이전 위임의 허용 수취인은 더 이상 유효하지 않음'
  );

  /* ── 12. 만료 ── */
  console.log('\n12. 만료되면 아무도 손대지 않아도 자동으로 죽는다');
  await provider.send('evm_increaseTime', [8 * 86400]);
  await provider.send('evm_mine', []);
  await (await vault.setRecipients(A.agent, [A.shop], true)).wait();
  await expectRevert(
    asAgent.spend(A.owner, A.shop, E('0.1'), '만료 후 결제 시도'),
    'DelegationExpired', '만료일 지난 뒤 결제 시도'
  );

  /* ── 13. 위임자는 언제든 자금 회수 ── */
  console.log('\n13. 위임자의 출금 우선권');
  const balBefore = await vault.balanceOf(A.owner);
  await (await vault.withdraw(balBefore)).wait();
  ok(await vault.balanceOf(A.owner) === 0n, '전액 출금 완료');
  await expectRevert(vault.withdraw(E('1')), 'InsufficientBalance', '잔액 없는데 출금 시도');

  console.log(`\n${'='.repeat(46)}`);
  console.log(`통과 ${pass} / 실패 ${fail}`);
  console.log('='.repeat(46));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
