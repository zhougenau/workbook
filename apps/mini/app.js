const { initializeStorage } = require('./utils/storage')

App({
  onLaunch() {
    initializeStorage()
  },
})
