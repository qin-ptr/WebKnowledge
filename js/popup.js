/**
 * popup.js - WebKnowledge的弹出界面逻辑
 * 
 * 这个文件实现了Chrome扩展弹出界面的交互逻辑，包括：
 * 1. 处理用户点击\"转换并下载\"按钮的事件
 * 2. 与content script通信，获取页面内容
 * 3. 与background script通信，触发下载功能
 * 4. 显示转换和下载状态
 */

// 在DOM加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
  // 获取DOM元素
  const saveMdBtn = document.getElementById('saveMdBtn');
  const savePdfBtn = document.getElementById('savePdfBtn');
  const openFolderBtn = document.getElementById('openFolderBtn');
  const summarizeBtn = document.getElementById('summarizeBtn');
  const autoDownload = document.getElementById('autoDownload');
  const downloadPath = document.getElementById('downloadPath');
  const status = document.getElementById('status');
  const statusText = document.getElementById('statusText');
  const imageEncode = document.getElementById('imageEncode');
  const deduplicate = document.getElementById('deduplicate');
  const container = document.querySelector('.container');

  // 设置弹窗相关元素
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsContainer = document.getElementById('settingsContainer');
  const settingsForm = document.getElementById('settingsForm');
  const defaultSaveFormat = document.getElementById('defaultSaveFormat');
  const akInput = document.getElementById('akInput');
  const skInput = document.getElementById('skInput');
  const domainInput = document.getElementById('domainInput');
  const knowledgeBaseInput = document.getElementById('knowledgeBaseInput');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const modelSelect = document.getElementById('modelSelect');
  const customPromptInput = document.getElementById('customPromptInput');
  const disabledSitesTextarea = document.getElementById('disabledSitesTextarea');

  // 为转换按钮添加点击事件监听器
  saveMdBtn.addEventListener('click', handleSaveAsMarkdownClick);
  savePdfBtn.addEventListener('click', handleSaveAsPdfClick);
  summarizeBtn.addEventListener('click', handleSummarizeClick);
  openFolderBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openDownloadFolder' });
  });

  // 设置按钮的事件监听器
  settingsBtn.addEventListener('click', () => {
    const isVisible = settingsContainer.style.display === 'block';
    settingsContainer.style.display = isVisible ? 'none' : 'block';
  });

  settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    saveSettings();
    settingsContainer.style.display = 'none';
    showStatus('设置已保存', 'success');
    setTimeout(hideStatus, 2000);
  });
  
  /**
   * 检查当前URL是否在禁用网站列表中
   * @param {string} url - 当前页面的URL
   * @returns {Promise<boolean>} - 如果URL被禁用，返回true；否则返回false。
   */
  async function isUrlDisabled(url) {
    try {
      const items = await new Promise(resolve => {
        chrome.storage.local.get({ disabledSites: '' }, items => resolve(items));
      });
      const disabledSites = items.disabledSites
        .split('\n')
        .map(s => s.trim().toLowerCase())
        .filter(s => s.length > 0);

      if (disabledSites.length === 0) {
        return false;
      }

      const urlHostname = new URL(url).hostname.toLowerCase();

      return disabledSites.some(disabledSite => {
        return urlHostname === disabledSite || urlHostname.endsWith('.' + disabledSite);
      });
    } catch (e) {
      console.error("isUrlDisabled函数出错:", e);
      return false; // 出错时安全起见，不禁用
    }
  }

  /**
   * 处理转换按钮点击事件
   */
  async function handleSaveAsMarkdownClick() {
    try {
      // 获取当前标签页
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab) {
        throw new Error('无法获取当前标签页');
      }

      if (await isUrlDisabled(tab.url)) {
        showStatus('当前网站已被禁用', 'error');
        return;
      }
      
      // 显示处理中状态
      showStatus('处理中...', 'loading');
      
      // 禁用按钮，防止重复点击
      saveMdBtn.disabled = true;

      // 注入内容脚本，确保接收端存在
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['js/marked.min.js', 'utils/markdown.js', 'js/content.js']
        });
      } catch (e) {
        // 如果注入失败（例如在特殊页面上），则捕获错误
        console.error("内容脚本注入失败:", e);
        throw new Error("无法在此页面上执行操作。请尝试刷新页面或在不同的页面上使用。");
      }
      
      // 获取用户设置
      const options = {
        imageOption: imageEncode.checked ? 'base64' : 'http',
        includeLinks: true
      };

      // 向content script发送消息，获取页面内容
      const response = await chrome.tabs.sendMessage(tab.id, { 
        action: 'getPageContent',
        options: options
      });
      
      if (!response || !response.success) {
        throw new Error(response?.error || '无法获取页面内容');
      }
      
      const isAutoDownload = autoDownload.checked;
      const path = downloadPath.value;

      // 向background script发送消息，触发下载
      chrome.runtime.sendMessage({
        action: 'convertAndDownload',
        data: {
          title: tab.title,
          markdown: response.markdown,
          saveAs: false,
          downloadPath: path
        }
      });
      
      // 显示成功状态
      showStatus('转换成功，正在下载...', 'success');
      
      // 3秒后恢复按钮状态
      setTimeout(() => {
        hideStatus();
        saveMdBtn.disabled = false;
      }, 3000);
      
    } catch (error) {
      console.error('转换失败:', error);
      
      // 显示错误状态
      showStatus(`转换失败: ${error.message}`, 'error');
    }
  }

  /**
   * 处理保存为PDF按钮点击事件
   */
  async function handleSaveAsPdfClick() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab) {
        throw new Error('无法获取当前标签页');
      }

      if (await isUrlDisabled(tab.url)) {
        showStatus('当前网站已被禁用', 'error');
        return;
      }

      // 显示处理中状态
      showStatus('正在生成PDF...', 'loading');
      
      // 禁用按钮，防止重复点击
      savePdfBtn.disabled = true;
      
      const path = downloadPath.value;

      // 向background script发送消息，触发PDF保存
      chrome.runtime.sendMessage({
        action: 'saveAsPdf',
        data: {
          title: tab.title,
          saveAs: false,
          downloadPath: path
        }
      });
      
      // 显示成功状态
      showStatus('PDF生成成功，正在下载...', 'success');
      
      // 3秒后恢复按钮状态
      setTimeout(() => {
        hideStatus();
        savePdfBtn.disabled = false;
      }, 3000);
      
    } catch (error) {
      console.error('PDF保存失败:', error);
      
      // 显示错误状态
      showStatus(`PDF保存失败: ${error.message}`, 'error');
    }
  }

  /**
   * 处理总结按钮点击事件
   */
  async function handleSummarizeClick() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        throw new Error('无法获取当前标签页');
      }

      if (await isUrlDisabled(tab.url)) {
        showStatus('当前网站已被禁用', 'error');
        return;
      }

      const apiKey = apiKeyInput.value;
      const model = modelSelect.value;

      if (!apiKey) {
        alert('请先在设置中配置您的API Key。');
        settingsContainer.style.display = 'block';
        apiKeyInput.focus();
        return;
      }

      showStatus('正在请求总结...', 'loading');
      summarizeBtn.disabled = true;

      // 1. Tell background script to start summarizing
      chrome.runtime.sendMessage({
        action: 'initiateSummary',
        data: {
          apiKey: apiKey,
          model: model,
          customPrompt: customPromptInput.value
        }
      });
      
      // The rest of the summary display is handled by content.js
      // We can close the popup or provide minimal feedback
      showStatus('总结已开始，请查看侧边栏', 'success');
      
      // Animate and close the popup
      container.classList.add('closing');
      container.addEventListener('animationend', () => {
        window.close();
      });

    } catch (error) {
      console.error('总结启动失败:', error);
      showStatus(`总结启动失败: ${error.message}`, 'error');
      summarizeBtn.disabled = false;
    }
  }
  
  /**
   * 显示状态信息
   * @param {string} message - 状态消息
   * @param {string} type - 状态类型（loading/success/error）
   */
  function showStatus(message, type) {
    // 如果是错误类型，则直接弹窗提示
    if (type === 'error') {
      alert(message);
      hideStatus();
      saveMdBtn.disabled = false;
      savePdfBtn.disabled = false;
      summarizeBtn.disabled = false; // Also re-enable summarize button on error
      return;
    }

    // 设置状态文本
    statusText.textContent = message;
    
    // 移除所有状态类
    status.classList.remove('hidden', 'success', 'error');
    
    // 添加相应的状态类
    if (type === 'success') {
      status.classList.add('success');
    } else if (type === 'error') {
      status.classList.add('error');
    }
    
    // 显示状态区域
    status.classList.remove('hidden');
  }
  
  /**
   * 隐藏状态信息
   */
  function hideStatus() {
    status.classList.add('hidden');
  }
  
  /**
   * 保存用户设置到本地存储
   */
  function saveSettings() {
    chrome.storage.local.set({
      imageEncode: imageEncode.checked,
      autoDownload: autoDownload.checked,
      downloadPath: downloadPath.value,
      deduplicate: deduplicate.checked,
      defaultSaveFormat: defaultSaveFormat.value,
      ak: akInput.value,
      sk: skInput.value,
      domain: domainInput.value,
      kbName: knowledgeBaseInput.value,
      apiKey: apiKeyInput.value,
      model: modelSelect.value,
      customPrompt: customPromptInput.value,
      disabledSites: disabledSitesTextarea.value
    });
  }
  
  /**
   * 从本地存储加载用户设置
   */
  function loadSettings() {
    chrome.storage.local.get(
      { 
        imageEncode: false, 
        autoDownload: false, 
        downloadPath: '/WebKnowledge/',
        deduplicate: false,
        defaultSaveFormat: 'markdown',
        ak: '',
        sk: '',
        domain: '',
        kbName: '',
        apiKey: '',
        model: 'deepseek',
        customPrompt: '',
        disabledSites: ''
      },
      (items) => {
        imageEncode.checked = items.imageEncode;
        autoDownload.checked = items.autoDownload;
        downloadPath.value = items.downloadPath;
        deduplicate.checked = items.deduplicate;
        defaultSaveFormat.value = items.defaultSaveFormat;
        akInput.value = items.ak;
        skInput.value = items.sk;
        domainInput.value = items.domain;
        knowledgeBaseInput.value = items.kbName;
        apiKeyInput.value = items.apiKey;
        modelSelect.value = items.model;
        customPromptInput.value = items.customPrompt;
        disabledSitesTextarea.value = items.disabledSites;
      }
    );
  }
  
  // 为设置选项添加变更事件监听器
  imageEncode.addEventListener('change', saveSettings);
  autoDownload.addEventListener('change', saveSettings);
  downloadPath.addEventListener('input', saveSettings);
  deduplicate.addEventListener('change', saveSettings);
  customPromptInput.addEventListener('input', saveSettings);
  disabledSitesTextarea.addEventListener('input', saveSettings);

  // 监听来自后台脚本的消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'showError') {
      showStatus(message.message, 'error');
    }
  });
  
  // 加载保存的设置
  loadSettings();
});