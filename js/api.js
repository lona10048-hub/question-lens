// 서버와 이야기하는 곳
//  - 서버: 개발진이 배포한 4차시 전용 Apps Script 웹 앱 하나를 모든 반이 함께 쓴다. (선생님 열쇠로 선생님을 구별)
//  - 연습 모드: 같은 서버 코드(gas/Code.gs)를 이 브라우저 안에서 돌린다. (인터넷 없이 미리 해 보기)
// 두 방식 모두 call(action, params) 하나로 쓴다.

import { GAS_GLOBALS } from './gas-stub.js';
import { SERVER_URL, SERVER_RULES, POLL } from './config.js';

const TEACHER_KEY = 'qtg-teacher-key'; // 이 브라우저의 선생님을 알아보는 열쇠 (1~3차시와 같이 씀)
const TIMEOUT_MS = 25000;

function lsGet(k) {
  try {
    return localStorage.getItem(k);
  } catch (e) {
    return null;
  }
}

function lsSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch (e) {}
}

export function normalizeUrl(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/https:\/\/script\.google\.com\/(?:a\/macros\/[^/\s]+|macros)\/s\/([A-Za-z0-9_-]{20,})\/exec/);
  return m ? m[0] : null;
}

export const serverUrl = () => normalizeUrl(SERVER_URL || '');
export const hasServer = () => !!serverUrl();

export function getTeacherKey() {
  let k = lsGet(TEACHER_KEY);
  if (!k || !/^[A-Za-z0-9_-]{16,64}$/.test(k)) {
    const a = new Uint8Array(18);
    crypto.getRandomValues(a);
    k = btoa(String.fromCharCode(...a))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    lsSet(TEACHER_KEY, k);
  }
  return k;
}

// ── 공통: 시계 맞추기와 연결 상태 ───────────────────────

class BaseApi {
  constructor() {
    this.offset = 0;
    this.bestRtt = Infinity;
    this.listeners = new Set();
    this.online = true;
    this.fails = 0;
    this.tk = getTeacherKey();
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  // 왕복 시간이 가장 짧았던 응답으로 서버 시계와의 차이를 잡는다.
  syncClock(serverNow, t0, t1) {
    if (!serverNow) return;
    const rtt = t1 - t0;
    if (rtt <= this.bestRtt * 1.5 || this.bestRtt === Infinity) {
      if (rtt < this.bestRtt) this.bestRtt = rtt;
      this.offset = serverNow - (t0 + t1) / 2;
    }
  }

  onConnection(cb) {
    this.listeners.add(cb);
    cb(this.online);
    return () => this.listeners.delete(cb);
  }

  setOnline(ok) {
    if (ok) this.fails = 0;
    else this.fails++;
    const now = ok || this.fails < 2;
    if (now !== this.online) {
      this.online = now;
      this.listeners.forEach((cb) => cb(now));
    }
  }

  async call(action, params = {}, retry = 1) {
    const t0 = Date.now();
    let data;
    try {
      data = await this.send({ ...params, action });
    } catch (e) {
      this.setOnline(false);
      // 요청이 몰려 서버가 받지 못했을 때는 잠깐 쉬었다가 한 번 더 보낸다
      if (e.code === 'BUSY' && retry > 0) {
        await new Promise((r) => setTimeout(r, 700 + Math.random() * 900));
        return this.call(action, params, retry - 1);
      }
      throw e;
    }
    const t1 = Date.now();
    this.setOnline(true);
    this.syncClock(data && data.now, t0, t1);
    if (!data || !data.ok) {
      const err = new Error((data && (data.message || data.error)) || 'SERVER_ERROR');
      err.code = (data && data.error) || 'SERVER_ERROR';
      if (err.code === 'BUSY' && retry > 0) {
        await new Promise((r) => setTimeout(r, 700 + Math.random() * 900));
        return this.call(action, params, retry - 1);
      }
      throw err;
    }
    return data;
  }

  // 선생님 기능에는 이 브라우저의 선생님 열쇠를 붙인다
  teacher(action, params = {}) {
    return this.call(action, { ...params, tk: this.tk });
  }
}

// ── 서버 ─────────────────────────────────────────────

export class GasApi extends BaseApi {
  constructor(url) {
    super();
    this.kind = 'server';
    this.url = url;
  }

  async send(payload) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      // text/plain으로 보내야 브라우저가 사전 확인(preflight) 없이 Apps Script에 바로 보낸다.
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: ctrl.signal,
      });
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch (e) {
        const err = new Error('NOT_JSON');
        err.code = res.status === 429 || /too many|simultaneous|quota|할당량|너무 많/i.test(text) ? 'BUSY' : 'SERVER_DOWN';
        throw err;
      }
    } catch (e) {
      if (e.code) throw e;
      const err = new Error(e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK');
      err.code = e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

let serverApi = null;
export function getServerApi() {
  const url = serverUrl();
  if (!url) {
    const err = new Error('NO_SERVER');
    err.code = 'NO_SERVER';
    throw err;
  }
  if (!serverApi) serverApi = new GasApi(url);
  return serverApi;
}

// ── 연습 모드 ─────────────────────────────────────────

let practicePromise = null;

async function loadPracticeServer() {
  if (!practicePromise) {
    practicePromise = (async () => {
      // 예전에 같은 주소에서 연 다른 사이트의 Code.gs가 브라우저에 남아 있을 수 있어서, 늘 새로 받아 온다
      const res = await fetch(new URL('../gas/Code.gs', import.meta.url), { cache: 'no-store' });
      if (!res.ok) throw new Error('gas/Code.gs 파일을 불러오지 못했어요.');
      const code = await res.text();
      const names = Object.keys(GAS_GLOBALS);
      // eslint-disable-next-line no-new-func
      const factory = new Function(...names, `${code}\n;return { doPost: doPost, handle: handle, version: APP_VERSION };`);
      return factory(...names.map((n) => GAS_GLOBALS[n]));
    })();
  }
  return practicePromise;
}

export class LocalApi extends BaseApi {
  constructor() {
    super();
    this.kind = 'local';
  }

  async send(payload) {
    const server = await loadPracticeServer();
    // 실제 인터넷처럼 조금 늦게 답한다 (여러 창이 동시에 보내도 하나씩 처리)
    const extra = Number(lsGet('ql-practice-latency')) || 0;
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 120 + extra * (0.6 + Math.random() * 0.8)));
    const run = () => JSON.parse(server.doPost({ postData: { contents: JSON.stringify(payload) } }).getContent());
    if (navigator.locks && navigator.locks.request) return navigator.locks.request('ql-practice-server', run);
    return run();
  }
}

let localApi = null;
export async function getLocalApi() {
  if (!localApi) localApi = new LocalApi();
  await loadPracticeServer();
  return localApi;
}

export function pollMs(api, name) {
  const table = api && api.kind === 'local' ? POLL.local : POLL.server;
  return table[name] || 3000;
}

// ── 오류 안내 ────────────────────────────────────────

export function explainError(e, who = 'teacher') {
  const c = (e && e.code) || '';
  const T = who === 'teacher';
  switch (c) {
    case 'NETWORK':
      return T ? '서버에 닿지 못했어요. 인터넷 연결을 확인해 주세요. 학교 방화벽이 script.google.com을 막고 있을 수도 있어요.' : '인터넷 연결을 확인해 주세요.';
    case 'TIMEOUT':
      return '서버가 답하는 데 너무 오래 걸려요. 잠시 뒤 다시 해 주세요.';
    case 'SERVER_DOWN':
    case 'NOT_JSON':
      return '서버에 연결하지 못했어요. 잠시 뒤 다시 해 주세요.';
    case 'NO_SERVER':
      return '서버 주소가 아직 준비되지 않았어요. 지금은 연습 모드로만 해 볼 수 있어요.';
    case 'NOT_OWNER':
      return '이 브라우저에서 만든 게임이 아니에요. 게임은 만든 컴퓨터의 같은 브라우저에서만 관리할 수 있어요.';
    case 'NO_KEY':
      return '이 브라우저의 선생님 열쇠를 만들지 못했어요. 브라우저 저장 공간(쿠키·사이트 데이터)이 막혀 있는지 확인해 주세요.';
    case 'TOO_MANY_GAMES':
      return `게임은 한 번에 ${SERVER_RULES.gamesPerTeacher}개까지 가질 수 있어요. 게임 목록에서 다 쓴 게임을 지워 주세요.`;
    case 'SERVER_FULL':
      return '지금 서버를 쓰는 반이 너무 많아요. 잠시 뒤 다시 해 주세요.';
    case 'NO_GAME':
      return T ? '없거나 정리된 게임이에요.' : '게임 코드를 다시 확인해 주세요.';
    case 'BAD_CODE':
      return '게임 코드 4자리를 입력해 주세요.';
    case 'EXPIRED':
      return '시간이 지나 정리된 게임이에요. 게임 코드를 다시 확인해 주세요.';
    case 'NOT_READY':
      return '선생님이 아직 자료를 올리고 있어요. 잠시 뒤 다시 들어와 주세요.';
    case 'BAD_NAME':
      return '별명을 써 주세요.';
    case 'CLASS_FULL':
      return '이 게임에 들어올 수 있는 인원이 다 찼어요. 선생님께 알려 주세요.';
    case 'NOT_MINE':
      return '선생님이 이 태블릿의 연결을 풀었어요. 별명을 쓰고 다시 들어와 주세요.';
    case 'ENDED':
      return '활동이 끝나서 더 이상 질문을 고칠 수 없어요.';
    case 'BAD_TITLE':
      return '프로젝트 이름을 써 주세요.';
    case 'TOO_BIG':
      return '자료가 너무 커요. 그림 수를 줄이거나 글을 짧게 해 주세요.';
    case 'TOO_MANY_FILES':
      return '그림(이미지 · PDF 쪽)이 너무 많아요. 몇 개를 빼 주세요.';
    case 'NO_FILE':
      return '자료 파일을 찾지 못했어요.';
    case 'BUSY':
      return '요청이 한꺼번에 몰렸어요. 잠시 뒤 다시 눌러 주세요.';
    case 'STORAGE_FULL':
      return '이 브라우저 저장 공간이 가득 찼어요. 연습 모드의 지난 게임을 지워 주세요.';
    case 'UNKNOWN_ACTION':
      return '서버 코드가 예전 버전이에요. 개발진에게 알려 주세요.';
    default:
      return (T ? '문제가 생겼어요: ' : '문제가 생겼어요. 선생님께 알려 주세요. ') + String((e && e.message) || c).slice(0, 80);
  }
}
