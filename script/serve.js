/**
 * INGAM 대시보드 로컬 서버
 *
 *   npm run web          → http://localhost:5173
 *   PORT=8080 npm run web
 *
 * web/ 디렉터리를 정적으로 서빙합니다.
 * 배포 후 생성된 web/deployed.json도 같이 읽히므로 컨트랙트 주소를 손으로 넣을 필요가 없습니다.
 * Cloudflare Pages에 올릴 때도 빌드 출력 디렉터리를 web/ 으로 지정하면 동일하게 동작합니다.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'web');
const PORT = Number(process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/* 자율 결제 에이전트(daemon.js) 프로세스 제어.
   대시보드에서 시작·정지할 수 있게 한다. 로컬 전용이므로 외부 노출은 하지 않는다. */
const { spawn } = require('child_process');
let daemon = null;

function daemonStatus() {
  return { running: !!daemon && !daemon.killed, pid: daemon?.pid ?? null };
}

function startDaemon() {
  if (daemon && !daemon.killed) return daemonStatus();
  daemon = spawn(process.execPath, [path.join(__dirname, 'daemon.js')], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: process.env,
  });
  daemon.on('exit', () => { daemon = null; });
  return daemonStatus();
}

function stopDaemon() {
  if (daemon && !daemon.killed) {
    // SIGINT를 보내 daemon이 상태 파일에 running:false를 기록하고 정리하게 한다.
    daemon.kill('SIGINT');
    daemon = null;
  }
  return daemonStatus();
}

process.on('exit', () => { if (daemon) daemon.kill('SIGINT'); });

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);

  // 제어 API. 대시보드가 같은 출처에서 호출한다.
  if (url.startsWith('/api/daemon')) {
    const action = url.split('/')[3] || 'status';
    let out;
    if (action === 'start') out = startDaemon();
    else if (action === 'stop') out = stopDaemon();
    else out = daemonStatus();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(out));
    return;
  }

  let file = path.join(ROOT, url === '/' ? 'index.html' : url);

  // 디렉터리 탈출 방지
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(ROOT, 'index.html');
  }

  // 캐시를 완전히 막는다. 강제 새로고침 없이도 최신 코드가 뜨도록 한다.
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
  });
  res.end(fs.readFileSync(file));
}).listen(PORT, () => {
  console.log(`\n  INGAM 대시보드  http://localhost:${PORT}\n`);
});
