/**
 * Tower System VTT — Google Docs Session Chronicle Webhook
 * Folder ("Tower DnD"): https://drive.google.com/drive/folders/1fY8URu1zmJKB6sKNtDza-V0fNsGdFRNW?usp=sharing
 * Target Doc: https://docs.google.com/document/d/1uBWEitKlPfFP_Z5tmSYKqRzuForlwv1tgnnS6lyAK6U/edit
 *
 * Setup (2 minutes):
 * 1. Open your Google Doc -> Extensions -> Apps Script.
 * 2. Paste this file into Code.gs.
 * 3. Project Settings -> Script Properties -> Add:
 *    CHRONICLE_WEBHOOK_SECRET = <your-random-secret> (must match Railway GOOGLE_DOC_WEBHOOK_SECRET)
 * 4. Deploy -> New deployment -> Web app:
 *    Execute as: Me | Who has access: Anyone
 * 5. Copy the Web App URL into Railway as GOOGLE_DOC_WEBHOOK_URL.
 */

var TARGET_DOC_ID = '1uBWEitKlPfFP_Z5tmSYKqRzuForlwv1tgnnS6lyAK6U';

function getWebhookSecret() {
  var prop = PropertiesService.getScriptProperties().getProperty('CHRONICLE_WEBHOOK_SECRET');
  return prop || 'REPLACE_ME_WITH_SECRET';
}

function doPost(e) {
  try {
    var payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var expected = getWebhookSecret();
    if (!expected || expected === 'REPLACE_ME_WITH_SECRET' || payload.secret !== expected) {
      return jsonOut({ ok: false, error: 'Unauthorized webhook secret.' });
    }

    var docId = payload.docId || TARGET_DOC_ID;
    var doc = docId ? DocumentApp.openById(docId) : DocumentApp.getActiveDocument();
    var body = doc.getBody();

    if (body.getText().trim().length > 0) {
      body.appendPageBreak();
    }

    var sessionNum = payload.sessionNumber || 1;
    var chapterTitle = payload.title || ('Session #' + sessionNum);
    var heading = body.appendParagraph('Session #' + sessionNum + ' — ' + chapterTitle);
    heading.setHeading(DocumentApp.ParagraphHeading.HEADING1);

    var metaText = (payload.date || new Date().toISOString().slice(0, 10)) +
      (payload.partyNames && payload.partyNames.length ? '  •  Party: ' + payload.partyNames.join(', ') : '');
    var metaPara = body.appendParagraph(metaText);
    metaPara.editAsText().setItalic(true).setForegroundColor('#64748b').setFontSize(10);

    var lines = String(payload.markdown || '').split(/\r?\n/);
    var blocks = 0;
    var calloutBuffer = [];

    function flushCallout() {
      if (!calloutBuffer.length) return;
      var table = body.appendTable([[calloutBuffer.join('\n')]]);
      var cell = table.getRow(0).getCell(0);
      cell.setBackgroundColor('#fef9c3');
      cell.setPaddingTop(8).setPaddingBottom(8).setPaddingLeft(12).setPaddingRight(12);
      table.setBorderColor('#d97706').setBorderWidth(1.5);
      calloutBuffer = [];
      blocks++;
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf('> ') === 0) {
        calloutBuffer.push(line.slice(2).replace(/\*\*/g, ''));
        continue;
      }
      flushCallout();
      var trimmed = line.trim();
      if (!trimmed || trimmed === '---') continue;

      if (trimmed.indexOf('# ') === 0) {
        // Skip duplicate top H1 if narrator already emitted one
        continue;
      } else if (trimmed.indexOf('## ') === 0) {
        var h2 = body.appendParagraph(trimmed.slice(3).replace(/\*\*/g, ''));
        h2.setHeading(DocumentApp.ParagraphHeading.HEADING2);
        blocks++;
      } else if (trimmed.indexOf('### ') === 0) {
        var h3 = body.appendParagraph(trimmed.slice(4).replace(/\*\*/g, ''));
        h3.setHeading(DocumentApp.ParagraphHeading.HEADING3);
        blocks++;
      } else {
        var p = body.appendParagraph(trimmed.replace(/\*\*/g, ''));
        p.setSpacingAfter(6);
        blocks++;
      }
    }
    flushCallout();

    doc.saveAndClose();
    return jsonOut({ ok: true, docUrl: doc.getUrl(), appendedBlocks: blocks });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
