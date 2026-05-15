/**
 * Coaching Engine - Handles real-time AI coaching during meetings
 * Accumulates transcript data and periodically sends to AI for feedback
 */

const OpenAI = require('openai');
const botManager = require('./botManager');

// Lazy-initialize OpenAI client with OpenRouter
let openai = null;

function getOpenAIClient() {
  if (!openai) {
    const apiKey = process.env.OPENROUTER_KEY;
    if (!apiKey) {
      throw new Error('OPENROUTER_KEY environment variable is not set');
    }
    openai = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: apiKey,
      defaultHeaders: {
        "HTTP-Referer": "https://recall.ai",
        "X-Title": "Meeting Bot"
      }
    });
  }
  return openai;
}

// Active coaching session state
let coachingSession = {
  isActive: false,
  botType: null,
  meetingId: null,
  accumulatedTranscript: [],
  lastFeedbackTime: null,
  feedbackHistory: [],
  intervalTimer: null,
  mainWindow: null
};

/**
 * Activate coaching with a specific bot type
 */
async function activateCoaching(botType, meetingId, mainWindow) {
  console.log(`Activating coaching with bot: ${botType.name} for meeting: ${meetingId}`);

  // Get global settings for interval
  const globalSettings = await botManager.getGlobalSettings();
  const intervalMs = (globalSettings.feedbackIntervalSeconds || 10) * 1000;

  // Set up session state
  coachingSession = {
    isActive: true,
    botType: botType,
    meetingId: meetingId,
    accumulatedTranscript: [],
    lastFeedbackTime: null,
    feedbackHistory: [],
    intervalTimer: null,
    mainWindow: mainWindow
  };

  // Start the interval timer
  coachingSession.intervalTimer = setInterval(() => {
    if (coachingSession.isActive) {
      generateFeedback();
    }
  }, intervalMs);

  console.log(`Coaching activated with ${intervalMs / 1000}s interval`);

  // Send status update to renderer
  sendStatusChange('listening');

  return { success: true };
}

/**
 * Deactivate coaching
 */
function deactivateCoaching() {
  console.log('Deactivating coaching');

  // Stop interval timer
  if (coachingSession.intervalTimer) {
    clearInterval(coachingSession.intervalTimer);
    coachingSession.intervalTimer = null;
  }

  // Reset session state
  coachingSession.isActive = false;
  coachingSession.botType = null;
  coachingSession.meetingId = null;
  coachingSession.accumulatedTranscript = [];
  coachingSession.feedbackHistory = [];

  // Send status update
  sendStatusChange('inactive');

  return { success: true };
}

/**
 * Append transcript entry to the accumulated transcript
 * Called by main.js when new transcript data arrives
 */
function appendTranscript(entry) {
  if (!coachingSession.isActive) return;

  coachingSession.accumulatedTranscript.push({
    text: entry.text,
    speaker: entry.speaker,
    timestamp: entry.timestamp
  });
}

/**
 * Generate AI feedback based on accumulated transcript
 */
async function generateFeedback() {
  if (!coachingSession.isActive || !coachingSession.botType) {
    return;
  }

  // Check if there's any transcript to analyze
  if (coachingSession.accumulatedTranscript.length === 0) {
    console.log('No transcript accumulated yet, skipping feedback');
    return;
  }

  console.log(`Generating feedback with ${coachingSession.accumulatedTranscript.length} transcript entries`);

  // Send status update - thinking
  sendStatusChange('thinking');

  try {
    // Build the transcript text
    const transcriptText = coachingSession.accumulatedTranscript
      .map(entry => `${entry.speaker}: ${entry.text}`)
      .join('\n');

    // Build messages for the AI
    const messages = [
      {
        role: 'system',
        content: coachingSession.botType.systemPrompt
      },
      {
        role: 'user',
        content: `Here is the recent conversation transcript. Provide brief, actionable coaching feedback (2-3 sentences max):\n\n${transcriptText}`
      }
    ];

    // Add previous feedback for context (last 2 entries)
    if (coachingSession.feedbackHistory.length > 0) {
      const recentFeedback = coachingSession.feedbackHistory.slice(-2);
      const contextText = recentFeedback.map(f => f.feedback).join('\n\n');
      messages.push({
        role: 'assistant',
        content: `Previous feedback I provided:\n${contextText}`
      });
      messages.push({
        role: 'user',
        content: 'Now provide new feedback based on the latest conversation, avoiding repetition of what you already said.'
      });
    }

    // Stream the response
    const client = getOpenAIClient();
    const stream = await client.chat.completions.create({
      model: coachingSession.botType.model,
      messages: messages,
      max_tokens: 200,
      temperature: 0.7,
      stream: true
    });

    let fullText = '';

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullText += content;
        // Send streaming chunk to renderer
        sendFeedbackChunk({ text: fullText, done: false });
      }
    }

    // Finalize the feedback
    sendFeedbackChunk({ text: fullText, done: true });

    // Store in history
    coachingSession.feedbackHistory.push({
      timestamp: new Date().toISOString(),
      transcriptContext: transcriptText,
      feedback: fullText
    });

    // Clear accumulated transcript for next interval
    coachingSession.accumulatedTranscript = [];
    coachingSession.lastFeedbackTime = Date.now();

    // Send status update - back to listening
    sendStatusChange('listening');

  } catch (error) {
    console.error('Error generating coaching feedback:', error);
    sendError(error.message);
    sendStatusChange('listening');
  }
}

/**
 * Check if coaching is currently active
 */
function isActive() {
  return coachingSession.isActive;
}

/**
 * Get current meeting ID if coaching is active
 */
function getCurrentMeetingId() {
  return coachingSession.isActive ? coachingSession.meetingId : null;
}

/**
 * Send status change to renderer
 */
function sendStatusChange(status) {
  if (coachingSession.mainWindow && !coachingSession.mainWindow.isDestroyed()) {
    coachingSession.mainWindow.webContents.send('coaching-status-change', { status });
  }
}

/**
 * Send feedback chunk to renderer
 */
function sendFeedbackChunk(data) {
  if (coachingSession.mainWindow && !coachingSession.mainWindow.isDestroyed()) {
    coachingSession.mainWindow.webContents.send('coaching-feedback-chunk', data);
  }
}

/**
 * Send error to renderer
 */
function sendError(error) {
  if (coachingSession.mainWindow && !coachingSession.mainWindow.isDestroyed()) {
    coachingSession.mainWindow.webContents.send('coaching-error', { error });
  }
}

module.exports = {
  activateCoaching,
  deactivateCoaching,
  appendTranscript,
  generateFeedback,
  isActive,
  getCurrentMeetingId
};
