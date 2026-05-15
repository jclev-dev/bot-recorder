/**
 * Bot Manager - Handles CRUD operations for coaching bot types
 * Stores bot configurations in ~/Library/Application Support/Meeting Bot/botTypes.json
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// File path for bot types storage
const botTypesFilePath = path.join(app.getPath('userData'), 'botTypes.json');

// Default global settings
const DEFAULT_GLOBAL_SETTINGS = {
  feedbackIntervalSeconds: 10,
  defaultModel: 'anthropic/claude-sonnet-4.5'
};

// Available models for bot configuration
const AVAILABLE_MODELS = [
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5' },
  { id: 'openai/gpt-5.2', name: 'GPT-5.2' },
  { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash' }
];

/**
 * Initialize the bot types file if it doesn't exist
 */
function initializeBotTypesFile() {
  if (!fs.existsSync(botTypesFilePath)) {
    const initialData = {
      botTypes: [],
      globalSettings: { ...DEFAULT_GLOBAL_SETTINGS }
    };
    fs.writeFileSync(botTypesFilePath, JSON.stringify(initialData, null, 2));
    console.log('Created bot types file at:', botTypesFilePath);
  }
}

/**
 * Read bot types data from file
 */
async function readBotTypesData() {
  try {
    const fileData = await fs.promises.readFile(botTypesFilePath, 'utf8');
    return JSON.parse(fileData);
  } catch (error) {
    console.error('Error reading bot types data:', error);
    return { botTypes: [], globalSettings: { ...DEFAULT_GLOBAL_SETTINGS } };
  }
}

/**
 * Write bot types data to file
 */
async function writeBotTypesData(data) {
  try {
    await fs.promises.writeFile(botTypesFilePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing bot types data:', error);
    return false;
  }
}

/**
 * Generate a unique ID for bot types
 */
function generateBotId() {
  return `bot-${crypto.randomUUID()}`;
}

// ============= CRUD Operations =============

/**
 * Get all bot types
 */
async function getBotTypes() {
  const data = await readBotTypesData();
  return data.botTypes;
}

/**
 * Get a single bot type by ID
 */
async function getBotTypeById(botId) {
  const data = await readBotTypesData();
  return data.botTypes.find(bot => bot.id === botId) || null;
}

/**
 * Create a new bot type
 */
async function createBotType({ name, systemPrompt, model }) {
  const data = await readBotTypesData();

  const newBot = {
    id: generateBotId(),
    name: name.trim(),
    systemPrompt: systemPrompt.trim(),
    model: model || data.globalSettings.defaultModel,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  data.botTypes.push(newBot);
  await writeBotTypesData(data);

  console.log('Created bot type:', newBot.id, newBot.name);
  return newBot;
}

/**
 * Update an existing bot type
 */
async function updateBotType(botId, updates) {
  const data = await readBotTypesData();

  const botIndex = data.botTypes.findIndex(bot => bot.id === botId);
  if (botIndex === -1) {
    throw new Error(`Bot type not found: ${botId}`);
  }

  const existingBot = data.botTypes[botIndex];
  const updatedBot = {
    ...existingBot,
    name: updates.name?.trim() ?? existingBot.name,
    systemPrompt: updates.systemPrompt?.trim() ?? existingBot.systemPrompt,
    model: updates.model ?? existingBot.model,
    updatedAt: new Date().toISOString()
  };

  data.botTypes[botIndex] = updatedBot;
  await writeBotTypesData(data);

  console.log('Updated bot type:', botId);
  return updatedBot;
}

/**
 * Delete a bot type
 */
async function deleteBotType(botId) {
  const data = await readBotTypesData();

  const botIndex = data.botTypes.findIndex(bot => bot.id === botId);
  if (botIndex === -1) {
    throw new Error(`Bot type not found: ${botId}`);
  }

  data.botTypes.splice(botIndex, 1);
  await writeBotTypesData(data);

  console.log('Deleted bot type:', botId);
  return true;
}

// ============= Global Settings =============

/**
 * Get global settings
 */
async function getGlobalSettings() {
  const data = await readBotTypesData();
  return data.globalSettings;
}

/**
 * Update global settings
 */
async function updateGlobalSettings(updates) {
  const data = await readBotTypesData();

  data.globalSettings = {
    ...data.globalSettings,
    feedbackIntervalSeconds: updates.feedbackIntervalSeconds ?? data.globalSettings.feedbackIntervalSeconds,
    defaultModel: updates.defaultModel ?? data.globalSettings.defaultModel
  };

  await writeBotTypesData(data);

  console.log('Updated global settings:', data.globalSettings);
  return data.globalSettings;
}

/**
 * Get available models
 */
function getAvailableModels() {
  return AVAILABLE_MODELS;
}

module.exports = {
  initializeBotTypesFile,
  getBotTypes,
  getBotTypeById,
  createBotType,
  updateBotType,
  deleteBotType,
  getGlobalSettings,
  updateGlobalSettings,
  getAvailableModels
};
