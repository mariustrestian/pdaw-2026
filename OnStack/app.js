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
    const MIN_FONT_SIZE = 2;
    const MAX_FONT_SIZE = 160;
    const DEFAULT_FONT_SIZE = 24;
    const LIGHT_TEXT_COLOR = '#000000';
    const DARK_TEXT_COLOR = '#ffffff';
    const LIGHT_BACKGROUND_COLOR = '#ffffff';
    const DARK_BACKGROUND_COLOR = '#1f1f1f';
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
    const STORAGE_KEY = 'onstack-document';
    const MAX_HISTORY_ENTRIES = 100;
    let persistenceTimer = null;
    let typingHistoryRecorded = false;
    let typingHistoryTimer = null;
    const formattingProperties = [
      'font-size', 'font-family', 'color', 'background-color',
      'font-weight', 'font-style', 'text-decoration-line'
    ];
    const fontFamilies = [
      'Georgia', 'Arial', 'Verdana', 'Courier New', 'Trebuchet MS', 'Times New Roman',
      'Helvetica', 'Tahoma', 'Calibri', 'Cambria', 'Candara', 'Century Gothic',
      'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Franklin Gothic Medium',
      'Garamond', 'Gill Sans', 'Impact', 'Lucida Console', 'Lucida Sans Unicode',
      'Palatino Linotype', 'Rockwell', 'Segoe Print', 'Segoe Script', 'Segoe UI',
      'Baskerville', 'Book Antiqua', 'Arial Black', 'Brush Script MT', 'Copperplate',
      'Didot', 'Futura', 'Monaco', 'Optima', 'Courier'
    ];
    let selectedFontFamily = fontFamilies[0];

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

    function sanitizeEditorHtml(html) {
      const template = document.createElement('template');
      template.innerHTML = html;
      const forbidden = new Set(['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'STYLE', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT']);
      template.content.querySelectorAll('*').forEach((element) => {
        if (forbidden.has(element.tagName)) {
          element.remove();
          return;
        }
        [...element.attributes].forEach((attribute) => {
          const name = attribute.name.toLowerCase();
          const value = attribute.value;
          if (name.startsWith('on') || /javascript:/i.test(value) || (name === 'src' && /^\s*javascript:/i.test(value))) {
            element.removeAttribute(attribute.name);
          }
        });
      });
      return template.innerHTML;
    }

    function editorSpansWithProperty(property) {
      return [...content.querySelectorAll('span')].filter((span) => span.style.getPropertyValue(property));
    }

    function updateEditorEmptyState() {
      const empty = !content.textContent.replace(/\u00a0/g, ' ').trim();
      content.classList.toggle('is-empty', empty);
    }

    function updateCustomColorFlags() {
      hasCustomTextColor = normalizeHexColor(textColor.value) !== themeTextColor()
        || String(textOpacity.value) !== '100';
      hasCustomBackgroundColor = normalizeHexColor(backgroundColor.value) !== themeBackgroundColor();
    }

    function saveDocument() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          html: sanitizeEditorHtml(content.innerHTML),
          contentStyle: content.getAttribute('style') || '',
          textColor: textColor.value,
          textOpacity: textOpacity.value,
          backgroundColor: backgroundColor.value,
          darkTheme: document.body.classList.contains('dark'),
          hasCustomTextColor,
          hasCustomBackgroundColor,
          selectedFontFamily
        }));
      } catch (error) {
        console.error('OnStack could not save the document.', error);
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
        if (typeof saved.html === 'string') content.innerHTML = sanitizeEditorHtml(saved.html);
        if (typeof saved.contentStyle === 'string') {
          if (saved.contentStyle) content.setAttribute('style', saved.contentStyle);
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
      }
    }

    function restoreDefaultDocument() {
      suppressPersistence = true;
      clearTimeout(persistenceTimer);
      persistenceTimer = null;
      localStorage.removeItem(STORAGE_KEY);
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
      themeToggle.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="6"></circle><path class="sun-rays" d="M16 2v5M16 25v5M2 16h5M25 16h5M6.1 6.1l3.5 3.5M22.4 22.4l3.5 3.5M25.9 6.1l-3.5 3.5M9.6 22.4l-3.5 3.5"></path></svg>';
      themeToggle.setAttribute('aria-label', 'Switch to dark theme');
      themeToggle.title = 'Switch to dark theme';
      themeToggle.setAttribute('aria-pressed', 'false');
      formattingUndoStack.length = 0;
      formattingRedoStack.length = 0;
      savedRange = null;
      hideSelectionPanel();
      updateFontControls();
      setSelectedFontFamily(selectedFontFamily);
      updateEditorEmptyState();
      content.focus();
      suppressPersistence = false;
    }

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

    function downloadDocument() {
      const computed = getComputedStyle(content);
      const exportedStyles = [
        `box-sizing: border-box`,
        `font-family: ${computed.fontFamily}`,
        `font-size: ${computed.fontSize}`,
        `line-height: ${computed.lineHeight}`,
        `color: ${computed.color}`,
        `background-color: ${computed.backgroundColor}`,
        `padding: ${computed.padding}`
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

    fontFamilies.forEach((family) => {
      const option = document.createElement('button');
      option.className = 'font-family-option';
      option.type = 'button';
      option.dataset.fontFamily = family;
      option.setAttribute('role', 'option');
      option.title = `Use ${family}`;
      option.textContent = family;
      option.style.fontFamily = family;
      fontFamilyMenu.appendChild(option);
    });

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function getEventTargetElement(target) {
      if (!target) return null;
      if (target instanceof Element) return target;
      if (target instanceof Node && target.parentElement) return target.parentElement;
      return null;
    }

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

    function snapshotNodeLength(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent.length;
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') return 1;
      return [...node.childNodes].reduce((total, child) => total + snapshotNodeLength(child), 0);
    }

    function captureFormattingSnapshot() {
      const range = getSelectedRange();
      const textLength = snapshotNodeLength;
      const boundaryOffset = (container, offset, root = content) => {
        if (root === container) {
          if (container.nodeType === Node.TEXT_NODE) return offset;
          return [...container.childNodes]
            .slice(0, offset)
            .reduce((total, child) => total + textLength(child), 0);
        }
        let total = 0;
        for (const child of root.childNodes) {
          if (child === container || child.contains(container)) {
            return total + boundaryOffset(container, offset, child);
          }
          total += textLength(child);
        }
        return total;
      };
      return {
        html: content.innerHTML,
        start: range ? boundaryOffset(range.startContainer, range.startOffset) : null,
        end: range ? boundaryOffset(range.endContainer, range.endOffset) : null
      };
    }

    function recordFormattingChange() {
      if (restoringFormattingHistory) return;
      formattingUndoStack.push(captureFormattingSnapshot());
      if (formattingUndoStack.length > MAX_HISTORY_ENTRIES) formattingUndoStack.shift();
      formattingRedoStack.length = 0;
      typingHistoryRecorded = false;
      clearTimeout(typingHistoryTimer);
    }

    function restoreFormattingSnapshot(snapshot) {
      restoringFormattingHistory = true;
      content.innerHTML = snapshot.html;
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

      const selection = window.getSelection();
      const toolbarHasFocus = document.querySelector('.header-controls').contains(document.activeElement);
      if (!preservingToolbarSelection && !toolbarHasFocus) {
        savedRange = null;
        hideSelectionPanel();
      }
    });

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
        if (!span.style.length) {
          span.replaceWith(...span.childNodes);
        }
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
      if (fontFamilies.includes(computedFamily)) {
        setSelectedFontFamily(computedFamily);
      }
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

      const container = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range.startContainer.parentElement;
      const styledElement = container && container.closest('span');
      const nodes = textNodesInRange(range);
      selectionPanel.querySelectorAll('button[data-style-property]').forEach((button) => {
        const property = button.dataset.styleProperty;
        const value = button.dataset.styleValue;
        const isActive = nodes.length
          ? nodes.every((node) => propertyIsActive(
            getComputedStyle(node.parentElement || content),
            property,
            value
          ))
          : propertyIsActive(getComputedStyle(styledElement || content), property, value);
        button.classList.toggle('is-active', isActive);
      });
    }

    function hideSelectionPanel() {
      selectionPanel.classList.remove('is-visible');
      selectionPanel.setAttribute('aria-hidden', 'true');
    }

    function setSelectedFontFamily(family) {
      selectedFontFamily = family;
      fontFamilyToggle.style.fontFamily = family;
      fontFamilyToggle.title = family;
      fontFamilyMenu.querySelectorAll('.font-family-option').forEach((option) => {
        option.setAttribute('aria-selected', String(option.dataset.fontFamily === family));
      });
    }

    function closeFontFamilyMenu() {
      fontFamilyMenu.classList.remove('is-open');
      fontFamilyToggle.setAttribute('aria-expanded', 'false');
      preservingToolbarSelection = false;
    }

    function openFontFamilyMenu() {
      fontFamilyMenu.classList.add('is-open');
      fontFamilyToggle.setAttribute('aria-expanded', 'true');
      if (savedRange) preservingToolbarSelection = true;
    }

    selectionPanel.addEventListener('pointerdown', (event) => {
      const target = getEventTargetElement(event.target);
      if (target && target.closest('button[data-style-property]')) {
        preservingToolbarSelection = true;
      }
    });

    selectionPanel.addEventListener('click', (event) => {
      const target = getEventTargetElement(event.target);
      const button = target && target.closest('button[data-style-property]');
      if (!button) {
        preservingToolbarSelection = false;
        return;
      }
      const property = button.dataset.styleProperty;
      const value = button.dataset.styleValue;
      const currentRange = getSelectedRange();
      if (!currentRange) {
        preservingToolbarSelection = false;
        return;
      }
      const container = currentRange.startContainer.nodeType === Node.ELEMENT_NODE
        ? currentRange.startContainer
        : currentRange.startContainer.parentElement;
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
      updateSelectionPanel(getSelectedRange());
      setTimeout(() => {
        preservingToolbarSelection = false;
      }, 0);
    });

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
      if ((!selectedRange && ((delta < 0 && currentSize <= MIN_FONT_SIZE)
        || (delta > 0 && currentSize >= MAX_FONT_SIZE)))
      ) return;
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
      recordFormattingChange();
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

    decreaseFont.addEventListener('click', (event) => {
      changeFontSize(-(event.shiftKey ? 5 : 1));
    });

    increaseFont.addEventListener('click', (event) => {
      changeFontSize(event.shiftKey ? 5 : 1);
    });

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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        if (editorHasFocus || toolbarHasSelection) {
          event.preventDefault();
          if (event.shiftKey) redoFormattingChange();
          else undoFormattingChange();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        if (editorHasFocus || toolbarHasSelection) {
          event.preventDefault();
          redoFormattingChange();
        }
        return;
      }
      const increase = event.key === '+' || event.key === '=' || event.code === 'NumpadAdd';
      const decrease = event.key === '-' || event.key === '_' || event.code === 'Minus' || event.code === 'NumpadSubtract';
      const isInputLikeTarget = Boolean(target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if (!event.altKey || (!increase && !decrease)
        || target === fontSizeValue
        || isInputLikeTarget) return;
      event.preventDefault();
      event.stopPropagation();
      changeFontSize((increase ? 1 : -1) * (event.shiftKey ? 5 : 1));
    }, true);

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

    textColor.addEventListener('input', () => {
      updateCustomColorFlags();
      preservingToolbarSelection = true;
      suppressSelectionSync = true;
      applyTextColor();
      setTimeout(() => {
        preservingToolbarSelection = false;
        suppressSelectionSync = false;
      }, 0);
    });
    backgroundColor.addEventListener('input', () => {
      applyBackgroundColor();
      updateCustomColorFlags();
      scheduleSave();
    });
    fontFamilyMenu.addEventListener('click', (event) => {
      const target = getEventTargetElement(event.target);
      const option = target && target.closest('.font-family-option');
      if (!option) return;
      const family = option.dataset.fontFamily;
      setSelectedFontFamily(family);
      recordFormattingChange();
      if (!wrapSelection('font-family', family)) {
        content.style.fontFamily = family;
      }
      closeFontFamilyMenu();
      fontFamilyToggle.focus();
      if (savedRange) {
        preservingToolbarSelection = true;
        restoreRange(savedRange);
        setTimeout(() => {
          preservingToolbarSelection = false;
        }, 0);
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
    fontFamilyToggle.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fontFamilyToggle.click();
      }
    });
    fontFamilyMenu.addEventListener('keydown', (event) => {
      const options = [...fontFamilyMenu.querySelectorAll('.font-family-option')];
      const currentIndex = options.indexOf(document.activeElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        closeFontFamilyMenu();
        fontFamilyToggle.focus();
      } else if (event.key === 'ArrowDown' && currentIndex < options.length - 1) {
        event.preventDefault();
        options[currentIndex + 1].focus();
      } else if (event.key === 'ArrowUp' && currentIndex > 0) {
        event.preventDefault();
        options[currentIndex - 1].focus();
      }
    });
    document.addEventListener('pointerdown', (event) => {
      const target = getEventTargetElement(event.target);
      if (!fontFamilyMenu.classList.contains('is-open')
        || (target && target.closest('.font-family-control'))) return;
      closeFontFamilyMenu();
    });
    let opacityChangeRecorded = false;
    textOpacity.addEventListener('pointerdown', () => {
      opacityChangeRecorded = false;
    });
    textOpacity.addEventListener('pointerup', () => {
      opacityChangeRecorded = false;
    });
    textOpacity.addEventListener('focus', () => {
      opacityChangeRecorded = false;
    });
    textOpacity.addEventListener('blur', () => {
      opacityChangeRecorded = false;
    });
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
      if (document.execCommand('insertText', false, text)) return;

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

    content.addEventListener('dragover', (event) => {
      event.preventDefault();
    });

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
    });
    window.addEventListener('resize', () => {
      const range = currentSelection();
      if (range) updateSelectionPanel(range);
    });

    themeToggle.addEventListener('click', () => {
      const isDark = document.body.classList.toggle('dark');
      document.documentElement.classList.toggle('dark', isDark);
      if (!hasCustomTextColor) applyThemeTextColor(isDark ? DARK_TEXT_COLOR : LIGHT_TEXT_COLOR);
      if (!hasCustomBackgroundColor) applyThemeBackground(isDark);
      updateThemeToggle(isDark);
      scheduleSave();
    });

    restoreDefaults.addEventListener('click', restoreDefaultDocument);
    saveFile.addEventListener('click', downloadDocument);

    restoreDocument();
    updateCustomColorFlags();
    if (!hasCustomTextColor) applyThemeTextColor(themeTextColor());
    if (!hasCustomBackgroundColor) applyThemeBackground(isDarkTheme());
    fontSize = clamp(Math.round(parseFloat(getComputedStyle(content).fontSize)), MIN_FONT_SIZE, MAX_FONT_SIZE);
    updateFontControls();
    setSelectedFontFamily(selectedFontFamily);
    applyBackgroundColor();
    updateThemeToggle(isDarkTheme());
    updateEditorEmptyState();
    content.focus();
