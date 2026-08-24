// --- INJECTION GUARD ---
if (!document.getElementById('my-chatbot-sidebar')) {
  const sidebar = document.createElement('aside');
  sidebar.id = 'my-chatbot-sidebar';
  sidebar.setAttribute('aria-label', 'Privacy assistant');
  sidebar.innerHTML = `
    <div class="privacy-shell">
      <header class="privacy-header">
        <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="brand-copy">
          <p class="eyebrow">Privacy assistant</p>
          <h2>ScreenSafe</h2>
        </div>
        <div class="connection-status" title="Ready to capture"><span></span><span class="sr-only">Ready</span></div>
      </header>

      <main class="privacy-body">
        <div class="welcome-block">
          <p class="kicker">Capture context</p>
          <h3>What can we help you with?</h3>
          <p class="description">Describe the issue and we&apos;ll securely capture the current screen for context.</p>
        </div>
        <div class="privacy-note"><span class="shield-icon" aria-hidden="true">✓</span><span>Your screenshot is saved locally before it is sent.</span></div>
        <label class="input-label" for="chat-input">Your request</label>
        <textarea id="chat-input" rows="6" placeholder="Please enter the user prompt..." aria-describedby="input-hint"></textarea>
        <p id="input-hint" class="input-hint"> </p>
        <div id="chat-status" class="chat-status" role="status" aria-live="polite" aria-atomic="true"></div>
      </main>

      <footer class="privacy-footer">
        <button id="chat-submit" type="button"><span class="button-icon" aria-hidden="true">↗</span><span>Submit &amp; capture</span></button>
        <p class="footer-copy"><span class="lock-icon" aria-hidden="true">⌑</span> Private by design</p>
      </footer>
    </div>
  `;

  document.body.appendChild(sidebar);

  let isVisible = true;
  sidebar.classList.add('active');
  const inputEl = sidebar.querySelector('#chat-input');
  const submitEl = sidebar.querySelector('#chat-submit');
  const statusEl = sidebar.querySelector('#chat-status');

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'toggle_sidebar') {
      isVisible = !isVisible;
      sidebar.classList.toggle('active', isVisible);
      if (isVisible) window.setTimeout(() => inputEl.focus(), 250);
    }
  });

  submitEl.addEventListener('click', () => {
    const userInput = inputEl.value;
    if (!userInput.trim() || submitEl.disabled) return;

    statusEl.textContent = 'Capturing screen…';
    statusEl.className = 'chat-status is-loading';
    submitEl.disabled = true;
    sidebar.classList.add('is-busy');
    sidebar.style.display = 'none';

    chrome.runtime.sendMessage({ action: 'take_screenshot' }, (response) => {
      sidebar.style.display = 'block';

      if (response && response.imgSrc) {
        statusEl.textContent = 'Saving locally & sending…';
        const payload = { prompt: userInput, image: response.imgSrc, timestamp: new Date().toISOString() };

        chrome.storage.local.set({
          lastPrompt: payload.prompt,
          lastScreenshot: payload.image,
          lastTimestamp: payload.timestamp
        }, () => {
          chrome.runtime.sendMessage({ action: 'send_to_backend', payload }, (backendResponse) => {
            submitEl.disabled = false;
            sidebar.classList.remove('is-busy');
            if (backendResponse && backendResponse.success) {
              statusEl.textContent = 'Saved locally & sent to backend.';
              statusEl.className = 'chat-status is-success';
              inputEl.value = '';
            } else {
              statusEl.textContent = 'Saved locally, but backend failed.';
              statusEl.className = 'chat-status is-error';
            }
            window.setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'chat-status'; }, 3500);
          });
        });
      } else {
        submitEl.disabled = false;
        sidebar.classList.remove('is-busy');
        statusEl.textContent = 'Unable to capture the current screen.';
        statusEl.className = 'chat-status is-error';
      }
    });
  });
}
