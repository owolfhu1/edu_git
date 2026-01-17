import React from 'react'

function RemoteChrome({
  address,
  onAddressChange,
  onBack,
  onForward,
  canGoBack,
  canGoForward,
  onSubmitAddress,
  onClose,
}) {
  return (
    <div className="remote-repo-modal__chrome">
      <div className="remote-repo-modal__nav">
        <button
          type="button"
          className="remote-repo-modal__nav-btn"
          onClick={onBack}
          disabled={!canGoBack}
          aria-label="Back"
        >
          ←
        </button>
        <button
          type="button"
          className="remote-repo-modal__nav-btn"
          onClick={onForward}
          disabled={!canGoForward}
          aria-label="Forward"
        >
          →
        </button>
      </div>
      <form
        className="remote-repo-modal__address"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmitAddress(address)
        }}
      >
        <input
          type="text"
          value={address}
          onChange={(event) => onAddressChange(event.target.value)}
          className="remote-repo-modal__address-input"
          spellCheck="false"
        />
      </form>
      <button
        type="button"
        className="remote-repo-modal__close"
        onClick={onClose}
        data-cy="remote-modal-close"
      >
        ×
      </button>
    </div>
  )
}

export default RemoteChrome
