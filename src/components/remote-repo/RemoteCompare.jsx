import React from 'react'

function RemoteCompare({
  branches,
  compareBase,
  compareTarget,
  onBaseChange,
  onTargetChange,
  compareDiffs,
  compareLoading,
  compareError,
  hasOpenCompareMr,
  mrMenuOpen,
  onToggleMrMenu,
  mrTitle,
  onMrTitleChange,
  onCreateMr,
}) {
  return (
    <>
      <div className="remote-repo-modal__header">
        <h2>Compare</h2>
      </div>
      {branches.length < 2 ? (
        <div className="remote-repo-modal__empty">
          Create another branch to compare.
        </div>
      ) : (
        <>
          <div className="remote-repo-modal__compare-bar">
            <label className="remote-repo-modal__select">
              <span>Base</span>
              <select value={compareBase || ''} onChange={onBaseChange}>
                {branches.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
            </label>
            <label className="remote-repo-modal__select">
              <span>Compare</span>
              <select value={compareTarget || ''} onChange={onTargetChange}>
                {branches.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
            </label>
            <div className="remote-repo-modal__spacer" aria-hidden="true" />
            <button
              type="button"
              className="remote-repo-modal__primary"
              disabled={
                compareBase === compareTarget ||
                hasOpenCompareMr ||
                compareLoading ||
                compareDiffs.length === 0
              }
              title={
                hasOpenCompareMr
                  ? 'You already have a request for this change.'
                  : compareDiffs.length === 0
                    ? 'There are no changes to request.'
                    : ''
              }
              onClick={onToggleMrMenu}
            >
              Create Merge Request {compareTarget} → {compareBase}
            </button>
          </div>
          {mrMenuOpen ? (
            <div className="remote-repo-modal__mr-menu">
              <label className="remote-repo-modal__mr-field">
                <span>Merge Request title</span>
                <input
                  type="text"
                  value={mrTitle}
                  onChange={(event) => onMrTitleChange(event.target.value)}
                  placeholder="Add a title"
                />
              </label>
              <div className="remote-repo-modal__mr-actions">
                <button
                  type="button"
                  className="remote-repo-modal__mr-create"
                  disabled={!mrTitle.trim()}
                  onClick={onCreateMr}
                >
                  Create
                </button>
              </div>
            </div>
          ) : null}
          {compareBase === compareTarget ? (
            <div className="remote-repo-modal__empty">
              Select two different branches to compare.
            </div>
          ) : compareLoading ? (
            <div className="remote-repo-modal__empty">Comparing branches...</div>
          ) : compareError ? (
            <div className="remote-repo-modal__empty">{compareError}</div>
          ) : compareDiffs.length === 0 ? (
            <div className="remote-repo-modal__empty">
              No differences found between these branches.
            </div>
          ) : (
            <div className="remote-repo-modal__compare-list">
              {compareDiffs.map((diff) => (
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
        </>
      )}
    </>
  )
}

export default RemoteCompare
