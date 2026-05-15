// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer } = require('electron');

// Set up the SDK logger bridge between main and renderer
contextBridge.exposeInMainWorld('sdkLoggerBridge', {
  // Receive logs from main process
  onSdkLog: (callback) => ipcRenderer.on('sdk-log', (_, logEntry) => callback(logEntry)),

  // Send logs from renderer to main process
  sendSdkLog: (logEntry) => ipcRenderer.send('sdk-log', logEntry)
});

contextBridge.exposeInMainWorld('electronAPI', {
  navigate: (page) => ipcRenderer.send('navigate', page),
  saveMeetingsData: (data) => ipcRenderer.invoke('saveMeetingsData', data),
  loadMeetingsData: () => ipcRenderer.invoke('loadMeetingsData'),
  deleteMeeting: (meetingId) => ipcRenderer.invoke('deleteMeeting', meetingId),
  generateMeetingSummary: (meetingId, summaryTypeId) => ipcRenderer.invoke('generateMeetingSummary', { meetingId, summaryTypeId }),
  generateMeetingSummaryStreaming: (meetingId, summaryTypeId) => ipcRenderer.invoke('generateMeetingSummaryStreaming', { meetingId, summaryTypeId }),
  askMeetingQuestion: (meetingId, question) => ipcRenderer.invoke('askMeetingQuestion', { meetingId, question }),
  startManualRecording: (meetingId) => ipcRenderer.invoke('startManualRecording', meetingId),
  stopManualRecording: (recordingId) => ipcRenderer.invoke('stopManualRecording', recordingId),
  debugGetHandlers: () => ipcRenderer.invoke('debugGetHandlers'),
  checkForDetectedMeeting: () => ipcRenderer.invoke('checkForDetectedMeeting'),
  joinDetectedMeeting: () => ipcRenderer.invoke('joinDetectedMeeting'),
  onOpenMeetingNote: (callback) => ipcRenderer.on('open-meeting-note', (_, meetingId) => callback(meetingId)),
  onRecordingCompleted: (callback) => ipcRenderer.on('recording-completed', (_, meetingId) => callback(meetingId)),
  onTranscriptUpdated: (callback) => ipcRenderer.on('transcript-updated', (_, meetingId) => callback(meetingId)),
  onSummaryGenerated: (callback) => ipcRenderer.on('summary-generated', (_, meetingId) => callback(meetingId)),
  onSummaryUpdate: (callback) => ipcRenderer.on('summary-update', (_, data) => callback(data)),
  onRecordingStateChange: (callback) => ipcRenderer.on('recording-state-change', (_, data) => callback(data)),
  onNetworkStatusChange: (callback) => ipcRenderer.on('network-status-change', (_, data) => callback(data)),
  onParticipantsUpdated: (callback) => ipcRenderer.on('participants-updated', (_, meetingId) => callback(meetingId)),
  onVideoFrame: (callback) => ipcRenderer.on('video-frame', (_, data) => callback(data)),
  onMeetingDetectionStatus: (callback) => ipcRenderer.on('meeting-detection-status', (_, data) => callback(data)),
  onMeetingTitleUpdated: (callback) => ipcRenderer.on('meeting-title-updated', (_, data) => callback(data)),
  getActiveRecordingId: (noteId) => ipcRenderer.invoke('getActiveRecordingId', noteId),

  // Bot Management APIs
  getBotTypes: () => ipcRenderer.invoke('getBotTypes'),
  getBotTypeById: (botId) => ipcRenderer.invoke('getBotTypeById', botId),
  createBotType: (botData) => ipcRenderer.invoke('createBotType', botData),
  updateBotType: (botId, updates) => ipcRenderer.invoke('updateBotType', { botId, updates }),
  deleteBotType: (botId) => ipcRenderer.invoke('deleteBotType', botId),
  getGlobalSettings: () => ipcRenderer.invoke('getGlobalSettings'),
  updateGlobalSettings: (updates) => ipcRenderer.invoke('updateGlobalSettings', updates),
  getAvailableModels: () => ipcRenderer.invoke('getAvailableModels'),

  // Summary Type Management APIs
  getSummaryTypes: () => ipcRenderer.invoke('getSummaryTypes'),
  getSummaryTypeById: (typeId) => ipcRenderer.invoke('getSummaryTypeById', typeId),
  createSummaryType: (typeData) => ipcRenderer.invoke('createSummaryType', typeData),
  updateSummaryType: (typeId, updates) => ipcRenderer.invoke('updateSummaryType', { typeId, updates }),
  deleteSummaryType: (typeId) => ipcRenderer.invoke('deleteSummaryType', typeId),
  getSummaryGlobalSettings: () => ipcRenderer.invoke('getSummaryGlobalSettings'),
  updateSummaryGlobalSettings: (updates) => ipcRenderer.invoke('updateSummaryGlobalSettings', updates),
  getDefaultSummaryType: () => ipcRenderer.invoke('getDefaultSummaryType'),

  // Tag Management APIs
  getTags: () => ipcRenderer.invoke('getTags'),
  getTagById: (tagId) => ipcRenderer.invoke('getTagById', tagId),
  createTag: (tagData) => ipcRenderer.invoke('createTag', tagData),
  updateTag: (tagId, updates) => ipcRenderer.invoke('updateTag', { tagId, updates }),
  deleteTag: (tagId) => ipcRenderer.invoke('deleteTag', tagId),
  getTagColors: () => ipcRenderer.invoke('getTagColors'),
  addTagToMeeting: (meetingId, tagId) => ipcRenderer.invoke('addTagToMeeting', { meetingId, tagId }),
  removeTagFromMeeting: (meetingId, tagId) => ipcRenderer.invoke('removeTagFromMeeting', { meetingId, tagId }),

  // Coaching Control APIs
  activateCoachingBot: (data) => ipcRenderer.invoke('activateCoachingBot', data),
  deactivateCoachingBot: () => ipcRenderer.invoke('deactivateCoachingBot'),

  // Recording Management APIs
  deleteAllRecordings: () => ipcRenderer.invoke('deleteAllRecordings'),
  clearLocalRecordings: () => ipcRenderer.invoke('clearLocalRecordings'),
  openVideoFile: (meetingId) => ipcRenderer.invoke('openVideoFile', meetingId),

  // Coaching Events (main -> renderer)
  onCoachingFeedback: (callback) => ipcRenderer.on('coaching-feedback', (_, data) => callback(data)),
  onCoachingFeedbackChunk: (callback) => ipcRenderer.on('coaching-feedback-chunk', (_, data) => callback(data)),
  onCoachingStatusChange: (callback) => ipcRenderer.on('coaching-status-change', (_, data) => callback(data)),
  onCoachingError: (callback) => ipcRenderer.on('coaching-error', (_, data) => callback(data))
});
