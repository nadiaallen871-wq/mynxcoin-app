#!/usr/bin/env node
/**
 * Project-local PostgreSQL cluster for machines without Docker.
 * It uses the installed PostgreSQL binaries and needs no admin rights.
 *
 *   node infrastructure/local/pg-local.mjs init     create cluster + dev/test databases
 *   node infrastructure/local/pg-local.mjs start
 *   node infrastructure/local/pg-local.mjs stop
 *   node infrastructure/local/pg-local.mjs status
 *
 * Data lives in .devdata/pg (git-ignored). It listens on 127.0.0.1 only.
 * Env overrides: PG_BIN (binary dir), PG_LOCAL_PORT (default 5433),
 * PG_LOCAL_PASSWORD (default "mynx_dev": a development-only credential).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..', '..');
const dataDir = join(root, '.devdata', 'pg');
const logFile = join(root, '.devdata', 'pg.log');
const port = process.env.PG_LOCAL_PORT ?? '5433';
const user = 'mynx';
const password = process.env.PG_LOCAL_PASSWORD ?? 'mynx_dev';
const databases = ['mynx_dev', 'mynx_test'];
const exe = process.platform === 'win32' ? '.exe' : '';

function findBin() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['pg_ctl'], { encoding: 'utf8' });
  if (which.status === 0) return resolve(which.stdout.split(/\r?\n/)[0], '..');
  if (process.platform === 'win32') {
    const base = 'C:\\Program Files\\PostgreSQL';
    if (existsSync(base)) {
      const versions = readdirSync(base)
        .filter((v) => /^\d+$/.test(v))
        .sort((a, b) => b - a);
      for (const v of versions) if (existsSync(join(base, v, 'bin', `pg_ctl${exe}`))) return join(base, v, 'bin');
    }
  }
  throw new Error('PostgreSQL binaries not found. Set PG_BIN to the directory containing pg_ctl.');
}

const bin = findBin();
const tool = (name) => join(bin, `${name}${exe}`);
const run = (name, args, opts = {}) => execFileSync(tool(name), args, { stdio: 'inherit', ...opts });
const pgEnv = { ...process.env, PGPASSWORD: password };

function status() {
  return spawnSync(tool('pg_ctl'), ['status', '-D', dataDir], { encoding: 'utf8' }).status === 0;
}

function start() {
  if (status()) return console.log(`PostgreSQL already running on 127.0.0.1:${port}`);
  // stdio 'ignore': otherwise the long-lived postmaster inherits our stdout/stderr
  // handles and any parent pipe (CI, `| tail`) never closes.
  run('pg_ctl', ['start', '-D', dataDir, '-l', logFile, '-w', '-t', '300', '-o', `-p ${port} -h 127.0.0.1`], { stdio: 'ignore' });
  console.log(`PostgreSQL started on 127.0.0.1:${port}`);
}

function init() {
  if (existsSync(join(dataDir, 'PG_VERSION'))) {
    console.log('Cluster already initialised at', dataDir);
  } else {
    mkdirSync(dataDir, { recursive: true });
    const pwFile = join(tmpdir(), `mynx-pg-${process.pid}.pw`);
    writeFileSync(pwFile, password, { mode: 0o600 });
    try {
      run('initdb', ['-D', dataDir, '-U', user, '--pwfile', pwFile, '-A', 'scram-sha-256', '-E', 'UTF8', '--locale=C']);
    } finally {
      rmSync(pwFile, { force: true });
    }
  }
  start();
  for (const db of databases) {
    const exists = execFileSync(
      tool('psql'),
      ['-h', '127.0.0.1', '-p', port, '-U', user, '-d', 'postgres', '-tAc', `SELECT 1 FROM pg_database WHERE datname='${db}'`],
      {
        env: pgEnv,
        encoding: 'utf8',
      },
    ).trim();
    if (exists === '1') console.log(`Database ${db} exists`);
    else {
      run('createdb', ['-h', '127.0.0.1', '-p', port, '-U', user, db], { env: pgEnv });
      console.log(`Created database ${db}`);
    }
  }
  console.log(`\nDATABASE_URL=postgresql://${user}:${password}@127.0.0.1:${port}/mynx_dev?schema=public`);
}

const command = process.argv[2];
switch (command) {
  case 'init':
    init();
    break;
  case 'start':
    start();
    break;
  case 'stop':
    if (status()) run('pg_ctl', ['stop', '-D', dataDir, '-m', 'fast']);
    else console.log('PostgreSQL is not running');
    break;
  case 'status':
    console.log(status() ? `running on 127.0.0.1:${port}` : 'stopped');
    break;
  default:
    console.error('Usage: pg-local.mjs <init|start|stop|status>');
    process.exitCode = 1;
}
