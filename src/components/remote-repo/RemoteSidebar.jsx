import React from 'react'

function RemoteSidebar({
  activeRepo,
  remoteState,
  repoMissing,
  route,
  repoSubPath,
  onNavigateHome,
  navigateRepo,
  mergeRequests,
  pages,
}) {
  return (
    <aside className="remote-repo-modal__sidebar">
      <div className="remote-repo-modal__repo">
        <div className="remote-repo-modal__repo-name">
          {activeRepo || 'remote.mock'}
        </div>
        <div className="remote-repo-modal__repo-meta">
          {activeRepo ? 'Remote Repo' : 'Remote Home'}
        </div>
        <div
          className={`remote-repo-modal__badge ${
            remoteState.connected ? 'remote-repo-modal__badge--linked' : ''
          }`}
          data-cy="remote-status"
        >
          {activeRepo
            ? repoMissing
              ? 'Repo not found'
              : remoteState.connected
                ? 'Linked: origin'
                : 'No remote linked'
            : 'Select a repo'}
        </div>
      </div>
      <nav className="remote-repo-modal__menu">
        <button
          type="button"
          className={`remote-repo-modal__menu-item ${route.isHome ? 'is-active' : ''}`}
          onClick={onNavigateHome}
          data-cy="remote-menu-home"
        >
          Home
        </button>
        {activeRepo && !repoMissing
          ? pages
              .filter((entry) => {
                if (!remoteState.connected) {
                  return entry.path === '/'
                }
                if (entry.path === '/merge-requests') {
                  return mergeRequests.length > 0
                }
                if (entry.path === '/compare') {
                  return remoteState.branches.length > 1
                }
                return true
              })
              .map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className={`remote-repo-modal__menu-item ${
                    repoSubPath === entry.path ? 'is-active' : ''
                  }`}
                  onClick={() => navigateRepo(entry.path)}
                  data-cy={`remote-menu-${entry.path === '/' ? 'overview' : entry.path.slice(1)}`}
                >
                  {entry.label}
                </button>
              ))
          : null}
      </nav>
    </aside>
  )
}

export default RemoteSidebar
