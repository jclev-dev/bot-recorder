/**
 * This file will automatically be loaded by webpack and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 */

import './index.css';
import { marked } from 'marked';

// Configure marked options for better rendering
marked.setOptions({
  breaks: true,  // Convert \n to <br>
  gfm: true      // GitHub Flavored Markdown
});

// Global preview mode state
window.isPreviewMode = false;

// Create empty meetings data structure to be filled from the file
const meetingsData = {
  upcomingMeetings: [],
  pastMeetings: []
};

// Create empty arrays that will be filled from file
const upcomingMeetings = [];
const pastMeetings = [];

// Group past meetings by date
let pastMeetingsByDate = {};

// Global recording state variables
window.isRecording = false;
window.currentRecordingId = null;

// Global coaching state variables
window.activeCoachingBot = null;
window.availableModels = [];
window.botTypes = [];

// Global summary state variables
window.summaryTypes = [];
window.selectedSummaryTypeId = null;  // Currently selected summary type for the meeting

// Global tag state variables
window.tags = [];
window.tagColors = [];
window.selectedTagFilter = null;  // null = "All Notes", otherwise tag ID

// Avatar color palette for participant initials
const AVATAR_COLORS = [
  '#6366F1', // Indigo
  '#EC4899', // Pink
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#8B5CF6', // Violet
  '#EF4444', // Red
  '#06B6D4', // Cyan
  '#84CC16', // Lime
];

/**
 * Extract initials from a participant name
 * @param {string} name - Full name like "John Doe" or "John"
 * @returns {string} Initials like "JD" or "J"
 */
function getInitials(name) {
  if (!name || typeof name !== 'string') return '?';

  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0].substring(0, 2).toUpperCase();
}

/**
 * Get a consistent color for a participant based on their ID or name
 * @param {string} identifier - Participant ID or name
 * @param {number} index - Fallback index
 * @returns {string} Hex color code
 */
function getAvatarColor(identifier, index) {
  let hash = 0;
  const str = identifier || String(index);
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/**
 * Generate HTML for avatar group
 * @param {Array} participants - Array of participant objects
 * @param {number} maxVisible - Maximum avatars to show before overflow
 * @returns {string} HTML string for avatar group
 */
function createAvatarGroup(participants, maxVisible = 3) {
  if (!participants || participants.length === 0) {
    return '';
  }

  const visibleParticipants = participants.slice(0, maxVisible);
  const overflowCount = participants.length - maxVisible;

  let avatarsHtml = visibleParticipants.map((p, index) => {
    const initials = getInitials(p.name);
    const color = getAvatarColor(p.id || p.name, index);
    return `<div class="avatar" style="background-color: ${color};" title="${p.name}">${initials}</div>`;
  }).join('');

  if (overflowCount > 0) {
    avatarsHtml += `<div class="avatar avatar-overflow" title="${overflowCount} more participants">+${overflowCount}</div>`;
  }

  return `<div class="avatar-group">${avatarsHtml}</div>`;
}


// Function to check if there's an active recording for the current note
async function checkActiveRecordingState() {
  if (!currentEditingMeetingId) return;

  try {
    console.log('Checking active recording state for note:', currentEditingMeetingId);
    const result = await window.electronAPI.getActiveRecordingId(currentEditingMeetingId);

    if (result.success && result.data) {
      console.log('Found active recording for current note:', result.data);
      updateRecordingButtonUI(true, result.data.recordingId);
    } else {
      console.log('No active recording found for note');
      updateRecordingButtonUI(false, null);
    }
  } catch (error) {
    console.error('Error checking recording state:', error);
  }
}

// Function to update the recording button UI
function updateRecordingButtonUI(isActive, recordingId) {
  const recordButton = document.getElementById('recordButton');
  if (!recordButton) return;

  // Get the elements inside the button
  const recordIcon = recordButton.querySelector('.record-icon');
  const stopIcon = recordButton.querySelector('.stop-icon');

  if (isActive) {
    // Recording is active
    console.log('Updating UI for active recording:', recordingId);
    window.isRecording = true;
    window.currentRecordingId = recordingId;

    // Update button UI
    recordButton.classList.add('recording');
    recordIcon.style.display = 'none';
    stopIcon.style.display = 'block';
  } else {
    // No active recording
    console.log('Updating UI for inactive recording');
    window.isRecording = false;
    window.currentRecordingId = null;

    // Update button UI
    recordButton.classList.remove('recording');
    recordIcon.style.display = 'block';
    stopIcon.style.display = 'none';
  }
}

// Function to format date for section headers
function formatDateHeader(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  // Check if date is today, yesterday, or earlier
  if (date.toDateString() === now.toDateString()) {
    return 'Today';
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  } else {
    // Format as "Fri, Apr 25" or similar
    const options = { weekday: 'short', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  }
}

// We'll initialize pastMeetings and pastMeetingsByDate when we load data from file

// Save meetings data back to file
async function saveMeetingsData() {
  // Save to localStorage as a backup
  localStorage.setItem('meetingsData', JSON.stringify(meetingsData));

  // Save to the actual file using IPC
  try {
    console.log('Saving meetings data to file...');
    const result = await window.electronAPI.saveMeetingsData(meetingsData);
    if (result.success) {
      console.log('Meetings data saved successfully to file');
    } else {
      console.error('Failed to save meetings data to file:', result.error);
    }
  } catch (error) {
    console.error('Error saving meetings data to file:', error);
  }
}

// Keep track of which meeting is being edited
let currentEditingMeetingId = null;

// Function to save the current note
async function saveCurrentNote() {
  const editorElement = document.getElementById('simple-editor');
  const noteTitleElement = document.getElementById('noteTitle');

  // Early exit if elements aren't available
  if (!editorElement || !noteTitleElement) {
    console.warn('Cannot save note: Editor elements not found');
    return;
  }

  // Early exit if no current meeting ID
  if (!currentEditingMeetingId) {
    console.warn('Cannot save note: No active meeting ID');
    return;
  }

  // Get title text, defaulting to "New Note" if empty
  const noteTitle = noteTitleElement.textContent.trim() || 'New Note';

  // Set title back to element in case it was empty
  if (!noteTitleElement.textContent.trim()) {
    noteTitleElement.textContent = noteTitle;
  }

  // Find which meeting is currently active by ID
  const activeMeeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === currentEditingMeetingId);

  if (activeMeeting) {
    console.log(`Saving note with ID: ${currentEditingMeetingId}, Title: ${noteTitle}`);

    // Get the current content from the editor
    const content = editorElement.value;
    console.log(`Note content length: ${content.length} characters`);

    // Update the title and content in the meeting object
    activeMeeting.title = noteTitle;
    activeMeeting.content = content;

    // Update the data arrays directly to make sure they stay in sync
    const pastIndex = meetingsData.pastMeetings.findIndex(m => m.id === currentEditingMeetingId);
    if (pastIndex !== -1) {
      meetingsData.pastMeetings[pastIndex].title = noteTitle;
      meetingsData.pastMeetings[pastIndex].content = content;
      console.log('Updated meeting in pastMeetings array');
    }

    const upcomingIndex = meetingsData.upcomingMeetings.findIndex(m => m.id === currentEditingMeetingId);
    if (upcomingIndex !== -1) {
      meetingsData.upcomingMeetings[upcomingIndex].title = noteTitle;
      meetingsData.upcomingMeetings[upcomingIndex].content = content;
      console.log('Updated meeting in upcomingMeetings array');
    }

    // Also update the subtitle if it's a date-based one
    const dateObj = new Date(activeMeeting.date);
    if (dateObj) {
      document.getElementById('noteDate').textContent = formatDate(dateObj);
    }

    try {
      // Save the data to file
      await saveMeetingsData();
      console.log('Note saved successfully:', noteTitle);
    } catch (error) {
      console.error('Error saving note:', error);
    }
  } else {
    console.error(`Cannot save note: Meeting not found with ID: ${currentEditingMeetingId}`);

    // Log all available meetings for debugging
    console.log('Available meeting IDs:', [...upcomingMeetings, ...pastMeetings].map(m => m.id).join(', '));
  }
}

// Format date for display in the note header
function formatDate(date) {
  const options = { month: 'short', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

// Simple debounce function
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}



// Function to create meeting card elements
function createMeetingCard(meeting) {
  const card = document.createElement('div');
  card.className = 'meeting-card';
  card.dataset.id = meeting.id;

  let iconHtml = '';

  if (meeting.type === 'profile') {
    iconHtml = `
      <div class="profile-pic">
        <img src="https://via.placeholder.com/40" alt="Profile">
      </div>
    `;
  } else if (meeting.type === 'calendar') {
    iconHtml = `
      <div class="meeting-icon calendar">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 4H18V2H16V4H8V2H6V4H5C3.89 4 3.01 4.9 3.01 6L3 20C3 21.1 3.89 22 5 22H19C20.1 22 21 21.1 21 20V6C21 4.9 20.1 4 19 4ZM19 20H5V10H19V20ZM19 8H5V6H19V8ZM9 14H7V12H9V14ZM13 14H11V12H13V14ZM17 14H15V12H17V14ZM9 18H7V16H9V18ZM13 18H11V16H13V18ZM17 18H15V16H17V18Z" fill="#6947BD"/>
        </svg>
      </div>
    `;
  } else if (meeting.type === 'document') {
    iconHtml = `
      <div class="meeting-icon document">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M14 2H6C4.9 2 4.01 2.9 4.01 4L4 20C4 21.1 4.89 22 5.99 22H18C19.1 22 20 21.1 20 20V8L14 2ZM16 18H8V16H16V18ZM16 14H8V12H16V14ZM13 9V3.5L18.5 9H13Z" fill="#4CAF50"/>
        </svg>
      </div>
    `;
  }

  let subtitleHtml = meeting.hasDemo
    ? `<div class="meeting-time"><a class="meeting-demo-link">${meeting.subtitle}</a></div>`
    : `<div class="meeting-time">${meeting.subtitle}</div>`;

  // Create tag chips HTML
  let tagChipsHtml = '';
  if (meeting.tagIds && meeting.tagIds.length > 0) {
    const meetingTags = window.tags.filter(t => meeting.tagIds.includes(t.id));
    tagChipsHtml = `<div class="meeting-tags">${meetingTags.map(t =>
      `<span class="tag-chip tag-chip-small" style="background-color: ${t.color}">${t.name}</span>`
    ).join('')}</div>`;
  }

  card.innerHTML = `
    ${iconHtml}
    <div class="meeting-content">
      <div class="meeting-title">${meeting.title}</div>
      ${subtitleHtml}
      ${tagChipsHtml}
    </div>
    ${createAvatarGroup(meeting.participants, 3)}
    <div class="meeting-actions">
      <button class="tag-meeting-btn" data-id="${meeting.id}" title="Add tags">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z" fill="currentColor"/>
        </svg>
      </button>
      <button class="delete-meeting-btn" data-id="${meeting.id}" title="Delete note">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/>
        </svg>
      </button>
    </div>
  `;

  return card;
}

// Function to show home view
function showHomeView() {
  document.getElementById('homeView').style.display = 'flex';
  document.getElementById('editorView').style.display = 'none';
  document.getElementById('settingsView').style.display = 'none';
  document.getElementById('backButton').style.display = 'none';
  document.getElementById('newNoteBtn').style.display = 'block';
  document.getElementById('toggleSidebar').style.display = 'none';

  // Show Record Meeting button and set its state based on meeting detection
  const joinMeetingBtn = document.getElementById('joinMeetingBtn');
  if (joinMeetingBtn) {
    // Always show the button
    joinMeetingBtn.style.display = 'block';
    joinMeetingBtn.innerHTML = 'Record Meeting';

    // Enable/disable based on meeting detection
    if (window.meetingDetected) {
      joinMeetingBtn.disabled = false;
    } else {
      joinMeetingBtn.disabled = true;
    }
  }
}

// Function to show settings view
function showSettingsView() {
  document.getElementById('homeView').style.display = 'none';
  document.getElementById('editorView').style.display = 'none';
  document.getElementById('settingsView').style.display = 'block';
  document.getElementById('backButton').style.display = 'block';
  document.getElementById('newNoteBtn').style.display = 'none';
  document.getElementById('joinMeetingBtn').style.display = 'none';
  document.getElementById('toggleSidebar').style.display = 'none';

  // Load settings data
  loadSettingsData();
}

// Function to show editor view
function showEditorView(meetingId) {
  console.log(`Showing editor view for meeting ID: ${meetingId}`);

  // Make the views visible/hidden
  document.getElementById('homeView').style.display = 'none';
  document.getElementById('editorView').style.display = 'block';
  document.getElementById('backButton').style.display = 'block';
  document.getElementById('newNoteBtn').style.display = 'none';
  document.getElementById('toggleSidebar').style.display = 'none'; // Hide the sidebar toggle

  // Always hide the join meeting button when in editor view
  const joinMeetingBtn = document.getElementById('joinMeetingBtn');
  if (joinMeetingBtn) {
    joinMeetingBtn.style.display = 'none';
  }

  // Reset preview mode when switching notes
  window.isPreviewMode = false;
  const markdownPreview = document.getElementById('markdown-preview');
  const simpleEditor = document.getElementById('simple-editor');
  const editorModeToggle = document.getElementById('editorModeToggle');

  if (markdownPreview) markdownPreview.style.display = 'none';
  if (simpleEditor) simpleEditor.style.display = 'block';
  if (editorModeToggle) {
    const previewIcon = editorModeToggle.querySelector('.preview-icon');
    const editIcon = editorModeToggle.querySelector('.edit-icon');
    const toggleLabel = editorModeToggle.querySelector('.toggle-label');
    if (previewIcon) previewIcon.style.display = 'block';
    if (editIcon) editIcon.style.display = 'none';
    if (toggleLabel) toggleLabel.textContent = 'Preview';
    editorModeToggle.classList.remove('active');
  }

  // Find the meeting in either upcoming or past meetings
  let meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);

  if (!meeting) {
    console.error(`Meeting not found: ${meetingId}`);
    return;
  }

  // Set the current editing meeting ID
  currentEditingMeetingId = meetingId;
  console.log(`Now editing meeting: ${meetingId} - ${meeting.title}`);

  // Initialize summary type selection from meeting data
  window.selectedSummaryTypeId = meeting.summaryTypeId || null;
  updateSummarySelectorLabel();

  // Set the meeting title
  document.getElementById('noteTitle').textContent = meeting.title;

  // Set the date display
  const dateObj = new Date(meeting.date);
  document.getElementById('noteDate').textContent = formatDate(dateObj);

  // Render tags in the editor
  renderEditorTags(meeting);

  // Get the editor element
  const editorElement = document.getElementById('simple-editor');

  // Important: Reset the editor content completely
  if (editorElement) {
    editorElement.value = '';
  }

  // Add a small delay to ensure the DOM has updated before setting content
  setTimeout(() => {
    if (meeting.content) {
      editorElement.value = meeting.content;
      console.log(`Loaded content for meeting: ${meetingId}, length: ${meeting.content.length} characters`);
    } else {
      // If content is missing, create template
      const now = new Date();
      const template = `# Meeting Title\n• ${meeting.title}\n\n# Meeting Date and Time\n• ${now.toLocaleString()}\n\n# Participants\n• \n\n# Description\n• \n\nChat with meeting transcript: `;
      editorElement.value = template;

      // Save this template to the meeting
      meeting.content = template;
      saveMeetingsData();
      console.log(`Created new template for meeting: ${meetingId}`);
    }

    // Set up auto-save handler for this specific note
    setupAutoSaveHandler();

    // Add event listener to the title
    setupTitleEditing();

    // Check if this note has an active recording and update the record button
    checkActiveRecordingState();

    // Show/hide AI chat button based on whether transcript exists
    const aiChatBtn = document.getElementById('openAiChatBtn');
    if (aiChatBtn) {
      if (meeting.transcript && meeting.transcript.length > 0) {
        aiChatBtn.style.display = 'flex';
      } else {
        aiChatBtn.style.display = 'none';
      }
    }

    // Update debug panel with any available data if it's open
    const debugPanel = document.getElementById('debugPanel');
    if (debugPanel && !debugPanel.classList.contains('hidden')) {
      // Update transcript if available
      if (meeting.transcript && meeting.transcript.length > 0) {
        updateDebugTranscript(meeting.transcript);
      } else {
        // Clear transcript area if no transcript
        const transcriptContent = document.getElementById('transcriptContent');
        if (transcriptContent) {
          transcriptContent.innerHTML = `
            <div class="placeholder-content">
              <p>No transcript available yet</p>
            </div>
          `;
        }
      }

      // Update participants if available
      if (meeting.participants && meeting.participants.length > 0) {
        updateDebugParticipants(meeting.participants);
      } else {
        // Clear participants area if no participants
        const participantsContent = document.getElementById('participantsContent');
        if (participantsContent) {
          participantsContent.innerHTML = `
            <div class="placeholder-content">
              <p>No participants detected yet</p>
            </div>
          `;
        }
      }

      // Show/hide transcript sidebar section based on whether transcript exists
      const transcriptSidebarSection = document.getElementById('transcriptSidebarSection');
      if (transcriptSidebarSection) {
        if (meeting.transcript && meeting.transcript.length > 0) {
          transcriptSidebarSection.style.display = 'block';
        } else {
          transcriptSidebarSection.style.display = 'none';
        }
      }

      // Transcript button is always visible (no conditional hiding)

      // Reset video preview when changing notes
      const videoContent = document.getElementById('videoContent');
      if (videoContent) {
        videoContent.innerHTML = `
          <div class="placeholder-content video-placeholder">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" fill="#999"/>
            </svg>
            <p>Video preview will appear here</p>
          </div>
        `;
      }
    }
  }, 50);
}

// Setup the title editing and save function
function setupTitleEditing() {
  const titleElement = document.getElementById('noteTitle');

  // Remove existing event listeners if any
  titleElement.removeEventListener('blur', titleBlurHandler);
  titleElement.removeEventListener('keydown', titleKeydownHandler);

  // Add event listeners
  titleElement.addEventListener('blur', titleBlurHandler);
  titleElement.addEventListener('keydown', titleKeydownHandler);
}

// Event handler for title blur
async function titleBlurHandler() {
  await saveCurrentNote();
}

// Event handler for title keydown
function titleKeydownHandler(e) {
  if (e.key === 'Enter') {
    e.preventDefault(); // Prevent new line
    e.target.blur(); // Remove focus to trigger save
  }
}

// Create a single reference to the auto-save handler to ensure we can remove it properly
let currentAutoSaveHandler = null;


// Function to set up auto-save handler
function setupAutoSaveHandler() {
  // Create a debounced auto-save handler
  const autoSaveHandler = debounce(async () => {
    console.log('Auto-saving note due to content change');
    if (currentEditingMeetingId) {
      console.log(`Auto-save triggered for meeting: ${currentEditingMeetingId}`);
      await saveCurrentNote();
    } else {
      console.warn('Cannot auto-save: No active meeting ID');
    }
  }, 1000);

  // First remove any existing handler
  if (currentAutoSaveHandler) {
    const editorElement = document.getElementById('simple-editor');
    if (editorElement) {
      console.log('Removing existing auto-save handler');
      editorElement.removeEventListener('input', currentAutoSaveHandler);
    }
  }

  // Store the reference for future cleanup
  currentAutoSaveHandler = autoSaveHandler;

  // Get the editor element and attach the new handler
  const editorElement = document.getElementById('simple-editor');
  if (editorElement) {
    editorElement.addEventListener('input', autoSaveHandler);
    console.log(`Set up editor auto-save handler for meeting: ${currentEditingMeetingId || 'none'}`);

    // Manually trigger a save once to ensure the content is saved
    setTimeout(() => {
      console.log('Triggering initial save after setup');
      editorElement.dispatchEvent(new Event('input'));
    }, 500);
  } else {
    console.warn('Editor element not found for auto-save setup');
  }
}

// Function to create a new meeting
async function createNewMeeting() {
  console.log('Creating new note...');

  // Save any existing note before creating a new one
  if (currentEditingMeetingId) {
    await saveCurrentNote();
    console.log('Saved current note before creating new one');
  }

  // Reset the current editing ID to ensure we start fresh
  currentEditingMeetingId = null;

  // Generate a unique ID
  const id = 'meeting-' + Date.now();
  console.log('Generated new meeting ID:', id);

  // Current date and time
  const now = new Date();

  // Generate the template for the content
  const template = `# Meeting Title\n• New Note\n\n# Meeting Date and Time\n• ${now.toLocaleString()}\n\n# Participants\n• \n\n# Description\n• \n\nChat with meeting transcript: `;

  // Create a new meeting object - ensure it's of type document
  const newMeeting = {
    id: id,
    type: 'document', // Explicitly set as document type, not calendar
    title: 'New Note',
    subtitle: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    hasDemo: false,
    date: now.toISOString(),
    participants: [],
    content: template // Set the content directly
  };

  // Log what we're adding
  console.log(`Adding new meeting: id=${id}, title=${newMeeting.title}, content.length=${template.length}`);

  // Add to pastMeetings - make sure to push to both arrays
  pastMeetings.unshift(newMeeting);
  meetingsData.pastMeetings.unshift(newMeeting);

  // Update the grouped meetings
  const dateKey = formatDateHeader(newMeeting.date);
  if (!pastMeetingsByDate[dateKey]) {
    pastMeetingsByDate[dateKey] = [];
  }
  pastMeetingsByDate[dateKey].unshift(newMeeting);

  // Save the data to file
  try {
    await saveMeetingsData();
    console.log('New meeting created and saved:', newMeeting.title);
  } catch (error) {
    console.error('Error saving new meeting:', error);
  }

  // Set current editing ID to the new meeting ID BEFORE showing the editor
  currentEditingMeetingId = id;
  console.log('Set currentEditingMeetingId to:', id);

  // Force a reset of the editor before showing the new meeting
  const editorElement = document.getElementById('simple-editor');
  if (editorElement) {
    editorElement.value = '';
  }

  // Now show the editor view with the new meeting
  showEditorView(id);

  // Automatically start recording for the new note
  try {
    console.log('Auto-starting recording for new note');
    // Start manual recording for the new note
    window.electronAPI.startManualRecording(id)
      .then(result => {
        if (result.success) {
          console.log('Auto-started recording for new note with ID:', result.recordingId);
          // Update recording button UI
          window.isRecording = true;
          window.currentRecordingId = result.recordingId;

          // Update recording button UI
          const recordButton = document.getElementById('recordButton');
          if (recordButton) {
            const recordIcon = recordButton.querySelector('.record-icon');
            const stopIcon = recordButton.querySelector('.stop-icon');

            recordButton.classList.add('recording');
            recordIcon.style.display = 'none';
            stopIcon.style.display = 'block';
          }
        } else {
          console.error('Failed to auto-start recording:', result.error);
        }
      })
      .catch(error => {
        console.error('Error auto-starting recording:', error);
      });
  } catch (error) {
    console.error('Exception auto-starting recording:', error);
  }

  return id;
}

// Function to render meetings to the page
function renderMeetings() {
  // Clear previous content
  const mainContent = document.querySelector('.main-content .content-container');
  mainContent.innerHTML = '';

  // Create all notes section (replaces both upcoming and date-grouped sections)
  const notesSection = document.createElement('section');
  notesSection.className = 'meetings-section';
  notesSection.innerHTML = `
    <h2 class="section-title">Notes</h2>
    <div class="meetings-list" id="notes-list"></div>
  `;
  mainContent.appendChild(notesSection);

  // Get the notes container
  const notesContainer = notesSection.querySelector('#notes-list');

  // Add all meetings to the notes section (both upcoming and past)
  const allMeetings = [...upcomingMeetings, ...pastMeetings];

  // Sort by date, newest first
  allMeetings.sort((a, b) => {
    return new Date(b.date) - new Date(a.date);
  });

  // Filter out calendar entries
  let filteredMeetings = allMeetings.filter(meeting => meeting.type !== 'calendar');

  // Update all notes count in sidebar
  const allNotesCount = document.getElementById('allNotesCount');
  if (allNotesCount) {
    allNotesCount.textContent = filteredMeetings.length;
  }

  // Apply tag filter if selected
  if (window.selectedTagFilter) {
    filteredMeetings = filteredMeetings.filter(meeting =>
      meeting.tagIds && meeting.tagIds.includes(window.selectedTagFilter)
    );
  }

  // Add filtered meetings to the container
  filteredMeetings.forEach(meeting => {
    notesContainer.appendChild(createMeetingCard(meeting));
  });

  // Update tag counts in sidebar
  updateTagCounts();
}

// ============= Tag Management Functions =============

// Load tags from backend
async function loadTags() {
  try {
    const result = await window.electronAPI.getTags();
    if (result.success) {
      window.tags = result.data;
      renderTagsSidebar();
    }
  } catch (error) {
    console.error('Error loading tags:', error);
  }
}

// Load tag colors from backend
async function loadTagColors() {
  try {
    const result = await window.electronAPI.getTagColors();
    if (result.success) {
      window.tagColors = result.data;
    }
  } catch (error) {
    console.error('Error loading tag colors:', error);
  }
}

// Render tags in the sidebar
function renderTagsSidebar() {
  const tagsList = document.getElementById('tagsList');
  if (!tagsList) return;

  tagsList.innerHTML = '';

  window.tags.forEach(tag => {
    const tagItem = document.createElement('div');
    tagItem.className = `tag-filter-item ${window.selectedTagFilter === tag.id ? 'selected' : ''}`;
    tagItem.dataset.tagId = tag.id;

    tagItem.innerHTML = `
      <span class="tag-color-dot" style="background-color: ${tag.color}"></span>
      <span class="tag-name">${tag.name}</span>
      <span class="tag-count" data-tag-id="${tag.id}">0</span>
      <button class="tag-edit-btn" data-tag-id="${tag.id}" title="Edit tag">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/>
        </svg>
      </button>
    `;

    tagsList.appendChild(tagItem);
  });

  // Update tag counts after rendering
  updateTagCounts();

  // Update selected state for "All Notes"
  updateTagsSidebarSelection();
}

// Update tag counts in sidebar
function updateTagCounts() {
  const allMeetings = [...upcomingMeetings, ...pastMeetings].filter(m => m.type !== 'calendar');

  window.tags.forEach(tag => {
    const count = allMeetings.filter(m => m.tagIds && m.tagIds.includes(tag.id)).length;
    const countEl = document.querySelector(`.tag-count[data-tag-id="${tag.id}"]`);
    if (countEl) {
      countEl.textContent = count;
    }
  });
}

// Update sidebar selection state
function updateTagsSidebarSelection() {
  const allItems = document.querySelectorAll('.tag-filter-item');
  allItems.forEach(item => {
    const tagId = item.dataset.tagId;
    if (tagId === '' && !window.selectedTagFilter) {
      item.classList.add('selected');
    } else if (tagId === window.selectedTagFilter) {
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  });
}

// Filter meetings by tag
function filterMeetingsByTag(tagId) {
  window.selectedTagFilter = tagId || null;
  renderMeetings();
  updateTagsSidebarSelection();
}

// Open tag editor modal
function openTagEditorModal(tagId = null) {
  const modal = document.getElementById('tagEditorModal');
  const title = document.getElementById('tagEditorTitle');
  const nameInput = document.getElementById('tagNameInput');
  const editIdInput = document.getElementById('tagEditId');
  const colorInput = document.getElementById('selectedTagColor');
  const deleteBtn = document.getElementById('deleteTagBtn');
  const colorPicker = document.getElementById('tagColorPicker');

  // Reset form
  nameInput.value = '';
  editIdInput.value = '';
  colorInput.value = window.tagColors[0]?.hex || '#6366F1';

  // Render color picker
  colorPicker.innerHTML = window.tagColors.map(c => `
    <div class="color-option ${c.hex === colorInput.value ? 'selected' : ''}"
         style="background-color: ${c.hex}"
         data-color="${c.hex}"
         title="${c.name}"></div>
  `).join('');

  if (tagId) {
    // Edit mode
    const tag = window.tags.find(t => t.id === tagId);
    if (tag) {
      title.textContent = 'Edit Tag';
      nameInput.value = tag.name;
      editIdInput.value = tag.id;
      colorInput.value = tag.color;
      deleteBtn.style.display = 'block';

      // Update selected color
      colorPicker.querySelectorAll('.color-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.color === tag.color);
      });
    }
  } else {
    // Create mode
    title.textContent = 'Create New Tag';
    deleteBtn.style.display = 'none';
  }

  modal.style.display = 'flex';
  nameInput.focus();
}

// Close tag editor modal
function closeTagEditorModal() {
  document.getElementById('tagEditorModal').style.display = 'none';
}

// Save tag (create or update)
async function saveTag() {
  const nameInput = document.getElementById('tagNameInput');
  const editIdInput = document.getElementById('tagEditId');
  const colorInput = document.getElementById('selectedTagColor');

  const name = nameInput.value.trim();
  const color = colorInput.value;
  const tagId = editIdInput.value;

  if (!name) {
    nameInput.focus();
    return;
  }

  try {
    if (tagId) {
      // Update existing tag
      await window.electronAPI.updateTag(tagId, { name, color });
    } else {
      // Create new tag
      await window.electronAPI.createTag({ name, color });
    }

    closeTagEditorModal();
    await loadTags();
    renderMeetings();
  } catch (error) {
    console.error('Error saving tag:', error);
  }
}

// Delete tag
async function deleteTag(tagId) {
  if (!confirm('Are you sure you want to delete this tag? It will be removed from all meetings.')) {
    return;
  }

  try {
    await window.electronAPI.deleteTag(tagId);
    closeTagEditorModal();

    // If we're filtering by this tag, clear the filter
    if (window.selectedTagFilter === tagId) {
      window.selectedTagFilter = null;
    }

    await loadTags();
    await loadMeetingsDataFromFile(); // Reload meetings to get updated tagIds
    renderMeetings();
  } catch (error) {
    console.error('Error deleting tag:', error);
  }
}

// Open tag picker dropdown for a meeting
function openTagPicker(meetingId, buttonElement) {
  const dropdown = document.getElementById('tagPickerDropdown');
  const list = document.getElementById('tagPickerList');

  // Get meeting's current tags
  const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);
  const meetingTagIds = meeting?.tagIds || [];

  // Render tag options with checkboxes
  list.innerHTML = window.tags.map(tag => `
    <div class="tag-picker-item" data-tag-id="${tag.id}" data-meeting-id="${meetingId}">
      <input type="checkbox" ${meetingTagIds.includes(tag.id) ? 'checked' : ''}>
      <span class="tag-color-dot" style="background-color: ${tag.color}"></span>
      <span class="tag-name">${tag.name}</span>
    </div>
  `).join('');

  if (window.tags.length === 0) {
    list.innerHTML = '<div style="padding: 12px; color: #666; text-align: center;">No tags yet. Create one!</div>';
  }

  // Position dropdown near the button
  const rect = buttonElement.getBoundingClientRect();
  dropdown.style.top = `${rect.bottom + 4}px`;
  dropdown.style.left = `${Math.max(10, rect.left - 100)}px`;
  dropdown.dataset.meetingId = meetingId;
  dropdown.style.display = 'block';
}

// Close tag picker dropdown
function closeTagPicker() {
  document.getElementById('tagPickerDropdown').style.display = 'none';
}

// Toggle tag on meeting
async function toggleMeetingTag(meetingId, tagId, isChecked) {
  try {
    if (isChecked) {
      await window.electronAPI.addTagToMeeting(meetingId, tagId);
    } else {
      await window.electronAPI.removeTagFromMeeting(meetingId, tagId);
    }

    // Update local state
    const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);
    if (meeting) {
      if (!meeting.tagIds) meeting.tagIds = [];
      if (isChecked && !meeting.tagIds.includes(tagId)) {
        meeting.tagIds.push(tagId);
      } else if (!isChecked) {
        meeting.tagIds = meeting.tagIds.filter(id => id !== tagId);
      }
    }

    // Update counts
    updateTagCounts();

    // If we're in editor view for this meeting, update the editor tags
    if (currentEditingMeetingId === meetingId && meeting) {
      renderEditorTags(meeting);
    }
  } catch (error) {
    console.error('Error toggling meeting tag:', error);
  }
}

// Render tags in the note editor view
function renderEditorTags(meeting) {
  const container = document.getElementById('noteTagsList');
  if (!container) return;

  container.innerHTML = '';

  if (meeting.tagIds && meeting.tagIds.length > 0) {
    const meetingTags = window.tags.filter(t => meeting.tagIds.includes(t.id));
    meetingTags.forEach(tag => {
      const chip = document.createElement('span');
      chip.className = 'note-tag-chip';
      chip.style.backgroundColor = tag.color;
      chip.dataset.tagId = tag.id;
      chip.innerHTML = `
        ${tag.name}
        <button class="remove-tag" title="Remove tag">&times;</button>
      `;
      container.appendChild(chip);
    });
  }
}

// Open tag picker for editor view
function openEditorTagPicker(buttonElement) {
  if (!currentEditingMeetingId) return;

  const dropdown = document.getElementById('tagPickerDropdown');
  const list = document.getElementById('tagPickerList');

  // Get meeting's current tags
  const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === currentEditingMeetingId);
  const meetingTagIds = meeting?.tagIds || [];

  // Render tag options with checkboxes
  list.innerHTML = window.tags.map(tag => `
    <div class="tag-picker-item" data-tag-id="${tag.id}" data-meeting-id="${currentEditingMeetingId}">
      <input type="checkbox" ${meetingTagIds.includes(tag.id) ? 'checked' : ''}>
      <span class="tag-color-dot" style="background-color: ${tag.color}"></span>
      <span class="tag-name">${tag.name}</span>
    </div>
  `).join('');

  if (window.tags.length === 0) {
    list.innerHTML = '<div style="padding: 12px; color: #666; text-align: center;">No tags yet. Create one!</div>';
  }

  // Position dropdown near the button
  const rect = buttonElement.getBoundingClientRect();
  dropdown.style.top = `${rect.bottom + 4}px`;
  dropdown.style.left = `${rect.left}px`;
  dropdown.dataset.meetingId = currentEditingMeetingId;
  dropdown.dataset.fromEditor = 'true';
  dropdown.style.display = 'block';
}

// Remove tag from current meeting in editor
async function removeTagFromEditor(tagId) {
  if (!currentEditingMeetingId) return;

  try {
    await window.electronAPI.removeTagFromMeeting(currentEditingMeetingId, tagId);

    // Update local state
    const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === currentEditingMeetingId);
    if (meeting && meeting.tagIds) {
      meeting.tagIds = meeting.tagIds.filter(id => id !== tagId);
    }

    // Re-render editor tags
    renderEditorTags(meeting);
    updateTagCounts();
  } catch (error) {
    console.error('Error removing tag from editor:', error);
  }
}

// Initialize tag event listeners
function initTagEventListeners() {
  // Add tag button
  document.getElementById('addTagBtn')?.addEventListener('click', () => {
    openTagEditorModal();
  });

  // Tag sidebar click (filter + edit)
  document.getElementById('tagsSidebar')?.addEventListener('click', (e) => {
    // Check for edit button click
    const editBtn = e.target.closest('.tag-edit-btn');
    if (editBtn) {
      e.stopPropagation();
      openTagEditorModal(editBtn.dataset.tagId);
      return;
    }

    // Check for filter item click
    const filterItem = e.target.closest('.tag-filter-item');
    if (filterItem) {
      const tagId = filterItem.dataset.tagId;
      filterMeetingsByTag(tagId || null);
    }
  });

  // Tag editor modal
  document.getElementById('closeTagEditorModal')?.addEventListener('click', closeTagEditorModal);
  document.getElementById('cancelTagEditor')?.addEventListener('click', closeTagEditorModal);

  document.getElementById('tagEditorForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveTag();
  });

  document.getElementById('deleteTagBtn')?.addEventListener('click', () => {
    const tagId = document.getElementById('tagEditId').value;
    if (tagId) deleteTag(tagId);
  });

  // Color picker in modal
  document.getElementById('tagColorPicker')?.addEventListener('click', (e) => {
    const colorOption = e.target.closest('.color-option');
    if (colorOption) {
      document.querySelectorAll('#tagColorPicker .color-option').forEach(opt => opt.classList.remove('selected'));
      colorOption.classList.add('selected');
      document.getElementById('selectedTagColor').value = colorOption.dataset.color;
    }
  });

  // Tag picker dropdown
  document.getElementById('tagPickerList')?.addEventListener('click', (e) => {
    const item = e.target.closest('.tag-picker-item');
    if (item) {
      const checkbox = item.querySelector('input[type="checkbox"]');
      // Toggle if clicking the row (not directly on checkbox)
      if (e.target !== checkbox) {
        checkbox.checked = !checkbox.checked;
      }
      toggleMeetingTag(item.dataset.meetingId, item.dataset.tagId, checkbox.checked);
    }
  });

  document.getElementById('createTagQuickBtn')?.addEventListener('click', () => {
    closeTagPicker();
    openTagEditorModal();
  });

  // Close tag picker when clicking outside
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('tagPickerDropdown');
    if (dropdown.style.display === 'block') {
      if (!e.target.closest('#tagPickerDropdown') && !e.target.closest('.tag-meeting-btn') && !e.target.closest('.add-note-tag-btn')) {
        closeTagPicker();
      }
    }
  });

  // Close modal when clicking overlay
  document.getElementById('tagEditorModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'tagEditorModal') {
      closeTagEditorModal();
    }
  });

  // Editor view: Add tag button
  document.getElementById('addNoteTagBtn')?.addEventListener('click', (e) => {
    openEditorTagPicker(e.target);
  });

  // Editor view: Remove tag button
  document.getElementById('noteTagsList')?.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.remove-tag');
    if (removeBtn) {
      const chip = removeBtn.closest('.note-tag-chip');
      if (chip) {
        removeTagFromEditor(chip.dataset.tagId);
      }
    }
  });
}

// Load meetings data from file
async function loadMeetingsDataFromFile() {
  console.log("Loading meetings data from file...");
  try {
    const result = await window.electronAPI.loadMeetingsData();
    console.log("Load result success:", result.success);

    if (result.success) {
      console.log(`Got data with ${result.data.pastMeetings?.length || 0} past meetings`);
      if (result.data.pastMeetings && result.data.pastMeetings.length > 0) {
        console.log("Most recent meeting:", result.data.pastMeetings[0].id, result.data.pastMeetings[0].title);
      }

      // Initialize arrays if they don't exist in the loaded data
      if (!result.data.upcomingMeetings) {
        result.data.upcomingMeetings = [];
      }

      if (!result.data.pastMeetings) {
        result.data.pastMeetings = [];
      }

      // Update the meetings data objects
      Object.assign(meetingsData, result.data);

      // Clear and reassign the references
      upcomingMeetings.length = 0;
      pastMeetings.length = 0;

      console.log("Before updating arrays, pastMeetings count:", pastMeetings.length);

      // Filter out calendar entries when loading data
      meetingsData.upcomingMeetings
        .filter(meeting => meeting.type !== 'calendar')
        .forEach(meeting => upcomingMeetings.push(meeting));

      meetingsData.pastMeetings
        .filter(meeting => meeting.type !== 'calendar')
        .forEach(meeting => pastMeetings.push(meeting));

      console.log("After updating arrays, pastMeetings count:", pastMeetings.length);
      if (pastMeetings.length > 0) {
        console.log("First past meeting:", pastMeetings[0].id, pastMeetings[0].title);
      }

      // Regroup past meetings by date
      pastMeetingsByDate = {};
      meetingsData.pastMeetings.forEach(meeting => {
        const dateKey = formatDateHeader(meeting.date);
        if (!pastMeetingsByDate[dateKey]) {
          pastMeetingsByDate[dateKey] = [];
        }
        pastMeetingsByDate[dateKey].push(meeting);
      });

      console.log('Meetings data loaded from file');

      // Re-render the meetings
      renderMeetings();
    } else {
      console.error('Failed to load meetings data from file:', result.error);
    }
  } catch (error) {
    console.error('Error loading meetings data from file:', error);
  }
}

// Function to update the transcript section in the debug panel
function updateDebugTranscript(transcript) {
  const transcriptContent = document.getElementById('transcriptContent');
  if (!transcriptContent) return;

  // Check if user was at bottom before clearing content
  const wasAtBottom = transcriptContent.scrollTop + transcriptContent.clientHeight >= transcriptContent.scrollHeight - 5;

  // Clear previous content
  transcriptContent.innerHTML = '';

  if (!transcript || transcript.length === 0) {
    // Show placeholder if no transcript is available
    transcriptContent.innerHTML = `
      <div class="placeholder-content">
        <p>No transcript available yet</p>
      </div>
    `;
    return;
  }

  // Create transcript entries
  const transcriptDiv = document.createElement('div');
  transcriptDiv.className = 'transcript-entries';

  // Add each transcript entry
  transcript.forEach((entry, index) => {
    const entryDiv = document.createElement('div');
    entryDiv.className = 'transcript-entry';

    // Format timestamp
    const timestamp = new Date(entry.timestamp);
    const formattedTime = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Create HTML for this entry
    entryDiv.innerHTML = `
      <div class="transcript-speaker">${entry.speaker || 'Unknown'}</div>
      <div class="transcript-text">${entry.text}</div>
      <div class="transcript-timestamp">${formattedTime}</div>
    `;

    // Add a highlight class for the newest entry
    if (index === transcript.length - 1) {
      entryDiv.classList.add('newest-entry');
    }

    transcriptDiv.appendChild(entryDiv);
  });

  transcriptContent.appendChild(transcriptDiv);

  // Only auto-scroll to bottom if user was at the bottom before the update
  if (wasAtBottom) {
    // Use setTimeout to ensure DOM has updated
    setTimeout(() => {
      transcriptContent.scrollTop = transcriptContent.scrollHeight;
    }, 0);
  }
}

// Function to update the video preview in the debug panel
function updateDebugVideoPreview(frameData) {
  // Get the image data from the frame
  const { buffer, participantId, participantName, frameType } = frameData;

  // Determine if this is a screenshare or participant video
  const isScreenshare = frameType !== 'webcam';

  if (isScreenshare) {
    updateScreensharePreview(frameData);
  } else {
    updateParticipantVideoPreview(frameData);
  }

  // Make sure debug panel toggle shows new content notification if panel is closed
  const debugPanel = document.getElementById('debugPanel');
  if (debugPanel && debugPanel.classList.contains('hidden')) {
    const debugPanelToggle = document.getElementById('debugPanelToggle');
    if (debugPanelToggle && !debugPanelToggle.classList.contains('has-new-content')) {
      debugPanelToggle.classList.add('has-new-content');
    }
  }
}

// Function to update participant video preview
function updateParticipantVideoPreview(frameData) {
  const videoContent = document.getElementById('videoContent');
  if (!videoContent) return;

  const { buffer, participantId, participantName, frameType } = frameData;

  // Check if we already have a container for this participant
  let participantVideoContainer = document.getElementById(`video-participant-${participantId}`);

  // If no container exists, create one
  if (!participantVideoContainer) {
    // Clear the placeholder content if this is the first frame
    if (videoContent.querySelector('.placeholder-content')) {
      videoContent.innerHTML = '';
    }

    // Create a container for this participant's video
    participantVideoContainer = document.createElement('div');
    participantVideoContainer.id = `video-participant-${participantId}`;
    participantVideoContainer.className = 'video-participant-container';

    // Add the name label
    const nameLabel = document.createElement('div');
    nameLabel.className = 'video-participant-name';
    nameLabel.textContent = participantName;
    participantVideoContainer.appendChild(nameLabel);

    // Create an image element for the video frame
    const videoImg = document.createElement('img');
    videoImg.className = 'video-frame';
    videoImg.id = `video-frame-${participantId}`;
    participantVideoContainer.appendChild(videoImg);

    // Add the frame type label
    const typeLabel = document.createElement('div');
    typeLabel.className = 'video-frame-type';
    typeLabel.textContent = 'Camera';
    participantVideoContainer.appendChild(typeLabel);

    // Add to the video content area
    videoContent.appendChild(participantVideoContainer);
  }

  // Update the image with the new frame
  const videoImg = document.getElementById(`video-frame-${participantId}`);
  if (videoImg) {
    videoImg.src = `data:image/png;base64,${buffer}`;
  }
}

// Function to update screenshare preview
function updateScreensharePreview(frameData) {
  const screenshareContent = document.getElementById('screenshareContent');
  if (!screenshareContent) return;

  const { buffer, participantId, participantName, frameType } = frameData;

  // Check if we already have a container for this screenshare
  let screenshareContainer = document.getElementById(`screenshare-participant-${participantId}`);

  // If no container exists, create one
  if (!screenshareContainer) {
    // Clear the placeholder content if this is the first frame
    if (screenshareContent.querySelector('.placeholder-content')) {
      screenshareContent.innerHTML = '';
    }

    // Create a container for this participant's screenshare
    screenshareContainer = document.createElement('div');
    screenshareContainer.id = `screenshare-participant-${participantId}`;
    screenshareContainer.className = 'video-participant-container';

    // Create an image element for the screenshare frame
    const screenshareImg = document.createElement('img');
    screenshareImg.className = 'video-frame';
    screenshareImg.id = `screenshare-frame-${participantId}`;
    screenshareContainer.appendChild(screenshareImg);

    // Add the frame type label
    const typeLabel = document.createElement('div');
    typeLabel.className = 'video-frame-type';
    typeLabel.textContent = 'Screen';
    screenshareContainer.appendChild(typeLabel);

    // Add to the screenshare content area
    screenshareContent.appendChild(screenshareContainer);
  }

  // Update the image with the new frame
  const screenshareImg = document.getElementById(`screenshare-frame-${participantId}`);
  if (screenshareImg) {
    screenshareImg.src = `data:image/png;base64,${buffer}`;
  }
}

// Function to update the participants section in the debug panel
function updateDebugParticipants(participants) {
  const participantsContent = document.getElementById('participantsContent');
  if (!participantsContent) return;

  // Clear previous content
  participantsContent.innerHTML = '';

  if (!participants || participants.length === 0) {
    // Show placeholder if no participants are available
    participantsContent.innerHTML = `
      <div class="placeholder-content">
        <p>No participants detected yet</p>
      </div>
    `;
    return;
  }

  // Create participants list
  const participantsList = document.createElement('div');
  participantsList.className = 'participants-list';

  // Add each participant
  participants.forEach(participant => {
    const participantDiv = document.createElement('div');
    participantDiv.className = 'participant-entry';

    participantDiv.innerHTML = `
      <div class="participant-avatar">
        <svg width="24" height="24" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="40" height="40" rx="20" fill="#f0f0f0"/>
          <path d="M20 20C22.7614 20 25 17.7614 25 15C25 12.2386 22.7614 10 20 10C17.2386 10 15 12.2386 15 15C15 17.7614 17.2386 20 20 20Z" fill="#a0a0a0"/>
          <path d="M12 31C12 26.0294 15.5817 22 20 22C24.4183 22 28 26.0294 28 31" stroke="#a0a0a0" stroke-width="4"/>
        </svg>
      </div>
      <div class="participant-name">${participant.name || 'Unknown'}</div>
      <div class="participant-status">${participant.status || 'Active'}</div>
    `;

    participantsList.appendChild(participantDiv);
  });

  participantsContent.appendChild(participantsList);
}

// Function to initialize the debug panel
function initDebugPanel() {
  const debugPanelToggle = document.getElementById('debugPanelToggle');
  const debugPanel = document.getElementById('debugPanel');
  const closeDebugPanelBtn = document.getElementById('closeDebugPanelBtn');

  // Set up toggle button for the debug panel
  if (debugPanelToggle && debugPanel) {
    debugPanelToggle.addEventListener('click', () => {
      // Toggle the debug panel visibility
      if (debugPanel.classList.contains('hidden')) {
        debugPanel.classList.remove('hidden');
        document.querySelector('.app-container').classList.add('debug-panel-open');

        // Update the toggle button position and remove any notification indicators
        debugPanelToggle.style.right = '50%';
        debugPanelToggle.classList.remove('has-new-content');
        debugPanelToggle.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M7.99 11H20v2H7.99v3L4 12l3.99-4v3z" fill="currentColor"/>
          </svg>
        `;

        // If there's an active meeting, refresh the debug panels with latest data
        if (currentEditingMeetingId) {
          const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === currentEditingMeetingId);
          if (meeting) {
            // Update transcript if available
            if (meeting.transcript && meeting.transcript.length > 0) {
              updateDebugTranscript(meeting.transcript);
            } else {
              // Clear transcript area if no transcript
              const transcriptContent = document.getElementById('transcriptContent');
              if (transcriptContent) {
                transcriptContent.innerHTML = `
                  <div class="placeholder-content">
                    <p>No transcript available yet</p>
                  </div>
                `;
              }
            }

            // Update participants if available
            if (meeting.participants && meeting.participants.length > 0) {
              updateDebugParticipants(meeting.participants);
            } else {
              // Clear participants area if no participants
              const participantsContent = document.getElementById('participantsContent');
              if (participantsContent) {
                participantsContent.innerHTML = `
                  <div class="placeholder-content">
                    <p>No participants detected yet</p>
                  </div>
                `;
              }
            }

            // Reset video preview when opening debug panel
            const videoContent = document.getElementById('videoContent');
            if (videoContent) {
              videoContent.innerHTML = `
                <div class="placeholder-content video-placeholder">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" fill="#999"/>
                  </svg>
                  <p>Video preview will appear here</p>
                </div>
              `;
            }
          }
        }
      } else {
        debugPanel.classList.add('hidden');
        document.querySelector('.app-container').classList.remove('debug-panel-open');

        // Reset the toggle button position
        debugPanelToggle.style.right = '0';
        debugPanelToggle.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 8h-2.81c-.45-.78-1.07-1.45-1.82-1.96L17 4.41 15.59 3l-2.17 2.17C12.96 5.06 12.49 5 12 5c-.49 0-.96.06-1.41.17L8.41 3 7 4.41l1.62 1.63C7.88 6.55 7.26 7.22 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81c1.04 1.79 2.97 3 5.19 3s4.15-1.21 5.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 8h-4v-2h4v2zm0-4h-4v-2h4v2z" fill="currentColor"/>
          </svg>
        `;
      }
    });
  }

  // Set up close button for the debug panel
  if (closeDebugPanelBtn && debugPanel) {
    closeDebugPanelBtn.addEventListener('click', () => {
      debugPanel.classList.add('hidden');
      // Restore the editorView to full width
      document.querySelector('.app-container').classList.remove('debug-panel-open');

      // Reset the toggle button position and icon
      const debugPanelToggle = document.getElementById('debugPanelToggle');
      if (debugPanelToggle) {
        debugPanelToggle.style.right = '0';
        debugPanelToggle.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 8h-2.81c-.45-.78-1.07-1.45-1.82-1.96L17 4.41 15.59 3l-2.17 2.17C12.96 5.06 12.49 5 12 5c-.49 0-.96.06-1.41.17L8.41 3 7 4.41l1.62 1.63C7.88 6.55 7.26 7.22 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81c1.04 1.79 2.97 3 5.19 3s4.15-1.21 5.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 8h-4v-2h4v2zm0-4h-4v-2h4v2z" fill="currentColor"/>
          </svg>
        `;
      }
    });
  }

  // Set up clear button for the logger section
  const clearLoggerBtn = document.getElementById('clearLoggerBtn');
  if (clearLoggerBtn) {
    clearLoggerBtn.addEventListener('click', () => {
      sdkLogger.clear();
    });
  }
}

// SDK Logger functions
const sdkLogger = {
  logs: [],
  maxLogs: 100,

  // Initialize the logger
  init() {
    // Listen for logs from the main process
    window.sdkLoggerBridge?.onSdkLog(logEntry => {
      // Add an origin flag to logs created in this renderer to prevent duplicates
      if (!logEntry.originatedFromRenderer) {
        this.addLogEntry(logEntry);
      }
    });

    // Log initialization
    this.log('SDK Logger initialized', 'info');
  },

  // Log an API call
  logApiCall(method, params = {}) {
    const logEntry = {
      type: 'api-call',
      method,
      params,
      timestamp: new Date()
    };

    // Send to main process
    this._sendToMainProcess(logEntry);

    // Add to local logs
    this.addLogEntry(logEntry);
  },

  // Log an event
  logEvent(eventType, data = {}) {
    const logEntry = {
      type: 'event',
      eventType,
      data,
      timestamp: new Date()
    };

    // Send to main process
    this._sendToMainProcess(logEntry);

    // Add to local logs
    this.addLogEntry(logEntry);
  },

  // Log an error
  logError(errorType, message) {
    const logEntry = {
      type: 'error',
      errorType,
      message,
      timestamp: new Date()
    };

    // Send to main process
    this._sendToMainProcess(logEntry);

    // Add to local logs
    this.addLogEntry(logEntry);
  },

  // Log a generic message
  log(message, level = 'info') {
    const logEntry = {
      type: level,
      message,
      timestamp: new Date()
    };

    // Send to main process
    this._sendToMainProcess(logEntry);

    // Add to local logs
    this.addLogEntry(logEntry);
  },

  // Helper to send logs to main process
  _sendToMainProcess(logEntry) {
    if (window.sdkLoggerBridge?.sendSdkLog) {
      // Mark this log entry as originating from this renderer to prevent duplicates
      const markedLogEntry = { ...logEntry, originatedFromRenderer: true };
      window.sdkLoggerBridge.sendSdkLog(markedLogEntry);
    }
  },

  // Add a log entry to the UI and internal array
  addLogEntry(entry) {
    // Add to internal logs array
    this.logs.push(entry);

    // Trim logs if we have too many
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Add to UI
    const loggerContent = document.getElementById('sdkLoggerContent');
    if (loggerContent) {
      const logElement = document.createElement('div');
      logElement.className = `sdk-log-entry ${entry.type}`;

      const timestamp = document.createElement('div');
      timestamp.className = 'timestamp';
      timestamp.textContent = this.formatTimestamp(entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp));
      logElement.appendChild(timestamp);

      // Format content based on log type
      let content = '';

      switch (entry.type) {
        case 'api-call':
          content = `<span class="method">RecallAiSdk.${entry.method}()</span>`;
          if (entry.params && Object.keys(entry.params).length > 0) {
            content += `<div class="params">${this.formatParams(entry.params)}</div>`;
          }
          break;

        case 'event':
          content = `<span class="event-type">Event: ${entry.eventType}</span>`;
          if (entry.data && Object.keys(entry.data).length > 0) {
            content += `<div class="params">${this.formatParams(entry.data)}</div>`;
          }
          break;

        case 'error':
          content = `<span class="error-type">Error: ${entry.errorType}</span>`;
          if (entry.message) {
            content += `<div class="params">${entry.message}</div>`;
          }
          break;

        default:
          content = entry.message;
      }

      logElement.innerHTML += content;

      // Add to the top of the log
      loggerContent.insertBefore(logElement, loggerContent.firstChild);

      // Only auto-scroll to top if user is already at the top
      const isAtTop = loggerContent.scrollTop <= 5;
      if (isAtTop) {
        loggerContent.scrollTop = 0;
      }
    }
  },

  // Clear all logs
  clear() {
    this.logs = [];
    const loggerContent = document.getElementById('sdkLoggerContent');
    if (loggerContent) {
      loggerContent.innerHTML = '';
    }
  },

  // Format timestamp to readable string
  formatTimestamp(date) {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    });
  },

  // Format parameters object to JSON string
  formatParams(params) {
    try {
      return JSON.stringify(params, null, 2)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/\n/g, '<br>')
        .replace(/ /g, '&nbsp;');
    } catch (e) {
      return String(params);
    }
  }
};

// ========== Transcript Modal Functions ==========

// Open the transcript modal and populate it with the current meeting's transcript
function openTranscriptModal() {
  const modal = document.getElementById('transcriptModal');
  const modalContent = document.getElementById('transcriptModalContent');
  const openRecordingBtn = document.getElementById('openRecordingBtn');

  if (!modal || !modalContent) return;

  // Get the current meeting's transcript
  const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === currentEditingMeetingId);

  // Show/hide Open Recording button based on whether video exists
  if (openRecordingBtn) {
    if (meeting && meeting.videoPath) {
      openRecordingBtn.style.display = 'flex';
    } else {
      openRecordingBtn.style.display = 'none';
    }
  }

  if (!meeting || !meeting.transcript || meeting.transcript.length === 0) {
    modalContent.innerHTML = '<div class="modal-empty-state">No transcript available for this meeting.</div>';
  } else {
    // Build the transcript HTML
    let html = '<div class="modal-transcript-entries">';
    meeting.transcript.forEach(entry => {
      const timestamp = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
      html += `
        <div class="modal-transcript-entry">
          <div class="modal-transcript-speaker">${entry.speaker || 'Unknown Speaker'}</div>
          <div class="modal-transcript-text">${entry.text || ''}</div>
          ${timestamp ? `<div class="modal-transcript-timestamp">${timestamp}</div>` : ''}
        </div>
      `;
    });
    html += '</div>';
    modalContent.innerHTML = html;
  }

  // Show the modal
  modal.style.display = 'flex';
}

// Close the transcript modal
function closeTranscriptModal() {
  const modal = document.getElementById('transcriptModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Copy the transcript to clipboard
async function copyTranscript() {
  const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === currentEditingMeetingId);

  if (!meeting || !meeting.transcript || meeting.transcript.length === 0) {
    return;
  }

  // Format transcript as "Speaker: text" per line
  const formattedTranscript = meeting.transcript
    .map(entry => `${entry.speaker || 'Unknown Speaker'}: ${entry.text || ''}`)
    .join('\n\n');

  try {
    await navigator.clipboard.writeText(formattedTranscript);

    // Show visual feedback
    const copyBtn = document.getElementById('copyTranscriptBtn');
    if (copyBtn) {
      copyBtn.classList.add('copied');
      const originalHTML = copyBtn.innerHTML;
      copyBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="currentColor"/>
        </svg>
      `;

      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.innerHTML = originalHTML;
      }, 2000);
    }
  } catch (error) {
    console.error('Failed to copy transcript:', error);
  }
}

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM content loaded, loading data from file...');

  // Initialize the SDK Logger
  sdkLogger.init();

  // Initialize the debug panel
  initDebugPanel();

  // Initialize tag event listeners
  initTagEventListeners();

  // Load tag colors and tags
  await loadTagColors();
  await loadTags();

  // Try to load the latest data from file - this is the only data source
  await loadMeetingsDataFromFile();

  // Render meetings only after loading from file
  console.log('Data loaded, rendering meetings...');
  renderMeetings();

  // Initially show home view
  showHomeView();

  // ============= Editor Mode Toggle (Edit/Preview) =============
  const editorModeToggle = document.getElementById('editorModeToggle');
  const simpleEditor = document.getElementById('simple-editor');
  const markdownPreview = document.getElementById('markdown-preview');

  if (editorModeToggle && simpleEditor && markdownPreview) {
    editorModeToggle.addEventListener('click', () => {
      window.isPreviewMode = !window.isPreviewMode;

      const previewIcon = editorModeToggle.querySelector('.preview-icon');
      const editIcon = editorModeToggle.querySelector('.edit-icon');
      const toggleLabel = editorModeToggle.querySelector('.toggle-label');

      if (window.isPreviewMode) {
        // Switch to preview mode
        const content = simpleEditor.value;
        markdownPreview.innerHTML = marked.parse(content);
        simpleEditor.style.display = 'none';
        markdownPreview.style.display = 'block';
        if (previewIcon) previewIcon.style.display = 'none';
        if (editIcon) editIcon.style.display = 'block';
        if (toggleLabel) toggleLabel.textContent = 'Edit';
        editorModeToggle.classList.add('active');
      } else {
        // Switch to edit mode
        simpleEditor.style.display = 'block';
        markdownPreview.style.display = 'none';
        if (previewIcon) previewIcon.style.display = 'block';
        if (editIcon) editIcon.style.display = 'none';
        if (toggleLabel) toggleLabel.textContent = 'Preview';
        editorModeToggle.classList.remove('active');
      }
    });
  }

  // Listen for meeting detection status updates
  window.electronAPI.onMeetingDetectionStatus((data) => {
    console.log('Meeting detection status update:', data);
    const joinMeetingBtn = document.getElementById('joinMeetingBtn');

    // Store the meeting detection state globally
    window.meetingDetected = data.detected;

    if (joinMeetingBtn) {
      // Only update button state if we're in the home view
      const inHomeView = document.getElementById('homeView').style.display !== 'none';

      if (inHomeView) {
        // Always show the button, but enable/disable based on meeting detection
        joinMeetingBtn.style.display = 'block';
        joinMeetingBtn.disabled = !data.detected;
      }
    }
  });

  // Listen for requests to open a meeting note (from notification click)
  window.electronAPI.onOpenMeetingNote((meetingId) => {
    console.log('Received request to open meeting note:', meetingId);

    // Ensure we have the latest data before showing the note
    loadMeetingsDataFromFile().then(() => {
      console.log('Data refreshed, checking for meeting ID:', meetingId);

      // Log the list of available meeting IDs to help with debugging
      console.log('Available meeting IDs:', pastMeetings.map(m => m.id));

      // Verify the meeting exists in our data
      const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);

      if (meeting) {
        console.log('Found meeting to open:', meeting.title);
        setTimeout(() => {
          showEditorView(meetingId);
        }, 200); // Add a small delay to ensure UI is ready
      } else {
        console.error('Meeting not found with ID:', meetingId);
        // Attempt to reload data again after a delay
        setTimeout(() => {
          console.log('Retrying data load after delay...');
          loadMeetingsDataFromFile().then(() => {
            const retryMeeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);
            if (retryMeeting) {
              console.log('Found meeting on second attempt:', retryMeeting.title);
              showEditorView(meetingId);
            } else {
              console.error('Meeting still not found after retry. Available meetings:',
                pastMeetings.map(m => `${m.id}: ${m.title}`));
            }
          });
        }, 1500);
      }
    });
  });

  // Listen for recording completed events
  window.electronAPI.onRecordingCompleted((meetingId) => {
    console.log('Recording completed for meeting:', meetingId);
    // If this note is currently being edited, reload its content
    if (currentEditingMeetingId === meetingId) {
      loadMeetingsDataFromFile().then(() => {
        // Refresh the editor with the updated content
        const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);
        if (meeting) {
          document.getElementById('simple-editor').value = meeting.content;
        }
      });
    }
  });

  // Listen for video frame events
  window.electronAPI.onVideoFrame((data) => {
    // Only handle video frames for the currently open meeting
    if (data.noteId === currentEditingMeetingId) {
      console.log(`Video frame received for participant: ${data.participantName}`);

      // Update the video preview in the debug panel
      updateDebugVideoPreview(data);
    }
  });

  // Listen for participants update events
  window.electronAPI.onParticipantsUpdated((meetingId) => {
    console.log('Participants updated for meeting:', meetingId);

    // If this note is currently being edited, refresh the data
    // and update the debug panel's participants section
    if (currentEditingMeetingId === meetingId) {
      loadMeetingsDataFromFile().then(() => {
        const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);
        if (meeting && meeting.participants && meeting.participants.length > 0) {
          // Log the latest participant
          const latestParticipant = meeting.participants[meeting.participants.length - 1];
          console.log(`Participant updated: ${latestParticipant.name}`);

          // Update the participants area in the debug panel
          updateDebugParticipants(meeting.participants);

          // Show notification about new participant if debug panel is closed
          const debugPanel = document.getElementById('debugPanel');
          if (debugPanel && debugPanel.classList.contains('hidden')) {
            const debugPanelToggle = document.getElementById('debugPanelToggle');
            if (debugPanelToggle) {
              // Add pulse effect to show there's new content
              debugPanelToggle.classList.add('has-new-content');

              // Create a mini notification for participant join
              const miniNotification = document.createElement('div');
              miniNotification.className = 'debug-notification participant-notification';
              miniNotification.innerHTML = `
                <span class="debug-notification-title">New Participant:</span>
                <span class="debug-notification-name">${latestParticipant.name || 'Unknown'}</span>
              `;

              // Add to document
              document.body.appendChild(miniNotification);

              // Remove after a short time
              setTimeout(() => {
                miniNotification.classList.add('fade-out');
                setTimeout(() => {
                  document.body.removeChild(miniNotification);
                }, 500);
              }, 5000);
            }
          }
        }
      });
    }
  });

  // Listen for transcript update events
  window.electronAPI.onTranscriptUpdated((meetingId) => {
    console.log('Transcript updated for meeting:', meetingId);

    // If this note is currently being edited, we can refresh the data
    // and update the debug panel's transcript section
    if (currentEditingMeetingId === meetingId) {
      loadMeetingsDataFromFile().then(() => {
        const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);
        if (meeting && meeting.transcript && meeting.transcript.length > 0) {
          // Log the latest transcript entry
          const latestEntry = meeting.transcript[meeting.transcript.length - 1];
          console.log(`Latest transcript: ${latestEntry.speaker}: "${latestEntry.text}"`);

          // Update the transcript area in the debug panel
          updateDebugTranscript(meeting.transcript);

          // Show notification about new transcript if debug panel is closed
          const debugPanel = document.getElementById('debugPanel');
          if (debugPanel && debugPanel.classList.contains('hidden')) {
            const debugPanelToggle = document.getElementById('debugPanelToggle');
            if (debugPanelToggle) {
              // Add pulse effect to show there's new content
              debugPanelToggle.classList.add('has-new-content');

              // Transcript notifications disabled - they block the coaching panel
              // If you want to re-enable, uncomment the block below
              /*
              if (window.isRecording) {
                const miniNotification = document.createElement('div');
                miniNotification.className = 'debug-notification transcript-notification';
                miniNotification.innerHTML = `
                  <span class="debug-notification-speaker">${latestEntry.speaker || 'Unknown'}</span>:
                  <span class="debug-notification-text">${latestEntry.text.slice(0, 40)}${latestEntry.text.length > 40 ? '...' : ''}</span>
                `;
                document.body.appendChild(miniNotification);
                setTimeout(() => {
                  miniNotification.classList.add('fade-out');
                  setTimeout(() => {
                    document.body.removeChild(miniNotification);
                  }, 500);
                }, 5000);
              }
              */
            }
          }
        }
      });
    }
  });

  // Listen for meeting title updates
  window.electronAPI.onMeetingTitleUpdated((data) => {
    console.log('Meeting title updated:', data);
    
    const { meetingId, newTitle } = data;
    
    // Reload the meetings data
    loadMeetingsDataFromFile().then(() => {
      // Re-render the meetings list to show the updated title
      renderMeetings();
      
      // If this is the currently open meeting, update the editor title too
      if (currentEditingMeetingId === meetingId) {
        const noteTitleElement = document.getElementById('noteTitle');
        if (noteTitleElement) {
          noteTitleElement.textContent = newTitle;
          console.log('Updated editor title to:', newTitle);
        }
      }
    });
  });

  // Listen for summary generation events
  window.electronAPI.onSummaryGenerated((meetingId) => {
    console.log('Summary generated for meeting:', meetingId);

    // If this note is currently being edited, refresh the content
    if (currentEditingMeetingId === meetingId) {
      loadMeetingsDataFromFile().then(() => {
        const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);
        if (meeting) {
          // Update the editor with the new content containing the summary
          document.getElementById('simple-editor').value = meeting.content;
        }
      });
    }
  });

  // Listen for streaming summary updates
  window.electronAPI.onSummaryUpdate((data) => {
    const { meetingId, content, timestamp } = data;

    // If this note is currently being edited, update the content immediately
    if (currentEditingMeetingId === meetingId) {
      // Get the editor element
      const editorElement = document.getElementById('simple-editor');
      const previewElement = document.getElementById('markdown-preview');

      // Update the editor with the latest streamed content
      // Use requestAnimationFrame for smoother updates that don't block the main thread
      requestAnimationFrame(() => {
        editorElement.value = content;

        // If in preview mode, also update the rendered markdown
        if (window.isPreviewMode && previewElement) {
          previewElement.innerHTML = marked.parse(content);
          previewElement.scrollTop = previewElement.scrollHeight;
        } else {
          // Force the editor to scroll to the bottom to follow the new text
          // This creates a better experience of watching text appear
          editorElement.scrollTop = editorElement.scrollHeight;
        }
      });
    }
  });

  // Add event listeners for buttons
  document.querySelector('.new-note-btn').addEventListener('click', async () => {
    console.log('New note button clicked');
    await createNewMeeting();
  });

  // Join Meeting button handler
  document.getElementById('joinMeetingBtn').addEventListener('click', async () => {
    console.log('Join Meeting button clicked');

    // Get the button element
    const joinButton = document.getElementById('joinMeetingBtn');

    // Show loading state
    const originalText = joinButton.textContent;
    joinButton.disabled = true;
    joinButton.innerHTML = `
      <svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right: 8px;">
        <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      Joining...
    `;

    // First check if there's a detected meeting
    if (window.electronAPI.checkForDetectedMeeting) {
      try {
        const hasDetectedMeeting = await window.electronAPI.checkForDetectedMeeting();
        if (hasDetectedMeeting) {
          console.log('Found detected meeting, joining...');
          await window.electronAPI.joinDetectedMeeting();
          // Keep button disabled as we're navigating to a different view
        } else {
          console.log('No active meeting detected');

          // Reset button state
          joinButton.disabled = false;
          joinButton.textContent = originalText;

          // Show a little toast message
          const toast = document.createElement('div');
          toast.className = 'toast';
          toast.textContent = 'No active meeting detected';
          document.body.appendChild(toast);

          // Remove toast after 3 seconds
          setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
              document.body.removeChild(toast);
            }, 300);
          }, 3000);
        }
      } catch (error) {
        console.error('Error joining meeting:', error);

        // Reset button state
        joinButton.disabled = false;
        joinButton.textContent = originalText;

        // Show error toast
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = 'Error joining meeting';
        document.body.appendChild(toast);

        // Remove toast after 3 seconds
        setTimeout(() => {
          toast.style.opacity = '0';
          setTimeout(() => {
            document.body.removeChild(toast);
          }, 300);
        }, 3000);
      }
    } else {
      // Fallback for direct call
      try {
        await window.electronAPI.joinDetectedMeeting();
        // Keep button disabled as we're navigating to a different view
      } catch (error) {
        console.error('Error joining meeting:', error);

        // Reset button state
        joinButton.disabled = false;
        joinButton.textContent = originalText;
      }
    }
  });

  document.querySelector('.search-input').addEventListener('input', (e) => {
    console.log('Search query:', e.target.value);
    // TODO: Implement search functionality
  });

  // Add click event delegation for meeting cards and their actions
  document.querySelector('.main-content').addEventListener('click', (e) => {
    // Check if tag button was clicked
    if (e.target.closest('.tag-meeting-btn')) {
      e.stopPropagation(); // Prevent opening the note
      const tagBtn = e.target.closest('.tag-meeting-btn');
      const meetingId = tagBtn.dataset.id;
      openTagPicker(meetingId, tagBtn);
      return;
    }

    // Check if delete button was clicked
    if (e.target.closest('.delete-meeting-btn')) {
      e.stopPropagation(); // Prevent opening the note
      const deleteBtn = e.target.closest('.delete-meeting-btn');
      const meetingId = deleteBtn.dataset.id;

      if (confirm('Are you sure you want to delete this note? This cannot be undone.')) {
        console.log('Deleting meeting:', meetingId);

        // Show loading state
        deleteBtn.disabled = true;
        deleteBtn.innerHTML = `<svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>`;

        // Use the main process deletion via IPC
        window.electronAPI.deleteMeeting(meetingId)
          .then(result => {
            if (result.success) {
              console.log('Meeting deleted successfully on server');

              // After successful server deletion, update local data
              // Remove from local pastMeetings array
              const pastMeetingIndex = pastMeetings.findIndex(meeting => meeting.id === meetingId);
              if (pastMeetingIndex !== -1) {
                pastMeetings.splice(pastMeetingIndex, 1);
              }

              // Remove from meetingsData as well
              const pastDataIndex = meetingsData.pastMeetings.findIndex(meeting => meeting.id === meetingId);
              if (pastDataIndex !== -1) {
                meetingsData.pastMeetings.splice(pastDataIndex, 1);
              }

              // Also check upcomingMeetings
              const upcomingMeetingIndex = upcomingMeetings.findIndex(meeting => meeting.id === meetingId);
              if (upcomingMeetingIndex !== -1) {
                upcomingMeetings.splice(upcomingMeetingIndex, 1);
              }

              const upcomingDataIndex = meetingsData.upcomingMeetings.findIndex(meeting => meeting.id === meetingId);
              if (upcomingDataIndex !== -1) {
                meetingsData.upcomingMeetings.splice(upcomingDataIndex, 1);
              }

              // Update the grouped meetings
              pastMeetingsByDate = {};
              meetingsData.pastMeetings.forEach(meeting => {
                const dateKey = formatDateHeader(meeting.date);
                if (!pastMeetingsByDate[dateKey]) {
                  pastMeetingsByDate[dateKey] = [];
                }
                pastMeetingsByDate[dateKey].push(meeting);
              });

              // Re-render the meetings list
              renderMeetings();
            } else {
              // Server side deletion failed
              console.error('Server deletion failed:', result.error);
              alert('Failed to delete note: ' + (result.error || 'Unknown error'));
            }
          })
          .catch(error => {
            console.error('Error deleting meeting:', error);
            alert('Failed to delete note: ' + (error.message || 'Unknown error'));
          })
          .finally(() => {
            // Reset button state whether success or failure
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/>
            </svg>`;
          });
      }
      return;
    }

    // Find the meeting card that was clicked (for opening)
    const card = e.target.closest('.meeting-card');
    if (card) {
      const meetingId = card.dataset.id;
      showEditorView(meetingId);
    }
  });

  // Back button event listener
  document.getElementById('backButton').addEventListener('click', async () => {
    // Save content before going back to home
    await saveCurrentNote();
    showHomeView();
    renderMeetings(); // Refresh the meeting list
  });

  // Set up the initial auto-save handler
  setupAutoSaveHandler();

  // Toggle sidebar button with initial state
  const toggleSidebarBtn = document.getElementById('toggleSidebar');
  const sidebar = document.getElementById('sidebar');
  const editorContent = document.querySelector('.editor-content');

  // Start with sidebar hidden
  sidebar.classList.add('hidden');
  editorContent.classList.add('full-width');

  toggleSidebarBtn.addEventListener('click', () => {
    sidebar.classList.toggle('hidden');
    editorContent.classList.toggle('full-width');
  });

  // AI Chat Modal handling
  const aiChatModal = document.getElementById('aiChatModal');
  const openAiChatBtn = document.getElementById('openAiChatBtn');
  const closeAiChatModalBtn = document.getElementById('closeAiChatModal');
  const aiChatInput = document.getElementById('aiChatInput');
  const aiChatSendBtn = document.getElementById('aiChatSendBtn');
  const aiChatMessages = document.getElementById('aiChatMessages');

  // Open AI Chat Modal
  if (openAiChatBtn) {
    openAiChatBtn.addEventListener('click', () => {
      if (aiChatModal) {
        aiChatModal.style.display = 'flex';
        // Clear previous messages and show placeholder
        aiChatMessages.innerHTML = `
          <div class="ai-chat-placeholder">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="#ddd"/>
            </svg>
            <p>Ask a question about the meeting transcript</p>
          </div>
        `;
        aiChatInput.value = '';
        aiChatInput.focus();
      }
    });
  }

  // Close AI Chat Modal
  if (closeAiChatModalBtn) {
    closeAiChatModalBtn.addEventListener('click', () => {
      if (aiChatModal) {
        aiChatModal.style.display = 'none';
      }
    });
  }

  // Close modal when clicking overlay
  if (aiChatModal) {
    aiChatModal.addEventListener('click', (e) => {
      if (e.target === aiChatModal) {
        aiChatModal.style.display = 'none';
      }
    });
  }

  // Function to handle sending a question in the modal
  async function handleAiChatQuestion() {
    const question = aiChatInput.value.trim();
    if (!question) return;
    if (!currentEditingMeetingId) {
      console.error('No meeting selected');
      return;
    }

    console.log('Asking question:', question);

    // Clear input and disable send button
    aiChatInput.value = '';
    aiChatSendBtn.disabled = true;

    // Clear placeholder if present
    const placeholder = aiChatMessages.querySelector('.ai-chat-placeholder');
    if (placeholder) {
      placeholder.remove();
    }

    // Add user message
    const userMessageDiv = document.createElement('div');
    userMessageDiv.className = 'ai-chat-message user';
    userMessageDiv.innerHTML = `
      <div class="ai-chat-message-label">You</div>
      <div class="ai-chat-message-content">${escapeHtml(question)}</div>
    `;
    aiChatMessages.appendChild(userMessageDiv);

    // Add loading indicator
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'ai-chat-loading';
    loadingDiv.innerHTML = `
      <svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="#0077FF" stroke-width="2" fill="none" stroke-dasharray="31.4" stroke-dashoffset="10"/>
      </svg>
      <span>Thinking...</span>
    `;
    aiChatMessages.appendChild(loadingDiv);

    // Scroll to bottom
    aiChatMessages.scrollTop = aiChatMessages.scrollHeight;

    try {
      const result = await window.electronAPI.askMeetingQuestion(currentEditingMeetingId, question);

      // Remove loading indicator
      loadingDiv.remove();

      // Add AI response
      const aiMessageDiv = document.createElement('div');
      aiMessageDiv.className = 'ai-chat-message assistant';

      if (result.success) {
        // Parse markdown in the response
        const formattedAnswer = marked.parse(result.answer);
        aiMessageDiv.innerHTML = `
          <div class="ai-chat-message-label">AI</div>
          <div class="ai-chat-message-content">${formattedAnswer}</div>
        `;
      } else {
        aiMessageDiv.innerHTML = `
          <div class="ai-chat-message-label">AI</div>
          <div class="ai-chat-message-content" style="color: #dc3545;">Error: ${escapeHtml(result.error)}</div>
        `;
      }

      aiChatMessages.appendChild(aiMessageDiv);

      // Scroll to bottom
      aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
    } catch (error) {
      console.error('Error asking question:', error);
      loadingDiv.remove();

      const errorDiv = document.createElement('div');
      errorDiv.className = 'ai-chat-message assistant';
      errorDiv.innerHTML = `
        <div class="ai-chat-message-label">AI</div>
        <div class="ai-chat-message-content" style="color: #dc3545;">Error: ${escapeHtml(error.message || 'Failed to get response')}</div>
      `;
      aiChatMessages.appendChild(errorDiv);
    } finally {
      aiChatSendBtn.disabled = false;
      aiChatInput.focus();
    }
  }

  // Helper function to escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Send button click
  if (aiChatSendBtn) {
    aiChatSendBtn.addEventListener('click', handleAiChatQuestion);
  }

  // Enter key to send
  if (aiChatInput) {
    aiChatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleAiChatQuestion();
      }
    });
  }

  // Handle share buttons
  const shareButtons = document.querySelectorAll('.share-btn');
  shareButtons.forEach(button => {
    button.addEventListener('click', () => {
      const action = button.textContent.trim();
      console.log(`Share action: ${action}`);
      // Implement actual sharing functionality here
    });
  });

  // Handle AI option buttons
  const aiButtons = document.querySelectorAll('.ai-btn');
  aiButtons.forEach(button => {
    button.addEventListener('click', async () => {
      const action = button.textContent.trim();
      console.log(`AI action: ${action}`);

      // Handle different AI actions
      if (action === 'Generate meeting summary') {
        if (!currentEditingMeetingId) {
          alert('No meeting is currently open');
          return;
        }

        // Show loading state
        const originalText = button.textContent;
        button.textContent = 'Generating summary...';
        button.disabled = true;

        try {
          // Use streaming version instead of standard version
          console.log('Starting streaming summary generation');

          // Log the summary generation request to the SDK logger
          sdkLogger.log('Requesting AI summary generation for meeting: ' + currentEditingMeetingId);

          window.electronAPI.generateMeetingSummaryStreaming(currentEditingMeetingId)
            .then(result => {
              if (result.success) {
                console.log('Summary generated successfully (streaming)');
              } else {
                console.error('Failed to generate summary:', result.error);
                alert('Failed to generate summary: ' + result.error);
              }
            })
            .catch(error => {
              console.error('Error generating summary:', error);
              alert('Error generating summary: ' + (error.message || error));
            })
            .finally(() => {
              // Reset button state
              button.textContent = originalText;
              button.disabled = false;
            });
        } catch (error) {
          console.error('Error starting streaming summary generation:', error);
          alert('Error starting summary generation: ' + (error.message || error));

          // Reset button state
          button.textContent = originalText;
          button.disabled = false;
        }
      } else if (action === 'List action items') {
        alert('List action items functionality coming soon');
      } else if (action === 'Write follow-up email') {
        alert('Write follow-up email functionality coming soon');
      } else if (action === 'List Q&A') {
        alert('List Q&A functionality coming soon');
      }
    });
  });

  // UI variables will be initialized when the recording button is set up

  // Listen for recording state change events
  window.electronAPI.onRecordingStateChange((data) => {
    console.log('Recording state change received:', data);

    // If this state change is for the current note, update the UI
    if (data.noteId === currentEditingMeetingId) {
      console.log('Updating recording button for current note');
      const isActive = data.state === 'recording' || data.state === 'paused';
      updateRecordingButtonUI(isActive, isActive ? data.recordingId : null);
    }
  });

  // Setup record/stop button toggle
  const recordButton = document.getElementById('recordButton');
  if (recordButton) {

    recordButton.addEventListener('click', async () => {
      // Only allow recording if we're in a note
      if (!currentEditingMeetingId) {
        alert('You need to be in a note to start recording');
        return;
      }

      window.isRecording = !window.isRecording;

      // Get the elements inside the button
      const recordIcon = recordButton.querySelector('.record-icon');
      const stopIcon = recordButton.querySelector('.stop-icon');

      if (window.isRecording) {
        try {
          // Start recording
          console.log('Starting manual recording for meeting:', currentEditingMeetingId);
          recordButton.disabled = true; // Temporarily disable to prevent double-clicks

          // Change to stop mode immediately for better feedback
          recordButton.classList.add('recording');
          recordIcon.style.display = 'none';
          stopIcon.style.display = 'block';

          // Call the API to start recording
          const result = await window.electronAPI.startManualRecording(currentEditingMeetingId);
          recordButton.disabled = false;

          if (result.success) {
            console.log('Manual recording started with ID:', result.recordingId);
            window.currentRecordingId = result.recordingId;

            // Show a little toast message
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.textContent = 'Recording started...';
            document.body.appendChild(toast);

            // Remove toast after 3 seconds
            setTimeout(() => {
              toast.style.opacity = '0';
              setTimeout(() => {
                document.body.removeChild(toast);
              }, 300);
            }, 3000);
          } else {
            // If starting failed, revert UI
            console.error('Failed to start recording:', result.error);
            alert('Failed to start recording: ' + result.error);
            window.isRecording = false;
            recordButton.classList.remove('recording');
            recordIcon.style.display = 'block';
            stopIcon.style.display = 'none';
          }
        } catch (error) {
          // Handle errors
          console.error('Error starting recording:', error);
          alert('Error starting recording: ' + (error.message || error));

          // Reset UI state
          window.isRecording = false;
          recordButton.classList.remove('recording');
          recordIcon.style.display = 'block';
          stopIcon.style.display = 'none';
          recordButton.disabled = false;
        }
      } else {
        // Stop recording
        if (window.currentRecordingId) {
          try {
            console.log('Stopping manual recording:', window.currentRecordingId);
            recordButton.disabled = true; // Temporarily disable

            // Call the API to stop recording
            const result = await window.electronAPI.stopManualRecording(window.currentRecordingId);

            // Change to record mode
            recordButton.classList.remove('recording');
            recordIcon.style.display = 'block';
            stopIcon.style.display = 'none';
            recordButton.disabled = false;

            if (result.success) {
              console.log('Manual recording stopped successfully');

              // Show a little toast message
              const toast = document.createElement('div');
              toast.className = 'toast';
              toast.textContent = 'Recording stopped. Generating summary...';
              document.body.appendChild(toast);

              // Remove toast after 3 seconds
              setTimeout(() => {
                toast.style.opacity = '0';
                setTimeout(() => {
                  document.body.removeChild(toast);
                }, 300);
              }, 3000);

              // The recording-completed event handler will take care of refreshing the content
              // and generating the summary when the recording finishes processing

            } else {
              console.error('Failed to stop recording:', result.error);
              alert('Failed to stop recording: ' + result.error);
            }

            // Reset recording ID
            window.currentRecordingId = null;
          } catch (error) {
            console.error('Error stopping recording:', error);
            alert('Error stopping recording: ' + (error.message || error));
            recordButton.disabled = false;
          }
        } else {
          console.warn('No active recording ID found');
          // Reset UI anyway
          recordButton.classList.remove('recording');
          recordIcon.style.display = 'block';
          stopIcon.style.display = 'none';
        }
      }
    });
  }

  // Handle generate notes button (Auto button)
  const generateButton = document.querySelector('.generate-btn');
  if (generateButton) {
    generateButton.addEventListener('click', async () => {
      console.log('Generating AI summary from transcript...');

      // Check if we have an active meeting
      if (!currentEditingMeetingId) {
        alert('No meeting is currently open');
        return;
      }

      // Store the original HTML content (including the sparkle icon)
      const originalHTML = generateButton.innerHTML;

      // Show loading state - but keep the same structure
      generateButton.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right: 4px;">
          <path d="M208,512a24.84,24.84,0,0,1-23.34-16l-39.84-103.6a16.06,16.06,0,0,0-9.19-9.19L32,343.34a25,25,0,0,1,0-46.68l103.6-39.84a16.06,16.06,0,0,0,9.19-9.19L184.66,144a25,25,0,0,1,46.68,0l39.84,103.6a16.06,16.06,0,0,0,9.19,9.19l103,39.63A25.49,25.49,0,0,1,400,320.52a24.82,24.82,0,0,1-16,22.82l-103.6,39.84a16.06,16.06,0,0,0-9.19,9.19L231.34,496A24.84,24.84,0,0,1,208,512Z" fill="currentColor"/>
          <path d="M88,176a14.67,14.67,0,0,1-13.69-9.4L57.45,122.76a7.28,7.28,0,0,0-4.21-4.21L9.4,101.69a14.67,14.67,0,0,1,0-27.38L53.24,57.45a7.31,7.31,0,0,0,4.21-4.21L74.16,9.79A15,15,0,0,1,86.23.11,14.67,14.67,0,0,1,101.69,9.4l16.86,43.84a7.31,7.31,0,0,0,4.21,4.21L166.6,74.31a14.67,14.67,0,0,1,0,27.38l-43.84,16.86a7.28,7.28,0,0,0-4.21,4.21L101.69,166.6A14.67,14.67,0,0,1,88,176Z" fill="currentColor"/>
          <path d="M400,256a16,16,0,0,1-14.93-10.26l-22.84-59.37a8,8,0,0,0-4.6-4.6l-59.37-22.84a16,16,0,0,1,0-29.86l59.37-22.84a8,8,0,0,0,4.6-4.6L384.9,42.68a16.45,16.45,0,0,1,13.17-10.57,16,16,0,0,1,16.86,10.15l22.84,59.37a8,8,0,0,0,4.6,4.6l59.37,22.84a16,16,0,0,1,0,29.86l-59.37,22.84a8,8,0,0,0-4.6,4.6l-22.84,59.37A16,16,0,0,1,400,256Z" fill="currentColor"/>
        </svg>
        Generating...
      `;
      generateButton.disabled = true;

      try {
        // Use streaming version for better user experience
        console.log('Starting streaming summary generation');

        // Log the Auto button summary generation to the SDK logger
        sdkLogger.log('Auto button: Requesting AI summary generation for meeting: ' + currentEditingMeetingId + ', summaryTypeId: ' + (window.selectedSummaryTypeId || 'default'));

        const result = await window.electronAPI.generateMeetingSummaryStreaming(currentEditingMeetingId, window.selectedSummaryTypeId);

        if (result.success) {
          console.log('Summary generated successfully (streaming)');
          // Show a little toast message
          const toast = document.createElement('div');
          toast.className = 'toast';
          toast.textContent = 'Summary generated successfully!';
          document.body.appendChild(toast);

          // Remove toast after 3 seconds
          setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
              document.body.removeChild(toast);
            }, 300);
          }, 3000);
        } else {
          console.error('Failed to generate summary:', result.error);
          alert('Failed to generate summary: ' + result.error);
        }
      } catch (error) {
        console.error('Error generating summary:', error);
        alert('Error generating summary: ' + (error.message || error));
      } finally {
        // Reset button state with the original HTML (including sparkle icon)
        generateButton.innerHTML = originalHTML;
        generateButton.disabled = false;
      }
    });
  }



  // Listen for recording completed events
  window.electronAPI.onRecordingCompleted((meetingId) => {
    console.log('Recording completed for meeting:', meetingId);
    if (currentEditingMeetingId === meetingId) {
      // Reload the meeting data first
      loadMeetingsDataFromFile().then(() => {
        // Refresh the editor with the updated content
        const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === meetingId);
        if (meeting) {
          document.getElementById('simple-editor').value = meeting.content;

          // Show transcript sidebar section if transcript exists
          const transcriptSidebarSection = document.getElementById('transcriptSidebarSection');
          if (transcriptSidebarSection && meeting.transcript && meeting.transcript.length > 0) {
            transcriptSidebarSection.style.display = 'block';
          }

          // Transcript button is always visible (no conditional display logic needed)
        }
      });
    }
  });

  // ========== Transcript Modal Event Listeners ==========

  // View Full Transcript button (sidebar)
  const viewTranscriptBtn = document.getElementById('viewTranscriptBtn');
  if (viewTranscriptBtn) {
    viewTranscriptBtn.addEventListener('click', openTranscriptModal);
  }

  // View Full Transcript button (floating controls)
  const viewTranscriptFloatingBtn = document.getElementById('viewTranscriptFloatingBtn');
  if (viewTranscriptFloatingBtn) {
    viewTranscriptFloatingBtn.addEventListener('click', openTranscriptModal);
  }

  // Close modal button
  const closeTranscriptModalBtn = document.getElementById('closeTranscriptModal');
  if (closeTranscriptModalBtn) {
    closeTranscriptModalBtn.addEventListener('click', closeTranscriptModal);
  }

  // Copy transcript button
  const copyTranscriptBtn = document.getElementById('copyTranscriptBtn');
  if (copyTranscriptBtn) {
    copyTranscriptBtn.addEventListener('click', copyTranscript);
  }

  // Open recording button
  const openRecordingBtn = document.getElementById('openRecordingBtn');
  if (openRecordingBtn) {
    openRecordingBtn.addEventListener('click', async () => {
      if (!currentEditingMeetingId) return;

      try {
        const result = await window.electronAPI.openVideoFile(currentEditingMeetingId);
        if (!result.success) {
          showToast(result.error || 'Failed to open recording', 'error');
        }
      } catch (error) {
        console.error('Error opening recording:', error);
        showToast('Failed to open recording', 'error');
      }
    });
  }

  // Close modal when clicking outside
  const transcriptModal = document.getElementById('transcriptModal');
  if (transcriptModal) {
    transcriptModal.addEventListener('click', (e) => {
      if (e.target === transcriptModal) {
        closeTranscriptModal();
      }
    });
  }

  // ============= Settings Page Event Handlers =============

  // Settings button click
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      showSettingsView();
    });
  }

  // Feedback interval slider
  const feedbackIntervalSlider = document.getElementById('feedbackInterval');
  const feedbackIntervalValue = document.getElementById('feedbackIntervalValue');
  if (feedbackIntervalSlider && feedbackIntervalValue) {
    feedbackIntervalSlider.addEventListener('input', () => {
      feedbackIntervalValue.textContent = `${feedbackIntervalSlider.value}s`;
    });
  }

  // Save global settings button
  const saveGlobalSettingsBtn = document.getElementById('saveGlobalSettings');
  if (saveGlobalSettingsBtn) {
    saveGlobalSettingsBtn.addEventListener('click', saveGlobalSettings);
  }

  // Add bot button
  const addBotBtn = document.getElementById('addBotBtn');
  if (addBotBtn) {
    addBotBtn.addEventListener('click', () => openBotEditor(null));
  }

  // Delete all recordings button
  const deleteAllRecordingsBtn = document.getElementById('deleteAllRecordingsBtn');
  if (deleteAllRecordingsBtn) {
    deleteAllRecordingsBtn.addEventListener('click', async () => {
      if (!confirm('Delete ALL recordings from Recall.ai? This action cannot be undone.')) {
        return;
      }

      // Disable button and show loading state
      deleteAllRecordingsBtn.disabled = true;
      const originalText = deleteAllRecordingsBtn.textContent;
      deleteAllRecordingsBtn.textContent = 'Deleting...';

      try {
        const result = await window.electronAPI.deleteAllRecordings();
        if (result.success) {
          showToast(`Successfully deleted ${result.deleted} recording(s)`);
        } else {
          showToast(result.error || 'Failed to delete recordings', 'error');
        }
      } catch (error) {
        console.error('Error deleting recordings:', error);
        showToast('Failed to delete recordings', 'error');
      } finally {
        // Re-enable button
        deleteAllRecordingsBtn.disabled = false;
        deleteAllRecordingsBtn.textContent = originalText;
      }
    });
  }

  // Clear local recordings button
  const clearLocalRecordingsBtn = document.getElementById('clearLocalRecordingsBtn');
  if (clearLocalRecordingsBtn) {
    clearLocalRecordingsBtn.addEventListener('click', async () => {
      if (!confirm('Delete ALL local recording files? This action cannot be undone.')) {
        return;
      }

      // Disable button and show loading state
      clearLocalRecordingsBtn.disabled = true;
      const originalText = clearLocalRecordingsBtn.textContent;
      clearLocalRecordingsBtn.textContent = 'Clearing...';

      try {
        const result = await window.electronAPI.clearLocalRecordings();
        if (result.success) {
          showToast(`Successfully deleted ${result.deleted} local recording(s)`);
        } else {
          showToast(result.error || 'Failed to clear local recordings', 'error');
        }
      } catch (error) {
        console.error('Error clearing local recordings:', error);
        showToast('Failed to clear local recordings', 'error');
      } finally {
        // Re-enable button
        clearLocalRecordingsBtn.disabled = false;
        clearLocalRecordingsBtn.textContent = originalText;
      }
    });
  }

  // Bot editor modal events
  const closeBotEditorModalBtn = document.getElementById('closeBotEditorModal');
  const cancelBotEditorBtn = document.getElementById('cancelBotEditor');
  const botEditorForm = document.getElementById('botEditorForm');
  const botEditorModal = document.getElementById('botEditorModal');

  if (closeBotEditorModalBtn) {
    closeBotEditorModalBtn.addEventListener('click', closeBotEditor);
  }
  if (cancelBotEditorBtn) {
    cancelBotEditorBtn.addEventListener('click', closeBotEditor);
  }
  if (botEditorForm) {
    botEditorForm.addEventListener('submit', handleBotEditorSubmit);
  }
  if (botEditorModal) {
    botEditorModal.addEventListener('click', (e) => {
      if (e.target === botEditorModal) {
        closeBotEditor();
      }
    });
  }

  // ============= Bot Selector Event Handlers =============

  const botSelectorBtn = document.getElementById('botSelectorBtn');
  const botSelectorDropdown = document.getElementById('botSelectorDropdown');

  if (botSelectorBtn && botSelectorDropdown) {
    // Toggle dropdown on button click
    botSelectorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = botSelectorDropdown.style.display === 'block';
      botSelectorDropdown.style.display = isVisible ? 'none' : 'block';
      if (!isVisible) {
        loadBotSelectorOptions();
      }
    });

    // Handle option clicks via event delegation
    botSelectorDropdown.addEventListener('click', (e) => {
      e.stopPropagation();
      const option = e.target.closest('.bot-selector-option');
      if (option) {
        const botId = option.dataset.botId;
        selectCoachingBot(botId);
        botSelectorDropdown.style.display = 'none';
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!botSelectorBtn.contains(e.target) && !botSelectorDropdown.contains(e.target)) {
        botSelectorDropdown.style.display = 'none';
      }
    });
  }

  // ============= Summary Editor Modal Event Handlers =============

  const closeSummaryEditorModalBtn = document.getElementById('closeSummaryEditorModal');
  const cancelSummaryEditorBtn = document.getElementById('cancelSummaryEditor');
  const summaryEditorForm = document.getElementById('summaryEditorForm');
  const summaryEditorModal = document.getElementById('summaryEditorModal');
  const addSummaryTypeBtn = document.getElementById('addSummaryTypeBtn');

  if (closeSummaryEditorModalBtn) {
    closeSummaryEditorModalBtn.addEventListener('click', closeSummaryEditor);
  }
  if (cancelSummaryEditorBtn) {
    cancelSummaryEditorBtn.addEventListener('click', closeSummaryEditor);
  }
  if (summaryEditorForm) {
    summaryEditorForm.addEventListener('submit', handleSummaryEditorSubmit);
  }
  if (summaryEditorModal) {
    summaryEditorModal.addEventListener('click', (e) => {
      if (e.target === summaryEditorModal) {
        closeSummaryEditor();
      }
    });
  }
  if (addSummaryTypeBtn) {
    addSummaryTypeBtn.addEventListener('click', () => openSummaryEditor(null));
  }

  // Default summary type dropdown change handler
  const defaultSummaryTypeSelect = document.getElementById('defaultSummaryType');
  if (defaultSummaryTypeSelect) {
    defaultSummaryTypeSelect.addEventListener('change', async () => {
      try {
        await window.electronAPI.updateSummaryGlobalSettings({
          defaultSummaryTypeId: defaultSummaryTypeSelect.value || null
        });
        showToast('Default summary type updated');
      } catch (error) {
        console.error('Error updating default summary type:', error);
        showToast('Failed to update default', 'error');
      }
    });
  }

  // ============= Summary Selector Event Handlers =============

  const summarySelectorBtn = document.getElementById('summarySelectorBtn');
  const summarySelectorDropdown = document.getElementById('summarySelectorDropdown');

  if (summarySelectorBtn && summarySelectorDropdown) {
    // Toggle dropdown on button click
    summarySelectorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = summarySelectorDropdown.style.display === 'block';
      // Close bot selector dropdown if open
      const botDropdown = document.getElementById('botSelectorDropdown');
      if (botDropdown) botDropdown.style.display = 'none';

      summarySelectorDropdown.style.display = isVisible ? 'none' : 'block';
      if (!isVisible) {
        loadSummarySelectorOptions();
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!summarySelectorBtn.contains(e.target) && !summarySelectorDropdown.contains(e.target)) {
        summarySelectorDropdown.style.display = 'none';
      }
    });
  }

  // ============= Regenerate Summary Confirmation Modal Event Handlers =============

  const closeRegenerateSummaryModalBtn = document.getElementById('closeRegenerateSummaryModal');
  const cancelRegenerateSummaryBtn = document.getElementById('cancelRegenerateSummary');
  const confirmRegenerateSummaryBtn = document.getElementById('confirmRegenerateSummary');
  const regenerateSummaryModal = document.getElementById('regenerateSummaryModal');

  if (closeRegenerateSummaryModalBtn) {
    closeRegenerateSummaryModalBtn.addEventListener('click', () => {
      regenerateSummaryModal.style.display = 'none';
    });
  }
  if (cancelRegenerateSummaryBtn) {
    cancelRegenerateSummaryBtn.addEventListener('click', () => {
      regenerateSummaryModal.style.display = 'none';
    });
  }
  if (confirmRegenerateSummaryBtn) {
    confirmRegenerateSummaryBtn.addEventListener('click', confirmRegenerateSummary);
  }
  if (regenerateSummaryModal) {
    regenerateSummaryModal.addEventListener('click', (e) => {
      if (e.target === regenerateSummaryModal) {
        regenerateSummaryModal.style.display = 'none';
      }
    });
  }

  // ============= Coaching Panel Event Handlers =============

  const minimizeCoachingPanelBtn = document.getElementById('minimizeCoachingPanel');
  const closeCoachingPanelBtn = document.getElementById('closeCoachingPanel');
  const coachingPanel = document.getElementById('coachingPanel');

  if (minimizeCoachingPanelBtn && coachingPanel) {
    minimizeCoachingPanelBtn.addEventListener('click', () => {
      coachingPanel.classList.toggle('minimized');
    });
  }

  if (closeCoachingPanelBtn) {
    closeCoachingPanelBtn.addEventListener('click', () => {
      deactivateCoachingBot();
    });
  }

  // ============= Coaching Events from Main Process =============

  window.electronAPI.onCoachingFeedbackChunk((data) => {
    handleCoachingFeedbackChunk(data);
  });

  window.electronAPI.onCoachingStatusChange((data) => {
    handleCoachingStatusChange(data);
  });

  window.electronAPI.onCoachingError((data) => {
    handleCoachingError(data);
  });

  // Load available models on startup
  loadAvailableModels();

});

// ============= Settings Page Functions =============

async function loadSettingsData() {
  try {
    // Load global settings
    const settingsResult = await window.electronAPI.getGlobalSettings();
    if (settingsResult.success) {
      const settings = settingsResult.data;
      const feedbackIntervalSlider = document.getElementById('feedbackInterval');
      const feedbackIntervalValue = document.getElementById('feedbackIntervalValue');
      const defaultModelSelect = document.getElementById('defaultModel');

      if (feedbackIntervalSlider) {
        feedbackIntervalSlider.value = settings.feedbackIntervalSeconds;
      }
      if (feedbackIntervalValue) {
        feedbackIntervalValue.textContent = `${settings.feedbackIntervalSeconds}s`;
      }
      if (defaultModelSelect) {
        defaultModelSelect.value = settings.defaultModel;
      }
    }

    // Load bot types
    await loadBotTypes();

    // Load summary types
    await loadSummaryTypes();
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

async function loadAvailableModels() {
  try {
    const result = await window.electronAPI.getAvailableModels();
    if (result.success) {
      window.availableModels = result.data;
      populateModelSelects();
    }
  } catch (error) {
    console.error('Error loading available models:', error);
  }
}

function populateModelSelects() {
  const selects = ['defaultModel', 'botModel'];
  selects.forEach(selectId => {
    const select = document.getElementById(selectId);
    if (select) {
      select.innerHTML = '';
      window.availableModels.forEach(model => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.name;
        select.appendChild(option);
      });
    }
  });
}

async function saveGlobalSettings() {
  const feedbackIntervalSlider = document.getElementById('feedbackInterval');
  const defaultModelSelect = document.getElementById('defaultModel');

  const updates = {
    feedbackIntervalSeconds: parseInt(feedbackIntervalSlider.value, 10),
    defaultModel: defaultModelSelect.value
  };

  try {
    const result = await window.electronAPI.updateGlobalSettings(updates);
    if (result.success) {
      showToast('Settings saved successfully');
    } else {
      showToast('Failed to save settings', 'error');
    }
  } catch (error) {
    console.error('Error saving settings:', error);
    showToast('Failed to save settings', 'error');
  }
}

async function loadBotTypes() {
  try {
    const result = await window.electronAPI.getBotTypes();
    if (result.success) {
      window.botTypes = result.data;
      renderBotTypesList();
    }
  } catch (error) {
    console.error('Error loading bot types:', error);
  }
}

function renderBotTypesList() {
  const container = document.getElementById('botTypesList');
  if (!container) return;

  if (window.botTypes.length === 0) {
    container.innerHTML = `
      <div class="bot-types-empty">
        <p>No coaching bots yet. Click "+ Add Bot" to create one.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = window.botTypes.map(bot => `
    <div class="bot-type-card" data-bot-id="${bot.id}">
      <div class="bot-type-info">
        <h4 class="bot-type-name">${bot.name}</h4>
        <p class="bot-type-model">${getModelName(bot.model)}</p>
      </div>
      <div class="bot-type-actions">
        <button class="bot-action-btn edit" onclick="openBotEditor('${bot.id}')">Edit</button>
        <button class="bot-action-btn delete" onclick="deleteBotType('${bot.id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

function getModelName(modelId) {
  const model = window.availableModels.find(m => m.id === modelId);
  return model ? model.name : modelId;
}

function openBotEditor(botId) {
  const modal = document.getElementById('botEditorModal');
  const title = document.getElementById('botEditorTitle');
  const nameInput = document.getElementById('botName');
  const modelSelect = document.getElementById('botModel');
  const promptTextarea = document.getElementById('botSystemPrompt');
  const editIdInput = document.getElementById('botEditId');

  if (botId) {
    // Editing existing bot
    const bot = window.botTypes.find(b => b.id === botId);
    if (bot) {
      title.textContent = 'Edit Bot';
      nameInput.value = bot.name;
      modelSelect.value = bot.model;
      promptTextarea.value = bot.systemPrompt;
      editIdInput.value = botId;
    }
  } else {
    // Creating new bot
    title.textContent = 'Create New Bot';
    nameInput.value = '';
    promptTextarea.value = '';
    editIdInput.value = '';
    // Set default model
    if (window.availableModels.length > 0) {
      modelSelect.value = window.availableModels[0].id;
    }
  }

  modal.style.display = 'flex';
}

function closeBotEditor() {
  const modal = document.getElementById('botEditorModal');
  modal.style.display = 'none';
}

async function handleBotEditorSubmit(e) {
  e.preventDefault();

  const nameInput = document.getElementById('botName');
  const modelSelect = document.getElementById('botModel');
  const promptTextarea = document.getElementById('botSystemPrompt');
  const editIdInput = document.getElementById('botEditId');

  const botData = {
    name: nameInput.value,
    model: modelSelect.value,
    systemPrompt: promptTextarea.value
  };

  try {
    let result;
    if (editIdInput.value) {
      // Update existing bot
      result = await window.electronAPI.updateBotType(editIdInput.value, botData);
    } else {
      // Create new bot
      result = await window.electronAPI.createBotType(botData);
    }

    if (result.success) {
      closeBotEditor();
      await loadBotTypes();
      showToast(editIdInput.value ? 'Bot updated successfully' : 'Bot created successfully');
    } else {
      showToast('Failed to save bot', 'error');
    }
  } catch (error) {
    console.error('Error saving bot:', error);
    showToast('Failed to save bot', 'error');
  }
}

async function deleteBotType(botId) {
  if (!confirm('Are you sure you want to delete this bot?')) return;

  try {
    const result = await window.electronAPI.deleteBotType(botId);
    if (result.success) {
      await loadBotTypes();
      showToast('Bot deleted successfully');
    } else {
      showToast('Failed to delete bot', 'error');
    }
  } catch (error) {
    console.error('Error deleting bot:', error);
    showToast('Failed to delete bot', 'error');
  }
}

// Make functions available globally for onclick handlers
window.openBotEditor = openBotEditor;
window.deleteBotType = deleteBotType;

// ============= Bot Selector Functions =============

async function loadBotSelectorOptions() {
  const dropdown = document.getElementById('botSelectorDropdown');
  if (!dropdown) return;

  // Get fresh bot types
  const result = await window.electronAPI.getBotTypes();
  if (result.success) {
    window.botTypes = result.data;
  }

  // Build dropdown options
  let html = `
    <div class="bot-selector-option ${!window.activeCoachingBot ? 'selected' : ''}" data-bot-id="">
      <span>No Coach</span>
      ${!window.activeCoachingBot ? '<span class="check-icon">&#10003;</span>' : ''}
    </div>
  `;

  window.botTypes.forEach(bot => {
    const isSelected = window.activeCoachingBot?.id === bot.id;
    html += `
      <div class="bot-selector-option ${isSelected ? 'selected' : ''}" data-bot-id="${bot.id}">
        <span>${bot.name}</span>
        ${isSelected ? '<span class="check-icon">&#10003;</span>' : ''}
      </div>
    `;
  });

  dropdown.innerHTML = html;
  // Click handling is done via event delegation in DOMContentLoaded
}

async function selectCoachingBot(botId) {
  const selectorBtn = document.getElementById('botSelectorBtn');
  const selectorLabel = document.getElementById('botSelectorLabel');

  if (!botId) {
    // Deactivate coaching
    await deactivateCoachingBot();
    if (selectorLabel) selectorLabel.textContent = 'No Coach';
    if (selectorBtn) selectorBtn.classList.remove('active');
  } else {
    // Activate coaching with selected bot
    const bot = window.botTypes.find(b => b.id === botId);
    if (bot) {
      await activateCoachingBot(bot);
      if (selectorLabel) selectorLabel.textContent = bot.name;
      if (selectorBtn) selectorBtn.classList.add('active');
    }
  }
}

async function activateCoachingBot(bot) {
  if (!currentEditingMeetingId) {
    showToast('Please open a meeting note first', 'error');
    return;
  }

  window.activeCoachingBot = bot;

  // Show coaching panel
  const coachingPanel = document.getElementById('coachingPanel');
  const coachingBotName = document.getElementById('coachingBotName');
  const coachingContent = document.getElementById('coachingContent');

  if (coachingPanel) {
    coachingPanel.style.display = 'flex';
    coachingPanel.classList.remove('minimized');
  }
  if (coachingBotName) {
    coachingBotName.textContent = bot.name;
  }
  if (coachingContent) {
    coachingContent.innerHTML = `
      <div class="coaching-placeholder">
        <p>Listening to your conversation...</p>
      </div>
    `;
  }

  updateCoachingStatus('Waiting for transcript...');

  // Notify main process to activate coaching
  try {
    await window.electronAPI.activateCoachingBot({
      botType: bot,
      meetingId: currentEditingMeetingId
    });
  } catch (error) {
    console.error('Error activating coaching bot:', error);
    showToast('Failed to activate coaching', 'error');
  }
}

async function deactivateCoachingBot() {
  window.activeCoachingBot = null;

  // Hide coaching panel
  const coachingPanel = document.getElementById('coachingPanel');
  if (coachingPanel) {
    coachingPanel.style.display = 'none';
  }

  // Reset selector
  const selectorBtn = document.getElementById('botSelectorBtn');
  const selectorLabel = document.getElementById('botSelectorLabel');
  if (selectorLabel) selectorLabel.textContent = 'No Coach';
  if (selectorBtn) selectorBtn.classList.remove('active');

  // Notify main process to deactivate coaching
  try {
    await window.electronAPI.deactivateCoachingBot();
  } catch (error) {
    console.error('Error deactivating coaching bot:', error);
  }
}

// ============= Coaching Panel Functions =============

function handleCoachingFeedbackChunk(data) {
  const coachingContent = document.getElementById('coachingContent');
  if (!coachingContent) return;

  // Remove placeholder if present
  const placeholder = coachingContent.querySelector('.coaching-placeholder');
  if (placeholder) {
    placeholder.remove();
  }

  // Find or create current feedback entry
  let currentEntry = coachingContent.querySelector('.coaching-feedback-entry.streaming');
  if (!currentEntry) {
    currentEntry = document.createElement('div');
    currentEntry.className = 'coaching-feedback-entry streaming';
    currentEntry.innerHTML = `
      <div class="coaching-feedback-text"></div>
      <div class="coaching-feedback-time">${new Date().toLocaleTimeString()}</div>
    `;
    coachingContent.insertBefore(currentEntry, coachingContent.firstChild);
  }

  // Update the text content
  const textEl = currentEntry.querySelector('.coaching-feedback-text');
  if (textEl) {
    if (data.done) {
      // Streaming complete, finalize entry with markdown
      textEl.innerHTML = parseSimpleMarkdown(data.text);
      currentEntry.classList.remove('streaming');
      updateCoachingStatus('Listening...');
    } else {
      // While streaming, show plain text (faster)
      textEl.textContent = data.text;
    }
  }

  // Auto-scroll to show latest content
  coachingContent.scrollTop = 0;
}

// Simple markdown parser for coaching feedback
function parseSimpleMarkdown(text) {
  if (!text) return '';

  return text
    // Escape HTML first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Bold: **text** or __text__
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    // Italic: *text* or _text_
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    // Line breaks
    .replace(/\n/g, '<br>');
}

function handleCoachingStatusChange(data) {
  if (data.status === 'thinking') {
    updateCoachingStatus('Generating feedback...', true);
  } else if (data.status === 'listening') {
    updateCoachingStatus('Listening...');
  } else if (data.status === 'inactive') {
    // Coaching was deactivated
    deactivateCoachingBot();
  }
}

function handleCoachingError(data) {
  console.error('Coaching error:', data.error);
  updateCoachingStatus(`Error: ${data.error}`);

  const coachingContent = document.getElementById('coachingContent');
  if (coachingContent) {
    const errorEntry = document.createElement('div');
    errorEntry.className = 'coaching-feedback-entry error';
    errorEntry.innerHTML = `
      <div class="coaching-feedback-text" style="color: #c00;">Error: ${data.error}</div>
      <div class="coaching-feedback-time">${new Date().toLocaleTimeString()}</div>
    `;
    coachingContent.insertBefore(errorEntry, coachingContent.firstChild);
  }
}

function updateCoachingStatus(text, isThinking = false) {
  const statusContainer = document.getElementById('coachingStatus');
  const statusText = statusContainer?.querySelector('.status-text');

  if (statusContainer) {
    if (isThinking) {
      statusContainer.classList.add('thinking');
    } else {
      statusContainer.classList.remove('thinking');
    }
  }

  if (statusText) {
    statusText.textContent = text;
  }
}

// ============= Summary Type Management Functions =============

async function loadSummaryTypes() {
  try {
    const result = await window.electronAPI.getSummaryTypes();
    if (result.success) {
      window.summaryTypes = result.data;
      renderSummaryTypesList();
      await updateDefaultSummaryTypeDropdown();
    }
  } catch (error) {
    console.error('Error loading summary types:', error);
  }
}

function renderSummaryTypesList() {
  const container = document.getElementById('summaryTypesList');
  if (!container) return;

  if (window.summaryTypes.length === 0) {
    container.innerHTML = `
      <div class="bot-types-empty">
        <p>No summary types yet. Click "+ Add Summary Type" to create one.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = window.summaryTypes.map(type => `
    <div class="bot-type-card" data-summary-id="${type.id}">
      <div class="bot-type-info">
        <h4 class="bot-type-name">${type.name}</h4>
        <p class="bot-type-model">${type.systemPrompt.substring(0, 60)}...</p>
      </div>
      <div class="bot-type-actions">
        <button class="bot-action-btn edit" onclick="openSummaryEditor('${type.id}')">Edit</button>
        <button class="bot-action-btn delete" onclick="deleteSummaryType('${type.id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

async function updateDefaultSummaryTypeDropdown() {
  const select = document.getElementById('defaultSummaryType');
  if (!select) return;

  // Get current default
  const settingsResult = await window.electronAPI.getSummaryGlobalSettings();
  const currentDefault = settingsResult.success ? settingsResult.data.defaultSummaryTypeId : null;

  // Build options
  let html = '<option value="">-- No Default (use built-in) --</option>';
  window.summaryTypes.forEach(type => {
    const selected = type.id === currentDefault ? 'selected' : '';
    html += `<option value="${type.id}" ${selected}>${type.name}</option>`;
  });
  select.innerHTML = html;
}

function openSummaryEditor(typeId) {
  const modal = document.getElementById('summaryEditorModal');
  const title = document.getElementById('summaryEditorTitle');
  const nameInput = document.getElementById('summaryTypeName');
  const promptTextarea = document.getElementById('summaryTypePrompt');
  const editIdInput = document.getElementById('summaryEditId');

  if (typeId) {
    // Editing existing type
    const type = window.summaryTypes.find(t => t.id === typeId);
    if (type) {
      title.textContent = 'Edit Summary Type';
      nameInput.value = type.name;
      promptTextarea.value = type.systemPrompt;
      editIdInput.value = typeId;
    }
  } else {
    // Creating new type
    title.textContent = 'Create New Summary Type';
    nameInput.value = '';
    promptTextarea.value = '';
    editIdInput.value = '';
  }

  modal.style.display = 'flex';
}

function closeSummaryEditor() {
  const modal = document.getElementById('summaryEditorModal');
  modal.style.display = 'none';
}

async function handleSummaryEditorSubmit(e) {
  e.preventDefault();

  const nameInput = document.getElementById('summaryTypeName');
  const promptTextarea = document.getElementById('summaryTypePrompt');
  const editIdInput = document.getElementById('summaryEditId');

  const typeData = {
    name: nameInput.value,
    systemPrompt: promptTextarea.value
  };

  try {
    let result;
    if (editIdInput.value) {
      // Update existing type
      result = await window.electronAPI.updateSummaryType(editIdInput.value, typeData);
    } else {
      // Create new type
      result = await window.electronAPI.createSummaryType(typeData);
    }

    if (result.success) {
      closeSummaryEditor();
      await loadSummaryTypes();
      showToast(editIdInput.value ? 'Summary type updated successfully' : 'Summary type created successfully');
    } else {
      showToast('Failed to save summary type', 'error');
    }
  } catch (error) {
    console.error('Error saving summary type:', error);
    showToast('Failed to save summary type', 'error');
  }
}

async function deleteSummaryType(typeId) {
  if (!confirm('Are you sure you want to delete this summary type?')) return;

  try {
    const result = await window.electronAPI.deleteSummaryType(typeId);
    if (result.success) {
      await loadSummaryTypes();
      showToast('Summary type deleted successfully');
    } else {
      showToast('Failed to delete summary type', 'error');
    }
  } catch (error) {
    console.error('Error deleting summary type:', error);
    showToast('Failed to delete summary type', 'error');
  }
}

// Make summary functions available globally for onclick handlers
window.openSummaryEditor = openSummaryEditor;
window.deleteSummaryType = deleteSummaryType;

// ============= Summary Selector Functions =============

async function loadSummarySelectorOptions() {
  const dropdown = document.getElementById('summarySelectorDropdown');
  if (!dropdown) return;

  // Get fresh summary types
  const result = await window.electronAPI.getSummaryTypes();
  if (result.success) {
    window.summaryTypes = result.data;
  }

  // Get default summary type info
  const settingsResult = await window.electronAPI.getSummaryGlobalSettings();
  const defaultId = settingsResult.success ? settingsResult.data.defaultSummaryTypeId : null;
  const defaultType = defaultId ? window.summaryTypes.find(t => t.id === defaultId) : null;
  const defaultLabel = defaultType ? `Default (${defaultType.name})` : 'Default (Built-in)';

  // Build dropdown options
  let html = `
    <div class="summary-selector-option ${!window.selectedSummaryTypeId ? 'selected' : ''}" data-summary-id="">
      <span>${defaultLabel}</span>
      ${!window.selectedSummaryTypeId ? '<span class="check-icon">&#10003;</span>' : ''}
    </div>
  `;

  window.summaryTypes.forEach(type => {
    const isSelected = window.selectedSummaryTypeId === type.id;
    html += `
      <div class="summary-selector-option ${isSelected ? 'selected' : ''}" data-summary-id="${type.id}">
        <span>${type.name}</span>
        ${isSelected ? '<span class="check-icon">&#10003;</span>' : ''}
      </div>
    `;
  });

  dropdown.innerHTML = html;

  // Add click handlers to options
  dropdown.querySelectorAll('.summary-selector-option').forEach(option => {
    option.addEventListener('click', () => {
      const typeId = option.dataset.summaryId;
      selectSummaryType(typeId);
      dropdown.style.display = 'none';
    });
  });
}

async function selectSummaryType(typeId) {
  // Get the current meeting
  const meeting = [...upcomingMeetings, ...pastMeetings].find(m => m.id === currentEditingMeetingId);

  // If meeting already has a summary and we're changing the type, show confirmation
  if (meeting && meeting.hasSummary && typeId !== window.selectedSummaryTypeId) {
    showRegenerateSummaryConfirmation(typeId);
    return;
  }

  // Update selection
  window.selectedSummaryTypeId = typeId || null;
  updateSummarySelectorLabel();
}

function showRegenerateSummaryConfirmation(typeId) {
  const modal = document.getElementById('regenerateSummaryModal');
  const typeName = typeId ?
    window.summaryTypes.find(t => t.id === typeId)?.name || 'Selected Type' :
    'Default';

  document.getElementById('regenerateSummaryTypeName').textContent = typeName;
  modal.style.display = 'flex';

  // Store pending selection
  modal.dataset.pendingTypeId = typeId || '';
}

async function confirmRegenerateSummary() {
  const modal = document.getElementById('regenerateSummaryModal');
  const typeId = modal.dataset.pendingTypeId;

  modal.style.display = 'none';

  // Update selection
  window.selectedSummaryTypeId = typeId || null;
  updateSummarySelectorLabel();

  // Trigger regeneration with new type
  await regenerateSummaryWithType(typeId);
}

async function regenerateSummaryWithType(typeId) {
  const generateButton = document.querySelector('.generate-btn');
  if (!currentEditingMeetingId) {
    showToast('No meeting selected', 'error');
    return;
  }

  // Show loading state
  if (generateButton) {
    generateButton.disabled = true;
    generateButton.innerHTML = `
      <svg class="spinner" width="16" height="16" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="31.4" stroke-dashoffset="10">
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/>
        </circle>
      </svg>
      Generating...
    `;
  }

  try {
    const result = await window.electronAPI.generateMeetingSummaryStreaming(currentEditingMeetingId, typeId || null);
    if (result.success) {
      showToast('Summary regenerated successfully');
    } else {
      showToast('Failed to regenerate summary', 'error');
    }
  } catch (error) {
    console.error('Error regenerating summary:', error);
    showToast('Failed to regenerate summary', 'error');
  } finally {
    // Restore button
    if (generateButton) {
      generateButton.disabled = false;
      generateButton.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right: 4px;">
          <path d="M208,512a24.84,24.84,0,0,1-23.34-16l-39.84-103.6a16.06,16.06,0,0,0-9.19-9.19L32,343.34a25,25,0,0,1,0-46.68l103.6-39.84a16.06,16.06,0,0,0,9.19-9.19L184.66,144a25,25,0,0,1,46.68,0l39.84,103.6a16.06,16.06,0,0,0,9.19,9.19l103,39.63A25.49,25.49,0,0,1,400,320.52a24.82,24.82,0,0,1-16,22.82l-103.6,39.84a16.06,16.06,0,0,0-9.19,9.19L231.34,496A24.84,24.84,0,0,1,208,512Z" fill="currentColor"/>
          <path d="M88,176a14.67,14.67,0,0,1-13.69-9.4L57.45,122.76a7.28,7.28,0,0,0-4.21-4.21L9.4,101.69a14.67,14.67,0,0,1,0-27.38L53.24,57.45a7.31,7.31,0,0,0,4.21-4.21L74.16,9.79A15,15,0,0,1,86.23.11,14.67,14.67,0,0,1,101.69,9.4l16.86,43.84a7.31,7.31,0,0,0,4.21,4.21L166.6,74.31a14.67,14.67,0,0,1,0,27.38l-43.84,16.86a7.28,7.28,0,0,0-4.21,4.21L101.69,166.6A14.67,14.67,0,0,1,88,176Z" fill="currentColor"/>
          <path d="M400,256a16,16,0,0,1-14.93-10.26l-22.84-59.37a8,8,0,0,0-4.6-4.6l-59.37-22.84a16,16,0,0,1,0-29.86l59.37-22.84a8,8,0,0,0,4.6-4.6L384.9,42.68a16.45,16.45,0,0,1,13.17-10.57,16,16,0,0,1,16.86,10.15l22.84,59.37a8,8,0,0,0,4.6,4.6l59.37,22.84a16,16,0,0,1,0,29.86l-59.37,22.84a8,8,0,0,0-4.6,4.6l-22.84,59.37A16,16,0,0,1,400,256Z" fill="currentColor"/>
        </svg>
        Auto
      `;
    }
  }
}

async function updateSummarySelectorLabel() {
  const label = document.getElementById('summarySelectorLabel');
  if (!label) return;

  if (window.selectedSummaryTypeId) {
    const type = window.summaryTypes.find(t => t.id === window.selectedSummaryTypeId);
    label.textContent = type ? type.name : 'Default';
  } else {
    label.textContent = 'Default';
  }
}

// ============= Toast Helper =============

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'toast-error' : ''}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Remove toast after 3 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => {
      if (toast.parentNode) {
        document.body.removeChild(toast);
      }
    }, 300);
  }, 3000);
}
