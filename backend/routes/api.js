const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// Global storage (in-memory)
global.documents = global.documents || [];
global.conversations = global.conversations || {};

// ─── AI Engine ─────────────────────────────────────────────────────

class TrigulAI {
  constructor() {
    this.model = null;
    this.tokenizer = null;
    this.isLoaded = false;
    this.modelName = process.env.MODEL_NAME || 'deepseek-ai/deepseek-llm-7b-chat';
    this.maxTokens = parseInt(process.env.MAX_TOKENS) || 2048;
    this.temperature = parseFloat(process.env.TEMPERATURE) || 0.7;
    
    // Fallback responses
    this.fallbackResponses = [
      "I understand your question. As Trigul, I'm designed to provide thoughtful and accurate responses.",
      "That's an interesting point. Let me think about that from multiple perspectives.",
      "I appreciate your question. Here's what I can share based on my training.",
      "Great question! I'd like to help you explore this topic in depth.",
      "Let me analyze that for you. This is a complex but fascinating subject."
    ];
    
    // Try to load the model
    this.loadModel();
  }

  async loadModel() {
    try {
      console.log(`🔮 Loading model: ${this.modelName}...`);
      
      // Try to load with transformers.js
      try {
        const { pipeline } = await import('@xenova/transformers');
        this.pipeline = pipeline;
        
        // Load text generation pipeline
        this.generator = await pipeline('text-generation', this.modelName, {
          device: 'cpu',
          dtype: 'fp32'
        });
        
        this.isLoaded = true;
        console.log('✅ Model loaded successfully!');
        return true;
      } catch (e) {
        console.warn('⚠️ Could not load model with transformers.js:', e.message);
        console.log('📝 Using fallback mode');
        this.isLoaded = false;
        return false;
      }
    } catch (error) {
      console.error('❌ Failed to load model:', error.message);
      this.isLoaded = false;
      return false;
    }
  }

  async generateResponse(messages, temperature = 0.7, maxTokens = 2048) {
    if (!this.isLoaded || !this.generator) {
      return this.generateFallbackResponse(messages);
    }

    try {
      // Format messages for the model
      const formattedMessages = this.formatMessages(messages);
      
      // Generate response
      const result = await this.generator(formattedMessages, {
        max_new_tokens: maxTokens,
        temperature: temperature,
        do_sample: true,
        top_p: 0.9,
        repetition_penalty: 1.1,
      });

      // Extract the generated text
      let response = result[0]?.generated_text || '';
      
      // Clean up the response (remove the prompt)
      if (response.includes('assistant:')) {
        response = response.split('assistant:').pop().trim();
      }
      
      return response || this.generateFallbackResponse(messages);
    } catch (error) {
      console.error('Error generating response:', error);
      return this.generateFallbackResponse(messages);
    }
  }

  formatMessages(messages) {
    let formatted = '';
    
    // System prompt
    formatted += 'System: You are Trigul, an advanced AI assistant. Be helpful, thoughtful, and accurate.\n';
    
    // Conversation
    for (const msg of messages) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      formatted += `${role}: ${msg.content}\n`;
    }
    
    formatted += 'Assistant: ';
    return formatted;
  }

  generateFallbackResponse(messages) {
    // Get the last user message
    let lastUserMsg = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserMsg = messages[i].content;
        break;
      }
    }

    // Generate contextual response
    const responses = [
      `Thank you for your question. Let me think about that carefully.`,
      `That's a great question. Here's my perspective on this.`,
      `I appreciate you asking about this. Let me provide a thoughtful response.`,
      `This is an interesting topic. Let me share my insights with you.`
    ];

    let response = responses[Math.floor(Math.random() * responses.length)];

    // Add substance based on keywords
    const keywords = {
      'code': '\n\nWhen working with code, it\'s important to follow best practices and consider edge cases.',
      'programming': '\n\nProgramming requires logical thinking and problem-solving skills.',
      'learn': '\n\nContinuous learning is key to growth. Break complex topics into manageable chunks.',
      'ai': '\n\nAs an AI assistant, I\'m here to help with your questions and provide thoughtful analysis.',
      'python': '\n\nPython is a versatile language with extensive libraries for various applications.',
      'javascript': '\n\nJavaScript is essential for web development and runs everywhere.'
    };

    for (const [key, value] of Object.entries(keywords)) {
      if (lastUserMsg.toLowerCase().includes(key)) {
        response += value;
        break;
      }
    }

    // Add a generic follow-up
    response += '\n\nIs there anything specific you\'d like me to elaborate on?';

    return response;
  }

  chatCompletion(messages, temperature, maxTokens) {
    // Check if there's a conversation ID
    const lastMsg = messages[messages.length - 1];
    
    return this.generateResponse(messages, temperature, maxTokens);
  }
}

// Initialize the AI engine
global.trigulModel = new TrigulAI();

// ─── API Routes ────────────────────────────────────────────────────

// Chat completion
router.post('/chat/completions', async (req, res) => {
  try {
    const { messages, temperature, max_tokens, stream } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid messages format' });
    }

    // Generate response
    const response = await global.trigulModel.chatCompletion(
      messages,
      temperature || 0.7,
      max_tokens || 2048
    );

    // Calculate token count (approximate)
    const totalTokens = messages.reduce((sum, msg) => 
      sum + (msg.content || '').split(/\s+/).length, 0
    ) + response.split(/\s+/).length;

    const result = {
      id: `trigul-${Date.now()}`,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: response
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: messages.reduce((sum, msg) => 
          sum + (msg.content || '').split(/\s+/).length, 0
        ),
        completion_tokens: response.split(/\s+/).length,
        total_tokens: totalTokens
      },
      created: Math.floor(Date.now() / 1000),
      model: 'trigul-7b'
    };

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Simulate streaming
      const words = response.split(' ');
      for (let i = 0; i < words.length; i++) {
        const chunk = {
          id: `trigul-${Date.now()}`,
          choices: [{
            index: 0,
            delta: {
              content: words[i] + (i < words.length - 1 ? ' ' : '')
            },
            finish_reason: i === words.length - 1 ? 'stop' : null
          }]
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.json(result);
    }

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({
      error: error.message || 'Failed to generate response'
    });
  }
});

// Add document
router.post('/documents', (req, res) => {
  try {
    const { content, metadata } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const doc = {
      id: `doc-${Date.now()}`,
      content,
      metadata: metadata || {},
      created_at: Date.now()
    };

    global.documents.push(doc);
    
    res.json({
      success: true,
      document: doc
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search documents
router.post('/search', (req, res) => {
  try {
    const { query, top_k = 5 } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    if (global.documents.length === 0) {
      return res.json({ results: [], query });
    }

    // Simple keyword search
    const queryWords = query.toLowerCase().split(/\s+/);
    const scoredDocs = [];

    for (const doc of global.documents) {
      const docWords = doc.content.toLowerCase().split(/\s+/);
      let score = 0;
      for (const word of queryWords) {
        if (docWords.includes(word)) {
          score++;
        }
      }
      if (score > 0) {
        scoredDocs.push({ score, ...doc });
      }
    }

    scoredDocs.sort((a, b) => b.score - a.score);
    const results = scoredDocs.slice(0, top_k);

    res.json({
      results: results.map(doc => ({
        id: doc.id,
        content: doc.content,
        metadata: doc.metadata,
        relevance_score: doc.score / queryWords.length
      })),
      query
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List models
router.get('/models', (req, res) => {
  res.json({
    object: 'list',
    data: [{
      id: 'trigul-7b',
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'Trigul',
      permission: []
    }]
  });
});

module.exports = router;
