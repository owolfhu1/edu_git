import React from 'react'

function RemoteBranches({ branches }) {
  return (
    <>
      <h2>Branches</h2>
      {branches.length === 0 ? (
        <>
          <p>No remote branches yet. Connect a local repo to populate branches.</p>
          <div className="remote-repo-modal__empty">No branches</div>
        </>
      ) : (
        <div className="remote-repo-modal__list">
          {branches.map((branch) => (
            <div key={branch} className="remote-repo-modal__list-item">
              {branch}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export default RemoteBranches
