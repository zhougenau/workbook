let audioContext = null
let listeners = {}
let speechFilePath = ''
let speechFileSequence = 0
let playbackId = 0
let playbackRate = 1

function getAudioContext() {
  if (audioContext) return audioContext
  audioContext = wx.createInnerAudioContext()
  audioContext.onPlay(() => listeners.onPlay && listeners.onPlay())
  audioContext.onEnded(() => listeners.onEnded && listeners.onEnded())
  audioContext.onStop(() => listeners.onStop && listeners.onStop())
  audioContext.onError((error) => listeners.onError && listeners.onError(error))
  return audioContext
}

function writeSpeechFile(filePath, audioBase64) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().writeFile({
      filePath,
      data: audioBase64,
      encoding: 'base64',
      success: resolve,
      fail(error) {
        reject(new Error(error.errMsg || '语音文件写入失败'))
      },
    })
  })
}

function removeSpeechFile(filePath) {
  if (!filePath) return
  wx.getFileSystemManager().unlink({ filePath, fail() {} })
}

async function playSpeech(audioBase64, nextListeners = {}) {
  if (typeof audioBase64 !== 'string' || !audioBase64) throw new Error('语音数据无效')
  const currentPlaybackId = ++playbackId
  const player = getAudioContext()
  player.stop()
  listeners = nextListeners
  const previousFilePath = speechFilePath
  const nextFilePath = `${wx.env.USER_DATA_PATH}/wordbook-speech-${Date.now()}-${speechFileSequence++}.mp3`
  await writeSpeechFile(nextFilePath, audioBase64)
  if (currentPlaybackId !== playbackId) {
    removeSpeechFile(nextFilePath)
    return
  }
  speechFilePath = nextFilePath
  player.src = nextFilePath
  player.playbackRate = playbackRate
  removeSpeechFile(previousFilePath)
  player.play()
}

function setSpeechRate(rate) {
  if (!Number.isFinite(rate) || rate < 0.5 || rate > 2) return
  playbackRate = rate
  if (audioContext) audioContext.playbackRate = rate
}

function stopSpeech() {
  playbackId += 1
  if (audioContext) audioContext.stop()
  listeners = {}
}

function destroySpeech() {
  playbackId += 1
  if (audioContext) audioContext.destroy()
  audioContext = null
  listeners = {}
  removeSpeechFile(speechFilePath)
  speechFilePath = ''
}

module.exports = {
  destroySpeech,
  playSpeech,
  setSpeechRate,
  stopSpeech,
}
