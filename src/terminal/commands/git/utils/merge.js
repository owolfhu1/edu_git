import diff3Merge from 'diff3'

const LINEBREAKS = /^.*(\r?\n|$)/gm

const mergeFileContents = (baseText, headText, targetText, headLabel, targetLabel) => {
  const baseLines = (baseText ?? '').match(LINEBREAKS) || ['']
  const headLines = (headText ?? '').match(LINEBREAKS) || ['']
  const targetLines = (targetText ?? '').match(LINEBREAKS) || ['']
  const result = diff3Merge(headLines, baseLines, targetLines)
  let mergedText = ''
  let cleanMerge = true
  const ensureLineBreak = () => {
    if (mergedText && !mergedText.endsWith('\n')) {
      mergedText += '\n'
    }
  }

  result.forEach((item) => {
    if (item.ok) {
      mergedText += item.ok.join('')
    }
    if (item.conflict) {
      cleanMerge = false
      ensureLineBreak()
      mergedText += `<<<<<<< ${headLabel}\n`
      const ours = item.conflict.a.join('')
      mergedText += ours
      ensureLineBreak()
      mergedText += '=======\n'
      const theirs = item.conflict.b.join('')
      mergedText += theirs
      ensureLineBreak()
      mergedText += `>>>>>>> ${targetLabel}\n`
    }
  })

  return { cleanMerge, mergedText }
}

export { mergeFileContents }
