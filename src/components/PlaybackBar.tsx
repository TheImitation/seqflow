import { useAltBlocks, usePlaybackControls, usePlaybackEngine } from '../playback/usePlayback'
import { useStore } from '../state/store'
import { OutcomeMenu } from './OutcomeMenu'

const SPEEDS = [0.5, 1, 1.4, 2, 3]

export function PlaybackBar() {
  const { steps, index, current, playing } = usePlaybackEngine()
  const controls = usePlaybackControls()
  const speed = useStore((s) => s.playback.speed)
  const setSpeed = useStore((s) => s.setSpeed)
  const branchChoice = useStore((s) => s.playback.branchChoice)
  const setBranchChoice = useStore((s) => s.setBranchChoice)
  const select = useStore((s) => s.select)
  const alts = useAltBlocks()

  const label = current
    ? `${current.message.from} → ${current.message.to}: ${current.message.label}`
    : 'Not started'

  return (
    <div className="playbar">
      <button
        className="btn icon"
        onClick={controls.back}
        disabled={index < 0}
        title="Step back (←)"
        aria-label="Step back"
      >
        ⏴
      </button>
      <button
        className="btn primary icon"
        onClick={controls.toggle}
        disabled={!steps.length}
        title="Play / pause (space)"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <button
        className="btn icon"
        onClick={controls.forward}
        disabled={index >= steps.length - 1}
        title="Step forward (→)"
        aria-label="Step forward"
      >
        ⏵
      </button>
      <button
        className="btn icon"
        onClick={controls.reset}
        disabled={index < 0}
        title="Back to the start"
        aria-label="Reset"
      >
        ⏹
      </button>

      <span className="counter">
        {index < 0 ? '—' : index + 1} / {steps.length}
      </span>

      <input
        type="range"
        min={-1}
        max={Math.max(0, steps.length - 1)}
        value={index}
        onChange={(e) => controls.jump(Number(e.target.value))}
        aria-label="Playback position"
      />

      <button
        className="step-label"
        style={{ background: 'none', border: 'none', cursor: current ? 'pointer' : 'default', padding: 0 }}
        onClick={() => current && select({ type: 'message', id: current.message.id })}
        title={current ? 'Select this interaction' : undefined}
      >
        {current ? (
          <>
            {current.blockPath.map((p) => (
              <b key={p.block.id}>[{p.branch.label || p.block.type}] </b>
            ))}
            {label}
          </>
        ) : (
          label
        )}
      </button>

      <span className="spacer" />

      <OutcomeMenu />

      {alts.length > 0 && (
        <span className="branch-pick">
          <label htmlFor="seqflow-branch">branch</label>
          <select
            id="seqflow-branch"
            value=""
            onChange={(e) => {
              const [blockId, i] = e.target.value.split('::')
              if (blockId) setBranchChoice(blockId, Number(i))
            }}
            title="Choose which alt branch playback walks"
          >
            <option value="">
              {alts.length} alt block{alts.length === 1 ? '' : 's'} — pick a path
            </option>
            {alts.map(({ block, branches }) => (
              <optgroup key={block.id} label={branches[0]?.label || block.label || block.id}>
                {branches.map((b, i) => (
                  <option key={i} value={`${block.id}::${i}`}>
                    {(branchChoice[block.id] ?? 0) === i ? '● ' : '○ '}
                    {b.isUnhappy ? '⚠ ' : ''}
                    {b.label || `branch ${i + 1}`}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </span>
      )}

      <label className="branch-pick">
        <span>speed</span>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
