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

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(ROOT, url === '/' ? 'index.html' : url);

  // 디렉터리 탈출 방지
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(ROOT, 'index.html');
  }

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(fs.readFileSync(file));
}).listen(PORT, () => {
  console.log(`\n  INGAM 대시보드  http://localhost:${PORT}\n`);
});
