/**
 * Prompt surface for the dsh-zcf wizard. The wizard consumes the injectable
 * {@link PromptFn} contract; {@link createPromptPort} is the @clack/prompts
 * production implementation, bound to injectable input/output streams so
 * every question type the wizard asks stays answerable by tests and scripted
 * harnesses without a TTY. A cancelled question resolves a `cancelled`
 * outcome — clack reports Esc/Ctrl+C as a symbol, never a value.
 * @module dsh-zcf
 */

import { confirm, isCancel, multiselect, password, select, text } from '@clack/prompts'
import type { Readable, Writable } from 'node:stream'

/** One wizard question, reduced to the shapes the wizard actually asks. */
export type PromptQuestion =
  | { type: 'confirm'; name: string; message: string; default?: boolean }
  | { type: 'password'; name: string; message: string }
  | { type: 'input'; name: string; message: string; default?: string }
  | { type: 'list'; name: string; message: string; choices: readonly { name: string; value: string }[] }
  | { type: 'multiselect'; name: string; message: string; choices: readonly { name: string; value: string }[] }

/** One prompt batch's result: answered values, or a user cancellation. */
export type PromptOutcome = { status: 'answered'; value: Readonly<Record<string, unknown>> } | { status: 'cancelled' }

/** Ask a batch of questions and resolve its outcome. */
export type PromptFn = (questions: readonly PromptQuestion[]) => Promise<PromptOutcome>

/**
 * Build the @clack/prompts-backed prompt port, bound to one input/output
 * pair. Questions run in order; the first cancellation ends the batch.
 * @param input - prompt input stream (defaults to stdin).
 * @param output - prompt output stream (defaults to stdout).
 * @returns the prompt function.
 */
export function createPromptPort(input: Readable = process.stdin, output: Writable = process.stdout): PromptFn {
  return async (questions: readonly PromptQuestion[]): Promise<PromptOutcome> => {
    const answers: Record<string, unknown> = {}
    for (const question of questions) {
      let result: unknown
      switch (question.type) {
        case 'confirm': {
          result = await confirm({
            message: question.message,
            ...(question.default === undefined ? {} : { initialValue: question.default }),
            input,
            output,
          })
          break
        }
        case 'password': {
          result = await password({ message: question.message, input, output })
          break
        }
        case 'input': {
          result = await text({
            message: question.message,
            ...(question.default === undefined ? {} : { defaultValue: question.default }),
            input,
            output,
          })
          break
        }
        case 'list': {
          result = await select({
            message: question.message,
            options: question.choices.map(choice => ({ value: choice.value, label: choice.name })),
            input,
            output,
          })
          break
        }
        case 'multiselect': {
          result = await multiselect({
            message: question.message,
            options: question.choices.map(choice => ({ value: choice.value, label: choice.name })),
            input,
            output,
          })
          break
        }
      }
      if (isCancel(result)) return { status: 'cancelled' }
      answers[question.name] = result
    }
    return { status: 'answered', value: answers }
  }
}
