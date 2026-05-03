import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageSquare, X, Send, Bot, User, Loader2 } from 'lucide-react';
import { chatWithAgent, ThesisConfig, ResearchSource } from '../services/aiService';
import Markdown from 'react-markdown';

interface Message {
  role: 'user' | 'agent';
  content: string;
}

interface ChatAssistantProps {
  currentThesis: any;
  sources: ResearchSource[];
  config: ThesisConfig;
}

export default function ChatAssistant({ currentThesis, sources, config }: ChatAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'agent', content: 'Hi! I am your Research Assistant. Ask me anything about your draft or sources.' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsLoading(true);

    try {
      const responseText = await chatWithAgent(userMsg, currentThesis, sources, config);
      setMessages(prev => [...prev, { role: 'agent', content: responseText }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'agent', content: `**Error:** Failed to get a response. ${e.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Floating Button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-6 left-6 z-50 bg-[#b59a6d] hover:bg-[#a38a60] text-[#0c0d10] p-4 rounded-full shadow-2xl ${isOpen ? 'hidden' : 'flex'}`}
      >
        <MessageSquare className="w-6 h-6" />
      </motion.button>

      {/* Chat Window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className="fixed bottom-6 left-6 z-50 w-full max-w-sm sm:w-[400px] h-[550px] bg-[#121318] border border-[#1f2128] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#0c0d10] border-b border-[#1f2128]">
              <div className="flex items-center gap-2">
                <img src="/ThesisAI_Logo.png" alt="Logo" className="w-10 h-10 rounded-xl object-contain bg-[#16181d] p-1 border border-[#b59a6d]/30" />
                <div>
                  <h3 className="text-sm font-semibold text-[#f0f1f3]">Research Assistant</h3>
                  <p className="text-[10px] text-[#9ca3af]">AI Powered Q&A</p>
                </div>
              </div>
              <button 
                onClick={() => setIsOpen(false)}
                className="text-[#9ca3af] hover:text-[#f0f1f3] transition-colors p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg, i) => (
                <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 overflow-hidden border border-[#b59a6d]/20 ${msg.role === 'user' ? 'bg-[#b59a6d]' : 'bg-[#16181d]'}`}>
                    {msg.role === 'user' ? <User className="w-4 h-4 text-[#0c0d10]" /> : <img src="/ThesisAI_Logo.png" alt="AI" className="w-full h-full object-contain" />}
                  </div>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${msg.role === 'user' ? 'bg-[#b59a6d] text-[#0c0d10]' : 'bg-[#1f2128] text-[#f0f1f3]'}`}>
                    <div className={msg.role === 'user' ? 'text-sm' : 'text-sm prose prose-invert prose-p:my-1 prose-sm max-w-none'}>
                      {msg.role === 'user' ? msg.content : <Markdown>{msg.content}</Markdown>}
                    </div>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex gap-3 flex-row">
                  <div className="w-8 h-8 rounded-full bg-[#16181d] flex items-center justify-center shrink-0 overflow-hidden border border-[#b59a6d]/20">
                    <img src="/ThesisAI_Logo.png" alt="AI" className="w-full h-full object-contain" />
                  </div>
                  <div className="bg-[#1f2128] text-[#f0f1f3] rounded-2xl px-4 py-3 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-[#b59a6d]" />
                    <span className="text-xs text-[#9ca3af]">Thinking...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-3 bg-[#0c0d10] border-t border-[#1f2128]">
              <div className="flex items-center bg-[#1f2128] rounded-xl overflow-hidden pr-2">
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSend()}
                  placeholder="Ask about your thesis..."
                  className="flex-1 bg-transparent border-none focus:outline-none text-sm text-[#f0f1f3] px-4 py-3 placeholder:text-[#4a4b4e]"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className="p-2 bg-[#b59a6d] hover:bg-[#a38a60] text-[#0c0d10] rounded-lg transition-colors disabled:opacity-50 disabled:grayscale"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
