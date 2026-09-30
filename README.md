# SeqFlow

A local, browser-only hybrid text/visual editor for microservice sequence diagrams
that **infers a live architecture diagram** from the interactions in the sequence,
with AWS managed services as real participants in the flow rather than decoration.

Three panes over one document:

| Pane | What it is |
|---|---|
| **DSL** | The text. A superset of Mermaid's `sequenceDiagram`, so plain Mermaid imports unchanged. |
| **Sequence** | Custom SVG, editable by hand. Drag between lifelines to create a step, drag arrows to reorder, drag arrowheads to retarget, drag lanes to reorder. Right-click anything for structural edits. |
| **Architecture** | Derived on every change — one node per participant, one edge per unique `(from, to)` pair. Never edited directly. |

Plus a **contract inspector** on the right: attach a reusable request/response model
to any link, and generate its unhappy paths as real `alt` / `opt` blocks.

```bash
npm install
npm run dev
```

Everything lives in the browser: named projects in IndexedDB with autosave, plus
export/import as a `.json` file. No accounts, no server-side storage. The one
exception is AI-assist, which needs a small local proxy — see below.

**You never have to write the DSL.** Every part of the model — participants,
steps, blocks, branches, contracts, headers, responses and body fields — can be
built by dragging and clicking. The text pane is there when you want it, not
because you need it.

---

## The DSL

```
sequenceDiagram
  participant <id> [as <Label>] [: <kind>]

  <A>->><B>: <label>      // sync call — solid line, filled arrowhead
  <A>-->><B>: <label>     // async / reply — dashed line
  <A>-x<B>: <label>       // fire-and-forget — no response expected

  Note over <A>,<B>: <text>
  loop <label> ... end
  alt <label> ... else <label> ... end
  opt <label> ... end
```

The only addition to Mermaid is the `: <kind>` tag on participants, which is what
makes architecture inference and AWS-awareness possible:

| Group | Kinds |
|---|---|
| General | `service` `client` `database` `external` |
| Compute | `aws:lambda` `aws:ecs` `aws:eks` `aws:batch` `aws:apprunner` `aws:stepfunctions` |
| API & edge | `aws:apigateway` `aws:appsync` `aws:cloudfront` `aws:waf` |
| Messaging | `aws:sqs` `aws:sns` `aws:eventbridge` `aws:kinesis` `aws:msk` `aws:mq` |
| Storage & data | `aws:s3` `aws:dynamodb` `aws:rds` `aws:aurora` `aws:elasticache` `aws:neptune` `aws:redshift` `aws:athena` `aws:glue` |
| AI & search | `aws:bedrock` `aws:bedrockagent` `aws:knowledgebase` `aws:opensearch` `aws:kendra` `aws:sagemaker` `aws:textract` `aws:comprehend` `aws:rekognition` |
| Security & ops | `aws:cognito` `aws:secretsmanager` `aws:kms` `aws:cloudwatch` `aws:xray` |

`aws:*` participants get an AWS-orange accent in both views, so managed services
read differently from your own at a glance. The groups are not decoration: at 43
kinds a flat picker is unusable, so the inspector uses `optgroup`s and the
right-click menu nests two levels — *Change kind ▸ AI & search ▸ Bedrock*. A
test asserts the grouping covers every kind exactly once, so a new kind cannot
go missing from the UI.

Common abbreviations are accepted on input and normalised: `vectorsearch`,
`vectorstore` and `aoss` all mean `aws:opensearch`; `kb` means
`aws:knowledgebase`; `kafka` means `aws:msk`; `redis` means `aws:elasticache`;
`pgvector` means `aws:aurora`.

### Failure paths

A trailing `(unhappy)` on a branch or block marks it as a failure path. Those
arrows render amber and dashed in **both** diagrams, and the architecture view puts
a warning marker on any link that has one — so failure-mode coverage is visible
across the whole diagram, not just the link you happen to be inspecting.

```
alt 200 OK
  PaymentSvc-->>OrderSvc: PaymentConfirmed
else 402 PaymentRequired (unhappy)
  PaymentSvc-->>OrderSvc: PaymentDeclined
end
```

### Contracts

`model` and `contract` blocks are declared once and referenced by **name**, not by
position — so reordering a message or editing its label never orphans its contract,
and the same contract can sit on as many arrows as apply. Attach one with a
trailing `@Name`:

```
OrderSvc->>PaymentSvc: ChargeCard @ChargeCardRequest

model PaymentRequest {
  cardToken: string required
  amount: number required = 42.5
  currency: enum[GBP,USD,EUR] required
  meta: object {
    trace: string
  }
}

contract ChargeCardRequest {
  transport: http
  method: POST
  path: /payments
  model: PaymentRequest
  headers:
    Content-Type: application/json required
    Idempotency-Key: string required
  responses:
    200 OK -> PaymentConfirmation
    402 PaymentRequired (unhappy) -> PaymentError
    503 ServiceUnavailable (unhappy)
}
```

Field types: `string | number | boolean | object | array | date | file |
enum[A,B,C]`, each optionally `required` and with an `= <example>`. Transports:
`http | sqs | sns | eventbridge | kinesis | generic-async`. Async contracts use
pseudo-codes such as `delivered`, `retry`, `DLQ`.

### Body kinds

A model describes the *shape* of a body; `body:` says how it is *encoded*. The
same fields mean something different sent as `multipart` than as `json`.

```
contract UploadAvatar {
  transport: http
  method: POST
  path: /users/{id}/avatar
  body: multipart
  model: AvatarUpload
  responses:
    201 Created -> Avatar
    200 OK as binary
    415 UnsupportedMediaType (unhappy) -> ApiError
}

model AvatarUpload {
  file: file required
  filename: string required
}
```

`json | form | multipart | text | xml | csv | binary | none`, on the request via
`body:` and on any response via `as <kind>`. It is only written when it differs
from what the model already implies — `json` with one, `none` without — so
diagrams that never mention it serialize exactly as before.

Only `json`, `form` and `multipart` carry a shape; the rest are opaque payloads
and the inspector hides the model picker for them.

Arrows carrying a contract get a badge at their midpoint; hovering it shows the
method and happy-path code, and clicking opens the inspector.

### Mermaid compatibility

`autonumber`, `actor`, activation suffixes (`A->>+B`), `activate`/`deactivate`,
`Note left of` / `right of`, and the `->`, `-->`, `-x`, `--x`, `-)`, `--)` arrow
forms are all accepted. `par`, `rect`, `critical` and `break` are **not** part of
this grammar — their contents are kept inline and a warning appears in the status
bar, so a Mermaid file still imports rather than failing.

---

## Building a diagram without typing DSL

| To do this | Do this |
|---|---|
| **Add a step** | Press a lifeline, drag to another, release. Name it inline on the canvas. |
| **Add a note** | Same drag with <kbd>Alt</kbd> held, or the ✎ in the hover gutter. |
| **Insert at an exact point** | Hover between two steps — a `+` and a ✎ appear on the boundary. |
| **Reorder a step** | Drag the arrow up or down. It can move into and out of blocks. |
| **Rename a step** | Double-click the arrow. |
| **Retarget a step** | Select it, then drag either endpoint onto another lifeline. |
| **Reorder participants** | Drag a lane header. |
| **Add a participant** | Toolbar `+ Participant`, or right-click empty canvas → *Add participant ▸* by kind. |
| **Wrap steps in a block** | Shift-click two arrows, right-click → *Wrap N steps in ▸*. |
| **Add an else branch** | Right-click the block → *Add else branch*. |
| **Build a request body** | Contract inspector → *Request body* → click a field to edit it, `+ Field` to add. |
| **Change how a body is sent** | *Request body → Templates…* — file upload, form, raw text, CSV, binary, none. |
| **Reuse a common shape** | `+ Shape…` in the field tree — Error, Pagination, Money, Address, Timestamps, File metadata. |

The one thing still typed is **text** — a step's label, a header value, a field
name. That is content, not syntax.

---

## Projects and files

The **explorer** down the left-hand side lists every project as a folder and
each project's four views as files:

```
▾ Agentic — 01 Identity        ●
    identity.dsl               ●
    identity.sequence
    identity.arch
    identity.schema           RO
▸ Agentic — 02 Retrieval       2
```

The stem is slugged from the project name and the extension is the view, so a
tab reads `identity.arch` rather than "Architecture". Names are truncated from
the *front* when they are too long, because project names in practice share a
prefix and differ at the end — `Agentic — 00 Platform spine` and
`Agentic — 01 Identity` are identical for eight characters.

- A file is listed **whether or not it has a tab**: closing a tab closes the
  view, not the file. That is the point of having an explorer, and it is why
  only one project's documents are open at a time — everything else is one
  click away here.
- Clicking a file in another project switches to it, flushing the open project
  first. The workspace keeps its arrangement and is re-pointed at the new
  project's documents, so nothing moves.
- `identity.arch` and `identity.schema` are **derived from the DSL** and shown
  dimmed, the way an editor dims build output. Only the schema is genuinely
  read-only; the architecture view is a projection you can still edit
  *through*, via its right-click menus.
- The dot marks unsaved text. It sits on the `.dsl` file, never on a
  projection — and moves up to the folder while it is collapsed, so a pending
  change cannot hide behind a twisty. The number on a collapsed folder is how
  many of its views are open.

The toolbar still shows the open project. Its dropdown offers **New** (from the
starter or blank), **Duplicate**, **Rename** and **Delete**. Everything is
autosaved to IndexedDB.

- Switching **flushes the open project first**, so debounced keystrokes are never lost.
  Both the explorer and the dropdown go through one function for this, because
  the order — flush, load, re-point the workspace — is not optional in any of it.
- Undo history is **per-project** — undoing across a switch would write one project's text into another.
- **Import** creates a new project rather than replacing what you have open.
- A pre-projects autosave is migrated into a project on first launch rather than dropped.

---

## Right-click

The inspector is a form for editing *values*; right-click is where *structure*
lives. Three operations exist only here — there is no other way to reach them.

| Target | Menu |
|---|---|
| **Arrow** | Suggest unhappy paths · **Wrap in** ▸ · Add reply · Duplicate · **Reverse direction** · Move earlier/later · Arrow style ▸ · Contract ▸ · Play from here · Copy DSL line · Delete |
| **Participant lane / architecture node** | Change kind ▸ (all 17, ticked) · Add message to ▸ · Move left/right · Reveal in sequence · Delete (says how many messages go with it) |
| **Block** | **Add else branch** · Change type ▸ · Mark as (unhappy) · Walk *branch* during playback · Move earlier/later · Unwrap · Delete with contents |
| **Architecture edge** | The messages the link stands for, each selectable · Suggest unhappy paths on ▸ · Reveal in sequence |
| **Empty canvas** | Add participant ▸ (by kind) · Layout direction ▸ (architecture) · Fit / Actual size / Zoom |

Right-clicking also selects, so the inspector and the editor line follow along.
Arrow keys move through a menu, <kbd>→</kbd> opens a submenu, <kbd>esc</kbd>
closes it.

### Wrapping a run in a block

Click one arrow, **shift-click** another, and the menu offers *Wrap N steps in ▸*.
The two ends have to be siblings — same enclosing block and same `alt` branch —
so a run that straddles an `else` or escapes its block is never offered. That
constraint is what keeps the generated DSL well-formed; `siblingRun` decides what
the UI allows, and `wrapInBlock` refuses anything that lines up with no sibling
level.

*Add else branch* appends a branch with a placeholder message mirroring the first
branch's opener, so the new branch is something you can edit rather than an empty
region you cannot click into.

Not on the editor pane: CodeMirror's own menu (cut/copy/paste, spellcheck,
lookup) is more useful there than anything this app would replace it with.

---

## Data type templates

Two reusable libraries, both in `contracts/dataTemplates.ts`.

**Body templates** answer *how is this sent*. Picking one sets the body kind, the
matching `Content-Type`, and a starter shape in a single click:

| | |
|---|---|
| JSON object · JSON collection | `application/json` |
| File upload · File + metadata · Multiple files | `multipart/form-data`, with `file` parts |
| Form fields | `application/x-www-form-urlencoded` |
| Raw text · XML · CSV · Binary stream | opaque payloads, no shape |
| No body | nothing sent |

An existing shape is **kept** when you switch — changing how something is sent
should not throw away what is in it. And because the header and the kind are
stored separately, the inspector flags a `Content-Type` that has drifted out of
step with the encoding, with a one-click fix.

**Shape templates** answer *what is in it* — field groups that recur across
requests, inserted into whatever model you are editing and renamed around any
name already in use: Error, offset and cursor Pagination, Money, Postal address,
Timestamps, Audit trail, File metadata, Geo point, Identity, Trace context.

Both reach the exports: OpenAPI emits the right media type per request *and* per
response, `file` fields become `type: string, format: binary`, an opaque kind
still gets a valid schema, and `none` omits `requestBody` entirely. AsyncAPI
takes its `contentType` from the same place.

---

## Automatic unhappy-path generation

Select any arrow and hit **Suggest unhappy paths**. A rule table keyed on
`(transport, method, target kind)` returns candidate failure branches as a
checklist with a live DSL preview. Nothing is inserted until you tick and confirm.

| Transport / target | Suggested branches |
|---|---|
| HTTP `GET` | 404, 401/403, 429, 503, timeout |
| HTTP `POST` | 400, 401/403, 409, 422, 429, 502/503/504 |
| HTTP `PUT`/`PATCH` | 400, 404, 409 (stale update), 422, 429, 500 |
| HTTP `DELETE` | 404, 409 (dependency exists), 429, 500 |
| `aws:sqs` | processing failure → redelivery → `maxReceiveCount` → DLQ |
| `aws:sns` | subscriber delivery failure → retry per policy → DLQ or dropped |
| `aws:eventbridge` | target invocation failure → backoff → DLQ |
| `aws:kinesis` | batch failure → bisect-on-error redelivery → failed batch; throttle |
| `aws:lambda` | 429 throttle, task timeout, unhandled exception |
| `aws:dynamodb` | `ConditionalCheckFailed`, `ProvisionedThroughputExceeded`, `ResourceNotFound` |
| `aws:stepfunctions` | `States.TaskFailed` → Retry → Catch → fallback → execution Failed |
| `aws:s3` | 403 AccessDenied, 404 NoSuchKey, 503 SlowDown |
| `aws:bedrock` | throttling, context-window `ValidationException`, model timeout, guardrail intervention |
| `aws:knowledgebase` | no passages above threshold, ingestion lag, throttling |
| `aws:opensearch` | rejected execution, index not found, vector dimension mismatch |
| `aws:sagemaker` | endpoint throttling, cold start after scale-to-zero |
| any | network timeout, connection refused, circuit breaker open |

On confirm it **generates DSL**, not annotations. Sync HTTP branches become `else`
branches on the existing reply; async transports get a trailing `opt` block with the
retry/DLQ messages as real arrows. If a branch needs a dead-letter queue and the
diagram has none, one is added in the same step (an existing DLQ-ish participant is
reused). Where the message has a contract, the matching responses are recorded on it
too.

Queue/topic/bus/stream rules resolve the *consumer* rather than the producer, so
selecting either side of a queue generates the same redelivery story.

---

## Playback

Play / pause / step / speed, synchronised across all three panes: the active arrow
highlights with a travelling packet, the corresponding architecture edge and both
nodes light up, and the editor scrolls to and highlights the source line.

`alt` blocks default to their first (happy) branch. The **branch** picker in the
playback bar swaps in an unhappy one and the whole animation follows it — you can
watch a 503 or a DLQ path animate through both diagrams exactly like the happy path.
That is the payoff for modelling failures as real blocks instead of static labels.

Keyboard: <kbd>space</kbd> play/pause, <kbd>←</kbd>/<kbd>→</kbd> step,
<kbd>esc</kbd> clear selection, <kbd>⌘Z</kbd>/<kbd>⇧⌘Z</kbd> undo/redo.
*Play from here* on an arrow's context menu jumps to that step and starts.

---

## Panels

Every panel opens and closes, VS Code style. Each pane head carries a `‹` that
folds the pane into a 30 px rail on the workspace edge, and clicking the rail
brings it back; a file's row in the explorer carries a `×` that does the same
thing. The **View** menu lists every panel with its state, toggles the explorer
and the minimap, and **Reset layout** restores the defaults.

<kbd>⌘1</kbd> DSL · <kbd>⌘2</kbd> Sequence · <kbd>⌘3</kbd> Architecture ·
<kbd>⌘4</kbd> Schema · <kbd>⌘B</kbd> Inspector. A key names a *view* — "the
schema of whatever is open" — and is resolved against the open project. These
fire while you are typing in the editor, the way VS Code's do — the other
shortcuts stand down when a text field has focus.

### Minimap

When a diagram outgrows its pane, a small plan of the whole thing appears in the
bottom-right corner with the visible region boxed on it. Click anywhere on the
map to jump there, or press and drag to scrub. Both the sequence and the
architecture pane have one.

It is drawn from the same layout the real canvas uses, in the same coordinate
space, so it cannot drift out of step with what it maps. It appears only when
there is something off screen — fit a diagram into its pane and the map goes
away. **View ▸ Minimap** turns the feature off entirely.

A hidden pane keeps its width, so restoring it returns the old proportions
rather than resetting the split. The last visible pane refuses to close, and
layout persists in `localStorage` per browser — it is workspace chrome, not
document content, so it is never part of a project's `.json` and undo never
touches it.

---

## Failure paths

Two different things get called an unhappy path, and the tool keeps them apart.

A **realised** failure is an `alt … else X (unhappy)` branch. It occupies
order-space, playback walks it, and its consequences are drawn. A **declared**
failure is a `429 ThrottlingException (unhappy)` line on a contract: a fact
about one call, with no position in the sequence and nothing to animate.
Declaring one costs a line and buys no coverage.

**Outcomes** (playback bar) enumerates every distinct path. Choices are run
through the same `flattenSteps` playback uses and deduped by the resulting
message sequence, so a decision inside a branch nobody entered collapses rather
than doubling the list. Pick one and both canvases dim everything off it —
trace `malware detected` on the application workflow and the architecture lights
3 nodes of 14, which turns "never reaches S3" from a Note into a property of the
graph.

**Failure coverage** (status bar) is the table of declared responses against the
branches that model them. A response counts as modelled when a branch label
names its code — generated branches are labelled `503 ServiceUnavailable`, so
they match exactly, while a hand-written `malware detected` does not, and that
is reported rather than guessed at. *Loose ends* lists contracts attached to
nothing, branches no contract declares, and references to contracts that do not
exist.

Architecture badges follow the same split: `⚠` means a failure branch is drawn,
`○` means the contract only lists error codes.

---

## Pattern templates

Ten starter diagrams in the toolbar's **Templates** gallery, each a worked
example of the syntax as much as a shape: Sync REST, Async fan-out,
Event-driven, Orchestration / saga, Streaming ingestion, Data lake ingestion,
Auth flow, **RAG / knowledge retrieval**, **Document understanding**, GraphQL.

The last two exercise the AI vocabulary: RAG routes a question through a Bedrock
Knowledge Base and its vector index with retrieval-miss and throttling branches;
Document understanding takes a multipart PDF upload through Textract and
Comprehend into a vector index, with a DLQ on extraction failure.

---

## Exports

| Target | Output |
|---|---|
| Mermaid | Valid `sequenceDiagram` text, `: <kind>` tags stripped |
| PlantUML | `@startuml`/`@enduml`, kinds mapped to `actor`/`database`/`queue` or a stereotype |
| draw.io | mxGraph XML for the architecture view, at the dagre-computed positions |
| AWS CDK (TypeScript) | Starter stack: one construct per `aws:*` participant, wired per the inferred edges |
| OpenAPI 3.0 | One path/method/response per HTTP contract — happy and unhappy both |
| AsyncAPI 2.x | One channel per async contract, failure modes preserved as an extension |
| PNG / SVG | Snapshot of either diagram, styles inlined |
| Design review `.docx` | A Word engineering design review: metrics, diagrams, dependency and step tables, every distinct outcome path, the failure-coverage gap list, and the schema and contracts |
| Project `.json` | The whole document, for import elsewhere |

### The design-review report

`Export ▾ → Report → Design review` opens a dialog to pick sections, a title,
an author and a page size, then assembles a Word document from what the app
already measures — there is no model in the loop, so the same diagram always
produces the same report and every figure traces back to a computed value.

Two behaviours worth knowing:

- **Diagrams are captured from the live canvases**, so a figure reflects your
  current arrangement, including nodes parked with the sticky/pin controls. Two
  people exporting the same project can therefore get differently-arranged
  figures. Any diagram pane that is closed is briefly revealed, captured in the
  ranked layout for determinism, and closed again — your layout is restored
  exactly, including the mode of a pane that was in `Fluid`.
- **A diagram too large for the browser to rasterise is omitted, not blanked.**
  Canvas rasterisation fails silently past about 16 million pixels, so a very
  tall sequence diagram is left out and the document says so rather than
  carrying a blank page.

The Word writer is loaded on demand, so the `docx` dependency costs nothing
until the first report is generated.

OpenAPI and AsyncAPI only emit what actually has a contract attached, and degrade
to a valid near-empty spec rather than erroring. The CDK output is a **starter
scaffold** — placeholder props and best-effort `grantX`/`addEventSource` wiring
inferred from edge direction. Not production IaC; read every line.

---

## AI-assist

Plain English in, DSL out. This is the only feature that needs a process beyond the
static SPA, because the Anthropic API can't be called safely from a browser (key
exposure, CORS). A ~60-line local proxy handles it:

```bash
cp .env.local.example .env.local   # add your ANTHROPIC_API_KEY
npm run dev:all                    # app + proxy together
```

or run them separately with `npm run dev` and `npm run dev:proxy`. The client only
ever talks to `localhost`; the key stays in the proxy process. Override the model
with `ANTHROPIC_MODEL` (default `claude-opus-5`) and the port with
`SEQFLOW_PROXY_PORT` (default 8787).

The system prompt constrains output to raw DSL, and **the parser you already use for
hand-written DSL is the validator** — there is deliberately no second validation
path. A bad generation loads anyway and surfaces as ordinary parse errors you can
edit or retry from.

---

## Layout

The workspace is a **docking tree**, not a fixed row. Drag any pane by its header
and drop it on an edge of another pane to split that slot, or on the centre to
stack the two as tabs. A highlighted preview shows where it will land. Splitters
divide both axes, closed panes collect on a rail at the right edge, and the
Inspector is an ordinary dockable pane like the rest.

A slot holds a **document** — one view of one project, addressed
`p_abc123#arch` — or a **tool**, of which the Inspector is currently the only
one. The explorer is neither: it is a fixed column beside the dock rather than
a pane inside it, because it is how documents are *reached*, and docking it in
the thing it navigates would let it be closed out from under itself with the
way back only in a menu.

`⌘1`–`⌘4` and `⌘B` reach a panel rather than blindly toggling it: a closed pane
opens, a pane hidden behind another tab comes to the front, and only a pane that
is already showing closes — and not even then if the caret is inside it, since
these shortcuts deliberately fire while you are typing.

Two implementation notes worth knowing:

- **The tree is a layout calculator, not a JSX structure.** `dockTree.ts` turns the
  tree plus a container size into rectangles, and every pane is rendered once, in a
  fixed order, at the rect it was given. Nesting the panes as real flex containers
  would remount one whenever it moved — losing CodeMirror's cursor and undo stack,
  resetting each canvas's scroll position, and reseeding the force simulation.
  Positioning them instead means a pane changing slot is four style properties.
- **A background tab is hidden with `visibility`, not `display`.** `display: none`
  drops an element out of layout, which zeroes the `ResizeObserver` that both the
  zoom fit and the minimap measure through — so a pane would come forward at the
  wrong zoom with a collapsed minimap.
- **The tree treats a slot id as opaque.** It was a union of five literals while
  the workspace had five fixed panes; widening it to a string is what let the
  vocabulary become an open set without touching a single tree operation.
  Everything that needs to interpret an id — a minimum width, a label, whether
  an id is still valid — is injected, and `state/docId.ts` is the one place that
  knows the shape.
- **Switching project is a rename, not a rearrangement.** Every document id in
  the tree is re-pointed at the new project and every tool left alone, which is
  one pass over the tree and no change to its structure — so the arrangement,
  the tab groups and the closed panes' recorded neighbours all survive a switch.
- **The DOM order is accumulated, not constant.** Panes are rendered in a fixed
  order so that a pane changing slot never moves in the React tree. A fixed set
  of five could hold that order in a constant; a set of documents that open and
  close cannot, so the order is merged forward each render — keep what is still
  open, drop what closed, append what opened.

An arrangement saved by an older build is migrated on first load rather than
discarded: a tree keyed by pane name becomes one keyed by document, and both the
`seqflow.dock.v1` and `seqflow.layout.v1` keys are left untouched.

```
src/
  dsl/            ast.ts, parser.ts, serializer.ts, tree.ts, edit.ts, architecture.ts
  render/         SequenceCanvas.tsx, ArchitectureCanvas.tsx,
                  sequenceLayout.ts, layout.ts (dagre), aws-icons/
  playback/       usePlayback.ts
  contracts/      contractStore.ts, unhappyPathRules.ts, generateUnhappyPaths.ts,
                  dataTemplates.ts (body kinds + reusable shapes), modelEdit.ts,
                  ContractInspector.tsx, UnhappyPathDialog.tsx,
                  FieldTree.tsx (editable body fields)
  export/         toMermaid, toPlantUML, toDrawio, toCdk, toOpenApi, toAsyncApi,
                  jsonSchema.ts, snapshot.ts,
                  reportContent.ts (pure: the design review's prose + figures),
                  reportSummary.ts (counts shared with the status bar),
                  captureDiagrams.ts (reveal/rasterise/restore),
                  toDocx.ts (lazy-loaded Word writer)
  ai/             generateFromPrompt.ts, proxy-server/ (dev-only, not bundled)
  templates/      patterns.ts — the 8 AWS pattern snippets
  state/          store.ts (Zustand: doc, selection, playback, undo/redo),
                  dockTree.ts (pure: the docking tree + its geometry),
                  docId.ts (pure: what a slot id means — documents and tools),
                  panels.ts (the document store over that tree),
                  explorerTree.ts (pure: the explorer as a flat row list),
                  renderOrder.ts (pure: the stable DOM order of open panes),
                  saveCurrent.ts (the one flush of the open project),
                  switchProject.ts (flush, load, re-point — in that order),
                  viewLayout.ts (per-pane diagram arrangement)
  persist/        db.ts (named projects in IndexedDB + project JSON)
  components/     Editor.tsx (CodeMirror 6), Toolbar, TemplateGallery, ExportMenu,
                  AIPromptBar, PlaybackBar, StatusBar, ZoomControl,
                  Explorer.tsx (projects and their files),
                  DockView.tsx (positions panes, drag-to-dock, tabs),
                  Splitter.tsx (both axes), PaneRail.tsx,
                  ContextMenu.tsx + menus.ts (the right-click menu definitions),
                  ProjectMenu.tsx, DraftField.tsx
```

### How the two views stay in sync

`SequenceDoc` is the single source of truth. Text edits parse into it; canvas edits
mutate a clone and re-serialize. Both directions pass through the same AST, so the
two views cannot drift into separate data models.

The trade-off: a canvas edit reformats the text to canonical form, which normalises
whitespace and drops `%%` comments. Edits made from the text pane leave it alone.

That round-trip is also lossy for *in-progress* text, which is why every
identifier and label field in the inspector holds its own draft while focused
(`components/DraftField.tsx`). Bound straight to the model, a label field refills
itself with the participant's id the moment you clear it, because an empty label
serializes to nothing and parses back as the id. A rejected value — an id with a
space, a duplicate contract name — stays on screen with the reason and a
one-click correction rather than silently reverting.

`Message` and `Note` share one linear `order` index; a `Block` owns a half-open
range of it. Everything structural — insert, delete, reorder, wrap in a block — is
order-space surgery in `dsl/edit.ts`, and `dsl/tree.ts` rebuilds the nesting the
renderer and serializer need. The round-trip (`parse → serialize → parse`) is a
fixed point, which the test suite asserts on every template and every generated
block.

One consequence worth knowing: message, block and note ids are **positional** —
`m0`, `b1` — so a reparse renumbers them. An id captured while mutating a draft
is stale by the time the mutation lands. `mutate` therefore takes an optional
second callback that runs against the freshly parsed document, which is where
anything needing to select what it just created looks it up by position instead.
The shift-click range anchor is dropped on every reparse for the same reason: a
surviving id could quietly come to mean a different step.

### Icons

The `aws:*` glyphs are hand-drawn for this project in `render/aws-icons/` —
deliberately *not* the official AWS Architecture Icons, so there's no third-party
asset licence to carry.

---

## Scripts

```bash
npm run dev         # app on :5173
npm run dev:proxy   # AI proxy on :8787
npm run dev:all     # both
npm test            # vitest — parser, generator, exporters
npm run typecheck
npm run lint
npm run build
```

## Non-goals

No collaboration, no server-side persistence, no accounts, no auth, and no attempt
at production-correct CDK. Contracts are documentation and scaffolding: the app does
not validate live traffic against them and does not stand up a mock server. It is a
fast, local, single-player tool.
