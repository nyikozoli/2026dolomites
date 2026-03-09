/**
 * Google Apps Script — Voting backend for Dolomites 2026 Trip Planner.
 *
 * SETUP:
 * 1. Open your Google Spreadsheet
 * 2. Go to Extensions > Apps Script
 * 3. Replace the default Code.gs content with this entire file
 * 4. Click Deploy > New deployment
 * 5. Type: Web app
 * 6. Execute as: Me
 * 7. Who has access: Anyone
 * 8. Click Deploy, authorize when prompted
 * 9. Copy the Web app URL and paste it into CONFIG.APPS_SCRIPT_URL in app.js
 */

const SPREADSHEET_ID = '1PwjRp80UIcYZlUaswUXdbWW_8I7qhmLRWPInoJPmcJQ';
const VOTES_SHEET = 'Votes';

function getOrCreateSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(VOTES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(VOTES_SHEET);
    sheet.appendRow(['PlaceID', 'PlaceName', 'VoteType', 'Voter', 'Timestamp']);
    sheet.getRange('1:1').setFontWeight('bold');
  }
  return sheet;
}

// GET — Return aggregated votes (or record a vote if action=vote)
function doGet(e) {
  // Allow voting via GET to avoid CORS issues with POST redirects
  if (e && e.parameter && e.parameter.action === 'vote') {
    const placeId = e.parameter.placeId;
    const placeName = e.parameter.placeName || '';
    const voteType = e.parameter.voteType;
    const voter = e.parameter.voter;

    if (placeId && voteType && voter && ['up', 'down', 'none'].includes(voteType)) {
      const sheet = getOrCreateSheet();
      sheet.appendRow([placeId, placeName, voteType, voter, new Date().toISOString()]);
    }

    // After recording, return fresh vote counts (fall through)
  }

  const sheet = getOrCreateSheet();
  const data = sheet.getDataRange().getValues();
  const votes = {};

  for (let i = 1; i < data.length; i++) {
    const [placeId, , voteType, voter] = data[i];
    if (!placeId) continue;

    if (!votes[placeId]) votes[placeId] = { up: 0, down: 0, _voters: {} };

    // Each voter keeps only their latest vote per place
    const prev = votes[placeId]._voters[voter];
    if (prev && prev !== 'none') votes[placeId][prev]--;
    votes[placeId]._voters[voter] = voteType;
    if (voteType !== 'none') votes[placeId][voteType]++;
  }

  // Strip internal voter tracking before returning
  const result = {};
  Object.keys(votes).forEach((id) => {
    result[id] = { up: Math.max(0, votes[id].up), down: Math.max(0, votes[id].down) };
  });

  const json = JSON.stringify({ status: 'ok', votes: result });

  // Support JSONP callback for CORS workaround
  const callback = e && e.parameter && e.parameter.callback;
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// POST — Record a vote
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const { placeId, placeName, voteType, voter } = data;

    if (!placeId || !voteType || !voter) {
      return ContentService.createTextOutput(
        JSON.stringify({ status: 'error', message: 'Missing fields' })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (!['up', 'down'].includes(voteType)) {
      return ContentService.createTextOutput(
        JSON.stringify({ status: 'error', message: 'Invalid vote type' })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    const sheet = getOrCreateSheet();
    sheet.appendRow([placeId, placeName || '', voteType, voter, new Date().toISOString()]);

    return ContentService.createTextOutput(
      JSON.stringify({ status: 'ok' })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: 'error', message: err.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
