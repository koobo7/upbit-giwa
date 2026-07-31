/**
 * 에이전트 활동 기록을 심사용 서버에 반영한다.
 *
 *   node script/publish.js          한 번 실행
 *   WATCH=1 node script/publish.js  활동 파일이 바뀔 때마다 자동 반영 (5분 간격 제한)
 *
 * 데몬은 개인키가 있는 로컬에서 돌리고, 그 결과만 커밋·푸시해서
 * 원격(맥미니)이 pull하도록 한다. 심사용 서버에 키를 두지 않기 위함이다.
 *
 * 원격 동기화까지 하려면 REMOTE 환경변수에 ssh 대상을 넣는다.
 *   REMOTE=mac-mini node script/publish.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ACTIVITY = path.join(ROOT, 'web', 'agent-activity.json');
const REMOTE = process.env.REMOTE || '';
const REMOTE_DIR = process.env.REMOTE_DIR || '/Users/m/giwa';
const MIN_INTERVAL = Number(process.env.MIN_INTERVAL || 300) * 1000;

const sh = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'pipe' }).toString().trim();

function publish() {
  if (!fs.existsSync(ACTIVITY)) {
    console.log('활동 파일이 없습니다. 먼저 데몬을 실행하세요.');
    return false;
  }

  // 변경이 없으면 빈 커밋을 만들지 않는다.
  const changed = sh('git status --porcelain web/agent-activity.json');
  if (!changed) {
    console.log('변경 없음.');
    return false;
  }

  const a = JSON.parse(fs.readFileSync(ACTIVITY, 'utf8'));
  const paid = a.events.filter((e) => e.status === 'paid').length;
  const blocked = a.events.filter((e) => e.status === 'blocked').length;

  sh('git add web/agent-activity.json');
  sh(`git commit -q -m "chore: 에이전트 활동 기록 (결제 ${paid} / 차단 ${blocked})"`);
  sh('git push -q origin main');
  console.log(`푸시 완료 — 결제 ${paid} / 차단 ${blocked}`);

  if (REMOTE) {
    try {
      execSync(`ssh -o ConnectTimeout=10 ${REMOTE} "cd ${REMOTE_DIR} && git pull --ff-only origin main"`,
        { stdio: 'pipe' });
      console.log(`${REMOTE} 동기화 완료`);
    } catch (e) {
      console.error(`${REMOTE} 동기화 실패:`, e.message.split('\n')[0]);
    }
  }
  return true;
}

if (!process.env.WATCH) {
  publish();
} else {
  console.log(`활동 파일 감시 중 (최소 ${MIN_INTERVAL / 1000}초 간격). Ctrl+C로 종료.`);
  publish();
  let last = Date.now();
  let pending = false;

  fs.watchFile(ACTIVITY, { interval: 5000 }, () => { pending = true; });

  setInterval(() => {
    if (!pending) return;
    if (Date.now() - last < MIN_INTERVAL) return;
    pending = false;
    last = Date.now();
    try { publish(); } catch (e) { console.error(e.message.split('\n')[0]); }
  }, 10000);
}
