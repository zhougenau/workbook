let audioContext = null
let listeners = {}
let speechFilePath = ''
let speechFileSequence = 0

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
  const player = getAudioContext()
  player.stop()
  listeners = nextListeners
  const previousFilePath = speechFilePath
  const nextFilePath = `${wx.env.USER_DATA_PATH}/wordbook-speech-${Date.now()}-${speechFileSequence++}.mp3`
  await writeSpeechFile(nextFilePath, audioBase64)
  speechFilePath = nextFilePath
  player.src = nextFilePath
  removeSpeechFile(previousFilePath)
  player.play()
}

function stopSpeech() {
  if (audioContext) audioContext.stop()
  listeners = {}
}

function destroySpeech() {
  if (audioContext) audioContext.destroy()
  audioContext = null
  listeners = {}
  removeSpeechFile(speechFilePath)
  speechFilePath = ''
}

module.exports = {
  destroySpeech,
  playSpeech,
  stopSpeech,
}
