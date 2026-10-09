import { describe, expect, it } from 'vitest'
import { parse } from '../dsl/parser'
import { allCriteria, buildTickets, type Story, type Ticket } from './tickets'

function stories(dsl: string, rootTitle?: string): Story[] {
  return buildTickets(parse(dsl).doc, rootTitle)
}

const titles = (s: Story[]): string[] => s.map((x) => x.title)
const ticket = (s: Story, id: string): Ticket => s.tickets.find((t) => t.participantId === id)!
const scenarios = (t: Ticket): string[] => allCriteria(t).map((c) => c.scenario)
const components = (s: Story, ...ids: string[]): string[] =>
  s.tickets.filter((t) => !ids.length || ids.includes(t.participantId)).map((t) => t.participantId)

describe('story boundaries', () => {
  it('makes a story of each top-level opt and loop', () => {
    const s = stories(`sequenceDiagram
  participant UI as Front end : client
  participant API as Service : aws:eks
  UI->>API: (1) Sign in
  opt managing the bank
    UI->>API: (2) Add an example
  end
  loop poll on an interval
    API->>API: (3) Tick
  end`)
    expect(titles(s)).toEqual(['Sign in', 'Managing the bank', 'Poll on an interval'])
  })

  it('folds a top-level alt into the root story rather than splitting on it', () => {
    // An alt is a fork in a journey already under way. Splitting would turn
    // "accepted" and "rejected" into two unrelated stories.
    const s = stories(`sequenceDiagram
  participant UI as Front end : client
  participant API as Service : aws:eks
  UI->>API: (1) Upload a workbook
  alt 200 clean
    API-->>UI: Accepted
  else 422 infected (unhappy)
    API-->>UI: Rejected
  end`)
    expect(titles(s)).toEqual(['Upload a workbook'])
    expect(s[0].steps).toBe(3)
  })

  it('names the root story from its first client step, and lets that be overridden', () => {
    const dsl = `sequenceDiagram
  participant UI as Front end : client
  participant API as Service : aws:eks
  UI->>API: (1) Upload a workbook`
    expect(titles(stories(dsl))).toEqual(['Upload a workbook'])
    expect(titles(stories(dsl, 'Ingest a campaign'))).toEqual(['Ingest a campaign'])
  })

  it('omits the root story when every step is inside a block', () => {
    const s = stories(`sequenceDiagram
  participant UI as Front end : client
  participant API as Service : aws:eks
  opt only journey
    UI->>API: (1) Do the thing
  end`)
    expect(titles(s)).toEqual(['Only journey'])
  })
})

describe('ticket scope', () => {
  const dsl = `sequenceDiagram
  participant UI as Front end : client
  participant API as Service : aws:eks
  participant LLM as Bedrock : aws:bedrock
  participant Vendor as Payments : external
  participant DB as Postgres : aws:rds
  UI->>API: (1) Ask a question
  API->>LLM: (2) Invoke the model
  API->>Vendor: (3) Take payment
  API->>DB: (4) Save the answer`

  it('raises one ticket per component you build', () => {
    const [story] = stories(dsl)
    expect(components(story)).toEqual(['UI', 'API', 'DB'])
  })

  it('raises none for a model endpoint or an external vendor', () => {
    const [story] = stories(dsl)
    expect(components(story)).not.toContain('LLM')
    expect(components(story)).not.toContain('Vendor')
  })

  it('records inbound work as serving and outbound work as calling', () => {
    const api = stories(dsl)[0].tickets.find((t) => t.participantId === 'API')!
    expect(api.responsibilities[0]).toMatch(/^Serve "Ask a question" for Front end/)
    expect(api.responsibilities).toContain('Save the answer — calls Postgres')
  })
})

describe('acceptance criteria', () => {
  const dsl = `sequenceDiagram
  participant UI as Front end : client
  participant API as Service : aws:eks
  UI->>API: (1) Upload a workbook @Upload
  alt 200 clean
    API-->>UI: Accepted
  else 422 Infected (unhappy)
    API-->>UI: Rejected
  end

contract Upload {
  transport: http
  method: POST
  path: /uploads
  responses:
    200 OK
    422 Infected (unhappy)
    503 ScannerDown (unhappy)
}`

  it('gives each step its own happy Given/When/Then', () => {
    const api = ticket(stories(dsl)[0], 'API')
    expect(api.steps).toHaveLength(1)
    const happy = api.steps[0].happy
    expect(happy.when).toBe('Front end calls POST /uploads')
    expect(happy.then[0]).toBe('Service responds 200 OK')
  })

  it('hangs a failure off the step it belongs to, not the ticket', () => {
    const api = ticket(stories(dsl)[0], 'API')
    expect(api.steps[0].unhappy.map((c) => c.scenario)).toEqual([
      'Service returns 422 Infected',
      'Service returns 503 ScannerDown',
    ])
  })

  it('marks a failure no branch draws, and leaves a drawn one unmarked', () => {
    const api = ticket(stories(dsl)[0], 'API')
    const byName = new Map(api.steps[0].unhappy.map((c) => [c.scenario, c]))
    expect(byName.get('Service returns 422 Infected')!.unmodelled).toBe(false)
    expect(byName.get('Service returns 503 ScannerDown')!.unmodelled).toBe(true)
  })

  it('words a failure as returned by the receiver and handled by the caller', () => {
    const [story] = stories(dsl)
    const api = ticket(story, 'API')
    const ui = ticket(story, 'UI')
    expect(
      api.steps[0].unhappy.find((c) => c.scenario === 'Service returns 422 Infected')!.then,
    ).toEqual(['Service responds 422 Infected'])
    const caller = ui.steps[0].unhappy.find(
      (c) => c.scenario === 'Upload returns 422 Infected',
    )!
    expect(caller.given).toBe('Front end has called Service (POST /uploads)')
    expect(caller.then[0]).toBe('the "422 Infected" path is taken')
  })

  it('does not borrow a branch from another story to explain a failure', () => {
    // Both contracts declare a 409. Only the export story draws a branch for
    // one, so the upload's 409 must read as undrawn rather than inherit
    // "409 export still running" — a wrong criterion is worse than a missing one.
    const [upload, exporting] = stories(`sequenceDiagram
  participant UI as Front end : client
  participant API as Service : aws:eks
  UI->>API: (1) Upload a workbook @Upload
  opt exporting
    UI->>API: (2) Export results @Export
    alt 200 ready
      API-->>UI: File
    else 409 export still running (unhappy)
      API-->>UI: Counts only
    end
  end

contract Upload {
  transport: generic-async
  responses:
    200 OK
    409 AlreadyUploaded (unhappy)
}

contract Export {
  transport: generic-async
  responses:
    200 OK
    409 StillRunning (unhappy)
}`)
    const uploadCriterion = allCriteria(ticket(upload, 'API')).find((c) =>
      c.scenario.includes('409'),
    )!
    expect(uploadCriterion.unmodelled).toBe(true)

    const exportCriterion = allCriteria(ticket(exporting, 'UI')).find((c) =>
      c.scenario.includes('409'),
    )!
    expect(exportCriterion.unmodelled).toBe(false)
    expect(exportCriterion.then[0]).toBe('the "409 export still running" path is taken')
  })

  it('attributes a contract on a reply arrow to the sender, not the receiver', () => {
    const [story] = stories(`sequenceDiagram
  participant UI as Front end : client
  participant API as Service : aws:eks
  UI->>API: (1) Upload a workbook
  API-->>UI: Progress frame @Frame

contract Frame {
  transport: generic-async
  responses:
    200 Emitted
    disconnected Client went away (unhappy)
}`)
    const api = ticket(story, 'API')
    const ui = ticket(story, 'UI')
    expect(scenarios(api)).toContain('Service returns disconnected Client went away')
    expect(scenarios(ui)).not.toContain('Front end returns disconnected Client went away')
    expect(api.responsibilities).toContain('Emit "Progress frame" to Front end — Frame')
  })

  it('repeats a shared contract failure at each step that can hit it', () => {
    // Two calls to the same scanner are two points in the sequence, and each
    // has to handle the failure where it happens — deduplicating would leave
    // the second call with no criteria at all.
    const [story] = stories(`sequenceDiagram
  participant API as Service : aws:eks
  participant Scan as Scanner : aws:eks
  API->>Scan: (1) Scan the workbook @Check
  API->>Scan: (2) Scan the attachment @Check

contract Check {
  transport: generic-async
  responses:
    200 OK
    500 Broken (unhappy)
}`)
    const api = ticket(story, 'API')
    expect(api.steps.map((s) => s.title)).toEqual([
      'Scan the workbook',
      'Scan the attachment',
    ])
    expect(api.steps[0].unhappy).toHaveLength(1)
    expect(api.steps[1].unhappy).toHaveLength(1)
  })

  it('does not chain recovery work onto the last successful step', () => {
    // "Record the rejection" only runs when the scan failed. Chaining it to
    // the successful store would claim the upload records a rejection after
    // it succeeded — which is what the first cut of this did.
    const [story] = stories(`sequenceDiagram
  participant UI as Front end : client
  participant API as Service : aws:eks
  participant DB as Postgres : aws:rds
  UI->>API: (1) Upload a workbook
  alt 200 accepted
    API->>DB: (2) Store the rows
    API-->>UI: Done
  else 422 rejected (unhappy)
    API->>DB: (3) Record the rejection
  end`)
    const api = ticket(story, 'API')
    const byTitle = new Map(api.steps.map((x) => [x.title, x]))
    expect(byTitle.get('Store the rows')!.onFailurePath).toBeUndefined()
    const recovery = byTitle.get('Record the rejection')!
    expect(recovery.onFailurePath).toBe('422 rejected')
    expect(recovery.happy.given).toBe('the "422 rejected" path was taken')
    expect(recovery.happy.then.at(-1)).toBe('the "422 rejected" path is complete')
    // Mainline still ends cleanly rather than pointing at the recovery step.
    expect(byTitle.get('Store the rows')!.happy.then.at(-1)).toBe('Service has finished its part')
  })

  it('chains each step Given to the previous step succeeding', () => {
    const [story] = stories(`sequenceDiagram
  participant UI as Front end : client
  participant API as Service : aws:eks
  participant Scan as Scanner : aws:eks
  participant DB as Postgres : aws:rds
  UI->>API: (1) Upload a workbook
  API->>Scan: (2) Scan the bytes
  API->>API: (3) Parse the rows
  API->>DB: (4) Store the rows`)
    const api = ticket(story, 'API')
    expect(api.steps.map((s) => s.index)).toEqual([1, 2, 3, 4])
    expect(api.steps.map((s) => s.happy.given)).toEqual([
      'upload a workbook, and the request is valid',
      '"Upload a workbook" succeeded',
      '"Scan the bytes" succeeded',
      '"Parse the rows" succeeded',
    ])
    // Each step says what it unlocks; the last says the component is done.
    expect(api.steps[1].happy.then).toEqual([
      'the call to Scanner succeeds',
      '"Parse the rows" can proceed',
    ])
    expect(api.steps[3].happy.then.at(-1)).toBe('Service has finished its part')
  })
})

describe('the real project', () => {
  it('derives stories and tickets without raising one for Bedrock', async () => {
    const { readFileSync } = await import('node:fs')
    const dsl = readFileSync('projects/recruit-plagiarism-sync-with-schema.dsl', 'utf8')
    const s = buildTickets(parse(dsl).doc, 'Upload a campaign workbook')
    expect(titles(s)).toEqual([
      'Upload a campaign workbook',
      'Maintaining the bank of known examples',
      'Reading and managing stored content',
      'Poll on an interval',
      'An applicant fails during analysis',
      'Exporting the campaign',
      'Opening an existing campaign',
    ])
    // The point of splitting create from open: different journeys, different
    // failures. Sharing any would mean the upsert had only been renamed.
    const failures = (story: string) =>
      allCriteria(ticket(s.find((x) => x.title === story)!, 'BFFE'))
        .filter((c) => c.kind === 'unhappy')
        .map((c) => c.scenario)
    const create = failures('Upload a campaign workbook')
    const open = failures('Opening an existing campaign')
    expect(create).toContain('Application Logic returns 409 ReferenceInUse')
    expect(open).toContain('Application Logic returns 404 CampaignNotFound')
    expect(create.filter((f) => open.includes(f))).toEqual([])

    const all = s.flatMap((x) => x.tickets)
    expect(all.map((t) => t.participantId)).not.toContain('Embed')
    expect(all.map((t) => t.participantId)).not.toContain('LLM')
    for (const t of all) {
      expect(t.responsibilities.length, t.id).toBeGreaterThan(0)
      expect(t.steps.length, t.id).toBeGreaterThan(0)

      const mainline = t.steps.filter((x) => !x.onFailurePath)
      const recovery = t.steps.filter((x) => x.onFailurePath)

      // Mainline runs first, in the diagram's order, chained end to end.
      expect(t.steps.slice(0, mainline.length), t.id).toEqual(mainline)
      expect(mainline.map((x) => x.order), t.id).toEqual(
        [...mainline.map((x) => x.order)].sort((a, b) => a - b),
      )
      for (const [i, step] of mainline.entries()) {
        if (i === 0) continue
        expect(step.happy.given, `${t.id} step ${step.index}`).toBe(
          `"${mainline[i - 1].title}" succeeded`,
        )
      }

      // Recovery work hangs off its branch, never off a successful step.
      for (const [i, step] of recovery.entries()) {
        const sameBranchBefore =
          i > 0 && recovery[i - 1].onFailurePath === step.onFailurePath
            ? recovery[i - 1]
            : undefined
        expect(step.happy.given, `${t.id} step ${step.index}`).toBe(
          sameBranchBefore
            ? `"${sameBranchBefore.title}" succeeded`
            : `the "${step.onFailurePath}" path was taken`,
        )
      }
    }
  })
})

describe('the report section', () => {
  it('renders tickets only when the section is selected, and flags undrawn criteria', async () => {
    const { inferArchitecture } = await import('../dsl/architecture')
    const { buildReport, ALL_SECTIONS } = await import('./reportContent')
    const doc = parse(`sequenceDiagram
  participant UI as Front end : client
  participant API as Service : aws:eks
  UI->>API: (1) Upload a workbook @Upload

contract Upload {
  transport: http
  method: POST
  path: /uploads
  responses:
    200 OK
    503 ScannerDown (unhappy)
}`).doc
    const input = {
      doc,
      arch: inferArchitecture(doc),
      projectName: 'Test',
      generatedAt: new Date('2026-09-28T12:00:00Z'),
      rootStoryTitle: 'Upload a workbook',
    }

    const without = buildReport({ ...input, sections: ['glance'] })
    expect(without.blocks.some((b) => b.kind === 'heading' && b.text === 'Delivery tickets')).toBe(
      false,
    )

    const withTickets = buildReport({ ...input, sections: ALL_SECTIONS })
    const headings = withTickets.blocks
      .filter((b) => b.kind === 'heading')
      .map((b) => (b as { text: string }).text)
    expect(headings).toContain('Delivery tickets')
    expect(headings).toContain('Upload a workbook')
    expect(headings).toContain('Service — upload a workbook')

    const warn = withTickets.blocks.find((b) => b.kind === 'callout' && b.tone === 'warn')
    expect((warn as { text: string } | undefined)?.text).toMatch(
      /acceptance criteri(on|a).*no branch in the diagram draws/,
    )
    const ac = withTickets.blocks.find(
      (b) => b.kind === 'table' && b.caption?.startsWith('Acceptance criteria'),
    ) as { head: string[]; rows: string[][] } | undefined
    expect(ac?.head).toEqual(['Step', 'Scenario', 'Given', 'When', 'Then'])
    // The happy step is numbered; its failures sit under it, unnumbered.
    // The number repeats on continuation rows: no empty cells anywhere.
    expect(ac?.rows[0][0]).toBe('1')
    expect(ac?.rows[1][0]).toBe('1')
    expect(ac?.rows.some((r) => r[1].includes('↳') && r[1].includes('(no path drawn)'))).toBe(
      true,
    )
  })
})
