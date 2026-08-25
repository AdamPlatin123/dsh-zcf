#!/usr/bin/env node
/**
 * dsh-zcf — command-line entry for the zero-config DeepSeek Harness setup
 * wizard. Parses argv, assembles the process-backed wizard context, and exits
 * with the wizard's result; help, version, and usage errors exit inside the
 * parser.
 * @module dsh-zcf
 */

import process from 'node:process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CommanderError } from 'commander'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { parseDzcfArgs } from './args.ts'
import { fetchUpstreamModels, installDshStreaming, probeRegistryLatency, runCommand } from './exec.ts'
import { createPromptPort } from './ui.ts'
import { runWizard } from './wizard.ts'

/** This app's version, read from its checked-in package.json. */
const VERSION = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { version: string }

const main = async (): Promise<void> => {
  let options
  try {
    options = parseDzcfArgs(process.argv.slice(2), VERSION.version)
  } catch (error) {
    if (error instanceof CommanderError) process.exit(error.exitCode)
    throw error
  }
  const exitCode = await runWizard({
    home: resolveDshHome(),
    lang: options.lang,
    run: runCommand,
    installDsh: (pm, args, onLine) => installDshStreaming(pm, args, onLine),
    probeRegistry: probeRegistryLatency,
    fetchModels: fetchUpstreamModels,
    prompt: createPromptPort(),
    interactive: process.stdin.isTTY && process.stdout.isTTY,
    out: text => process.stdout.write(`${text}\n`),
    err: text => process.stderr.write(`${text}\n`),
  }, options)
  process.exitCode = exitCode
}

void main()
