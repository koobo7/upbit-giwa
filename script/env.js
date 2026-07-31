/**
 * .env를 읽어 process.env에 채운다.
 *
 * dotenv 의존성을 추가하지 않기 위해 직접 파싱한다. 형식은 KEY=VALUE 한 줄씩이며
 * #으로 시작하는 줄과 빈 줄은 무시한다. 값의 앞뒤 따옴표는 벗겨낸다.
 *
 * 이미 설정된 환경변수는 덮어쓰지 않는다 — 명령줄에서 준 값이 우선이다.
 */
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) return;
  const text = fs.readFileSync(ENV_PATH, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 1) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val !== '' && process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnv();

module.exports = { loadEnv, ENV_PATH };
