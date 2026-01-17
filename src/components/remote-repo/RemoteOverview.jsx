import React from 'react'

function RemoteOverview({
  remoteState,
  selectedBranch,
  onSelectBranch,
  remoteUrl,
  remoteTree,
  expandedFolders,
  onToggleFolder,
  cloneMenuOpen,
  onToggleClone,
  forkMenuOpen,
  onToggleFork,
  forkName,
  onForkNameChange,
  forkError,
  onForkCancel,
  onForkSubmit,
  deleteRepoOpen,
  onToggleDelete,
  onDeleteCancel,
  onDeleteConfirm,
  remoteReadme,
  activeRepo,
  cloneIcon,
  forkIcon,
  deleteIcon,
  TreeRow,
}) {
  return (
    <>
      <div className="remote-repo-modal__header">
        <h2 data-cy="remote-overview-title">Remote Overview</h2>
        {remoteState.connected ? (
          <label className="remote-repo-modal__select">
            <span>Branch</span>
            <select
              value={selectedBranch || ''}
              onChange={(event) => onSelectBranch(event.target.value)}
            >
              {remoteState.branches.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <p>
        {remoteState.connected
          ? 'This remote repo is linked and ready to receive pushes.'
          : `This remote repo is not connected yet. Link your local repo to ${remoteUrl} to sync changes.`}
      </p>
      {remoteState.connected ? (
        <div className="remote-repo-modal__card">
          <div className="remote-repo-modal__row">
            <h3>Repository tree</h3>
            <div className="remote-repo-modal__actions">
              <div className="remote-repo-modal__clone">
                <button
                  type="button"
                  className="remote-repo-modal__action-button"
                  onClick={onToggleClone}
                  data-cy="remote-clone-toggle"
                >
                  <span className="remote-repo-modal__action-icon" aria-hidden="true">
                    {cloneIcon}
                  </span>
                  Clone
                </button>
                {cloneMenuOpen ? (
                  <div className="remote-repo-modal__clone-menu">
                    <div className="remote-repo-modal__clone-title">Clone this repo</div>
                    <pre>git clone {remoteUrl}</pre>
                  </div>
                ) : null}
              </div>
              <div className="remote-repo-modal__fork">
                <button
                  type="button"
                  className="remote-repo-modal__action-button remote-repo-modal__action-button--fork"
                  onClick={onToggleFork}
                  data-cy="remote-fork-toggle"
                >
                  <span className="remote-repo-modal__action-icon" aria-hidden="true">
                    {forkIcon}
                  </span>
                  Fork
                </button>
                {forkMenuOpen ? (
                  <div className="remote-repo-modal__fork-menu">
                    <div className="remote-repo-modal__clone-title">Fork this repo</div>
                    <label className="remote-repo-modal__mr-field">
                      <span>New repo name</span>
                      <input
                        type="text"
                        value={forkName}
                        onChange={(event) => onForkNameChange(event.target.value)}
                        placeholder={`${activeRepo}-fork`}
                        data-cy="remote-fork-input"
                      />
                    </label>
                    {forkError ? (
                      <div className="remote-repo-modal__home-error">{forkError}</div>
                    ) : null}
                    <div className="remote-repo-modal__home-actions">
                      <button
                        type="button"
                        className="remote-repo-modal__mr-confirm-cancel"
                        onClick={onForkCancel}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="remote-repo-modal__mr-create"
                        disabled={!forkName.trim()}
                        onClick={onForkSubmit}
                        data-cy="remote-fork-submit"
                      >
                        Create fork
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="remote-repo-modal__delete">
                <button
                  type="button"
                  className="remote-repo-modal__action-button remote-repo-modal__action-button--danger"
                  onClick={onToggleDelete}
                  data-cy="remote-delete-toggle"
                >
                  <span className="remote-repo-modal__action-icon" aria-hidden="true">
                    {deleteIcon}
                  </span>
                  Delete
                </button>
                {deleteRepoOpen ? (
                  <div className="remote-repo-modal__delete-menu">
                    <div className="remote-repo-modal__clone-title">Delete this repo?</div>
                    <p className="remote-repo-modal__delete-text">
                      This removes the remote repo and all of its data.
                    </p>
                    <div className="remote-repo-modal__home-actions">
                      <button
                        type="button"
                        className="remote-repo-modal__mr-confirm-cancel"
                        onClick={onDeleteCancel}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="remote-repo-modal__delete-confirm"
                        onClick={onDeleteConfirm}
                        data-cy="remote-delete-confirm"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          {remoteTree.length === 0 ? (
            <div className="remote-repo-modal__empty">No files found.</div>
          ) : (
            <div className="remote-repo-modal__tree">
              {remoteTree.map((entry) => (
                <TreeRow
                  key={entry.path}
                  node={entry}
                  depth={0}
                  expandedFolders={expandedFolders}
                  onToggle={onToggleFolder}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
      {remoteState.connected && remoteReadme ? (
        <div className="remote-repo-modal__card">
          <h3>README</h3>
          <pre className="remote-repo-modal__readme">{remoteReadme}</pre>
        </div>
      ) : null}
      {!remoteState.connected ? (
        <>
          <div className="remote-repo-modal__card" data-cy="remote-init-card">
            <h3>Initialize your repo</h3>
            <pre>git init</pre>
            <pre>git add .</pre>
            <pre>git commit -m &quot;init&quot;</pre>
          </div>
          <div className="remote-repo-modal__card" data-cy="remote-connect-card">
            <h3>Connect to remote</h3>
            <pre>git remote add origin {remoteUrl}</pre>
            <pre>git push -u origin main</pre>
          </div>
        </>
      ) : null}
    </>
  )
}

export default RemoteOverview
