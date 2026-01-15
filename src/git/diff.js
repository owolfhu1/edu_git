const computeDiffOps = (oldText, newText) => {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const rows = oldLines.length
  const cols = newLines.length
  const dp = Array.from({ length: rows + 1 }, () => Array(cols + 1).fill(0))

  for (let i = 1; i <= rows; i += 1) {
    for (let j = 1; j <= cols; j += 1) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  let i = rows
  let j = cols
  const ops = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: 'equal', line: oldLines[i - 1] })
      i -= 1
      j -= 1
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'add', line: newLines[j - 1] })
      j -= 1
    } else {
      ops.push({ type: 'del', line: oldLines[i - 1] })
      i -= 1
    }
  }

  return ops.reverse()
}

const lcsDiff = (oldText, newText, file) => {
  const ops = computeDiffOps(oldText, newText)
  const lines = [`diff -- ${file}`, `--- a/${file}`, `+++ b/${file}`]
  const context = 2

  let hunk = null

  const pushHunkHeader = () => {
    if (!hunk) {
      return
    }
    const header = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`
    lines.push(header, ...hunk.lines)
  }

  let oldLine = 1
  let newLine = 1

  ops.forEach((op, index) => {
    const isChange = op.type !== 'equal'
    const shouldInclude =
      isChange ||
      ops
        .slice(Math.max(0, index - context), index + context + 1)
        .some((item) => item.type !== 'equal')
    if (!shouldInclude) {
      if (hunk) {
        pushHunkHeader()
        hunk = null
      }
      if (op.type === 'equal') {
        oldLine += 1
        newLine += 1
      }
      return
    }
    if (!hunk) {
      hunk = {
        oldStart: oldLine,
        newStart: newLine,
        oldCount: 0,
        newCount: 0,
        lines: [],
      }
    }

    if (op.type === 'equal') {
      hunk.lines.push(`  ${op.line}`)
      hunk.oldCount += 1
      hunk.newCount += 1
      oldLine += 1
      newLine += 1
      return
    }

    if (op.type === 'del') {
      hunk.lines.push(`- ${op.line}`)
      hunk.oldCount += 1
      oldLine += 1
      return
    }

    hunk.lines.push(`+ ${op.line}`)
    hunk.newCount += 1
    newLine += 1
  })

  if (hunk) {
    pushHunkHeader()
  } else if (oldText !== newText && lines.length === 3) {
    lines.push('@@ -1,0 +1,0 @@')
  }

  return lines
}

const buildGutterMarks = (oldText, newText) => {
  const ops = computeDiffOps(oldText, newText)
  const newLines = newText.split('\n')
  const addedLines = new Set()
  const modifiedLines = new Set()
  const removedMarkers = new Set()
  const changes = []
  const changeMap = new Map()
  let newIndex = 0
  let run = null

  const flushRun = () => {
    if (!run) {
      return
    }
    const type =
      run.oldLines.length > 0 && run.newLines.length > 0
        ? 'modify'
        : run.newLines.length > 0
          ? 'add'
          : 'delete'
    const markerLine = Math.min(newLines.length, Math.max(1, run.newStart))
    const change = {
      type,
      oldLines: run.oldLines,
      newLines: run.newLines,
      newStart: run.newStart,
      newEnd: run.newStart + run.newLines.length - 1,
      markerLine,
    }
    changes.push(change)
    if (type === 'delete') {
      removedMarkers.add(markerLine)
      changeMap.set(markerLine, change)
    } else {
      const start = change.newStart
      const end = change.newEnd
      for (let line = start; line <= end; line += 1) {
        if (type === 'add') {
          addedLines.add(line)
        } else {
          modifiedLines.add(line)
        }
        changeMap.set(line, change)
      }
    }
    run = null
  }

  ops.forEach((op) => {
    if (op.type === 'equal') {
      flushRun()
      newIndex += 1
      return
    }
    if (!run) {
      run = {
        oldLines: [],
        newLines: [],
        newStart: newIndex + 1,
      }
    }
    if (op.type === 'add') {
      run.newLines.push(op.line)
      newIndex += 1
      return
    }
    run.oldLines.push(op.line)
  })

  flushRun()

  return { addedLines, modifiedLines, removedMarkers, changeMap, changes }
}

export { buildGutterMarks, computeDiffOps, lcsDiff }
