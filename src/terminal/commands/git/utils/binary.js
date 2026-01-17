const toUint8Array = (data) => {
  if (!data) {
    return new Uint8Array()
  }
  if (data instanceof Uint8Array) {
    return data
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) {
    return new Uint8Array(data)
  }
  return new TextEncoder().encode(String(data))
}

const encodeBinary = (data) => {
  const bytes = toUint8Array(data)
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index])
  }
  return btoa(binary)
}

const decodeBinary = (encoded) => {
  if (!encoded) {
    return new Uint8Array()
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(encoded, 'base64')
  }
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

const isBinaryContent = (data) => {
  const bytes = toUint8Array(data)
  if (bytes.length === 0) {
    return false
  }
  const decoded = new TextDecoder().decode(bytes)
  return decoded.includes('\uFFFD')
}

const buffersEqual = (left, right) => {
  const leftBytes = toUint8Array(left)
  const rightBytes = toUint8Array(right)
  if (leftBytes.length !== rightBytes.length) {
    return false
  }
  for (let index = 0; index < leftBytes.length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) {
      return false
    }
  }
  return true
}

export {
  toUint8Array,
  encodeBinary,
  decodeBinary,
  isBinaryContent,
  buffersEqual,
}
