import os
import json
import time
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
import uvicorn
from dotenv import load_dotenv
import logging

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(title="Trigul AI Assistant", version="1.0.0")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Models ──────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = 2048
    stream: Optional[bool] = False

class ChatResponse(BaseModel):
    id: str
    choices: List[Dict[str, Any]]
    usage: Dict[str, int]
    created: int
    model: str

class DocumentRequest(BaseModel):
    content: str
    metadata: Optional[Dict[str, Any]] = {}

class SearchRequest(BaseModel):
    query: str
    top_k: Optional[int] = 5

# ─── Trigul AI Engine ──────────────────────────────────────────────────

class TrigulAI:
    def __init__(self):
        self.model = None
        self.tokenizer = None
        self.model_name = os.getenv("MODEL_NAME", "deepseek-ai/deepseek-llm-7b-chat")
        self.device = os.getenv("DEVICE", "cpu")
        self.max_tokens = int(os.getenv("MAX_TOKENS", 2048))
        self.temperature = float(os.getenv("TEMPERATURE", 0.7))
        self.is_loaded = False
        self.conversation_history = []
        self.documents = []
        self.embedding_model = None
        
        # Fallback responses for when model isn't loaded
        self.fallback_responses = [
            "I understand your question. As Trigul, I'm designed to provide thoughtful and accurate responses.",
            "That's an interesting point. Let me think about that from multiple perspectives.",
            "I appreciate your question. Here's what I can share based on my training.",
            "Great question! I'd like to help you explore this topic in depth.",
            "Let me analyze that for you. This is a complex but fascinating subject."
        ]
        
        # Try to load the model
        self.load_model()
    
    def load_model(self):
        """Load the AI model (DeepSeek or fallback)"""
        try:
            logger.info(f"Loading model: {self.model_name}")
            
            # Try to load with 4-bit quantization for memory efficiency
            try:
                from transformers import BitsAndBytesConfig
                quantization_config = BitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_compute_dtype=torch.float16,
                    bnb_4bit_quant_type="nf4"
                )
                self.tokenizer = AutoTokenizer.from_pretrained(
                    self.model_name,
                    trust_remote_code=True,
                    use_fast=False
                )
                self.model = AutoModelForCausalLM.from_pretrained(
                    self.model_name,
                    quantization_config=quantization_config,
                    device_map="auto" if torch.cuda.is_available() else None,
                    trust_remote_code=True,
                    torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32
                )
            except Exception as e:
                logger.warning(f"Failed to load with quantization: {e}")
                # Try without quantization
                self.tokenizer = AutoTokenizer.from_pretrained(
                    self.model_name,
                    trust_remote_code=True,
                    use_fast=False
                )
                self.model = AutoModelForCausalLM.from_pretrained(
                    self.model_name,
                    trust_remote_code=True,
                    torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32
                )
            
            self.is_loaded = True
            logger.info("✅ Model loaded successfully!")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to load model: {e}")
            logger.info("Using fallback mode (simulated responses)")
            self.is_loaded = False
            return False
    
    def generate_response(self, messages: List[Dict[str, str]], temperature: float = 0.7, max_tokens: int = 2048) -> str:
        """Generate a response from the model or fallback"""
        
        if not self.is_loaded or self.model is None:
            return self._generate_fallback_response(messages)
        
        try:
            # Format messages for the model
            formatted_messages = self._format_messages(messages)
            
            # Tokenize
            inputs = self.tokenizer.encode(
                formatted_messages,
                return_tensors="pt",
                truncation=True,
                max_length=4096
            )
            
            # Move to device
            if torch.cuda.is_available():
                inputs = inputs.to("cuda")
            
            # Generate
            with torch.no_grad():
                outputs = self.model.generate(
                    inputs,
                    max_new_tokens=max_tokens,
                    temperature=temperature,
                    do_sample=True,
                    pad_token_id=self.tokenizer.eos_token_id,
                    top_p=0.9,
                    repetition_penalty=1.1,
                )
            
            # Decode
            response = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
            
            # Extract only the assistant's response
            # Remove the input prompt from the output
            prompt_length = len(formatted_messages)
            response = response[prompt_length:].strip()
            
            return response
            
        except Exception as e:
            logger.error(f"Error generating response: {e}")
            return self._generate_fallback_response(messages)
    
    def _format_messages(self, messages: List[Dict[str, str]]) -> str:
        """Format messages for the model"""
        formatted = ""
        
        # Add system prompt
        formatted += "<|system|>\nYou are Trigul, an advanced AI assistant created to help users with their questions. You are thoughtful, accurate, and helpful. You provide detailed, well-reasoned responses.\n"
        
        # Add conversation history
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "user":
                formatted += f"<|user|>\n{content}\n"
            elif role == "assistant":
                formatted += f"<|assistant|>\n{content}\n"
            elif role == "system":
                formatted += f"<|system|>\n{content}\n"
        
        formatted += "<|assistant|>\n"
        return formatted
    
    def _generate_fallback_response(self, messages: List[Dict[str, str]]) -> str:
        """Generate a fallback response when the model isn't available"""
        import random
        
        # Get the last user message
        last_user_msg = ""
        for msg in reversed(messages):
            if msg.get("role") == "user":
                last_user_msg = msg.get("content", "")
                break
        
        # Generate a contextual response
        responses = [
            f"Thank you for your message: '{last_user_msg[:50]}...' Let me think about this carefully.",
            f"I'm analyzing your question: '{last_user_msg[:50]}...' Here's what I can tell you.",
            f"Great question! Let me break this down for you based on my training.",
            f"I appreciate you asking about this. Let me provide a thoughtful response.",
            f"This is a fascinating topic. Let me share my insights with you."
        ]
        
        base_response = random.choice(responses)
        
        # Add some substance based on keywords
        if "code" in last_user_msg.lower() or "programming" in last_user_msg.lower():
            base_response += "\n\nWhen working with code, it's important to follow best practices and consider edge cases. Would you like me to elaborate on any specific aspect?"
        elif "learn" in last_user_msg.lower():
            base_response += "\n\nContinuous learning is key to growth. I'd recommend breaking down complex topics into manageable chunks."
        elif "ai" in last_user_msg.lower():
            base_response += "\n\nAs an AI assistant, I'm here to help with your questions and provide thoughtful analysis on various topics."
        else:
            base_response += "\n\nI'm here to provide thoughtful, accurate responses. Feel free to ask follow-up questions."
        
        return base_response
    
    def chat_completion(self, messages: List[Dict[str, str]], temperature: float = 0.7, max_tokens: int = 2048, stream: bool = False):
        """Complete a chat conversation"""
        start_time = time.time()
        
        # Generate response
        if stream:
            # Simulate streaming
            full_response = self.generate_response(messages, temperature, max_tokens)
            for chunk in self._stream_response(full_response):
                yield chunk
        else:
            response = self.generate_response(messages, temperature, max_tokens)
            
            # Calculate tokens (approximate)
            token_count = len(response.split()) + sum(len(msg.get("content", "").split()) for msg in messages)
            
            return {
                "id": f"trigul-{int(time.time())}",
                "choices": [{
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": response
                    },
                    "finish_reason": "stop"
                }],
                "usage": {
                    "prompt_tokens": len(" ".join(msg.get("content", "") for msg in messages).split()),
                    "completion_tokens": len(response.split()),
                    "total_tokens": token_count
                },
                "created": int(time.time()),
                "model": "trigul-7b"
            }
    
    def _stream_response(self, response: str):
        """Stream a response word by word"""
        words = response.split()
        for word in words:
            yield {
                "id": f"trigul-{int(time.time())}",
                "choices": [{
                    "index": 0,
                    "delta": {
                        "content": word + " "
                    },
                    "finish_reason": None
                }]
            }
        # Final chunk
        yield {
            "id": f"trigul-{int(time.time())}",
            "choices": [{
                "index": 0,
                "delta": {},
                "finish_reason": "stop"
            }]
        }
    
    def add_document(self, content: str, metadata: Dict[str, Any] = None):
        """Add a document to the knowledge base (RAG)"""
        doc = {
            "id": f"doc-{len(self.documents)}",
            "content": content,
            "metadata": metadata or {},
            "created_at": time.time()
        }
        self.documents.append(doc)
        return doc
    
    def search_documents(self, query: str, top_k: int = 5):
        """Search documents by relevance (simple keyword search)"""
        if not self.documents:
            return []
        
        # Simple keyword matching
        query_words = set(query.lower().split())
        scored_docs = []
        
        for doc in self.documents:
            doc_words = set(doc["content"].lower().split())
            score = len(query_words.intersection(doc_words))
            if score > 0:
                scored_docs.append((score, doc))
        
        # Sort by score
        scored_docs.sort(key=lambda x: x[0], reverse=True)
        
        return [doc for _, doc in scored_docs[:top_k]]

# Initialize the AI engine
trigul = TrigulAI()

# ─── API Endpoints ─────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "name": "Trigul AI Assistant",
        "version": "1.0.0",
        "status": "online",
        "model_loaded": trigul.is_loaded
    }

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "model_loaded": trigul.is_loaded,
        "documents": len(trigul.documents)
    }

@app.post("/v1/chat/completions")
async def chat_completion(request: ChatRequest):
    """Chat completion endpoint (OpenAI-compatible)"""
    try:
        messages = [msg.dict() for msg in request.messages]
        
        response = trigul.chat_completion(
            messages=messages,
            temperature=request.temperature or 0.7,
            max_tokens=request.max_tokens or 2048,
            stream=request.stream
        )
        
        if request.stream:
            return StreamingResponse(response, media_type="text/event-stream")
        
        return response
        
    except Exception as e:
        logger.error(f"Error in chat completion: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/chat/stream")
async def chat_stream(request: ChatRequest):
    """Streaming chat endpoint"""
    try:
        messages = [msg.dict() for msg in request.messages]
        
        def generate():
            response = trigul.chat_completion(
                messages=messages,
                temperature=request.temperature or 0.7,
                max_tokens=request.max_tokens or 2048,
                stream=True
            )
            for chunk in response:
                yield f"data: {json.dumps(chunk)}\n\n"
            yield "data: [DONE]\n\n"
        
        from fastapi.responses import StreamingResponse
        return StreamingResponse(generate(), media_type="text/event-stream")
        
    except Exception as e:
        logger.error(f"Error in stream: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/documents")
async def add_document(request: DocumentRequest):
    """Add a document to the knowledge base"""
    try:
        doc = trigul.add_document(request.content, request.metadata)
        return {"success": True, "document": doc}
    except Exception as e:
        logger.error(f"Error adding document: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/search")
async def search_documents(request: SearchRequest):
    """Search the document knowledge base"""
    try:
        results = trigul.search_documents(request.query, request.top_k)
        return {"results": results, "query": request.query}
    except Exception as e:
        logger.error(f"Error searching: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/v1/models")
async def list_models():
    """List available models"""
    return {
        "object": "list",
        "data": [
            {
                "id": "trigul-7b",
                "object": "model",
                "created": int(time.time()),
                "owned_by": "Trigul",
                "permission": []
            }
        ]
    }

# ─── Main ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
