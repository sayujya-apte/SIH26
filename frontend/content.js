// --- INJECTION GUARD ---
if (!document.getElementById('my-chatbot-sidebar')) {
  
  // 1. Build the Sidebar UI
  const sidebar = document.createElement('div');
  sidebar.id = 'my-chatbot-sidebar';
  sidebar.style.cssText = `
    position: fixed;
    top: 0;
    right: -350px;
    width: 320px;
    height: 100vh;
    background: #ffffff;
    box-shadow: -4px 0 15px rgba(0,0,0,0.1);
    z-index: 2147483647; 
    transition: right 0.3s ease;
    padding: 20px;
    box-sizing: border-box;
    font-family: system-ui, -apple-system, sans-serif;
    display: flex;
    flex-direction: column;
  `;

  sidebar.innerHTML = `
    <h2 style="margin-top: 0; font-size: 18px; color: #333;">Support Chat</h2>
    <textarea id="chat-input" rows="5" style="width: 100%; padding: 10px; margin-bottom: 15px; border: 1px solid #ccc; border-radius: 6px; resize: none; box-sizing: border-box;" placeholder="How can I help you?"></textarea>
    <button id="chat-submit" style="width: 100%; padding: 12px; background: #007bff; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">Submit & Capture</button>
    <p id="chat-status" style="font-size: 13px; color: #28a745; margin-top: 15px; display: none; text-align: center;">Saved, Captured & Sent!</p>
  `;

  document.body.appendChild(sidebar);

  // 2. Handle toggling the sidebar visibility
  let isVisible = false;
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "toggle_sidebar") {
      isVisible = !isVisible;
      sidebar.style.right = isVisible ? "0px" : "-350px";
    }
  });

  // 3. Handle Submit logic
  document.getElementById('chat-submit').addEventListener('click', () => {
    const inputEl = document.getElementById('chat-input');
    const statusEl = document.getElementById('chat-status');
    const userInput = inputEl.value;

    if (!userInput.trim()) return;

    // Show a loading state
    statusEl.textContent = "Capturing screen...";
    statusEl.style.display = 'block';
    statusEl.style.color = '#007bff'; 

    // Step A: Hide the sidebar entirely 
    sidebar.style.display = 'none';

    // Step B: Ask background.js to take a screenshot
    chrome.runtime.sendMessage({ action: "take_screenshot" }, (response) => {
      
      // Step C: Show the sidebar again once the screenshot is complete
      sidebar.style.display = 'flex';

      if (response && response.imgSrc) {
        statusEl.textContent = "Saving locally & Sending...";

        const payload = {
          prompt: userInput,
          image: response.imgSrc,
          timestamp: new Date().toISOString()
        };

        // Step D: Save a copy to Chrome's local storage BEFORE sending
        chrome.storage.local.set({ 
          lastPrompt: payload.prompt, 
          lastScreenshot: payload.image,
          lastTimestamp: payload.timestamp
        }, () => {
          
          // Step E: Send the payload to background.js to make the POST request
          chrome.runtime.sendMessage({ action: "send_to_backend", payload: payload }, (backendResponse) => {
            if (backendResponse && backendResponse.success) {
              statusEl.textContent = "Saved locally & Sent to backend!";
              statusEl.style.color = '#28a745'; 
              inputEl.value = ''; 
            } else {
              statusEl.textContent = "Saved locally, but backend failed.";
              statusEl.style.color = '#dc3545'; 
            }

            setTimeout(() => {
              statusEl.style.display = 'none';
            }, 3000);
          });
        });
      }
    });
  });
}