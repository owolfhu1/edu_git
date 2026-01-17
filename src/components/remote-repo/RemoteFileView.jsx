import React from 'react'

function RemoteFileView({
  fileRoute,
  filePreview,
  fileError,
  branches,
  onBranchChange,
}) {
  return (
    <div className="remote-repo-modal__file-view">
      <div className="remote-repo-modal__header">
        <h2>{filePreview?.path || fileRoute.filePath}</h2>
        <label className="remote-repo-modal__select">
          <span>Branch</span>
          <select value={fileRoute.branch} onChange={onBranchChange}>
            {branches.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="remote-repo-modal__file-path">
        {fileRoute.branch}:{fileRoute.filePath}
      </div>
      {fileError ? (
        <div className="remote-repo-modal__file-empty">
          <div className="remote-repo-modal__file-code">404</div>
          <div className="remote-repo-modal__file-title">Not Found</div>
          <div className="remote-repo-modal__file-text">
            The file could not be found on this branch.
          </div>
        </div>
      ) : (
        <pre className="remote-repo-modal__file-content">
          {filePreview ? filePreview.content : 'Loading...'}
        </pre>
      )}
    </div>
  )
}

export default RemoteFileView
