import { parse, type ParseIssue } from '../dsl/parser'

export interface GenerateResult {
  dsl: string
  model?: string
  /** Parse problems in what came back — the same parser the editor uses. */
  errors: ParseIssue[]
  warnings: ParseIssue[]
}

export class ProxyUnavailableError extends Error {
  constructor() {
    super(
      'Could not reach the local AI proxy on /api/generate.\n' +
        'Start it in a second terminal:\n\n' +
        '  npm run dev:proxy\n\n' +
        'It reads ANTHROPIC_API_KEY from .env.local. The key never reaches the browser.',
    )
    this.name = 'ProxyUnavailableError'
  }
}

/**
 * Plain English in, DSL out. Validation is the same parser that validates
 * hand-written DSL — there is deliberately no second validation path.
 */
export async function generateFromPrompt(
  prompt: string,
  currentDsl?: string,
  signal?: AbortSignal,
): Promise<GenerateResult> {
  let response: Response
  try {
    response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, currentDsl }),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ProxyUnavailableError()
  }

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const upstream =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : null

    // 404 means no route; a bodiless 5xx is the dev server failing to reach the
    // proxy at all (ECONNREFUSED shows up as a bare 502). Either way the fix is
    // to start it, so say that rather than reporting a status code.
    if (response.status === 404 || (!upstream && response.status >= 500)) {
      throw new ProxyUnavailableError()
    }
    throw new Error(upstream ?? `The proxy returned ${response.status}.`)
  }

  const dsl = stripFences(
    payload && typeof payload === 'object' && 'dsl' in payload
      ? String((payload as { dsl: unknown }).dsl)
      : '',
  )
  if (!dsl.trim()) throw new Error('The model returned an empty diagram.')

  const { errors, warnings } = parse(dsl)
  return {
    dsl,
    model:
      payload && typeof payload === 'object' && 'model' in payload
        ? String((payload as { model: unknown }).model)
        : undefined,
    errors,
    warnings,
  }
}

/** The prompt forbids fences, but strip them anyway rather than fail the parse. */
function stripFences(text: string): string {
  const fenced = /^\s*```(?:[\w-]*)\n([\s\S]*?)\n?```\s*$/.exec(text)
  return (fenced ? fenced[1] : text).trim() + '\n'
}
