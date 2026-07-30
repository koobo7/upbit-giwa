const solc = require('solc');
const fs = require('fs');

const source = fs.readFileSync('contracts/DelegationVault.sol', 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'DelegationVault.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    // solc 0.8.26의 기본 타깃은 cancun이고, string memory 반환에 MCOPY(0x5e)를 emit한다.
    // ganache 7.x는 MCOPY를 구현하지 않아 canSpend()가 invalid opcode로 죽는다.
    // shanghai로 고정하면 로컬 테스트와 OP Stack L2 양쪽에서 동일하게 동작한다.
    evmVersion: 'shanghai',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } }
  }
};

const out = JSON.parse(solc.compile(JSON.stringify(input)));
if (out.errors) {
  for (const e of out.errors) console.log(`[${e.severity}] ${e.formattedMessage}`);
  if (out.errors.some(e => e.severity === 'error')) process.exit(1);
}
const c = out.contracts['DelegationVault.sol']['DelegationVault'];
fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/DelegationVault.json', JSON.stringify({ abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }, null, 2));
console.log('OK  deployed size:', c.evm.deployedBytecode.object.length / 2, 'bytes');
