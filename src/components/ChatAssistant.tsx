import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageSquare, X, Send, User, Loader2, Sparkles, BookOpen, Link } from 'lucide-react';
import { ThesisConfig, ResearchSource } from '../services/aiService';
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
    {
      role: 'agent',
      content: `Hello! I'm **ThesisAI Assistant**, your academic writing partner.\n\nI can help you:\n- 📝 Improve and refine your thesis writing\n- 🔍 Analyze the sources you've added\n- 📚 Suggest structure and content improvements\n- 🔗 Analyze URLs you paste here\n- ✍️ Enhance academic writing style\n\nWhat would you like to work on?`
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const detectUrlsInMessage = (text: string): string[] => {
    const urlRegex = /https?:\/\/[^\s]+/g;
    return text.match(urlRegex) || [];
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsLoading(true);

    try {
      // Detect URLs in message and fetch them first
      const urlsInMessage = detectUrlsInMessage(userMsg);
      let urlContextBlocks = '';

      if (urlsInMessage.length > 0) {
        setMessages(prev => [...prev, {
          role: 'agent',
          content: `🔗 Detected ${urlsInMessage.length} URL(s), reading content...`
        }]);

        for (const url of urlsInMessage.slice(0, 3)) {
          try {
            const fetchRes = await fetch('/api/fetch-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url }),
            });
            if (fetchRes.ok) {
              const data = await fetchRes.json();
              if (data.text) {
                urlContextBlocks += `\n\n[URL Content: ${url}]\nTitle: ${data.title || url}\n${data.text.substring(0, 5000)}`;
              }
            }
          } catch {
            // silently skip failed URL
          }
        }

        // Remove the "loading URL" message
        setMessages(prev => prev.filter(m => !m.content.includes('Detected')));
      }

      // Build context-rich payload
      const thesisContext = currentThesis?.generatedThesis?.length
        ? currentThesis.generatedThesis.map((ch: any) => `# ${ch.chapterTitle}\n${String(ch.content).substring(0, 2000)}`).join('\n\n')
        : null;

      const sourcesContext = sources?.length
        ? sources.map((s, i) => `[Source ${i+1}: ${s.title}]\n${String(s.content).substring(0, 1500)}`).join('\n---\n')
        : null;

      const fullMessage = urlContextBlocks
        ? `${userMsg}\n\n[Fetched URL Content for context:]${urlContextBlocks}`
        : userMsg;

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: fullMessage,
          currentThesis: thesisContext ? { generatedThesis: currentThesis.generatedThesis } : null,
          sources: sourcesContext ? sources : [],
          config,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server error ${response.status}`);
      }

      const data = await response.json();
      const responseText = data.text || 'No response generated.';
      setMessages(prev => [...prev, { role: 'agent', content: responseText }]);
    } catch (e: any) {
      let errorMsg = e.message || 'Failed to get response.';
      if (errorMsg.includes('GROQ_API_KEY')) {
        errorMsg = '⚠️ **API Key not configured.** Add `GROQ_API_KEY` to your `.env` file or server environment variables, then restart the server.';
      } else if (errorMsg.includes('500') || errorMsg.includes('Server error')) {
        errorMsg = '⚠️ **Server error.** The AI backend may not be running. Make sure your server is started with `npm run dev` and the `GROQ_API_KEY` is set in your `.env` file.';
      }
      setMessages(prev => [...prev, { role: 'agent', content: `**Error:** ${errorMsg}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const quickPrompts = [
    { label: 'Polish writing', prompt: 'Please polish and improve my thesis writing to sound more academic and professional.' },
    { label: 'Check grammar', prompt: 'Review the grammar and writing style of my thesis and provide specific improvement suggestions.' },
    { label: 'Summarize sources', prompt: 'Summarize all the research sources I have added.' },
  ];

  return (
    <>
      {/* Floating Button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-6 left-6 z-50 bg-[#111318] border border-[#b59a6d]/40 hover:border-[#b59a6d]/80 hover:bg-[#b59a6d]/10 text-[#b59a6d] px-3.5 py-2.5 rounded-2xl shadow-2xl shadow-black/40 ${isOpen ? 'hidden' : 'flex'} items-center gap-2 transition-colors`}
      >
        <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="text-[11px] font-black tracking-tight leading-none">Thesis<span className="text-[#f4c95d]">AI</span></span>
      </motion.button>

      {/* Chat Window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className="fixed bottom-6 left-4 sm:left-6 z-50 w-[calc(100vw-2rem)] sm:w-[420px] h-[580px] bg-[#121318] border border-[#1f2128] rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#0c0d10] border-b border-[#1f2128] shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-[#b59a6d]/20 border border-[#b59a6d]/30 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-[#b59a6d]" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#f0f1f3]">ThesisAI Assistant</h3>
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                    <p className="text-[10px] text-[#4a4b4e] uppercase tracking-wider font-mono">
                      {sources.length > 0 ? `${sources.length} sources active` : 'Groq AI · Ready'}
                    </p>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-[#4a4b4e] hover:text-[#f0f1f3] transition-colors p-1.5 rounded-lg hover:bg-[#1f2128]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick prompts */}
            {messages.length <= 1 && (
              <div className="px-3 pt-3 pb-1 flex gap-2 flex-wrap shrink-0">
                {quickPrompts.map((qp) => (
                  <button
                    key={qp.label}
                    onClick={() => setInput(qp.prompt)}
                    className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border border-[#b59a6d]/30 text-[#b59a6d] bg-[#b59a6d]/5 hover:bg-[#b59a6d]/15 transition-colors"
                  >
                    {qp.label}
                  </button>
                ))}
              </div>
            )}

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
              {messages.map((msg, i) => (
                <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${msg.role === 'user' ? 'bg-[#b59a6d] border-[#b59a6d]/50' : 'bg-[#16181d] border-[#b59a6d]/20'}`}>
                    {msg.role === 'user'
                      ? <User className="w-4 h-4 text-[#0c0d10]" />
                      : <BookOpen className="w-4 h-4 text-[#b59a6d]" />
                    }
                  </div>
                  <div
                    className={`max-w-[82%] rounded-2xl px-4 py-2.5 ${
                      msg.role === 'user'
                        ? 'bg-[#b59a6d] text-[#0c0d10] rounded-tr-sm'
                        : 'bg-[#1f2128] text-[#f0f1f3] rounded-tl-sm'
                    }`}
                  >
                    <div className={msg.role === 'user' ? 'text-sm font-medium' : 'text-sm prose prose-invert prose-p:my-1 prose-p:leading-relaxed prose-sm max-w-none prose-strong:text-[#b59a6d]'}>
                      {msg.role === 'user' ? msg.content : <Markdown>{msg.content}</Markdown>}
                    </div>
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex gap-3 flex-row">
                  <div className="w-8 h-8 rounded-full bg-[#16181d] flex items-center justify-center shrink-0 border border-[#b59a6d]/20">
                    <BookOpen className="w-4 h-4 text-[#b59a6d]" />
                  </div>
                  <div className="bg-[#1f2128] text-[#f0f1f3] rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#b59a6d]" />
                    <span className="text-xs text-[#9ca3af] animate-pulse">Thinking...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* URL hint */}
            {!isLoading && (
              <div className="px-4 py-1 shrink-0">
                <div className="flex items-center gap-1.5 text-[10px] text-[#2a2d35] font-mono">
                  <Link className="w-3 h-3" />
                  <span>Paste a URL here to analyze it</span>
                </div>
              </div>
            )}

            {/* Input Area */}
            <div className="p-3 bg-[#0c0d10] border-t border-[#1f2128] shrink-0">
              <div className="flex items-end bg-[#1a1c23] rounded-xl overflow-hidden border border-[#2a2d35] focus-within:border-[#b59a6d]/50 transition-colors">
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Ask anything, or paste a URL to analyze..."
                  rows={2}
                  className="flex-1 bg-transparent border-none focus:outline-none text-sm text-[#f0f1f3] px-4 py-3 placeholder:text-[#3a3d45] resize-none leading-relaxed"
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className="m-2 p-2.5 bg-[#b59a6d] hover:bg-[#a38a60] text-[#0c0d10] rounded-lg transition-colors disabled:opacity-40 disabled:grayscale self-end"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[9px] text-[#2a2d35] mt-2 text-center font-mono">Enter to send · Shift+Enter new line</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
