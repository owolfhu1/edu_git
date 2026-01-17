import React from 'react'

function RemoteHome({
  remoteRepos,
  createRepoOpen,
  createRepoName,
  createRepoError,
  onToggleCreate,
  onCreateNameChange,
  onCreateCancel,
  onCreateSubmit,
  onNavigateRepo,
}) {
  return (
    <>
      <div className="remote-repo-modal__header">
        <h2 data-cy="remote-home-title">Remote Home</h2>
      </div>
      <p>
        Create remote repositories here and open them to explore branches,
        commits, and merge requests.
      </p>
      <div className="remote-repo-modal__card remote-repo-modal__home-card">
        <div className="remote-repo-modal__row">
          <h3>Repositories</h3>
          <button
            type="button"
            className="remote-repo-modal__primary"
            onClick={onToggleCreate}
            data-cy="remote-home-create-toggle"
          >
            New Repo
          </button>
        </div>
        {remoteRepos.length === 0 ? (
          <div className="remote-repo-modal__empty">No remote repositories yet.</div>
        ) : (
          <div className="remote-repo-modal__repo-list">
            {remoteRepos.map((repo) => (
              <button
                key={repo}
                type="button"
                className="remote-repo-modal__repo-item"
                onClick={() => onNavigateRepo(repo)}
                data-cy="remote-home-repo"
                data-repo={repo}
              >
                {repo}
              </button>
            ))}
          </div>
        )}
      </div>
      {createRepoOpen ? (
        <div className="remote-repo-modal__card remote-repo-modal__home-create">
          <h3>Create a new repository</h3>
          <label className="remote-repo-modal__mr-field">
            <span>Repository name</span>
            <input
              type="text"
              value={createRepoName}
              onChange={(event) => onCreateNameChange(event.target.value)}
              placeholder="my-project"
              data-cy="remote-home-create-input"
            />
          </label>
          {createRepoError ? (
            <div className="remote-repo-modal__home-error">{createRepoError}</div>
          ) : null}
          <div className="remote-repo-modal__home-actions">
            <button
              type="button"
              className="remote-repo-modal__mr-confirm-cancel"
              onClick={onCreateCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="remote-repo-modal__mr-create"
              disabled={!createRepoName.trim()}
              onClick={onCreateSubmit}
              data-cy="remote-home-create-submit"
            >
              Create
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}

export default RemoteHome
