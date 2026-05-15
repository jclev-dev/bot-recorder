/**
 * Summary Manager - Handles CRUD operations for summary types
 * Stores summary configurations in ~/Library/Application Support/Meeting Bot/summaryTypes.json
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// File path for summary types storage
const summaryTypesFilePath = path.join(app.getPath('userData'), 'summaryTypes.json');

// Default global settings
const DEFAULT_GLOBAL_SETTINGS = {
  defaultSummaryTypeId: null  // null means use built-in hardcoded prompt
};

/**
 * Initialize the summary types file if it doesn't exist
 */
function initializeSummaryTypesFile() {
  if (!fs.existsSync(summaryTypesFilePath)) {
    const initialData = {
      summaryTypes: [],
      globalSettings: { ...DEFAULT_GLOBAL_SETTINGS }
    };
    fs.writeFileSync(summaryTypesFilePath, JSON.stringify(initialData, null, 2));
    console.log('Created summary types file at:', summaryTypesFilePath);
  }
}

/**
 * Read summary types data from file
 */
async function readSummaryTypesData() {
  try {
    const fileData = await fs.promises.readFile(summaryTypesFilePath, 'utf8');
    return JSON.parse(fileData);
  } catch (error) {
    console.error('Error reading summary types data:', error);
    return { summaryTypes: [], globalSettings: { ...DEFAULT_GLOBAL_SETTINGS } };
  }
}

/**
 * Write summary types data to file
 */
async function writeSummaryTypesData(data) {
  try {
    await fs.promises.writeFile(summaryTypesFilePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing summary types data:', error);
    return false;
  }
}

/**
 * Generate a unique ID for summary types
 */
function generateSummaryId() {
  return `summary-${crypto.randomUUID()}`;
}

// ============= CRUD Operations =============

/**
 * Get all summary types
 */
async function getSummaryTypes() {
  const data = await readSummaryTypesData();
  return data.summaryTypes;
}

/**
 * Get a single summary type by ID
 */
async function getSummaryTypeById(typeId) {
  const data = await readSummaryTypesData();
  return data.summaryTypes.find(type => type.id === typeId) || null;
}

/**
 * Create a new summary type
 */
async function createSummaryType({ name, systemPrompt }) {
  const data = await readSummaryTypesData();

  const newType = {
    id: generateSummaryId(),
    name: name.trim(),
    systemPrompt: systemPrompt.trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  data.summaryTypes.push(newType);
  await writeSummaryTypesData(data);

  console.log('Created summary type:', newType.id, newType.name);
  return newType;
}

/**
 * Update an existing summary type
 */
async function updateSummaryType(typeId, updates) {
  const data = await readSummaryTypesData();

  const typeIndex = data.summaryTypes.findIndex(type => type.id === typeId);
  if (typeIndex === -1) {
    throw new Error(`Summary type not found: ${typeId}`);
  }

  const existingType = data.summaryTypes[typeIndex];
  const updatedType = {
    ...existingType,
    name: updates.name?.trim() ?? existingType.name,
    systemPrompt: updates.systemPrompt?.trim() ?? existingType.systemPrompt,
    updatedAt: new Date().toISOString()
  };

  data.summaryTypes[typeIndex] = updatedType;
  await writeSummaryTypesData(data);

  console.log('Updated summary type:', typeId);
  return updatedType;
}

/**
 * Delete a summary type
 */
async function deleteSummaryType(typeId) {
  const data = await readSummaryTypesData();

  const typeIndex = data.summaryTypes.findIndex(type => type.id === typeId);
  if (typeIndex === -1) {
    throw new Error(`Summary type not found: ${typeId}`);
  }

  // If this was the default, clear the default setting
  if (data.globalSettings.defaultSummaryTypeId === typeId) {
    data.globalSettings.defaultSummaryTypeId = null;
    console.log('Cleared default summary type because it was deleted');
  }

  data.summaryTypes.splice(typeIndex, 1);
  await writeSummaryTypesData(data);

  console.log('Deleted summary type:', typeId);
  return true;
}

// ============= Global Settings =============

/**
 * Get global settings for summaries
 */
async function getSummaryGlobalSettings() {
  const data = await readSummaryTypesData();
  return data.globalSettings;
}

/**
 * Update global settings for summaries
 */
async function updateSummaryGlobalSettings(updates) {
  const data = await readSummaryTypesData();

  // Allow setting to null to clear the default
  if (updates.hasOwnProperty('defaultSummaryTypeId')) {
    data.globalSettings.defaultSummaryTypeId = updates.defaultSummaryTypeId || null;
  }

  await writeSummaryTypesData(data);

  console.log('Updated summary global settings:', data.globalSettings);
  return data.globalSettings;
}

/**
 * Get the default summary type (returns the full type object or null)
 */
async function getDefaultSummaryType() {
  const data = await readSummaryTypesData();

  if (!data.globalSettings.defaultSummaryTypeId) {
    return null;
  }

  return data.summaryTypes.find(type => type.id === data.globalSettings.defaultSummaryTypeId) || null;
}

module.exports = {
  initializeSummaryTypesFile,
  getSummaryTypes,
  getSummaryTypeById,
  createSummaryType,
  updateSummaryType,
  deleteSummaryType,
  getSummaryGlobalSettings,
  updateSummaryGlobalSettings,
  getDefaultSummaryType
};
