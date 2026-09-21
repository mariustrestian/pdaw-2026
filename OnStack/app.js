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
    const selectionPanel = document.getElementById('selection-panel');
    const MIN_FONT_SIZE = 2;
    const MAX_FONT_SIZE = 160;
    const DEFAULT_FONT_SIZE = 24;
    let fontSize = DEFAULT_FONT_SIZE;
    let savedRange = null;
    let hasCustomTextColor = false;
    let preservingToolbarSelection = false;
    let suppressSelectionSync = false;
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
      if (!range) return;
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      savedRange = range.cloneRange();
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

      normalizeSpans();

      const normalizedRange = document.createRange();
      normalizedRange.setStartAfter(startMarker);
      normalizedRange.setEndBefore(endMarker);
      startMarker.remove();
      endMarker.remove();
      restoreRange(normalizedRange);
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
      const span = document.createElement('span');
      span.style.setProperty(property, value);
      span.appendChild(fragment);
      range.insertNode(span);
      range.selectNodeContents(span);
      normalizeSpansPreservingRange(range);
      return true;
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
      const computed = getComputedStyle(styledElement || content);
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
      selectionPanel.style.top = `${Math.max(8, top)}px`;

      const container = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range.startContainer.parentElement;
      const styledElement = container && container.closest('span');
      const computed = getComputedStyle(styledElement || content);
      selectionPanel.querySelectorAll('button[data-style-property]').forEach((button) => {
        const property = button.dataset.styleProperty;
        const value = button.dataset.styleValue;
        const current = computed.getPropertyValue(property);
        button.classList.toggle('is-active', property === 'text-decoration-line'
          ? current.split(' ').includes(value)
          : current === value || (property === 'font-weight' && Number(current) >= 600));
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

    selectionPanel.addEventListener('pointerdown', () => {
      preservingToolbarSelection = true;
    });

    selectionPanel.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-style-property]');
      if (!button) return;
      const property = button.dataset.styleProperty;
      const value = button.dataset.styleValue;
      const currentRange = getSelectedRange();
      if (!currentRange) return;
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
      wrapSelection(property, nextValue);
      updateSelectionPanel(getSelectedRange());
      setTimeout(() => {
        preservingToolbarSelection = false;
      }, 0);
    });

    function applyFontSize(size) {
      const value = `${clamp(size, MIN_FONT_SIZE, MAX_FONT_SIZE)}px`;
      if (!wrapSelection('font-size', value)) content.style.fontSize = value;
    }

    function applyFontSizeDeltaToSelection(delta) {
      const range = getSelectedRange();
      if (!range) return false;

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

      const textNodes = [];
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const afterStart = Boolean(startMarker.compareDocumentPosition(node)
          & Node.DOCUMENT_POSITION_FOLLOWING);
        const beforeEnd = Boolean(node.compareDocumentPosition(endMarker)
          & Node.DOCUMENT_POSITION_FOLLOWING);
        if (afterStart && beforeEnd && node.textContent) {
          textNodes.push(node);
        }
      }

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
      const normalizedRange = document.createRange();
      normalizedRange.setStartAfter(startMarker);
      normalizedRange.setEndBefore(endMarker);
      startMarker.remove();
      endMarker.remove();
      restoreRange(normalizedRange);
      return true;
    }

    function explicitFontSizes() {
      return [
        parseFloat(getComputedStyle(content).fontSize),
        ...[...content.querySelectorAll('span[style*="font-size"]')]
          .map((span) => parseFloat(span.style.fontSize))
      ];
    }

    function applyGlobalFontDelta(delta) {
      content.style.fontSize = `${clamp(parseFloat(getComputedStyle(content).fontSize) + delta, MIN_FONT_SIZE, MAX_FONT_SIZE)}px`;
      content.querySelectorAll('span[style*="font-size"]').forEach((span) => {
        span.style.fontSize = `${clamp(parseFloat(span.style.fontSize) + delta, MIN_FONT_SIZE, MAX_FONT_SIZE)}px`;
      });
      normalizeSpans();
      const sizes = explicitFontSizes();
      fontSize = Math.round(delta < 0 ? Math.min(...sizes) : Math.max(...sizes));
      updateFontControls();
    }

    function changeFontSize(delta) {
      if (getSelectedRange()) {
        if (applyFontSizeDeltaToSelection(delta)) {
          fontSize = clamp(fontSize + delta, MIN_FONT_SIZE, MAX_FONT_SIZE);
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
      const normalizedRange = document.createRange();
      normalizedRange.setStartAfter(startMarker);
      normalizedRange.setEndBefore(endMarker);
      startMarker.remove();
      endMarker.remove();
      restoreRange(normalizedRange);
      return true;
    }

    function applyThemeTextColor(hexColor) {
      const [red, green, blue] = hexToRgb(hexColor);
      const color = `rgba(${red}, ${green}, ${blue}, ${Number(textOpacity.value) / 100})`;
      content.style.color = color;
      content.querySelectorAll('span[style*="color"]').forEach((span) => {
        span.style.color = color;
      });
      textColor.value = hexColor;
    }

    function applyTextColor() {
      const color = getRgbaColor();
      if (!wrapSelection('color', color)) {
        content.style.color = color;
        content.querySelectorAll('span[style*="color"]').forEach((span) => {
          span.style.color = color;
        });
        normalizeSpans();
      }
    }

    function applyBackgroundColor() {
      content.style.backgroundColor = backgroundColor.value;
    }

    function applyGlobalTextOpacity() {
      const contentColor = colorChannels(getComputedStyle(content).color);
      if (contentColor) content.style.color = rgbaFromChannels(contentColor);

      content.querySelectorAll('span[style*="color"]').forEach((span) => {
        const channels = colorChannels(getComputedStyle(span).color);
        if (channels) span.style.color = rgbaFromChannels(channels);
      });
    }

    decreaseFont.addEventListener('click', (event) => {
      changeFontSize(-(event.shiftKey ? 5 : 1));
    });

    increaseFont.addEventListener('click', (event) => {
      changeFontSize(event.shiftKey ? 5 : 1);
    });

    window.addEventListener('keydown', (event) => {
      const increase = event.key === '+' || event.key === '=' || event.code === 'NumpadAdd';
      const decrease = event.key === '-' || event.key === '_' || event.code === 'Minus' || event.code === 'NumpadSubtract';
      if (!event.altKey || (!increase && !decrease) || event.target === fontSizeValue) return;
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
      hasCustomTextColor = true;
      preservingToolbarSelection = true;
      suppressSelectionSync = true;
      applyTextColor();
      setTimeout(() => {
        preservingToolbarSelection = false;
        suppressSelectionSync = false;
      }, 0);
    });
    backgroundColor.addEventListener('input', applyBackgroundColor);
    fontFamilyMenu.addEventListener('click', (event) => {
      const option = event.target.closest('.font-family-option');
      if (!option) return;
      const family = option.dataset.fontFamily;
      setSelectedFontFamily(family);
      if (!wrapSelection('font-family', family)) {
        content.style.fontFamily = family;
        content.querySelectorAll('span').forEach((span) => {
          span.style.fontFamily = family;
        });
        normalizeSpans();
      }
      fontFamilyMenu.classList.remove('is-open');
      fontFamilyToggle.setAttribute('aria-expanded', 'false');
    });
    fontFamilyToggle.addEventListener('click', () => {
      const isOpen = fontFamilyMenu.classList.toggle('is-open');
      fontFamilyToggle.setAttribute('aria-expanded', String(isOpen));
    });
    textOpacity.addEventListener('input', () => {
      opacityValue.textContent = `${textOpacity.value}%`;
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

    document.querySelector('.header-controls').addEventListener('pointerdown', (event) => {
      if (event.target.closest('#font-family-toggle, .font-family-option, #selection-panel')) return;
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

    themeToggle.addEventListener('click', () => {
      const isDark = document.body.classList.toggle('dark');
      document.documentElement.classList.toggle('dark', isDark);
      if (!hasCustomTextColor) {
        applyThemeTextColor(isDark ? '#ffffff' : '#000000');
      }
      themeToggle.innerHTML = isDark
        ? '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M23 5a12 12 0 1 0 0 22A9 9 0 1 1 23 5Z"></path></svg>'
        : '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="6"></circle><path class="sun-rays" d="M16 2v5M16 25v5M2 16h5M25 16h5M6.1 6.1l3.5 3.5M22.4 22.4l3.5 3.5M25.9 6.1l-3.5 3.5M9.6 22.4l-3.5 3.5"></path></svg>';
      themeToggle.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
      themeToggle.title = isDark ? 'Switch to light theme' : 'Switch to dark theme';
      themeToggle.setAttribute('aria-pressed', String(isDark));
    });

    updateFontControls();
    setSelectedFontFamily(selectedFontFamily);
    content.focus();
