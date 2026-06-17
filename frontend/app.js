// ─── Trigul AI Frontend ─────────────────────────────────────────────

const API_BASE = 'http://localhost:8000';

class TrigulApp {
    constructor() {
        this.messages = [];
        this.isProcessing = false;
        this.currentView = 'chat';
        this.documents = [];
        this.temperature = 0.7;
        this.maxTokens = 2048;
        
        this.initElements();
        this.initEventListeners();
        this.loadSettings();
        this.fetchStatus();
        this.handleResize();
    }

    initElements() {
        this.elements = {
            sidebar: document.getElementById('sidebar'),
            sidebarToggle: document.getElementById('sidebar-toggle'),
            navItems: document.querySelectorAll('.nav-item'),
            chatMessages: document.getElementById('chat-messages'),
            chatInput: document.getElementById('chat-input'),
            sendBtn: document.getElementById('send-btn'),
            newChatBtn: document.getElementById('new-chat-btn'),
            suggestions: document.querySelectorAll('.suggestion-btn'),
            temperature: document.getElementById('temperature'),
            temperatureValue: document.getElementById('temperature-value'),
            maxTokens: document.getElementById('max-tokens'),
            systemStatus: document.getElementById('system-status'),
            modelStatus: document.getElementById('model-status'),
            docCount: document.getElementById('doc-count'),
            docModal: document.getElementById('doc-modal'),
            docContent: document.getElementById('doc-content'),
            docMetadata: document.getElementById('doc-metadata'),
            addDocBtn: document.getElementById('add-doc-btn'),
            saveDocBtn: document.getElementById('save-doc-btn'),
            modalCloseBtns: document.querySelectorAll('.modal-close'),
            documentsList: document.getElementById('documents-list'),
            views: document.querySelectorAll('.view'),
        };
    }

    initEventListeners() {
        // Navigation
        this.elements.navItems.forEach(item => {
            item.addEventListener('click', () => this.switchView(item.dataset.view));
        });

        // Sidebar toggle
        this.elements.sidebarToggle.addEventListener('click', () => {
            this.elements.sidebar.classList.toggle('open');
        });

        // Chat
        this.elements.sendBtn.addEventListener('click', () => this.sendMessage());
        this.elements.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        this.elements.chatInput.addEventListener('input', () => {
            this.elements.chatInput.style.height = 'auto';
            this.elements.chatInput.style.height = this.elements.chatInput.scrollHeight + 'px';
        });

        // New chat
        this.elements.newChatBtn.addEventListener('click', () => this.newChat());

        // Suggestions
        this.elements.suggestions.forEach(btn => {
            btn.addEventListener('click', () => {
                this.elements.chatInput.value = btn.textContent;
                this.sendMessage();
            });
        });

        // Settings
        this.elements.temperature.addEventListener('input', () => {
            this.temperature = parseFloat(this.elements.temperature.value);
            this.elements.temperatureValue.textContent = this.temperature.toFixed(1);
            localStorage.setItem('trigul_temperature', this.temperature);
        });

        this.elements.maxTokens.addEventListener('change', () => {
            this.maxTokens = parseInt(this.elements.maxTokens.value) || 2048;
            localStorage.setItem('trigul_max_tokens', this.maxTokens);
        });

        // Documents
        this.elements.addDocBtn.addEventListener('click', () => {
            this.elements.docModal.style.display = 'flex';
        });

        this.elements.saveDocBtn.addEventListener('click', () => this.addDocument());

        this.elements.modalCloseBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.elements.docModal.style.display = 'none';
            });
        });

        // Close modal on click outside
        this.elements.docModal.addEventListener('click', (e) => {
            if (e.target === this.elements.docModal) {
                this.elements.docModal.style.display = 'none';
            }
        });

        // Window resize
        window.addEventListener('resize', () => this.handleResize());
    }

    switchView(view) {
        this.currentView = view;
        
        // Update nav items
        this.elements.navItems.forEach(item => {
            item.classList.toggle('active', item.dataset.view === view);
        });

        // Update views
        this.elements.views.forEach(v => {
            v.classList.toggle('active', v.id === `${view}-view`);
        });

        // Close sidebar on mobile
        if (window.innerWidth <= 768) {
            this.elements.sidebar.classList.remove('open');
        }
    }

    handleResize() {
        if (window.innerWidth > 768) {
            this.elements.sidebar.classList.remove('open');
        }
    }

    async sendMessage() {
        const input = this.elements.chatInput;
        const message = input.value.trim();
        
        if (!message || this.isProcessing) return;
        
        input.value = '';
        input.style.height = 'auto';
        
        // Add user message
        this.addMessage('user', message);
        this.isProcessing = true;
        this.setSendButtonState(false);
        
        // Show typing indicator
        const typingId = this.showTypingIndicator();
        
        try {
            const response = await this.callAPI(message);
            this.removeTypingIndicator(typingId);
            this.addMessage('assistant', response);
        } catch (error) {
            this.removeTypingIndicator(typingId);
            this.addMessage('assistant', `Error: ${error.message}`);
        } finally {
            this.isProcessing = false;
            this.setSendButtonState(true);
        }
    }

    async callAPI(message) {
        const messages = [
            { role: 'system', content: 'You are Trigul, an advanced AI assistant.' },
            ...this.messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
        ];

        try {
            const response = await fetch(`${API_BASE}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: messages,
                    temperature: this.temperature,
                    max_tokens: this.maxTokens,
                    stream: false
                })
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            return data.choices[0].message.content;
        } catch (error) {
            console.error('API Error:', error);
            throw new Error('Failed to get response from Trigul');
        }
    }

    addMessage(role, content) {
        this.messages.push({ role, content });
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message message-${role}`;
        messageDiv.innerHTML = `
            <div class="message-avatar">${role === 'user' ? '👤' : '✨'}</div>
            <div class="message-content">
                <div class="role">${role === 'user' ? 'You' : 'Trigul'}</div>
                <div class="text">${this.formatContent(content)}</div>
            </div>
        `;
        
        // Insert before the welcome message or at the end
        const welcomeMsg = this.elements.chatMessages.querySelector('.welcome-message');
        if (welcomeMsg && this.messages.length <= 2) {
            welcomeMsg.remove();
        }
        
        this.elements.chatMessages.appendChild(messageDiv);
        this.scrollToBottom();
    }

    formatContent(content) {
        // Simple formatting
        let formatted = content
            .replace(/\n/g, '<br>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>');
        
        // Code blocks
        formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
            return `<pre><code class="language-${lang || 'text'}">${code.trim()}</code></pre>`;
        });
        
        // Inline code
        formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
        
        return formatted;
    }

    showTypingIndicator() {
        const id = 'typing-' + Date.now();
        const div = document.createElement('div');
        div.id = id;
        div.className = 'message message-assistant';
        div.innerHTML = `
            <div class="message-avatar">✨</div>
            <div class="message-content">
                <div class="role">Trigul</div>
                <div class="text">
                    <span class="typing-dots">
                        <span>●</span><span>●</span><span>●</span>
                    </span>
                </div>
            </div>
        `;
        this.elements.chatMessages.appendChild(div);
        this.scrollToBottom();
        return id;
    }

    removeTypingIndicator(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    }

    setSendButtonState(enabled) {
        this.elements.sendBtn.disabled = !enabled;
    }

    scrollToBottom() {
        setTimeout(() => {
            this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
        }, 50);
    }

    newChat() {
        this.messages = [];
        this.elements.chatMessages.innerHTML = `
            <div class="welcome-message">
                <div class="welcome-icon">✨</div>
                <h2>Welcome to Trigul</h2>
                <p>Your advanced AI assistant. Ask me anything!</p>
                <div class="suggestions">
                    <button class="suggestion-btn">Explain quantum computing</button>
                    <button class="suggestion-btn">Write a poem about AI</button>
                    <button class="suggestion-btn">Help me with Python code</button>
                    <button class="suggestion-btn">What's the meaning of life?</button>
                </div>
            </div>
        `;
        
        // Re-bind suggestion buttons
        document.querySelectorAll('.suggestion-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.elements.chatInput.value = btn.textContent;
                this.sendMessage();
            });
        });
    }

    async addDocument() {
        const content = this.elements.docContent.value.trim();
        const metadata = this.elements.docMetadata.value.trim();
        
        if (!content) {
            alert('Please enter document content.');
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/v1/documents`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: content,
                    metadata: metadata ? { name: metadata } : {}
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to add document: ${response.status}`);
            }

            const data = await response.json();
            this.documents.push(data.document);
            this.renderDocuments();
            this.updateDocCount();
            
            this.elements.docContent.value = '';
            this.elements.docMetadata.value = '';
            this.elements.docModal.style.display = 'none';
            
        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    }

    renderDocuments() {
        const container = this.elements.documentsList;
        
        if (this.documents.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📄</div>
                    <h3>No documents added</h3>
                    <p>Add documents to enhance Trigul's knowledge</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.documents.map(doc => `
            <div class="doc-item">
                <div class="title">${doc.metadata?.name || 'Untitled Document'}</div>
                <div class="preview">${doc.content.substring(0, 200)}${doc.content.length > 200 ? '...' : ''}</div>
                <div class="meta">Added: ${new Date(doc.created_at * 1000).toLocaleDateString()}</div>
            </div>
        `).join('');
    }

    updateDocCount() {
        this.elements.docCount.textContent = this.documents.length;
    }

    loadSettings() {
        const temp = localStorage.getItem('trigul_temperature');
        if (temp) {
            this.temperature = parseFloat(temp);
            this.elements.temperature.value = this.temperature;
            this.elements.temperatureValue.textContent = this.temperature.toFixed(1);
        }
        
        const maxTokens = localStorage.getItem('trigul_max_tokens');
        if (maxTokens) {
            this.maxTokens = parseInt(maxTokens);
            this.elements.maxTokens.value = this.maxTokens;
        }
    }

    async fetchStatus() {
        try {
            const response = await fetch(`${API_BASE}/health`);
            if (response.ok) {
                const data = await response.json();
                this.elements.systemStatus.textContent = data.model_loaded ? 'Online' : 'Limited';
                this.elements.systemStatus.className = `status-badge ${data.model_loaded ? 'online' : 'offline'}`;
                this.elements.modelStatus.textContent = data.model_loaded ? 'Trigul-7B' : 'Fallback Mode';
                this.elements.docCount.textContent = data.documents || 0;
            }
        } catch (error) {
            console.warn('Could not connect to backend');
            this.elements.systemStatus.textContent = 'Offline';
            this.elements.systemStatus.className = 'status-badge offline';
        }
    }
}

// ─── Initialize ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    const app = new TrigulApp();
    window.trigulApp = app;
});
