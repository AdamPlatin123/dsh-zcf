#!/usr/bin/env node
// The `dsh-tui` bin entry: this file's own identity is the launcher name, so
// no argv[1] shape guessing is involved (npx sometimes resolves a multi-bin
// package to a different .bin link than the command typed, and Windows .cmd
// shims always present the resolved cli.cjs path — both broke the old
// suffix check). It only injects the default action and reuses the gate.
if (!process.argv.slice(2).includes('tui')) {
  process.argv.splice(2, 0, 'tui')
}
require('./cli.cjs')
