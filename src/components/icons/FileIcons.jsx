const FolderClosedIcon = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M3.25 7a2.25 2.25 0 0 1 2.25-2.25h4.8c.6 0 1.18.24 1.6.66l1.25 1.25c.3.3.7.47 1.12.47h5.23A2.25 2.25 0 0 1 21.75 9.4v8.1a2.5 2.5 0 0 1-2.5 2.5H5.75a2.5 2.5 0 0 1-2.5-2.5V7z"
      fill="currentColor"
      opacity="0.18"
    />
    <path
      d="M3.25 7.2h6.1l1.9 1.9h8.25A2.25 2.25 0 0 1 21.75 11v6.5a2.5 2.5 0 0 1-2.5 2.5H5.75a2.5 2.5 0 0 1-2.5-2.5V9.45A2.25 2.25 0 0 1 5.5 7.2z"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M7 13.35h7.8"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
)

const FolderOpenIcon = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M3.3 7.8h6l1.85 1.85H20"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M4 20.25h13.7a2.1 2.1 0 0 0 2-1.5l1.6-5.5a2.1 2.1 0 0 0-2-2.7H6.3a2.1 2.1 0 0 0-2 1.45l-1.6 5.5a2.1 2.1 0 0 0 1.3 2.75z"
      fill="currentColor"
      opacity="0.2"
    />
    <path
      d="M3.2 19.65h14.9a2.1 2.1 0 0 0 2-1.5l1.6-5.5a2.1 2.1 0 0 0-2-2.7H6.3a2.1 2.1 0 0 0-2 1.45l-1.6 5.5a2.1 2.1 0 0 0 1.3 2.75z"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const FileIcon = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M7.2 3.5h6l3.85 3.85v12.9a2.2 2.2 0 0 1-2.2 2.2H7.2a2.2 2.2 0 0 1-2.2-2.2V5.7a2.2 2.2 0 0 1 2.2-2.2z"
      fill="currentColor"
      opacity="0.16"
    />
    <path
      d="M7.2 3.5h6l3.85 3.85v12.9a2.2 2.2 0 0 1-2.2 2.2H7.2a2.2 2.2 0 0 1-2.2-2.2V5.7a2.2 2.2 0 0 1 2.2-2.2z"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M13.2 3.5v3.85h3.85"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M8.3 12.1h7.2M8.3 15h5.8"
      stroke="currentColor"
      strokeWidth="1.15"
      strokeLinecap="round"
    />
  </svg>
)

export { FileIcon, FolderClosedIcon, FolderOpenIcon }
