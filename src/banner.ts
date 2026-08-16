/**
 * Terminal presentation for the dsh-zcf wizard:  a ZCF-style boxed banner (DeepSeek blue
 * frame, block wordmark, subtitle and title lines) and the menu labels. Pure
 * renderers — the wizard prints their output; nothing here writes files or
 * reads the environment, so the presentation is snapshot-testable.
 * @module dsh-zcf
 */

import { hex } from 'ansis'

/** DeepSeek brand blue, used for the banner frame and wordmark. */
const DS_BLUE = '#4D6BFE'

/** Block glyphs for one wordmark letter: six rows, all eight columns wide. */
const WORDMARK: Readonly<Record<string, readonly string[]>> = {
  'd': ['██████╗ ', '██╔══██╗', '██║  ██║', '██║  ██║', '██████╔╝', '╚═════╝ '],
  's': ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████╗', '╚═════╝ '],
  'h': ['██╗  ██╗', '██║  ██║', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  '-': ['        ', '        ', '  ════  ', '        ', '        ', '        '],
  'z': ['███████╗', '╚══██╔╝ ', '  ╚██╔╝ ', ' ╚██╔╝  ', '███████╗', '╚═════╝ '],
  'c': [' ██████╗', '██╔════╝', '██║     ', '██║     ', '╚██████╗', ' ╚═════╝'],
  'f': ['███████╗', '██╔════╝', '███████╗', '██║     ', '██║     ', '╚═╝     '],
}

/** The wordmark the banner spells; each letter must exist in {@link WORDMARK}. */
const WORDMARK_TEXT = 'dsh-zcf'

/** One banner row of the wordmark: letters joined two columns apart. */
const GLYPHS: readonly string[] = Array.from({ length: 6 }, (_, index) =>
  WORDMARK_TEXT.split('').map(letter => WORDMARK[letter]?.[index] ?? '').join('  '))

/** Box inner width (columns between the ║ borders). */
const BOX_WIDTH = 72

const SUBTITLE = 'DeepSeek Zero-Config Flow'
const TITLE = 'Zero-Config Code Flow for DeepSeek Harness'

/** Pad a string to a cell width, counting CJK wide glyphs as two cells. */
function padWidth(text: string, width: number): string {
  let cells = 0
  for (const char of text) cells += /[一-鿿！-｠　-〿]/.test(char) ? 2 : 1
  return text + ' '.repeat(Math.max(0, width - cells))
}

/** A row inside the box: ║, padded plain content, ║. */
const row = (content: string): string => `║${padWidth(content, BOX_WIDTH)}║`

/**
 * The full boxed banner, uniformly DeepSeek blue. Rows are padded as plain text
 * first and colored only after layout, so ANSI codes never distort the box.
 */
export function renderBanner(): string {
  const line = '═'.repeat(BOX_WIDTH)
  const rows = GLYPHS.map(glyph => row(`   ${glyph}`))
  const subtitleRow = row(`   ${SUBTITLE}`)
  const titleRow = row(`   ${TITLE}`)
  const body = [row(''), ...rows, row(''), subtitleRow, row(''), titleRow, row('')].join('\n')
  return hex(DS_BLUE).bold(`╔${line}╗\n${body}\n╚${line}╝`)
}

/** Main-menu actions the interactive session offers. */
export type MenuAction = 'init' | 'marketplace' | 'manage' | 'configure' | 'credentials' | 'exit'

/** Render the menu labels as a plain numbered list (non-interactive reference). */
export function renderMenuLines(title: string, options: readonly { action: MenuAction; label: string }[]): string {
  return [title, '', ...options.map(option => option.label)].join('\n')
}
