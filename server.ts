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
