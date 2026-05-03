import express from 'express';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { PDFParse } from 'pdf-parse';

async function parsePdfBuffer(buffer: Buffer) {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();
  return result.text;
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

  app.post('/api/fetch-url', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: 'URL is required' });

      // Identify dynamic sites or paywalled sites by trying multiple fetch attempts/headers
      let response;
      try {
        response = await axios.get(url, {
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1'
          },
          timeout: 15000,
          validateStatus: () => true
        });
        
        // If forbidden or client error, try a proxy
        if (response.status === 403 || response.status === 401 || response.status === 429) {
          throw new Error('Blocked by target server');
        }
      } catch (e: any) {
        console.log(`Direct fetch failed for ${url}, trying via AllOrigins proxy...`);
        try {
          response = await axios.get(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, {
            responseType: 'arraybuffer',
            timeout: 20000,
            validateStatus: () => true
          });
        } catch (proxyError: any) {
          return res.status(500).json({ error: `Website tidak dapat diakses (mungkin dilindungi atau memerlukan login). Error: ${proxyError.message}` });
        }
      }

      if (response.status !== 200) {
        return res.status(response.status).json({ 
          error: `Gagal memuat URL: ${response.status} ${response.statusText}`,
          detail: 'Website kemungkinan memblokir akses otomatis (bot protection) atau file PDF langsung. Coba unduh PDF/artikel dan upload manual.'
        });
      }

      const contentType = response.headers['content-type']?.toLowerCase() || '';
      const buffer = Buffer.from(response.data);

      if (contentType.includes('application/pdf')) {
        const text = await parsePdfBuffer(buffer);
        return res.json({ text: text.substring(0, 150000), type: 'pdf' });
      }

      // Default to HTML handling
      const html = buffer.toString('utf-8');
      
      // Use Readability and JSDOM for better extraction
      const { JSDOM } = await import('jsdom');
      const { Readability } = await import('@mozilla/readability');
      const TurndownService = (await import('turndown')).default;
      
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      if (!article || !article.content) {
        // Fallback to basic cheerio if readability fails
        const $ = cheerio.load(html);
        $('script, style, noscript, iframe, img, svg, nav, footer, header').remove();
        const text = $('body').text().replace(/\s+/g, ' ').trim();
        if (!text) {
          return res.status(422).json({ error: 'Could not extract content from page. The page might be empty or restricted.' });
        }
        return res.json({ text: text.substring(0, 100000), type: 'html-basic' });
      }

      // Convert the cleaned HTML to Markdown for better structure
      const turndownService = new TurndownService();
      const markdown = turndownService.turndown(article.content);
      
      const resultText = `Title: ${article.title}\n\n${markdown}`;

      res.json({ 
        text: resultText.substring(0, 150000), 
        title: article.title,
        excerpt: article.excerpt,
        type: 'html-readability' 
      });
    } catch (error: any) {
      console.error('Fetch URL error:', error.message);
      res.status(500).json({ 
        error: 'Gagal memproses konten URL: ' + error.message,
        detail: 'Website kemungkinan memblokir akses otomatis, atau isi website tidak dapat diekstrak. Disarankan untuk mengunggah file dokumen atau PDF secara manual.'
      });
    }
  });

  app.post('/api/export-docx', async (req, res) => {
    try {
      const { markdown, title } = req.body;
      if (!markdown) return res.status(400).json({ error: 'Markdown content is required' });

      // Dynamically import marked and html-to-docx to avoid top-level issues if they are ESM/CJS mixed
      const { marked } = await import('marked');
      const HTMLToDOCX = (await import('html-to-docx')).default || await import('html-to-docx');
      
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

      // The html-to-docx library usually exports default or module.exports
      // We handle both cases using dynamic import
      
      const generator = typeof HTMLToDOCX === 'function' ? HTMLToDOCX : (HTMLToDOCX as any).default;

      // Indonesian Skripsi Margins (Twips): 
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
