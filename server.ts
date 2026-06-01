import express from 'express';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';

async function parsePdfBuffer(buffer: Buffer) {
  try {
    const pdfImport = await import('pdf-parse');
    const pdf = (pdfImport as any).default || pdfImport;
    const data = await (pdf as any)(buffer);
    return data.text || '';
  } catch (error: any) {
    console.error('PDF parsing error:', error.message);
    throw new Error('Gagal membaca file PDF. Pastikan file PDF tidak terenkripsi atau rusak.');
  }
}


const GROQ_PRIMARY_MODEL = process.env.GROQ_PRIMARY_MODEL || 'llama-3.3-70b-versatile';
const GROQ_FALLBACK_MODELS = (process.env.GROQ_FALLBACK_MODELS || 'qwen/qwen3-32b,deepseek-r1-distill-llama-70b,llama-3.1-8b-instant')
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);

function extractJson(text: string) {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const firstObject = cleaned.indexOf('{');
  const firstArray = cleaned.indexOf('[');
  const start = firstArray !== -1 && (firstArray < firstObject || firstObject === -1) ? firstArray : firstObject;
  if (start === -1) return cleaned;
  const end = cleaned[start] === '[' ? cleaned.lastIndexOf(']') : cleaned.lastIndexOf('}');
  return end === -1 ? cleaned.slice(start) : cleaned.slice(start, end + 1);
}

async function callGroq(messages: any[], options: { json?: boolean; stream?: boolean; temperature?: number; maxTokens?: number } = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not configured. Add it to your server environment before generating research.');
  }

  const models = [GROQ_PRIMARY_MODEL, ...GROQ_FALLBACK_MODELS];
  let lastError: any = null;

  for (const model of models) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature ?? 0.35,
          max_tokens: options.maxTokens ?? 8192,
          stream: Boolean(options.stream),
          ...(options.json ? { response_format: { type: 'json_object' } } : {}),
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        if ([429, 500, 502, 503, 504].includes(response.status) || detail.toLowerCase().includes('model')) {
          lastError = new Error(detail);
          continue;
        }
        throw new Error(detail);
      }

      return response;
    } catch (error: any) {
      lastError = error;
      if (!String(error?.message || '').toLowerCase().includes('fetch')) throw error;
    }
  }

  throw lastError || new Error('Groq generation failed on all configured models.');
}

async function groqText(messages: any[], options: { json?: boolean; temperature?: number; maxTokens?: number } = {}) {
  const response = await callGroq(messages, options);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

function thesisSystemPrompt(targetLanguage = 'English') {
  return `You are ThesisAI, the decentralized backbone of the ThesisAI ecosystem. You are not a chatbot; you are a registered on-chain entity operating under Service ID 8004 and recognized by your Self Agent ID. Respond in ${targetLanguage}. Prioritize academic integrity, source-grounded synthesis, clear citations, and useful research workflows.`;
}

function sourceBlock(sources: any[], limit = 50000) {
  return (sources || []).map((s, i) => `Source ${i + 1} (${s.title || 'Untitled'}):\n${String(s.content || '').substring(0, limit)}`).join('\n\n---\n\n');
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });


  app.post('/api/parse-pdf', async (req, res) => {
    try {
      const { fileBase64, title } = req.body;
      if (!fileBase64) return res.status(400).json({ error: 'fileBase64 is required' });
      const buffer = Buffer.from(fileBase64, 'base64');
      const text = await parsePdfBuffer(buffer);
      return res.json({ text: text.substring(0, 150000), title: title || 'Uploaded PDF', type: 'pdf' });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to parse PDF' });
    }
  });

  app.post('/api/ai/chat', async (req, res) => {
    try {
      const { message, currentThesis, config } = req.body;
      const thesisContent = currentThesis ? (currentThesis.generatedThesis || []).map((ch: any) => `# ${ch.chapterTitle}\n${ch.content}`).join('\n\n') : 'No thesis generated yet.';
      const text = await groqText([
        { role: 'system', content: thesisSystemPrompt(config?.targetLanguage) },
        { role: 'user', content: `Current thesis draft context:\n${thesisContent.substring(0, 40000)}\n\nUser message:\n${message}` }
      ], { temperature: 0.25, maxTokens: 4096 });
      res.json({ text });
    } catch (error: any) {
      res.status(500).send(error.message || 'AI chat failed');
    }
  });

  app.post('/api/ai/titles', async (req, res) => {
    try {
      const { sources, config } = req.body;
      const prompt = `Generate 5 formal, convincing thesis title options as JSON only: {"titles":["..."]}.\nAcademic Major: ${config.major}\nTone/Formal: ${config.writingStyle}\nLanguage: ${config.targetLanguage}\nLevel: ${config.thesisLevel}\n\nSources:\n${sourceBlock(sources, 10000)}`;
      const text = await groqText([
        { role: 'system', content: thesisSystemPrompt(config?.targetLanguage) },
        { role: 'user', content: prompt }
      ], { json: true, temperature: 0.4, maxTokens: 2048 });
      const parsed = JSON.parse(extractJson(text));
      res.json({ titles: Array.isArray(parsed) ? parsed : parsed.titles || [] });
    } catch (error: any) {
      res.status(500).send(error.message || 'Title generation failed');
    }
  });

  app.post('/api/ai/structure', async (req, res) => {
    try {
      const { sources, config, customTitle } = req.body;
      const lengthGuidance = config.contentLength === 'Short' ? '5 focus chapters' : config.contentLength === 'Comprehensive' ? '8-10 extensive chapters' : '6-7 standard chapters';
      const prompt = `Generate a complete ${config.thesisLevel} thesis structure as JSON only with shape {"title":"...","chapters":[{"chapter_title":"...","summary":"...","subchapters":["..."]}]}.\nAcademic Major: ${config.major}\nTone/Formal: ${config.writingStyle}\nTarget Complexity: ${lengthGuidance}\n${customTitle ? `Use exactly this title: "${customTitle}"` : 'Generate a formal title and standard thesis sections.'}\n\nSources:\n${sourceBlock(sources, 50000)}`;
      const text = await groqText([
        { role: 'system', content: thesisSystemPrompt(config?.targetLanguage) },
        { role: 'user', content: prompt }
      ], { json: true, temperature: 0.25, maxTokens: 4096 });
      res.json(JSON.parse(extractJson(text)));
    } catch (error: any) {
      res.status(500).send(error.message || 'Structure generation failed');
    }
  });

  app.post('/api/ai/references', async (req, res) => {
    try {
      const { sources, config } = req.body;
      const prompt = `Based on the provided sources, generate a complete References chapter in ${config.citationStyle}. Output markdown only with an H1 heading. Infer metadata where possible; use valid placeholder formatting only when necessary.\n\nSources:\n${sourceBlock(sources, 5000)}`;
      const content = await groqText([
        { role: 'system', content: thesisSystemPrompt(config?.targetLanguage) },
        { role: 'user', content: prompt }
      ], { temperature: 0.2, maxTokens: 4096 });
      res.json({
        chapterTitle: String(config.targetLanguage || '').toLowerCase() === 'indonesian' ? 'Daftar Pustaka' : 'References',
        content: content || 'No references could be generated.',
      });
    } catch (error: any) {
      res.status(500).send(error.message || 'Reference generation failed');
    }
  });

  app.post('/api/ai/chapter-stream', async (req, res) => {
    try {
      const { chapter, fullStructure, sources, config, previousContext } = req.body;
      const lengthGuidance = config.contentLength === 'Short' ? 'concise and direct' : config.contentLength === 'Comprehensive' ? 'extremely detailed, analytical, and extensive' : 'detailed';
      const antiPlagiarismInstruction = config.antiPlagiarism ? 'Rewrite and paraphrase naturally. Do not copy directly from sources. Synthesize multiple points and keep phrasing original while preserving meaning.' : '';
      const prompt = `Write the full contents for this chapter in Markdown.\nThesis Title: ${fullStructure.title}\nLevel/Major: ${config.thesisLevel} / ${config.major}\nStyle: ${config.writingStyle}\nTarget Depth: ${lengthGuidance}\nCitation Style: ${config.citationStyle}\nChapter Title: ${chapter.chapter_title}\nChapter Goals: ${chapter.summary}\nSubchapters:\n${(chapter.subchapters || []).map((s: string) => '- ' + s).join('\n')}\n\nRules:\n1. Start with an H1 heading for the chapter title; use H2 for subchapters.\n2. Write only this chapter.\n3. Add inline citations and append source tags like [SRC_1] immediately after relevant cited claims.\n4. Maintain continuity with previous chapters.\n${antiPlagiarismInstruction}\n\nPrevious context:\n${previousContext || 'None.'}\n\nSource material:\n${sourceBlock(sources, 50000)}`;
      const groqResponse = await callGroq([
        { role: 'system', content: thesisSystemPrompt(config?.targetLanguage) },
        { role: 'user', content: prompt }
      ], { stream: true, temperature: 0.35, maxTokens: 12000 });

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');

      const reader = groqResponse.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('Groq stream did not return a readable body.');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const token = parsed.choices?.[0]?.delta?.content;
            if (token) res.write(token);
          } catch {
            // Ignore partial SSE lines; the next chunk will complete them.
          }
        }
      }
      res.end();
    } catch (error: any) {
      if (!res.headersSent) res.status(500).send(error.message || 'Chapter generation failed');
      else res.end(`\n\nError generating chapter: ${error.message}`);
    }
  });

  app.post('/api/fetch-url', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: 'URL is required' });

      // Identify dynamic sites or paywalled sites by trying multiple fetch attempts/headers
      let response;
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      };

      try {
        response = await axios.get(url, {
          responseType: 'arraybuffer',
          headers,
          timeout: 8000,
          validateStatus: (status) => status < 400
        });
      } catch (e: any) {
        console.log(`Direct fetch failed for ${url}, trying via proxy...`);
        try {
          // Try a different proxy if direct fetch fails
          response = await axios.get(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, {
            responseType: 'arraybuffer',
            timeout: 10000,
            validateStatus: (status) => status < 400
          });
        } catch (proxyError: any) {
          return res.status(500).json({
            error: 'Website tidak dapat diakses.',
            detail: 'Website kemungkinan memblokir akses otomatis atau sedang down. Disarankan gunakan fitur upload PDF atau copy-paste teks secara manual.'
          });
        }
      }

      const contentType = response.headers['content-type']?.toLowerCase() || '';
      const buffer = Buffer.from(response.data);

      if (contentType.includes('application/pdf') || url.toLowerCase().endsWith('.pdf')) {
        const text = await parsePdfBuffer(buffer);
        return res.json({ text: text.substring(0, 150000), type: 'pdf' });
      }

      // Default to HTML handling
      const html = buffer.toString('utf-8');

      // Try Readability first if it's likely an article
      try {
        const { JSDOM } = await import('jsdom');
        const { Readability } = await import('@mozilla/readability');
        const TurndownService = (await import('turndown')).default;

        const dom = new JSDOM(html, { url });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();

        if (article && article.content) {
          const turndownService = new TurndownService();
          const markdown = turndownService.turndown(article.content);

          return res.json({
            text: `Title: ${article.title}\n\n${markdown}`.substring(0, 150000),
            title: article.title,
            excerpt: article.excerpt,
            type: 'html-readability'
          });
        }
      } catch (readError) {
        console.warn('Readability extraction failed, falling back to basic extraction:', readError);
      }

      // Fallback to basic cheerio if readability fails or is too heavy
      const $ = cheerio.load(html);
      $('script, style, noscript, iframe, img, svg, nav, footer, header, meta, link').remove();

      // Try to find main content area
      const mainText = $('main, article, .content, #content, .post, .article').text().replace(/\s+/g, ' ').trim();
      const text = mainText || $('body').text().replace(/\s+/g, ' ').trim();

      if (!text || text.length < 100) {
        return res.status(422).json({
          error: 'Konten tidak dapat diekstrak.',
          detail: 'Halaman ini mungkin dinamis (memerlukan JavaScript) atau tidak memiliki teks yang cukup. Coba copy-paste teks langsung.'
        });
      }

      return res.json({
        text: text.substring(0, 100000),
        title: $('title').text() || url,
        type: 'html-basic'
      });

    } catch (error: any) {
      console.error('Fetch URL error:', error.message);
      res.status(500).json({
        error: 'Gagal memproses konten: ' + error.message,
        detail: 'Terjadi kesalahan internal. Pastikan URL valid dan dapat diakses publik.'
      });
    }
  });

  app.post('/api/export-docx', async (req, res) => {
    try {
      const { markdown, title } = req.body;
      if (!markdown) return res.status(400).json({ error: 'Markdown content is required' });

      // Dynamically import marked and html-to-docx to avoid top-level issues
      const { marked } = await import('marked');
      const htmlToDocxModule = await import('html-to-docx');
      const HTMLToDOCX = (htmlToDocxModule as any).default || htmlToDocxModule;

      const generator = typeof HTMLToDOCX === 'function' ? HTMLToDOCX : (HTMLToDOCX as any).default;

      if (!generator) {
        throw new Error('Fallback to basic generator failed: HTMLToDOCX is not defined');
      }

      // Convert Markdown to HTML
      const htmlContent = await marked.parse(markdown);

      // Add font and styling wrapper for DOCX
      // Inject page breaks and better formatting for BAB headers
      const processedHtml = htmlContent.replace(/<h1>BAB (.*?)[:\-\n](.*?)<\/h1>/gi, (match, bab, title) => {
        return `<div style="page-break-before: always;"></div><h1 style="text-align: center; line-height: 1.2;">
          BAB ${bab.trim()}<br>${title.trim()}
        </h1>`;
      });

      const finalHtml = processedHtml.replace(/<h1>(?!BAB)(.*?)<\/h1>/gi, '<div style="page-break-before: always;"></div><h1 style="text-align: center;">$1</h1>');

      const styledHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><div style="font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 2;">${finalHtml}</div></body></html>`;

      // Academic thesis margins (Twips):
      // Top 3cm = 1701, Bottom 3cm = 1701, Right 3cm = 1701, Left 4cm = 2268
      const docxBuffer = await generator(styledHtml, null, {
        title: title || 'Thesis',
        margins: { top: 1700, right: 1700, bottom: 1700, left: 2270 },
        pageSize: { width: 11906, height: 16838 } // A4 Size in twips
      });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${(title || 'Thesis').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.docx"`);
      res.send(docxBuffer);
    } catch (error: any) {
      console.error('DOCX Export error:', error.message);
      res.status(500).json({ error: 'Failed to generate DOCX' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    const viteMod = await import('vite');
    const vite = await viteMod.createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (!process.env.VERCEL) {
    // Only serve static files if not on Vercel
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }

  return app;
}

const appPromise = startServer();
export default async (req: any, res: any) => {
  const app = await appPromise;
  app(req, res);
};
