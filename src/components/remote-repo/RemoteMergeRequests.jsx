import React from 'react'

function RemoteMergeRequests({
  mergeRequests,
  mrStatusFilter,
  onStatusFilterChange,
  onOpenMr,
  mrRoute,
  activeMr,
  mrDetail,
  mrAction,
  onMrActionChange,
  deleteBranchOnMerge,
  onDeleteBranchToggle,
  onConfirmAction,
  onCancelAction,
  remoteState,
  isMrPairInvalid,
  onUpdateMrBase,
  onUpdateMrCompare,
  conflictStrategy,
  conflictStrategies,
  onConflictStrategyChange,
  conflictExplanation,
  conflictCommands,
}) {
  if (!mrRoute && !activeMr) {
    return (
      <>
        <div className="remote-repo-modal__header">
          <h2>Merge Requests</h2>
          <label className="remote-repo-modal__select">
            <span>Status</span>
            <select value={mrStatusFilter} onChange={onStatusFilterChange}>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="merged">Merged</option>
            </select>
          </label>
        </div>
        {mergeRequests.filter((mr) => mr.status === mrStatusFilter).length === 0 ? (
          <div className="remote-repo-modal__empty">No merge requests.</div>
        ) : (
          <div className="remote-repo-modal__mr-table">
            <div className="remote-repo-modal__mr-row remote-repo-modal__mr-row--header">
              <span>Title</span>
              <span>Branches</span>
              <span>Status</span>
            </div>
            {mergeRequests
              .filter((mr) => mr.status === mrStatusFilter)
              .map((mr) => (
                <button
                  type="button"
                  key={mr.id}
                  className="remote-repo-modal__mr-row"
                  onClick={() => onOpenMr(mr.slug)}
                  data-cy="remote-mr-row"
                  data-slug={mr.slug}
                >
                  <span>{mr.title}</span>
                  <span>
                    {mr.compare} → {mr.base}
                  </span>
                  <span className="remote-repo-modal__mr-status">
                    {mr.status}
                    {mr.mergeStatus === 'conflict' ? (
                      <span className="remote-repo-modal__mr-chip remote-repo-modal__mr-chip--conflict remote-repo-modal__mr-chip--inline">
                        Conflict
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
          </div>
        )}
      </>
    )
  }

  if (mrRoute && !activeMr) {
    return (
      <div className="remote-repo-modal__notfound">
        <div className="remote-repo-modal__notfound-code">404</div>
        <div className="remote-repo-modal__notfound-title">Merge Request not found</div>
        <div className="remote-repo-modal__notfound-text">
          This merge request does not exist in the current workspace.
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="remote-repo-modal__header">
        <div className="remote-repo-modal__mr-title">
          <h2>{activeMr.title}</h2>
          {activeMr.status === 'merged' ? (
            <span className="remote-repo-modal__mr-chip">Merged</span>
          ) : null}
          {mrDetail.mergeStatus === 'conflict' ? (
            <span className="remote-repo-modal__mr-chip remote-repo-modal__mr-chip--conflict">
              Conflict
            </span>
          ) : null}
        </div>
        {activeMr.status === 'open' ? (
          <div className="remote-repo-modal__mr-actions">
            <button
              type="button"
              className="remote-repo-modal__mr-button remote-repo-modal__mr-button--merge"
              disabled={!mrDetail.canMerge}
              title={!mrDetail.canMerge ? 'This merge request cannot be merged yet.' : ''}
              onClick={() => onMrActionChange('merge')}
            >
              Merge
            </button>
            <button
              type="button"
              className="remote-repo-modal__mr-button remote-repo-modal__mr-button--close"
              onClick={() => onMrActionChange('close')}
            >
              Close
            </button>
          </div>
        ) : null}
      </div>
      {mrAction ? (
        <div className="remote-repo-modal__mr-confirm">
          <div className="remote-repo-modal__mr-confirm-title">
            {mrAction === 'merge' ? 'Merge this request?' : 'Close this request?'}
          </div>
          <div className="remote-repo-modal__mr-confirm-text">
            {mrAction === 'merge'
              ? `This will update ${activeMr.base} to ${activeMr.compare} and mark the request as merged.`
              : 'This will close the merge request without merging changes.'}
          </div>
          <div className="remote-repo-modal__mr-confirm-actions">
            {mrAction === 'merge' ? (
              <label className="remote-repo-modal__mr-confirm-toggle">
                <input
                  type="checkbox"
                  checked={deleteBranchOnMerge}
                  onChange={(event) => onDeleteBranchToggle(event.target.checked)}
                />
                Delete branch {activeMr.compare} on merge
              </label>
            ) : null}
            <div className="remote-repo-modal__mr-confirm-spacer" aria-hidden="true" />
            <button
              type="button"
              className="remote-repo-modal__mr-confirm-cancel"
              onClick={onCancelAction}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`remote-repo-modal__mr-confirm-apply ${
                mrAction === 'merge'
                  ? 'remote-repo-modal__mr-confirm-apply--merge'
                  : 'remote-repo-modal__mr-confirm-apply--close'
              }`}
              onClick={onConfirmAction}
            >
              Confirm
            </button>
          </div>
        </div>
      ) : null}
      <div className="remote-repo-modal__mr-summary">
        <div className="remote-repo-modal__mr-summary-row">
          <label>
            <span>Base</span>
            <select
              className="remote-repo-modal__mr-summary-select"
              value={activeMr.base}
              disabled={activeMr.status !== 'open'}
              data-cy="mr-base-select"
              onChange={(event) => onUpdateMrBase(event.target.value)}
            >
              {remoteState.branches.map((branch) => (
                <option
                  key={`mr-base-${branch}`}
                  value={branch}
                  disabled={isMrPairInvalid(branch, activeMr.compare)}
                >
                  {branch}
                </option>
              ))}
            </select>
          </label>
          <span className="remote-repo-modal__mr-summary-arrow">←</span>
          <label>
            <span>Compare</span>
            <select
              className="remote-repo-modal__mr-summary-select"
              value={activeMr.compare}
              disabled={activeMr.status !== 'open'}
              data-cy="mr-compare-select"
              onChange={(event) => onUpdateMrCompare(event.target.value)}
            >
              {remoteState.branches.map((branch) => (
                <option
                  key={`mr-compare-${branch}`}
                  value={branch}
                  disabled={isMrPairInvalid(activeMr.base, branch)}
                >
                  {branch}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {mrDetail.mergeRelation && mrDetail.mergeStatus !== 'conflict' ? (
        <div className="remote-repo-modal__mr-meta">
          {mrDetail.mergeRelation === 'ahead'
            ? 'Branch is ahead of base.'
            : mrDetail.mergeRelation === 'behind'
              ? 'Branch is behind base.'
              : mrDetail.mergeRelation === 'up-to-date'
                ? 'Branch is up to date with base.'
                : 'Branch has diverged from base.'}
        </div>
      ) : null}
      {mrDetail.mergeStatus === 'conflict' ? (
        <div className="remote-repo-modal__mr-warning">
          <div className="remote-repo-modal__mr-warning-title">
            Merge blocked by conflicts.
            {mrDetail.conflictFiles?.length
              ? ` Files: ${mrDetail.conflictFiles.join(', ')}`
              : ''}
          </div>
          <div className="remote-repo-modal__mr-help-row">
            <div className="remote-repo-modal__mr-help-title">
              Resolve locally, then push the fix
            </div>
            <label className="remote-repo-modal__mr-help-select">
              <span>Strategy</span>
              <select value={conflictStrategy} onChange={onConflictStrategyChange}>
                {conflictStrategies.map((strategy) => (
                  <option key={strategy.id} value={strategy.id}>
                    {strategy.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="remote-repo-modal__mr-help-text">{conflictExplanation}</p>
          <pre>{conflictCommands.join('\n')}</pre>
          {conflictStrategy === 'cherry-pick' ? (
            <p className="remote-repo-modal__mr-help-note">
              After pushing, update the branches above to{' '}
              {`${activeMr.base} ← ${activeMr.compare}_resolved`}.
            </p>
          ) : null}
        </div>
      ) : mrDetail.mergeStatus === 'already-merged' ? (
        <div className="remote-repo-modal__mr-warning">
          This branch is already merged into {activeMr.base}.
        </div>
      ) : mrDetail.mergeMessage ? (
        <div className="remote-repo-modal__mr-warning">{mrDetail.mergeMessage}</div>
      ) : null}
      <div className="remote-repo-modal__mr-section">
        <h3>Commits</h3>
        {mrDetail.loading ? (
          <div className="remote-repo-modal__empty">Loading merge request...</div>
        ) : mrDetail.error ? (
          <div className="remote-repo-modal__empty">{mrDetail.error}</div>
        ) : mrDetail.commits.length === 0 ? (
          <div className="remote-repo-modal__empty">No commits found.</div>
        ) : (
          <div className="remote-repo-modal__list">
            {mrDetail.commits.map((commit) => (
              <div key={commit.oid} className="remote-repo-modal__list-item">
                <div className="remote-repo-modal__commit-title">
                  {commit.commit.message.split('\n')[0]}
                </div>
                <div className="remote-repo-modal__commit-meta">
                  {commit.oid.slice(0, 7)} · {commit.commit.author.name}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="remote-repo-modal__mr-section">
        <h3>Diff</h3>
        {mrDetail.loading ? (
          <div className="remote-repo-modal__empty">Loading merge request...</div>
        ) : mrDetail.error ? (
          <div className="remote-repo-modal__empty">{mrDetail.error}</div>
        ) : mrDetail.diffs.length === 0 ? (
          <div className="remote-repo-modal__empty">
            No differences found between these branches.
          </div>
        ) : (
          <div className="remote-repo-modal__compare-list">
            {mrDetail.diffs.map((diff) => (
              <div key={diff.path} className="remote-repo-modal__diff-card">
                <div className="remote-repo-modal__diff-header">
                  <div className="remote-repo-modal__diff-title">{diff.path}</div>
                  <span
                    className={`remote-repo-modal__diff-badge remote-repo-modal__diff-badge--${diff.status}`}
                  >
                    {diff.status}
                  </span>
                </div>
                <pre className="remote-repo-modal__diff-body">
                  {diff.lines.map((line, index) => (
                    <span
                      key={`${diff.path}-${index}`}
                      className={
                        line.startsWith('+ ')
                          ? 'remote-repo-modal__diff-line--add'
                          : line.startsWith('- ')
                            ? 'remote-repo-modal__diff-line--del'
                            : 'remote-repo-modal__diff-line--ctx'
                      }
                    >
                      {line}
                      {'\n'}
                    </span>
                  ))}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

export default RemoteMergeRequests
