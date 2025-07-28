chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.target !== 'offscreen') {
    return;
  }

  switch (msg.type) {
    case 'create-blob-url':
      const blob = new Blob([msg.data], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      chrome.runtime.sendMessage({ type: 'blob-url-created', url });
      break;
    case 'revoke-blob-url':
      URL.revokeObjectURL(msg.url);
      break;
  }
});