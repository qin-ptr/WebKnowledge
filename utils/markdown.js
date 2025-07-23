/**
 * markdown.js - HTML to Markdown conversion tool (Async Version)
 *
 * This file provides functionality to convert HTML elements to Markdown format, including:
 * 1. Handling basic elements like headings, paragraphs, lists.
 * 2. Handling media elements like links and images (images can be embedded as Base64).
 * 3. Handling complex elements like tables and code blocks.
 * 4. Providing conversion options.
 */

/**
 * Converts an image URL to a Base64 Data URL.
 * @param {string} url - The URL of the image.
 * @returns {Promise<string>} A promise that resolves with the Base64 Data URL, or rejects.
 */
function imageToDataURL(url) {
  return new Promise((resolve, reject) => {
    if (url.startsWith('data:')) {
      if (url.startsWith('data:image/svg+xml,')) {
        const svgXml = decodeURIComponent(url.substring('data:image/svg+xml,'.length));
        try {
          const base64Svg = btoa(unescape(encodeURIComponent(svgXml)));
          resolve('data:image/svg+xml;base64,' + base64Svg);
        } catch (e) {
          console.error("Failed to encode SVG to base64:", e);
          reject(e);
        }
      } else {
        resolve(url);
      }
      return;
    }

    let absoluteUrl = new URL(url, window.location.href).href;

    if (window.location.protocol === 'https:' && absoluteUrl.startsWith('http:')) {
      absoluteUrl = absoluteUrl.replace('http:', 'https:');
    }

    fetch(absoluteUrl)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.blob();
      })
      .then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(reader.result);
        };
        reader.onerror = (error) => {
          console.error('FileReader error:', error);
          reject(error);
        };
        reader.readAsDataURL(blob);
      })
      .catch(error => {
        console.error(`Fetching image for Base64 conversion failed: ${absoluteUrl}`, error);
        reject(error); // Reject if fetching fails
      });
  });
}

/**
 * Escapes Markdown special characters in a string.
 * @param {string} text - The text to escape.
 * @returns {string} The escaped text.
 */
function escapeMarkdown(text) {
  if (text === null || text === undefined) {
    return '';
  }
  return text.replace(/([\\`*_{}[\]()#+\-.!])/g, '\\$1');
}

/**
 * Asynchronously converts an HTML element to Markdown format.
 * @param {HTMLElement} element - The HTML element to convert.
 * @param {Object} options - Conversion options.
 * @returns {Promise<string>} The converted Markdown text.
 */
async function htmlToMarkdown(element, options = {}) {
  const defaultOptions = {
    imageOption: 'base64', // 'base64' or 'http'
    includeLinks: true,
  };

  const mergedOptions = { ...defaultOptions, ...options };
  const clone = element.cloneNode(true);

  const unwantedSelectors = [
    'script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'aside',
    '.sidebar', '.ads', '.comments', '.navigation', '.menu',
    '[role="banner"]', '[role="navigation"]', '[role="advertisement"]'
  ];

  unwantedSelectors.forEach(selector => {
    clone.querySelectorAll(selector).forEach(el => el.remove());
  });

  let markdown = '';
  const pageTitle = document.title;
  if (pageTitle) {
    markdown += `# ${pageTitle}\n\n`;
  }

  markdown += await processNode(clone, mergedOptions, { listDepth: 0 });
  markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

  return markdown;
}

/**
 * Asynchronously processes a DOM node and its children to convert them to Markdown.
 * @param {Node} node - The DOM node to process.
 * @param {Object} options - Conversion options.
 * @param {Object} context - The processing context (e.g., are we inside a list).
 * @returns {Promise<string>} The resulting Markdown text.
 */
async function processNode(node, options, context) {
  if (!node) return '';

  if (node.nodeType === Node.TEXT_NODE) {
    if (node.parentElement.closest('pre, code')) {
        return node.textContent;
    }
    // For other text, collapse whitespace and escape.
    const trimmedText = node.textContent.replace(/\s+/g, ' ');
    if (trimmedText === ' ') {
        // If the node is just whitespace between block elements, it will be handled by the newlines of the block elements.
        // If it's between inline elements, a single space is desired.
        const prev = node.previousSibling;
        const next = node.nextSibling;
        if ((prev && prev.nodeType === Node.ELEMENT_NODE && window.getComputedStyle(prev).display !== 'inline') ||
            (next && next.nodeType === Node.ELEMENT_NODE && window.getComputedStyle(next).display !== 'inline')) {
            return '';
        }
        return ' ';
    }
    return escapeMarkdown(trimmedText);
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  let markdown = '';
  const tagName = node.tagName.toLowerCase();
  const newContext = { ...context };

  switch (tagName) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      markdown = await processHeading(node, options, newContext);
      break;
    case 'p':
      markdown = await processParagraph(node, options, newContext);
      break;
    case 'br':
      markdown = '  \n';
      break;
    case 'hr':
      markdown = '\n---\n\n';
      break;
    case 'a':
      markdown = await processLink(node, options, newContext);
      break;
    case 'img':
      markdown = await processImage(node, options, newContext);
      break;
    case 'ul':
    case 'ol':
      newContext.listDepth = (context.listDepth || 0) + 1;
      newContext.isOrdered = tagName === 'ol';
      newContext.itemIndex = 0;
      markdown = await processChildren(node, options, newContext);
      break;
    case 'li':
      markdown = await processListItem(node, options, context);
      break;
    case 'blockquote':
      markdown = await processBlockquote(node, options, newContext);
      break;
    case 'pre':
      markdown = await processPreformattedText(node, options, newContext);
      break;
    case 'code':
      markdown = processCode(node);
      break;
    case 'table':
      markdown = await processTable(node, options, newContext);
      break;
    case 'strong':
    case 'b':
      markdown = `**${await processChildren(node, options, newContext)}**`;
      break;
    case 'em':
    case 'i':
      markdown = `*${await processChildren(node, options, newContext)}*`;
      break;
    case 'del':
    case 's':
      markdown = `~~${await processChildren(node, options, newContext)}~~`;
      break;
    default:
      markdown = await processChildren(node, options, newContext);
      break;
  }
  return markdown;
}

async function processChildren(node, options, context) {
  let result = '';
  for (const child of node.childNodes) {
    result += await processNode(child, options, context);
  }
  return result;
}

async function processHeading(node, options, context) {
  const level = parseInt(node.tagName.charAt(1));
  const content = (await processChildren(node, options, context)).trim();
  return `\n${'#'.repeat(level)} ${content}\n\n`;
}

async function processParagraph(node, options, context) {
  const content = (await processChildren(node, options, context)).trim();
  return content ? `\n${content}\n\n` : '';
}

async function processLink(node, options, context) {
  if (!options.includeLinks) {
    return await processChildren(node, options, context);
  }
  const text = (await processChildren(node, options, context)).trim();
  const url = node.getAttribute('href');
  return url ? `[${text}](${url})` : text;
}

async function processImage(node, options) {
  const alt = escapeMarkdown(node.getAttribute('alt') || '');
  let src = node.getAttribute('src');
  const title = escapeMarkdown(node.getAttribute('title') || '');

  if (!src) return '';

  if (options.imageOption === 'http') {
    src = new URL(src, window.location.href).href;
  } else {
    try {
      src = await imageToDataURL(src);
    } catch (e) {
      console.error(`Failed to process image ${src}:`, e);
      return ''; // Don't include the image if processing fails
    }
  }

  let markdown = `![${alt}](${src}`;
  if (title) {
      markdown += ` "${title}"`;
  }
  markdown += ')';
  return markdown;
}

async function processListItem(node, options, context) {
  const indent = '  '.repeat(context.listDepth - 1);
  const prefix = context.isOrdered ? `${context.itemIndex + 1}. ` : '* ';
  context.itemIndex++;

  let content = (await processChildren(node, options, context)).trim();
  content = content.replace(/\n/g, `\n${indent}  `);

  return `${indent}${prefix}${content}\n`;
}

async function processBlockquote(node, options, context) {
  const content = (await processChildren(node, options, context)).trim();
  const lines = content.split('\n').map(line => `> ${line}`).join('\n');
  return `\n${lines}\n\n`;
}

async function processPreformattedText(node) {
  const codeElement = node.querySelector('code');
  let language = '';
  if (codeElement) {
      const langClass = Array.from(codeElement.classList).find(c => c.startsWith('language-'));
      if (langClass) {
          language = langClass.replace('language-', '');
      }
  }
  const code = node.textContent;
  return `\n\`\`\`${language}\n${code}\n\`\`\`\n\n`;
}

function processCode(node) {
  if (node.closest('pre')) {
    return node.textContent;
  }
  return `\`${node.textContent}\``;
}

async function processTable(node, options, context) {
  let markdown = '\n';
  const headerRow = node.querySelector('thead tr, tr:first-child');
  const bodyRows = Array.from(node.querySelectorAll('tbody tr'));
  if (!headerRow && bodyRows.length === 0) return '';

  // If no thead, use first row as header and rest as body
  if (!node.querySelector('thead') && node.querySelector('tr')) {
      bodyRows.unshift(node.querySelector('tr'));
  }

  const headers = await Promise.all(
      Array.from(headerRow.children).map(async (cell) => 
          (await processChildren(cell, options, context)).trim()
      )
  );

  markdown += `| ${headers.join(' | ')} |\n`;
  markdown += `| ${headers.map(() => '---').join(' | ')} |\n`;

  for (const row of bodyRows) {
      const cells = await Promise.all(
          Array.from(row.children).map(async (cell) => 
              (await processChildren(cell, options, context)).trim()
          )
      );
      markdown += `| ${cells.join(' | ')} |\n`;
  }

  return markdown + '\n';
}