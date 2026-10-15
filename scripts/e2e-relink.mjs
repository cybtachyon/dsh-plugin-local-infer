#!/usr/bin/env node
/**
 * E2E check for the launch-record restart re-link. Two phases:
 *
 *   node scripts/e2e-relink.mjs seed
 *     Run while the old DSH host is up: finds the live engine process and the
 *     DSH host pid, and writes the provider entry's launch record (pid, start
 *     time, argv, parent pid, previous-pid list) into
 *     ~/.dsh/local-infer/config.json, as a real launch would.
 *
 *   node scripts/e2e-relink.mjs verify
 *     Run after the DSH host restarts: the new host loads the new code and,
 *     on the summary fetch, re-links the surviving engine to its provider
 *     entry. Verifies the provider reads as running, the record survived, and
 *     (optionally) that a stop clears the record.
 *
 *   node scripts/e2e-relink.mjs stop-clear
 *     POSTs the stop route with the provider id and checks the record is
 *     gone from the config file.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CONFIG_PATH = join(homedir(), '.dsh', 'local-infer', 'config.json')
const DSH_WEB_BASE = 'http://127.0.0.1:3080'
const ENGINE_PORT = 18020

function readConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
}

function writeConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n')
}

/** Find a pid whose /proc cmdline carries every marker, else null. */
function findPid(markers) {
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    let raw
    try {
      raw = readFileSync(`/proc/${entry}/cmdline`, 'utf8')
    } catch {
      continue
    }
    const command = raw.split('\0').filter((part) => part !== '').join(' ')
    if (markers.every((marker) => command.includes(marker))) {
      return { pid: Number(entry), command }
    }
  }
  return null
}

function seed() {
  const dsh = findPid(['@deepseek-ai/dsh', 'bin.js'])
  if (dsh === null) {
    console.error('seed: no DSH host process found')
    process.exit(1)
  }
  const engine = findPid(['ninfer-serve', `--port ${ENGINE_PORT}`])
  if (engine === null) {
    console.error(`seed: no engine process on port ${ENGINE_PORT} found`)
    process.exit(1)
  }
  const config = readConfig()
  const provider = config.providers.find((entry) => entry.engine === 'ninfer')
  if (provider === undefined) {
    console.error('seed: no ninfer provider entry in the config')
    process.exit(1)
  }
  const model =
    typeof provider.config?.model === 'string' ? provider.config.model : 'qwen3-27b'
  provider.launch = {
    pid: engine.pid,
    startedAt: new Date().toISOString(),
    argv: engine.command.split(' '),
    parentPid: dsh.pid,
    previousPids: [dsh.pid],
    engineId: 'ninfer',
    modelId: model,
    port: ENGINE_PORT,
  }
  writeConfig(config)
  console.log(`seed: record written for provider ${provider.id}`)
  console.log(
    `seed: engine pid ${engine.pid}, dsh parent pid ${dsh.pid} (dead after the restart)`,
  )
  console.log('seed: restart DSH now, then run: node scripts/e2e-relink.mjs verify')
}

async function verify() {
  const config = readConfig()
  const provider = config.providers.find((entry) => entry.engine === 'ninfer')
  if (provider === undefined || provider.launch === undefined) {
    console.error('verify: no launch record in the config (seed not run, or cleared)')
    process.exit(1)
  }
  const record = provider.launch
  const response = await fetch(`${DSH_WEB_BASE}/local-infer/summary`)
  if (!response.ok) {
    console.error(`verify: summary fetch failed: ${response.status}`)
    process.exit(1)
  }
  const summary = await response.json()
  const row = (summary.providers ?? []).find((entry) => entry.id === provider.id)
  if (row === undefined) {
    console.error('verify: provider missing from the summary')
    process.exit(1)
  }
  console.log(`verify: provider ${provider.id} status: ${row.status}`)
  if (row.status !== 'running') {
    console.error(
      `verify: FAIL - expected 'running' (the re-link adopted the surviving engine), got '${row.status}'`,
    )
    process.exit(1)
  }
  // The adopted record survives the re-link (only a dead engine clears it).
  const after = readConfig()
  const afterRecord = after.providers.find((entry) => entry.id === provider.id)?.launch
  if (afterRecord === undefined) {
    console.error('verify: FAIL - the adopted record was cleared by the re-link')
    process.exit(1)
  }
  console.log(
    `verify: OK - re-linked engine pid ${record.pid} (parent ${record.parentPid}) reads as running; record intact`,
  )
  console.log(
    `verify: the orphaned engine can be stopped with: kill ${record.pid}`,
  )
}

async function stopClear() {
  const config = readConfig()
  const provider = config.providers.find((entry) => entry.engine === 'ninfer')
  if (provider === undefined) {
    console.error('stop-clear: no ninfer provider entry in the config')
    process.exit(1)
  }
  const response = await fetch(`${DSH_WEB_BASE}/local-infer/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      engine: provider.engine,
      config: provider.config ?? {},
      providerId: provider.id,
    }),
  })
  if (!response.ok) {
    console.error(`stop-clear: stop route failed: ${response.status}`)
    process.exit(1)
  }
  const after = readConfig()
  const record = after.providers.find((entry) => entry.id === provider.id)?.launch
  if (record !== undefined) {
    console.error('stop-clear: FAIL - the launch record survived the stop')
    process.exit(1)
  }
  console.log(
    `stop-clear: OK - stop cleared the launch record (engine pid ${provider.launch?.pid} keeps running until killed)`,
  )
}

const phase = process.argv[2]
if (phase === 'seed') {
  seed()
} else if (phase === 'verify') {
  verify().catch((error) => {
    console.error(`verify: ${error}`)
    process.exit(1)
  })
} else if (phase === 'stop-clear') {
  stopClear().catch((error) => {
    console.error(`stop-clear: ${error}`)
    process.exit(1)
  })
} else {
  console.error('usage: node scripts/e2e-relink.mjs <seed|verify|stop-clear>')
  process.exit(1)
}
