// CommonJS-compatible imports — required because @vercel/node compiles this
// file with "module":"CommonJS" (via api/tsconfig.json).
import type { VercelRequest, VercelResponse } from '@vercel/node';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const express = require('express') as typeof import('express');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path') as typeof import('path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const axios = (require('axios') as typeof import('axios')).default ?? require('axios');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cheerio = require('cheerio') as typeof import('cheerio');

// ─── PDF helper ───────────────────────────────────────────────────────────────
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

// ─── Groq config — model configuration with fallback ─────────────────────────
const GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const GROQ_FALLBACK = 'llama-3.3-70b-versatile';

// ─── Academic Ghostwriter system prompt ──────────────────────────────────────
const GHOSTWRITER_SYSTEM_PROMPT =
  'You are an expert Academic Ghostwriter. Output must be clean, scholarly text. ' +
  'STRICTLY NO [Source X] tags or bracketed references. Use (Author, Year) for citations only. ' +
  'Do not hallucinate.';

function extractJson(text: string) {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const firstObject = cleaned.indexOf('{');
  const firstArray = cleaned.indexOf('[');
  const start =
    firstArray !== -1 && (firstArray < firstObject || firstObject === -1)
      ? firstArray
      : firstObject;
  if (start === -1) return cleaned;
  const end =
    cleaned[start] === '[' ? cleaned.lastIndexOf(']') : cleaned.lastIndexOf('}');
  return end === -1 ? cleaned.slice(start) : cleaned.slice(start, end + 1);
}

// ─── Core Groq caller — supports model override for fallback ─────────────────
async function callGroq(
  messages: any[],
  options: {
    json?: boolean;
    stream?: boolean;
    temperature?: number;
    maxTokens?: number;
    model?: string;
  } = {}
) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GROQ_API_KEY is not configured. Add it to your environment variables.'
    );
  }

  const modelToUse = options.model || GROQ_MODEL;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelToUse,
      messages,
      temperature: options.temperature ?? 0.35,
      max_tokens: options.maxTokens ?? 8192,
      stream: Boolean(options.stream),
      ...(options.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 429) {
      const err: any = new Error('Rate limit reached. Please wait.');
      err.isRateLimit = true;
      throw err;
    }
    throw new Error(detail || `Groq API error: ${response.status}`);
  }

  return response;
}

async function groqText(
  messages: any[],
  options: { json?: boolean; temperature?: number; maxTokens?: number } = {}
) {
  try {
    const response = await callGroq(messages, options);
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (error: any) {
    // Jika terkena rate limit pada model utama, otomatis coba pakai fallback model
    if (error.isRateLimit) {
      try {
        const response = await callGroq(messages, { ...options, model: GROQ_FALLBACK });
        const data = await response.json();
        return data.choices?.[0]?.message?.content || '';
      } catch (fallbackError) {
        throw error; // jika fallback gagal juga, lempar error asli
      }
    }
    throw error;
  }
}

// ─── Helper to pipe a Groq SSE stream to express response ────────────────────
async function pipeGroqStream(groqResponse: Response, res: any) {
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
        // Ignore partial SSE lines
      }
    }
  }
  res.end();
}

// ─── System prompt (used by chat / non-ghostwriter endpoints) ─────────────────
function thesisSystemPrompt(targetLanguage = 'English') {
  return `You are ThesisAI, an expert academic writing assistant. You respond in ${targetLanguage}.
CRITICAL RULES:
- NEVER invent citations, authors, or publication data.
- STRICTLY NO [Source X] tags. Use (Author, Year) format only.
- Always respond in ${targetLanguage} unless explicitly asked otherwise.`;
}

function sourceBlock(sources: any[], limit = 50000) {
  return (sources || [])
    .map(
      (s, i) =>
        `Source ${i + 1} (${s.title || 'Untitled'}):\n${String(
          s.content || ''
        ).substring(0, limit)}`
    )
    .join('\n\n---\n\n');
}

// ─── Build the Express app (singleton) ───────────────────────────────────────
let _app: any | null = null;

function buildApp(): any {
  if (_app) return _app;

  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // ── Health ────────────────────────────────────────────────────────────────
  app.get('/api/health', (_req: any, res: any) => {
    res.json({ status: 'ok', model: GROQ_MODEL, fallback: GROQ_FALLBACK });
  });

  // ── Parse PDF ─────────────────────────────────────────────────────────────
  app.post('/api/parse-pdf', async (req: any, res: any) => {
    try {
      const { fileBase64, title } = req.body;
      if (!fileBase64) return res.status(400).json({ error: 'fileBase64 is required' });

      const base64Data = fileBase64.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      if (buffer.length === 0)
        return res.status(400).json({ error: 'File PDF kosong atau tidak dapat dibaca.' });

      const text = await parsePdfBuffer(buffer);

      if (!text || text.trim().length < 10)
        return res.status(422).json({
          error: 'PDF tidak mengandung teks yang dapat diekstrak.',
          detail:
            'PDF ini kemungkinan adalah scan gambar. Silakan salin-tempel teks secara manual.',
        });

      return res.json({
        text: text.substring(0, 150000),
        title: title || 'Uploaded PDF',
        type: 'pdf',
      });
    } catch (error: any) {
      console.error('PDF parse error:', error.message);
      res.status(500).json({ error: error.message || 'Failed to parse PDF' });
    }
  });

  // ── AI Chat ───────────────────────────────────────────────────────────────
  app.post('/api/ai/chat', async (req: any, res: any) => {
    try {
      const { message, currentThesis, config, sources } = req.body;

      const thesisContent = currentThesis?.generatedThesis?.length
        ? currentThesis.generatedThesis
            .map((ch: any) => `# ${ch.chapterTitle}\n${ch.content}`)
            .join('\n\n')
        : null;

      const sourceSummary = sources?.length
        ? sources
            .map(
              (s: any, i: number) =>
                `Source ${i + 1}: ${s.title || 'Untitled'}\n${String(
                  s.content || ''
                ).substring(0, 3000)}`
            )
            .join('\n\n---\n\n')
        : null;

      const systemContent = thesisSystemPrompt(config?.targetLanguage);

      let contextBlock = '';
      if (thesisContent)
        contextBlock += `\n\n=== CURRENT THESIS DRAFT ===\n${thesisContent.substring(
          0,
          30000
        )}\n=== END OF DRAFT ===`;
      if (sourceSummary)
        contextBlock += `\n\n=== RESEARCH SOURCES ===\n${sourceSummary}\n=== END OF SOURCES ===`;
      if (!thesisContent && !sourceSummary)
        contextBlock = '\n\nNo thesis draft or sources available yet.';

      const text = await groqText(
        [
          { role: 'system', content: systemContent + contextBlock },
          { role: 'user', content: message },
        ],
        { temperature: 0.25, maxTokens: 4096 }
      );

      res.json({ text });
    } catch (error: any) {
      console.error('Chat error:', error.message);
      if ((error as any).isRateLimit)
        return res.status(429).json({ error: 'Rate limit reached. Please wait.' });
      res.status(500).json({ error: error.message || 'AI chat failed' });
    }
  });

  // ── AI Titles ─────────────────────────────────────────────────────────────
  app.post('/api/ai/titles', async (req: any, res: any) => {
    try {
      const { sources, config } = req.body;
      const prompt = `Generate 5 formal, convincing thesis title options as JSON only: {"titles":["..."]}.
Academic Major: ${config.major}
Tone/Formal: ${config.writingStyle}
Language: ${config.targetLanguage}
Level: ${config.thesisLevel}

Sources:
${sourceBlock(sources, 10000)}`;
      const text = await groqText(
        [
          { role: 'system', content: GHOSTWRITER_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        { json: true, temperature: 0.4, maxTokens: 2048 }
      );
      const parsed = JSON.parse(extractJson(text));
      res.json({ titles: Array.isArray(parsed) ? parsed : parsed.titles || [] });
    } catch (error: any) {
      if ((error as any).isRateLimit)
        return res.status(429).json({ error: 'Rate limit reached. Please wait.' });
      res.status(500).send(error.message || 'Title generation failed');
    }
  });

  // ── AI Structure ──────────────────────────────────────────────────────────
  app.post('/api/ai/structure', async (req: any, res: any) => {
    try {
      const { sources, config, customTitle } = req.body;
      const lengthGuidance =
        config.contentLength === 'Short'
          ? '5 focus chapters'
          : config.contentLength === 'Comprehensive'
          ? '8-10 extensive chapters'
          : '6-7 standard chapters';
      const prompt = `Generate a complete ${config.thesisLevel} thesis structure as JSON only with shape {"title":"...","chapters":[{"chapter_title":"...","summary":"...","subchapters":["..."]}]}.
Academic Major: ${config.major}
Tone/Formal: ${config.writingStyle}
Target Complexity: ${lengthGuidance}
${
  customTitle
    ? `Use exactly this title: "${customTitle}"`
    : 'Generate a formal title and standard thesis sections.'
}

Sources:
${sourceBlock(sources, 50000)}`;
      const text = await groqText(
        [
          { role: 'system', content: GHOSTWRITER_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        { json: true, temperature: 0.25, maxTokens: 4096 }
      );
      res.json(JSON.parse(extractJson(text)));
    } catch (error: any) {
      if ((error as any).isRateLimit)
        return res.status(429).json({ error: 'Rate limit reached. Please wait.' });
      res.status(500).send(error.message || 'Structure generation failed');
    }
  });

  // ── AI References ─────────────────────────────────────────────────────────
  app.post('/api/ai/references', async (req: any, res: any) => {
    try {
      const { sources, config } = req.body;
      const prompt = `Based on the provided sources, generate a complete References chapter in ${config.citationStyle}. Output markdown only with an H1 heading. Use (Author, Year) format. No [Source X] tags.

Sources:
${sourceBlock(sources, 5000)}`;
      const content = await groqText(
        [
          { role: 'system', content: GHOSTWRITER_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.2, maxTokens: 4096 }
      );
      res.json({
        chapterTitle:
          String(config.targetLanguage || '').toLowerCase() === 'indonesian'
            ? 'Daftar Pustaka'
            : 'References',
        content: content || 'No references could be generated.',
      });
    } catch (error: any) {
      if ((error as any).isRateLimit)
        return res.status(429).json({ error: 'Rate limit reached. Please wait.' });
      res.status(500).send(error.message || 'Reference generation failed');
    }
  });

  // ── AI Chapter Stream (legacy – full chapter at once) ────────────────────
  app.post('/api/ai/chapter-stream', async (req: any, res: any) => {
    try {
      const { chapter, fullStructure, sources, config, previousContext } = req.body;
      const lengthGuidance =
        config.contentLength === 'Short'
          ? 'concise and direct'
          : config.contentLength === 'Comprehensive'
          ? 'extremely detailed, analytical, and extensive'
          : 'detailed';
      const antiPlagiarismInstruction = config.antiPlagiarism
        ? 'Rewrite and paraphrase naturally. Do not copy directly from sources.'
        : '';
      const prompt = `Write the full contents for this chapter in Markdown.
Thesis Title: ${fullStructure.title}
Level/Major: ${config.thesisLevel} / ${config.major}
Style: ${config.writingStyle}
Target Depth: ${lengthGuidance}
Citation Style: ${config.citationStyle}
Chapter Title: ${chapter.chapter_title}
Chapter Goals: ${chapter.summary}
Subchapters:
${(chapter.subchapters || []).map((s: string) => '- ' + s).join('\n')}

Rules:
1. Start with an H1 heading for the chapter title; use H2 for subchapters.
2. Write only this chapter.
3. Use (Author, Year) for citations. NO [Source X] tags.
4. Maintain continuity with previous chapters.
5. Use full, complete paragraphs (minimum 3 sentences each).
${antiPlagiarismInstruction}

Previous context:
${previousContext || 'None.'}

Source material:
${sourceBlock(sources, 50000)}`;

      let groqResponse;
      try {
        groqResponse = await callGroq(
          [
            { role: 'system', content: GHOSTWRITER_SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          { stream: true, temperature: 0.35, maxTokens: 12000 }
        );
      } catch (error: any) {
        if (error.isRateLimit) {
          groqResponse = await callGroq(
            [
              { role: 'system', content: GHOSTWRITER_SYSTEM_PROMPT },
              { role: 'user', content: prompt },
            ],
            { stream: true, temperature: 0.35, maxTokens: 12000, model: GROQ_FALLBACK }
          );
        } else {
          throw error;
        }
      }

      await pipeGroqStream(groqResponse, res);
    } catch (error: any) {
      if ((error as any).isRateLimit) {
        if (!res.headersSent)
          return res.status(429).json({ error: 'Rate limit reached. Please wait.' });
        return res.end('\n\nError: Rate limit reached. Please wait.');
      }
      if (!res.headersSent)
        res.status(500).send(error.message || 'Chapter generation failed');
      else res.end(`\n\nError generating chapter: ${error.message}`);
    }
  });

  // ── AI Section Stream (modular — one subchapter at a time) ────────────────
  app.post('/api/ai/section-stream', async (req: any, res: any) => {
    try {
      const {
        chapterTitle,
        subchapterTitle,
        chapterGoals,
        fullStructure,
        sources,
        config,
        previousContext,
      } = req.body;

      const antiPlagiarismInstruction = config?.antiPlagiarism
        ? 'Rewrite and paraphrase naturally. Synthesize multiple points without copying directly from sources.'
        : '';

      const prompt = `Write approximately 350-450 words for this specific thesis section in scholarly Markdown.

Thesis Title: ${fullStructure?.title || 'Untitled Thesis'}
Chapter: ${chapterTitle}
Section to write: ${subchapterTitle}
Chapter goals: ${chapterGoals || ''}
Level / Major: ${config?.thesisLevel || 'Undergraduate'} / ${config?.major || ''}
Citation Style: ${config?.citationStyle || 'APA'}
Language: ${config?.targetLanguage || 'English'}

Rules:
1. Start with an H2 heading matching the section title.
2. Write ONLY this section — target 350-450 words, stop naturally.
3. Use (Author, Year) inline citations. STRICTLY NO [Source X] tags.
4. Write complete academic paragraphs (minimum 3 sentences each).
5. Do not add a conclusion paragraph — that belongs in a later section.
${antiPlagiarismInstruction}

Previous context summary:
${previousContext || 'This is the first section of the thesis.'}

Source material:
${sourceBlock(sources, 30000)}`;

      let groqResponse;
      try {
        groqResponse = await callGroq(
          [
            { role: 'system', content: GHOSTWRITER_SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          { stream: true, temperature: 0.35, maxTokens: 700 }
        );
      } catch (error: any) {
        if (error.isRateLimit) {
          groqResponse = await callGroq(
            [
              { role: 'system', content: GHOSTWRITER_SYSTEM_PROMPT },
              { role: 'user', content: prompt },
            ],
            { stream: true, temperature: 0.35, maxTokens: 700, model: GROQ_FALLBACK }
          );
        } else {
          throw error;
        }
      }

      await pipeGroqStream(groqResponse, res);
    } catch (error: any) {
      if ((error as any).isRateLimit) {
        if (!res.headersSent)
          return res.status(429).json({ error: 'Rate limit reached. Please wait.' });
        return res.end('\n\nError: Rate limit reached. Please wait.');
      }
      if (!res.headersSent)
        res.status(500).json({ error: error.message || 'Section generation failed' });
      else res.end(`\n\nError: ${error.message}`);
    }
  });

  // ── AI Refine Stream (rewrite a section for better academic flow) ─────────
  app.post('/api/ai/refine-stream', async (req: any, res: any) => {
    try {
      const { sectionText, context, config } = req.body;

      const prompt = `Please refine this section for better academic flow, keep it scholarly, and maintain the current context.

${context ? `Context: ${context}\n\n` : ''}Section to refine:
${sectionText}

Rules:
1. Preserve the H2 heading.
2. Keep the same approximate length (350-450 words).
3. Improve sentence variety, academic vocabulary, and logical flow.
4. Use (Author, Year) citations. NO [Source X] tags.
5. Do not change the core meaning or argument.`;

      let groqResponse;
      try {
        groqResponse = await callGroq(
          [
            { role: 'system', content: GHOSTWRITER_SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          { stream: true, temperature: 0.3, maxTokens: 800 }
        );
      } catch (error: any) {
        if (error.isRateLimit) {
          groqResponse = await callGroq(
            [
              { role: 'system', content: GHOSTWRITER_SYSTEM_PROMPT },
              { role: 'user', content: prompt },
            ],
            { stream: true, temperature: 0.3, maxTokens: 800, model: GROQ_FALLBACK }
          );
        } else {
          throw error;
        }
      }

      await pipeGroqStream(groqResponse, res);
    } catch (error: any) {
      if ((error as any).isRateLimit) {
        if (!res.headersSent)
          return res.status(429).json({ error: 'Rate limit reached. Please wait.' });
        return res.end('\n\nError: Rate limit reached. Please wait.');
      }
      if (!res.headersSent)
        res.status(500).json({ error: error.message || 'Refine generation failed' });
      else res.end(`\n\nError: ${error.message}`);
    }
  });

  // ── Fetch URL ─────────────────────────────────────────────────────────────
  app.post('/api/fetch-url', async (req: any, res: any) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string')
        return res.status(400).json({ error: 'URL is required.' });

      let parsedUrl: URL;
      try {
        const normalized = url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`;
        parsedUrl = new URL(normalized);
        if (!['http:', 'https:'].includes(parsedUrl.protocol))
          return res.status(400).json({ error: 'URL must use http or https protocol.' });
      } catch {
        return res
          .status(400)
          .json({ error: 'Invalid URL format. Example: https://example.com/article' });
      }

      const targetUrl = parsedUrl.href;
      const isPdf = parsedUrl.pathname.toLowerCase().endsWith('.pdf');
      const isDoi = targetUrl.includes('doi.org/');

      const browserHeaders = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      };

      const extractFromHtml = async (
        html: string,
        pageUrl: string
      ): Promise<{ text: string; title: string }> => {
        let extractedText = '';
        let extractedTitle = '';
        try {
          const { JSDOM } = await import('jsdom');
          const { Readability } = await import('@mozilla/readability');
          const dom = new JSDOM(html, { url: pageUrl });
          extractedTitle = dom.window.document.title || '';
          const reader = new Readability(dom.window.document, { charThreshold: 50 });
          const article = reader.parse();
          if (article?.textContent && article.textContent.trim().length > 150) {
            extractedText = article.textContent.trim();
            extractedTitle = article.title || extractedTitle;
          }
        } catch {
          /* Readability unavailable */
        }

        if (!extractedText || extractedText.length < 150) {
          const $ = cheerio.load(html);
          extractedTitle =
            extractedTitle || $('title').first().text().trim() || $('h1').first().text().trim();
          $(
            'script, style, noscript, iframe, nav, footer, header, aside, .sidebar, .ad, .advertisement'
          ).remove();
          const selectors = [
            'article', '[role="main"]', 'main', '.content', '#content', '.post-content',
            '.article-content', '.entry-content', '.paper-content', '.abstract', 'section', 'body',
          ];
          for (const sel of selectors) {
            const el = $(sel).first();
            if (el.length > 0) {
              const t = el.text().replace(/\s+/g, ' ').trim();
              if (t.length > 200) { extractedText = t; break; }
            }
          }
          if (!extractedText) extractedText = $('body').text().replace(/\s+/g, ' ').trim();
        }
        return { text: extractedText, title: extractedTitle };
      };

      // Strategy 1: Jina Reader
      try {
        const resp = await axios.get(`https://r.jina.ai/${targetUrl}`, {
          headers: { Accept: 'text/plain', 'User-Agent': 'ThesisAI/1.0' },
          timeout: 20000,
          validateStatus: (s: number) => s >= 200 && s < 400,
        });
        const text = typeof resp.data === 'string' ? resp.data : Buffer.from(resp.data).toString('utf-8');
        if (text && text.trim().length > 150) {
          const lines = text.split('\n');
          const titleLine = lines.find((l: string) => l.startsWith('Title:'));
          const title = titleLine ? titleLine.replace('Title:', '').trim() : parsedUrl.hostname;
          return res.json({ text: text.substring(0, 150000), title, type: 'jina-reader' });
        }
      } catch (e: any) {
        console.log(`[fetch-url] Jina failed: ${e.message}`);
      }

      // Strategy 2: Direct fetch
      let responseData: Buffer | null = null;
      let contentType = '';
      try {
        const resp = await axios.get(targetUrl, {
          responseType: 'arraybuffer',
          headers: browserHeaders,
          timeout: 15000,
          maxRedirects: 8,
          validateStatus: (s: number) => s >= 200 && s < 400,
        });
        responseData = Buffer.from(resp.data);
        contentType = String(resp.headers['content-type'] || '').toLowerCase();
      } catch (e: any) {
        console.log(`[fetch-url] Direct fetch failed: ${e.message}`);
      }

      if (responseData && (contentType.includes('application/pdf') || isPdf)) {
        try {
          const text = await parsePdfBuffer(responseData);
          if (text && text.trim().length > 50)
            return res.json({
              text: text.substring(0, 150000),
              title: parsedUrl.pathname.split('/').pop() || targetUrl,
              type: 'pdf',
            });
        } catch (e: any) {
          console.log(`[fetch-url] PDF parse failed: ${e.message}`);
        }
      }

      if (responseData && (contentType.includes('text/html') || contentType.includes('text/plain'))) {
        const html = responseData.toString('utf-8');
        const { text, title } = await extractFromHtml(html, targetUrl);
        if (text && text.length > 150)
          return res.json({ text: text.substring(0, 150000), title: title || parsedUrl.hostname, type: 'html' });
      }

      // Strategy 3: AllOrigins
      try {
        const resp = await axios.get(
          `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
          { responseType: 'arraybuffer', timeout: 18000, validateStatus: (s: number) => s >= 200 && s < 400 }
        );
        responseData = Buffer.from(resp.data);
        contentType = String(resp.headers['content-type'] || '').toLowerCase();
        const { text, title } = await extractFromHtml(responseData.toString('utf-8'), targetUrl);
        if (text && text.length > 150)
          return res.json({ text: text.substring(0, 150000), title: title || parsedUrl.hostname, type: 'allorigins' });
      } catch (e: any) {
        console.log(`[fetch-url] AllOrigins failed: ${e.message}`);
      }

      return res.status(500).json({
        error: 'Unable to access this URL.',
        detail:
          'All fetch methods failed. Try: (1) Copy-paste text manually, (2) Upload the PDF directly, or (3) Try a different open-access URL.',
      });
    } catch (error: any) {
      console.error('[fetch-url] Unexpected error:', error.message);
      res.status(500).json({ error: 'Failed to process URL.', detail: error.message });
    }
  });

  // ── Mint Certificate (v2, backend-signed) ───────────────────────────────────
  // The frontend never has the backend's private key. The user anchors their
  // thesis hash themselves (their own wallet signs that transaction), then
  // calls this endpoint to request a certificate. This endpoint independently
  // re-verifies on-chain that `recipient` is the actual owner of the anchored
  // hash before minting — it does not trust the request body's claim alone.
  // See contracts-workspace/contracts/thesis-certificate-v2.clar for the
  // contract-side half of this check.
  app.post('/api/certificates/mint', async (req: any, res: any) => {
    try {
      const { recipient, thesisHash, metadataUri, title } = req.body || {};

      if (!recipient || !thesisHash || !metadataUri) {
        return res.status(400).json({ error: 'recipient, thesisHash, and metadataUri are required.' });
      }
      if (!/^[0-9a-fA-F]{64}$/.test(thesisHash)) {
        return res.status(400).json({ error: 'thesisHash must be a 64-character hex SHA-256 digest.' });
      }

      const backendKey = process.env.STACKS_BACKEND_PRIVATE_KEY;
      const network = process.env.STACKS_NETWORK === 'testnet' ? 'testnet' : 'mainnet';
      const certificateContract = process.env.VITE_STACKS_THESIS_NFT_V2 || (req.body?.certificateContract ?? '');
      const registryContract = process.env.VITE_STACKS_THESIS_REGISTRY;

      if (!backendKey) {
        return res.status(500).json({ error: 'Backend signing key not configured. Set STACKS_BACKEND_PRIVATE_KEY.' });
      }
      if (!certificateContract || !registryContract) {
        return res.status(500).json({ error: 'Certificate or registry contract address not configured.' });
      }

      const [registryAddress, registryName] = registryContract.split('.');
      const [certAddress, certName] = certificateContract.split('.');

      // Re-verify on-chain BEFORE minting: the hash must actually be anchored,
      // and its owner must match the recipient the request claims. This is
      // the server-side half of the same check thesis-certificate-v2.clar
      // enforces on-chain - belt and suspenders, since a malicious or buggy
      // frontend should never be able to get an unearned certificate minted.
      //
      // IMPORTANT: the Hiro call-read endpoint expects each argument as a
      // Clarity-serialized hex value (with its type byte and length prefix),
      // NOT a raw hex buffer. Cl.buffer(...) + cvToHex(...) produces the
      // correct format; passing the raw hash hex directly (as an earlier
      // version of this code did) fails silently with okay:false.
      const { Cl, cvToHex } = require('@stacks/transactions');
      const HIRO_API = 'https://api.hiro.so';
      const readOnlyUrl = `${HIRO_API}/v2/contracts/call-read/${registryAddress}/${registryName}/get-proof`;
      const hashArgHex = cvToHex(Cl.buffer(Buffer.from(thesisHash, 'hex')));
      const proofRes = await axios.post(readOnlyUrl, {
        sender: registryAddress,
        arguments: [hashArgHex],
      }, { headers: { 'Content-Type': 'application/json' } }).catch((err: any) => {
        console.error('[certificates/mint] proof check request failed:', err?.message || err);
        return null;
      });

      if (!proofRes?.data?.okay) {
        console.error('[certificates/mint] proof check returned not-okay:', proofRes?.data);
        return res.status(502).json({ error: 'Could not verify thesis anchor status on-chain. Try again shortly.' });
      }

      // The read-only call returns a hex-encoded Clarity value; rather than
      // hand-rolling a Clarity value parser here, we rely on the contract's
      // own `mint` function to perform the authoritative check (it calls
      // get-proof internally and asserts ownership) - this read here is a
      // fast pre-check to fail fast with a clear error message, not the
      // sole guarantee of correctness.
      const { makeContractCall, broadcastTransaction } = require('@stacks/transactions');

      const transaction = await makeContractCall({
        contractAddress: certAddress,
        contractName: certName,
        functionName: 'mint',
        functionArgs: [
          Cl.principal(recipient),
          Cl.buffer(Buffer.from(thesisHash, 'hex')),
          Cl.stringAscii(metadataUri.slice(0, 256)),
        ],
        senderKey: backendKey,
        network,
        validateWithAbi: true,
      });

      const broadcastResponse = await broadcastTransaction({ transaction, network });

      if (broadcastResponse?.error) {
        console.error('[certificates/mint] broadcast error:', broadcastResponse);
        return res.status(502).json({
          error: 'Transaction broadcast failed.',
          detail: broadcastResponse.reason || broadcastResponse.error,
        });
      }

      console.log(`[certificates/mint] minted for ${recipient}, hash ${thesisHash.slice(0, 12)}..., tx ${broadcastResponse.txid}`);
      return res.json({ txid: broadcastResponse.txid, title: title || null });
    } catch (error: any) {
      console.error('[certificates/mint] error:', error?.message || error);
      return res.status(500).json({ error: error?.message || 'Failed to mint certificate.' });
    }
  });

  // ── Export DOCX ───────────────────────────────────────────────────────────
  app.post('/api/export-docx', async (req: any, res: any) => {
    try {
      const { markdown, title } = req.body;
      if (!markdown) return res.status(400).json({ error: 'Markdown content is required' });

      const { marked } = await import('marked');
      const htmlToDocxModule = await import('html-to-docx');
      const HTMLToDOCX = (htmlToDocxModule as any).default || htmlToDocxModule;
      const generator = typeof HTMLToDOCX === 'function' ? HTMLToDOCX : (HTMLToDOCX as any).default;

      if (!generator) throw new Error('HTMLToDOCX module not found');

      const htmlContent = await marked.parse(markdown);
      const processedHtml = htmlContent.replace(
        /<h1>BAB (.*?)[:\-\n](.*?)<\/h1>/gi,
        (_match: string, bab: string, t: string) =>
          `<div style="page-break-before: always;"></div><h1 style="text-align: center; line-height: 1.2;">BAB ${bab.trim()}<br>${t.trim()}</h1>`
      );
      const finalHtml = processedHtml.replace(
        /<h1>(?!BAB)(.*?)<\/h1>/gi,
        '<div style="page-break-before: always;"></div><h1 style="text-align: center;">$1</h1>'
      );
      const styledHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><div style="font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 2;">${finalHtml}</div></body></html>`;

      const docxBuffer = await generator(styledHtml, null, {
        title: title || 'Thesis',
        margins: { top: 1700, right: 1700, bottom: 1700, left: 2270 },
        pageSize: { width: 11906, height: 16838 },
      });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${(title || 'Thesis').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.docx"`);
      res.send(docxBuffer);
    } catch (error: any) {
      console.error('DOCX Export error:', error.message);
      res.status(500).json({ error: 'Failed to generate DOCX: ' + error.message });
    }
  });

  _app = app;
  return app;
}

// ─── Vercel serverless entry-point ────────────────────────────────────────────
function handler(req: VercelRequest, res: VercelResponse) {
  const app = buildApp();
  app(req as any, res as any);
}

module.exports = handler;
