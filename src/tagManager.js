/**
 * Tag Manager - Handles CRUD operations for meeting tags
 * Stores tag configurations in ~/Library/Application Support/Meeting Bot/tags.json
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// File path for tags storage
const tagsFilePath = path.join(app.getPath('userData'), 'tags.json');

// Predefined color palette for tags
const TAG_COLORS = [
  { id: 'indigo', hex: '#6366F1', name: 'Indigo' },
  { id: 'pink', hex: '#EC4899', name: 'Pink' },
  { id: 'emerald', hex: '#10B981', name: 'Emerald' },
  { id: 'amber', hex: '#F59E0B', name: 'Amber' },
  { id: 'violet', hex: '#8B5CF6', name: 'Violet' },
  { id: 'red', hex: '#EF4444', name: 'Red' },
  { id: 'cyan', hex: '#06B6D4', name: 'Cyan' },
  { id: 'lime', hex: '#84CC16', name: 'Lime' }
];

/**
 * Initialize the tags file if it doesn't exist
 */
function initializeTagsFile() {
  if (!fs.existsSync(tagsFilePath)) {
    const initialData = {
      tags: []
    };
    fs.writeFileSync(tagsFilePath, JSON.stringify(initialData, null, 2));
    console.log('Created tags file at:', tagsFilePath);
  }
}

/**
 * Read tags data from file
 */
async function readTagsData() {
  try {
    const fileData = await fs.promises.readFile(tagsFilePath, 'utf8');
    return JSON.parse(fileData);
  } catch (error) {
    console.error('Error reading tags data:', error);
    return { tags: [] };
  }
}

/**
 * Write tags data to file
 */
async function writeTagsData(data) {
  try {
    await fs.promises.writeFile(tagsFilePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing tags data:', error);
    return false;
  }
}

/**
 * Generate a unique ID for tags
 */
function generateTagId() {
  return `tag-${crypto.randomUUID()}`;
}

// ============= CRUD Operations =============

/**
 * Get all tags
 */
async function getTags() {
  const data = await readTagsData();
  return data.tags;
}

/**
 * Get a single tag by ID
 */
async function getTagById(tagId) {
  const data = await readTagsData();
  return data.tags.find(tag => tag.id === tagId) || null;
}

/**
 * Create a new tag
 */
async function createTag({ name, color }) {
  const data = await readTagsData();

  // Default to first color if not provided
  const tagColor = color || TAG_COLORS[0].hex;

  const newTag = {
    id: generateTagId(),
    name: name.trim(),
    color: tagColor,
    createdAt: new Date().toISOString()
  };

  data.tags.push(newTag);
  await writeTagsData(data);

  console.log('Created tag:', newTag.id, newTag.name);
  return newTag;
}

/**
 * Update an existing tag
 */
async function updateTag(tagId, updates) {
  const data = await readTagsData();

  const tagIndex = data.tags.findIndex(tag => tag.id === tagId);
  if (tagIndex === -1) {
    throw new Error(`Tag not found: ${tagId}`);
  }

  const existingTag = data.tags[tagIndex];
  const updatedTag = {
    ...existingTag,
    name: updates.name?.trim() ?? existingTag.name,
    color: updates.color ?? existingTag.color
  };

  data.tags[tagIndex] = updatedTag;
  await writeTagsData(data);

  console.log('Updated tag:', tagId);
  return updatedTag;
}

/**
 * Delete a tag
 */
async function deleteTag(tagId) {
  const data = await readTagsData();

  const tagIndex = data.tags.findIndex(tag => tag.id === tagId);
  if (tagIndex === -1) {
    throw new Error(`Tag not found: ${tagId}`);
  }

  data.tags.splice(tagIndex, 1);
  await writeTagsData(data);

  console.log('Deleted tag:', tagId);
  return true;
}

/**
 * Get available tag colors
 */
function getTagColors() {
  return TAG_COLORS;
}

module.exports = {
  initializeTagsFile,
  getTags,
  getTagById,
  createTag,
  updateTag,
  deleteTag,
  getTagColors
};
