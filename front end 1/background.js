chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url.startsWith("chrome://") || tab.url.startsWith("https://chrome.google.com/webstore")) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { action: "toggle_sidebar" });
  } catch (error) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    chrome.tabs.sendMessage(tab.id, { action: "toggle_sidebar" });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. Handle Screenshot
  if (request.action === "take_screenshot") {
    setTimeout(() => {
      chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
        sendResponse({ imgSrc: dataUrl });
      });
    }, 150);
    return true;
  }

  // 2. Handle Backend POST Request
  // 2. Handle Backend POST Request
  if (request.action === "send_to_backend") {
    // Point this to your locally running Express server
    const backendUrl = "http://localhost:3000/api/data";

    fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      // The payload contains the text input and the base64 image data
      body: JSON.stringify(request.payload)
    })
      // ... rest of your fetch logic
      .then(response => {
        console.log("Successfully sent to backend");
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error("Error sending to backend:", error);
        sendResponse({ success: false, error: error.toString() });
      });

    return true; // Keeps the message channel open for the async fetch response
  }
});