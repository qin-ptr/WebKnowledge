// Prevents the script from running multiple times
if (typeof window.summarySidebarInjected === 'undefined') {
  window.summarySidebarInjected = true;

  // Define global state variables
  let summarySidebar;
  let summaryContentElement;
  let currentSummary = '';
  let scriptsReady;

  // Creates the sidebar and injects it into the page
  function createSidebar() {
    if (document.getElementById('summary-sidebar')) {
      summarySidebar = document.getElementById('summary-sidebar');
      summaryContentElement = document.getElementById('summary-sidebar-content');
      // Ensure the close button listener is attached
      const closeBtn = document.getElementById('close-sidebar-btn');
      if(closeBtn && !closeBtn.dataset.listenerAttached) {
          closeBtn.addEventListener('click', closeSidebar);
          closeBtn.dataset.listenerAttached = 'true';
      }
      return;
    }
  
    summarySidebar = document.createElement('div');
    summarySidebar.id = 'summary-sidebar';
  
    summarySidebar.innerHTML = `
        <div id="summary-sidebar-header">
            <h3>网页总结</h3>
            <button id="close-sidebar-btn">&times;</button>
        </div>
        <div id="summary-sidebar-content">
            <p>正在生成总结...</p>
        </div>
    `;
  
    document.body.appendChild(summarySidebar);
    summaryContentElement = document.getElementById('summary-sidebar-content');
  
    const closeBtn = document.getElementById('close-sidebar-btn');
    closeBtn.addEventListener('click', closeSidebar);
    closeBtn.dataset.listenerAttached = 'true';
  
    // Load and apply the saved state
    loadSidebarState();
  }
  
  function closeSidebar() {
    if (summarySidebar) {
      summarySidebar.classList.remove('visible');
    }
    document.body.classList.remove('summary-sidebar-open');
    // Use chrome.storage.local.set only if the context is valid
    if (chrome.runtime && chrome.runtime.id) {
      chrome.storage.local.set({ sidebarVisible: false });
    }
  }
  
  // Shows the sidebar
  function showSidebar() {
    if (!summarySidebar || !document.body.contains(summarySidebar)) {
      createSidebar();
    }
    summarySidebar.classList.add('visible');
    document.body.classList.add('summary-sidebar-open');
    if (chrome.runtime && chrome.runtime.id) {
      chrome.storage.local.set({ sidebarVisible: true });
    }
  }
  
  // Loads the sidebar state from storage
  function loadSidebarState() {
    // Check for valid context before accessing storage
    if (chrome.runtime && chrome.runtime.id) {
      chrome.storage.local.get(['sidebarVisible', 'lastSummary'], (result) => {
        if (result.sidebarVisible) {
          if (!summarySidebar) {
            createSidebar();
          }
          summarySidebar.classList.add('visible');
          document.body.classList.add('summary-sidebar-open');
          if (result.lastSummary) {
            currentSummary = result.lastSummary;
            renderMarkdown(result.lastSummary);
          }
        }
      });
    }
  }
  
  // Renders markdown content in the sidebar
  function renderMarkdown(markdown) {
      if (summaryContentElement) {
          // Use `marked.parse` if available, otherwise just display text
          if (typeof marked !== 'undefined') {
              summaryContentElement.innerHTML = marked.parse(markdown);
          } else {
              summaryContentElement.innerText = markdown;
          }
      }
  }
  
  // Typewriter effect for streaming content
  function typewriter(text) {
    currentSummary += text;
    renderMarkdown(currentSummary);
  }
  
  // Remove any existing listener to prevent duplicates from re-injection
  if (window.summarySidebarMessageListener) {
    try {
      chrome.runtime.onMessage.removeListener(window.summarySidebarMessageListener);
    } catch (e) {
      // This can happen if the context is invalidated, ignore it
      console.log("Could not remove old listener, probably because context was invalidated.");
    }
  }
  
  // Define the new listener function
  window.summarySidebarMessageListener = (request, sender, sendResponse) => {
    (async () => {
        await scriptsReady;
        // Ensure sidebar elements are valid before proceeding
        if (!summaryContentElement && request.action !== 'getPageContent') {
            createSidebar();
        }
        switch (request.action) {
            case 'initiateSummaryFlow':
                showSidebar();
                if (summaryContentElement) {
                  summaryContentElement.innerHTML = '<p>正在初始化总结流程...</p>'; // 更新初始消息
                }
                currentSummary = ''; // Reset content
                try {
                    const mainContent = extractMainContent();
                    const markdown = await convertToMarkdown(mainContent, { imageOption: 'http' });
                    if (!markdown || markdown.trim() === '') {
                        throw new Error('无法提取页面文本内容。');
                    }
                    chrome.runtime.sendMessage({
                        action: 'fetchSummary',
                        data: { ...request.data, content: markdown }
                    });
                } catch (e) {
                    if (summaryContentElement) {
                      summaryContentElement.innerHTML = `<p style="color: red;">提取内容失败: ${e.message}</p>`;
                    }
                }
                break;
            case 'summaryProgress': // 新增：处理进度更新
                if (summaryContentElement) {
                    summaryContentElement.innerHTML = `<p>${request.data}</p>`;
                }
                break;
            case 'summaryChunk':
                if (currentSummary === '' || (summaryContentElement && summaryContentElement.querySelector('p'))) {
                    if (summaryContentElement) {
                      summaryContentElement.innerHTML = ''; // 清除“正在生成”或进度消息
                    }
                }
                typewriter(request.data);
                break;
            case 'summaryComplete':
                if (chrome.runtime && chrome.runtime.id) {
                  chrome.storage.local.set({ lastSummary: currentSummary });
                }
                break;
            case 'summaryError':
                if(summaryContentElement) {
                  summaryContentElement.innerHTML = `<p style="color: red;">总结失败：${request.data}</p>`;
                }
                if (chrome.runtime && chrome.runtime.id) {
                  chrome.storage.local.remove(['lastSummary', 'sidebarVisible']);
                }
                break;
            case 'getPageContent':
                handleGetPageContent(request.options, sendResponse);
                break;
        }
    })().catch(err => console.error("Error in message listener:", err));
    
    // Only return true for getPageContent, which is asynchronous and uses sendResponse.
    return request.action === 'getPageContent';
  };
  
  // Add the new listener only if the context is valid
  if (chrome.runtime && chrome.runtime.id) {
    chrome.runtime.onMessage.addListener(window.summarySidebarMessageListener);
  }
  
  
  /**
   * Handles the request to get page content for saving.
   * @param {Object} options - Conversion options.
   * @param {Function} sendResponse - Callback to send the response.
   */
  async function handleGetPageContent(options, sendResponse) {
    try {
      const mainContent = extractMainContent();
      const markdown = await convertToMarkdown(mainContent, options);
  
      // Get summary from storage and prepend it
      if (chrome.runtime && chrome.runtime.id) {
        const result = await new Promise(resolve => chrome.storage.local.get('lastSummary', resolve));
        
        let finalMarkdown = markdown;
        if (result.lastSummary && result.lastSummary.trim() !== '') {
          const summaryHeader = '## 网页总结\n\n';
          const separator = '\n\n---\n\n';
          finalMarkdown = summaryHeader + result.lastSummary + separator + markdown;
        }
        sendResponse({ success: true, markdown: finalMarkdown });
      } else {
        // If context is invalid, just send back the raw markdown
        sendResponse({ success: true, markdown: markdown });
      }
  
    } catch (error) {
      console.error('Failed to extract content:', error);
      sendResponse({ success: false, error: error.message });
    }
  }
  
  /**
   * Extracts the main content from the webpage.
   * @returns {HTMLElement} The HTML element containing the main content.
   */
  function extractMainContent() {
    const selectors = [
        '#js_content', // for weixin articles
        'article', 'main', '.main-content', '.content', '#content', 
        '.post', '.entry', '.post-content', '.entry-content'
    ];
    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) return element.cloneNode(true);
    }
    // Fallback to body if no main content is found
    const bodyClone = document.body.cloneNode(true);
    // Try to remove the sidebar from the clone to avoid including it in the content
    const sidebarClone = bodyClone.querySelector('#summary-sidebar');
    if (sidebarClone) {
        sidebarClone.remove();
    }
    return bodyClone;
  }
  
  /**
   * Converts HTML to Markdown. This function relies on `utils/markdown.js`.
   * @param {HTMLElement} element - The element to convert.
   * @param {Object} options - Conversion options.
   * @returns {Promise<string>} The converted Markdown text.
   */
  async function convertToMarkdown(element, options) {
    if (typeof htmlToMarkdown === 'function') {
      return await htmlToMarkdown(element, options);
    } else {
      console.warn("htmlToMarkdown function not found. Using innerText as fallback.");
      return `# ${document.title}\n\n${element.innerText}`;
    }
  }
  
  // Inject required libraries
  function injectScript(filePath) {
      // Check if script is already injected to avoid duplicates
      if (chrome.runtime && chrome.runtime.id) {
          const url = chrome.runtime.getURL(filePath);
          if (document.querySelector(`script[src="${url}"]`)) {
              return Promise.resolve();
          }
          const script = document.createElement('script');
          script.src = url;
          (document.head || document.documentElement).appendChild(script);
          return new Promise((resolve, reject) => {
              script.onload = resolve;
              script.onerror = reject;
          });
      }
      return Promise.reject("Extension context invalidated");
  }
  
  // Initialize scripts and then the application logic
  scriptsReady = Promise.all([
    injectScript('js/marked.min.js'),
    injectScript('utils/markdown.js')
  ]).catch(err => console.error("Failed to inject scripts:", err));
  
  scriptsReady.then(() => {
    // This logic runs after scripts are loaded.
    // We can re-render markdown if there's existing summary content.
    if(currentSummary) {
        renderMarkdown(currentSummary);
    }
  });
  
  // Initial check to show sidebar if it was previously visible
  loadSidebarState();
}