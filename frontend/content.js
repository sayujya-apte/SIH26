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
        <div class="privacy-note"><span class="shield-icon" aria-hidden="true">✓</span><span>Personal info is detected and redacted on your device — nothing leaves your computer.</span></div>
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

    // Wraps chrome.runtime.sendMessage so a stale/invalidated extension context
    // (e.g. the extension was reloaded or updated while this page was already
    // open) surfaces as a clear rejection instead of an uncaught synchronous
    // throw that leaves the UI stuck on its last status message.
    function safeSendMessage(message) {
        return new Promise((resolve, reject) => {
            if (!chrome.runtime?.id) {
                reject(new Error('EXTENSION_CONTEXT_INVALIDATED'));
                return;
            }
            try {
                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) {
                        const msg = chrome.runtime.lastError.message || '';
                        reject(new Error(
                            msg.includes('Extension context invalidated')
                                ? 'EXTENSION_CONTEXT_INVALIDATED'
                                : msg
                        ));
                        return;
                    }
                    resolve(response);
                });
            } catch (err) {
                reject(
                    String(err).includes('Extension context invalidated')
                        ? new Error('EXTENSION_CONTEXT_INVALIDATED')
                        : err
                );
            }
        });
    }

    function showContextInvalidatedError() {
        submitEl.disabled = false;
        sidebar.classList.remove('is-busy');
        statusEl.textContent = 'This page needs a refresh after an extension update. Please reload the page and try again.';
        statusEl.className = 'chat-status is-error';
    }

    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === 'toggle_sidebar') {
            isVisible = !isVisible;
            sidebar.classList.toggle('active', isVisible);
            if (isVisible) window.setTimeout(() => inputEl.focus(), 250);
        }
    });

    submitEl.addEventListener('click', async () => {
        const userInput = inputEl.value;
        if (!userInput.trim() || submitEl.disabled) return;

        statusEl.textContent = 'Capturing screen…';
        statusEl.className = 'chat-status is-loading';
        submitEl.disabled = true;
        sidebar.classList.add('is-busy');
        sidebar.style.display = 'none';

        let response;
        try {
            response = await safeSendMessage({ action: 'take_screenshot' });
        } catch (err) {
            sidebar.style.display = 'block';
            if (String(err.message).includes('EXTENSION_CONTEXT_INVALIDATED')) {
                showContextInvalidatedError();
            } else {
                submitEl.disabled = false;
                sidebar.classList.remove('is-busy');
                statusEl.textContent = 'Unable to capture the current screen.';
                statusEl.className = 'chat-status is-error';
            }
            return;
        }

        sidebar.style.display = 'block';

        if (response && response.imgSrc) {
            statusEl.textContent = 'Scanning for personal info…';

            let detectResponse;
            try {
                // This one call does the whole rest of the pipeline inside background.js:
                // runs the ONNX model on the screenshot, draws black boxes over any
                // detected PII, and saves the redacted PNG to the Downloads folder.
                detectResponse = await safeSendMessage({ action: 'detect_pii', imgSrc: response.imgSrc });
            } catch (err) {
                submitEl.disabled = false;
                sidebar.classList.remove('is-busy');
                if (String(err.message).includes('EXTENSION_CONTEXT_INVALIDATED')) {
                    showContextInvalidatedError();
                } else {
                    statusEl.textContent = 'Model failed to run: ' + err.message;
                    statusEl.className = 'chat-status is-error';
                }
                return;
            }

            submitEl.disabled = false;
            sidebar.classList.remove('is-busy');

            if (detectResponse && detectResponse.success) {
                const count = detectResponse.detections ? detectResponse.detections.length : 0;

                if (detectResponse.saveError) {
                    // Detection ran fine, but chrome.downloads.download() failed
                    // (e.g. missing "downloads" permission in manifest.json).
                    statusEl.textContent = `Found ${count} region(s), but saving to Downloads failed: ${detectResponse.saveError}`;
                    statusEl.className = 'chat-status is-error';
                } else {
                    statusEl.textContent = count > 0
                        ? `Redacted ${count} region(s) and saved to Downloads.`
                        : 'No personal info detected. Original screenshot saved to Downloads.';
                    statusEl.className = 'chat-status is-success';
                    inputEl.value = '';
                }
            } else {
                statusEl.textContent = 'Model failed: ' + (detectResponse && detectResponse.error ? detectResponse.error : 'unknown error');
                statusEl.className = 'chat-status is-error';
            }

            window.setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'chat-status'; }, 4500);
        } else {
            submitEl.disabled = false;
            sidebar.classList.remove('is-busy');
            statusEl.textContent = 'Unable to capture the current screen.';
            statusEl.className = 'chat-status is-error';
        }
    });
}
