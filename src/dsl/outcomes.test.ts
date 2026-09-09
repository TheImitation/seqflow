import { describe, expect, it } from 'vitest'
import { inferArchitecture, messageFailures } from './architecture'
import { buildCoverage } from './coverage'
import { enumerateOutcomes } from './outcomes'
import { parse } from './parser'

const doc = (text: string) => parse(text).doc

/** Two nested alts, one contract whose failures are only declared. */
const NESTED = `sequenceDiagram
  participant UI as Front end : client
  participant Api as API : aws:apigateway
  participant Scan as Scanner : aws:ecs
  participant Store as Bucket : aws:s3

  UI->>Api: Upload @Upload
  Api->>Scan: Scan it @Scan
  alt clean
    Scan-->>Api: verdict clean
    Api->>Store: Store the file
    Store-->>UI: Done
  else infected (unhappy)
    Scan-->>Api: verdict infected
    Api-->>UI: Rejected
  end

contract Upload {
  transport: http
  method: POST
  path: /upload
  responses:
    200 OK
    413 PayloadTooLarge (unhappy)
    429 TooManyRequests (unhappy)
}

contract Scan {
  transport: http
  method: POST
  path: /scan
  responses:
    200 OK
    422 Infected (unhappy)
}
`

describe('enumerateOutcomes', () => {
  it('returns a single outcome when nothing branches', () => {
    const out = enumerateOutcomes(doc('sequenceDiagram\n  A->>B: go\n'))
    expect(out).toHaveLength(1)
    expect(out[0].isUnhappy).toBe(false)
    expect(out[0].stepCount).toBe(1)
  })

  it('finds one path per alt branch', () => {
    const out = enumerateOutcomes(doc(NESTED))
    expect(out).toHaveLength(2)
    expect(out.map((o) => o.decisions[0].branchLabel)).toEqual(['clean', 'infected'])
  })

  it('marks the path that ends on an unhappy branch', () => {
    const out = enumerateOutcomes(doc(NESTED))
    expect(out.find((o) => o.isUnhappy)?.decisions[0].branchLabel).toBe('infected')
  })

  it('keeps only the steps the chosen branch actually walks', () => {
    const [happy, infected] = enumerateOutcomes(doc(NESTED))
    expect(happy.stepCount).toBe(5)
    expect(infected.stepCount).toBe(4)
    // The store write exists only on the happy path.
    const ids = new Set(infected.messageIds)
    const storeWrite = doc(NESTED).messages.find((m) => m.to === 'Store')!
    expect(ids.has(storeWrite.id)).toBe(false)
  })

  it('collapses choices made inside a branch nobody entered', () => {
    // The inner alt only exists under `clean`, so choosing it while `infected`
    // is taken must not produce a second, identical infected path.
    const text = `sequenceDiagram
  A->>B: start
  alt clean
    B-->>A: ok
    alt fast
      A->>B: quick
    else slow (unhappy)
      A->>B: retry
    end
  else broken (unhappy)
    B-->>A: nope
  end
`
    const out = enumerateOutcomes(doc(text))
    // clean+fast, clean+slow, broken — not 2 × 2.
    expect(out).toHaveLength(3)
  })

  it('counts declared failures sitting on the path', () => {
    const [happy] = enumerateOutcomes(doc(NESTED))
    // Upload declares 2, Scan declares 1, both are on the happy walk.
    expect(happy.declaredFailures).toBe(3)
  })

  it('gives each outcome a branch-choice that reproduces it', () => {
    for (const outcome of enumerateOutcomes(doc(NESTED))) {
      expect(Object.keys(outcome.choice).length).toBe(outcome.decisions.length)
    }
  })
})

describe('declared vs realised failures', () => {
  it('does not call a message unhappy just because its contract lists errors', () => {
    const d = doc(NESTED)
    const upload = d.messages.find((m) => m.contractRef === 'Upload')!
    const signal = messageFailures(d, upload)
    expect(signal.declared).toBe(2)
    expect(signal.realised).toBe(false)
  })

  it('calls a message realised when it sits on a drawn failure branch', () => {
    const d = doc(NESTED)
    const rejected = d.messages.find((m) => m.label === 'Rejected')!
    expect(messageFailures(d, rejected).realised).toBe(true)
  })

  it('separates the two signals on architecture edges', () => {
    const d = doc(NESTED)
    const arch = inferArchitecture(d)
    const uiToApi = arch.edges.find((e) => e.from === 'UI' && e.to === 'Api')!
    // Upload declares 2 failures but UI→Api is never on a failure branch.
    expect(uiToApi.hasUnhappyPath).toBe(false)
    expect(uiToApi.declaredFailures).toBe(2)

    const apiToUi = arch.edges.find((e) => e.from === 'Api' && e.to === 'UI')!
    expect(apiToUi.hasUnhappyPath).toBe(true)
  })
})

describe('buildCoverage', () => {
  it('reports a declared failure with no matching branch as declared only', () => {
    const report = buildCoverage(doc(NESTED))
    const upload = report.contracts.find((c) => c.contract.name === 'Upload')!
    expect(upload.declared).toBe(2)
    expect(upload.modelled).toBe(0)
    expect(upload.responses.map((r) => r.state)).toEqual(['declared-only', 'declared-only'])
  })

  it('matches a branch that names the response code', () => {
    const text = NESTED.replace('else infected (unhappy)', 'else 422 Infected (unhappy)')
    const report = buildCoverage(doc(text))
    const scan = report.contracts.find((c) => c.contract.name === 'Scan')!
    expect(scan.responses[0].state).toBe('modelled')
    expect(scan.responses[0].matchedBranch).toBe('422 Infected')
  })

  it('does not match a code that is only a substring of a longer one', () => {
    const text = `sequenceDiagram
  A->>B: go @C
  alt ok
    B-->>A: fine
  else 4 something (unhappy)
    B-->>A: bad
  end

contract C {
  transport: http
  method: GET
  path: /x
  responses:
    404 NotFound (unhappy)
}
`
    const report = buildCoverage(doc(text))
    expect(report.contracts[0].responses[0].state).not.toBe('modelled')
  })

  it('flags a contract attached to no message', () => {
    const text = `${NESTED}
contract Unused {
  transport: http
  method: GET
  path: /nothing
  responses:
    500 Boom (unhappy)
}
`
    expect(buildCoverage(doc(text)).orphanContracts).toEqual(['Unused'])
  })

  it('flags a drawn branch that no contract declares', () => {
    const report = buildCoverage(doc(NESTED))
    expect(report.undeclaredBranches.map((b) => b.branchLabel)).toEqual(['infected'])
  })

  it('totals across every contract', () => {
    const report = buildCoverage(doc(NESTED))
    expect(report.declared).toBe(3)
    expect(report.modelled).toBe(0)
  })
})
