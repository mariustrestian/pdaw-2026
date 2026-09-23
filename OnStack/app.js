const themeToggle = document.getElementById('theme-toggle');
const content = document.getElementById('content');
const decreaseFont = document.getElementById('decrease-font');
const increaseFont = document.getElementById('increase-font');
const fontSizeValue = document.getElementById('font-size-value');
const textColor = document.getElementById('text-color');
const textOpacity = document.getElementById('text-opacity');
const opacityValue = document.getElementById('opacity-value');
const fontFamilyToggle = document.getElementById('font-family-toggle');
const fontFamilyMenu = document.getElementById('font-family-menu');
const backgroundColor = document.getElementById('background-color');
const restoreDefaults = document.getElementById('restore-defaults');
const saveFile = document.getElementById('save-file');
const selectionPanel = document.getElementById('selection-panel');
const alignmentButton = document.getElementById('alignment-button');
const alignmentMenu = document.getElementById('alignment-menu');
const logoLink = document.querySelector('.logo');
const statusRegion = document.getElementById('status');

const MIN_FONT_SIZE = 2;
const MAX_FONT_SIZE = 160;
const DEFAULT_FONT_SIZE = 24;
const LIGHT_TEXT_COLOR = '#000000';
const DARK_TEXT_COLOR = '#ffffff';
const LIGHT_BACKGROUND_COLOR = '#ffffff';
const DARK_BACKGROUND_COLOR = '#1f1f1f';
const STORAGE_KEY = 'onstack-document';
const MAX_HISTORY_ENTRIES = 100;

const formattingProperties = [
  'font-size', 'font-family', 'color', 'background-color',
  'font-weight', 'font-style', 'text-decoration-line'
];

const ALLOWED_INLINE_PROPS = new Set([...formattingProperties, 'text-align']);
const ALLOWED_CONTENT_PROPS = [
  'font-family', 'font-size', 'line-height',
  'color', 'background-color', 'padding', 'text-align'
];
const FORBIDDEN_TAGS = new Set([
  'SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'STYLE',
  'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT'
]);

const ALIGNMENT_BLOCK_TAGS = new Set([
  'DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'BLOCKQUOTE', 'PRE', 'TD', 'TH'
]);

const ALIGNMENT_VALUES = new Set(['left', 'center', 'right', 'justify']);

const fontFamilies = [
  'Georgia', 'Arial', 'Verdana', 'Courier New', 'Trebuchet MS', 'Times New Roman',
  'Helvetica', 'Tahoma', 'Calibri', 'Cambria', 'Candara', 'Century Gothic',
  'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Franklin Gothic Medium',
  'Garamond', 'Gill Sans', 'Impact', 'Lucida Console', 'Lucida Sans Unicode',
  'Palatino Linotype', 'Rockwell', 'Segoe Print', 'Segoe Script', 'Segoe UI',
  'Baskerville', 'Book Antiqua', 'Arial Black', 'Brush Script MT', 'Copperplate',
  'Didot', 'Futura', 'Monaco', 'Optima', 'Courier'
];

let fontSize = DEFAULT_FONT_SIZE;
let savedRange = null;
let hasCustomTextColor = false;
let hasCustomBackgroundColor = false;
let preservingToolbarSelection = false;
let suppressSelectionSync = false;
let suppressPersistence = false;
const formattingUndoStack = [];
const formattingRedoStack = [];
let restoringFormattingHistory = false;
let persistenceTimer = null;
let typingHistoryRecorded = false;
let typingHistoryTimer = null;
let selectedFontFamily = fontFamilies[0];
let pendingColorSnapshot = null;
let opacityChangeRecorded = false;
let statusTimer = null;

/* ---------- Utilities ---------- */

function isDarkTheme() {
  return document.body.classList.contains('dark');
}

function themeTextColor() {
  return isDarkTheme() ? DARK_TEXT_COLOR : LIGHT_TEXT_COLOR;
}

function themeBackgroundColor() {
  return isDarkTheme() ? DARK_BACKGROUND_COLOR : LIGHT_BACKGROUND_COLOR;
}

function normalizeHexColor(value) {
  return String(value || '').trim().toLowerCase();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getEventTargetElement(target) {
  if (!target) return null;
  if (target instanceof Element) return target;
  if (target instanceof Node && target.parentElement) return target.parentElement;
  return null;
}

function announceStatus(message) {
  if (!statusRegion) return;
  clearTimeout(statusTimer);
  statusRegion.textContent = '';
  statusTimer = setTimeout(() => {
    statusRegion.textContent = message;
  }, 60);
}

/* ---------- Sanitization ---------- */

function sanitizeStyleValue(styleText, allowedProps) {
  if (!styleText) return '';
  const scratch = document.createElement('span');
  scratch.style.cssText = styleText;
  const parts = [];
  allowedProps.forEach((prop) => {
    const value = scratch.style.getPropertyValue(prop);
    if (!value) return;
    if (/url\s*\(|expression\s*\(|javascript:/i.test(value)) return;
    parts.push(`${prop}: ${value}`);
  });
  return parts.join('; ');
}

function sanitizeInlineStyle(styleText) {
  return sanitizeStyleValue(styleText, [...ALLOWED_INLINE_PROPS]);
}

function sanitizeContentStyle(styleText) {
  return sanitizeStyleValue(styleText, ALLOWED_CONTENT_PROPS);
}

function sanitizeEditorHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('*').forEach((element) => {
    if (FORBIDDEN_TAGS.has(element.tagName)) {
      element.remove();
      return;
    }
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
        return;
      }
      if (name === 'style') {
        const sanitized = sanitizeInlineStyle(value);
        if (sanitized) element.setAttribute('style', sanitized);
        else element.removeAttribute('style');
        return;
      }
      if (name === 'src' || name === 'href') {
        const trimmed = value.trim();
        if (!/^(https?:|mailto:|tel:|data:image\/)/i.test(trimmed)) {
          element.removeAttribute(attribute.name);
        }
        return;
      }
      if (/javascript:/i.test(value)) {
        element.removeAttribute(attribute.name);
      }
    });
  });
  return template.innerHTML;
}

/* ---------- Editor state ---------- */

function editorSpansWithProperty(property) {
  return [...content.querySelectorAll('span')]
    .filter((span) => span.style.getPropertyValue(property));
}

function updateEditorEmptyState() {
  const text = content.textContent.replace(/\u00a0/g, '').trim();
  const hasStructure = content.querySelector('br, img, hr, video, audio, table, div, p');
  content.classList.toggle('is-empty', !text && !hasStructure);
}

function updateCustomColorFlags() {
  hasCustomTextColor = normalizeHexColor(textColor.value) !== themeTextColor()
    || String(textOpacity.value) !== '100';
  hasCustomBackgroundColor = normalizeHexColor(backgroundColor.value) !== themeBackgroundColor();
}

/* ---------- Persistence ---------- */

function saveDocument() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      html: sanitizeEditorHtml(content.innerHTML),
      contentStyle: content.getAttribute('style') || '',
      textColor: textColor.value,
      textOpacity: textOpacity.value,
      backgroundColor: backgroundColor.value,
      darkTheme: isDarkTheme(),
      hasCustomTextColor,
      hasCustomBackgroundColor,
      selectedFontFamily
    }));
  } catch (error) {
    console.error('OnStack could not save the document.', error);
    if (error && (error.name === 'QuotaExceededError' || error.code === 22)) {
      announceStatus('Storage is full. Changes are not being saved.');
    } else {
      announceStatus('Save failed. Changes are not being saved.');
    }
  }
}

function scheduleSave() {
  if (suppressPersistence) return;
  clearTimeout(persistenceTimer);
  persistenceTimer = setTimeout(saveDocument, 150);
}

function restoreDocument() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved) return;

    if (typeof saved.html === 'string') {
      content.innerHTML = sanitizeEditorHtml(saved.html);
    }
    if (typeof saved.contentStyle === 'string') {
      const sanitized = sanitizeContentStyle(saved.contentStyle);
      if (sanitized) content.setAttribute('style', sanitized);
      else content.removeAttribute('style');
    }
    if (typeof saved.textColor === 'string') textColor.value = saved.textColor;
    if (typeof saved.textOpacity === 'string') textOpacity.value = saved.textOpacity;
    if (typeof saved.backgroundColor === 'string') backgroundColor.value = saved.backgroundColor;

    hasCustomTextColor = saved.hasCustomTextColor === true;
    if (typeof saved.hasCustomBackgroundColor === 'boolean') {
      hasCustomBackgroundColor = saved.hasCustomBackgroundColor;
    } else {
      const savedStyle = saved.contentStyle || '';
      const savedBackground = String(saved.backgroundColor || '').toLowerCase();
      const styleBackground = savedStyle.match(/background-color\s*:\s*([^;]+)/i);
      const styleBackgroundValue = styleBackground ? styleBackground[1].trim().toLowerCase() : '';
      hasCustomBackgroundColor = Boolean(
        (styleBackgroundValue && !['#ffffff', '#1f1f1f', 'rgb(255, 255, 255)', 'rgb(31, 31, 31)']
          .includes(styleBackgroundValue))
        || (savedBackground && !['#ffffff', '#1f1f1f'].includes(savedBackground))
      );
    }

    if (saved.darkTheme) {
      document.body.classList.add('dark');
      document.documentElement.classList.add('dark');
    }
    if (fontFamilies.includes(saved.selectedFontFamily)) {
      selectedFontFamily = saved.selectedFontFamily;
    }
    opacityValue.textContent = `${textOpacity.value}%`;
  } catch (error) {
    console.error('OnStack could not restore the saved document.', error);
    announceStatus('Could not restore the saved document.');
  }
}

function restoreDefaultDocument() {
  flushPendingColorSnapshot();
  suppressPersistence = true;
  clearTimeout(persistenceTimer);
  persistenceTimer = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('OnStack could not clear saved data.', error);
  }

  content.innerHTML = '';
  content.removeAttribute('style');
  textColor.value = '#000000';
  textOpacity.value = '100';
  opacityValue.textContent = '100%';
  backgroundColor.value = '#ffffff';
  fontSize = DEFAULT_FONT_SIZE;
  hasCustomTextColor = false;
  hasCustomBackgroundColor = false;
  selectedFontFamily = fontFamilies[0];

  document.body.classList.remove('dark');
  document.documentElement.classList.remove('dark');
  updateThemeToggle(false);

  formattingUndoStack.length = 0;
  formattingRedoStack.length = 0;
  savedRange = null;
  pendingColorSnapshot = null;
  hideSelectionPanel();
  closeAlignmentMenu();
  updateFontControls();
  setSelectedFontFamily(selectedFontFamily);
  updateEditorEmptyState();
  content.focus();
  suppressPersistence = false;
  announceStatus('Editor restored to defaults.');
}

/* ---------- Theme ---------- */

function updateThemeToggle(isDark) {
  themeToggle.innerHTML = isDark
    ? '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M23 5a12 12 0 1 0 0 22A9 9 0 1 1 23 5Z"></path></svg>'
    : '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="6"></circle><path class="sun-rays" d="M16 2v5M16 25v5M2 16h5M25 16h5M6.1 6.1l3.5 3.5M22.4 22.4l3.5 3.5M25.9 6.1l-3.5 3.5M9.6 22.4l-3.5 3.5"></path></svg>';
  themeToggle.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
  themeToggle.title = isDark ? 'Switch to light theme' : 'Switch to dark theme';
  themeToggle.setAttribute('aria-pressed', String(isDark));
}

function applyThemeBackground(isDark) {
  const color = isDark ? DARK_BACKGROUND_COLOR : LIGHT_BACKGROUND_COLOR;
  backgroundColor.value = color;
  content.style.backgroundColor = color;
}

/* ---------- Export ---------- */

function downloadDocument() {
  const computed = getComputedStyle(content);
  const exportedStyles = [
    'box-sizing: border-box',
    `font-family: ${computed.fontFamily}`,
    `font-size: ${computed.fontSize}`,
    `line-height: ${computed.lineHeight}`,
    `color: ${computed.color}`,
    `background-color: ${computed.backgroundColor}`,
    `text-align: ${computed.textAlign}`,
    `padding: ${computed.padding}`,
    `max-width: ${computed.maxWidth}`,
    'margin: 0 auto'
  ].join('; ');
  const styleAttribute = ` style="${exportedStyles.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
  const exportedDocument = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OnStack Document</title>
</head>
<body>
<main${styleAttribute}>${sanitizeEditorHtml(content.innerHTML)}</main>
</body>
</html>`;
  const blob = new Blob([exportedDocument], { type: 'text/html;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'onstack-document.html';
  link.click();
  URL.revokeObjectURL(link.href);
}

/* ---------- Font menu ---------- */

fontFamilies.forEach((family) => {
  const option = document.createElement('button');
  option.className = 'font-family-option';
  option.type = 'button';
  option.dataset.fontFamily = family;
  option.setAttribute('role', 'menuitem');
  option.title = `Use ${family}`;
  option.textContent = family;
  option.style.fontFamily = family;
  fontFamilyMenu.appendChild(option);
});

function setSelectedFontFamily(family) {
  selectedFontFamily = family;
  fontFamilyToggle.style.fontFamily = family;
  fontFamilyToggle.title = family;
  fontFamilyMenu.querySelectorAll('.font-family-option').forEach((option) => {
    option.setAttribute('aria-selected', String(option.dataset.fontFamily === family));
  });
}

function closeFontFamilyMenu() {
  if (!fontFamilyMenu.classList.contains('is-open')) return;
  fontFamilyMenu.classList.remove('is-open');
  fontFamilyToggle.setAttribute('aria-expanded', 'false');
  preservingToolbarSelection = false;
}

function openFontFamilyMenu() {
  fontFamilyMenu.classList.add('is-open');
  fontFamilyToggle.setAttribute('aria-expanded', 'true');
  if (savedRange) preservingToolbarSelection = true;
}

/* ---------- Alignment menu ---------- */

function closeAlignmentMenu() {
  if (!alignmentMenu.classList.contains('is-open')) return;
  alignmentMenu.classList.remove('is-open');
  alignmentMenu.setAttribute('aria-hidden', 'true');
  alignmentButton.setAttribute('aria-expanded', 'false');
}

/**
 * Recompute the alignment menu's fixed position based on the current
 * location of the alignment button. Safe to call at any time — it does
 * nothing if the menu is not open.
 */
function updateAlignmentMenuPosition() {
  if (!alignmentMenu.classList.contains('is-open')) return;
  const buttonRect = alignmentButton.getBoundingClientRect();
  const menuRect = alignmentMenu.getBoundingClientRect();
  let left = buttonRect.left + (buttonRect.width - menuRect.width) / 2;
  left = Math.max(8, Math.min(window.innerWidth - menuRect.width - 8, left));
  let top = buttonRect.bottom + 6;
  if (top + menuRect.height > window.innerHeight - 8) {
    top = Math.max(8, buttonRect.top - menuRect.height - 6);
  }
  alignmentMenu.style.left = `${left}px`;
  alignmentMenu.style.top = `${top}px`;
}

function openAlignmentMenu() {
  alignmentMenu.classList.add('is-open');
  alignmentMenu.setAttribute('aria-hidden', 'false');
  alignmentButton.setAttribute('aria-expanded', 'true');
  updateAlignmentMenuPosition();
  updateAlignmentMenuState();
}

/**
 * Returns the block-level ancestors inside #content that intersect the range.
 */
function alignmentBlocksForRange(range) {
  if (!range) return [];
  const blocks = new Set();
  const root = content;

  const consider = (node) => {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el && el !== root) {
      if (ALIGNMENT_BLOCK_TAGS.has(el.tagName)) {
        blocks.add(el);
        return;
      }
      el = el.parentElement;
    }
  };

  consider(range.startContainer);
  consider(range.endContainer);

  root.querySelectorAll([...ALIGNMENT_BLOCK_TAGS].join(',').toLowerCase())
    .forEach((el) => {
      try {
        if (range.intersectsNode(el)) blocks.add(el);
      } catch (error) { /* ignore */ }
    });

  return [...blocks];
}

/**
 * Walk up from `node` to the direct child of `root` that contains it.
 * When `node` is `root` itself, uses `offset` to pick the child. Returns
 * null if the node is not inside root.
 */
function topLevelChildOf(root, node, offset) {
  if (!node) return null;
  if (node === root) {
    const children = root.childNodes;
    if (!children.length) return null;
    const index = typeof offset === 'number'
      ? Math.min(Math.max(offset, 0), children.length - 1)
      : 0;
    return children[index] || children[children.length - 1];
  }
  let current = node;
  while (current && current.parentNode && current.parentNode !== root) {
    current = current.parentNode;
  }
  return current && current.parentNode === root ? current : null;
}

function currentAlignmentTarget() {
  const range = getSelectedRange();
  if (!range) return content;
  const blocks = alignmentBlocksForRange(range);
  if (blocks.length) return blocks[0];
  return content;
}

function applyAlignment(alignment) {
  if (!ALIGNMENT_VALUES.has(alignment)) return false;
  const range = getSelectedRange();
  if (!range) return false;

  const blocks = alignmentBlocksForRange(range);
  recordFormattingChange();

  if (blocks.length) {
    blocks.forEach((block) => {
      block.style.textAlign = alignment;
    });
    return true;
  }

  // No block ancestor: wrap the intersecting top-level children of #content
  // in a <div> so text-align is scoped to those lines only, instead of
  // silently aligning the whole document.
  try {
    const startChild = topLevelChildOf(content, range.startContainer, range.startOffset);
    const endChild = topLevelChildOf(content, range.endContainer, range.endOffset);
    if (startChild && endChild && startChild.parentNode === content) {
      const wrapper = document.createElement('div');
      wrapper.style.textAlign = alignment;
      content.insertBefore(wrapper, startChild);
      let node = startChild;
      while (node) {
        const next = node.nextSibling;
        const isEnd = node === endChild;
        wrapper.appendChild(node);
        if (isEnd) break;
        node = next;
      }
      const newRange = document.createRange();
      newRange.selectNodeContents(wrapper);
      restoreRange(newRange);
      return true;
    }
  } catch (error) {
    console.warn('Alignment wrap failed; falling back to whole-editor alignment.', error);
  }

  // Last resort: apply to the whole editor (matches previous behavior).
  content.style.textAlign = alignment;
  return true;
}

function updateAlignmentMenuState() {
  const target = currentAlignmentTarget();
  const computed = getComputedStyle(target);
  const current = (computed.textAlign || 'left').toLowerCase();
  const normalized = current === 'start' ? 'left' : current === 'end' ? 'right' : current;
  alignmentMenu.querySelectorAll('button[data-alignment]').forEach((button) => {
    button.setAttribute('aria-checked', String(button.dataset.alignment === normalized));
  });
}

/* ---------- Selection helpers ---------- */

function isRangeInEditor(range) {
  return range
    && content.contains(range.commonAncestorContainer)
    && content.contains(range.startContainer)
    && content.contains(range.endContainer);
}

function currentSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  return isRangeInEditor(range) ? range : null;
}

function getSelectedRange(useSavedRange = true) {
  const liveRange = currentSelection();
  if (liveRange) return liveRange;
  if (useSavedRange && isRangeInEditor(savedRange)) return savedRange;
  return null;
}

function restoreRange(range) {
  if (!range || !isRangeInEditor(range)) return;
  try {
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    savedRange = range.cloneRange();
  } catch (error) {
    savedRange = null;
  }
}

function createRangeMarkers(range) {
  const startMarker = document.createElement('i');
  const endMarker = document.createElement('i');
  startMarker.dataset.selectionMarker = 'start';
  endMarker.dataset.selectionMarker = 'end';

  const endBoundary = range.cloneRange();
  endBoundary.collapse(false);
  endBoundary.insertNode(endMarker);

  const startBoundary = range.cloneRange();
  startBoundary.collapse(true);
  startBoundary.insertNode(startMarker);

  return { startMarker, endMarker };
}

function textNodesBetweenMarkers(startMarker, endMarker) {
  const textNodes = [];
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const afterStart = Boolean(startMarker.compareDocumentPosition(node)
      & Node.DOCUMENT_POSITION_FOLLOWING);
    const beforeEnd = Boolean(node.compareDocumentPosition(endMarker)
      & Node.DOCUMENT_POSITION_FOLLOWING);
    if (afterStart && beforeEnd && node.textContent) textNodes.push(node);
  }
  return textNodes;
}

function restoreMarkedRange(startMarker, endMarker) {
  const normalizedRange = document.createRange();
  normalizedRange.setStartAfter(startMarker);
  normalizedRange.setEndBefore(endMarker);
  startMarker.remove();
  endMarker.remove();
  restoreRange(normalizedRange);
}

/* ---------- History ---------- */

function snapshotNodeLength(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent.length;
  if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') return 1;
  return [...node.childNodes].reduce((total, child) => total + snapshotNodeLength(child), 0);
}

function captureFormattingSnapshot() {
  const range = getSelectedRange();
  const boundaryOffset = (container, offset, root = content) => {
    if (root === container) {
      if (container.nodeType === Node.TEXT_NODE) return offset;
      return [...container.childNodes]
        .slice(0, offset)
        .reduce((total, child) => total + snapshotNodeLength(child), 0);
    }
    let total = 0;
    for (const child of root.childNodes) {
      if (child === container || child.contains(container)) {
        return total + boundaryOffset(container, offset, child);
      }
      total += snapshotNodeLength(child);
    }
    return total;
  };
  return {
    html: content.innerHTML,
    contentStyle: content.getAttribute('style') || '',
    start: range ? boundaryOffset(range.startContainer, range.startOffset) : null,
    end: range ? boundaryOffset(range.endContainer, range.endOffset) : null
  };
}

function pushFormattingSnapshot(snapshot) {
  // If a color-picker interaction is still "in progress", commit its
  // starting snapshot first so the color change becomes its own undo step.
  if (pendingColorSnapshot) {
    formattingUndoStack.push(pendingColorSnapshot);
    pendingColorSnapshot = null;
    if (formattingUndoStack.length > MAX_HISTORY_ENTRIES) formattingUndoStack.shift();
  }
  formattingUndoStack.push(snapshot);
  if (formattingUndoStack.length > MAX_HISTORY_ENTRIES) formattingUndoStack.shift();
  formattingRedoStack.length = 0;
  typingHistoryRecorded = false;
  clearTimeout(typingHistoryTimer);
}

function recordFormattingChange() {
  if (restoringFormattingHistory) return;
  pushFormattingSnapshot(captureFormattingSnapshot());
}

function restoreFormattingSnapshot(snapshot) {
  restoringFormattingHistory = true;
  content.innerHTML = snapshot.html;
  if (snapshot.contentStyle) content.setAttribute('style', snapshot.contentStyle);
  else content.removeAttribute('style');
  content.focus();
  const range = document.createRange();
  const locateBoundary = (offset) => {
    const walker = document.createTreeWalker(
      content,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
          if (node.tagName === 'BR') return NodeFilter.FILTER_ACCEPT;
          return NodeFilter.FILTER_SKIP;
        }
      }
    );
    let remaining = offset;
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const parent = node.parentNode;
        const index = [...parent.childNodes].indexOf(node);
        if (remaining === 0) return [parent, index];
        if (remaining <= 1) return [parent, index + 1];
        remaining -= 1;
        continue;
      }
      if (remaining <= node.textContent.length) return [node, remaining];
      remaining -= node.textContent.length;
    }
    return [content, content.childNodes.length];
  };
  const start = locateBoundary(snapshot.start ?? 0);
  const end = locateBoundary(snapshot.end ?? snapshot.start ?? 0);
  range.setStart(...start);
  range.setEnd(...end);
  restoreRange(range);
  restoringFormattingHistory = false;
  syncToolbarFromCurrentState();
  updateEditorEmptyState();
}

function undoFormattingChange() {
  flushPendingColorSnapshot();
  if (!formattingUndoStack.length) return false;
  formattingRedoStack.push(captureFormattingSnapshot());
  restoreFormattingSnapshot(formattingUndoStack.pop());
  return true;
}

function redoFormattingChange() {
  if (!formattingRedoStack.length) return false;
  formattingUndoStack.push(captureFormattingSnapshot());
  restoreFormattingSnapshot(formattingRedoStack.pop());
  return true;
}

/* ---------- Formatting operations ---------- */

function removeInlineProperty(fragment, property) {
  fragment.querySelectorAll('[style]').forEach((element) => {
    element.style.removeProperty(property);
    if (!element.style.length) element.removeAttribute('style');
  });
}

function styleTextNodes(fragment, property, value) {
  const textNodes = [];
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.textContent) textNodes.push(node);
  }

  textNodes.reverse().forEach((textNode) => {
    const parent = textNode.parentElement;
    if (parent && parent.tagName === 'SPAN' && parent.childNodes.length === 1) {
      parent.style.setProperty(property, value);
      return;
    }
    const span = document.createElement('span');
    span.style.setProperty(property, value);
    textNode.replaceWith(span);
    span.appendChild(textNode);
  });
}

function normalizeSpans() {
  content.querySelectorAll('span').forEach((span) => {
    if (!span.style.length) span.replaceWith(...span.childNodes);
  });

  [...content.querySelectorAll('span')].forEach((span) => {
    const parent = span.parentElement;
    if (!parent || parent.tagName !== 'SPAN') return;
    formattingProperties.forEach((property) => {
      if (!span.style.getPropertyValue(property) && parent.style.getPropertyValue(property)) {
        span.style.setProperty(property, parent.style.getPropertyValue(property));
      }
    });
  });

  [...content.querySelectorAll('span')].forEach((span) => {
    if (![...span.children].some((child) => child.tagName === 'SPAN')) return;
    [...span.childNodes].forEach((child) => {
      if (child.nodeType !== Node.TEXT_NODE || !child.textContent.trim()) return;
      const textSpan = document.createElement('span');
      textSpan.style.cssText = span.style.cssText;
      textSpan.textContent = child.textContent;
      child.replaceWith(textSpan);
    });
  });

  [...content.querySelectorAll('span')].reverse().forEach((span) => {
    const containsOnlyInlineSpans = [...span.childNodes].every((child) => {
      if (child.nodeType === Node.TEXT_NODE) return !child.textContent.trim();
      return child.nodeType === Node.ELEMENT_NODE
        && (child.tagName === 'SPAN' || child.dataset.selectionMarker);
    });
    if (containsOnlyInlineSpans) span.replaceWith(...span.childNodes);
  });

  content.querySelectorAll('span').forEach((span) => {
    const next = span.nextSibling;
    if (next && next.nodeType === Node.ELEMENT_NODE && next.tagName === 'SPAN'
      && span.getAttribute('style') === next.getAttribute('style')) {
      while (next.firstChild) span.appendChild(next.firstChild);
      next.remove();
    }
  });
}

function normalizeSpansPreservingRange(range) {
  const { startMarker, endMarker } = createRangeMarkers(range);
  normalizeSpans();
  restoreMarkedRange(startMarker, endMarker);
}

function wrapSelection(property, value) {
  const range = getSelectedRange();
  if (!range) return false;

  const parent = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer
    : range.startContainer.parentElement;
  const existingSpan = parent && parent.closest('span');
  if (existingSpan && existingSpan.contains(range.endContainer)
    && range.toString() === existingSpan.textContent) {
    existingSpan.style.setProperty(property, value);
    restoreRange(range);
    return true;
  }

  const fragment = range.extractContents();
  removeInlineProperty(fragment, property);

  if (fragment.querySelector('div, p, h1, h2, h3, h4, h5, h6, li, blockquote')) {
    styleTextNodes(fragment, property, value);
    const firstInsertedNode = fragment.firstChild;
    const lastInsertedNode = fragment.lastChild;
    range.insertNode(fragment);
    if (firstInsertedNode && lastInsertedNode) {
      range.setStartBefore(firstInsertedNode);
      range.setEndAfter(lastInsertedNode);
      normalizeSpansPreservingRange(range);
    }
    return true;
  }

  const span = document.createElement('span');
  span.style.setProperty(property, value);
  span.appendChild(fragment);
  range.insertNode(span);
  range.selectNodeContents(span);
  normalizeSpansPreservingRange(range);
  return true;
}

/* ---------- Toolbar sync ---------- */

function textNodesInRange(range) {
  const textNodes = [];
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!node.textContent) continue;
    if (range.intersectsNode(node)) textNodes.push(node);
  }
  return textNodes;
}

function propertyIsActive(computed, property, value) {
  const current = computed.getPropertyValue(property);
  if (property === 'text-decoration-line') return current.split(' ').includes(value);
  if (property === 'font-weight') return current === value || Number(current) >= 600;
  return current === value;
}

function updateControlsFromComputed(computed) {
  const selectedSize = parseInt(computed.fontSize, 10);
  if (selectedSize) {
    fontSize = clamp(selectedSize, MIN_FONT_SIZE, MAX_FONT_SIZE);
    updateFontControls();
  }
  updateColorControls(computed.color);
  const computedFamily = computed.fontFamily.replace(/["']/g, '').split(',')[0].trim();
  if (fontFamilies.includes(computedFamily)) setSelectedFontFamily(computedFamily);
}

function syncToolbarFromCurrentState() {
  const selection = window.getSelection();
  const liveRange = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
  const range = (liveRange && isRangeInEditor(liveRange) && liveRange)
    || (isRangeInEditor(savedRange) ? savedRange : null);
  if (range) {
    updateControlsFromSelection(range);
    if (!range.collapsed) updateSelectionPanel(range);
    else hideSelectionPanel();
    return;
  }
  updateControlsFromComputed(getComputedStyle(content));
  hideSelectionPanel();
}

function updateFontControls() {
  fontSizeValue.value = fontSize;
  decreaseFont.disabled = fontSize <= MIN_FONT_SIZE;
  increaseFont.disabled = fontSize >= MAX_FONT_SIZE;
}

function updateColorControls(color) {
  const match = color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)/);
  if (!match) return;
  const [, red, green, blue, alpha = '1'] = match;
  textColor.value = `#${[red, green, blue]
    .map((channel) => Number(channel).toString(16).padStart(2, '0'))
    .join('')}`;
  textOpacity.value = Math.round(Number(alpha) * 100);
  opacityValue.textContent = `${textOpacity.value}%`;
}

function updateControlsFromSelection(range) {
  let container = range.startContainer;
  if (container.nodeType === Node.ELEMENT_NODE) {
    container = container.childNodes[range.startOffset] || container.lastChild || container;
    while (container.nodeType === Node.ELEMENT_NODE && container.firstChild) {
      container = container.firstChild;
    }
  }
  container = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
  const styledElement = container && container.closest('span');
  updateControlsFromComputed(getComputedStyle(styledElement || content));
}

function updateSelectionPanel(range) {
  if (!range) return;
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) {
    hideSelectionPanel();
    return;
  }

  selectionPanel.classList.add('is-visible');
  selectionPanel.setAttribute('aria-hidden', 'false');

  const panelRect = selectionPanel.getBoundingClientRect();
  const left = Math.max(8, Math.min(
    window.innerWidth - panelRect.width - 8,
    rect.left + (rect.width - panelRect.width) / 2
  ));
  const top = rect.top >= panelRect.height + 12
    ? rect.top - panelRect.height - 8
    : rect.bottom + 8;
  selectionPanel.style.left = `${left}px`;
  selectionPanel.style.top = `${Math.max(
    8,
    Math.min(window.innerHeight - panelRect.height - 8, top)
  )}px`;

  const nodes = textNodesInRange(range);
  const uniqueStyles = new Map();
  if (nodes.length) {
    nodes.forEach((node) => {
      const parent = node.parentElement || content;
      if (!uniqueStyles.has(parent)) uniqueStyles.set(parent, getComputedStyle(parent));
    });
  } else {
    const container = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer
      : range.startContainer.parentElement;
    const styledElement = container && container.closest('span');
    uniqueStyles.set(styledElement || content, getComputedStyle(styledElement || content));
  }
  const styles = [...uniqueStyles.values()];

  selectionPanel.querySelectorAll('button[data-style-property]').forEach((button) => {
    const property = button.dataset.styleProperty;
    const value = button.dataset.styleValue;
    const isActive = styles.every((computed) => propertyIsActive(computed, property, value));
    button.classList.toggle('is-active', isActive);
  });

  if (alignmentMenu.classList.contains('is-open')) {
    updateAlignmentMenuState();
  }
}

function hideSelectionPanel() {
  selectionPanel.classList.remove('is-visible');
  selectionPanel.setAttribute('aria-hidden', 'true');
  closeAlignmentMenu();
}

/* ---------- Toggle helpers ---------- */

function toggleStyleProperty(property, value) {
  const range = getSelectedRange();
  if (!range) return false;

  const container = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer
    : range.startContainer.parentElement;
  const styledElement = container && container.closest('span');
  const computed = getComputedStyle(styledElement || content);
  const current = computed.getPropertyValue(property);

  const isActive = property === 'text-decoration-line'
    ? current.split(' ').includes(value)
    : current === value || (property === 'font-weight' && Number(current) >= 600);

  const nextValue = property === 'font-weight'
    ? (isActive ? '400' : value)
    : property === 'font-style'
      ? (isActive ? 'normal' : value)
      : (() => {
        const decorations = current.split(/\s+/).filter((item) => item && item !== 'none');
        return isActive
          ? decorations.filter((item) => item !== value).join(' ') || 'none'
          : [...decorations, value].join(' ');
      })();

  recordFormattingChange();
  wrapSelection(property, nextValue);
  return true;
}

/* ---------- Font size ---------- */

function applyFontSize(size) {
  recordFormattingChange();
  const value = `${clamp(size, MIN_FONT_SIZE, MAX_FONT_SIZE)}px`;
  if (!wrapSelection('font-size', value)) content.style.fontSize = value;
}

function applyFontSizeDeltaToSelection(delta) {
  const range = getSelectedRange();
  if (!range) return false;

  const { startMarker, endMarker } = createRangeMarkers(range);
  const textNodes = textNodesBetweenMarkers(startMarker, endMarker);

  textNodes.reverse().forEach((textNode) => {
    const parent = textNode.parentElement;
    const currentSize = parseFloat(getComputedStyle(parent).fontSize);
    const nextSize = clamp(currentSize + delta, MIN_FONT_SIZE, MAX_FONT_SIZE);
    if (parent.tagName === 'SPAN' && parent.childNodes.length === 1) {
      parent.style.setProperty('font-size', `${nextSize}px`);
      return;
    }
    const span = document.createElement('span');
    span.style.setProperty('font-size', `${nextSize}px`);
    textNode.replaceWith(span);
    span.appendChild(textNode);
  });

  normalizeSpans();
  restoreMarkedRange(startMarker, endMarker);
  return true;
}

function explicitFontSizes() {
  return [
    parseFloat(getComputedStyle(content).fontSize),
    ...editorSpansWithProperty('font-size').map((span) => parseFloat(span.style.fontSize))
  ];
}

function applyGlobalFontDelta(delta) {
  content.style.fontSize = `${clamp(parseFloat(getComputedStyle(content).fontSize) + delta, MIN_FONT_SIZE, MAX_FONT_SIZE)}px`;
  editorSpansWithProperty('font-size').forEach((span) => {
    span.style.fontSize = `${clamp(parseFloat(span.style.fontSize) + delta, MIN_FONT_SIZE, MAX_FONT_SIZE)}px`;
  });
  normalizeSpans();
  const sizes = explicitFontSizes();
  fontSize = Math.round(delta < 0 ? Math.min(...sizes) : Math.max(...sizes));
  updateFontControls();
}

function changeFontSize(delta) {
  const currentSize = parseFloat(getComputedStyle(content).fontSize);
  const selectedRange = getSelectedRange();
  if (!selectedRange
    && ((delta < 0 && currentSize <= MIN_FONT_SIZE) || (delta > 0 && currentSize >= MAX_FONT_SIZE))) {
    return;
  }
  const beforeHTML = content.innerHTML;
  recordFormattingChange();
  if (selectedRange) {
    if (applyFontSizeDeltaToSelection(delta)) {
      if (content.innerHTML === beforeHTML) {
        formattingUndoStack.pop();
        return;
      }
      const sizes = editorSpansWithProperty('font-size')
        .map((span) => parseFloat(span.style.fontSize))
        .filter(Number.isFinite);
      fontSize = sizes.length
        ? Math.round(delta < 0 ? Math.min(...sizes) : Math.max(...sizes))
        : clamp(fontSize + delta, MIN_FONT_SIZE, MAX_FONT_SIZE);
      updateFontControls();
    }
    return;
  }
  applyGlobalFontDelta(delta);
}

/* ---------- Colors ---------- */

function hexToRgb(hex) {
  const value = hex.slice(1);
  return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
}

function getRgbaColor() {
  const [red, green, blue] = hexToRgb(textColor.value);
  return `rgba(${red}, ${green}, ${blue}, ${Number(textOpacity.value) / 100})`;
}

function colorChannels(color) {
  const match = color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+[\d.]+)?\s*\)/);
  return match ? match.slice(1, 4).map(Number) : null;
}

function rgbaFromChannels(channels) {
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${Number(textOpacity.value) / 100})`;
}

function applyOpacityToSelection() {
  const range = getSelectedRange();
  if (!range) return false;

  const { startMarker, endMarker } = createRangeMarkers(range);
  const textNodes = textNodesBetweenMarkers(startMarker, endMarker);

  textNodes.reverse().forEach((textNode) => {
    const parent = textNode.parentElement;
    const channels = colorChannels(getComputedStyle(parent).color);
    if (!channels) return;
    const color = rgbaFromChannels(channels);
    if (parent.tagName === 'SPAN' && parent.childNodes.length === 1) {
      parent.style.setProperty('color', color);
      return;
    }
    const span = document.createElement('span');
    span.style.setProperty('color', color);
    textNode.replaceWith(span);
    span.appendChild(textNode);
  });

  normalizeSpans();
  restoreMarkedRange(startMarker, endMarker);
  return true;
}

function applyThemeTextColor(hexColor) {
  const [red, green, blue] = hexToRgb(hexColor);
  const color = `rgba(${red}, ${green}, ${blue}, ${Number(textOpacity.value) / 100})`;
  content.style.color = color;
  textColor.value = hexColor;
}

function applyTextColor() {
  const color = getRgbaColor();
  if (!wrapSelection('color', color)) content.style.color = color;
}

function applyBackgroundColor() {
  content.style.backgroundColor = backgroundColor.value;
}

function applyGlobalTextOpacity() {
  const contentColor = colorChannels(getComputedStyle(content).color);
  if (contentColor) content.style.color = rgbaFromChannels(contentColor);
}

/**
 * Commit any pending color-picker snapshot to the undo stack. Safe to call
 * at any time; does nothing if there is no pending snapshot.
 */
function flushPendingColorSnapshot() {
  if (!pendingColorSnapshot) return;
  pushFormattingSnapshot(pendingColorSnapshot);
  pendingColorSnapshot = null;
}

/* ---------- Selection observer ---------- */

document.addEventListener('selectionchange', () => {
  const range = currentSelection();
  if (range) {
    savedRange = range.cloneRange();
    const toolbarHasFocus = document.querySelector('.header-controls').contains(document.activeElement);
    if (!toolbarHasFocus && !preservingToolbarSelection && !suppressSelectionSync) {
      updateControlsFromSelection(range);
    }
    updateSelectionPanel(range);
    return;
  }

  const toolbarHasFocus = document.querySelector('.header-controls').contains(document.activeElement);
  if (!preservingToolbarSelection && !toolbarHasFocus) {
    savedRange = null;
    hideSelectionPanel();
  }
});

/* ---------- Selection panel events ---------- */

selectionPanel.addEventListener('pointerdown', (event) => {
  const target = getEventTargetElement(event.target);
  if (target && target.closest('button[data-style-property], #alignment-button')) {
    preservingToolbarSelection = true;
  }
});

selectionPanel.addEventListener('click', (event) => {
  const target = getEventTargetElement(event.target);

  const alignBtn = target && target.closest('#alignment-button');
  if (alignBtn) {
    if (alignmentMenu.classList.contains('is-open')) {
      closeAlignmentMenu();
    } else {
      if (savedRange) preservingToolbarSelection = true;
      openAlignmentMenu();
    }
    return;
  }

  const button = target && target.closest('button[data-style-property]');
  if (!button) {
    preservingToolbarSelection = false;
    return;
  }
  const property = button.dataset.styleProperty;
  const value = button.dataset.styleValue;
  if (!toggleStyleProperty(property, value)) {
    preservingToolbarSelection = false;
    return;
  }
  updateSelectionPanel(getSelectedRange());
  setTimeout(() => {
    preservingToolbarSelection = false;
  }, 0);
});

/* ---------- Alignment menu events ---------- */

alignmentMenu.addEventListener('pointerdown', (event) => {
  const target = getEventTargetElement(event.target);
  if (target && target.closest('button[data-alignment]')) {
    preservingToolbarSelection = true;
  }
});

alignmentMenu.addEventListener('click', (event) => {
  const target = getEventTargetElement(event.target);
  const button = target && target.closest('button[data-alignment]');
  if (!button) return;
  const alignment = button.dataset.alignment;
  if (applyAlignment(alignment)) {
    updateAlignmentMenuState();
    updateSelectionPanel(getSelectedRange());
  }
  closeAlignmentMenu();
  setTimeout(() => {
    preservingToolbarSelection = false;
  }, 0);
});

alignmentMenu.addEventListener('keydown', (event) => {
  const options = [...alignmentMenu.querySelectorAll('button[data-alignment]')];
  const currentIndex = options.indexOf(document.activeElement);
  if (event.key === 'Escape') {
    event.preventDefault();
    closeAlignmentMenu();
    alignmentButton.focus();
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    const next = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, options.length - 1);
    options[next].focus();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    const prev = currentIndex <= 0 ? 0 : currentIndex - 1;
    options[prev].focus();
  } else if (event.key === 'Home') {
    event.preventDefault();
    options[0].focus();
  } else if (event.key === 'End') {
    event.preventDefault();
    options[options.length - 1].focus();
  } else if (event.key === 'Enter' || event.key === ' ') {
    if (currentIndex >= 0) {
      event.preventDefault();
      options[currentIndex].click();
    }
  }
});

document.addEventListener('pointerdown', (event) => {
  if (!alignmentMenu.classList.contains('is-open')) return;
  const target = getEventTargetElement(event.target);
  if (target && (target.closest('#alignment-menu') || target.closest('#alignment-button'))) return;
  closeAlignmentMenu();
});

/* ---------- Font size events ---------- */

decreaseFont.addEventListener('click', (event) => {
  changeFontSize(-(event.shiftKey ? 5 : 1));
});

increaseFont.addEventListener('click', (event) => {
  changeFontSize(event.shiftKey ? 5 : 1);
});

fontSizeValue.addEventListener('change', () => {
  const requestedSize = Number(fontSizeValue.value);
  if (!Number.isFinite(requestedSize)) {
    updateFontControls();
    return;
  }
  fontSize = clamp(Math.round(requestedSize), MIN_FONT_SIZE, MAX_FONT_SIZE);
  applyFontSize(fontSize);
  updateFontControls();
});

/* ---------- Keyboard shortcuts ---------- */

window.addEventListener('keydown', (event) => {
  const target = getEventTargetElement(event.target);
  const toolbarContainer = document.querySelector('.header-controls');
  const editorHasFocus = target === content || (target && content.contains(target));
  const toolbarHasSelection = Boolean(
    toolbarContainer
    && target
    && toolbarContainer.contains(target)
    && isRangeInEditor(savedRange)
  );

  const key = event.key.toLowerCase();

  if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.altKey) {
    if (editorHasFocus || toolbarHasSelection) {
      event.preventDefault();
      if (event.shiftKey) redoFormattingChange();
      else undoFormattingChange();
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === 'y' && !event.altKey) {
    if (editorHasFocus || toolbarHasSelection) {
      event.preventDefault();
      redoFormattingChange();
    }
    return;
  }

  if ((event.ctrlKey || event.metaKey) && !event.altKey) {
    const range = getSelectedRange();
    const inEditor = range && !range.collapsed;
    if (inEditor) {
      if (key === 'b') { event.preventDefault(); toggleStyleProperty('font-weight', '700'); updateSelectionPanel(getSelectedRange()); return; }
      if (key === 'i') { event.preventDefault(); toggleStyleProperty('font-style', 'italic'); updateSelectionPanel(getSelectedRange()); return; }
      if (key === 'u') { event.preventDefault(); toggleStyleProperty('text-decoration-line', 'underline'); updateSelectionPanel(getSelectedRange()); return; }
      if (key === 'x' && event.shiftKey) { event.preventDefault(); toggleStyleProperty('text-decoration-line', 'line-through'); updateSelectionPanel(getSelectedRange()); return; }
    }
  }

  const increase = event.key === '+' || event.key === '=' || event.code === 'NumpadAdd';
  const decrease = event.key === '-' || event.key === '_' || event.code === 'Minus' || event.code === 'NumpadSubtract';
  const isInputLikeTarget = Boolean(target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  if (!event.altKey || (!increase && !decrease) || target === fontSizeValue || isInputLikeTarget) return;
  event.preventDefault();
  event.stopPropagation();
  changeFontSize((increase ? 1 : -1) * (event.shiftKey ? 5 : 1));
}, true);

/* ---------- Color inputs ---------- */

textColor.addEventListener('input', () => {
  updateCustomColorFlags();
  if (!pendingColorSnapshot) pendingColorSnapshot = captureFormattingSnapshot();
  preservingToolbarSelection = true;
  suppressSelectionSync = true;
  applyTextColor();
  setTimeout(() => {
    preservingToolbarSelection = false;
    suppressSelectionSync = false;
  }, 0);
});
textColor.addEventListener('change', flushPendingColorSnapshot);
textColor.addEventListener('blur', flushPendingColorSnapshot);
textColor.addEventListener('pointerup', flushPendingColorSnapshot);

backgroundColor.addEventListener('input', () => {
  applyBackgroundColor();
  updateCustomColorFlags();
  scheduleSave();
});

/* ---------- Opacity ---------- */

textOpacity.addEventListener('pointerdown', () => { opacityChangeRecorded = false; });
textOpacity.addEventListener('focus', () => { opacityChangeRecorded = false; });
textOpacity.addEventListener('blur', () => { opacityChangeRecorded = false; });
textOpacity.addEventListener('input', () => {
  opacityValue.textContent = `${textOpacity.value}%`;
  updateCustomColorFlags();
  if (!opacityChangeRecorded) {
    recordFormattingChange();
    opacityChangeRecorded = true;
  }
  if (getSelectedRange()) {
    const requestedOpacity = textOpacity.value;
    preservingToolbarSelection = true;
    suppressSelectionSync = true;
    applyOpacityToSelection();
    textOpacity.value = requestedOpacity;
    setTimeout(() => {
      preservingToolbarSelection = false;
      suppressSelectionSync = false;
    }, 0);
  } else {
    applyGlobalTextOpacity();
  }
});

/* ---------- Font menu events ---------- */

fontFamilyMenu.addEventListener('click', (event) => {
  const target = getEventTargetElement(event.target);
  const option = target && target.closest('.font-family-option');
  if (!option) return;
  const family = option.dataset.fontFamily;
  setSelectedFontFamily(family);
  recordFormattingChange();
  if (!wrapSelection('font-family', family)) content.style.fontFamily = family;
  closeFontFamilyMenu();
  fontFamilyToggle.focus();
  if (savedRange) {
    preservingToolbarSelection = true;
    restoreRange(savedRange);
    setTimeout(() => { preservingToolbarSelection = false; }, 0);
  }
});

fontFamilyToggle.addEventListener('click', () => {
  if (fontFamilyMenu.classList.contains('is-open')) {
    closeFontFamilyMenu();
    return;
  }
  openFontFamilyMenu();
  const selectedOption = fontFamilyMenu.querySelector('[aria-selected="true"]');
  (selectedOption || fontFamilyMenu.querySelector('.font-family-option')).focus();
});

// Only handle ArrowDown — Enter/Space already fire a click on the button,
// and our earlier handling of them caused the menu to open and then
// immediately close in some browsers.
fontFamilyToggle.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (!fontFamilyMenu.classList.contains('is-open')) {
      openFontFamilyMenu();
    }
    const selectedOption = fontFamilyMenu.querySelector('[aria-selected="true"]');
    (selectedOption || fontFamilyMenu.querySelector('.font-family-option')).focus();
  }
});

fontFamilyMenu.addEventListener('keydown', (event) => {
  const options = [...fontFamilyMenu.querySelectorAll('.font-family-option')];
  const currentIndex = options.indexOf(document.activeElement);
  if (event.key === 'Escape') {
    event.preventDefault();
    closeFontFamilyMenu();
    fontFamilyToggle.focus();
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    const next = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, options.length - 1);
    options[next].focus();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    const prev = currentIndex <= 0 ? 0 : currentIndex - 1;
    options[prev].focus();
  } else if (event.key === 'Home') {
    event.preventDefault();
    options[0].focus();
  } else if (event.key === 'End') {
    event.preventDefault();
    options[options.length - 1].focus();
  } else if (event.key === 'Enter' || event.key === ' ') {
    if (currentIndex >= 0) {
      event.preventDefault();
      options[currentIndex].click();
    }
  }
});

// Wait a beat before closing on focusout so a click on an option is not
// pre-empted by the menu closing under the pointer (Safari).
fontFamilyMenu.addEventListener('focusout', (event) => {
  const next = event.relatedTarget;
  if (next && fontFamilyMenu.contains(next)) return;
  if (next === fontFamilyToggle) return;
  setTimeout(() => {
    if (fontFamilyMenu.contains(document.activeElement)) return;
    if (document.activeElement === fontFamilyToggle) return;
    closeFontFamilyMenu();
  }, 100);
});

document.addEventListener('pointerdown', (event) => {
  const target = getEventTargetElement(event.target);
  if (!fontFamilyMenu.classList.contains('is-open')
    || (target && target.closest('.font-family-control'))) return;
  closeFontFamilyMenu();
});

/* ---------- Editor events ---------- */

content.addEventListener('beforeinput', (event) => {
  if (restoringFormattingHistory) return;
  if (event.inputType !== 'historyUndo' && event.inputType !== 'historyRedo') {
    if (!typingHistoryRecorded) {
      recordFormattingChange();
      typingHistoryRecorded = true;
    }
    clearTimeout(typingHistoryTimer);
    typingHistoryTimer = setTimeout(() => {
      typingHistoryRecorded = false;
    }, 1000);
  }
});

content.addEventListener('input', () => {
  if (restoringFormattingHistory) return;
  updateEditorEmptyState();
  scheduleSave();
});

new MutationObserver(scheduleSave).observe(content, {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeFilter: ['style']
});

function editorInsertRange() {
  const liveRange = getSelectedRange(false);
  if (liveRange) return liveRange;
  const selection = window.getSelection();
  const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
  return range && isRangeInEditor(range) ? range : null;
}

function rangeFromPoint(x, y) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    if (!position) return null;
    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    return range;
  }
  return null;
}

function insertPlainText(text) {
  const range = editorInsertRange();
  if (!range) return;
  restoreRange(range);
  if (document.execCommand && document.execCommand('insertText', false, text)) return;

  range.deleteContents();
  const fragment = document.createDocumentFragment();
  text.split(/\r\n|\r|\n/).forEach((line, index, lines) => {
    fragment.appendChild(document.createTextNode(line));
    if (index < lines.length - 1) fragment.appendChild(document.createElement('br'));
  });
  range.insertNode(fragment);
  range.collapse(false);
  restoreRange(range);
}

content.addEventListener('paste', (event) => {
  const text = event.clipboardData && event.clipboardData.getData('text/plain');
  if (text === null || text === undefined) return;
  event.preventDefault();
  insertPlainText(text);
});

content.addEventListener('dragover', (event) => { event.preventDefault(); });

content.addEventListener('drop', (event) => {
  event.preventDefault();
  const dropRange = rangeFromPoint(event.clientX, event.clientY);
  if (dropRange && isRangeInEditor(dropRange)) restoreRange(dropRange);
  const text = event.dataTransfer && event.dataTransfer.getData('text/plain');
  if (text === null || text === undefined) return;
  insertPlainText(text);
});

document.querySelector('.header-controls').addEventListener('pointerdown', (event) => {
  const target = getEventTargetElement(event.target);
  if (target && target.closest('#font-family-toggle, .font-family-option')) {
    if (savedRange) preservingToolbarSelection = true;
    return;
  }
  if (!savedRange) return;
  preservingToolbarSelection = true;
  setTimeout(() => {
    restoreRange(savedRange);
    preservingToolbarSelection = false;
  }, 0);
});

content.addEventListener('mouseup', () => {
  const range = currentSelection();
  if (!range) return;
  updateControlsFromSelection(range);
  updateSelectionPanel(range);
});

content.addEventListener('scroll', () => {
  const range = currentSelection();
  if (range) updateSelectionPanel(range);
  // Keep the alignment dropdown anchored to its button when the editor
  // scrolls (previously it stayed put and drifted away from the panel).
  updateAlignmentMenuPosition();
});

window.addEventListener('resize', () => {
  const range = currentSelection();
  if (range) updateSelectionPanel(range);
  updateAlignmentMenuPosition();
});

/* ---------- Theme toggle ---------- */

themeToggle.addEventListener('click', () => {
  flushPendingColorSnapshot();
  const isDark = document.body.classList.toggle('dark');
  document.documentElement.classList.toggle('dark', isDark);
  if (!hasCustomTextColor) applyThemeTextColor(isDark ? DARK_TEXT_COLOR : LIGHT_TEXT_COLOR);
  if (!hasCustomBackgroundColor) applyThemeBackground(isDark);
  updateThemeToggle(isDark);
  scheduleSave();
});

/* ---------- Header buttons ---------- */

restoreDefaults.addEventListener('click', () => {
  const confirmed = window.confirm(
    'Restore default settings and clear the document? This cannot be undone.'
  );
  if (!confirmed) return;
  restoreDefaultDocument();
});

saveFile.addEventListener('click', () => {
  flushPendingColorSnapshot();
  downloadDocument();
});

/* ---------- Logo as home button ---------- */

if (logoLink) {
  logoLink.addEventListener('click', (event) => {
    event.preventDefault();
    flushPendingColorSnapshot();
    content.scrollTop = 0;
    content.focus();

    const range = document.createRange();
    range.selectNodeContents(content);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    savedRange = range.cloneRange();

    hideSelectionPanel();
    closeAlignmentMenu();
    closeFontFamilyMenu();
  });
}

/* ---------- Bootstrap ---------- */

restoreDocument();
updateCustomColorFlags();
if (!hasCustomTextColor) applyThemeTextColor(themeTextColor());
if (!hasCustomBackgroundColor) applyThemeBackground(isDarkTheme());
fontSize = clamp(
  Math.round(parseFloat(getComputedStyle(content).fontSize)),
  MIN_FONT_SIZE,
  MAX_FONT_SIZE
);
updateFontControls();
setSelectedFontFamily(selectedFontFamily);
applyBackgroundColor();
updateThemeToggle(isDarkTheme());
updateEditorEmptyState();
content.focus();