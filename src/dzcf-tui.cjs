#!/usr/bin/env node
// The `dzcf-tui` bin entry (the alias that stays available when a foreign
// package owns the dsh-tui name). Same identity-by-file approach as
// dsh-tui.cjs: inject the default action and reuse the gate.
if (!process.argv.slice(2).includes('tui')) {
  process.argv.splice(2, 0, 'tui')
}
require('./cli.cjs')
