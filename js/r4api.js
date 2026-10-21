// 4차시: 서버(gas/Code.gs의 r4.* 기능)와 이야기하는 곳
//  서버  → 개발진이 배포한 Apps Script 웹 앱 하나를 모든 반이 함께 쓴다
//  연습 모드 → 같은 코드를 이 브라우저 안에서 돌리고, 그림만 브라우저 저장 공간(IndexedDB)에 둔다

import { getLocalApi, getServerApi, explainError, pollMs } from './api.js';
import { idbGet, idbSet, idbDelPrefix, idbKeys, idbDel } from './idb.js';

const CACHE_DAYS = 2;

export class LensApi {
  constructor(api) {
    this.api = api;
    this.kind = api.kind; // 'server' | 'local'
    this.mem = new Map();
    this.pending = new Map();
  }

  serverNow() {
    return this.api.serverNow();
  }

  onConnection(cb) {
    return this.api.onConnection(cb);
  }

  pollMs(name) {
    return pollMs(this.api, name);
  }

  linkParams() {
    return this.kind === 'local' ? { mode: 'local' } : {};
  }

  explain(e, who) {
    return explainError(e, who);
  }

  // ── 선생님 ──
  async createGame(title) {
    const r = await this.api.teacher('r4.create', { settings: { title } });
    return { code: r.code, game: r.game };
  }

  async putCfg(code, cfg) {
    return (await this.api.teacher('r4.cfgPut', { code, cfg: JSON.stringify(cfg) })).game;
  }

  // 그림 한 장 올리기 (연습 모드는 이 브라우저에 둔다)
  async putImage(code, name, data) {
    this.mem.set(code + ':' + name, data);
    if (this.kind === 'local') {
      await idbSet(`p:${code}:${name}`, { data, at: Date.now() });
      return;
    }
    await this.api.teacher('r4.blobPut', { code, name, data });
    await idbSet(`c:${code}:${name}`, { data, at: Date.now() });
  }

  async listGames() {
    this.api.teacher('cleanup').catch(() => {});
    return (await this.api.teacher('r4.list')).games || [];
  }

  view(code) {
    return this.api.teacher('r4.view', { code });
  }

  async stage(code, op) {
    return (await this.api.teacher('r4.stage', { code, op })).game;
  }

  async release(code, sid) {
    return (await this.api.teacher('r4.release', { code, sid })).game;
  }

  async items(code) {
    return (await this.api.teacher('r4.items', { code })).items || {};
  }

  async boardGet(code) {
    const s = (await this.api.teacher('r4.boardGet', { code })).board;
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  }

  boardPut(code, board) {
    return this.api.teacher('r4.boardPut', { code, board: JSON.stringify(board) });
  }

  async deleteGame(code) {
    const r = await this.api.teacher('r4.delete', { code });
    await idbDelPrefix(`${this.kind === 'local' ? 'p' : 'c'}:${code}:`);
    return r;
  }

  // ── 학생 ──
  async info(code) {
    return (await this.api.call('r4.info', { code })).game;
  }

  async getCfg(code) {
    const r = await this.api.call('r4.cfg', { code });
    return { cfg: JSON.parse(r.cfg || '{}'), rev: r.cfgRev || 0 };
  }

  join(code, name, sid, token) {
    return this.api.call('r4.join', { code, name, sid: sid || '', token: token || '' });
  }

  poll(code, sid, token) {
    return this.api.call('r4.poll', { code, sid: sid || '', token: token || '' });
  }

  async mine(code, sid, token) {
    return (await this.api.call('r4.mine', { code, sid, token })).items || [];
  }

  save(code, sid, token, items) {
    return this.api.call('r4.save', { code, sid, token, items });
  }

  // 그림 받기: 메모리 → 이 브라우저 저장 공간 → 서버 (같은 그림은 한 번만 받는다)
  async getImage(code, name) {
    const mk = code + ':' + name;
    if (this.mem.has(mk)) return this.mem.get(mk);
    if (this.pending.has(mk)) return this.pending.get(mk);
    const job = (async () => {
      const key = `${this.kind === 'local' ? 'p' : 'c'}:${code}:${name}`;
      const hit = await idbGet(key);
      if (hit && hit.data) {
        this.mem.set(mk, hit.data);
        return hit.data;
      }
      if (this.kind === 'local') return null;
      const r = await this.api.call('r4.blob', { code, name });
      this.mem.set(mk, r.data);
      idbSet(key, { data: r.data, at: Date.now() });
      return r.data;
    })();
    this.pending.set(mk, job);
    try {
      return await job;
    } finally {
      this.pending.delete(mk);
    }
  }
}

const clients = {};

// mode = 'server' | 'local'
export async function lensClient(mode) {
  if (clients[mode]) return clients[mode];
  const api = mode === 'local' ? await getLocalApi() : getServerApi();
  clients[mode] = new LensApi(api);
  return clients[mode];
}

// 이 브라우저에 둔 그림 중 오래된 것을 지운다
//  c: 수업 모드에서 받아 둔 그림 (이틀이 지난 것) · p: 연습 모드 게임의 그림 (연습 게임도 하루 뒤 정리되므로 이틀이 지난 것)
export async function pruneImageCache() {
  try {
    const old = Date.now() - CACHE_DAYS * 86400000;
    const keys = (await idbKeys('c:')).concat(await idbKeys('p:'));
    for (const k of keys) {
      const v = await idbGet(k, { remember: false });
      if (!v || !v.at || v.at < old) await idbDel(k);
    }
  } catch (e) {}
}
