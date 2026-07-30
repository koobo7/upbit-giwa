const solc = require('solc');
const fs = require('fs');

const source = fs.readFileSync('contracts/DelegationVault.sol', 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'DelegationVault.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
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
