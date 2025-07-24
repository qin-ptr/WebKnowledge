/**
 * background.js - WebKnowledge的后台服务工作者
 * 
 * 这个文件实现了Chrome扩展的后台逻辑，包括：
 * 1. 监听来自popup和content script的消息
 * 2. 处理Markdown转换请求
 * 3. 管理文件下载功能
 * 4. 实现URL匹配的自动转换功能
 */

// 存储URL白名单模式
const URL_PATTERNS = [
  // 示例白名单模式，可以根据需要修改
  "*://*.github.com/*",
  "*://*.medium.com/*",
  "*://developer.mozilla.org/*"
];

// 存储最近一次下载的ID
let lastDownloadId = null;

/**
 * 检查当前URL是否在禁用网站列表中
 * @param {string} url - 当前页面的URL
 * @returns {Promise<boolean>} - 如果URL被禁用，返回true；否则返回false。
 */
async function isUrlDisabled(url) {
  try {
    const items = await chrome.storage.local.get({ disabledSites: '' });
    const disabledSites = items.disabledSites
      .split('\n')
      .map(s => s.trim().toLowerCase()) // 转换为小写以进行不区分大小写的比较
      .filter(s => s.length > 0);

    if (disabledSites.length === 0) {
      return false;
    }

    const urlHostname = new URL(url).hostname.toLowerCase(); // 同样转换为小写

    return disabledSites.some(disabledSite => {
      // 完全匹配或子域名匹配
      return urlHostname === disabledSite || urlHostname.endsWith('.' + disabledSite);
    });
  } catch (e) {
    console.error("isUrlDisabled函数出错:", e);
    return false; // 安全起见，返回false
  }
}

// 初始化扩展
chrome.runtime.onInstalled.addListener(() => {
  console.log("WebKnowledge已安装");
});

async function getCurrentTab() {
  let queryOptions = { active: true, currentWindow: true };
  let [tab] = await chrome.tabs.query(queryOptions);
  return tab;
}

/**
 * 规范化下载路径
 * @param {string} path - 原始路径
 * @returns {string} 规范化后的路径
 */
function normalizePath(path) {
  let normalizedPath = path || '';
  if (!normalizedPath) {
    return '';
  }
  // 移除开头的斜杠，以确保路径是相对的
  if (normalizedPath.startsWith('/')) {
    normalizedPath = normalizedPath.substring(1);
  }
  // 如果路径不为空且不以斜杠结尾，则添加斜杠
  if (normalizedPath && !normalizedPath.endsWith('/')) {
    normalizedPath += '/';
  }
  return normalizedPath;
}


/**
 * 监听来自popup.js或content.js的消息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        const tab = sender.tab || await getCurrentTab();
        if (!tab || !tab.id) {
            console.error("无法获取有效的标签页。");
            if (message.action === 'initiateSummary') {
                sendResponse({ success: false, message: '无法获取有效的标签页' });
            }
            return;
        }

        const { action, data } = message;

        // 在执行任何操作前检查URL是否被禁用
        if (tab && tab.url && await isUrlDisabled(tab.url)) {
            const errorMessage = '此网站已被禁用，无法执行保存或AI总结操作。';
            if (action === 'initiateSummary' || action === 'convertAndDownload' || action === 'saveAsPdf') {
                // 对于需要用户反馈的操作，发送错误消息到popup
                chrome.tabs.sendMessage(tab.id, { action: 'showError', message: errorMessage });
            }
            console.warn(`尝试在禁用网站上执行操作: ${tab.url}`);
            return; // 阻止后续操作
        }

        switch (action) {
            case "convertAndDownload":
                await handleConvertAndDownload(data, tab);
                break;
            case "saveAsPdf":
                await handleSaveAsPdf(data, tab);
                break;
            case "openDownloadFolder":
                if (lastDownloadId) {
                    chrome.downloads.show(lastDownloadId);
                } else {
                    chrome.downloads.showDefaultFolder();
                }
                break;
            case "autoConvert":
                console.log(`自动转换结果 - 标题: ${data.title}`);
                console.log(data.markdown);
                break;
            case 'initiateSummary':
                sendResponse({ success: true, message: '总结请求已启动' });
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ['js/marked.min.js', 'utils/markdown.js', 'js/content.js']
                    });
                    await chrome.scripting.insertCSS({
                        target: { tabId: tab.id },
                        files: ['css/content.css']
                    });
                    await chrome.tabs.sendMessage(tab.id, { action: 'initiateSummaryFlow', data: data });
                } catch (err) {
                    console.error(`启动总结流程失败: ${err.message}`);
                }
                break;
            case 'fetchSummary':
                await handleSummarization(data, tab.id);
                break;
            default:
                console.error(`未知的消息类型: "${action}"`);
        }
    })();

    return true; // Keep the message channel open for async response
});

/**
 * 处理转换和下载请求
 * @param {Object} data - 包含HTML内容和页面标题的对象
 * @param {Object} tab - 发送请求的标签页信息
 */
async function handleConvertAndDownload(data, tab) {
  try {
    const downloadPath = normalizePath(data.downloadPath);
    const fileName = downloadPath + sanitizeFileName(data.title) + ".md";
    
    // 将Markdown内容转换为Data URL
    const markdownContent = data.markdown;
    const dataUrl = "data:text/markdown;charset=utf-8," + encodeURIComponent(markdownContent);
    
    // 下载文件
    const downloadId = await chrome.downloads.download({
      url: dataUrl, 
      filename: fileName, 
      saveAs: data.saveAs || false,
      conflictAction: 'overwrite'
    });

    if (downloadId) {
      lastDownloadId = downloadId;
    }
    
    // 通知成功 
    if (tab) { 
      chrome.tabs.sendMessage(tab.id, { 
        action: "downloadComplete", 
        success: true 
      }); 
    } 
  } catch (error) { 
    console.error("下载失败:", error);
    
    // 通知失败
    if (tab) {
      chrome.tabs.sendMessage(tab.id, { 
        action: "downloadComplete", 
        success: false,
        error: error.message
      });
    }
  }
}

/**
 * 处理保存为PDF的请求
 * @param {Object} data - 包含页面标题和下载路径的对象
 * @param {Object} tab - 发送请求的标签页信息
 */
async function handleSaveAsPdf(data, tab) {
  const tabId = tab.id;
  const downloadPath = normalizePath(data.downloadPath);
  const fileName = downloadPath + sanitizeFileName(data.title) + ".pdf";

  try {
    // 1. Attach debugger to the tab
    await new Promise((resolve, reject) => {
      chrome.debugger.attach({ tabId }, "1.3", () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });

    // 2. Print to PDF
    const result = await new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, "Page.printToPDF", {}, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result);
        }
      });
    });

    // 3. Detach debugger
    await new Promise((resolve) => {
      chrome.debugger.detach({ tabId }, resolve);
    });

    // 4. Download PDF
    const dataUrl = "data:application/pdf;base64," + result.data;
    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename: fileName,
      saveAs: data.saveAs || false,
      conflictAction: 'overwrite'
    });

    if (downloadId) {
      lastDownloadId = downloadId;
    }

  } catch (error) {
    console.error("保存PDF失败:", error);
    // Detach debugger in case of error
    chrome.debugger.detach({ tabId });
  }
}

/**
 * 清理文件名，移除不允许的字符
 * @param {string} fileName - 原始文件名
 * @returns {string} 清理后的文件名
 */
function sanitizeFileName(fileName) {
  // 移除不允许的字符（Windows, macOS, Linux文件系统通用限制）
  return fileName
    .replace(/[\\/:*?"<>|]/g, "_") // 替换特殊字符
    .replace(/\s+/g, " ")          // 多个空格替换为单个空格
    .trim();                       // 移除首尾空格
}

/**
 * 检查URL是否匹配白名单模式
 * @param {string} url - 要检查的URL
 * @returns {boolean} 是否匹配
 */
function isUrlMatched(url) {
  return URL_PATTERNS.some(pattern => {
    // 将通配符模式转换为正则表达式
    const regexPattern = pattern
      .replace(/\./g, "\\.")
      .replace(/\*/g, ".*");
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(url);
  });
}

/**
 * 监听标签页更新事件，用于自动转换功能
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 只在页面完全加载后执行
  if (changeInfo.status === "complete" && tab.url) {
    // 检查是否启用了自动下载
    chrome.storage.local.get({ autoDownload: false, downloadPath: 'Markdown/', imageEncode: true }, async (items) => {
      if (items.autoDownload) {
        // 在自动下载前检查URL是否被禁用
        if (await isUrlDisabled(tab.url)) {
          console.log(`自动下载已跳过，因为 ${tab.url} 在禁用列表中。`);
          return; // 如果被禁用，则不执行任何操作
        }

        const downloadSubPath = normalizePath(items.downloadPath);
        // 如果是PDF文件，则直接下载
        if (tab.url.toLowerCase().endsWith('.pdf')) {
          try {
            const fileName = downloadSubPath + decodeURIComponent(tab.url.split('/').pop());
            const downloadId = await chrome.downloads.download({
              url: tab.url,
              filename: fileName,
              saveAs: false
            });
            if (downloadId) {
              lastDownloadId = downloadId;
            }
          } catch (error) {
            console.error('自动下载PDF失败:', error);
          }
        } else {
          // 否则，执行Markdown转换和下载
          try {
            // 注入并执行内容脚本
            await chrome.scripting.executeScript({
              target: { tabId: tabId },
              files: ['utils/markdown.js', 'js/content.js']
            });

            // 获取页面内容
            const response = await chrome.tabs.sendMessage(tabId, { 
              action: 'getPageContent',
              options: { imageOption: items.imageEncode ? 'base64' : 'http' } // 根据新的设置传递选项
            });

            if (response && response.success) {
              // 下载
              await handleConvertAndDownload({ 
                title: tab.title, 
                markdown: response.markdown, 
                downloadPath: downloadSubPath 
              }, tab);
            }
          } catch (error) {
            console.error('自动下载失败:', error);
          }
        }
      }
    });
  }
});


/**
 * 处理内容总结请求
 * @param {object} data - 包含API Key和模型信息的对象
 * @param {number} tabId - 发起请求的标签页ID
 */
async function handleSummarization(data, tabId) {
  const { apiKey, model, content, customPrompt } = data;
  const chunkSize = 30000; // Also used as the threshold for skipping compression

  try {
    if (!content || content.trim() === '') {
      throw new Error('无法获取有效的页面内容进行总结，请确保页面已完全加载且包含可提取的文本。');
    }

    let contentForFinalSummary;

    // If content is short enough, skip the compression step
    if (content.length <= chunkSize) {
      contentForFinalSummary = content;
      await chrome.tabs.sendMessage(tabId, { action: 'summaryProgress', data: '内容较短，直接生成最终摘要...' });
    } else {
      // Content is long, so we proceed with chunking and compression
      // 1. Smart Chunking
      const lines = content.split('\n');
      const chunks = [];
      let currentChunk = '';

      for (const line of lines) {
        if (currentChunk.length + line.length + 1 > chunkSize && currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = line;
        } else {
          if (currentChunk.length > 0) {
            currentChunk += '\n' + line;
          } else {
            currentChunk = line;
          }
        }
      }

      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
      }

      // 2. Compress each chunk
      const chunkSummaries = [];
      await chrome.tabs.sendMessage(tabId, { action: 'summaryProgress', data: `正在准备数据...` });

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        await chrome.tabs.sendMessage(tabId, { action: 'summaryProgress', data: `正在整理数据 (${i + 1}/${chunks.length})...` });
        const systemPrompt = `你是一个极致文本压缩助手。请将以下文本内容压缩至原始长度的1/5-1/10，只保留核心事实和关键信息。这是系列文本的第 ${i + 1} 部分（共 ${chunks.length} 部分）。使用最简洁语言，不添加解释或标题。`;
        
        const summary = await getCompressedSummaryForChunk(chunk, apiKey, model, systemPrompt);
        chunkSummaries.push(summary);
      }

      // 3. Combine compressed summaries
      contentForFinalSummary = chunkSummaries.join('\n\n---\n\n');
      await chrome.tabs.sendMessage(tabId, { action: 'summaryProgress', data: '数据整理完毕，正在生成最终摘要...' });
    }

    // 4. Generate the final summary
    const tab = await chrome.tabs.get(tabId);
    const pageUrl = tab.url;
    const finalSystemPrompt = customPrompt 
      ? customPrompt.replace(/{{pageUrl}}/g, pageUrl) 
      : `你是一位专业的行业分析师。请阅读并总结以下网页文章的核心内容。我需要一个非常简洁、能让我快速了解全文的摘要。

请按照以下格式输出：

**🎯 核心主题:** (用一句话概括文章解决了什么问题或介绍了什么技术)

**🔑 关键亮点:**
- **亮点一:** (提炼第一个关键信息或观点)
- **亮点二:** (提炼第二个关键信息或观点)
- **亮点三:** (提炼第三个关键信息或观点)
... (根据内容提炼3-5个最重要的点)

**💡 主要结论:** (总结文章的最终结论或未来展望)`;
    await streamFinalSummary(contentForFinalSummary, apiKey, model, tabId, finalSystemPrompt);

    // 5. Send completion message
    await chrome.tabs.sendMessage(tabId, { action: 'summaryComplete' });

  } catch (error) {
    console.error('总结过程中发生错误:', error);
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'summaryError', data: error.message });
    } catch (e) {
      console.error('无法向内容脚本发送错误消息:', e.message);
    }
  }
}

/**
 * 获取API的URL和模型名称
 * @param {string} model - 用户选择的模型
 * @returns {{apiUrl: string, apiModelName: string}}
 */
function getApiDetails(model) {
    const modelApiDetails = {
        'deepseek': {
            url: 'https://api.deepseek.com/chat/completions',
            name: 'deepseek-chat'
        },
        'doubao-seed-1-6': {
            url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
            name: 'doubao-seed-1-6-250615'
        }
    };

    let apiDetails = modelApiDetails[model];
    if (!apiDetails) {
        if (model === 'doubao') {
            apiDetails = modelApiDetails['doubao-seed-1-6'];
        } else {
            throw new Error(`无效的模型选择: ${model}`);
        }
    }
    return { apiUrl: apiDetails.url, apiModelName: apiDetails.name };
}

/**
 * 获取单个内容块的压缩总结（非流式）
 * @param {string} chunk - 要总结的内容块
 * @param {string} apiKey - API密钥
 * @param {string} model - 模型名称
 * @param {string} systemPrompt - 系统提示
 * @returns {Promise<string>} 压缩后的总结文本
 */
async function getCompressedSummaryForChunk(chunk, apiKey, model, systemPrompt) {
  const { apiUrl, apiModelName } = getApiDetails(model);

  const fetchResponse = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: apiModelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: chunk }
      ],
      stream: false // 非流式请求
    })
  });

  if (!fetchResponse.ok) {
    const errorBody = await fetchResponse.text();
    throw new Error(`API请求失败（压缩阶段），状态码: ${fetchResponse.status}, 响应: ${errorBody}`);
  }

  const responseData = await fetchResponse.json();
  if (responseData.choices && responseData.choices[0].message && responseData.choices[0].message.content) {
    return responseData.choices[0].message.content;
  } else {
    console.error("API 响应格式不正确:", responseData);
    throw new Error('API响应格式不正确（压缩阶段）。');
  }
}


/**
 * 对最终合并的内容进行流式总结
 * @param {string} content - 要总结的合并内容
 * @param {string} apiKey - API密钥
 * @param {string} model - 模型名称
 * @param {number} tabId - 标签页ID
 * @param {string} systemPrompt - 系统提示
 */
async function streamFinalSummary(content, apiKey, model, tabId, systemPrompt) {
    const { apiUrl, apiModelName } = getApiDetails(model);

    const fetchResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: apiModelName,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: content }
            ],
            stream: true // 流式请求
        })
    });

    if (!fetchResponse.ok) {
        const errorBody = await fetchResponse.text();
        throw new Error(`API请求失败（最终总结阶段），状态码: ${fetchResponse.status}, 响应: ${errorBody}`);
    }

    const reader = fetchResponse.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            if (line.startsWith('data:')) {
                const jsonStr = line.substring(5).trim();
                if (jsonStr === '[DONE]') return;
                try {
                    const chunkData = JSON.parse(jsonStr);
                    if (chunkData.choices && chunkData.choices[0].delta.content) {
                        const contentChunk = chunkData.choices[0].delta.content;
                        // 流式发送回 content script
                        await chrome.tabs.sendMessage(tabId, { action: 'summaryChunk', data: contentChunk });
                    }
                } catch (error) {
                    console.error('解析JSON失败:', error, '原始行:', line);
                }
            }
        }
    }
}