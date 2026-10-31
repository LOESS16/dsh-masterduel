/**
 * Minimal MCP stdio client for dsh-masterduel.
 *
 * The Master Duel advisor MCP server speaks newline-delimited JSON-RPC on
 * stdio. We keep one long-lived child per host plugin instance and serialize
 * initialization so concurrent HTTP requests share the same handshake.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

function firstExisting(list) {
  for (const item of list) {
    if (item && existsSync(item)) return item;
  }
  return list[0] || '';
}

/** Node shipped with DSH Desktop, discovered without hard-coded install paths. */
export function resolveNode() {
  const candidates = [];
  if (process.env.DSH_MASTERDUEL_NODE) candidates.push(process.env.DSH_MASTERDUEL_NODE);
  if (process.versions.electron) {
    const execDir = dirname(process.execPath);
    if (process.resourcesPath) {
      candidates.push(join(process.resourcesPath, 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'));
      candidates.push(join(process.resourcesPath, 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node'));
    }
    candidates.push(join(execDir, 'resources', 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'));
    candidates.push(join(execDir, 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'));
  } else {
    candidates.push(process.execPath);
  }
  const found = firstExisting(candidates);
  return found || '';
}

/** Find the MCP server: env override, then ~/.dsh/mcp/*, then a conventional default. */
export function resolveMcpScript() {
  const candidates = [];
  if (process.env.DSH_MASTERDUEL_MCP) candidates.push(process.env.DSH_MASTERDUEL_MCP);
  const root = join(homedir(), '.dsh', 'mcp');
  try {
    const dirs = readdirSync(root).sort((a, b) => (a.includes('master-duel') ? -1 : b.includes('master-duel') ? 1 : 0));
    for (const dir of dirs) candidates.push(join(root, dir, 'dist', 'mcp.mjs'));
  } catch {
    /* no MCP directory yet */
  }
  candidates.push(join(root, 'master-duel-ai-advisor', 'dist', 'mcp.mjs'));
  return firstExisting(candidates);
}

export const DEFAULT_MCP_SCRIPT = resolveMcpScript();
export const DEFAULT_NODE = resolveNode();

export function mcpRuntimeInfo(script = DEFAULT_MCP_SCRIPT, command = DEFAULT_NODE) {
  return {
    script,
    command,
    scriptExists: Boolean(script && existsSync(script)),
    nodeExists: Boolean(command && existsSync(command)),
  };
}

export class McpClient {
  constructor({
    command = process.env.DSH_MASTERDUEL_NODE || DEFAULT_NODE,
    script = process.env.DSH_MASTERDUEL_MCP || DEFAULT_MCP_SCRIPT,
    timeoutMs = 180_000,
  } = {}) {
    this.command = command;
    this.script = script;
    this.timeoutMs = timeoutMs;
    this.child = null;
    this.seq = 0;
    this.pending = new Map();
    this.buffer = '';
    this.ready = null;
    this.lastError = '';
  }

  ensure() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      if (!this.command) {
        this.ready = null;
        reject(new Error('找不到 DSH 自带 Node；请设置 DSH_MASTERDUEL_NODE'));
        return;
      }
      if (!existsSync(this.script)) {
        this.ready = null;
        reject(new Error(`MCP server not found: ${this.script}`));
        return;
      }
      const child = spawn(this.command, [this.script], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });
      this.child = child;

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => this.#onData(chunk));
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        const line = String(chunk).trim();
        if (line) this.lastError = line.slice(0, 500);
      });
      child.on('error', (error) => {
        this.lastError = error.message;
        this.#failAll(error);
        this.ready = null;
        reject(error);
      });
      child.on('exit', (code, signal) => {
        this.lastError = `MCP exited code=${code} signal=${signal}`;
        this.#failAll(new Error(this.lastError));
        this.child = null;
        this.ready = null;
      });

      this.request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'dsh-masterduel', version: '0.2.0' },
      })
        .then(() => {
          this.notify('notifications/initialized');
          resolve();
        })
        .catch((error) => {
          this.ready = null;
          reject(error);
        });
    });
    return this.ready;
  }

  async callTool(name, args = {}) {
    await this.ensure();
    return this.request('tools/call', { name, arguments: args });
  }

  /** Returns the concatenated text blocks of a tools/call result. */
  async toolText(name, args = {}) {
    const result = await this.callTool(name, args);
    const content = Array.isArray(result?.content) ? result.content : [];
    return content.filter((part) => part?.type === 'text').map((part) => part.text).join('\n');
  }

  request(method, params, timeoutMs = this.timeoutMs) {
    const id = ++this.seq;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${method} timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      if (!this.child?.stdin.writable) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error('MCP stdin is not writable'));
        return;
      }
      this.child.stdin.write(payload + '\n');
    });
  }

  notify(method, params) {
    if (!this.child?.stdin.writable) return;
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  close() {
    if (this.child) {
      try { this.child.kill(); } catch { /* already gone */ }
    }
    this.child = null;
    this.ready = null;
  }

  #onData(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.id === undefined) continue; // notifications
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'MCP error'));
      else pending.resolve(message.result);
    }
  }

  #failAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
