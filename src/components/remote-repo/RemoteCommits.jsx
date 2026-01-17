import React from 'react'

function RemoteCommits({ commits, branches, selectedBranch, onSelectBranch }) {
  return (
    <>
      <div className="remote-repo-modal__header">
        <h2>Commits</h2>
        <label className="remote-repo-modal__select">
          <span>Branch</span>
          <select
            value={selectedBranch || ''}
            onChange={(event) => onSelectBranch(event.target.value)}
          >
            {branches.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
        </label>
      </div>
      {commits.length === 0 ? (
        <>
          <p>Once connected, commits pushed to the remote will appear here.</p>
          <div className="remote-repo-modal__empty">No commits</div>
        </>
      ) : (
        <div className="remote-repo-modal__list">
          {commits.map((commit) => (
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
    </>
  )
}

export default RemoteCommits
