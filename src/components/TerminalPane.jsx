import './TerminalPane.css'

function TerminalPane() {
  return (
    <div className="terminal-pane">
      <div className="terminal-pane__header">Terminal</div>
      <div className="terminal-pane__body">
        <div className="terminal-pane__line">
          edu-git@mock:~/repo $ git status
        </div>
        <div className="terminal-pane__line">
          On branch main
        </div>
        <div className="terminal-pane__line">
          Changes not staged for commit:
        </div>
        <div className="terminal-pane__line terminal-pane__line--indent">
          modified: README.md
        </div>
        <div className="terminal-pane__line terminal-pane__line--prompt">
          edu-git@mock:~/repo $
          <span className="terminal-pane__cursor" />
        </div>
      </div>
    </div>
  )
}

export default TerminalPane
